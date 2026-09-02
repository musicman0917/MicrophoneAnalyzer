# Mic Level HUD (Electron)

A comprehensive companion utility for a multi-environment mic workflow (local recording,
live streaming, Discord/karaoke) built around a **Mackie DLZ Creator XS** and an **sE
DynaCaster**. This is the Electron/Web Audio API companion to the WPF/NAudio version of
this app in `../src` - same underlying goal, different tech stack and tradeoffs (see
[Web Audio vs. WASAPI](#web-audio-vs-wasapi---a-real-limitation) below).

## What's here

1. **Real-time sweet-spot HUD** - a small always-on-top, frameless, transparent LED meter
   window, draggable, with the same broadcast color scale as the WPF app.
2. **Room noise floor calibration** - samples a few seconds of ambient silence, computes a
   baseline noise floor in dB, and suggests a gate threshold 6-10 dB above it. Triggerable
   from the HUD, the Control Center, the tray menu, or the global hotkey `Ctrl+Alt+N`.
3. **OBS filter & workflow recommendations** - a rule engine that reacts to your live
   level, the calibrated noise floor, and which of Recording/Streaming/Discord you're
   doing, producing concrete OBS filter-chain suggestions.
4. **Interactive hardware reference** - a diagram of the DLZ Creator XS's front panel with
   glowing hotspots pointing at exactly what to adjust for whatever's currently wrong.

## Running it

```powershell
cd electron-app
npm install
npm start
```

This opens the floating HUD immediately; right-click the tray icon or click the HUD's
gear button to open the **Control Center**, which has the Devices, Noise Floor,
Recommendations, and Hardware Reference tabs.

`npm run check` runs a plain syntax check over the main/preload processes.
`electron . --smoke-test` opens both windows and quits automatically after 4 seconds -
useful for confirming the app still boots after a change, without a person at the keyboard.

## Architecture

```
main/main.js              Main process: window lifecycle, tray, global hotkey, IPC broker
preload/hud-preload.js    contextBridge surface exposed to the HUD renderer as window.hudApi
preload/control-preload.js  ...and to the Control Center renderer as window.controlApi

shared/                   Plain browser ES modules, imported directly by both renderers
                           via <script type="module"> - no bundler needed.
  dsp.js                  linear<->dB conversion, RMS/peak buffer analysis
  levelClassifier.js      dBFS -> broadcast zone -> color/label (mirrors the WPF app 1:1)
  audioEngine.js          getUserMedia + ChannelSplitterNode capture, RMS/peak/peak-hold
  noiseFloor.js           Ambient RMS sampling -> noise floor + suggested gate threshold
  recommendations.js      Rule engine: levels + noise floor + workflow -> OBS/hardware advice
  hotspots.js             Coordinate map for the hardware reference diagram

renderer/hud/              The floating meter window
renderer/control/          The Devices / Noise Floor / Recommendations / Hardware tabs
assets/                    Generated PNG icons (see scripts/generate-icons.mjs)
```

**Why two windows talking through the main process, instead of one window doing
everything:** the HUD is the thing you glance at while recording/streaming, so it stays
tiny, transparent, and always-on-top. The Control Center needs real screen space for four
tabs and a diagram, which fights with "small overlay that stays out of your way." Splitting
them means the HUD owns the live `getUserMedia` stream (microphone access has to live
somewhere), and the Control Center subscribes to what it needs - live levels, connection
status, calibration results - over IPC, relayed through `main.js`. Device selection UI
lives in the Control Center (more room for a proper list), but the actual `AudioEngine`
instance the selection controls lives in the HUD; picking a device there sends the
selection to the HUD via IPC, which is the one that opens the stream.

**Why the audio analysis loop uses `setInterval` instead of `requestAnimationFrame`:**
Chromium throttles/suspends `requestAnimationFrame` in hidden or non-composited windows.
Since you can hide the HUD from the tray while keeping the Control Center open, gating the
underlying level analysis on the HUD's own rAF would silently freeze the Control Center's
recommendations and live readout the moment you hide the overlay. `AudioEngine`'s analysis
loop runs on a plain interval so it keeps going regardless of HUD visibility; `hud.js`'s own
canvas *drawing* still uses rAF, since pausing pixels nobody can see is exactly the
optimization you want there.

### Level scale

Identical to the WPF app - see `shared/levelClassifier.js`:

| Range            | Zone                     | Color        |
|-------------------|--------------------------|--------------|
| < -24 dB          | Too Low / Under-powered  | Red          |
| -24 to -18 dB     | Low (approaching)        | Orange       |
| **-18 to -10 dB** | **Sweet Spot**           | **Green**    |
| -10 to -6 dB      | Hot (approaching clip)   | Amber        |
| > -6 dB           | Clipping risk            | Red          |

### Noise floor calibration

`NoiseFloorCalibrator` samples RMS over ~2.5s, using the 75th percentile (rather than the
raw max) so one stray transient - a chair creak, a door - doesn't blow out the baseline.
The suggested gate threshold is the floor plus 6-10 dB, a standard gain-staging margin wide
enough to avoid gate chatter without leaving a hole for noise to sneak through. A floor
above -45 dB is flagged as "room is loud for broadcast use" - no gate setting fixes a noisy
room, so the recommendation engine (module 3) tells you to treat the room, not just filter
around it.

### Recommendation engine

`buildRecommendations()` in `shared/recommendations.js` is a small, ordered rule set - not
a black box - so it's easy to audit or retune: under/over level triggers hardware gain-trim
guidance first (analog gain before digital), a calibrated noise floor produces a concrete
gate range, wide peak-vs-RMS spread flags a compressor, and each workflow (Recording /
Streaming / Discord) gets its own baseline chain suggestion reflecting that environment's
actual constraints (e.g. Discord favors the DLZ's onboard hardware processing over an OBS
chain, since Discord never sees OBS at all).

### Hardware reference diagram

`assets/dlz-front-panel.jpg` is an actual photo of a DLZ Creator XS, and the hotspot
coordinates in `shared/hotspots.js` (fractions 0..1 of the image's width/height) were
measured directly against it. All 10 hotspots are clickable, not just the glowing ones -
click any point for its full detail: description, a numbered tap sequence where it lives on
the touchscreen, and (for 4 of them) an actual screenshot of that menu extracted from the
official DLZ Creator XS Owner's Manual PDF (`assets/manual/*.png`, pulled via `pdfimages`,
not a mockup or a redraw).

Every label/description/step is sourced, not guessed: some straight off the unit's own
touchscreen in the photo ("CH1 Input +26dB" on the Quick Control Knob), the rest quoted or
paraphrased from the manual (Chapters 3 and 6) - e.g. the numbered 1-5 knob cluster is a
per-channel *output* level control with paired Solo/Mute buttons, quoting the manual
verbatim, not the gain-staging control it might look like at a glance; the Gate and
Compressor entries carry the manual's actual default values (Gate: Threshold -45 dB, Range
-19 dB, Attack 19 ms, Release 92 ms, Hold 50 ms; Compressor: Threshold -30 dB, Ratio 2:1,
Gain +1 dB, Attack 42 ms, Release 500 ms, Soft Knee).

One caveat stated plainly in `shared/hotspots.js`'s header comment: the manual's screenshots
show what that menu *contains* and how to *reach* it - they aren't a guarantee that your
unit's current on-screen layout matches pixel-for-pixel (firmware can move on from what a
manual was written against). Four hotspots that all live on the touchscreen (48V, Set Gain
Automatically, Gate, Compressor) are spread across the screen's bounding box in this UI
purely so each is independently clickable - that spread is a UI convenience, not a claim
about their exact on-screen pixel position; the linked screenshot is the accurate reference
for the real layout.

The manual PDF itself isn't checked into this repo (it's Mackie's copyrighted document);
only the handful of extracted menu screenshots are, used here as user-guidance reference
material the same way any compatible third-party app might cite a product's own screens.

If you swap in a different photo (a different unit, angle, or crop), the coordinates won't
transfer automatically - re-measure `xPct`/`yPct` in `shared/hotspots.js` against the new
image, and swap the `<img src>` in `control.html`.

Hotspots glow when a current recommendation references them (color follows severity: red
for critical, amber for warning, blue for informational); hovering shows a quick label,
clicking opens the full detail panel below the diagram.

## Web Audio vs. WASAPI - a real limitation

The Web Audio API cannot do what the WPF/NAudio version of this app does with WASAPI shared
mode: open one device and freely address any of its interleaved channels. The best a
browser sandbox can do is:

1. Request `channelCount: { ideal: N }` in the `getUserMedia` constraints and hope the OS
   driver and Chromium hand back that many channels.
2. Check `track.getSettings().channelCount` for what you actually got - this is
   driver/OS/Chromium-version dependent, not guaranteed to match the interface's real
   channel count.
3. Route the stream through a `ChannelSplitterNode` and pick one output - this *is* the
   correct Web Audio pattern for per-channel access, implemented in `shared/audioEngine.js`.

If your OS/driver only ever exposes a stereo downmix to Chromium, per-channel selection
beyond channel 2 simply isn't available from here - that's a ceiling of the platform, not a
bug in this code. It's called out directly in the Devices tab so it doesn't read as a
silent failure. If you need guaranteed full-channel WASAPI access, that's exactly what the
`../src` WPF/NAudio version is for.

`echoCancellation`, `noiseSuppression`, and `autoGainControl` are explicitly disabled in the
capture constraints - Chrome's default voice-chat processing would otherwise quietly mangle
the raw levels this whole app exists to measure.

## Notes / extension points

- Settings (device, channel, orientation, workflow, last calibration) persist via
  `localStorage` per window rather than a shared settings file - simple and sufficient at
  this scope, though it does mean the HUD and Control Center each keep their own copy of
  window-specific things like device selection convenience state.
- The tray icon and window icon are generated from scratch by
  `scripts/generate-icons.mjs` using only Node's built-in `zlib` (no image tooling or
  network fetch) - re-run it after tweaking the palette/shapes if you want to restyle them.
- `main.js`'s `attachConsoleRelay()` forwards renderer warnings/errors into the main
  process's log - useful for diagnosing a packaged build without the user needing to open
  DevTools themselves.

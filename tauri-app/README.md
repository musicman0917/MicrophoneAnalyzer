# Mic Level HUD (Tauri)

A third implementation of the same idea, built to fix a real bug the Electron/Web Audio
version couldn't: the Web Audio API can only ever request "as many channels as the browser
sandbox is willing to grant." On this app's actual hardware (a Mackie DLZ Creator XS), that
meant the meter was reading a downmixed/wrong-channel signal - showing "Sweet Spot" while
the real analog signal was already clipping, confirmed by comparing the app's reading
against OBS's own mixer meter on the same input at the same moment.

This version captures through [`cpal`](https://docs.rs/cpal) straight onto WASAPI (the same
layer NAudio uses in the WPF app in `../src`), in a small Rust backend, with the Electron
app's HTML/CSS/JS frontend reused almost entirely as-is. Channel selection is a direct index
into the device's real interleaved buffer - there is no browser-mediated downmix in the path
at all, so this class of bug cannot happen here.

## Requirements

- Windows 10/11 (final target - WASAPI via cpal's Windows backend)
- Rust + Cargo ([rustup.rs](https://rustup.rs))
- Node.js (for the Tauri CLI only - the frontend itself is plain HTML/CSS/JS, no bundler,
  no npm frontend dependencies)

This was developed and verified building/running on Linux (cpal's ALSA backend, WebKitGTK
for the window chrome) since that's what was available - the architecture is identical on
Windows, just swapping cpal's backend to WASAPI and the webview to WebView2, both handled
transparently by cpal/Tauri. It has not yet been run against real Windows/WASAPI hardware.

## Running it

```powershell
cd tauri-app
npm install
npm run tauri dev
```

For a release build:

```powershell
npm run tauri build
```

## Architecture

```
src-tauri/src/
  audio.rs       Core capture engine. A dedicated OS thread owns the cpal Stream for its
                 whole lifetime, driven by a command channel (Start/SetChannel/Stop) - this
                 sidesteps any question of whether cpal::Stream is Send, since it never
                 needs to cross a thread boundary. RMS/peak/peak-hold live in a separate
                 Arc<Mutex<...>>, freely readable from Tauri commands. Also owns noise-floor
                 calibration (ported from the Electron app's noiseFloor.js).
  commands.rs    The #[tauri::command] handlers the frontend calls via invoke() - device
                 listing, start/stop/select-channel, calibration, window management.
  dsp.rs         linear<->dB conversion, RMS/peak buffer analysis - ported 1:1 from the
                 Electron app's shared/dsp.js.
  lib.rs         App setup: window creation, tray icon, global hotkey (Ctrl+Alt+N), and a
                 background task that emits level-update events to the frontend at ~30Hz.

src/             Frontend - almost entirely reused from ../electron-app/renderer and
                 ../electron-app/shared:
  shared/        dsp.js, levelClassifier.js, recommendations.js, hotspots.js copied over
                 unchanged (pure JS, no Electron dependency). noiseFloor.js was NOT copied -
                 its logic now lives in audio.rs's run_calibration(), since calibration
                 needs raw sample access that now only exists in Rust.
  shared/tauriApi.js   The one file that knows about window.__TAURI__ (global API, no
                 bundler) - everything else imports invoke()/listen() from here.
  hud/, control/ Same HTML/CSS structure as the Electron app; the *.js files are rewritten
                 to call Tauri commands/events instead of window.hudApi/window.controlApi.
```

### What actually got simpler

Moving the audio engine into Rust as global app state (`app.manage(AudioEngine::new())`)
removed a whole layer of the Electron app's design: there, only the HUD window's own JS
could touch `getUserMedia`, so the Control Center had to relay actions like calibration
through the HUD via extra IPC hops (window.controlApi.runCalibration() → main.js →
'calibration:start' to the HUD → HUD runs it → 'calibration:result' back through main.js).
Here, `commands::run_calibration` is reachable identically from either window - there's
nothing to relay. Channel switching is also simpler and cheaper: cpal hands the callback
the full interleaved buffer regardless of which channel you care about, so switching which
one you're analyzing is a live atomic store, not a stream/graph rebuild.

### What's unchanged from the Electron version

- The broadcast color scale and the peak-overrides-RMS display logic
  (`classifyWithPeak` in `shared/levelClassifier.js`) - same bug, same fix, same file.
- The two-range LED bar scale (`DEEP_FLOOR_DB`/`ACTIONABLE_FLOOR_DB`/`COMPRESSED_SEGMENTS`
  in `hud/hud.js`) - same reasoning about why a single linear floor can't avoid both "wall
  of red at a healthy level" and "bar goes dead-empty when quiet."
- The recommendation engine, the interactive hardware reference (real DLZ photo + manual
  screenshots), and noise floor calibration's math (75th-percentile-of-RMS, not raw max).

### What's gone, and why

- **The downmix warning UI** (`updateDownmixWarning` in the Electron app's control.js) -
  removed entirely, because the failure mode it detected can't occur here. Channels come
  straight from WASAPI's own supported-config negotiation via cpal, not a browser sandbox's
  best-effort `channelCount` request.
- **noiseFloor.js's JS-side sampling loop** - calibration now runs entirely in
  `audio.rs::run_calibration()`, sampling the shared level state directly rather than
  pulling from a Web Audio `AnalyserNode`.

## Verification

Every module was compiled with `cargo check`/`cargo build` (catching real bugs along the
way - see git history for two: a `SetChannel` command that couldn't actually reach the
running stream, and a tray-icon error-type mismatch). The full app was then run headlessly
under Xvfb (this project has no real audio hardware or Windows to test WASAPI capture
against), with `xdotool` driving clicks and `ffmpeg -f x11grab` capturing screenshots to
confirm the HUD, Control Center, and all four tabs (Devices, Noise Floor, Recommendations,
Hardware Reference) actually render and respond to input, not just that the code compiles.
Device enumeration and capture themselves are unverified against real WASAPI hardware - do
that first before trusting the numbers.

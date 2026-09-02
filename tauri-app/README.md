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
transparently by cpal/Tauri.

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

### Both windows are declared visible, on purpose

`hud` and `control` are both declared in `tauri.conf.json` with no `visible: false` and no
hide-then-show choreography in Rust - both windows are simply on screen from the moment the
app launches. This looks like it costs a small UX nicety (Control Center popping up on every
launch instead of starting tucked away), but it's the result of hard-won debugging on real
Windows hardware, not an oversight:

Three earlier, more "polished" designs - runtime-building the Control Center window on
demand, declaring it `visible: false` and showing it lazily, and eagerly creating it then
hiding it from `.setup()` - each produced a window with correct native chrome but a WebView2
control that was either never created or stuck on `about:blank`, confirmed via WebView2's
own `--remote-debugging-port` CDP endpoint (`http://localhost:9222/json` showed no page
target at all, or one parked on `about:blank`, depending on the attempt). Every one of those
failure modes traced back to some part of window/webview creation happening off Tauri's main
thread, or racing WebView2's own asynchronous controller-creation/navigation sequence.

Rather than layer on a fourth timing-dependent workaround, this version removes the
choreography entirely: both windows are created by Tauri's own startup bootstrap, the same
known-good path, at the same time. `open_control_center` just calls `show()`/`set_focus()`
on a window that's been fully alive since launch. Closing either window hides it rather than
destroying it (`on_window_event`'s `CloseRequested` handler), so that call is always
operating on an already-initialized webview - no re-creation, ever, after the first launch.

If someone wants the "starts hidden" nicety back, the least risky path is a short, visible
splash state (rather than `visible: false`) so the controller is still created eagerly on
the main thread - and worth re-verifying against `--remote-debugging-port` before trusting
it, given how many ways this specific corner of Tauri/WebView2 has broken so far.

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

This version of `tauri-app/` was rebuilt from a clean `npm create tauri-app@latest`
scaffold rather than incrementally patched, after real Windows/WebView2 hardware testing
showed the Control Center window staying permanently blank through three separate targeted
fixes (see git history from `61dc47e` through `d7893ff` for that whole investigation,
including the CDP-based diagnosis that ruled each one out). Only `audio.rs` and `dsp.rs`
(no window/webview code at all) were carried over unchanged; `Cargo.toml`, `tauri.conf.json`,
`commands.rs`, and `lib.rs` were rebuilt on top of the fresh scaffold's own known-good
defaults, specifically to remove every piece of hidden/lazy-window choreography that had
been implicated - see "Both windows are declared visible, on purpose" above.

Every module was compiled clean with `cargo check`/`cargo build`. The full app was then run
headlessly under Xvfb (this sandbox has no real audio hardware or Windows to test WASAPI
capture against) with `xdotool` driving clicks and `ffmpeg -f x11grab` capturing
screenshots, confirming both HUD and Control Center render real content **simultaneously
from the moment the app launches** (not just after some interaction), and that closing and
reopening Control Center via the HUD's gear icon still shows full content afterward.

Device enumeration and capture, and this rebuilt Control Center window, are both still
unverified against real Windows/WASAPI hardware - do that first before trusting the numbers,
and specifically re-check `http://localhost:9222/json` (see "Both windows are declared
visible, on purpose" above for how) one more time to confirm `control/control.html` now
actually appears as a live page target instead of `about:blank` or nothing at all.

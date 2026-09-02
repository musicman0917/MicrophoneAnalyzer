# MicrophoneAnalyzer

Two implementations of the same idea: a real-time mic-level analyzer and "sweet spot"
visual guide for a multi-environment workflow (local recording, live streaming, Discord
voice/karaoke), built around a **Mackie DLZ Creator XS** feeding an **sE DynaCaster**.

- **`src/`** - a WPF/.NET 8 app using NAudio/WASAPI. Full per-channel access to the DLZ's
  multi-channel interface, Windows-only. See below for details.
- **`electron-app/`** - an Electron/Web Audio API app with the same LED HUD plus three
  extra modules: room noise floor calibration, an OBS filter/workflow recommendation
  engine, and an interactive hardware reference diagram. Cross-platform-capable, but the
  Web Audio API can't do WASAPI-style per-channel addressing (see that app's README for
  what that means in practice). See `electron-app/README.md` for its own architecture,
  setup, and details.

The rest of this file covers the WPF/NAudio version.

## Requirements

- Windows 10/11
- .NET 8 SDK
- A WASAPI-visible input device (the DLZ Creator XS shows up as a normal Windows
  recording device once its driver/Big Knob is installed)

This project targets `net8.0-windows` and uses WASAPI (via NAudio) and WPF, both of which
are Windows-only — it cannot be built or run in a Linux/macOS environment.

## Build & run

```powershell
dotnet restore
dotnet build -c Release
dotnet run --project src\MicrophoneAnalyzer\MicrophoneAnalyzer.csproj
```

Or just open `MicrophoneAnalyzer.sln` in Visual Studio 2022 and hit F5.

On first launch you'll get a small dialog to pick your input device and channel — see
[Finding the right channel](#finding-the-right-channel-on-a-multi-channel-interface) below.
The choice is remembered in `%AppData%\MicrophoneAnalyzer\settings.json`.

## Architecture

```
Audio/
  AudioDeviceService.cs   Enumerates active WASAPI capture endpoints (MMDeviceEnumerator)
  AudioLevelMonitor.cs    Owns a WasapiCapture, computes RMS/peak dBFS per callback,
                           tracks a decaying peak-hold value. Thread-safe read via GetLevels().
  LevelClassifier.cs      Pure function: dBFS -> LevelZone -> color/label
  LevelZone.cs
  AudioDeviceInfo.cs

Models/AppSettings.cs      Persisted device id, channel, window position, orientation
Services/SettingsService.cs  JSON load/save to %AppData%

UI/
  LedMeterControl.cs        Custom FrameworkElement, draws the segmented LED bar directly
                             with DrawingContext (no template/child-control overhead)
  DeviceSelectionWindow.*    Small modal to pick device + channel

MainWindow.xaml(.cs)        Borderless, transparent, topmost, draggable HUD shell.
                             A DispatcherTimer (~30fps) polls AudioLevelMonitor and
                             updates the meter/readout/zone label — decoupled from the
                             audio thread so rendering never blocks capture.
```

**Why polling instead of an event per audio callback:** WASAPI shared-mode callbacks fire
every ~10ms. Marshaling every single one to the UI thread would flood the dispatcher for no
visual benefit — the eye can't resolve more than ~30-60fps anyway. `AudioLevelMonitor`
keeps the latest RMS/peak/peak-hold values behind a lock; the UI timer reads them at a fixed
cadence.

**Multi-channel capture:** WASAPI shared mode hands you the device's full mix format
(interleaved, all channels). `AudioLevelMonitor` deinterleaves and only analyzes the one
channel index you selected, via `MemoryMarshal.Cast<byte, float>` over the raw buffer — no
per-sample allocations.

### Level scale

| Range            | Zone                     | Color        |
|-------------------|--------------------------|--------------|
| < -24 dB          | Too Low / Under-powered  | Red          |
| -24 to -18 dB     | Low (approaching)        | Orange       |
| **-18 to -10 dB** | **Sweet Spot**           | **Green**    |
| -10 to -6 dB      | Hot (approaching clip)   | Amber        |
| > -6 dB           | Clipping risk            | Red          |

The three named bands (`< -24`, `-18..-10`, `> -6`) are exactly what you specified. The two
gaps were filled with transition bands (amber) so the LED ladder grades smoothly rather than
jumping straight from red to green — standard practice on broadcast PPM meters. All
thresholds live in `LevelClassifier.cs` if you want to retune them (e.g. tighter for
Discord, looser for local multitrack recording with post-processing headroom).

The LED meter itself is a classic hardware-style bar: each of its 28 segments has a color
fixed by its own position on the dB scale (via `LevelClassifier`), and segments illuminate
from the bottom as your RMS level rises. A white-outlined segment tracks peak-hold, decaying
at 14 dB/sec, so you can catch transients even if you glance away and back.

## Finding the right channel on a multi-channel interface

The DLZ Creator XS exposes itself to Windows as **one** recording device with several
interleaved channels (main mix / per-input sends, depending on how you've routed it in the
Mackie software). `AudioDeviceService` reports the channel count for whatever device you
pick, and the device-selection dialog lets you choose a 1-based channel number.

If you're not sure which channel your DynaCaster lands on:
1. Open the device selection dialog (right-click the HUD → **Select Input Device...**).
2. Try channels one at a time while speaking into the mic and watching the meter — the
   correct one will show the DynaCaster's signal immediately.
3. This matches whatever channel order the DLZ's Windows driver reports, which follows
   however you've configured routing in the Mackie Big Knob / DLZ Creator software.

## Using the HUD

- **Drag**: click-and-drag anywhere on the HUD to move it.
- **Right-click** for: device/channel selection, orientation toggle (vertical/horizontal),
  always-on-top toggle, exit.
- Position, device, channel, and orientation are all persisted between launches.

## Notes / extension points

- This is intentionally a single always-visible overlay rather than a system-tray app —
  it's meant to sit at the edge of your screen while you record/stream. Adding a
  `System.Windows.Forms.NotifyIcon` tray icon with show/hide is a small addition if you'd
  rather it live in the tray between sessions.
- Thresholds are one flat scale; if you want per-workflow presets (e.g. Discord vs. local
  multitrack), the natural extension is a small `enum WorkflowProfile` with a couple of
  threshold sets swapped into `LevelClassifier`.
- Capture currently requires the device to hand back a WASAPI shared-mode float mix format
  (true for essentially all modern audio interfaces including the DLZ Creator XS). If you
  ever hit the `NotSupportedException` in `AudioLevelMonitor.Start`, the device is offering
  a PCM (int) mix format instead — that's a one-line fix (add an int16/int24 conversion
  branch) rather than a redesign.

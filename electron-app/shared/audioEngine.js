// Core Web Audio capture + level metering.
//
// Important limitation vs. the WASAPI/NAudio version of this app: getUserMedia does not
// give you WASAPI-style "pick any interleaved channel of a shared-mode stream" access.
// The correct Web Audio pattern - used here - is:
//   1. Request the stream with `channelCount: { ideal: N }` so Chromium/the OS driver
//      hands back as many of the DLZ's channels as it's willing to grant.
//   2. Check track.getSettings().channelCount for how many you actually got (this is
//      driver/OS/Chromium-version dependent and NOT guaranteed to be the interface's
//      full channel count).
//   3. Route the MediaStreamSource through a ChannelSplitterNode and pick one output.
// If the OS/driver only ever hands Chromium a stereo (or mono) downmix, per-channel
// selection beyond that isn't possible from a browser sandbox - that's a real ceiling of
// the Web Audio API, not a bug in this code. Flag this to the user in the UI rather than
// pretending it always works.
//
// echoCancellation/noiseSuppression/autoGainControl are explicitly disabled: Chrome's
// default voice-chat processing would otherwise corrupt the raw levels this meter needs.
//
// The analysis loop below runs on setInterval rather than requestAnimationFrame. This
// isn't just a style choice: the HUD window (which owns this engine) is meant to be
// hide-able from the tray while the Control Center keeps monitoring, and Chromium
// throttles/suspends rAF callbacks in hidden or non-composited windows. requestAnimationFrame
// is still the right tool for hud.js's own canvas *drawing*, which should pause when
// nothing is visible to draw to - but level analysis needs to keep running underneath
// that regardless of whether the HUD is currently shown.

import { linearToDb, analyzeBuffer, MIN_DB } from './dsp.js';

const RMS_ATTACK = 0.6; // 0..1 smoothing coefficient applied when level is rising
const RMS_RELEASE = 0.15; // ...and when it's falling (slower, so the meter doesn't flicker)
const PEAK_HOLD_DECAY_DB_PER_SEC = 14;
const ANALYSIS_INTERVAL_MS = 33; // ~30Hz - plenty for metering, cheap enough to run unattended

export class AudioEngine extends EventTarget {
  constructor() {
    super();
    this.audioCtx = null;
    this.stream = null;
    this.source = null;
    this.splitter = null;
    this.analyser = null;
    this.channelIndex = 0;
    this.channelCount = 1;

    this._buffer = null;
    this._rmsDb = MIN_DB;
    this._peakDb = MIN_DB;
    this._peakHoldDb = MIN_DB;
    this._lastPeakUpdateMs = 0;
    this._intervalId = null;

    this._loop = this._loop.bind(this);
  }

  get isRunning() {
    return !!this.stream;
  }

  async start(deviceId, channelIndex = 0, desiredChannelCount = 8) {
    this.stop();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        channelCount: { ideal: desiredChannelCount },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const track = stream.getAudioTracks()[0];
    const grantedChannels = track.getSettings().channelCount || 1;

    const audioCtx = new AudioContext({ latencyHint: 'interactive' });
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0; // we do our own attack/release smoothing below

    let splitter = null;
    if (grantedChannels > 1) {
      splitter = audioCtx.createChannelSplitter(grantedChannels);
      source.connect(splitter);
      const clampedChannel = Math.min(channelIndex, grantedChannels - 1);
      splitter.connect(analyser, clampedChannel, 0);
    } else {
      source.connect(analyser);
    }

    this.audioCtx = audioCtx;
    this.stream = stream;
    this.source = source;
    this.splitter = splitter;
    this.analyser = analyser;
    this.channelIndex = channelIndex;
    this.channelCount = grantedChannels;

    this._buffer = new Float32Array(analyser.fftSize);
    this._rmsDb = this._peakDb = this._peakHoldDb = MIN_DB;
    this._lastPeakUpdateMs = performance.now();

    this._loop();
    this._intervalId = setInterval(this._loop, ANALYSIS_INTERVAL_MS);

    this.dispatchEvent(new CustomEvent('started', { detail: { channelCount: grantedChannels } }));
    return { channelCount: grantedChannels };
  }

  /** Re-points the analyser at a different channel of the already-open stream (no re-prompt). */
  setChannel(channelIndex) {
    if (!this.analyser) return;
    this.channelIndex = channelIndex;
    if (this.splitter) {
      try {
        this.splitter.disconnect(this.analyser);
      } catch {
        /* not connected yet, ignore */
      }
      const clamped = Math.min(channelIndex, this.channelCount - 1);
      this.splitter.connect(this.analyser, clamped, 0);
    }
  }

  stop() {
    if (this._intervalId != null) clearInterval(this._intervalId);
    this._intervalId = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.audioCtx?.close().catch(() => {});
    this.stream = null;
    this.audioCtx = null;
    this.source = null;
    this.splitter = null;
    this.analyser = null;
  }

  /** Exposes the live AnalyserNode so the noise-floor calibrator can sample the same signal. */
  getAnalyserNode() {
    return this.analyser;
  }

  getLevels() {
    return { rmsDb: this._rmsDb, peakDb: this._peakDb, peakHoldDb: this._peakHoldDb };
  }

  _loop() {
    const analyser = this.analyser;
    if (!analyser) return;

    analyser.getFloatTimeDomainData(this._buffer);
    const { rms, peak } = analyzeBuffer(this._buffer);
    const instRmsDb = linearToDb(rms);
    const instPeakDb = linearToDb(peak);

    const coeff = instRmsDb > this._rmsDb ? RMS_ATTACK : RMS_RELEASE;
    this._rmsDb += (instRmsDb - this._rmsDb) * coeff;
    this._peakDb = instPeakDb;

    const nowMs = performance.now();
    const elapsedSec = (nowMs - this._lastPeakUpdateMs) / 1000;
    this._lastPeakUpdateMs = nowMs;
    const decayed = this._peakHoldDb - PEAK_HOLD_DECAY_DB_PER_SEC * elapsedSec;
    this._peakHoldDb = Math.max(instPeakDb, decayed);

    this.dispatchEvent(new CustomEvent('level', { detail: this.getLevels() }));
  }
}

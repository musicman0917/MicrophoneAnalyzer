// Room noise floor calibration: samples RMS over a short window of ambient silence and
// derives a baseline dB level plus a suggested noise-gate threshold (6-10 dB above it,
// per standard gain-staging practice).

import { linearToDb, analyzeBuffer } from './dsp.js';

export const DEFAULT_CALIBRATION_DURATION_MS = 2500;
const ROOM_TOO_LOUD_THRESHOLD_DB = -45; // rough "treated small room / booth" guideline
const GATE_OFFSET_RANGE_DB = [6, 10];

export class NoiseFloorCalibrator {
  /** @param {() => AnalyserNode | null} getAnalyser Returns the live analyser to sample. */
  constructor(getAnalyser, durationMs = DEFAULT_CALIBRATION_DURATION_MS) {
    this._getAnalyser = getAnalyser;
    this._durationMs = durationMs;
  }

  /**
   * Samples ambient RMS for `durationMs` and returns a summary. Call this while the room
   * is silent (no talking) - a couple of seconds is enough to catch steady-state noise
   * like fans or HVAC hum.
   */
  run(onProgress) {
    const analyser = this._getAnalyser();
    if (!analyser) {
      return Promise.reject(new Error('Audio engine is not connected - select a device first.'));
    }

    const buffer = new Float32Array(analyser.fftSize);
    const rmsSamples = [];
    const startMs = performance.now();

    return new Promise((resolve) => {
      const tick = () => {
        analyser.getFloatTimeDomainData(buffer);
        rmsSamples.push(analyzeBuffer(buffer).rms);

        const elapsedMs = performance.now() - startMs;
        onProgress?.(Math.min(1, elapsedMs / this._durationMs));

        if (elapsedMs < this._durationMs) {
          requestAnimationFrame(tick);
        } else {
          resolve(this._summarize(rmsSamples));
        }
      };
      tick();
    });
  }

  _summarize(rmsSamples) {
    const sorted = [...rmsSamples].sort((a, b) => a - b);
    // Use the 75th percentile rather than the raw max, so one stray transient (a chair
    // creak, a door) doesn't blow the baseline out - we want *steady-state* room noise.
    const p75 = sorted[Math.floor(sorted.length * 0.75)] ?? 0;
    const meanSquare = rmsSamples.reduce((sum, v) => sum + v * v, 0) / rmsSamples.length;
    const rmsOfRms = Math.sqrt(meanSquare);
    const representativeLinear = Math.max(p75, rmsOfRms);

    const noiseFloorDb = linearToDb(representativeLinear);
    const [lowOffset, highOffset] = GATE_OFFSET_RANGE_DB;

    return {
      noiseFloorDb,
      suggestedGateRangeDb: [noiseFloorDb + lowOffset, noiseFloorDb + highOffset],
      suggestedGateThresholdDb: noiseFloorDb + (lowOffset + highOffset) / 2,
      isRoomTooLoud: noiseFloorDb > ROOM_TOO_LOUD_THRESHOLD_DB,
      sampleCount: rmsSamples.length,
      calibratedAt: new Date().toISOString(),
    };
  }
}

// Small shared math helpers used by the level meter and the noise-floor calibrator.

export const MIN_DB = -60;

/** Converts a linear amplitude (0..1) to dBFS, floored at MIN_DB. */
export function linearToDb(linear) {
  if (linear <= 1e-7) return MIN_DB;
  return Math.max(MIN_DB, 20 * Math.log10(linear));
}

/** RMS + peak of a Float32Array time-domain buffer, both as linear amplitude (0..1). */
export function analyzeBuffer(buffer) {
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < buffer.length; i++) {
    const sample = buffer[i];
    sumSquares += sample * sample;
    const abs = Math.abs(sample);
    if (abs > peak) peak = abs;
  }
  return {
    rms: Math.sqrt(sumSquares / buffer.length),
    peak,
  };
}

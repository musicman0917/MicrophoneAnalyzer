// Broadcast gain-zone classification, mirrored 1:1 from the WPF companion app's
// LevelClassifier.cs so both implementations agree on the same scale:
//   < -24 dB          -> Too Low   (red/orange)
//   -18 dB to -10 dB  -> Sweet Spot (green)
//   > -6 dB           -> Hot / clipping risk (red)
// The two gaps are filled with an amber "approaching" band for a smooth gradient.

import { MIN_DB } from './dsp.js';

export { MIN_DB };

export const TOO_LOW_CEILING = -24;
export const SWEET_SPOT_FLOOR = -18;
export const SWEET_SPOT_CEILING = -10;
export const HOT_FLOOR = -6;

export const ZONES = Object.freeze({
  TOO_LOW: 'tooLow',
  LOW: 'low',
  SWEET_SPOT: 'sweetSpot',
  APPROACHING: 'approaching',
  CLIPPING: 'clipping',
});

export function classify(dbfs) {
  if (dbfs < TOO_LOW_CEILING) return ZONES.TOO_LOW;
  if (dbfs < SWEET_SPOT_FLOOR) return ZONES.LOW;
  if (dbfs <= SWEET_SPOT_CEILING) return ZONES.SWEET_SPOT;
  if (dbfs < HOT_FLOOR) return ZONES.APPROACHING;
  return ZONES.CLIPPING;
}

/**
 * The zone that should actually drive what a user SEES (label/color), combining RMS with
 * peak. RMS alone is the wrong thing to gate clip warnings on: a smoothed average can sit
 * comfortably in "Sweet Spot" while a plosive or transient is genuinely clipping at 0 dBFS+,
 * because a single loud spike barely moves a time-averaged RMS reading. A meter whose entire
 * purpose is "don't clip" has to let peak-over-threshold override the average, the same way
 * real broadcast meters do - so if peak alone has crossed into Hot/Clipping territory, that
 * wins over whatever RMS says. It only ever escalates the displayed zone, never manufactures
 * a false "too quiet" from a loud peak.
 */
export function classifyWithPeak(rmsDb, peakDb) {
  if (peakDb >= HOT_FLOOR) return ZONES.CLIPPING;
  if (peakDb > SWEET_SPOT_CEILING) return ZONES.APPROACHING;
  return classify(rmsDb);
}

const COLORS = {
  [ZONES.TOO_LOW]: '#ff3b30',
  [ZONES.LOW]: '#ff9f0a',
  [ZONES.SWEET_SPOT]: '#30d158',
  [ZONES.APPROACHING]: '#ffd60a',
  [ZONES.CLIPPING]: '#ff3b30',
};

const LABELS = {
  [ZONES.TOO_LOW]: 'TOO LOW',
  [ZONES.LOW]: 'LOW',
  [ZONES.SWEET_SPOT]: 'SWEET SPOT',
  [ZONES.APPROACHING]: 'HOT',
  [ZONES.CLIPPING]: 'CLIPPING!',
};

export function colorFor(zone) {
  return COLORS[zone] ?? '#888888';
}

export function labelFor(zone) {
  return LABELS[zone] ?? '';
}

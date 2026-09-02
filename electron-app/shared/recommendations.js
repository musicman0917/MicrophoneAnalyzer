// Rule-based recommendation engine: turns live level data + (optional) noise-floor
// calibration + the active workflow into concrete OBS filter-chain and hardware-panel
// guidance. Deliberately simple/ordered rules rather than a black box, so the reasoning
// is easy to audit and retune.

import { classify, ZONES } from './levelClassifier.js';
import { HOTSPOT_IDS } from './hotspots.js';

export const WORKFLOWS = Object.freeze({
  RECORDING: 'recording',
  STREAMING: 'streaming',
  DISCORD: 'discord',
});

const DYNAMIC_RANGE_WARNING_DB = 20;

/**
 * @param {{ rmsDb: number, peakDb: number, noiseFloor?: object|null, workflow?: string }} input
 * @returns {Array<{id:string, severity:'info'|'warning'|'critical', title:string, detail:string, obs:string[], hotspots:string[]}>}
 */
export function buildRecommendations({ rmsDb, peakDb, noiseFloor = null, workflow = WORKFLOWS.STREAMING }) {
  const recs = [];
  const zone = classify(rmsDb);

  if (zone === ZONES.TOO_LOW || zone === ZONES.LOW) {
    recs.push({
      id: 'raise-gain',
      severity: zone === ZONES.TOO_LOW ? 'critical' : 'warning',
      title: 'Input level is under-powered',
      detail:
        `RMS is sitting at ${rmsDb.toFixed(1)} dB, below the -18 dB sweet-spot floor. Raise the ` +
        'channel gain trim on the DLZ Creator XS in small steps while talking at your normal ' +
        'level, until the meter settles in the green band - or just use "Set Gain Automatically."',
      obs: [
        "Raise the hardware gain trim before reaching for OBS's Gain filter - analog gain (the " +
          "DLZ's Dynamite preamp) adds far less noise than digital makeup gain.",
      ],
      hotspots: [HOTSPOT_IDS.GAIN_TRIM, HOTSPOT_IDS.SET_GAIN_AUTO],
    });
  }

  if (zone === ZONES.APPROACHING || zone === ZONES.CLIPPING) {
    recs.push({
      id: 'lower-gain',
      severity: zone === ZONES.CLIPPING ? 'critical' : 'warning',
      title: zone === ZONES.CLIPPING ? 'Clipping risk - signal is too hot' : 'Approaching clipping headroom',
      detail:
        `Peak reached ${peakDb.toFixed(1)} dB. Pull the DLZ channel gain trim down until peaks sit ` +
        'comfortably under -6 dB, especially ahead of a loud chorus or a laugh.',
      obs: [
        'Add a Limiter filter in OBS as a safety net (ceiling around -1 dB) - it should rarely ' +
          'engage if the hardware gain is set correctly; treat it as insurance, not your main tool.',
      ],
      hotspots: [HOTSPOT_IDS.GAIN_TRIM],
    });
  }

  if (noiseFloor) {
    recs.push(noiseFloorRecommendation(noiseFloor));
  }

  const dynamicRangeDb = peakDb - rmsDb;
  if (Number.isFinite(dynamicRangeDb) && dynamicRangeDb > DYNAMIC_RANGE_WARNING_DB) {
    recs.push({
      id: 'dynamic-range',
      severity: 'info',
      title: 'Wide dynamic range detected',
      detail:
        'Peaks are landing far above your average level (plosives, laughs, singing dynamics). A ' +
        "compressor will even this out so listeners aren't reaching for the volume knob.",
      obs: [
        'OBS Compressor - Ratio 3:1, Threshold near -18 dB, Attack 10ms, Release 100ms, Output ' +
          'Gain to taste.',
      ],
      hotspots: [HOTSPOT_IDS.TOUCHSCREEN_COMP],
    });
  }

  recs.push(workflowBaseline(workflow));

  return recs;
}

function noiseFloorRecommendation(noiseFloor) {
  const [gateLow, gateHigh] = noiseFloor.suggestedGateRangeDb;

  if (noiseFloor.isRoomTooLoud) {
    return {
      id: 'room-noise',
      severity: 'warning',
      title: `Room noise floor is high (${noiseFloor.noiseFloorDb.toFixed(1)} dB)`,
      detail:
        'Ambient noise (fans, PC, HVAC, room reflections) is elevated enough to fight your gate. ' +
        "Address the room first if you can - no amount of software processing fully substitutes " +
        'for a quieter room.',
      obs: [
        `Noise Gate - Close Threshold ~${gateLow.toFixed(1)} dB, Open Threshold ~${gateHigh.toFixed(1)} dB.`,
        'Consider adding RNNoise-based Noise Suppression on top of the gate for streaming/Discord.',
      ],
      hotspots: [HOTSPOT_IDS.TOUCHSCREEN_GATE, HOTSPOT_IDS.MIC_POSITION],
    };
  }

  return {
    id: 'gate-suggestion',
    severity: 'info',
    title: 'Suggested noise gate threshold',
    detail:
      `Calibrated noise floor is ${noiseFloor.noiseFloorDb.toFixed(1)} dB. Set a gate threshold ` +
      `around ${noiseFloor.suggestedGateThresholdDb.toFixed(1)} dB (${gateLow.toFixed(1)} to ` +
      `${gateHigh.toFixed(1)} dB).`,
    obs: [
      `OBS Noise Gate - Close Threshold ${gateLow.toFixed(1)} dB, Open Threshold ${gateHigh.toFixed(1)} dB, ` +
        'Attack 25ms, Hold 200ms, Release 150ms.',
    ],
    hotspots: [HOTSPOT_IDS.TOUCHSCREEN_GATE],
  };
}

function workflowBaseline(workflow) {
  switch (workflow) {
    case WORKFLOWS.RECORDING:
      return {
        id: 'baseline-recording',
        severity: 'info',
        title: 'Local recording chain baseline',
        detail:
          'Multitrack recording gives you the most post-production headroom - keep processing ' +
          'light at capture time and save the rest for the mix.',
        obs: [
          'High-pass filter around 80-100 Hz to remove desk rumble and plosive thump.',
          'Light compressor (2:1, threshold -18 dB) purely as insurance, not for character.',
          "Save heavier EQ/de-essing for post - don't bake it in.",
        ],
        hotspots: [HOTSPOT_IDS.TOUCHSCREEN_COMP],
      };

    case WORKFLOWS.DISCORD:
      return {
        id: 'baseline-discord',
        severity: 'info',
        title: 'Discord / karaoke chain baseline',
        detail:
          "Prioritize low latency - prefer the DLZ's onboard hardware gate/compressor over OBS " +
          "filters here, since Discord never sees your OBS chain.",
        obs: [
          "Enable the DLZ Creator XS's onboard channel compressor and gate from its touchscreen so " +
            'the processed signal reaches Discord directly.',
          'Keep Discord\'s own noise suppression on "Standard" - "Aggressive" can chew into vocals ' +
            'while singing.',
        ],
        hotspots: [HOTSPOT_IDS.TOUCHSCREEN_GATE, HOTSPOT_IDS.TOUCHSCREEN_COMP],
      };

    case WORKFLOWS.STREAMING:
    default:
      return {
        id: 'baseline-streaming',
        severity: 'info',
        title: 'Live streaming chain baseline',
        detail:
          'Aim for a consistent, broadcast-ready level across the whole stream - viewers set their ' +
          'volume once and expect it to stay put.',
        obs: [
          'Noise Suppression (RNNoise) filter.',
          'Compressor - Ratio 3:1, Threshold -18 dB, Attack 6ms, Release 60ms.',
          'Limiter - Threshold -3 dB as a hard ceiling for Twitch/YouTube loudness consistency.',
        ],
        hotspots: [HOTSPOT_IDS.TOUCHSCREEN_COMP],
      };
  }
}

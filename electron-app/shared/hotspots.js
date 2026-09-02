// Coordinate map for the interactive hardware reference diagram (assets/dlz-front-panel.svg
// or a photo you swap in - see that file's header comment). Positions are fractions (0..1)
// of the diagram's width/height so hotspots stay aligned if the panel is resized.

export const HOTSPOT_IDS = Object.freeze({
  GAIN_TRIM: 'gainTrim',
  TOUCHSCREEN_GATE: 'touchscreenGate',
  TOUCHSCREEN_COMP: 'touchscreenComp',
  HEADPHONE_KNOB: 'headphoneKnob',
  MIC_POSITION: 'micPosition',
});

export const HOTSPOTS = [
  {
    id: HOTSPOT_IDS.GAIN_TRIM,
    xPct: 0.16,
    yPct: 0.24,
    label: 'Channel Gain Trim',
    description:
      'Analog preamp gain for this input, applied before anything digital. Raise it if your ' +
      'level is under-powered; pull it back if you\'re clipping.',
  },
  {
    id: HOTSPOT_IDS.TOUCHSCREEN_GATE,
    xPct: 0.5,
    yPct: 0.55,
    label: 'Touchscreen - Noise Gate / Expander',
    description:
      'Open this channel\'s FX menu on the touchscreen and enable/tune the Gate to cut room ' +
      'noise between phrases.',
  },
  {
    id: HOTSPOT_IDS.TOUCHSCREEN_COMP,
    xPct: 0.5,
    yPct: 0.55,
    label: 'Touchscreen - Compressor',
    description: 'Same FX menu, Compressor tab - evens out dynamics before the signal leaves the box.',
  },
  {
    id: HOTSPOT_IDS.HEADPHONE_KNOB,
    xPct: 0.86,
    yPct: 0.8,
    label: 'Headphone Level',
    description: 'Monitoring volume only - does not affect the signal sent to your recording/stream.',
  },
  {
    id: HOTSPOT_IDS.MIC_POSITION,
    xPct: 0.5,
    yPct: 0.06,
    label: 'Mic Position / Room Treatment',
    description:
      'Not on the DLZ itself - move closer to the DynaCaster\'s capsule or treat the room to ' +
      'improve signal-to-noise ratio.',
  },
];

export function hotspotById(id) {
  return HOTSPOTS.find((h) => h.id === id);
}

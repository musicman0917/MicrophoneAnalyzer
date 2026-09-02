// Coordinate map for the interactive hardware reference diagram. The background image is
// assets/dlz-front-panel.jpg - an actual photo of a DLZ Creator XS - and these are
// fractions (0..1) of that image's width/height, so hotspots stay aligned regardless of
// how large the diagram is rendered.
//
// Positions and the confirmed labels below were read directly off that unit's touchscreen
// in the photo (e.g. "CH1 Input +26dB", "Gate", "Compressor" are literally on screen) -
// not guessed. The one exception is the numbered 1-5 knob cluster: their exact function
// wasn't legible/confirmable from the photo, so that entry is deliberately hedged rather
// than asserted. If you have the manual or know for certain, update CHANNEL_KNOBS below.
//
// If you swap in a different photo (different angle/crop), re-measure these fractions
// against the new image - they won't transfer automatically.

export const HOTSPOT_IDS = Object.freeze({
  GAIN_TRIM: 'gainTrim',
  TOUCHSCREEN_GATE: 'touchscreenGate',
  TOUCHSCREEN_COMP: 'touchscreenComp',
  CHANNEL_KNOBS: 'channelKnobs',
  MIC_POSITION: 'micPosition',
});

export const HOTSPOTS = [
  {
    id: HOTSPOT_IDS.GAIN_TRIM,
    xPct: 0.27,
    yPct: 0.098,
    label: 'Channel Encoder 1 - Input Gain',
    description:
      'Confirmed from the touchscreen readout ("CH1 Input +26dB"): this is the leftmost of ' +
      'the 4 encoders above the screen. It\'s multi-function - the same knob also controls ' +
      'Pan / Reverb Send / Delay Send depending on which column is selected on screen - but ' +
      'Input gain is what it controls by default. Raise it if your level is under-powered, ' +
      'pull it back if you\'re clipping.',
  },
  {
    id: HOTSPOT_IDS.TOUCHSCREEN_GATE,
    xPct: 0.365,
    yPct: 0.478,
    label: 'Touchscreen - Gate',
    description:
      'Confirmed on screen: a "Gate" section exists in the channel FX chain, alongside a ' +
      '-48V phantom power toggle and a Gain slider with "Set Gain Automatically." Open the ' +
      'channel\'s FX menu here to enable/tune the gate.',
  },
  {
    id: HOTSPOT_IDS.TOUCHSCREEN_COMP,
    xPct: 0.365,
    yPct: 0.478,
    label: 'Touchscreen - Compressor',
    description:
      'Confirmed on screen: "Compressor" is one of the FX chain sections (alongside Gate, ' +
      'EQ, and De-Esser). Same touchscreen area as the gate - switch tabs to reach it.',
  },
  {
    id: HOTSPOT_IDS.CHANNEL_KNOBS,
    xPct: 0.566,
    yPct: 0.48,
    label: 'Numbered Knobs 1-5',
    description:
      'Visible on the unit but not confirmed from the photo alone - each has its own LED and ' +
      'a small mute/link button. Likely per-channel volume/mix controls, but treat that as an ' +
      'educated guess, not a confirmed fact, until checked against the manual.',
  },
  {
    id: HOTSPOT_IDS.MIC_POSITION,
    xPct: 0.36,
    yPct: 0.02,
    label: 'Mic Position / Room Treatment',
    description:
      'Not on the DLZ itself - move closer to the DynaCaster\'s capsule or treat the room to ' +
      'improve signal-to-noise ratio.',
  },
];

export function hotspotById(id) {
  return HOTSPOTS.find((h) => h.id === id);
}

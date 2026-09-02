// Coordinate map for the interactive hardware reference diagram. The background image is
// assets/dlz-front-panel.jpg - an actual photo of a DLZ Creator XS - and these are
// fractions (0..1) of that image's width/height, so hotspots stay aligned regardless of
// how large the diagram is rendered.
//
// Every label/description below is sourced, not guessed: either read directly off that
// unit's own touchscreen in the photo (e.g. "CH1 Input +26dB", "Gate", "Compressor" are
// literally on screen), or confirmed against the official DLZ Creator XS Owner's Manual,
// Chapter 3 ("DLZ Creator XS Top Panel Features").
//
// If you swap in a different photo (different unit, angle, or crop), re-measure these
// fractions against the new image - they won't transfer automatically.

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
    label: 'Quick Control Knob 1 - Input Gain',
    description:
      'The manual calls these 4 knobs "Quick Control Knobs": "context-dependent parameters ' +
      'as viewed on the display to the left of them... not assignable or user-customizable, ' +
      'but pre-assigned parameters may be accessed then edited." This leftmost one is on ' +
      'Input gain by default here (screen reads "CH1 Input +26dB") - the same knob also ' +
      'reaches Pan / Reverb Send / Delay Send depending on which column is selected. Raise ' +
      'it if your level is under-powered, pull it back if you\'re clipping.',
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
    label: 'Channel Knobs 1-5',
    description:
      'Per the manual: "The channel knobs adjust the level of each channel going to the ' +
      'selected output(s)" - a mix/output fader, not input gain. Each has a paired Solo ' +
      'button (illuminates amber) and Mute button (illuminates red) above it, matching the ' +
      'amber/red buttons visible here. Not part of gain staging - leave these alone when ' +
      'chasing a level problem; that\'s the Quick Control Knob\'s job.',
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

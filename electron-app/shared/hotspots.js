// Coordinate map for the interactive hardware reference diagram. The background image is
// assets/dlz-front-panel.jpg - an actual photo of a DLZ Creator XS - and these are
// fractions (0..1) of that image's width/height, so hotspots stay aligned regardless of
// how large the diagram is rendered.
//
// Every label/description/step below is sourced, not guessed: read directly off that
// unit's own touchscreen in the photo, or quoted/paraphrased from the official DLZ
// Creator XS Owner's Manual (Chapters 3 and 6). `steps` are numbered tap sequences for
// hotspots that live on the touchscreen; `screenshot` points at an actual screen capture
// extracted from the manual's own PDF (assets/manual/) - the manual's own illustration of
// that menu, not a mockup. Treat those screenshots as "here's what that menu contains and
// how to reach it," not a guarantee of pixel-identical match to your unit's current screen
// state (firmware UI can move on from what a manual was written against).
//
// If you swap in a different photo (different unit, angle, or crop), re-measure these
// fractions against the new image - they won't transfer automatically.

export const HOTSPOT_IDS = Object.freeze({
  GAIN_TRIM: 'gainTrim',
  PHANTOM_POWER: 'phantomPower',
  SET_GAIN_AUTO: 'setGainAuto',
  TOUCHSCREEN_GATE: 'touchscreenGate',
  TOUCHSCREEN_COMP: 'touchscreenComp',
  CHANNEL_KNOBS: 'channelKnobs',
  SOLO_MUTE: 'soloMute',
  SAMPLE_PADS: 'samplePads',
  HOME_REC_AUTOMIX: 'homeRecAutomix',
  MIC_POSITION: 'micPosition',
});

// These four all live on the touchscreen, but on different sub-tabs shown at different
// times - not four simultaneous buttons in these exact spots. They're spread across the
// screen's bounding box (x 0.245-0.475, y 0.17-0.79) purely so each is independently
// clickable in this UI; treat their position as "somewhere on this touchscreen," not a
// pixel-accurate button location, and use the linked screenshot to see the real layout.
const PHANTOM_POWER_XY = { xPct: 0.3, yPct: 0.3 };
const SET_GAIN_AUTO_XY = { xPct: 0.3, yPct: 0.5 };
const TOUCHSCREEN_GATE_XY = { xPct: 0.42, yPct: 0.3 };
const TOUCHSCREEN_COMP_XY = { xPct: 0.42, yPct: 0.5 };

export const HOTSPOTS = [
  {
    id: HOTSPOT_IDS.GAIN_TRIM,
    xPct: 0.27,
    yPct: 0.098,
    label: 'Quick Control Knob 1 - Input Gain',
    description:
      'The manual calls these 4 knobs "Quick Control Knobs": "context-dependent parameters ' +
      'as viewed on the display to the left of them." This leftmost one is on Input gain by ' +
      'default (screen reads "CH1 Input +26dB") - the same knob also reaches Pan / Reverb ' +
      'Send / Delay Send depending on which column is selected.',
    steps: [
      'Tap "Channel" in the top navigation bar, then tap the channel\'s ID (e.g. "CH 1").',
      'Make sure "Setup" is the selected sub-tab (leftmost of Setup / EQ / Gate / Compressor / De-Esser).',
      'Rotate Quick Control Knob 1, or tap-and-drag the on-screen Gain slider.',
    ],
    screenshot: '../../assets/manual/gain-setup-screen.png',
  },
  {
    id: HOTSPOT_IDS.PHANTOM_POWER,
    ...PHANTOM_POWER_XY,
    label: 'Touchscreen - +48V Phantom Power',
    description:
      'On the Setup sub-tab, shown as "+48V" with a lightning-bolt icon (see screenshot). ' +
      'Your sE DynaCaster is a dynamic mic, but its onboard Dynamite preamp is active ' +
      'circuitry that still needs 48V phantom power to run - don\'t assume "dynamic = skip ' +
      'this" for this particular mic. Manual warning: turn the main mix and headphone ' +
      'levels down first, to prevent pops.',
    steps: [
      'Tap "Channel" → select the channel → "Setup" sub-tab.',
      'Tap the +48V switch so it illuminates orange.',
    ],
    screenshot: '../../assets/manual/gain-setup-screen.png',
  },
  {
    id: HOTSPOT_IDS.SET_GAIN_AUTO,
    ...SET_GAIN_AUTO_XY,
    label: 'Touchscreen - Set Gain Automatically',
    description:
      'Quoted from the manual: tap it, it illuminates green and reads "Listening...". Speak ' +
      'into the mic at your normal volume, continuously, until it briefly flashes "Level Set!" ' +
      'and reverts to "Set Gain Automatically." A fast way to get in the neighborhood before ' +
      'fine-tuning with Quick Control Knob 1.',
    screenshot: '../../assets/manual/gain-setup-screen.png',
  },
  {
    id: HOTSPOT_IDS.TOUCHSCREEN_GATE,
    ...TOUCHSCREEN_GATE_XY,
    label: 'Touchscreen - Gate',
    description:
      'Manual defaults ("Gate at a Glance"): Threshold -45 dB, Range -19 dB, Attack 19 ms, ' +
      'Release 92 ms, Hold 50 ms. Threshold range is -60 to 0 dB.',
    steps: [
      'Tap "Channel" → select channel → "Gate" sub-tab (highlights cyan).',
      'Tap the Gate toggle to turn it on (illuminates cyan).',
      'Drag the T (threshold) / R (range) points on the graph, or rotate the 4 Quick Control ' +
        'Knobs - their base color matches the gate\'s cyan while this tab is open.',
      'Hold is only adjustable by dragging the vertical HOLD slider on the right.',
    ],
    screenshot: '../../assets/manual/gate-screen.png',
  },
  {
    id: HOTSPOT_IDS.TOUCHSCREEN_COMP,
    ...TOUCHSCREEN_COMP_XY,
    label: 'Touchscreen - Compressor',
    description:
      'Manual defaults ("Compressor at a Glance"): Threshold -30 dB, Ratio 2:1, Gain +1 dB, ' +
      'Attack 42 ms, Release 500 ms, Knee Soft. Ratio range is 1:1 to 20:1.',
    steps: [
      'Tap "Channel" → select channel → "Compressor" sub-tab (highlights purple).',
      'Tap the Comp toggle to turn it on (illuminates purple).',
      'Drag the G (make-up gain) / T (threshold) / R (ratio) points on the graph, or rotate ' +
        'the 4 Quick Control Knobs.',
      'Make-up gain is only adjustable via the vertical GAIN slider on the right.',
    ],
    screenshot: '../../assets/manual/compressor-screen.png',
  },
  {
    id: HOTSPOT_IDS.CHANNEL_KNOBS,
    xPct: 0.566,
    yPct: 0.48,
    label: 'Channel Knobs 1-5',
    description:
      'Per the manual: "The channel knobs adjust the level of each channel going to the ' +
      'selected output(s)" - a mix/output fader, not input gain. Not part of gain staging - ' +
      'leave these alone when chasing a level problem; that\'s Quick Control Knob 1\'s job.',
  },
  {
    id: HOTSPOT_IDS.SOLO_MUTE,
    xPct: 0.525,
    yPct: 0.47,
    label: 'Solo / Mute Buttons',
    description:
      'Paired with each channel knob. Per the manual: Mute "illuminate[s] red when engaged" ' +
      'and turns the channel off entirely. Solo "illuminate[s] amber when engaged" and, while ' +
      'any channel is soloed, only soloed channel(s) are heard in headphone output 1 - ' +
      'useful for auditioning one input in isolation before it\'s in the live mix.',
  },
  {
    id: HOTSPOT_IDS.SAMPLE_PADS,
    xPct: 0.585,
    yPct: 0.09,
    label: 'Six Sample Pads',
    description:
      'Per the manual: pressing one plays its assigned sample, illuminating brightly during ' +
      'playback and dimly when idle (unlit if nothing is assigned). 8 banks x 6 pads = 48 ' +
      'sample slots total. Unrelated to gain staging - a production/karaoke tool, not a fix.',
  },
  {
    id: HOTSPOT_IDS.HOME_REC_AUTOMIX,
    xPct: 0.57,
    yPct: 0.83,
    label: 'Home / Rec / AutoMix',
    description:
      'Home returns to the Overview screen. Rec: a quick press starts/stops onboard recording; ' +
      'a 2-second hold pauses it - it illuminates and pulses red while recording. AutoMix ' +
      '"shares gain between microphone channels based on the selected priority value" - ' +
      'useful for a host+guest setup, but it\'s a mixing convenience, not a fix for a bad ' +
      'gain-staging problem on any individual channel.',
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

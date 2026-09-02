import { classifyWithPeak, colorFor, labelFor, MIN_DB } from '../../shared/levelClassifier.js';
import { buildRecommendations, WORKFLOWS } from '../../shared/recommendations.js';
import { DEFAULT_CALIBRATION_DURATION_MS } from '../../shared/noiseFloor.js';
import { HOTSPOTS } from '../../shared/hotspots.js';

const STORAGE_KEY = 'mic-hud-control-v1';
const RECOMMENDATION_REFRESH_MS = 1000;

const dom = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  liveDb: document.getElementById('liveDb'),
  liveZone: document.getElementById('liveZone'),
  workflowSelect: document.getElementById('workflowSelect'),

  deviceSelect: document.getElementById('deviceSelect'),
  channelSelect: document.getElementById('channelSelect'),
  refreshDevicesBtn: document.getElementById('refreshDevicesBtn'),
  connectBtn: document.getElementById('connectBtn'),
  deviceError: document.getElementById('deviceError'),
  downmixWarning: document.getElementById('downmixWarning'),

  calibrateBtn: document.getElementById('calibrateBtn'),
  calibrationProgress: document.getElementById('calibrationProgress'),
  calibrationProgressFill: document.getElementById('calibrationProgressFill'),
  calibrationResult: document.getElementById('calibrationResult'),
  resultNoiseFloor: document.getElementById('resultNoiseFloor'),
  resultGateThreshold: document.getElementById('resultGateThreshold'),
  resultGateRange: document.getElementById('resultGateRange'),
  resultAlert: document.getElementById('resultAlert'),

  recommendationsList: document.getElementById('recommendationsList'),

  hotspotLayer: document.getElementById('hotspotLayer'),
  hotspotTooltip: document.getElementById('hotspotTooltip'),
  hotspotDetail: document.getElementById('hotspotDetail'),
};

const state = {
  devices: [],
  latestLevels: { rmsDb: MIN_DB, peakDb: MIN_DB, peakHoldDb: MIN_DB },
  latestNoiseFloor: loadNoiseFloor(),
  workflow: loadWorkflow(),
  connected: false,
  lastStatus: null,
};

const hotspotElements = new Map();

initTabs();
initWorkflowPicker();
initDeviceTab();
initCalibrationTab();
initHardwareTab();
wireLiveUpdates();

renderCalibrationResult(state.latestNoiseFloor);
renderRecommendations();
setInterval(renderRecommendations, RECOMMENDATION_REFRESH_MS);

window.controlApi.getStatus().then(applyStatus);

// --- Tabs ---

function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

// --- Workflow ---

function initWorkflowPicker() {
  dom.workflowSelect.value = state.workflow;
  dom.workflowSelect.addEventListener('change', () => {
    state.workflow = dom.workflowSelect.value;
    saveWorkflow(state.workflow);
    renderRecommendations();
  });
}

function loadWorkflow() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').workflow ?? WORKFLOWS.STREAMING;
  } catch {
    return WORKFLOWS.STREAMING;
  }
}

function saveWorkflow(workflow) {
  const existing = safeParse(localStorage.getItem(STORAGE_KEY)) ?? {};
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...existing, workflow }));
}

// --- Devices ---

function initDeviceTab() {
  dom.refreshDevicesBtn.addEventListener('click', () => loadDevices());
  dom.deviceSelect.addEventListener('change', populateChannelOptions);
  dom.connectBtn.addEventListener('click', onConnectClick);
  loadDevices();
}

async function loadDevices() {
  dom.deviceError.hidden = true;
  try {
    state.devices = await listAudioInputDevices();
    dom.deviceSelect.innerHTML = '';
    for (const device of state.devices) {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label;
      dom.deviceSelect.appendChild(option);
    }
    populateChannelOptions();
    // The initial status may have arrived before the device list did, in which case the
    // downmix check had nothing to compare against - re-run it now that it does.
    if (state.lastStatus) applyStatus(state.lastStatus);
  } catch (err) {
    dom.deviceError.hidden = false;
    dom.deviceError.textContent = `Could not list devices: ${err.message}`;
  }
}

/** Unlocks device labels via a throwaway permission grant, then enumerates with channel caps. */
async function listAudioInputDevices() {
  const temp = await navigator.mediaDevices.getUserMedia({ audio: true });
  temp.getTracks().forEach((t) => t.stop());
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label || 'Microphone',
      // InputDeviceInfo.getCapabilities() is Chromium-specific and only meaningful once
      // permission has been granted; it's the closest the Web Audio API gets to telling
      // us how many channels a device can offer before we actually open a stream.
      maxChannels: d.getCapabilities?.().channelCount?.max ?? 2,
    }));
}

function populateChannelOptions() {
  const device = state.devices.find((d) => d.deviceId === dom.deviceSelect.value);
  const channelCount = Math.max(1, device?.maxChannels ?? 2);
  dom.channelSelect.innerHTML = '';
  for (let i = 0; i < channelCount; i++) {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = `Channel ${i + 1}`;
    dom.channelSelect.appendChild(option);
  }
}

async function onConnectClick() {
  const deviceId = dom.deviceSelect.value;
  const channelIndex = Number(dom.channelSelect.value || 0);
  if (!deviceId) return;

  dom.connectBtn.disabled = true;
  dom.deviceError.hidden = true;
  try {
    await window.controlApi.selectDevice({ deviceId, channelIndex });
  } finally {
    dom.connectBtn.disabled = false;
  }
}

// --- Status + live levels ---

function wireLiveUpdates() {
  window.controlApi.onStatusUpdate(applyStatus);
  window.controlApi.onLevelUpdate((levels) => {
    state.latestLevels = levels;
    updateLiveReadout(levels);
  });
}

function applyStatus(status) {
  state.lastStatus = status;
  state.connected = !!status?.connected;
  dom.statusDot.classList.toggle('connected', state.connected);

  if (state.connected) {
    const device = state.devices.find((d) => d.deviceId === status.deviceId);
    const label = device?.label ?? 'input device';
    dom.statusText.textContent = `Connected - ${label}, channel ${((status.channelIndex ?? 0) + 1)} of ${status.channelCount ?? '?'}`;
    updateDownmixWarning(device, status.channelCount);
  } else if (status?.error) {
    dom.statusText.textContent = `Disconnected - ${status.error}`;
    dom.downmixWarning.hidden = true;
  } else {
    dom.statusText.textContent = 'Not connected';
    dom.downmixWarning.hidden = true;
  }
}

/**
 * If Chromium granted fewer channels than the device actually advertises, the stream we're
 * analyzing is very likely a downmix (summed/averaged) rather than a true single-channel
 * passthrough - which can make the meter read noticeably LOWER than the real analog signal.
 * That's the dangerous failure mode: it looks like "everything's fine, sweet spot" here while
 * the DLZ's own preamp could already be driven into real clipping, because the user (correctly,
 * given what this app is showing) keeps raising analog gain to chase a meter that can't reach
 * green at the true level.
 */
function updateDownmixWarning(device, grantedChannels) {
  const maxChannels = device?.maxChannels ?? 0;
  if (!grantedChannels || !maxChannels || grantedChannels >= maxChannels) {
    dom.downmixWarning.hidden = true;
    return;
  }

  dom.downmixWarning.hidden = false;
  dom.downmixWarning.textContent =
    `Only ${grantedChannels} of ${maxChannels} channels were granted for this device - the ` +
    'signal you\'re seeing here is very likely a downmix, not a true single-channel feed, and ' +
    'may read LOWER than the real analog level. If you find yourself raising gain far more than ' +
    'expected to reach the green zone, stop and check the DLZ Creator XS\'s own touchscreen ' +
    'input meter instead - it\'s unaffected by this and is the ground truth for whether you\'re ' +
    'actually clipping. Don\'t chase this app\'s meter into the green at the cost of visibly ' +
    'peaking on the hardware\'s own meter.';
}

function updateLiveReadout(levels) {
  if (!state.connected) {
    dom.liveDb.textContent = '-- dB';
    dom.liveZone.textContent = 'NO SIGNAL';
    dom.liveZone.style.color = '#888';
    return;
  }
  dom.liveDb.textContent = levels.rmsDb <= MIN_DB + 0.5 ? '-∞ dB' : `${levels.rmsDb.toFixed(1)} dB`;
  // Peak overrides RMS here for the same reason as the HUD - see classifyWithPeak's doc comment.
  const zone = classifyWithPeak(levels.rmsDb, levels.peakHoldDb);
  dom.liveZone.textContent = labelFor(zone);
  dom.liveZone.style.color = colorFor(zone);
}

// --- Noise floor calibration ---

function initCalibrationTab() {
  dom.calibrateBtn.addEventListener('click', onCalibrateClick);
  window.controlApi.onCalibrationResult((result) => {
    stopProgressAnimation();
    if (result?.error) {
      showCalibrationError(result.error);
      return;
    }
    state.latestNoiseFloor = result;
    saveNoiseFloor(result);
    renderCalibrationResult(result);
    renderRecommendations();
  });
}

async function onCalibrateClick() {
  dom.calibrateBtn.disabled = true;
  startProgressAnimation();
  try {
    await window.controlApi.runCalibration();
    // UI is updated by the onCalibrationResult broadcast above, which fires for every
    // trigger source (this button, the HUD's own button, or the global hotkey).
  } catch (err) {
    stopProgressAnimation();
    showCalibrationError(err.message);
  } finally {
    dom.calibrateBtn.disabled = false;
  }
}

function startProgressAnimation() {
  dom.calibrationProgress.hidden = false;
  dom.calibrationProgressFill.style.transition = 'none';
  dom.calibrationProgressFill.style.width = '0%';
  // Force reflow so the transition below actually animates from 0%.
  void dom.calibrationProgressFill.offsetWidth;
  dom.calibrationProgressFill.style.transition = `width ${DEFAULT_CALIBRATION_DURATION_MS}ms linear`;
  dom.calibrationProgressFill.style.width = '92%'; // approximate - true completion snaps to 100%
}

function stopProgressAnimation() {
  dom.calibrationProgressFill.style.transition = 'width 0.15s ease';
  dom.calibrationProgressFill.style.width = '100%';
  setTimeout(() => {
    dom.calibrationProgress.hidden = true;
  }, 400);
}

function showCalibrationError(message) {
  dom.calibrationResult.hidden = false;
  dom.resultAlert.hidden = false;
  dom.resultAlert.textContent = `Calibration failed: ${message}`;
}

function renderCalibrationResult(result) {
  if (!result) return;
  dom.calibrationResult.hidden = false;
  dom.resultNoiseFloor.textContent = `${result.noiseFloorDb.toFixed(1)} dB`;
  dom.resultGateThreshold.textContent = `${result.suggestedGateThresholdDb.toFixed(1)} dB`;
  dom.resultGateRange.textContent =
    `${result.suggestedGateRangeDb[0].toFixed(1)} to ${result.suggestedGateRangeDb[1].toFixed(1)} dB`;

  if (result.isRoomTooLoud) {
    dom.resultAlert.hidden = false;
    dom.resultAlert.textContent =
      'Room noise floor is high for broadcast use - treat the room if you can before relying on a gate alone.';
  } else {
    dom.resultAlert.hidden = true;
  }
}

function loadNoiseFloor() {
  return safeParse(localStorage.getItem(STORAGE_KEY))?.noiseFloor ?? null;
}

function saveNoiseFloor(result) {
  const existing = safeParse(localStorage.getItem(STORAGE_KEY)) ?? {};
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...existing, noiseFloor: result }));
}

// --- Recommendations ---

function renderRecommendations() {
  dom.recommendationsList.innerHTML = '';

  if (!state.connected) {
    dom.recommendationsList.innerHTML = '<p class="empty-state">Connect a device on the Devices tab to see live recommendations.</p>';
    updateHotspotGlow([]);
    return;
  }

  const recs = buildRecommendations({
    rmsDb: state.latestLevels.rmsDb,
    // peakHoldDb (decaying, not instantaneous) so a transient clip between our 1s refreshes
    // isn't missed - see the param doc on buildRecommendations for why this matters.
    peakDb: state.latestLevels.peakHoldDb,
    noiseFloor: state.latestNoiseFloor,
    workflow: state.workflow,
  });

  for (const rec of recs) {
    const card = document.createElement('div');
    card.className = `rec-card severity-${rec.severity}`;

    const title = document.createElement('div');
    title.className = 'rec-title';
    title.textContent = rec.title;

    const detail = document.createElement('div');
    detail.className = 'rec-detail';
    detail.textContent = rec.detail;

    const obsList = document.createElement('ul');
    obsList.className = 'rec-obs-list';
    for (const line of rec.obs) {
      const li = document.createElement('li');
      li.textContent = line;
      obsList.appendChild(li);
    }

    card.append(title, detail, obsList);
    dom.recommendationsList.appendChild(card);
  }

  updateHotspotGlow(recs);
}

// --- Hardware reference diagram ---

function initHardwareTab() {
  for (const hotspot of HOTSPOTS) {
    const el = document.createElement('div');
    el.className = 'hotspot';
    el.style.left = `${hotspot.xPct * 100}%`;
    el.style.top = `${hotspot.yPct * 100}%`;
    el.dataset.id = hotspot.id;

    el.addEventListener('mouseenter', (e) => showTooltip(hotspot, e));
    el.addEventListener('mousemove', (e) => positionTooltip(e));
    el.addEventListener('mouseleave', hideTooltip);
    el.addEventListener('click', () => selectHotspot(hotspot));

    dom.hotspotLayer.appendChild(el);
    hotspotElements.set(hotspot.id, el);
  }
}

function showTooltip(hotspot, event) {
  dom.hotspotTooltip.hidden = false;
  dom.hotspotTooltip.innerHTML = `<strong>${hotspot.label}</strong>Click for the full tap sequence.`;
  positionTooltip(event);
}

function positionTooltip(event) {
  const offset = 14;
  dom.hotspotTooltip.style.left = `${event.clientX + offset}px`;
  dom.hotspotTooltip.style.top = `${event.clientY + offset}px`;
}

function hideTooltip() {
  dom.hotspotTooltip.hidden = true;
}

function selectHotspot(hotspot) {
  for (const el of hotspotElements.values()) el.classList.remove('selected');
  hotspotElements.get(hotspot.id)?.classList.add('selected');

  dom.hotspotDetail.innerHTML = '';

  const label = document.createElement('h3');
  label.className = 'hotspot-detail-label';
  label.textContent = hotspot.label;
  dom.hotspotDetail.appendChild(label);

  const description = document.createElement('p');
  description.className = 'hotspot-detail-description';
  description.textContent = hotspot.description;
  dom.hotspotDetail.appendChild(description);

  if (hotspot.steps?.length) {
    const stepsList = document.createElement('ol');
    stepsList.className = 'hotspot-detail-steps';
    for (const step of hotspot.steps) {
      const li = document.createElement('li');
      li.textContent = step;
      stepsList.appendChild(li);
    }
    dom.hotspotDetail.appendChild(stepsList);
  }

  if (hotspot.screenshot) {
    const wrap = document.createElement('div');
    wrap.className = 'hotspot-detail-screenshot-wrap';

    const caption = document.createElement('p');
    caption.className = 'hotspot-detail-screenshot-caption';
    caption.textContent = "From the official DLZ Creator XS Owner's Manual:";
    wrap.appendChild(caption);

    const img = document.createElement('img');
    img.className = 'hotspot-detail-screenshot';
    img.src = hotspot.screenshot;
    img.alt = `${hotspot.label} - manual screenshot`;
    wrap.appendChild(img);

    dom.hotspotDetail.appendChild(wrap);
  }
}

const SEVERITY_GLOW_COLOR = {
  critical: 'rgba(255, 59, 48, 0.6)',
  warning: 'rgba(255, 159, 10, 0.55)',
  info: 'rgba(100, 210, 255, 0.5)',
};

function updateHotspotGlow(recommendations) {
  const glowByHotspot = new Map();
  const severityRank = { critical: 3, warning: 2, info: 1 };

  for (const rec of recommendations) {
    for (const hotspotId of rec.hotspots) {
      const current = glowByHotspot.get(hotspotId);
      if (!current || severityRank[rec.severity] > severityRank[current]) {
        glowByHotspot.set(hotspotId, rec.severity);
      }
    }
  }

  for (const [id, el] of hotspotElements) {
    const severity = glowByHotspot.get(id);
    el.classList.toggle('active', !!severity);
    el.style.setProperty('--glow-color', severity ? SEVERITY_GLOW_COLOR[severity] : '');
  }
}

// --- Utilities ---

function safeParse(json) {
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

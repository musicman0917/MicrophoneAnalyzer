import { AudioEngine } from '../../shared/audioEngine.js';
import { classify, classifyWithPeak, colorFor, labelFor, MIN_DB } from '../../shared/levelClassifier.js';
import { NoiseFloorCalibrator } from '../../shared/noiseFloor.js';

const STORAGE_KEY = 'mic-hud-settings-v1';
const SEGMENT_COUNT = 28;
const MAX_DB = 0;
const GAP_RATIO = 0.22;

const panel = document.getElementById('panel');
const canvas = document.getElementById('meterCanvas');
const ctx = canvas.getContext('2d');
const dbReadoutEl = document.getElementById('dbReadout');
const zoneLabelEl = document.getElementById('zoneLabel');
const calibrationStatusEl = document.getElementById('calibrationStatus');
const downmixWarningEl = document.getElementById('downmixWarning');
const deviceHintEl = document.getElementById('deviceHint');

const engine = new AudioEngine();
const calibrator = new NoiseFloorCalibrator(() => engine.getAnalyserNode());

let orientation = 'vertical';
let currentDeviceId = null;
let currentChannelIndex = 0;
let alwaysOnTop = true;

loadSettings();
wireButtons();
wireIpc();
applyAlwaysOnTop();
resizeCanvasForDpr();
window.addEventListener('resize', resizeCanvasForDpr);

// Forwarded on the engine's own analysis cadence (setInterval-driven, see audioEngine.js)
// rather than from the canvas rAF loop below, so Control Center keeps getting live levels
// even while the HUD itself is hidden via the tray menu.
engine.addEventListener('level', (event) => {
  window.hudApi.sendLevelUpdate(event.detail);
});

if (currentDeviceId) {
  connect(currentDeviceId, currentChannelIndex).catch((err) => showConnectError(err));
} else {
  setDeviceHintVisible(true);
}

requestAnimationFrame(renderLoop);

// --- Setup helpers ---

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    currentDeviceId = saved.deviceId ?? null;
    currentChannelIndex = saved.channelIndex ?? 0;
    orientation = saved.orientation === 'horizontal' ? 'horizontal' : 'vertical';
    alwaysOnTop = saved.alwaysOnTop ?? true;
    applyOrientation();
  } catch {
    // Corrupt/legacy settings blob - ignore and start fresh.
  }
}

function saveSettings() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ deviceId: currentDeviceId, channelIndex: currentChannelIndex, orientation, alwaysOnTop }),
  );
}

function wireButtons() {
  document.getElementById('closeBtn').addEventListener('click', () => window.hudApi.quit());
  document.getElementById('settingsBtn').addEventListener('click', () => window.hudApi.openControlCenter());
  document.getElementById('openDevicesBtn').addEventListener('click', () => window.hudApi.openControlCenter());
  document.getElementById('calibrateBtn').addEventListener('click', () => {
    window.hudApi.runCalibration().catch((err) => flashCalibrationStatus(`Error: ${err.message}`, true));
  });
  document.getElementById('pinBtn').addEventListener('click', () => {
    alwaysOnTop = !alwaysOnTop;
    applyAlwaysOnTop();
    saveSettings();
  });
}

function applyAlwaysOnTop() {
  document.getElementById('pinBtn').classList.toggle('active', alwaysOnTop);
  window.hudApi.setAlwaysOnTop(alwaysOnTop);
}

function wireIpc() {
  window.hudApi.onDeviceSelect(({ deviceId, channelIndex }) => {
    const newChannelIndex = channelIndex ?? 0;

    // Same device, different channel: just re-point the analyser rather than tearing down
    // and re-requesting the whole getUserMedia stream (avoids a visible permission/stream
    // re-negotiation flicker for what's really just a channel swap).
    if (engine.isRunning && deviceId === currentDeviceId) {
      currentChannelIndex = newChannelIndex;
      saveSettings();
      engine.setChannel(newChannelIndex);
      window.hudApi.sendStatus({ connected: true, deviceId, channelIndex: newChannelIndex, channelCount: engine.channelCount });
      return;
    }

    currentDeviceId = deviceId;
    currentChannelIndex = newChannelIndex;
    saveSettings();
    connect(deviceId, currentChannelIndex).catch((err) => showConnectError(err));
  });

  window.hudApi.onCalibrationStart(async () => {
    flashCalibrationStatus('Calibrating - stay silent...', false);
    try {
      const result = await calibrator.run((progress) => {
        calibrationStatusEl.textContent = `Calibrating... ${Math.round(progress * 100)}%`;
      });
      flashCalibrationStatus(`Noise floor: ${result.noiseFloorDb.toFixed(1)} dB`, false, 3000);
      window.hudApi.sendCalibrationResult(result);
    } catch (err) {
      flashCalibrationStatus(`Error: ${err.message}`, true, 3000);
      window.hudApi.sendCalibrationResult({ error: err.message });
    }
  });
}

async function connect(deviceId, channelIndex) {
  try {
    const { channelCount } = await engine.start(deviceId, channelIndex, 8);
    setDeviceHintVisible(false);
    window.hudApi.sendStatus({ connected: true, deviceId, channelIndex, channelCount });
    checkDownmixWarning(deviceId, channelCount);
  } catch (err) {
    window.hudApi.sendStatus({ connected: false, error: err.message });
    throw err;
  }
}

/**
 * If Chromium granted fewer channels than the device itself advertises, the analyzed stream
 * is very likely a downmix - which can make this meter read lower than the true analog
 * signal, tempting heavy over-gain that clips for real on the hardware while this app still
 * looks fine. See the matching check/comment in control.js for the full explanation.
 */
async function checkDownmixWarning(deviceId, grantedChannels) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const device = devices.find((d) => d.deviceId === deviceId && d.kind === 'audioinput');
    const maxChannels = device?.getCapabilities?.().channelCount?.max ?? 0;
    downmixWarningEl.hidden = !(maxChannels && grantedChannels < maxChannels);
  } catch {
    downmixWarningEl.hidden = true;
  }
}

function showConnectError(err) {
  deviceHintEl.textContent = `Capture failed: ${err.message} - `;
  const btn = document.createElement('button');
  btn.className = 'link-button';
  btn.textContent = 'pick another device';
  btn.addEventListener('click', () => window.hudApi.openControlCenter());
  deviceHintEl.appendChild(btn);
  setDeviceHintVisible(true);
}

function setDeviceHintVisible(visible) {
  deviceHintEl.style.display = visible ? 'block' : 'none';
}

function flashCalibrationStatus(text, isError, autoHideMs) {
  calibrationStatusEl.hidden = false;
  calibrationStatusEl.textContent = text;
  calibrationStatusEl.style.color = isError ? '#ff3b30' : '#ffd60a';
  if (autoHideMs) {
    setTimeout(() => {
      calibrationStatusEl.hidden = true;
    }, autoHideMs);
  }
}

function applyOrientation() {
  panel.classList.toggle('horizontal', orientation === 'horizontal');
  const size = orientation === 'horizontal' ? { width: 460, height: 150 } : { width: 190, height: 480 };
  window.hudApi.resizeWindow(size);
  resizeCanvasForDpr();
}

// --- Meter rendering ---

function resizeCanvasForDpr() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function renderLoop() {
  const { rmsDb, peakHoldDb } = engine.isRunning ? engine.getLevels() : { rmsDb: MIN_DB, peakHoldDb: MIN_DB };
  drawMeter(rmsDb, peakHoldDb);
  updateReadout(rmsDb, peakHoldDb);
  requestAnimationFrame(renderLoop);
}

function updateReadout(rmsDb, peakHoldDb) {
  if (!engine.isRunning) {
    dbReadoutEl.textContent = '-- dB';
    zoneLabelEl.textContent = 'NO SIGNAL';
    zoneLabelEl.style.color = '#888';
    return;
  }

  dbReadoutEl.textContent = rmsDb <= MIN_DB + 0.5 ? '-∞ dB' : `${rmsDb.toFixed(1)} dB`;
  // Peak (held briefly so a real clip is actually visible, not a single vanishing frame)
  // overrides RMS here - RMS alone can read "Sweet Spot" while a peak is genuinely clipping.
  const zone = classifyWithPeak(rmsDb, peakHoldDb);
  zoneLabelEl.textContent = labelFor(zone);
  zoneLabelEl.style.color = colorFor(zone);
}

function drawMeter(rmsDb, peakHoldDb) {
  const cssWidth = canvas.getBoundingClientRect().width;
  const cssHeight = canvas.getBoundingClientRect().height;
  if (cssWidth <= 0 || cssHeight <= 0) return;

  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const vertical = orientation === 'vertical';
  const totalLength = vertical ? cssHeight : cssWidth;
  const thickness = vertical ? cssWidth : cssHeight;
  const segLength = totalLength / SEGMENT_COUNT;
  const gap = segLength * GAP_RATIO;
  const segSize = Math.max(1, segLength - gap);

  const litCount = dbToSegmentIndex(rmsDb);
  const peakSegment = Math.min(SEGMENT_COUNT - 1, Math.max(0, dbToSegmentIndex(peakHoldDb) - 1));

  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const segDbLow = MIN_DB + ((MAX_DB - MIN_DB) * i) / SEGMENT_COUNT;
    const zone = classify(segDbLow);
    const baseColor = colorFor(zone);
    const lit = i < litCount;

    let x, y, w, h;
    if (vertical) {
      x = 0;
      y = cssHeight - (i + 1) * segLength + gap / 2;
      w = thickness;
      h = segSize;
    } else {
      x = i * segLength + gap / 2;
      y = 0;
      w = segSize;
      h = thickness;
    }

    ctx.globalAlpha = lit ? 1 : 0.16;
    ctx.fillStyle = baseColor;
    ctx.fillRect(x, y, w, h);

    if (i === peakSegment) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.25;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
  }
  ctx.globalAlpha = 1;
}

function dbToSegmentIndex(db) {
  const normalized = (db - MIN_DB) / (MAX_DB - MIN_DB);
  return Math.min(SEGMENT_COUNT, Math.max(0, Math.round(normalized * SEGMENT_COUNT)));
}

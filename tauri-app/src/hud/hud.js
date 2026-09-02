import { invoke, listen } from '../shared/tauriApi.js';
import { classify, classifyWithPeak, colorFor, labelFor, MIN_DB } from '../shared/levelClassifier.js';

// Unlike the Electron version, the audio engine lives entirely in Rust (see src-tauri/src/
// audio.rs) as global state reachable from either window - there's no "only the HUD can
// touch the mic stream" constraint here, so device selection, calibration, etc. can all be
// triggered from either window via a plain invoke() call. This file just reflects live
// state (level-update/status-update events) and owns its own small local settings.

const STORAGE_KEY = 'mic-hud-settings-v1';
const SEGMENT_COUNT = 28;
const MAX_DB = 0;
const GAP_RATIO = 0.22;

// Two-range visual scale for the bar - see the Electron app's matching comment for the
// full reasoning (a single linear floor can't avoid both "wall of red at a healthy level"
// and "bar goes dead-empty when quiet" at once).
const DEEP_FLOOR_DB = MIN_DB;
const ACTIONABLE_FLOOR_DB = -30;
const COMPRESSED_SEGMENTS = 4;
const ACTIONABLE_SEGMENTS = SEGMENT_COUNT - COMPRESSED_SEGMENTS;

const panel = document.getElementById('panel');
const canvas = document.getElementById('meterCanvas');
const ctx = canvas.getContext('2d');
const dbReadoutEl = document.getElementById('dbReadout');
const zoneLabelEl = document.getElementById('zoneLabel');
const calibrationStatusEl = document.getElementById('calibrationStatus');
const deviceHintEl = document.getElementById('deviceHint');

let orientation = 'vertical';
let alwaysOnTop = true;
let connected = false;
let latestRmsDb = MIN_DB;
let latestPeakHoldDb = MIN_DB;

loadSettings();
wireButtons();
wireEvents();
applyAlwaysOnTop();
resizeCanvasForDpr();
window.addEventListener('resize', resizeCanvasForDpr);

autoConnectFromSettings();
requestAnimationFrame(renderLoop);

// --- Setup ---

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    orientation = saved.orientation === 'horizontal' ? 'horizontal' : 'vertical';
    alwaysOnTop = saved.alwaysOnTop ?? true;
    applyOrientation();
  } catch {
    // Corrupt/legacy settings blob - ignore and start fresh.
  }
}

function saveSettings() {
  const existing = safeParse(localStorage.getItem(STORAGE_KEY)) ?? {};
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...existing, orientation, alwaysOnTop }));
}

function loadLastDevice() {
  return safeParse(localStorage.getItem(STORAGE_KEY))?.lastDevice ?? null;
}

function saveLastDevice(deviceId, channelIndex) {
  const existing = safeParse(localStorage.getItem(STORAGE_KEY)) ?? {};
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...existing, lastDevice: { deviceId, channelIndex } }));
}

function safeParse(json) {
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

function wireButtons() {
  document.getElementById('closeBtn').addEventListener('click', () => invoke('quit_app'));
  document.getElementById('settingsBtn').addEventListener('click', () => invoke('open_control_center'));
  document.getElementById('openDevicesBtn').addEventListener('click', () => invoke('open_control_center'));
  document.getElementById('calibrateBtn').addEventListener('click', runCalibration);
  document.getElementById('pinBtn').addEventListener('click', () => {
    alwaysOnTop = !alwaysOnTop;
    applyAlwaysOnTop();
    saveSettings();
  });
}

function wireEvents() {
  listen('level-update', (event) => {
    latestRmsDb = event.payload.rmsDb;
    latestPeakHoldDb = event.payload.peakHoldDb;
  });

  listen('status-update', (event) => {
    connected = !!event.payload.connected;
    setDeviceHintVisible(!connected);
    if (connected && event.payload.deviceId) {
      saveLastDevice(event.payload.deviceId, event.payload.channelIndex ?? 0);
    }
    if (!connected && event.payload.error) {
      showConnectError(event.payload.error);
    }
  });

  listen('calibration-result', (event) => {
    const { ok, result, error } = event.payload;
    if (ok) {
      flashCalibrationStatus(`Noise floor: ${result.noiseFloorDb.toFixed(1)} dB`, false, 3000);
    } else {
      flashCalibrationStatus(`Error: ${error}`, true, 3000);
    }
  });
}

async function autoConnectFromSettings() {
  const last = loadLastDevice();
  if (!last?.deviceId) {
    setDeviceHintVisible(true);
    return;
  }
  try {
    await invoke('start_capture', { deviceId: last.deviceId, channelIndex: last.channelIndex ?? 0 });
  } catch (err) {
    showConnectError(String(err));
  }
}

async function runCalibration() {
  flashCalibrationStatus('Calibrating - stay silent...', false);
  try {
    const result = await invoke('run_calibration');
    flashCalibrationStatus(`Noise floor: ${result.noiseFloorDb.toFixed(1)} dB`, false, 3000);
  } catch (err) {
    flashCalibrationStatus(`Error: ${err}`, true, 3000);
  }
}

function showConnectError(message) {
  deviceHintEl.textContent = `Capture failed: ${message} - `;
  const btn = document.createElement('button');
  btn.className = 'link-button';
  btn.textContent = 'pick another device';
  btn.addEventListener('click', () => invoke('open_control_center'));
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

function applyAlwaysOnTop() {
  document.getElementById('pinBtn').classList.toggle('active', alwaysOnTop);
  invoke('set_hud_always_on_top', { value: alwaysOnTop });
}

function applyOrientation() {
  panel.classList.toggle('horizontal', orientation === 'horizontal');
  const size = orientation === 'horizontal' ? { width: 460, height: 150 } : { width: 190, height: 480 };
  invoke('resize_hud', size);
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
  const rmsDb = connected ? latestRmsDb : MIN_DB;
  const peakHoldDb = connected ? latestPeakHoldDb : MIN_DB;
  drawMeter(rmsDb, peakHoldDb);
  updateReadout(rmsDb, peakHoldDb);
  requestAnimationFrame(renderLoop);
}

function updateReadout(rmsDb, peakHoldDb) {
  if (!connected) {
    dbReadoutEl.textContent = '-- dB';
    zoneLabelEl.textContent = 'NO SIGNAL';
    zoneLabelEl.style.color = '#888';
    return;
  }

  dbReadoutEl.textContent = rmsDb <= MIN_DB + 0.5 ? '-∞ dB' : `${rmsDb.toFixed(1)} dB`;
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
    const segDbLow = segmentFloorDb(i);
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
  if (db <= ACTIONABLE_FLOOR_DB) {
    const normalized = (db - DEEP_FLOOR_DB) / (ACTIONABLE_FLOOR_DB - DEEP_FLOOR_DB);
    return Math.min(COMPRESSED_SEGMENTS, Math.max(0, Math.round(normalized * COMPRESSED_SEGMENTS)));
  }
  const normalized = (db - ACTIONABLE_FLOOR_DB) / (MAX_DB - ACTIONABLE_FLOOR_DB);
  return COMPRESSED_SEGMENTS + Math.min(ACTIONABLE_SEGMENTS, Math.max(0, Math.round(normalized * ACTIONABLE_SEGMENTS)));
}

/** Inverse of dbToSegmentIndex: the dB value the bottom edge of segment `i` represents. */
function segmentFloorDb(i) {
  if (i < COMPRESSED_SEGMENTS) {
    return DEEP_FLOOR_DB + ((ACTIONABLE_FLOOR_DB - DEEP_FLOOR_DB) * i) / COMPRESSED_SEGMENTS;
  }
  const j = i - COMPRESSED_SEGMENTS;
  return ACTIONABLE_FLOOR_DB + ((MAX_DB - ACTIONABLE_FLOOR_DB) * j) / ACTIONABLE_SEGMENTS;
}

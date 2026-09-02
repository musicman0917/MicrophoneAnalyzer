//! Core audio capture engine, built on cpal (WASAPI on Windows, ALSA/PulseAudio on Linux,
//! CoreAudio on macOS). This is the whole reason for moving off Electron: cpal's input
//! callback hands us the RAW interleaved multi-channel buffer straight from the device's
//! shared-mode mix format, exactly like NAudio's WasapiCapture does in the WPF app - no
//! browser-mediated downmix, no silently-clamped channel selection. Picking a channel is
//! just an index into that buffer, and switching channels is a live atomic swap - no need
//! to reopen the device at all.
//!
//! Threading model: a single dedicated OS thread owns the cpal `Stream` for its entire
//! lifetime (created, held, and dropped only on that thread) and is driven by a
//! `mpsc::Receiver<AudioCommand>`. This sidesteps any question of whether `cpal::Stream` is
//! `Send` - it never needs to cross a thread boundary. The actual RMS/peak numbers live in
//! `SharedLevels`, plain `f64`s behind a `Mutex`, which Tauri commands and an emitter task
//! read from freely.

use crate::dsp::{analyze_channel_samples, linear_to_db, MIN_DB};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const RMS_ATTACK: f64 = 0.6;
const RMS_RELEASE: f64 = 0.15;
const PEAK_HOLD_DECAY_DB_PER_SEC: f64 = 14.0;

#[derive(Clone, Copy, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Levels {
    pub rms_db: f64,
    pub peak_db: f64,
    pub peak_hold_db: f64,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    /// cpal has no persistent numeric device handle - devices are re-enumerated by name on
    /// every operation, so the name doubles as the id (same limitation cpal itself has).
    pub id: String,
    pub name: String,
    pub max_channels: u16,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NoiseFloorResult {
    pub noise_floor_db: f64,
    pub suggested_gate_range_db: [f64; 2],
    pub suggested_gate_threshold_db: f64,
    pub is_room_too_loud: bool,
    pub sample_count: usize,
}

const GATE_OFFSET_LOW_DB: f64 = 6.0;
const GATE_OFFSET_HIGH_DB: f64 = 10.0;
const ROOM_TOO_LOUD_THRESHOLD_DB: f64 = -45.0;
const CALIBRATION_DURATION: Duration = Duration::from_millis(2500);
const CALIBRATION_POLL_INTERVAL: Duration = Duration::from_millis(33);

struct LevelsInner {
    rms_db: f64,
    peak_db: f64,
    peak_hold_db: f64,
    last_peak_update: Instant,
    /// Raw (unsmoothed) instantaneous RMS, linear amplitude - used by calibration, which
    /// wants the true ambient level, not the attack/release-smoothed display value tuned
    /// for voice dynamics.
    raw_rms_linear: f64,
}

impl Default for LevelsInner {
    fn default() -> Self {
        Self {
            rms_db: MIN_DB,
            peak_db: MIN_DB,
            peak_hold_db: MIN_DB,
            last_peak_update: Instant::now(),
            raw_rms_linear: 0.0,
        }
    }
}

struct SharedLevels {
    inner: Mutex<LevelsInner>,
}

impl SharedLevels {
    fn new() -> Self {
        Self { inner: Mutex::new(LevelsInner::default()) }
    }

    fn reset(&self) {
        *self.inner.lock().unwrap() = LevelsInner::default();
    }

    fn update(&self, rms_linear: f64, peak_linear: f64) {
        let inst_rms_db = linear_to_db(rms_linear);
        let inst_peak_db = linear_to_db(peak_linear);
        let now = Instant::now();

        let mut inner = self.inner.lock().unwrap();

        let coeff = if inst_rms_db > inner.rms_db { RMS_ATTACK } else { RMS_RELEASE };
        inner.rms_db += (inst_rms_db - inner.rms_db) * coeff;
        inner.peak_db = inst_peak_db;
        inner.raw_rms_linear = rms_linear;

        let elapsed_sec = now.duration_since(inner.last_peak_update).as_secs_f64();
        inner.last_peak_update = now;
        let decayed = inner.peak_hold_db - PEAK_HOLD_DECAY_DB_PER_SEC * elapsed_sec;
        inner.peak_hold_db = inst_peak_db.max(decayed);
    }

    fn snapshot(&self) -> Levels {
        let inner = self.inner.lock().unwrap();
        Levels { rms_db: inner.rms_db, peak_db: inner.peak_db, peak_hold_db: inner.peak_hold_db }
    }

    fn raw_rms_linear(&self) -> f64 {
        self.inner.lock().unwrap().raw_rms_linear
    }
}

enum AudioCommand {
    Start {
        device_id: String,
        channel_index: usize,
        respond_to: mpsc::Sender<Result<u16, String>>,
    },
    SetChannel(usize),
    Stop,
}

/// What's currently selected, for windows that open after capture already started and need
/// to sync to the current state rather than waiting for the next status-update event.
#[derive(Clone, Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CurrentSelection {
    pub device_id: String,
    pub channel_index: usize,
}

pub struct AudioEngine {
    levels: Arc<SharedLevels>,
    command_tx: mpsc::Sender<AudioCommand>,
    channel_count: Arc<std::sync::atomic::AtomicU16>,
    is_running: Arc<std::sync::atomic::AtomicBool>,
    current_selection: Arc<Mutex<Option<CurrentSelection>>>,
}

impl AudioEngine {
    pub fn new() -> Self {
        let levels = Arc::new(SharedLevels::new());
        let channel_count = Arc::new(std::sync::atomic::AtomicU16::new(0));
        let is_running = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (command_tx, command_rx) = mpsc::channel::<AudioCommand>();

        let levels_for_thread = Arc::clone(&levels);
        let channel_count_for_thread = Arc::clone(&channel_count);
        let is_running_for_thread = Arc::clone(&is_running);

        thread::spawn(move || {
            audio_thread_main(command_rx, levels_for_thread, channel_count_for_thread, is_running_for_thread);
        });

        Self { levels, command_tx, channel_count, is_running, current_selection: Arc::new(Mutex::new(None)) }
    }

    pub fn list_devices() -> Result<Vec<DeviceInfo>, String> {
        let host = cpal::default_host();
        let devices = host.input_devices().map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for device in devices {
            let Ok(name) = device.name() else { continue };
            let max_channels = device
                .supported_input_configs()
                .map(|configs| configs.map(|c| c.channels()).max().unwrap_or(2))
                .unwrap_or(2);
            result.push(DeviceInfo { id: name.clone(), name, max_channels });
        }
        Ok(result)
    }

    pub fn start(&self, device_id: String, channel_index: usize) -> Result<u16, String> {
        let (respond_to, response) = mpsc::channel();
        self.command_tx
            .send(AudioCommand::Start { device_id: device_id.clone(), channel_index, respond_to })
            .map_err(|_| "Audio thread is not running".to_string())?;
        let result = response.recv().map_err(|_| "Audio thread did not respond".to_string())?;
        if result.is_ok() {
            *self.current_selection.lock().unwrap() = Some(CurrentSelection { device_id, channel_index });
        }
        result
    }

    pub fn set_channel(&self, channel_index: usize) -> Result<(), String> {
        self.command_tx
            .send(AudioCommand::SetChannel(channel_index))
            .map_err(|_| "Audio thread is not running".to_string())?;
        if let Some(selection) = self.current_selection.lock().unwrap().as_mut() {
            selection.channel_index = channel_index;
        }
        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        self.command_tx.send(AudioCommand::Stop).map_err(|_| "Audio thread is not running".to_string())?;
        *self.current_selection.lock().unwrap() = None;
        Ok(())
    }

    pub fn levels(&self) -> Levels {
        self.levels.snapshot()
    }

    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::Relaxed)
    }

    pub fn current_selection(&self) -> Option<CurrentSelection> {
        self.current_selection.lock().unwrap().clone()
    }

    pub fn granted_channel_count(&self) -> u16 {
        self.channel_count.load(Ordering::Relaxed)
    }

    /// Samples ambient RMS for ~2.5s and derives a noise floor + suggested gate range.
    /// Blocking (sleeps between samples) - call this from a spawned/blocking task, not
    /// directly on an async executor thread.
    pub fn run_calibration(&self) -> Result<NoiseFloorResult, String> {
        if !self.is_running() {
            return Err("Audio engine is not connected - select a device first.".to_string());
        }

        let mut samples: Vec<f64> = Vec::new();
        let start = Instant::now();
        while start.elapsed() < CALIBRATION_DURATION {
            samples.push(self.levels.raw_rms_linear());
            thread::sleep(CALIBRATION_POLL_INTERVAL);
        }

        if samples.is_empty() {
            return Err("No samples captured during calibration.".to_string());
        }

        let mut sorted = samples.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        // 75th percentile rather than the raw max, so one stray transient (a chair creak,
        // a door) doesn't blow the baseline out - we want steady-state room noise.
        let p75 = sorted[(sorted.len() as f64 * 0.75) as usize];
        let mean_square = samples.iter().map(|v| v * v).sum::<f64>() / samples.len() as f64;
        let rms_of_rms = mean_square.sqrt();
        let representative_linear = p75.max(rms_of_rms);

        let noise_floor_db = linear_to_db(representative_linear);
        let gate_low = noise_floor_db + GATE_OFFSET_LOW_DB;
        let gate_high = noise_floor_db + GATE_OFFSET_HIGH_DB;

        Ok(NoiseFloorResult {
            noise_floor_db,
            suggested_gate_range_db: [gate_low, gate_high],
            suggested_gate_threshold_db: (gate_low + gate_high) / 2.0,
            is_room_too_loud: noise_floor_db > ROOM_TOO_LOUD_THRESHOLD_DB,
            sample_count: samples.len(),
        })
    }
}

// current_stream is genuinely only ever held, never read back out - it exists purely so
// Stream's Drop impl (which stops the device) fires at the right moments. The compiler's
// unused-assignment lint doesn't model "held for its Drop side effect" as a use.
#[allow(unused_assignments, unused_variables)]
fn audio_thread_main(
    command_rx: mpsc::Receiver<AudioCommand>,
    levels: Arc<SharedLevels>,
    channel_count: Arc<std::sync::atomic::AtomicU16>,
    is_running: Arc<std::sync::atomic::AtomicBool>,
) {
    let mut current_stream: Option<cpal::Stream> = None;
    // Shared with the running callback via build_stream - SetChannel just stores a new
    // index here, letting the already-open stream re-point live with no restart needed.
    let mut current_channel_index: Option<Arc<AtomicUsize>> = None;

    while let Ok(command) = command_rx.recv() {
        match command {
            AudioCommand::Start { device_id, channel_index, respond_to } => {
                // Drop any existing stream first (Stream's Drop impl stops it).
                current_stream = None;
                current_channel_index = None;
                is_running.store(false, Ordering::Relaxed);
                levels.reset();

                match build_stream(&device_id, channel_index, Arc::clone(&levels)) {
                    Ok((stream, granted_channels, channel_index_handle)) => {
                        channel_count.store(granted_channels, Ordering::Relaxed);
                        is_running.store(true, Ordering::Relaxed);
                        current_stream = Some(stream);
                        current_channel_index = Some(channel_index_handle);
                        let _ = respond_to.send(Ok(granted_channels));
                    }
                    Err(err) => {
                        let _ = respond_to.send(Err(err));
                    }
                }
            }
            AudioCommand::SetChannel(new_index) => {
                if let Some(handle) = &current_channel_index {
                    let channels = channel_count.load(Ordering::Relaxed) as usize;
                    if channels > 0 {
                        handle.store(new_index.min(channels - 1), Ordering::Relaxed);
                    }
                }
            }
            AudioCommand::Stop => {
                current_stream = None;
                current_channel_index = None;
                channel_count.store(0, Ordering::Relaxed);
                is_running.store(false, Ordering::Relaxed);
                levels.reset();
            }
        }
    }
}

/// Builds and starts an input stream on `device_id`, analyzing `channel_index` of its
/// interleaved buffer. Picks the supported config with the MOST channels (closest to
/// WASAPI shared mode's full mix format) rather than cpal's "default" config, which is
/// often just a plain stereo pair.
fn build_stream(
    device_id: &str,
    channel_index: usize,
    levels: Arc<SharedLevels>,
) -> Result<(cpal::Stream, u16, Arc<AtomicUsize>), String> {
    let host = cpal::default_host();
    let device = host
        .input_devices()
        .map_err(|e| e.to_string())?
        .find(|d| d.name().map(|n| n == device_id).unwrap_or(false))
        .ok_or_else(|| format!("Device '{device_id}' not found"))?;

    let supported_config = device
        .supported_input_configs()
        .map_err(|e| e.to_string())?
        .max_by_key(|c| c.channels())
        .ok_or("Device has no supported input configurations")?;

    let sample_format = supported_config.sample_format();
    let config: cpal::StreamConfig = supported_config.with_max_sample_rate().config();
    let channels = config.channels;
    let channel_index = channel_index.min(channels as usize - 1);
    let channel_index = Arc::new(AtomicUsize::new(channel_index));

    let err_fn = |err| eprintln!("[audio] stream error: {err}");
    let channels_usize = channels as usize;

    let stream = match sample_format {
        cpal::SampleFormat::F32 => {
            let levels = Arc::clone(&levels);
            let channel_index = Arc::clone(&channel_index);
            device.build_input_stream(
                &config,
                move |data: &[f32], _| {
                    handle_callback(data.iter().copied(), channels_usize, channel_index.load(Ordering::Relaxed), &levels);
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let levels = Arc::clone(&levels);
            let channel_index = Arc::clone(&channel_index);
            device.build_input_stream(
                &config,
                move |data: &[i16], _| {
                    handle_callback(
                        data.iter().map(|&s| s as f32 / i16::MAX as f32),
                        channels_usize,
                        channel_index.load(Ordering::Relaxed),
                        &levels,
                    );
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let levels = Arc::clone(&levels);
            let channel_index = Arc::clone(&channel_index);
            device.build_input_stream(
                &config,
                move |data: &[u16], _| {
                    handle_callback(
                        data.iter().map(|&s| (s as f32 - 32768.0) / 32768.0),
                        channels_usize,
                        channel_index.load(Ordering::Relaxed),
                        &levels,
                    );
                },
                err_fn,
                None,
            )
        }
        other => return Err(format!("Unsupported sample format: {other:?}")),
    }
    .map_err(|e| e.to_string())?;

    stream.play().map_err(|e| e.to_string())?;

    Ok((stream, channels, channel_index))
}

fn handle_callback<I: Iterator<Item = f32>>(data: I, channels: usize, channel_index: usize, levels: &Arc<SharedLevels>) {
    if channels == 0 {
        return;
    }
    let ch = channel_index.min(channels - 1);
    let deinterleaved = data.skip(ch).step_by(channels);
    let stats = analyze_channel_samples(deinterleaved);
    levels.update(stats.rms, stats.peak);
}

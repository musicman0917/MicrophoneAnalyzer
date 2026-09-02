//! Small math helpers, ported 1:1 from the Electron app's shared/dsp.js so all three
//! implementations (WPF, Electron, Tauri) agree on the same conventions.

pub const MIN_DB: f64 = -60.0;

/// Converts a linear amplitude (0..1) to dBFS, floored at MIN_DB.
pub fn linear_to_db(linear: f64) -> f64 {
    if linear <= 1e-7 {
        return MIN_DB;
    }
    (20.0 * linear.log10()).max(MIN_DB)
}

pub struct BufferStats {
    pub rms: f64,
    pub peak: f64,
}

/// RMS + peak (as linear amplitude, 0..1) of an already-deinterleaved single-channel
/// sample iterator. Takes an iterator rather than a slice so the caller can deinterleave
/// lazily (skip/step_by over the raw interleaved buffer) without an intermediate Vec.
pub fn analyze_channel_samples<I: Iterator<Item = f32>>(samples: I) -> BufferStats {
    let mut sum_squares = 0.0f64;
    let mut peak = 0.0f32;
    let mut count = 0usize;

    for sample in samples {
        let s = sample as f64;
        sum_squares += s * s;
        let abs = sample.abs();
        if abs > peak {
            peak = abs;
        }
        count += 1;
    }

    if count == 0 {
        return BufferStats { rms: 0.0, peak: 0.0 };
    }

    BufferStats {
        rms: (sum_squares / count as f64).sqrt(),
        peak: peak as f64,
    }
}

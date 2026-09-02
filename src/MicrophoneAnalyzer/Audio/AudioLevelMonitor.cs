using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace MicrophoneAnalyzer.Audio;

/// <summary>
/// Captures a single channel out of a (possibly multi-channel) WASAPI input device and
/// continuously computes RMS and peak levels in dBFS, plus a slowly-decaying peak-hold
/// value for the meter's peak marker.
///
/// Runs in shared mode, which means Windows hands us the device's mix format - on modern
/// drivers (including the DLZ Creator XS) that's IEEE float, so no bit-depth conversion
/// is needed. The audio callback only does arithmetic and a lock-protected write; the UI
/// polls GetLevels() on its own timer so the audio thread is never blocked by rendering.
/// </summary>
public sealed class AudioLevelMonitor : IDisposable
{
    public const double MinDb = -60.0;
    private const double PeakHoldDecayDbPerSecond = 14.0;

    private WasapiCapture? _capture;
    private int _channelIndex;

    private readonly object _lock = new();
    private double _rmsDb = MinDb;
    private double _peakDb = MinDb;
    private double _peakHoldDb = MinDb;
    private DateTime _lastPeakUpdateUtc = DateTime.UtcNow;

    public bool IsRunning => _capture?.CaptureState == CaptureState.Capturing;
    public int ChannelCount { get; private set; }

    /// <param name="device">Capture endpoint, e.g. the DLZ Creator XS. Ownership passes to
    /// this monitor - it will be disposed on Stop()/Dispose().</param>
    /// <param name="channelIndex">Zero-based channel to listen to within the device's
    /// interleaved buffer (e.g. whichever USB channel the DynaCaster is routed to).</param>
    public void Start(MMDevice device, int channelIndex)
    {
        Stop();

        var capture = new WasapiCapture(device) { ShareMode = AudioClientShareMode.Shared };
        ChannelCount = capture.WaveFormat.Channels;
        _channelIndex = Math.Clamp(channelIndex, 0, Math.Max(0, ChannelCount - 1));

        if (!IsFloatFormat(capture.WaveFormat))
        {
            capture.Dispose();
            throw new NotSupportedException(
                $"Device mix format is {capture.WaveFormat.Encoding}, expected IEEE float. " +
                "This build only handles WASAPI shared-mode float mix formats.");
        }

        lock (_lock)
        {
            _rmsDb = _peakDb = _peakHoldDb = MinDb;
            _lastPeakUpdateUtc = DateTime.UtcNow;
        }

        capture.DataAvailable += OnDataAvailable;
        _capture = capture;
        capture.StartRecording();
    }

    public void Stop()
    {
        if (_capture == null) return;

        _capture.DataAvailable -= OnDataAvailable;
        try { _capture.StopRecording(); } catch { /* already stopped / device gone */ }
        _capture.Dispose();
        _capture = null;
    }

    public (double RmsDb, double PeakDb, double PeakHoldDb) GetLevels()
    {
        lock (_lock)
        {
            return (_rmsDb, _peakDb, _peakHoldDb);
        }
    }

    private void OnDataAvailable(object? sender, WaveInEventArgs e)
    {
        var capture = _capture;
        if (capture == null || e.BytesRecorded == 0) return;

        int channels = capture.WaveFormat.Channels;
        var samples = MemoryMarshal.Cast<byte, float>(e.Buffer.AsSpan(0, e.BytesRecorded));
        int frames = samples.Length / channels;
        if (frames == 0) return;

        double sumSquares = 0;
        float peak = 0f;
        int channel = _channelIndex;

        for (int i = 0; i < frames; i++)
        {
            float sample = samples[i * channels + channel];
            sumSquares += (double)sample * sample;

            float abs = MathF.Abs(sample);
            if (abs > peak) peak = abs;
        }

        double rmsDb = LinearToDb(Math.Sqrt(sumSquares / frames));
        double peakDb = LinearToDb(peak);
        var nowUtc = DateTime.UtcNow;

        lock (_lock)
        {
            _rmsDb = rmsDb;
            _peakDb = peakDb;

            double elapsedSeconds = (nowUtc - _lastPeakUpdateUtc).TotalSeconds;
            _lastPeakUpdateUtc = nowUtc;
            double decayed = _peakHoldDb - PeakHoldDecayDbPerSecond * elapsedSeconds;
            _peakHoldDb = Math.Max(peakDb, decayed);
        }
    }

    // KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
    private static readonly Guid IeeeFloatSubFormat = new("00000003-0000-0010-8000-00aa00389b71");

    private static bool IsFloatFormat(WaveFormat format)
    {
        if (format.Encoding == WaveFormatEncoding.IeeeFloat) return true;
        if (format is WaveFormatExtensible extensible)
        {
            return extensible.SubFormat == IeeeFloatSubFormat;
        }
        return false;
    }

    private static double LinearToDb(double linear)
    {
        if (linear <= 1e-7) return MinDb;
        return Math.Max(MinDb, 20.0 * Math.Log10(linear));
    }

    public void Dispose() => Stop();
}

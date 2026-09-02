using NAudio.CoreAudioApi;

namespace MicrophoneAnalyzer.Audio;

/// <summary>
/// Enumerates WASAPI capture (recording) endpoints. A multi-channel USB interface like
/// the DLZ Creator XS shows up as a single Windows recording device whose channel count
/// matches however many input channels the driver exposes (main mix, per-channel sends,
/// etc.) - AudioLevelMonitor lets you pick which interleaved channel to listen to.
/// </summary>
public sealed class AudioDeviceService
{
    public IReadOnlyList<AudioDeviceInfo> GetCaptureDevices()
    {
        var list = new List<AudioDeviceInfo>();
        using var enumerator = new MMDeviceEnumerator();
        foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
        {
            using (device)
            {
                int channels = 2;
                try { channels = device.AudioClient.MixFormat.Channels; }
                catch { /* fall back to stereo if the driver won't report a mix format yet */ }

                list.Add(new AudioDeviceInfo(device.ID, device.FriendlyName, channels));
            }
        }

        return list;
    }

    /// <summary>Caller owns the returned device and must dispose it.</summary>
    public MMDevice? GetDeviceById(string id)
    {
        using var enumerator = new MMDeviceEnumerator();
        try
        {
            return enumerator.GetDevice(id);
        }
        catch
        {
            return null;
        }
    }
}

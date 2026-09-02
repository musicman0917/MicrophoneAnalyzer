namespace MicrophoneAnalyzer.Models;

public sealed class AppSettings
{
    public string? DeviceId { get; set; }
    public int ChannelIndex { get; set; }
    public double WindowLeft { get; set; } = 120;
    public double WindowTop { get; set; } = 120;
    public bool Horizontal { get; set; }
    public bool AlwaysOnTop { get; set; } = true;
}

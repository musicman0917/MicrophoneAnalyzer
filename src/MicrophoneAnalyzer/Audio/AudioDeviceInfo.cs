namespace MicrophoneAnalyzer.Audio;

public sealed record AudioDeviceInfo(string Id, string FriendlyName, int MaxChannels)
{
    public override string ToString() => FriendlyName;
}

namespace MicrophoneAnalyzer.Audio;

/// <summary>
/// Broadcast-style gain zones. TooLow/SweetSpot/Hot are the three bands you specified;
/// Low and Approaching are transition bands so the LED ladder reads as a smooth
/// gradient instead of snapping straight from red to green.
/// </summary>
public enum LevelZone
{
    TooLow,
    Low,
    SweetSpot,
    Approaching,
    Clipping
}

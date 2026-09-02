using System.Windows.Media;

namespace MicrophoneAnalyzer.Audio;

/// <summary>
/// Maps a dBFS value onto the broadcast gain scale you specified:
///   &lt; -24 dB          -> Too Low   (red/orange)
///   -18 dB to -10 dB   -> Sweet Spot (green)
///   &gt; -6 dB           -> Hot / Clipping risk (red)
///
/// The two gaps between those named bands (-24..-18 and -10..-6) are filled with an
/// amber "approaching" band so the meter grades smoothly instead of jumping straight
/// from red to green. Adjust the thresholds below if you want harder edges.
/// </summary>
public static class LevelClassifier
{
    public const double TooLowCeiling = -24.0;
    public const double SweetSpotFloor = -18.0;
    public const double SweetSpotCeiling = -10.0;
    public const double HotFloor = -6.0;

    public static LevelZone Classify(double dbfs) => dbfs switch
    {
        < TooLowCeiling => LevelZone.TooLow,
        < SweetSpotFloor => LevelZone.Low,
        <= SweetSpotCeiling => LevelZone.SweetSpot,
        < HotFloor => LevelZone.Approaching,
        _ => LevelZone.Clipping
    };

    public static Color GetColor(LevelZone zone) => zone switch
    {
        LevelZone.TooLow => Color.FromRgb(0xFF, 0x3B, 0x30),      // red
        LevelZone.Low => Color.FromRgb(0xFF, 0x9F, 0x0A),         // orange
        LevelZone.SweetSpot => Color.FromRgb(0x30, 0xD1, 0x58),   // green
        LevelZone.Approaching => Color.FromRgb(0xFF, 0xD6, 0x0A), // amber
        LevelZone.Clipping => Color.FromRgb(0xFF, 0x3B, 0x30),    // red
        _ => Colors.Gray
    };

    public static string GetLabel(LevelZone zone) => zone switch
    {
        LevelZone.TooLow => "TOO LOW",
        LevelZone.Low => "LOW",
        LevelZone.SweetSpot => "SWEET SPOT",
        LevelZone.Approaching => "HOT",
        LevelZone.Clipping => "CLIPPING!",
        _ => ""
    };
}

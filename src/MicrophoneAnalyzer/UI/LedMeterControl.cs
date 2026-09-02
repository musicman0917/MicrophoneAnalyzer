using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using MicrophoneAnalyzer.Audio;

namespace MicrophoneAnalyzer.UI;

/// <summary>
/// Classic hardware-style segmented LED bar meter. Each segment's color is fixed by
/// where it sits on the dB scale (per LevelClassifier), and segments light up from the
/// bottom (or left, in horizontal mode) as the signal rises - exactly like a real
/// broadcast peak meter. A brighter outlined segment marks the decaying peak-hold value.
///
/// Drawn directly with DrawingContext in OnRender rather than a template of child
/// controls, since this is meant to be a cheap, always-on-top overlay.
/// </summary>
public sealed class LedMeterControl : FrameworkElement
{
    public static readonly DependencyProperty RmsDbProperty = DependencyProperty.Register(
        nameof(RmsDb), typeof(double), typeof(LedMeterControl),
        new FrameworkPropertyMetadata(AudioLevelMonitor.MinDb, FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty PeakHoldDbProperty = DependencyProperty.Register(
        nameof(PeakHoldDb), typeof(double), typeof(LedMeterControl),
        new FrameworkPropertyMetadata(AudioLevelMonitor.MinDb, FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty OrientationProperty = DependencyProperty.Register(
        nameof(Orientation), typeof(Orientation), typeof(LedMeterControl),
        new FrameworkPropertyMetadata(Orientation.Vertical, FrameworkPropertyMetadataOptions.AffectsRender));

    public double RmsDb
    {
        get => (double)GetValue(RmsDbProperty);
        set => SetValue(RmsDbProperty, value);
    }

    public double PeakHoldDb
    {
        get => (double)GetValue(PeakHoldDbProperty);
        set => SetValue(PeakHoldDbProperty, value);
    }

    public Orientation Orientation
    {
        get => (Orientation)GetValue(OrientationProperty);
        set => SetValue(OrientationProperty, value);
    }

    private const double MinDb = AudioLevelMonitor.MinDb;
    private const double MaxDb = 0.0;
    private const int SegmentCount = 28;
    private const double GapRatio = 0.22;

    protected override void OnRender(DrawingContext dc)
    {
        double width = ActualWidth;
        double height = ActualHeight;
        if (width <= 0 || height <= 0) return;

        bool vertical = Orientation == Orientation.Vertical;
        double totalLength = vertical ? height : width;
        double thickness = vertical ? width : height;
        double segLength = totalLength / SegmentCount;
        double gap = segLength * GapRatio;
        double segSize = Math.Max(1, segLength - gap);

        int litCount = DbToSegmentIndex(RmsDb);
        int peakSegment = Math.Clamp(DbToSegmentIndex(PeakHoldDb) - 1, 0, SegmentCount - 1);

        for (int i = 0; i < SegmentCount; i++)
        {
            double segDbLow = MinDb + (MaxDb - MinDb) * i / SegmentCount;
            var zone = LevelClassifier.Classify(segDbLow);
            var baseColor = LevelClassifier.GetColor(zone);

            bool lit = i < litCount;
            var fill = new SolidColorBrush(lit
                ? baseColor
                : Color.FromArgb(0x2A, baseColor.R, baseColor.G, baseColor.B));
            fill.Freeze();

            Rect rect = vertical
                ? new Rect(0, height - (i + 1) * segLength + gap / 2, thickness, segSize)
                : new Rect(i * segLength + gap / 2, 0, segSize, thickness);

            dc.DrawRectangle(fill, null, rect);

            if (i == peakSegment)
            {
                var peakPen = new Pen(Brushes.White, 1.25);
                peakPen.Freeze();
                dc.DrawRectangle(null, peakPen, rect);
            }
        }
    }

    private static int DbToSegmentIndex(double db)
    {
        double normalized = (db - MinDb) / (MaxDb - MinDb);
        return Math.Clamp((int)Math.Round(normalized * SegmentCount), 0, SegmentCount);
    }
}

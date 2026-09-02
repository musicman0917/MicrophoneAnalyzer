using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using MicrophoneAnalyzer.Audio;
using MicrophoneAnalyzer.Models;
using MicrophoneAnalyzer.Services;
using MicrophoneAnalyzer.UI;

namespace MicrophoneAnalyzer;

public partial class MainWindow : Window
{
    private readonly AudioDeviceService _deviceService = new();
    private readonly AudioLevelMonitor _monitor = new();
    private readonly AppSettings _settings = SettingsService.Load();
    private DispatcherTimer? _uiTimer;

    // Kept alive for the lifetime of the capture - WasapiCapture holds onto the MMDevice's
    // AudioClient internally, so disposing this out from under it would break recording.
    private NAudio.CoreAudioApi.MMDevice? _currentDevice;

    public MainWindow()
    {
        InitializeComponent();
    }

    private void Window_Loaded(object sender, RoutedEventArgs e)
    {
        Left = _settings.WindowLeft;
        Top = _settings.WindowTop;
        Topmost = _settings.AlwaysOnTop;
        TopmostMenuItem.IsChecked = _settings.AlwaysOnTop;

        Meter.Orientation = _settings.Horizontal ? Orientation.Horizontal : Orientation.Vertical;
        ApplyOrientationLayout();

        TryStartFromSettings();

        _uiTimer = new DispatcherTimer(DispatcherPriority.Render) { Interval = TimeSpan.FromMilliseconds(33) };
        _uiTimer.Tick += UiTimer_Tick;
        _uiTimer.Start();
    }

    private void TryStartFromSettings()
    {
        if (string.IsNullOrEmpty(_settings.DeviceId))
        {
            PromptDeviceSelection();
            return;
        }

        var device = _deviceService.GetDeviceById(_settings.DeviceId);
        if (device == null)
        {
            PromptDeviceSelection();
            return;
        }

        StartCapture(device);
    }

    private void PromptDeviceSelection()
    {
        var dialog = new DeviceSelectionWindow(_settings.DeviceId, _settings.ChannelIndex) { Owner = this };
        if (dialog.ShowDialog() != true || dialog.SelectedDeviceId == null) return;

        _settings.DeviceId = dialog.SelectedDeviceId;
        _settings.ChannelIndex = dialog.SelectedChannelIndex;

        var device = _deviceService.GetDeviceById(_settings.DeviceId);
        if (device != null) StartCapture(device);
    }

    private void StartCapture(NAudio.CoreAudioApi.MMDevice device)
    {
        try
        {
            _monitor.Start(device, _settings.ChannelIndex);
            _currentDevice?.Dispose();
            _currentDevice = device;
        }
        catch (Exception ex)
        {
            device.Dispose();
            MessageBox.Show(this, $"Could not start capture:\n{ex.Message}", "Mic Level HUD",
                MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void UiTimer_Tick(object? sender, EventArgs e)
    {
        if (!_monitor.IsRunning)
        {
            DbReadout.Text = "-- dB";
            ZoneLabel.Text = "NO SIGNAL";
            ZoneLabel.Foreground = Brushes.Gray;
            Meter.RmsDb = AudioLevelMonitor.MinDb;
            Meter.PeakHoldDb = AudioLevelMonitor.MinDb;
            return;
        }

        var (rmsDb, _, peakHoldDb) = _monitor.GetLevels();
        Meter.RmsDb = rmsDb;
        Meter.PeakHoldDb = peakHoldDb;

        DbReadout.Text = rmsDb <= AudioLevelMonitor.MinDb + 0.5 ? "-∞ dB" : $"{rmsDb:0.0} dB";

        var zone = LevelClassifier.Classify(rmsDb);
        ZoneLabel.Text = LevelClassifier.GetLabel(zone);
        ZoneLabel.Foreground = new SolidColorBrush(LevelClassifier.GetColor(zone));
    }

    private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e) => DragMove();

    private void SelectDevice_Click(object sender, RoutedEventArgs e)
    {
        _monitor.Stop();
        PromptDeviceSelection();
    }

    private void ToggleOrientation_Click(object sender, RoutedEventArgs e)
    {
        _settings.Horizontal = !_settings.Horizontal;
        Meter.Orientation = _settings.Horizontal ? Orientation.Horizontal : Orientation.Vertical;
        ApplyOrientationLayout();
    }

    private void ApplyOrientationLayout()
    {
        if (_settings.Horizontal)
        {
            Width = 420;
            Height = 130;
            Meter.Width = double.NaN;
            Meter.Height = 40;
            Meter.HorizontalAlignment = HorizontalAlignment.Stretch;
            Meter.VerticalAlignment = VerticalAlignment.Center;
        }
        else
        {
            Width = 150;
            Height = 420;
            Meter.Width = 40;
            Meter.Height = double.NaN;
            Meter.HorizontalAlignment = HorizontalAlignment.Center;
            Meter.VerticalAlignment = VerticalAlignment.Stretch;
        }
    }

    private void ToggleTopmost_Click(object sender, RoutedEventArgs e)
    {
        _settings.AlwaysOnTop = TopmostMenuItem.IsChecked;
        Topmost = _settings.AlwaysOnTop;
    }

    private void Exit_Click(object sender, RoutedEventArgs e) => Close();

    private void Window_Closing(object? sender, CancelEventArgs e)
    {
        _settings.WindowLeft = Left;
        _settings.WindowTop = Top;
        SettingsService.Save(_settings);

        _uiTimer?.Stop();
        _monitor.Dispose();
        _currentDevice?.Dispose();
    }
}

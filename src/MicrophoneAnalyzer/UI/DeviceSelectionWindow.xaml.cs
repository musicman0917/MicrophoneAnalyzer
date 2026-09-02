using System.Linq;
using System.Windows;
using System.Windows.Controls;
using MicrophoneAnalyzer.Audio;

namespace MicrophoneAnalyzer.UI;

public partial class DeviceSelectionWindow : Window
{
    private readonly AudioDeviceService _deviceService = new();
    private readonly int _initialChannelIndex;

    public string? SelectedDeviceId { get; private set; }
    public int SelectedChannelIndex { get; private set; }

    public DeviceSelectionWindow(string? currentDeviceId, int currentChannelIndex)
    {
        InitializeComponent();
        _initialChannelIndex = currentChannelIndex;

        var devices = _deviceService.GetCaptureDevices();
        DeviceCombo.ItemsSource = devices;

        var match = devices.FirstOrDefault(d => d.Id == currentDeviceId) ?? devices.FirstOrDefault();
        DeviceCombo.SelectedItem = match;
    }

    private void DeviceCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (DeviceCombo.SelectedItem is not AudioDeviceInfo info) return;

        int channelCount = Math.Max(1, info.MaxChannels);
        ChannelCombo.ItemsSource = Enumerable.Range(0, channelCount).Select(i => $"Channel {i + 1}").ToList();
        ChannelCombo.SelectedIndex = Math.Clamp(_initialChannelIndex, 0, channelCount - 1);
    }

    private void Ok_Click(object sender, RoutedEventArgs e)
    {
        if (DeviceCombo.SelectedItem is not AudioDeviceInfo info || ChannelCombo.SelectedIndex < 0)
        {
            MessageBox.Show(this, "Please select a device and channel.", "Mic Level HUD",
                MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        SelectedDeviceId = info.Id;
        SelectedChannelIndex = ChannelCombo.SelectedIndex;
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;
}

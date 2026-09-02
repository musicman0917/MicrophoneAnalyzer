using System.Windows;
using System.Windows.Threading;

namespace MicrophoneAnalyzer;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // This is meant to run silently alongside a recording/streaming session, so an
        // unhandled exception should surface as a message rather than crash the HUD mid-take.
        DispatcherUnhandledException += OnDispatcherUnhandledException;
    }

    private static void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        MessageBox.Show($"Unexpected error:\n{e.Exception.Message}", "Mic Level HUD",
            MessageBoxButton.OK, MessageBoxImage.Error);
        e.Handled = true;
    }
}

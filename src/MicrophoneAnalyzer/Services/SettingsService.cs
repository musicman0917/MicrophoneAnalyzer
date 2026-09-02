using System.IO;
using System.Text.Json;
using MicrophoneAnalyzer.Models;

namespace MicrophoneAnalyzer.Services;

/// <summary>Persists the selected device/channel and window position across launches.</summary>
public static class SettingsService
{
    private static readonly string FilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "MicrophoneAnalyzer", "settings.json");

    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(FilePath))
            {
                var json = File.ReadAllText(FilePath);
                var settings = JsonSerializer.Deserialize<AppSettings>(json);
                if (settings != null) return settings;
            }
        }
        catch
        {
            // Corrupt or unreadable settings file - fall back to defaults rather than crash.
        }

        return new AppSettings();
    }

    public static void Save(AppSettings settings)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            var json = JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(FilePath, json);
        }
        catch
        {
            // Best-effort persistence; not fatal if it fails (e.g. locked-down profile).
        }
    }
}

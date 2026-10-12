Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = "c:\Users\USER\OneDrive\Desktop\JAGAN\FIXED_agent-runs-KALI-MONSHA.zip"
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
Write-Host "Total entries: " $zip.Entries.Count
foreach ($entry in $zip.Entries) {
    if ($entry.Name -eq "eval-result.json" -or $entry.Name -eq "solution-patch.patch") {
        Write-Host "$($entry.FullName) (size: $($entry.Length))"
    }
}
$zip.Dispose()

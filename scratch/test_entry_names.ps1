Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = "C:\Users\USER\OneDrive\Desktop\JAGAN\FIXED_agent-runs-KALI-MONSHA.zip"
$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
for ($i = 0; $i -lt [Math]::Min(10, $archive.Entries.Count); $i++) {
    Write-Host ("Entry {0}: '{1}'" -f $i, $archive.Entries[$i].FullName)
}
$archive.Dispose()

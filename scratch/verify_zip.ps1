Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = "C:\Users\USER\OneDrive\Desktop\JAGAN\FIXED_agent-runs-KALI-MONSHA.zip"
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)

Write-Host "Total entries in zip:" $zip.Entries.Count
$first10 = $zip.Entries | Select-Object -First 10 -ExpandProperty FullName
Write-Host "First 10 entries:"
$first10 | ForEach-Object { Write-Host "  $_" }

$topDirs = $zip.Entries | ForEach-Object { ($_.FullName -split '[/\\]')[0] } | Select-Object -Unique
Write-Host "`nTop-level agent directories:"
$topDirs | ForEach-Object { Write-Host "  $_" }

$zip.Dispose()

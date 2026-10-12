Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('FIXED_agent-runs-KALI-MONSHA.zip')
Write-Host "Total entries in zip: $($zip.Entries.Count)"
$dirs = $zip.Entries | ForEach-Object { ($_.FullName -split '[/\\\\]')[0] } | Select-Object -Unique
Write-Host "Agent directories in zip ($($dirs.Count)):"
foreach ($d in $dirs) {
    Write-Host "  - $d"
}
$zip.Dispose()

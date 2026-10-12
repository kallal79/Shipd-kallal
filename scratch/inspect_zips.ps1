Add-Type -AssemblyName System.IO.Compression.FileSystem

$zips = @(
    'C:\Users\USER\OneDrive\Desktop\JAGAN\agent-runs - KALI - MONSHA.zip',
    'C:\Users\USER\OneDrive\Desktop\JAGAN\agent-runs-CLLBACK-AGENT FINQL ONE...zip'
)

foreach ($z in $zips) {
    Write-Host "=== $([System.IO.Path]::GetFileName($z)) ==="
    $archive = [System.IO.Compression.ZipFile]::OpenRead($z)
    $folders = $archive.Entries | ForEach-Object { ($_.FullName -split '[/\\\\]')[0] } | Select-Object -Unique
    Write-Host "Entry count: $($archive.Entries.Count)"
    Write-Host "Folders: $($folders -join ', ')"
    $archive.Dispose()
}

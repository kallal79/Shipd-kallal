Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path "FIXED_agent-runs-KALI-MONSHA.zip"))
for ($i = 0; $i -lt [Math]::Min(20, $zip.Entries.Count); $i++) {
    Write-Host $zip.Entries[$i].FullName
}
$zip.Dispose()

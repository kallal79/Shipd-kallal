Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path "FIXED_agent-runs-KALI-MONSHA.zip"))
$entry = $zip.GetEntry("Nova_Nova_1/solution-patch.patch")
Write-Host "Nova_Nova_1 patch length in zip: $($entry.Length)"
$zip.Dispose()

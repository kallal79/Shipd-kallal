Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = 'C:\Users\USER\OneDrive\Desktop\JAGAN\FIXED_agent-runs-KALI-MONSHA.zip'
$dest = 'C:\Users\USER\OneDrive\Desktop\JAGAN\nova_extracted'

if (Test-Path $dest) {
    Remove-Item -Recurse -Force $dest
}
[System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $dest)
Write-Host "Extracted successfully to $dest"

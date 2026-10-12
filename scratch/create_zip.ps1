Add-Type -AssemblyName System.IO.Compression.FileSystem
$srcDir = "C:\Users\USER\OneDrive\Desktop\JAGAN\extracted_monsha"
$zipPath = "C:\Users\USER\OneDrive\Desktop\JAGAN\FIXED_agent-runs-KALI-MONSHA.zip"

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

[System.IO.Compression.ZipFile]::CreateFromDirectory($srcDir, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)

$size = (Get-Item $zipPath).Length
Write-Host "Zip created successfully: $zipPath ($size bytes)"

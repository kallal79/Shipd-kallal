Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourceDir = "C:\Users\USER\OneDrive\Desktop\JAGAN\extracted_monsha"
$zipPath = "C:\Users\USER\OneDrive\Desktop\JAGAN\FIXED_agent-runs-KALI-MONSHA.zip"

if (Test-Path $zipPath) {
    Remove-Item -Force $zipPath
}

[System.IO.Compression.ZipFile]::CreateFromDirectory($sourceDir, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
Write-Host "Created $zipPath successfully! Size: $((Get-Item $zipPath).Length) bytes"

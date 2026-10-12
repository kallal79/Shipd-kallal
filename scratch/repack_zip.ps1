
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$sourceDir = "C:\Users\USER\OneDrive\Desktop\JAGAN\extracted_monsha"
$zipPath = "C:\Users\USER\OneDrive\Desktop\JAGAN\FIXED_agent-runs-KALI-MONSHA.zip"

$archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)

$files = Get-ChildItem -Path $sourceDir -Recurse -File
foreach ($f in $files) {
    $rel = $f.FullName.Substring($sourceDir.Length + 1).Replace([char]92, [char]47)
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $f.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
}

$archive.Dispose()
Write-Host "Zip written successfully."

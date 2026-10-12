Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$sourceDir = "C:\Users\USER\OneDrive\Desktop\JAGAN\extracted_monsha"
$zipPath = "C:\Users\USER\OneDrive\Desktop\JAGAN\FIXED_agent-runs-KALI-MONSHA.zip"

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

$archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)

$files = Get-ChildItem -Path $sourceDir -Recurse -File
foreach ($f in $files) {
    $rel = $f.FullName.Substring($sourceDir.Length + 1).Replace("\", "/")
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $f.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
}

$archive.Dispose()
Write-Host "Archive created successfully!"

$verify = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$bad = 0
foreach ($e in $verify.Entries) {
    if ($e.FullName.Contains("\")) {
        $bad++
    }
}
Write-Host "Total entries in zip:" $verify.Entries.Count
Write-Host "Entries with backslashes:" $bad
Write-Host "Sample entry 1:" $verify.Entries[0].FullName
Write-Host "Sample entry 2:" $verify.Entries[1].FullName
$verify.Dispose()

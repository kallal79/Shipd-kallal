Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('c:\Users\USER\OneDrive\Desktop\JAGAN\agent-runs - KALI - MONSHA.zip')
Write-Host "Original Total entries:" $zip.Entries.Count
for ($i = 0; $i -lt [Math]::Min(15, $zip.Entries.Count); $i++) {
    $e = $zip.Entries[$i]
    Write-Host ("Original Entry {0}: '{1}'" -f $i, $e.FullName)
}
$zip.Dispose()

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('c:\Users\USER\OneDrive\Desktop\JAGAN\FIXED_agent-runs-KALI-MONSHA.zip')
Write-Host "Total entries:" $zip.Entries.Count
for ($i = 0; $i -lt [Math]::Min(15, $zip.Entries.Count); $i++) {
    $e = $zip.Entries[$i]
    Write-Host ("Entry {0}: '{1}' (len: {2})" -f $i, $e.FullName, $e.FullName.Length)
}
$zip.Dispose()

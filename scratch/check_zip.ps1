Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead("C:\Users\USER\OneDrive\Desktop\JAGAN\FIXED_agent-runs-KALI-MONSHA.zip")
Write-Host "Total entries: $($zip.Entries.Count)"
$backslashes = ($zip.Entries | Where-Object { $_.FullName -match '\\' }).Count
Write-Host "Entries with backslash: $backslashes"
$zip.Entries | Select-Object -First 10 | ForEach-Object {
    Write-Host "   $($_.FullName)"
}
$zip.Dispose()

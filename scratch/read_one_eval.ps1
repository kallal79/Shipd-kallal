Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path "FIXED_agent-runs-KALI-MONSHA.zip"))
$e = $zip.Entries | Where-Object { $_.FullName -eq "Nova_Nova_1/eval-result.json" }
$s = $e.Open()
$r = New-Object System.IO.StreamReader($s)
Write-Host $r.ReadToEnd()
$r.Close()
$s.Close()
$zip.Dispose()

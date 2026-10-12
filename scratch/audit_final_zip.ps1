
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = "C:\Users\USER\OneDrive\Desktop\JAGAN\FIXED_agent-runs-KALI-MONSHA.zip"
$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)

$bad = 0
foreach ($e in $archive.Entries) {
    if ($e.FullName.IndexOf([char]92) -ge 0) { $bad++ }
}
Write-Host "Total entries:" $archive.Entries.Count
Write-Host "Backslash count:" $bad

$agents = $archive.Entries.FullName | ForEach-Object { $_.Split('/')[0] } | Select-Object -Unique | Sort-Object
Write-Host ("{0,-15} | {1,-25} | {2,-8} | {3,-8} | {4,-8}" -f "Agent", "Verdict", "Passed", "Failed", "Total")
Write-Host ("-" * 72)

foreach ($a in $agents) {
    $entry = $archive.GetEntry("$a/eval-result.json")
    if ($entry) {
        $reader = New-Object System.IO.StreamReader($entry.Open())
        $content = $reader.ReadToEnd()
        $reader.Dispose()
        $json = $content | ConvertFrom-Json
        Write-Host ("{0,-15} | {1,-25} | {2,-8} | {3,-8} | {4,-8}" -f $a, $json.verdict, $json.test_results.passed, $json.test_results.failed, $json.test_results.total)
    }
}
$archive.Dispose()

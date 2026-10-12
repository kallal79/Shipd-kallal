Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path "FIXED_agent-runs-KALI-MONSHA.zip"))
$pass = 0
$fail = 0
foreach ($e in $zip.Entries) {
    if ($e.FullName.EndsWith("eval-result.json")) {
        $stream = $e.Open()
        $reader = New-Object System.IO.StreamReader($stream)
        $text = $reader.ReadToEnd()
        $reader.Close()
        $stream.Close()
        $json = ConvertFrom-Json $text
        $agentDir = $e.FullName.Split('/')[0]
        $passed = $json.passed -eq $true -or $json.pass -eq $true -or $json.resolved -eq $true -or $json.is_resolved -eq $true
        Write-Host "$agentDir -> passed: $passed"
        if ($passed) { $pass++ } else { $fail++ }
    }
}
Write-Host "Pass count: $pass"
Write-Host "Fail count: $fail"
Write-Host "Total runs: $($pass + $fail)"
$zip.Dispose()

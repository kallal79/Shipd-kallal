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
        $verdict = $json.verdict
        $isPass = $verdict -like "PASS*"
        Write-Host "$agentDir -> $verdict (isPass: $isPass)"
        if ($isPass) { $pass++ } else { $fail++ }
    }
}
Write-Host "Total Passes: $pass"
Write-Host "Total Fails: $fail"
Write-Host "Pass Rate: $([Math]::Round($pass / ($pass + $fail) * 100, 1))%"
$zip.Dispose()

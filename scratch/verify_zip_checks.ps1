
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('C:/Users/USER/OneDrive/Desktop/JAGAN/FIXED_agent-runs-KALI-MONSHA.zip')

$agents = @{}
foreach ($entry in $zip.Entries) {
    $parts = $entry.FullName -split '[\\/]'
    $agent = $parts[0]
    $file = $parts[1]
    if (-not $agents.ContainsKey($agent)) { $agents[$agent] = @{} }
    $agents[$agent][$file] = $entry
}

Write-Host "Verifying Fair Task, Cheating, and Blockers inside ZIP:"
$allFair = $true
$cheatCount = 0
$blockerCount = 0

foreach ($agent in $agents.Keys | Sort-Object) {
    $evalEntry = $agents[$agent]['eval-result.json']
    $reader = New-Object System.IO.StreamReader($evalEntry.Open())
    $evalText = $reader.ReadToEnd()
    $reader.Close()

    $json = ConvertFrom-Json $evalText
    $env = $json.environment_assessment
    $prob = $json.problem_assessment

    $isUnfair = ($env.agent_blame_unfair -eq $true) -or ($json.verdict -eq 'FAIL_UNFAIR') -or ($prob.description_clear -eq $false)
    $isBlocked = ($env.blocker_detected -eq $true) -or ($env.blocker_type -ne 'none') -or ($json.verdict -eq 'FAIL_ENVIRONMENT')
    $isCheat = ($json.verdict -eq 'FAIL_CHEATING')

    if ($isUnfair) { $allFair = $false }
    if ($isBlocked) { $blockerCount++ }
    if ($isCheat) { $cheatCount++ }

    Write-Host "$agent : isUnfair=$isUnfair, isBlocked=$isBlocked (type=$($env.blocker_type)), isCheat=$isCheat"
}

Write-Host "--- Summary ---"
Write-Host "All Fair: $allFair"
Write-Host "Cheat Count: $cheatCount"
Write-Host "Blocker Count: $blockerCount"

$zip.Dispose()

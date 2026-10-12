const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const psScript = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('C:/Users/USER/OneDrive/Desktop/JAGAN/FIXED_agent-runs-KALI-MONSHA.zip')

$agents = @{}
foreach ($entry in $zip.Entries) {
    $parts = $entry.FullName -split '[\\\\/]'
    $agent = $parts[0]
    $file = $parts[1]
    if (-not $agents.ContainsKey($agent)) { $agents[$agent] = @{} }
    $agents[$agent][$file] = $entry
}

Write-Host "================ ZIP VERIFICATION REPORT ================"
Write-Host "Total Agents Found: $($agents.Keys.Count)"

$passCount = 0
$failCount = 0
$cheatCount = 0
$blockerCount = 0
$unfairCount = 0

foreach ($agent in ($agents.Keys | Sort-Object)) {
    $evalEntry = $agents[$agent]['eval-result.json']
    $reader = New-Object System.IO.StreamReader($evalEntry.Open())
    $evalText = $reader.ReadToEnd()
    $reader.Close()

    $json = ConvertFrom-Json $evalText
    $env = $json.environment_assessment
    $prob = $json.problem_assessment
    $tests = $json.test_results

    $isUnfair = ($env.agent_blame_unfair -eq $true) -or ($json.verdict -eq 'FAIL_UNFAIR') -or ($prob.description_clear -eq $false)
    $isBlocked = ($env.blocker_detected -eq $true) -or ($env.blocker_type -ne 'none') -or ($json.verdict -eq 'FAIL_ENVIRONMENT')
    $isCheat = ($json.verdict -eq 'FAIL_CHEATING')

    if ($isUnfair) { $unfairCount++ }
    if ($isBlocked) { $blockerCount++ }
    if ($isCheat) { $cheatCount++ }

    if ($json.verdict -eq 'PASS_LEGITIMATE') {
        $passCount++
    } else {
        $failCount++
    }

    $patchEntry = $agents[$agent]['solution-patch.patch']
    $patchSize = if ($patchEntry) { $patchEntry.Length } else { 0 }

    Write-Host ("{0,-15} | Verdict: {1,-24} | Passed: {2,2}/{3,2} | Patch: {4,6} B | Unfair: {5} | Blocked: {6} | Cheat: {7}" -f $agent, $json.verdict, $tests.passed, $tests.total, $patchSize, $isUnfair, $isBlocked, $isCheat)
}

Write-Host "=========================================================="
Write-Host "Summary Statistics:"
Write-Host "  Passing Agents: $passCount / $($agents.Keys.Count) ($([math]::Round($passCount / $agents.Keys.Count * 100, 1))%)"
Write-Host "  Failing Agents: $failCount / $($agents.Keys.Count)"
Write-Host "  Unfair Tasks  : $unfairCount"
Write-Host "  Blockers      : $blockerCount"
Write-Host "  Cheating      : $cheatCount"
Write-Host "=========================================================="

$zip.Dispose()
`;

fs.writeFileSync('C:/Users/USER/OneDrive/Desktop/JAGAN/scratch/verify_zip_report.ps1', psScript, 'utf8');
const out = cp.execSync('powershell -ExecutionPolicy Bypass -File C:/Users/USER/OneDrive/Desktop/JAGAN/scratch/verify_zip_report.ps1', { encoding: 'utf8' });
console.log(out);

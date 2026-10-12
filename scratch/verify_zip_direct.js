const fs = require('fs');
const { execSync } = require('child_process');

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

Write-Host "Verifying agents inside ZIP:"
foreach ($agent in $agents.Keys | Sort-Object) {
    $evalEntry = $agents[$agent]['eval-result.json']
    $reader = New-Object System.IO.StreamReader($evalEntry.Open())
    $evalText = $reader.ReadToEnd()
    $reader.Close()

    $junitEntry = $agents[$agent]['junit-new.xml']
    $reader2 = New-Object System.IO.StreamReader($junitEntry.Open())
    $junitText = $reader2.ReadToEnd()
    $reader2.Close()

    $patchEntry = $agents[$agent]['solution-patch.patch']
    $patchLen = if ($patchEntry) { $patchEntry.Length } else { 0 }

    $hasT83 = $junitText.Contains("without data listener")
    $hasT82 = $junitText.Contains("when only maxResponseSize is configured")
    
    Write-Host "$agent : patchLen=$patchLen, hasT83=$hasT83, hasT82=$hasT82"
}
$zip.Dispose()
`;

fs.writeFileSync('C:/Users/USER/OneDrive/Desktop/JAGAN/scratch/verify_zip_direct.ps1', psScript);
const out = execSync('powershell -ExecutionPolicy Bypass -File C:/Users/USER/OneDrive/Desktop/JAGAN/scratch/verify_zip_direct.ps1').toString();
console.log(out);

const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const z1 = 'C:/Users/USER/OneDrive/Desktop/JAGAN/agent-runs - KALI - MONSHA.zip';
const z2 = 'C:/Users/USER/OneDrive/Desktop/JAGAN/agent-runs-CLLBACK-AGENT FINQL ONE...zip';

for (const z of [z1, z2]) {
  console.log('=== ' + path.basename(z) + ' ===');
  const psScript = `
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead('${z.replace(/'/g, "''")}')
    $folders = $archive.Entries | ForEach-Object { ($_.FullName -split '[/\\\\]')[0] } | Select-Object -Unique
    Write-Output "Entry count: $($archive.Entries.Count)"
    Write-Output "Folders: $($folders -join '; ')"
    $archive.Dispose()
  `;
  try {
    const out = cp.execSync(`powershell -NoProfile -Command "${psScript}"`, { encoding: 'utf8' });
    console.log(out);
  } catch (e) {
    console.error(e.message);
  }
}

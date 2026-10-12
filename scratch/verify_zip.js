const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const zipPath = 'C:/Users/USER/OneDrive/Desktop/JAGAN/FIXED_agent-runs-KALI-MONSHA.zip';
const stat = fs.statSync(zipPath);
console.log('Zip file size:', stat.size);

// Use PowerShell to inspect zip entries
const cmd = `powershell -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::OpenRead('${zipPath}').Entries | Select-Object -First 15 -Property FullName, Length"`;
const output = execSync(cmd).toString();
console.log('Sample entries:');
console.log(output);

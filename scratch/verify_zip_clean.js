const cp = require('child_process');

const res = cp.execSync(`powershell -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [System.IO.Compression.ZipFile]::OpenRead('C:/Users/USER/OneDrive/Desktop/JAGAN/FIXED_agent-runs-KALI-MONSHA.zip'); $bs = ($z.Entries | Where-Object { $_.FullName.Contains([char]92) }).Count; Write-Host 'Backslashes:' $bs; Write-Host 'Total entries:' $z.Entries.Count; $z.Dispose()"`, { encoding: 'utf8' });

console.log(res);

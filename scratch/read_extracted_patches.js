const fs = require('fs');
const path = require('path');

const monsha = 'c:/Users/USER/OneDrive/Desktop/JAGAN/extracted_monsha';
const dirs = fs.readdirSync(monsha);

for (const d of dirs) {
  const p = path.join(monsha, d);
  if (!fs.statSync(p).isDirectory()) continue;
  const solPath = path.join(p, 'solution-patch.patch');
  const wsPath = path.join(p, 'workspace-diff.patch');
  console.log(`${d.padEnd(15)}: sol=${fs.existsSync(solPath) ? fs.statSync(solPath).size : 'none'}, ws=${fs.existsSync(wsPath) ? fs.statSync(wsPath).size : 'none'}`);
}

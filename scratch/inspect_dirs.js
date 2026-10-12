const fs = require('fs');
const path = require('path');

const monsha = 'c:/Users/USER/OneDrive/Desktop/JAGAN/extracted_monsha';
if (fs.existsSync(monsha)) {
  const dirs = fs.readdirSync(monsha);
  console.log('Folders in extracted_monsha:', dirs);
  for (const d of dirs) {
    const full = path.join(monsha, d);
    if (fs.statSync(full).isDirectory()) {
      console.log(`\n=== ${d} ===`);
      const files = fs.readdirSync(full);
      console.log('Files:', files);
      if (files.includes('eval-result.json')) {
        const ev = JSON.parse(fs.readFileSync(path.join(full, 'eval-result.json'), 'utf8'));
        console.log('verdict:', ev.verdict, '| summary:', ev.summary);
      }
    }
  }
}

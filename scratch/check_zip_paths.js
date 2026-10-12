const AdmZip = require('adm-zip');
const fs = require('fs');

const zipPath = 'C:/Users/USER/OneDrive/Desktop/JAGAN/FIXED_agent-runs-KALI-MONSHA.zip';
const zip = new AdmZip(zipPath);
const entries = zip.getEntries();

console.log('Total zip entries:', entries.length);
let hasBackslash = false;
for (const entry of entries) {
  if (entry.entryName.includes('\\')) {
    hasBackslash = true;
    console.log('Found backslash in:', entry.entryName);
  }
}
console.log('Has any backslash?', hasBackslash);
console.log('Sample entry names:');
entries.slice(0, 10).forEach(e => console.log('  ', e.entryName));

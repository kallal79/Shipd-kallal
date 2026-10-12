const fs = require('fs');

const files = [
  'FINAL_CLEAN_SOLUTION.patch',
  'solution.patch',
  'FINAL_SUBMISSION_solution.patch',
  'FINAL_solution.patch',
  'SUBMIT_SOLUTION.patch',
  'check_sol.patch',
  'check_sol_utf8.patch'
];

for (const file of files) {
  const fullPath = 'c:/Users/USER/OneDrive/Desktop/JAGAN/' + file;
  if (!fs.existsSync(fullPath)) continue;
  const buf = fs.readFileSync(fullPath);
  let text = '';
  let encoding = 'utf8';
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    encoding = 'utf16le';
    text = buf.toString('utf16le');
  } else {
    text = buf.toString('utf8');
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const gitDiffLines = lines.filter(l => l.startsWith('diff --git'));
  console.log(`${file}:`);
  console.log(`  Encoding: ${encoding}, Raw Bytes: ${buf.length}, Lines: ${lines.length}`);
  console.log(`  Modified Files:`, gitDiffLines);
}

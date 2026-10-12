const fs = require('fs');

const p1 = fs.readFileSync('c:/Users/USER/OneDrive/Desktop/JAGAN/scratch/FINAL_CLEAN_SOLUTION_utf8.patch', 'utf8');
const p2 = fs.readFileSync('c:/Users/USER/OneDrive/Desktop/JAGAN/solution.patch', 'utf8');

// Normalize line endings
const p1Lines = p1.replace(/\r\n/g, '\n').split('\n');
const p2Lines = p2.replace(/\r\n/g, '\n').split('\n');

console.log('p1 lines:', p1Lines.length, 'p2 lines:', p2Lines.length);

// Let's check which files are modified in p1 vs p2
function getFiles(lines) {
  return lines.filter(l => l.startsWith('diff --git'));
}

console.log('Files in p1:', getFiles(p1Lines));
console.log('Files in p2:', getFiles(p2Lines));

const fs = require('fs');

const utf16Content = fs.readFileSync('c:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_SOLUTION.patch', 'utf16le');
console.log('Decoded UTF-16 text length:', utf16Content.length);

const solPatchContent = fs.readFileSync('c:/Users/USER/OneDrive/Desktop/JAGAN/solution.patch', 'utf8');
console.log('solution.patch text length:', solPatchContent.length);

console.log('Are they identical?', utf16Content === solPatchContent);

if (utf16Content !== solPatchContent) {
  console.log('Showing diff size...');
  fs.writeFileSync('c:/Users/USER/OneDrive/Desktop/JAGAN/scratch/FINAL_CLEAN_SOLUTION_utf8.patch', utf16Content, 'utf8');
}

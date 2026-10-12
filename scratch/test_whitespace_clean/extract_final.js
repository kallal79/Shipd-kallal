const fs = require('fs');

const content = fs.readFileSync('C:\\Users\\USER\\.gemini\\antigravity-ide\\brain\\f29e6f2f-bcd8-477d-8357-39eab894d1cd\\final_submission_full.md', 'utf8');

const promptMatch = content.match(/### Prompt\s+```markdown\s+([\s\S]*?)\s+```/);
const solutionMatch = content.match(/### Solution Patch\s+```diff\s+([\s\S]*?)\s+```/);
const testMatch = content.match(/### Test Patch\s+```diff\s+([\s\S]*?)\s+```/);

if (promptMatch) {
  fs.writeFileSync('C:\\Users\\USER\\OneDrive\\Desktop\\JAGAN\\FINAL_prompt.md', promptMatch[1].trim() + '\n');
}
if (solutionMatch) {
  fs.writeFileSync('C:\\Users\\USER\\OneDrive\\Desktop\\JAGAN\\FINAL_solution.patch', solutionMatch[1].trim() + '\n');
}
if (testMatch) {
  fs.writeFileSync('C:\\Users\\USER\\OneDrive\\Desktop\\JAGAN\\FINAL_test.patch', testMatch[1].trim() + '\n');
}

console.log('Files written successfully');

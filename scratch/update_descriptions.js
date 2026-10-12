const fs = require('fs');
const path = require('path');

const files = [
  'problem_description.md',
  'OPTIMIZED_PROBLEM_DESCRIPTION.txt',
  'REFINED_problem_description.md',
  'prompt.md',
  'prompt.txt'
];

files.forEach(f => {
  const p = path.join(__dirname, '..', f);
  if (fs.existsSync(p)) {
    let content = fs.readFileSync(p, 'utf8');
    content = content.replace('HTTP/2 (.http2()) requests.', 'HTTP/2 requests.');
    fs.writeFileSync(p, content, 'utf8');
    console.log(`Updated ${f}`);
  }
});

const fs = require('fs');
const crypto = require('crypto');

function checkFile(name) {
  if (!fs.existsSync(name)) return 'NOT FOUND';
  const data = fs.readFileSync(name);
  const hash = crypto.createHash('md5').update(data).digest('hex');
  return hash + ' (' + data.length + ' bytes)';
}

console.log('--- FINAL SUBMISSION FILES AUDIT ---');
console.log('problem_description.md:          ' + checkFile('problem_description.md'));
console.log('REFINED_problem_description.md:  ' + checkFile('REFINED_problem_description.md'));
console.log('FINAL_CLEAN_SOLUTION.patch:      ' + checkFile('FINAL_CLEAN_SOLUTION.patch'));
console.log('FINAL_solution.patch:            ' + checkFile('FINAL_solution.patch'));
console.log('solution.patch:                  ' + checkFile('solution.patch'));
console.log('FINAL_CLEAN_TEST.patch:          ' + checkFile('FINAL_CLEAN_TEST.patch'));
console.log('FINAL_test.patch:                ' + checkFile('FINAL_test.patch'));
console.log('test.patch:                      ' + checkFile('test.patch'));
console.log('FIXED_agent-runs-KALI-MONSHA.zip:' + checkFile('FIXED_agent-runs-KALI-MONSHA.zip'));
console.log('Dockerfile:                      ' + checkFile('Dockerfile'));

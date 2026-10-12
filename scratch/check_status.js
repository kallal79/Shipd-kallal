const fs = require('fs');

const content = fs.readFileSync('FINAL_CLEAN_TEST.patch', 'utf8');
const itMatches = content.match(/^\+\s*it\(/gm);
console.log('Tests in FINAL_CLEAN_TEST.patch:', itMatches ? itMatches.length : 0);

const solContent = fs.readFileSync('FINAL_CLEAN_SOLUTION.patch', 'utf8');
console.log('Solution patch lines:', solContent.split('\n').length);
const touched = solContent.split('\n')
  .filter(l => l.startsWith('diff --git a/'))
  .map(l => l.replace('diff --git a/', '').split(' ')[0]);
console.log('Touched files in solution patch:', touched);

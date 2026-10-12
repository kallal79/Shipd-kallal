const f = require('fs').readFileSync('superagent/test/node/size_limits_compliance_b5e2d.js', 'utf8');
const lines = f.split('\n');
let testNum = 0;
const tests = [];
for(let i=0;i<lines.length;i++) {
  const m = lines[i].match(/^\s+it\(['"](.*?)['"],/);
  if(m) {
    testNum++;
    tests.push({num: testNum, line: i+1, title: m[1].substring(0,130)});
  }
}
console.log('Total tests:', testNum);
// Show tests 121-133 (the potentially new ones)
console.log('\n--- Tests #121 to #' + tests.length + ' (potentially new) ---');
for(let t = 120; t < tests.length; t++) {
  console.log('#' + tests[t].num + ' (L' + tests[t].line + '): ' + tests[t].title);
}

// Also identify which of the 4 failing tests are by their line numbers
console.log('\n--- 4 tests failing for previously-passing agents ---');
const failLines = [3466, 3530, 5589, 5760];
for(const fl of failLines) {
  const idx = tests.findIndex(t => t.line === fl);
  if(idx >= 0) console.log('#' + tests[idx].num + ' (L' + tests[idx].line + '): ' + tests[idx].title);
}

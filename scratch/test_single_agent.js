const cp = require('child_process');
const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = ROOT + '/superagent';

try {
  const res = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit --timeout 400 --reporter json', {
    cwd: SUPERAGENT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 120000
  });
  console.log('Result passed completely:', JSON.parse(res).stats);
} catch (e) {
  if (e.stdout) {
    const s = e.stdout;
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      try {
        const parsed = JSON.parse(s.slice(start, end + 1));
        console.log('Mocha stats for Nova 2:', parsed.stats);
        console.log('Number of failures:', parsed.failures.length);
        console.log('Sample failure titles:', parsed.failures.slice(0, 5).map(f => f.title));
      } catch (err) {
        console.log('JSON parse error:', err.message);
      }
    }
  } else {
    console.log('Exec error:', e.message);
  }
}

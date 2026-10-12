const fs = require('fs');
const path = require('path');

const monshaDir = 'C:/Users/USER/OneDrive/Desktop/JAGAN/extracted_monsha';
const agents = fs.readdirSync(monshaDir).filter(f => fs.statSync(path.join(monshaDir, f)).isDirectory());

console.log('Total agent directories:', agents.length);

const targetT83 = 'without data listener';
const targetT82 = 'when only maxResponseSize is configured';

for (const agent of agents) {
  const dir = path.join(monshaDir, agent);
  const evalFile = path.join(dir, 'eval-result.json');
  const junitFile = path.join(dir, 'junit-new.xml');
  const logFile = path.join(dir, 'test-log.txt');

  const evalJson = JSON.parse(fs.readFileSync(evalFile, 'utf8'));
  const junitText = fs.readFileSync(junitFile, 'utf8');
  const logText = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';

  const junitHasT83 = junitText.includes(targetT83);
  const junitHasT82 = junitText.includes(targetT82);
  const totalTests = evalJson.test_results ? evalJson.test_results.total : evalJson.total;
  const passedTests = evalJson.test_results ? evalJson.test_results.passed : evalJson.passed;

  console.log(`${agent}: verdict=${evalJson.verdict} tests=${passedTests}/${totalTests} hasT83=${junitHasT83} hasT82=${junitHasT82}`);
}

const AdmZip = require('../superagent/node_modules/adm-zip');
const zip = new AdmZip('./FIXED_agent-runs-KALI-MONSHA.zip');
const dirs = [
  'Nova_Nova_1', 'Nova_Nova_2', 'Nova_Nova_3', 'Nova_Nova_4', 'Nova_Nova_5',
  'Nova_Nova_6', 'Nova_Nova_7', 'Nova_Nova_8', 'Nova_Nova_9', 'Nova_Nova_10',
  'Orion_Nova'
];
dirs.forEach(d => {
  const evalEntry = zip.getEntry(d + '/eval-result.json');
  const evalData = JSON.parse(evalEntry.getData().toString('utf8'));
  const xmlEntry = zip.getEntry(d + '/junit-new.xml');
  const xml = xmlEntry.getData().toString('utf8');
  const testsMatch = xml.match(/tests="(\d+)"/);
  const failsMatch = xml.match(/failures="(\d+)"/);
  const tests = testsMatch ? testsMatch[1] : '?';
  const fails = failsMatch ? failsMatch[1] : '?';
  console.log(d.padEnd(15), 'verdict:', (evalData.verdict || evalData.status).padEnd(6), 'tests:', tests, 'fails:', fails, 'passes:', Number(tests) - Number(fails));
});

const cp = require('child_process');
try {
  const out = cp.execSync('wmic process where "name=\'node.exe\'" get ProcessId,CommandLine /format:list', { encoding: 'utf8' });
  console.log(out);
} catch (e) {
  console.error(e.message);
}

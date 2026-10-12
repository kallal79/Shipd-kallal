const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = path.join(ROOT, 'superagent');
const MONSHA_DIR = path.join(ROOT, 'fresh_extracted_zip');
const TEST_PATCH = path.join(ROOT, 'FINAL_CLEAN_TEST.patch');

const agents = fs.readdirSync(MONSHA_DIR).filter(f => fs.statSync(path.join(MONSHA_DIR, f)).isDirectory());

console.log('Found agents in fresh_extracted_zip:', agents);

for (const agent of agents) {
  const patchPath = path.join(MONSHA_DIR, agent, 'solution-patch.patch');
  if (fs.existsSync(patchPath)) {
    const size = fs.statSync(patchPath).size;
    console.log(`Agent ${agent}: solution-patch.patch size = ${size} bytes`);
  } else {
    console.log(`Agent ${agent}: NO solution-patch.patch`);
  }
}

const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SUPERAGENT = path.join(ROOT, 'superagent');
const bundle = path.join(ROOT, 'superagent_repo.bundle');
const targetGit = path.join(SUPERAGENT, '.git');
const internalGit = path.join(SUPERAGENT, '.git_internal');

if (!fs.existsSync(targetGit)) {
  if (fs.existsSync(internalGit)) {
    console.log('Restoring superagent .git from local .git_internal...');
    fs.cpSync(internalGit, targetGit, { recursive: true });
    console.log('superagent .git restored successfully!');
  } else if (fs.existsSync(bundle)) {
    console.log('Restoring superagent .git from superagent_repo.bundle...');
    const tempDir = path.join(ROOT, 'temp_superagent_clone');
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    cp.execSync(`git clone "${bundle}" "${tempDir}"`, { stdio: 'inherit' });
    fs.renameSync(path.join(tempDir, '.git'), targetGit);
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('superagent .git restored successfully from bundle!');
  }
} else {
  console.log('superagent .git already exists.');
}

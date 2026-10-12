const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'c:/Users/USER/OneDrive/Desktop/JAGAN';
const REPO = path.join(ROOT, 'superagent');

console.log('1. Resetting repo...');
execSync('git reset --hard 7539854 && git clean -fd', { cwd: REPO });

console.log('2. Applying test patch with --whitespace=fix...');
// Revert the string edit from clean_test_patch_eof by using our script from rebuild_all_clean_patches
// Let's first restore FINAL_CLEAN_TEST.patch from git diff if files are present, or apply with whitespace fix:
// Let's restore from rebuild_all_clean_patches logic:
// We need test.sh and test/node/size_limits_compliance_b5e2d.js

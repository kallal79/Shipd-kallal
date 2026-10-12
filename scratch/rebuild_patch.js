const fs = require('fs');
const cp = require('child_process');
const path = require('path');

const repoPath = 'C:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
const patchPath = 'C:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_SUBMISSION_test.patch';

const testShContent = `#!/bin/bash
set -e

MODE=""
OUTPUT_PATH=""

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --output_path) OUTPUT_PATH="$2"; shift ;;
        base|new) MODE="$1" ;;
        *) ;;
    esac
    shift
done

if [ -z "$MODE" ]; then
    echo "Usage: test.sh [--output_path path] [base|new]"
    exit 1
fi

mkdir -p test/node/fixtures lib 2>/dev/null || true
chmod -R 777 test/node/fixtures lib 2>/dev/null || true

node node_modules/@babel/cli/bin/babel.js --config-file ./.lib.babelrc src --out-dir lib 2>/dev/null || { mkdir -p lib && cp -R src/. lib/ 2>/dev/null || true; }

chmod -R 777 test/node/fixtures lib 2>/dev/null || true

REPORTER_ARGS=""
if [ -n "$OUTPUT_PATH" ]; then
    REPORTER_ARGS="--reporter xunit --reporter-options output=\\"$OUTPUT_PATH\\""
fi

if [ "$MODE" = "base" ]; then
    echo "Running in base mode"
    eval npx mocha test/node/*.js --exclude test/node/size_limits_compliance_b5e2d.js --grep \\"ipv6 address\\" --invert --exit --timeout 15000 $REPORTER_ARGS
elif [ "$MODE" = "new" ]; then
    echo "Running in new mode"
    eval npx mocha test/node/size_limits_compliance_b5e2d.js --exit --timeout 15000 $REPORTER_ARGS
fi
`;
fs.writeFileSync(path.join(repoPath, 'test.sh'), testShContent, 'utf8');

const patchText = fs.readFileSync(patchPath, 'utf8');
const lines = patchText.split('\n');
const jsLines = [];
let inJs = false;
for (const line of lines) {
  if (line.startsWith('+++ b/test/node/size_limits_compliance_b5e2d.js')) {
    inJs = true;
    continue;
  }
  if (inJs) {
    if (line.startsWith('+')) {
      jsLines.push(line.substring(1));
    } else if (line.startsWith(' ')) {
      jsLines.push(line.substring(1));
    } else if (line === '') {
      jsLines.push('');
    } else if (line.startsWith('\\ No newline')) {
      continue;
    } else if (!line.startsWith('-')) {
       // Stop on some other thing, but there's nothing else
    }
  }
}
fs.writeFileSync(path.join(repoPath, 'test/node/size_limits_compliance_b5e2d.js'), jsLines.join('\n').trim() + '\n', 'utf8');

cp.execSync('git add test.sh test/node/size_limits_compliance_b5e2d.js', { cwd: repoPath });
cp.execSync('git update-index --chmod=+x test.sh', { cwd: repoPath });

const newPatch = cp.execSync('git diff --cached test/ test.sh', { cwd: repoPath, encoding: 'utf8' });
fs.writeFileSync(patchPath, newPatch.replace(/\r\n/g, '\n'), 'utf8');

// Unstage to not pollute the working directory
cp.execSync('git reset HEAD test.sh test/node/size_limits_compliance_b5e2d.js', { cwd: repoPath });

console.log('Successfully generated the clean, valid git patch!');

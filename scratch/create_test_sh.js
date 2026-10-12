const fs = require('fs');

const content = `#!/bin/bash
MODE=""
OUTPUT_PATH=""

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        base|new) MODE="$1"; shift ;;
        --output_path) OUTPUT_PATH="$2"; shift 2 ;;
        *) shift ;;
    esac
done

if [ -z "$MODE" ]; then
    MODE="default"
fi

REPORTER_ARGS=""
if [ -n "$OUTPUT_PATH" ]; then
    mkdir -p "$(dirname "$OUTPUT_PATH")" 2>/dev/null || true
    if [ -d "node_modules/mocha-junit-reporter" ]; then
        REPORTER_ARGS="--reporter mocha-junit-reporter --reporter-options mochaFile=\${OUTPUT_PATH}"
    else
        REPORTER_ARGS="--reporter xunit --reporter-options output=\${OUTPUT_PATH}"
    fi
fi

echo "Running \${MODE} mode" >&2

# Build lib if babel hasn't compiled yet
npm run build:lib >/dev/null 2>&1 || true

MOCHA="./node_modules/.bin/mocha"
if ! command -v "$MOCHA" >/dev/null 2>&1 && ! [ -f "$MOCHA" ]; then
    MOCHA="npx mocha"
fi

if [ "$MODE" = "base" ]; then
    # Base mode: run baseline tests that pass at the base commit
    $MOCHA test/support/setup.js test/node/utils.js --timeout 15000 --exit $REPORTER_ARGS
elif [ "$MODE" = "new" ]; then
    # New mode: run new verification tests
    $MOCHA test/support/setup.js test/node/size_limits_compliance_b5e2d.js --timeout 15000 --exit $REPORTER_ARGS
else
    # Default mode: run verification tests
    $MOCHA test/support/setup.js test/node/size_limits_compliance_b5e2d.js --timeout 15000 --exit $REPORTER_ARGS
fi
`.replace(/\r\n/g, '\n');

fs.writeFileSync('C:/Users/USER/OneDrive/Desktop/JAGAN/superagent/test.sh', content, { mode: 0o755, encoding: 'utf8' });
console.log('Written test.sh with mode 0755 and LF line endings');

#!/bin/bash
set -e

MODE=""
OUTPUT_PATH=""

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --mode)
            MODE="$2"
            shift 2
            ;;
        --mode=*)
            MODE="${1#*=}"
            shift
            ;;
        -m)
            MODE="$2"
            shift 2
            ;;
        base|new)
            MODE="$1"
            shift
            ;;
        --output_path)
            OUTPUT_PATH="$2"
            shift 2
            ;;
        --output_path=*)
            OUTPUT_PATH="${1#*=}"
            shift
            ;;
        -o)
            OUTPUT_PATH="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

if [ -z "$MODE" ]; then
    MODE="${TEST_MODE:-${MODE:-new}}"
fi

REPORTER_ARGS=""
if [ -n "$OUTPUT_PATH" ]; then
    mkdir -p "$(dirname "$OUTPUT_PATH")" 2>/dev/null || true
    REPORTER_ARGS="--reporter xunit --reporter-options output=${OUTPUT_PATH}"
fi

echo "Running ${MODE} mode" >&2

# Build lib from src using committed tooling
if [ -f "./node_modules/.bin/babel" ]; then
    ./node_modules/.bin/babel --config-file ./.lib.babelrc src --out-dir lib >/dev/null 2>&1 || true
elif command -v babel >/dev/null 2>&1; then
    babel --config-file ./.lib.babelrc src --out-dir lib >/dev/null 2>&1 || true
fi

# Locate mocha without package installation
if [ -f "./node_modules/.bin/mocha" ]; then
    MOCHA="./node_modules/.bin/mocha"
elif command -v mocha >/dev/null 2>&1; then
    MOCHA="mocha"
elif [ -f "./node_modules/mocha/bin/mocha" ]; then
    MOCHA="node ./node_modules/mocha/bin/mocha"
else
    MOCHA="mocha"
fi

if [ "$MODE" = "base" ]; then
    # Base mode: run baseline test suite that passes on the base commit
    $MOCHA test/support/setup.js test/node/utils.js test/node/agency.js --timeout 15000 --exit $REPORTER_ARGS
elif [ "$MODE" = "new" ]; then
    # New mode: run new verification compliance test suite
    $MOCHA test/support/setup.js test/node/size_limits_compliance_b5e2d.js --timeout 15000 --exit $REPORTER_ARGS
else
    # Default fallback: run new compliance test suite
    $MOCHA test/support/setup.js test/node/size_limits_compliance_b5e2d.js --timeout 15000 --exit $REPORTER_ARGS
fi

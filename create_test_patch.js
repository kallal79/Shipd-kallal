const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const superagentDir = path.join(__dirname, 'superagent');

const testSh = `#!/bin/bash
MODE=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --mode) MODE="$2"; shift; shift ;;
    *) shift ;;
  esac
done

if [ "$MODE" = "base" ]; then
    ./node_modules/.bin/mocha test/support/setup.js test/node/utils.js test/node/client_mock.js --timeout 10000 --exit $REPORTER_ARGS
elif [ "$MODE" = "new" ]; then
    ./node_modules/.bin/mocha test/node/hidden_verify.js test/node/client_mock.js --timeout 10000 --exit $REPORTER_ARGS
else
    ./node_modules/.bin/mocha test/support/setup.js test/node/utils.js test/node/hidden_verify.js test/node/client_mock.js --timeout 10000 --exit $REPORTER_ARGS
fi
`;

const clientMock = `// Setup mock for browser testing
const request = require('../../src/client');

class MockXHR {
  constructor() {
    this.upload = {
      addEventListener: (evt, cb) => {
        if (evt === 'progress') this._uploadProgress = cb;
      }
    };
    this.listeners = {};
    this.readyState = 0;
  }
  addEventListener(evt, cb) { this.listeners[evt] = cb; }
  open(method, url) { this.method = method; this.url = url; this.readyState = 1; }
  setRequestHeader() {}
  send(data) {
    if (this._uploadProgress && data && data.length > 5) {
      this._uploadProgress({ direction: 'upload', loaded: data.length, total: data.length });
    }
    setTimeout(() => {
      if (this.listeners.progress) {
        this.listeners.progress({ direction: 'download', loaded: 100, total: 100 });
      }
    }, 10);
  }
  abort() {
    this.aborted = true;
  }
}

// Ensure the MockXHR is exposed globally
global.MockXHR = MockXHR;

describe('Mock Setup', () => {
  it('should override getXHR', () => {
    // Only used during specific tests
  });
});
`;

const hiddenVerify = `const assert = require('assert');
const http = require('http');
const request = require('../..');
const Stream = require('stream');

describe('hidden verification tests', function () {
  let server;
  let base;

  before((done) => {
    server = http.createServer((req, res) => {
      if (req.url === '/echo') {
        req.pipe(res);
      } else if (req.url === '/chunked') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.write('hello');
        setTimeout(() => res.end('world'), 10);
      } else if (req.url === '/multipart') {
        let size = 0;
        req.on('data', chunk => size += chunk.length);
        req.on('end', () => res.end('ok'));
      } else {
        res.end('ok');
      }
    });
    server.listen(0, () => {
      base = \`http://localhost:\${server.address().port}\`;
      done();
    });
  });

  after((done) => {
    server.close(done);
  });

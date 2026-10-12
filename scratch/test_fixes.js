const assert = require('assert');
const http = require('http');
const path = require('path');
const EventEmitter = require('events');

async function testAll() {
  console.log('Testing Fix 1: err.retries === 0 unconditionally without .retry() (Node)...');
  const requestNode = require(path.resolve(__dirname, '../superagent/src/node/index.js'));
  
  // 1a. Node maxRequestSize without .retry()
  await new Promise((resolve, reject) => {
    requestNode
      .post('http://127.0.0.1:9999/dummy')
      .maxRequestSize(5)
      .send('1234567890')
      .end((err, res) => {
        try {
          assert(err, 'Expected error');
          assert.strictEqual(err.code, 'ETOOLARGE');
          assert.strictEqual(err.retries, 0, 'err.retries must be 0 unconditionally');
          console.log('  1a Passed: Node maxRequestSize without .retry() has err.retries === 0');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
  });

  // 1b. Node maxResponseSize without .retry()
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Length': '20' });
    res.end('01234567890123456789');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  await new Promise((resolve, reject) => {
    requestNode
      .get(`http://127.0.0.1:${port}`)
      .maxResponseSize(5)
      .end((err, res) => {
        try {
          assert(err, 'Expected error');
          assert.strictEqual(err.code, 'ETOOLARGE');
          assert.strictEqual(err.retries, 0, 'err.retries must be 0 unconditionally for response size');
          console.log('  1b Passed: Node maxResponseSize without .retry() has err.retries === 0');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
  });
  server.close();

  console.log('Testing Fix 2: Browser tests...');
  const client = require(path.resolve(__dirname, '../superagent/src/client.js'));

  client.getXHR = () => ({
    open() {},
    setRequestHeader() {},
    addEventListener() {},
    removeEventListener() {},
    send() {},
    abort() {}
  });

  // 2a. Browser maxRequestSize without .retry()
  await new Promise((resolve, reject) => {
    client
      .post('http://example.com/upload')
      .maxRequestSize(5)
      .send('1234567890')
      .end((err, res) => {
        try {
          assert(err, 'Expected error');
          assert.strictEqual(err.code, 'ETOOLARGE');
          assert.strictEqual(err.retries, 0, 'err.retries must be 0 unconditionally in browser');
          console.log('  2a Passed: Browser maxRequestSize without .retry() has err.retries === 0');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
  });

  // 2b. Browser size error on a retry settles callback
  console.log('Testing Fix 3: Browser size error on retry...');
  let attempt = 0;
  class MockXHRRetry extends EventEmitter {
    constructor() {
      super();
      attempt++;
      this.attempt = attempt;
      this.readyState = 0;
      this.status = 0;
      this.response = '';
      this.responseText = '';
      this.headers = {};
    }
    open(method, url) {
      this.method = method;
      this.url = url;
      this.readyState = 1;
    }
    setRequestHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    }
    getResponseHeader(k) {
      if (this.attempt === 1) return null;
      if (k.toLowerCase() === 'content-length') return '100';
      if (k.toLowerCase() === 'content-type') return 'text/plain';
      return null;
    }
    getAllResponseHeaders() {
      if (this.attempt === 1) return '';
      return 'content-length: 100\r\ncontent-type: text/plain\r\n';
    }
    addEventListener(e, cb) { this.on(e, cb); }
    removeEventListener(e, cb) { this.off(e, cb); }
    send(data) {
      setTimeout(() => {
        if (this.attempt === 1) {
          // First attempt: 500 error
          this.status = 500;
          this.readyState = 4;
          this.responseText = 'Internal Server Error';
          this.response = 'Internal Server Error';
          this.emit('readystatechange');
          this.emit('load');
        } else {
          // Second attempt: 200 response with 100 bytes (exceeds maxResponseSize of 10)
          this.status = 200;
          this.readyState = 4;
          this.responseText = 'a'.repeat(100);
          this.response = 'a'.repeat(100);
          this.emit('readystatechange');
          this.emit('load');
        }
      }, 10);
    }
    abort() {
      this.status = 0;
      this.readyState = 0;
      this.emit('abort');
    }
  }

  const origGetXHR = client.getXHR;
  client.getXHR = () => new MockXHRRetry();

  await new Promise((resolve, reject) => {
    client
      .get('http://example.com/test')
      .retry(1)
      .maxResponseSize(10)
      .end((err, res) => {
        try {
          assert(err, 'Expected size error');
          assert.strictEqual(err.code, 'ETOOLARGE');
          assert.strictEqual(err.retries, 0, 'Size errors must have retries === 0');
          console.log('  2b Passed: Browser size error on retry settled callback with ETOOLARGE and retries=0');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
  });

  // 2c. Browser non-identity Content-Encoding (e.g. zstd)
  console.log('Testing Fix 4: Browser non-identity Content-Encoding (zstd)...');
  class MockXHRZstd extends EventEmitter {
    constructor() {
      super();
      this.readyState = 0;
      this.status = 0;
    }
    open(method, url) {
      this.readyState = 1;
    }
    setRequestHeader(k, v) {}
    getResponseHeader(k) {
      const lower = k.toLowerCase();
      if (lower === 'content-encoding') return 'zstd';
      if (lower === 'content-length') return '50';
      if (lower === 'content-type') return 'application/octet-stream';
      return null;
    }
    getAllResponseHeaders() {
      return 'content-encoding: zstd\r\ncontent-length: 50\r\ncontent-type: application/octet-stream\r\n';
    }
    addEventListener(e, cb) { this.on(e, cb); }
    removeEventListener(e, cb) { this.off(e, cb); }
    send(data) {
      setTimeout(() => {
        this.status = 200;
        this.readyState = 4;
        // decoded response is 5000 bytes ArrayBuffer, while Content-Length was 50
        this.response = new Uint8Array(5000).buffer;
        this.emit('readystatechange');
        this.emit('load');
      }, 10);
    }
    abort() {
      this.status = 0;
      this.readyState = 0;
      this.emit('abort');
    }
  }

  client.getXHR = () => new MockXHRZstd();

  await new Promise((resolve, reject) => {
    client
      .get('http://localhost/test')
      .maxResponseSize(100)
      .end((err, res) => {
        try {
          assert(err, 'Expected size error for zstd response');
          assert.strictEqual(err.code, 'ETOOLARGE');
          assert.strictEqual(err.retries, 0);
          console.log('  2c Passed: Browser zstd compressed response correctly aborted on decoded size');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
  });

  // 2d. Node _endCalled preserved after retry
  console.log('Testing Fix 5: Node _endCalled preserved after retry...');
  let nodeAttempt = 0;
  const retryServer = http.createServer((req, res) => {
    nodeAttempt++;
    if (nodeAttempt === 1) {
      res.writeHead(500);
      res.end('Internal Server Error');
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Hello world');
    }
  });
  await new Promise(r => retryServer.listen(0, '127.0.0.1', r));
  const retryPort = retryServer.address().port;

  await new Promise((resolve, reject) => {
    requestNode
      .get(`http://127.0.0.1:${retryPort}`)
      .retry(1)
      .end((err, res) => {
        try {
          assert.ifError(err);
          assert.strictEqual(res.status, 200);
          // Check that res.pipe throws error because .end() was already called
          let threw = false;
          try {
            res.pipe(process.stdout);
          } catch (pipeErr) {
            threw = true;
            assert(pipeErr.message.includes('end() has already been called'));
          }
          assert(threw, 'res.pipe() must throw because .end() was called');
          console.log('  2d Passed: res.pipe() throws after retry because _endCalled was preserved');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
  });
  retryServer.close();

  client.getXHR = origGetXHR;
  console.log('\nALL 5 TESTS PASSED SUCCESSFULLY!');
}

testAll().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

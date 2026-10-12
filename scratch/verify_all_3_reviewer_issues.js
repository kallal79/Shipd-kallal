const request = require('../superagent');
const assert = require('assert');
const http = require('http');

console.log('='.repeat(70));
console.log('TESTING ALL 3 REVIEWER FINDINGS LOCALLY');
console.log('='.repeat(70));

// =========================================================================
// Finding 1: Unbuffered limited responses retry post-header ECONNRESET & replay multipart
// =========================================================================
function testFinding1(done) {
  console.log('\n[TESTING FINDING 1] Unbuffered limited response retrying post-header ECONNRESET with multipart replay...');

  let attemptCount = 0;
  let attempt2BodyReceived = '';

  const server = http.createServer((req, res) => {
    attemptCount++;
    console.log(`  Server received attempt #${attemptCount} for ${req.url}`);

    if (attemptCount === 1) {
      // Consume body chunks
      req.on('data', () => {});
      req.on('end', () => {
        // Send 200 headers then drop socket with ECONNRESET before response ends
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.flushHeaders();
        setTimeout(() => {
          req.socket.destroy(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
        }, 20);
      });
    } else {
      // Attempt 2: verify multipart fields are replayed
      let body = '';
      req.on('data', (chunk) => { body += chunk.toString(); });
      req.on('end', () => {
        attempt2BodyReceived = body;
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('retry-success-payload');
      });
    }
  });

  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;

    request
      .post(`http://127.0.0.1:${port}/test-unbuf-retry`)
      .field('greeting', 'hello_multipart')
      .field('item', 'apple')
      .maxResponseSize(1000)
      .buffer(false)
      .retry(1)
      .end((err, res) => {
        assert.ifError(err);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(attemptCount, 2, 'Expected 2 attempts (retried after post-header ECONNRESET)');
        assert(attempt2BodyReceived.includes('hello_multipart'), 'Expected replayed multipart field "greeting"');
        assert(attempt2BodyReceived.includes('apple'), 'Expected replayed multipart field "item"');
        console.log('  ✅ FINDING 1 VERIFIED: Unbuffered request retried post-header ECONNRESET and successfully replayed multipart body!');

        server.close(done);
      });
  });
}

// =========================================================================
// Finding 2: Forced size decoding does NOT break request-event binary responseType overrides
// =========================================================================
function testFinding2(done) {
  console.log('\n[TESTING FINDING 2] request-event binary responseType override preservation...');
  const clientRequest = require('../superagent/lib/client');
  const EventEmitter = require('events');

  class MockBinaryXHR extends EventEmitter {
    constructor() {
      super();
      this.readyState = 1;
      this.status = 200;
      // 8-byte ArrayBuffer
      const buf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
      this.response = buf;
      this._responseType = '';
    }
    get responseType() { return this._responseType; }
    set responseType(val) { this._responseType = val; }
    open() {}
    setRequestHeader() {}
    getAllResponseHeaders() {
      return 'Content-Type: application/octet-stream\r\n';
    }
    getResponseHeader(name) {
      if (name && name.toLowerCase() === 'content-type') return 'application/octet-stream';
      return null;
    }
    send() {
      setTimeout(() => {
        this.readyState = 4;
        this.status = 200;
        this.emit('readystatechange');
        this.emit('load');
      }, 10);
    }
    abort() { this.emit('abort'); }
    addEventListener(e, cb) { this.on(e, cb); }
    removeEventListener(e, cb) { this.off(e, cb); }
  }

  clientRequest.getXHR = () => new MockBinaryXHR();

  // Request configured with maxResponseSize AND an on('request') listener that sets responseType = 'arraybuffer'
  clientRequest
    .get('http://example.com/binary-data')
    .maxResponseSize(100)
    .on('request', function () {
      this.xhr.responseType = 'arraybuffer';
    })
    .end((err, res) => {
      assert.ifError(err);
      assert(res.body instanceof ArrayBuffer, 'Expected res.body to be an ArrayBuffer, not string/text!');
      assert.strictEqual(res.body.byteLength, 8);
      console.log('  ✅ FINDING 2 VERIFIED: Listener setting xhr.responseType="arraybuffer" produces res.body instanceof ArrayBuffer!');
      done();
    });
}

// =========================================================================
// Finding 3: 307/308 redirects preserve FormData body without retries enabled
// =========================================================================
function testFinding3(done) {
  console.log('\n[TESTING FINDING 3] 307/308 FormData redirect preserves body (default retries = 0)...');

  let initialReceivedBody = '';
  let redirectReceivedBody = '';

  const server = http.createServer((req, res) => {
    if (req.url === '/initial-307') {
      let body = '';
      req.on('data', (c) => { body += c.toString(); });
      req.on('end', () => {
        initialReceivedBody = body;
        res.writeHead(307, {
          Location: '/target-307',
          'Content-Type': 'text/plain'
        });
        res.end('redirecting');
      });
    } else if (req.url === '/target-307') {
      let body = '';
      req.on('data', (c) => { body += c.toString(); });
      req.on('end', () => {
        redirectReceivedBody = body;
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('target-ok');
      });
    }
  });

  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;

    // Notice: retry is NOT configured (default retry count = 0)
    request
      .post(`http://127.0.0.1:${port}/initial-307`)
      .field('username', 'alice')
      .field('token', 'xyz123')
      .maxRequestSize(1000)
      .end((err, res) => {
        assert.ifError(err);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.text, 'target-ok');
        assert(initialReceivedBody.includes('alice'), 'Initial request had field "username"');
        assert(redirectReceivedBody.includes('alice'), '307 redirect target received field "username"');
        assert(redirectReceivedBody.includes('xyz123'), '307 redirect target received field "token"');
        console.log('  ✅ FINDING 3 VERIFIED: 307 redirect replayed multipart FormData body to target with retries = 0!');

        server.close(done);
      });
  });
}

testFinding1(() => {
  testFinding2(() => {
    testFinding3(() => {
      console.log('\n' + '='.repeat(70));
      console.log('ALL 3 REVIEWER FINDINGS ARE 100% RESOLVED AND VERIFIED LOCALLY!');
      console.log('='.repeat(70));
      process.exit(0);
    });
  });
});

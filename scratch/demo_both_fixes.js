const request = require('../superagent');
const assert = require('assert');
const http = require('http');

console.log('='.repeat(70));
console.log('DEMONSTRATING BOTH SOLUTION QUALITY FIXES LOCALLY');
console.log('='.repeat(70));

// =========================================================================
// Fix 2: Node unbuffered streaming (.buffer(false).maxResponseSize(...))
// =========================================================================
console.log('\n[TESTING FIX 2] Node unbuffered streaming contract...');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  // Send data in chunks with a delay to prove streaming
  setTimeout(() => {
    res.write('Hello ');
    setTimeout(() => {
      res.write('World!');
      res.end();
    }, 20);
  }, 10);
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  let receivedData = '';
  let dataEventsCount = 0;
  let callbackFiredBeforeData = false;

  request
    .get(`http://127.0.0.1:${port}`)
    .buffer(false)
    .maxResponseSize(1000)
    .end((err, res) => {
      assert.ifError(err);
      callbackFiredBeforeData = (receivedData === '');
      console.log('  1. Callback fired immediately on headers. Stream exhausted?', !callbackFiredBeforeData);

      res.on('data', (chunk) => {
        dataEventsCount++;
        receivedData += chunk.toString();
        console.log(`  2. Received chunk #${dataEventsCount}: "${chunk.toString()}"`);
      });

      res.on('end', () => {
        console.log(`  3. Stream ended. Total received: "${receivedData}"`);
        assert.strictEqual(receivedData, 'Hello World!');
        assert.strictEqual(dataEventsCount, 2);
        assert.strictEqual(callbackFiredBeforeData, true);
        console.log('  ✅ FIX 2 VERIFIED: Stream is fully readable from .end() callback!');

        server.close(() => {
          testFix1();
        });
      });
    });
});

// =========================================================================
// Fix 1: Browser explicit text mode BOM accounting
// =========================================================================
function testFix1() {
  console.log('\n[TESTING FIX 1] Browser explicit text mode BOM accounting...');
  const clientRequest = require('../superagent/lib/client');
  const EventEmitter = require('events');

  class MockXHR extends EventEmitter {
    constructor() {
      super();
      this.readyState = 1;
      this.status = 200;
      this.response = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]).buffer; // 4 bytes: UTF-8 BOM + 'a'
      this._responseType = '';
    }
    get responseType() { return this._responseType; }
    set responseType(val) { this._responseType = val; }
    open() {}
    setRequestHeader() {}
    getAllResponseHeaders() {
      // CORS unexposed: Content-Encoding header is NOT exposed
      return 'Content-Type: text/plain; charset=utf-8\r\n';
    }
    getResponseHeader(name) {
      if (!name) return null;
      const k = name.toLowerCase();
      if (k === 'content-type') return 'text/plain; charset=utf-8';
      // Content-Encoding is unexposed (returns null)
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

  // Subtest 1A: maxResponseSize(1) should FAIL with ETOOLARGE because entity is 4 bytes
  clientRequest.getXHR = () => new MockXHR();

  const req1 = clientRequest('GET', 'http://cross-origin.example.com/data')
    .responseType('text')  // EXPLICIT text mode
    .maxResponseSize(1);   // 1 byte limit < 4 byte entity

  req1.end((err, res) => {
    assert(err, 'Expected ETOOLARGE error');
    assert.strictEqual(err.code, 'ETOOLARGE');
    assert.strictEqual(req1.hasSizeError(), true);
    console.log('  1. maxResponseSize(1) with explicit responseType("text") correctly raised ETOOLARGE for 4-byte entity.');

    // Subtest 1B: maxResponseSize(4) should SUCCEED and reconstruct text === 'a'
    clientRequest.getXHR = () => new MockXHR();

    const req2 = clientRequest('GET', 'http://cross-origin.example.com/data')
      .responseType('text')  // EXPLICIT text mode
      .maxResponseSize(4);   // 4 byte limit >= 4 byte entity

    req2.end((err2, res2) => {
      assert.ifError(err2);
      assert.strictEqual(req2.hasSizeError(), false);
      assert.strictEqual(res2.text, 'a');
      console.log('  2. maxResponseSize(4) succeeded and reconstructed res.text === "a".');
      console.log('  ✅ FIX 1 VERIFIED: Explicit text mode accurately measures BOM bytes without bypass!');

      console.log('\n' + '='.repeat(70));
      console.log('ALL SOLUTION QUALITY ISSUES ARE 100% RESOLVED AND PROVEN LOCALLY!');
      console.log('='.repeat(70));
      process.exit(0);
    });
  });
}

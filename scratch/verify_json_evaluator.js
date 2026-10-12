const EventEmitter = require('events');
const clientRequest = require('../superagent/lib/client');
const assert = require('assert');

// Test 1: Decompressed JSON body has 50 bytes of whitespace, wire is small (compressed), maxResponseSize is 20.
class MockJSONXHR extends EventEmitter {
  constructor() {
    super();
    this.readyState = 0;
    this.status = 200;
    this.statusText = 'OK';
    this.headers = {
      'content-encoding': 'gzip',
      'content-type': 'application/json'
    };
    this.response = null;
    this.responseType = '';
  }
  open() { this.readyState = 1; }
  setRequestHeader() {}
  getAllResponseHeaders() {
    return 'content-encoding: gzip\r\ncontent-type: application/json\r\n';
  }
  getResponseHeader(h) {
    return this.headers[h.toLowerCase()] || null;
  }
  send() {
    // 50 spaces in JSON: decompressed size is ~57 bytes!
    const jsonStr = '{"a":' + ' '.repeat(50) + '1}';
    const decompressedBuf = Buffer.from(jsonStr, 'utf8');
    
    if (this.responseType === 'arraybuffer') {
      this.response = decompressedBuf.buffer.slice(decompressedBuf.byteOffset, decompressedBuf.byteOffset + decompressedBuf.byteLength);
    } else {
      this.response = JSON.parse(jsonStr);
    }
    this.readyState = 4;
    this.emit('readystatechange');
  }
  abort() { this.emit('abort'); }
  addEventListener(e, cb) { this.on(e, cb); }
  removeEventListener(e, cb) { this.off(e, cb); }
}

const mock = new MockJSONXHR();
clientRequest.getXHR = () => mock;

const req = clientRequest('GET', 'http://example.com/oversized-whitespace-json')
  .responseType('json')
  .maxResponseSize(20);

req.end((err, res) => {
  assert.ok(err, 'Expected ETOOLARGE');
  assert.strictEqual(err.code, 'ETOOLARGE');
  console.log('TEST 1 PASSED: ETOOLARGE raised when decompressed JSON has whitespace exceeding maxResponseSize(20)!');

  // Test 2: In-limit compressed JSON reconstructs correctly
  class MockInLimitJSONXHR extends EventEmitter {
    constructor() {
      super();
      this.readyState = 0;
      this.status = 200;
      this.statusText = 'OK';
      this.headers = {
        'content-encoding': 'gzip',
        'content-type': 'application/json'
      };
      this.response = null;
      this.responseType = '';
    }
    open() { this.readyState = 1; }
    setRequestHeader() {}
    getAllResponseHeaders() {
      return 'content-encoding: gzip\r\ncontent-type: application/json\r\n';
    }
    getResponseHeader(h) {
      return this.headers[h.toLowerCase()] || null;
    }
    send() {
      const jsonStr = '{"a": 1}'; // 8 bytes <= 20
      const decompressedBuf = Buffer.from(jsonStr, 'utf8');
      if (this.responseType === 'arraybuffer') {
        this.response = decompressedBuf.buffer.slice(decompressedBuf.byteOffset, decompressedBuf.byteOffset + decompressedBuf.byteLength);
      } else {
        this.response = JSON.parse(jsonStr);
      }
      this.readyState = 4;
      this.emit('readystatechange');
    }
    abort() { this.emit('abort'); }
    addEventListener(e, cb) { this.on(e, cb); }
    removeEventListener(e, cb) { this.off(e, cb); }
  }

  clientRequest.getXHR = () => new MockInLimitJSONXHR();
  clientRequest('GET', 'http://example.com/in-limit-json')
    .responseType('json')
    .maxResponseSize(20)
    .end((err2, res2) => {
      assert.ifError(err2);
      assert.strictEqual(res2.xhr.responseType, 'json');
      assert.strictEqual(res2.text, null);
      assert.deepStrictEqual(res2.body, { a: 1 });
      assert.deepStrictEqual(res2.xhr.response, { a: 1 });
      console.log('TEST 2 PASSED: In-limit JSON correctly reconstructed, res.xhr.responseType is "json", res.body is { a: 1 }!');
    });
});

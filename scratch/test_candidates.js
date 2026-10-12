const assert = require('assert');
const http = require('http');
const http2 = require('http2');
const request = require('../superagent');
const clientRequest = require('../superagent/src/client');

console.log('Testing Candidates...');

// 1. HTTP/2 overflow test
function testHttp2Overflow() {
  return new Promise((resolve, reject) => {
    const srv = http2.createServer((sReq, sRes) => {
      sReq.on('data', () => {});
      sReq.on('end', () => {
        sRes.writeHead(200);
        sRes.end('ok');
      });
    });

    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      const req = request
        .post(`http://127.0.0.1:${port}/http2-overflow`)
        .http2()
        .maxRequestSize(10)
        .send('this is much longer than ten bytes');

      req.end((err, res) => {
        srv.close(() => {
          try {
            console.log('HTTP/2 overflow err:', err ? err.message : null, 'code:', err ? err.code : null);
            assert.ok(err, 'Expected error on oversized HTTP/2 request');
            assert.strictEqual(err.code, 'ETOOLARGE');
            assert.strictEqual(err.retries, 0);
            assert.strictEqual(req.hasSizeError(), true);
            console.log('√ HTTP/2 overflow PASSED');
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });
  });
}

// 2. Node 305 redirect multipart replay test
function test305MultipartReplay() {
  return new Promise((resolve, reject) => {
    let targetBody = '';
    const srv = http.createServer((sReq, sRes) => {
      if (sReq.url === '/init-305-mp') {
        sReq.resume();
        sReq.on('end', () => {
          sRes.writeHead(305, {
            Location: '/dest-305-mp',
            'Content-Type': 'text/plain'
          });
          sRes.end('proxy-redirect');
        });
      } else if (sReq.url === '/dest-305-mp') {
        let b = '';
        sReq.on('data', (c) => { b += c.toString(); });
        sReq.on('end', () => {
          targetBody = b;
          sRes.writeHead(200, { 'Content-Type': 'text/plain' });
          sRes.end('target-ok');
        });
      }
    });

    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      request
        .post(`http://127.0.0.1:${p}/init-305-mp`)
        .field('action', 'test305')
        .field('data', 'multipart-payload-val')
        .maxRequestSize(2000)
        .end((err, res) => {
          srv.close(() => {
            try {
              console.log('305 multipart err:', err ? err.message : null, 'status:', res ? res.status : null);
              assert.ifError(err);
              assert.strictEqual(res.status, 200);
              assert.strictEqual(res.text, 'target-ok');
              assert(targetBody.includes('test305'), '305 target received field "action"');
              assert(targetBody.includes('multipart-payload-val'), '305 target received field "data"');
              console.log('√ 305 multipart replay PASSED');
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        });
    });
  });
}

// 3. Browser compressed UTF-16LE response with BOM
function testBrowserUtf16LeBom() {
  return new Promise((resolve, reject) => {
    const EventEmitter = require('events');
    class MockXHR extends EventEmitter {
      constructor() {
        super();
        this.readyState = 0;
        this.status = 200;
        // BOM U+FEFF followed by 50 ASCII chars in UTF-16LE
        // With BOM consumed or counted:
        this.responseText = '\uFEFF' + 'x'.repeat(50);
      }
      open() { this.readyState = 1; }
      setRequestHeader() {}
      getAllResponseHeaders() {
        return 'Content-Type: text/plain; charset=utf-16le\r\nContent-Encoding: gzip\r\nContent-Length: 30\r\n';
      }
      getResponseHeader(name) {
        if (!name) return null;
        const k = name.toLowerCase();
        if (k === 'content-type') return 'text/plain; charset=utf-16le';
        if (k === 'content-encoding') return 'gzip';
        if (k === 'content-length') return '30';
        return null;
      }
      send() {
        this.emit('progress', { lengthComputable: true, loaded: 30, total: 30 });
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

    clientRequest.getXHR = () => new MockXHR();

    // 51 code units in UTF-16LE = 102 bytes. Limit 101 => ETOOLARGE
    const req = clientRequest('GET', 'http://example.com/compressed-utf16le-bom')
      .maxResponseSize(101);

    req.end((err) => {
      try {
        console.log('UTF-16LE BOM err:', err ? err.message : null, 'code:', err ? err.code : null);
        assert.ok(err, 'Expected ETOOLARGE when decoded UTF-16LE with BOM exceeds limit');
        assert.strictEqual(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        console.log('√ Browser UTF-16LE with BOM PASSED');
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
}

// 4. Browser 307 multipart replay test
function testBrowser307MultipartReplay() {
  return new Promise((resolve, reject) => {
    const EventEmitter = require('events');
    let attempts = 0;
    const sentPayloads = [];
    const openedUrls = [];

    class MockXHR extends EventEmitter {
      constructor() {
        super();
        this.readyState = 0;
        this.attemptNum = ++attempts;
        this.responseURL = 'http://example.com/init-307-mp';
      }
      open(method, url) {
        this.method = method;
        this.url = url;
        openedUrls.push(url);
        this.readyState = 1;
      }
      setRequestHeader() {}
      getAllResponseHeaders() { return ''; }
      getResponseHeader(name) {
        if (name && name.toLowerCase() === 'location') {
          return 'http://example.com/dest-307-mp';
        }
        return null;
      }
      send(data) {
        sentPayloads.push(data);
        if (this.attemptNum === 1) {
          this.status = 307;
          this.readyState = 4;
          this.emit('readystatechange');
        } else {
          this.status = 200;
          this.responseText = '{"ok":true}';
          this.readyState = 4;
          this.emit('readystatechange');
          this.emit('load');
        }
      }
      abort() { this.emit('abort'); }
      addEventListener(e, cb) { this.on(e, cb); }
      removeEventListener(e, cb) { this.off(e, cb); }
    }

    clientRequest.getXHR = () => new MockXHR();

    clientRequest('POST', 'http://example.com/init-307-mp')
      .field('tag', 'browser307')
      .maxRequestSize(2000)
      .end((err, res) => {
        try {
          console.log('Browser 307 multipart err:', err ? err.message : null, 'status:', res ? res.status : null);
          assert.ifError(err);
          assert.strictEqual(attempts, 2, 'Expected 2 requests');
          assert.strictEqual(openedUrls[1], 'http://example.com/dest-307-mp');
          assert.strictEqual(res.status, 200);
          assert.ok(sentPayloads[0], 'Expected initial payload');
          assert.ok(sentPayloads[1], 'Expected replayed payload');
          console.log('√ Browser 307 multipart replay PASSED');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
  });
}

async function run() {
  try {
    await testHttp2Overflow();
    await test305MultipartReplay();
    await testBrowserUtf16LeBom();
    await testBrowser307MultipartReplay();
    console.log('\nALL 4 CANDIDATE TESTS PASSED ON OUR SOLUTION!');
  } catch (err) {
    console.error('Candidate test failed:', err);
    process.exit(1);
  }
}

run();

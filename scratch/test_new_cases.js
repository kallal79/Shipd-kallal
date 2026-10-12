const assert = require('assert');
const http = require('http');
const EventEmitter = require('events');
const request = require('../superagent');
const clientRequest = require('../superagent/src/client');

describe('New reviewer edge cases', function () {
  this.timeout(10000);

  // Case 1: Browser decompressed UTF-8 with BOM
  it('should emit ETOOLARGE when browser decompressed UTF-8 response with BOM exceeds maxResponseSize', (done) => {
    class MockXHR extends EventEmitter {
      constructor() {
        super();
        this.readyState = 0;
        this.status = 200;
        // 1 char in UTF-8. With stripped BOM (EF BB BF), entity was 4 bytes.
        this.responseText = 'a';
      }
      open() { this.readyState = 1; }
      setRequestHeader() {}
      getAllResponseHeaders() {
        return 'Content-Type: text/plain; charset=utf-8\r\nContent-Encoding: gzip\r\nContent-Length: 20\r\n';
      }
      getResponseHeader(name) {
        if (!name) return null;
        const k = name.toLowerCase();
        if (k === 'content-type') return 'text/plain; charset=utf-8';
        if (k === 'content-encoding') return 'gzip';
        if (k === 'content-length') return '20';
        return null;
      }
      send() {
        this.emit('progress', { lengthComputable: true, loaded: 20, total: 20 });
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

    // Limit is 1: entity has 4 bytes (3 BOM + 1 'a') => 4 > 1 => ETOOLARGE!
    const req = clientRequest('GET', 'http://example.com/compressed-utf8-bom')
      .maxResponseSize(1);

    req.end((err) => {
      try {
        assert.ok(err, 'Expected ETOOLARGE for decompressed UTF-8 with BOM exceeding limit');
        assert.strictEqual(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // Case 2: Node unbuffered response routes stream errors (ECONNRESET) into retry/callback
  it('should retry and succeed when unbuffered response with maxResponseSize encounters ECONNRESET', (done) => {
    let attempts = 0;
    const server = http.createServer((req, res) => {
      attempts++;
      if (attempts === 1) {
        // Send headers, then destroy socket with ECONNRESET
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.flushHeaders();
        setTimeout(() => {
          req.socket.destroy(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
        }, 20);
      } else {
        // Attempt 2: send full response normally
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('all good');
      }
    });

    server.listen(0, () => {
      const port = server.address().port;
      request
        .get(`http://localhost:${port}/unbuffered-retry`)
        .buffer(false)
        .maxResponseSize(1000)
        .retry(1)
        .end((err, res) => {
          server.close();
          try {
            assert.ifError(err);
            assert.strictEqual(attempts, 2, 'Expected 2 attempts (retried after ECONNRESET)');
            assert.strictEqual(res.status, 200);
            done();
          } catch (e) {
            done(e);
          }
        });
    });
  });
});

const assert = require('assert');
const http = require('http');
const zlib = require('zlib');
const request = require('../..');
let clientRequest;
try {
  clientRequest = require('../../src/client');
} catch (_) {
  // Ignore in environments where client cannot be required
}

describe('hidden verification tests', function () {
  this.timeout(15000);

  let server;
  let base;
  let multipartRetryCount = 0;
  let multipartAttempts = [];
  let unbufferedRetryCount = 0;
  const sockets = new Set();

  before((done) => {
    server = http.createServer((req, res) => {
      if (req.url === '/unbuffered-retry-econnreset') {
        unbufferedRetryCount++;
        if (unbufferedRetryCount === 1) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.flushHeaders();
          const timer = setTimeout(() => {
            try {
              req.socket.destroy(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
            } catch (_) { /* ignore */ }
          }, 20);
          req.on('close', () => clearTimeout(timer));
        } else {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('all good');
        }
      } else if (req.url === '/multipart-retry') {
        const body = [];
        req.on('data', (chunk) => body.push(chunk));
        req.on('end', () => {
          multipartRetryCount++;
          multipartAttempts.push({
            headers: req.headers,
            body: Buffer.concat(body)
          });
          if (multipartRetryCount === 1) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Server Error');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(Buffer.concat(body));
          }
        });
      } else if (req.url === '/pipe-delayed-cl-oversized') {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': '100'
        });
        const timer = setTimeout(() => {
          try {
            res.write('x'.repeat(100));
            res.end();
          } catch (_) {
            // ignore error
          }
        }, 500);
        req.on('close', () => {
          clearTimeout(timer);
          try {
            res.end();
          } catch (_) {
            // ignore error
          }
        });
      } else if (req.url === '/large-response') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        let sent = 0;
        const interval = setInterval(() => {
          res.write('a'.repeat(1024));
          sent += 1024;
          if (sent >= 1024 * 10) {
            clearInterval(interval);
            res.end();
          }
        }, 10);
      } else if (req.url === '/exact-response-5') {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': 5 });
        res.end('12345');
      } else if (req.url === '/echo') {
        let body = [];
        req.on('data', (chunk) => body.push(chunk));
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
          res.end(Buffer.concat(body));
        });
      } else if (req.url === '/redirect-large-body') {
        res.writeHead(302, {
          Location: `${base}/exact-response-5`,
          'Content-Type': 'text/plain'
        });
        res.write('x'.repeat(1024 * 50));
        res.end();
      } else if (req.url === '/redirect-compressed-unlimited') {
        res.writeHead(302, {
          Location: `${base}/exact-response-5`,
          'Content-Type': 'text/plain',
          'Content-Encoding': 'gzip'
        });
        res.end(zlib.gzipSync(Buffer.from('redirect compressed payload')));
      } else if (req.url === '/redirect-compressed-large') {
        res.writeHead(302, {
          Location: `${base}/exact-response-5`,
          'Content-Type': 'text/plain',
          'Content-Encoding': 'gzip'
        });
        res.end(zlib.gzipSync(Buffer.from('x'.repeat(5000))));
      } else if (req.url === '/gzip-large') {
        res.writeHead(200, {
          'Content-Type': 'text/plain',
          'Content-Encoding': 'gzip'
        });
        res.end(zlib.gzipSync(Buffer.from('x'.repeat(5000))));
      } else if (req.url === '/redirect-pipe') {
        res.writeHead(302, {
          Location: `${base}/redirect-target`,
          'Content-Type': 'text/plain'
        });
        res.end('redirecting');
      } else if (req.url === '/redirect-target') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('redirected target data');
      } else if (req.url === '/not-modified-with-cl') {
        res.writeHead(304, {
          'Content-Length': '1000',
          ETag: '"12345"'
        });
        res.end();
      } else if (req.url === '/nocontent-with-cl') {
        res.writeHead(204, {
          'Content-Length': '1000'
        });
        res.end();
      } else if (req.url === '/redirect-delayed-large') {
        res.writeHead(302, {
          Location: `${base}/exact-response-5`,
          'Content-Type': 'text/plain'
        });
        setTimeout(() => {
          res.write('x'.repeat(1024 * 50));
          res.end();
        }, 50);
      } else if (req.url === '/stream-data') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.write('chunk1');
        setTimeout(() => {
          res.write('chunk2');
          res.end();
        }, 20);
      } else if (req.url === '/head-redirect-with-cl') {
        res.writeHead(302, {
          Location: `${base}/head-target-with-cl`,
          'Content-Length': '100000'
        });
        res.end();
      } else if (req.url === '/head-target-with-cl') {
        res.writeHead(200, {
          'Content-Length': '50000'
        });
        res.end();
      } else if (req.url === '/early-response-limited-upload') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('early ok');
      } else {
        res.writeHead(200);
        res.end('OK');
      }
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    server.on('clientError', (err, socket) => {
      try {
        socket.destroy();
      } catch (_) { /* ignore */ }
    });
    server.listen(0, () => {
      base = `http://localhost:${server.address().port}`;
      done();
    });
  });

  after((done) => {
    for (const socket of sockets) {
      try {
        socket.destroy();
      } catch (_) { /* ignore */ }
    }
    sockets.clear();
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    server.close(done);
  });

  // T1: maxResponseSize exceeded -> error with code ETOOLARGE
  it('should invoke callback exactly once with an error with code ETOOLARGE on maxResponseSize exceeded', (done) => {
    let callbackCount = 0;
    const req = request
      .get(`${base}/large-response`)
      .maxResponseSize(500)
      .buffer(true);
    assert.strictEqual(req.maxResponseSize(500), req, 'maxResponseSize() must be chainable');

    req.end((err) => {
      callbackCount++;
      try {
        assert.ok(err, 'Expected error to be present');
        assert.equal(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        assert.equal(callbackCount, 1, 'Callback should be called exactly once');
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T2: maxRequestSize exceeded on Node.js
  it('should emit exactly once an error with code ETOOLARGE on maxRequestSize exceeded (Node)', (done) => {
    let callbackCount = 0;
    const req = request.post(`${base}/echo`);
    assert.strictEqual(req.maxRequestSize(10), req, 'maxRequestSize() must be chainable');
    req.send('This payload is definitely longer than 10 bytes');

    req.end((err) => {
      callbackCount++;
      try {
        assert.ok(err, 'Expected error to be present');
        assert.equal(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        assert.equal(callbackCount, 1, 'Callback should be called exactly once');
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T3: Multibyte UTF-8 byte counting
  it('should measure byte length for multibyte UTF-8 strings in maxRequestSize', (done) => {
    const req = request
      .post(`${base}/echo`)
      .maxRequestSize(4)
      .send('ð œŽa');
    req.end((err) => {
      try {
        assert.ok(err, 'Expected error on multibyte overflow');
        assert.equal(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T4: Buffer request overflow
  it('should emit ETOOLARGE when Buffer payload exceeds maxRequestSize', (done) => {
    const buf = Buffer.alloc(100);
    request
      .post(`${base}/echo`)
      .maxRequestSize(50)
      .send(buf)
      .end((err) => {
        try {
          assert.ok(err, 'Expected error for Buffer exceeding maxRequestSize');
          assert.equal(err.code, 'ETOOLARGE');
          done();
        } catch (e) {
          done(e);
        }
      });
  });

  // T5: Multipart upload progress monitor
  it('should route multipart formData through an upload progress monitor and emit upload progress', (done) => {
    let progressEmitted = false;
    const req = request
      .post(`${base}/echo`)
      .maxRequestSize(1024 * 1024)
      .field('field1', 'value1')
      .field('field2', 'value2')
      .on('progress', (e) => {
        if (e.direction === 'upload') {
          progressEmitted = true;
        }
      });

    req.end((err) => {
      try {
        assert.ifError(err);
        assert.ok(progressEmitted, 'Expected upload progress event to be emitted');
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T6: Multipart upload within limit succeeds with 200
  it('should succeed for in-limit multipart upload with 200 status', (done) => {
    const req = request
      .post(`${base}/echo`)
      .maxRequestSize(1024 * 100)
      .field('hello', 'world');

    req.end((err, res) => {
      try {
        assert.ifError(err);
        assert.equal(res.status, 200);
        assert.strictEqual(req.hasSizeError(), false);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T7: Multipart upload exceeding maxRequestSize emits ETOOLARGE
  it('should emit ETOOLARGE on maxRequestSize exceeded during multipart upload', (done) => {
    const req = request
      .post(`${base}/echo`)
      .maxRequestSize(10)
      .field('largefield', 'x'.repeat(100));

    req.end((err) => {
      try {
        assert.ok(err, 'Expected error on multipart upload exceeding limit');
        assert.equal(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T8: hasSizeError() returns false when no error occurred
  it('should return false from hasSizeError() when no size limit is exceeded', (done) => {
    const req = request
      .get(`${base}/exact-response-5`)
      .maxResponseSize(100);

    req.end((err) => {
      try {
        assert.ifError(err);
        assert.strictEqual(req.hasSizeError(), false);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T9: Request payload exactly at maxRequestSize boundary should NOT error
  it('should not trigger ETOOLARGE when request payload is exactly at maxRequestSize boundary', (done) => {
    const payload = '12345';
    const req = request
      .post(`${base}/echo`)
      .maxRequestSize(5)
      .send(payload);

    req.end((err) => {
      try {
        assert.ifError(err);
        assert.strictEqual(req.hasSizeError(), false);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T10: Response payload exactly at maxResponseSize boundary should NOT error
  it('should not trigger ETOOLARGE when response is exactly at maxResponseSize boundary', (done) => {
    const req = request
      .get(`${base}/exact-response-5`)
      .maxResponseSize(5)
      .buffer(true);

    req.end((err, res) => {
      try {
        assert.ifError(err);
        assert.strictEqual(req.hasSizeError(), false);
        assert.equal(res.text, '12345');
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T11: hasSizeError() returns strict boolean false initially
  it('hasSizeError() should return strict boolean false before any request is made', () => {
    const req = request.get(`${base}/exact-response-5`);
    assert.strictEqual(typeof req.hasSizeError, 'function');
    assert.strictEqual(req.hasSizeError(), false);
  });

  // T12: hasSizeError() returns strict boolean true after error
  it('hasSizeError() should return strict boolean true after a maxResponseSize error', (done) => {
    const req = request
      .get(`${base}/large-response`)
      .maxResponseSize(100)
      .buffer(true);

    req.end((err) => {
      try {
        assert.ok(err);
        assert.strictEqual(req.hasSizeError(), true);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T13: Cumulative Request.write() overflow
  it('should emit ETOOLARGE when cumulative Request.write() exceeds maxRequestSize', (done) => {
    const req = request
      .post(`${base}/echo`)
      .maxRequestSize(15);

    req.write('1234567890');
    const w2 = req.write('1234567890');

    req.end((err) => {
      try {
        assert.ok(err, 'Expected error on cumulative write overflow');
        assert.equal(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        assert.strictEqual(w2, false, 'Expected overflowing write() to return false');
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T14: Multipart Content-Length check
  it('should enforce maxRequestSize using reported Content-Length for multipart', (done) => {
    const req = request
      .post(`${base}/echo`)
      .maxRequestSize(50)
      .field('largeField', 'This is a long text to exceed the 50 bytes boundary easily');

    req.end((err) => {
      try {
        assert.ok(err, 'Expected error for multipart Content-Length');
        assert.equal(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T15: Promise rejection on response overflow
  it('should reject Promise with ETOOLARGE on response overflow', async () => {
    const req = request
      .get(`${base}/large-response`)
      .maxResponseSize(50)
      .buffer(true);

    try {
      await req;
      assert.fail('Expected promise to reject');
    } catch (err) {
      assert.equal(err.code, 'ETOOLARGE');
      assert.strictEqual(req.hasSizeError(), true);
    }
  });

  // T16: Promise rejection on request overflow
  it('should reject Promise with ETOOLARGE on request overflow', async () => {
    const req = request
      .post(`${base}/echo`)
      .maxRequestSize(10)
      .send('This payload is definitely over 10 bytes');

    try {
      await req;
      assert.fail('Expected promise to reject');
    } catch (err) {
      assert.equal(err.code, 'ETOOLARGE');
      assert.strictEqual(req.hasSizeError(), true);
    }
  });

  // T17: hasSizeError() true after Promise rejection
  it('should have hasSizeError true after Promise response overflow', async () => {
    const req = request
      .get(`${base}/large-response`)
      .maxResponseSize(50)
      .buffer(true);

    try {
      await req;
    } catch (_) {
      // Expected size error
    }

    assert.strictEqual(req.hasSizeError(), true);
  });

  // T18: request overflow with retry(3)
  it('should not retry request size error when retry(3) is configured', (done) => {
    let callbackCount = 0;
    const req = request
      .post(`${base}/echo`)
      .retry(3)
      .maxRequestSize(5)
      .send('over the limit');

    req.end((err) => {
      callbackCount++;
      try {
        assert.ok(err, 'Expected error on request size with retry');
        assert.equal(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        assert.equal(err.retries, 0, 'Expected err.retries to be 0 on size error');
        assert.equal(callbackCount, 1, 'Callback should only be invoked once (no retry)');
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T19: response overflow with retry(3)
  it('should not retry response size error when retry(3) is configured', (done) => {
    let callbackCount = 0;
    const req = request
      .get(`${base}/large-response`)
      .retry(3)
      .maxResponseSize(100)
      .buffer(true);

    req.end((err) => {
      callbackCount++;
      try {
        assert.ok(err, 'Expected error on retry with size limit');
        assert.equal(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        assert.equal(err.retries, 0, 'Expected err.retries to be 0 on size error');
        assert.equal(callbackCount, 1, 'Callback should only be invoked once (no retry)');
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T21: Redirect response body size limit enforcement
  it('should abort with ETOOLARGE when redirect response body exceeds maxResponseSize', (done) => {
    const req = request
      .get(`${base}/redirect-large-body`)
      .maxResponseSize(100);

    req.end((err) => {
      try {
        assert.ok(err, 'Expected error when redirect body exceeds maxResponseSize');
        assert.equal(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true, 'hasSizeError() must be true on redirect size overflow');
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T21b: Compressed redirect without configured maxResponseSize follows redirect without error
  it('should successfully follow compressed redirect when no maxResponseSize is configured', (done) => {
    const req = request
      .get(`${base}/redirect-compressed-unlimited`);

    req.end((err, res) => {
      try {
        assert.ifError(err);
        assert.ok(res);
        assert.equal(res.status, 200);
        assert.equal(res.text, '12345');
        assert.strictEqual(req.hasSizeError(), false);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T21c: Compressed redirect with maxResponseSize configured aborts with ETOOLARGE when exceeded
  it('should abort with ETOOLARGE when decompressed redirect response body exceeds maxResponseSize', (done) => {
    const req = request
      .get(`${base}/redirect-compressed-large`)
      .maxResponseSize(50);

    req.end((err) => {
      try {
        assert.ok(err, 'Expected error when decompressed redirect body exceeds maxResponseSize');
        assert.equal(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T21d: Delayed chunked redirect response body exceeds maxResponseSize
  it('should abort with ETOOLARGE when delayed chunked redirect response body exceeds maxResponseSize', (done) => {
    const req = request
      .get(`${base}/redirect-delayed-large`)
      .maxResponseSize(100);

    req.end((err) => {
      try {
        assert.ok(err, 'Expected ETOOLARGE error for delayed oversized redirect body');
        assert.equal(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T21e: Decompressed non-redirect gzip response exceeding maxResponseSize aborts with ETOOLARGE (Node)
  it('should abort with ETOOLARGE when decompressed non-redirect gzip response exceeds maxResponseSize (Node)', (done) => {
    const req = request
      .get(`${base}/gzip-large`)
      .maxResponseSize(50);

    req.end((err) => {
      try {
        assert.ok(err, 'Expected error when decompressed response exceeds maxResponseSize');
        assert.equal(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T22: Preserves unbuffered stream readability when within maxResponseSize
  it('should preserve readable stream on unbuffered response when maxResponseSize is configured', (done) => {
    let received = '';
    const req = request
      .get(`${base}/stream-data`)
      .buffer(false)
      .maxResponseSize(1000);

    assert.strictEqual(typeof req.hasSizeError, 'function', 'hasSizeError must be implemented');
    assert.strictEqual(req.hasSizeError(), false);

    req.end((err, res) => {
      try {
        assert.ifError(err);
        assert.ok(res);
        assert.strictEqual(req.hasSizeError(), false);
        assert.strictEqual(res.status, 200);

        res.on('data', (chunk) => {
          received += chunk.toString();
        });

        res.on('end', () => {
          try {
            assert.strictEqual(received, 'chunk1chunk2');
            done();
          } catch (e) {
            done(e);
          }
        });
      } catch (e) {
        done(e);
      }
    });
  });

  // T41: Piped response through redirect aborts and emits ETOOLARGE when intermediate redirect exceeds limit
  it('should emit ETOOLARGE error when intermediate redirect exceeds maxResponseSize during pipe', (done) => {
    const { Writable } = require('stream');
    const dest = new Writable({
      write(chunk, encoding, callback) {
        callback();
      }
    });

    const req = request
      .get(`${base}/redirect-large-body`)
      .maxResponseSize(100);

    req.on('error', (err) => {
      try {
        assert.ok(err, 'Expected error on request');
        assert.equal(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        done();
      } catch (e) {
        done(e);
      }
    });

    req.pipe(dest);
  });

  // T33: 304 Not Modified with representation Content-Length header should not trigger ETOOLARGE
  it('should not treat bodyless 304 response with Content-Length as size error', (done) => {
    const req = request
      .get(`${base}/not-modified-with-cl`)
      .ok((res) => res.status < 400)
      .maxResponseSize(10);

    req.end((err, res) => {
      try {
        assert.ifError(err);
        assert.equal(res.status, 304);
        assert.strictEqual(req.hasSizeError(), false);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T33b: 204 No Content with Content-Length should not trigger ETOOLARGE (Node)
  it('should not treat bodyless 204 response with Content-Length as size error (Node)', (done) => {
    const req = request
      .get(`${base}/nocontent-with-cl`)
      .ok((res) => res.status < 400)
      .maxResponseSize(10);

    req.end((err, res) => {
      try {
        assert.ifError(err);
        assert.equal(res.status, 204);
        assert.strictEqual(req.hasSizeError(), false);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T34: write() overflow before end() with error listener attached should invoke end callback
  it('should invoke end callback with ETOOLARGE on write overflow before end even with error listener', (done) => {
    let errorEventCount = 0;
    const req = request
      .post(`${base}/echo`)
      .maxRequestSize(1)
      .on('error', () => {
        errorEventCount++;
      });

    const writeRet = req.write('hello');
    req.end((err) => {
      try {
        assert.ok(err, 'Expected ETOOLARGE in end callback');
        assert.equal(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        assert.strictEqual(writeRet, false, 'Expected write() to return false on size overflow');
        assert.strictEqual(errorEventCount, 1, 'Error event should be emitted to attached listener');
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T42: Node HEAD request with redirect having Content-Length should not trigger ETOOLARGE
  it('should not treat Node HEAD redirect with Content-Length as size error', (done) => {
    const req = request
      .head(`${base}/head-redirect-with-cl`)
      .redirects(2)
      .maxResponseSize(10);

    req.end((err, res) => {
      try {
        assert.ifError(err);
        assert.ok(res);
        assert.equal(res.status, 200);
        assert.strictEqual(req.hasSizeError(), false);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  describe('browser simulation tests', () => {
    let clientRequest;
    try {
      clientRequest = require('../../src/client');
    } catch (_) { /* ignore */ }
    const origGetXHR = clientRequest ? clientRequest.getXHR : null;
    const origFormData = global.FormData;
    const origWindow = global.window;

    global.window = { location: { origin: 'http://example.com' } };

    afterEach(() => {
      if (clientRequest && origGetXHR) {
        clientRequest.getXHR = origGetXHR;
      }
      if (origFormData === undefined) {
        delete global.FormData;
      } else {
        global.FormData = origFormData;
      }
      global.window = { location: { origin: 'http://example.com' } };
    });

    after(() => {
      if (origWindow === undefined) {
        delete global.window;
      } else {
        global.window = origWindow;
      }
      if (origFormData === undefined) {
        delete global.FormData;
      } else {
        global.FormData = origFormData;
      }
      if (clientRequest && origGetXHR) {
        clientRequest.getXHR = origGetXHR;
      }
    });

    // T23: Browser readyState 1 regression check with MockXHR & hasSizeError verification
    it('should not settle browser request at readyState 1 and complete normally at readyState 4', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseText = '{"ok":true}';
          this.responseHeaders = {};
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return 'content-type: application/json'; }
        getResponseHeader() { return 'application/json'; }
        send() {
          this.readyState = 1;
          this.emit('readystatechange');
          setTimeout(() => {
            this.readyState = 4;
            this.status = 200;
            this.responseText = '{"ok":true}';
            this.emit('readystatechange');
            this.emit('load');
          }, 20);
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      const req = clientRequest('GET', 'http://example.com/test')
        .maxResponseSize(1000);

      assert.strictEqual(typeof req.hasSizeError, 'function', 'hasSizeError must be implemented on browser Request');
      assert.strictEqual(req.hasSizeError(), false, 'hasSizeError() should return false initially');

      req.end((err, res) => {
        try {
          assert.ifError(err);
          assert.ok(res);
          assert.equal(res.status, 200);
          assert.strictEqual(req.hasSizeError(), false, 'hasSizeError() should return false after successful response');
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T24: Browser terminal text response size enforcement when headers and progress events are absent
    it('should emit ETOOLARGE on browser text response exceeding maxResponseSize without headers or progress events', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseType = '';
          this.responseText = 'x'.repeat(100);
          this.responseHeaders = {};
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return 'content-type: text/plain'; }
        getResponseHeader() { return null; }
        send() {
          this.readyState = 4;
          this.emit('readystatechange');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      const req = clientRequest('GET', 'http://example.com/text')
        .maxResponseSize(10);
      req.end((err) => {
        try {
          assert.ok(err, 'Expected ETOOLARGE error on terminal text response overflow without headers/progress');
          assert.equal(err.code, 'ETOOLARGE');
          assert.strictEqual(req.hasSizeError(), true);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T24b: Browser terminal text response within limit when headers and progress events are absent
    it('should complete normally on browser text response within maxResponseSize without headers or progress events', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseType = '';
          this.responseText = 'hello';
          this.responseHeaders = {};
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return 'content-type: text/plain'; }
        getResponseHeader() { return null; }
        send() {
          this.readyState = 4;
          this.emit('readystatechange');
          this.emit('load');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      const req = clientRequest('GET', 'http://example.com/text')
        .maxResponseSize(100);
      req.end((err, res) => {
        try {
          assert.ifError(err);
          assert.ok(res);
          assert.equal(res.status, 200);
          assert.strictEqual(req.hasSizeError(), false);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T25: Browser terminal text response size enforcement via Content-Length without progress event
    it('should emit ETOOLARGE on browser text response exceeding maxResponseSize via Content-Length without progress event', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseType = '';
          this.responseText = 'x'.repeat(500);
          this.responseHeaders = { 'content-length': '500' };
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return 'content-length: 500\r\ncontent-type: text/plain'; }
        getResponseHeader(name) {
          return name && name.toLowerCase() === 'content-length' ? '500' : null;
        }
        send() {
          this.readyState = 4;
          this.emit('readystatechange');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      const req = clientRequest('GET', 'http://example.com/text')
        .maxResponseSize(10);
      req.end((err) => {
        try {
          assert.ok(err, 'Expected ETOOLARGE error via Content-Length without progress event');
          assert.equal(err.code, 'ETOOLARGE');
          assert.strictEqual(req.hasSizeError(), true);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T36: Browser FormData pre-send check without upload progress
    it('should emit ETOOLARGE on browser FormData send exceeding maxRequestSize without upload progress events', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        send() {
          assert.fail('send should not be called when request exceeds maxRequestSize');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      class MockFormData {
        constructor() { this._entries = []; }
        append(k, v) { this._entries.push([k, v]); }
        entries() { return this._entries[Symbol.iterator](); }
      }

      global.FormData = MockFormData;

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      const fd = new MockFormData();
      fd.append('largeKey', 'x'.repeat(200));

      const req = clientRequest('POST', 'http://example.com/form')
        .maxRequestSize(50)
        .send(fd);

      req.end((err) => {
        try {
          assert.ok(err, 'Expected error on browser FormData exceeding maxRequestSize');
          assert.equal(err.code, 'ETOOLARGE');
          assert.strictEqual(req.hasSizeError(), true);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T37: Browser .field() with multipart framing overhead exceeding limit
    it('should emit ETOOLARGE on browser field with multipart framing overhead exceeding maxRequestSize', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        send() {
          assert.fail('send should not be called when framing overhead exceeds limit');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      const req = clientRequest('POST', 'http://example.com/field')
        .maxRequestSize(20)
        .field('k', 'v');

      req.end((err) => {
        try {
          assert.ok(err, 'Expected error on field with multipart framing exceeding maxRequestSize');
          assert.equal(err.code, 'ETOOLARGE');
          assert.strictEqual(req.hasSizeError(), true);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T27: Browser upload and download progress event emits with direction
    it('should emit progress event with direction upload during browser upload', (done) => {
      const EventEmitter = require('events');
      let uploadProgressEmitted = false;
      let downloadProgressEmitted = false;
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.upload = new EventEmitter();
          this.upload.addEventListener = (e, cb) => this.upload.on(e, cb);
          this.upload.removeEventListener = (e, cb) => this.upload.off(e, cb);
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return ''; }
        getResponseHeader() { return null; }
        send() {
          this.upload.emit('progress', { lengthComputable: true, loaded: 10, total: 100 });
          this.emit('progress', { lengthComputable: true, loaded: 20, total: 100 });
          this.readyState = 4;
          this.emit('readystatechange');
          this.emit('load');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      const req = clientRequest('POST', 'http://example.com/progress-direction')
        .maxRequestSize(1000)
        .maxResponseSize(1000)
        .on('progress', (e) => {
          if (e.direction === 'upload') {
            uploadProgressEmitted = true;
          }
          if (e.direction === 'download') {
            downloadProgressEmitted = true;
          }
        });

      req.end((err) => {
        try {
          assert.ifError(err);
          assert.ok(uploadProgressEmitted, 'Expected upload progress with direction upload to be emitted');
          assert.ok(downloadProgressEmitted, 'Expected download progress with direction download to be emitted');
          assert.strictEqual(req.hasSizeError(), false);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T28: Browser HEAD response with Content-Length is not treated as size error
    it('should not treat browser HEAD response with Content-Length as size error', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseHeaders = { 'content-length': '1000' };
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return 'content-length: 1000'; }
        getResponseHeader(name) {
          return name && name.toLowerCase() === 'content-length' ? '1000' : null;
        }
        send() {
          this.readyState = 4;
          this.emit('readystatechange');
          this.emit('load');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      const req = clientRequest('HEAD', 'http://example.com/head')
        .maxResponseSize(10);

      req.end((err, res) => {
        try {
          assert.ifError(err);
          assert.ok(res);
          assert.equal(res.status, 200);
          assert.strictEqual(req.hasSizeError(), false);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T28b: Browser 204 No Content with Content-Length is not treated as size error
    it('should not treat browser 204 response with Content-Length as size error', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 204;
          this.responseHeaders = { 'content-length': '1000' };
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return 'content-length: 1000'; }
        getResponseHeader(name) {
          return name && name.toLowerCase() === 'content-length' ? '1000' : null;
        }
        send() {
          this.readyState = 4;
          this.emit('readystatechange');
          this.emit('load');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      const req = clientRequest('GET', 'http://example.com/nocontent')
        .maxResponseSize(10);

      req.end((err, res) => {
        try {
          assert.ifError(err);
          assert.ok(res);
          assert.equal(res.status, 204);
          assert.strictEqual(req.hasSizeError(), false);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T39: Browser empty FormData with maxRequestSize(0) errors on closing boundary delimiter
    it('should emit ETOOLARGE for empty native FormData when maxRequestSize is 0', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        send() {
          assert.fail('send should not be called when empty FormData exceeds maxRequestSize 0');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      class MockEmptyFormData {
        constructor() { this._entries = []; }
        append(k, v) { this._entries.push([k, v]); }
        entries() { return this._entries[Symbol.iterator](); }
      }

      global.FormData = MockEmptyFormData;

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      const req = clientRequest('POST', 'http://example.com/empty-form')
        .maxRequestSize(0)
        .send(new MockEmptyFormData());

      req.end((err) => {
        try {
          assert.ok(err, 'Expected error on empty FormData exceeding maxRequestSize(0)');
          assert.equal(err.code, 'ETOOLARGE');
          assert.strictEqual(req.hasSizeError(), true);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T40: Browser FormData with field within limit succeeds without false positive at exact boundary (132 bytes for a="")
    it('should succeed for browser FormData when body is within limit', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseText = 'ok';
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return ''; }
        getResponseHeader() { return null; }
        send() {
          this.readyState = 4;
          this.emit('readystatechange');
          this.emit('load');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      class MockFormData {
        constructor() { this._entries = []; }
        append(k, v) { this._entries.push([k, v]); }
        entries() { return this._entries[Symbol.iterator](); }
      }

      global.FormData = MockFormData;

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      const fd = new MockFormData();
      fd.append('a', '');

      const req = clientRequest('POST', 'http://example.com/form-within-limit')
        .maxRequestSize(5000)
        .send(fd);

      req.end((err, res) => {
        try {
          assert.ifError(err);
          assert.ok(res);
          assert.strictEqual(req.hasSizeError(), false);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T26: Browser upload progress overflow
    it('should emit ETOOLARGE when browser upload progress loaded exceeds maxRequestSize', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.upload = new EventEmitter();
          this.upload.addEventListener = (e, cb) => this.upload.on(e, cb);
          this.upload.removeEventListener = (e, cb) => this.upload.off(e, cb);
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return ''; }
        getResponseHeader() { return null; }
        send() {
          this.upload.emit('progress', { lengthComputable: true, loaded: 150, total: 200 });
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      clientRequest('POST', 'http://example.com/upload')
        .maxRequestSize(50)
        .send('payload')
        .end((err) => {
          try {
            assert.ok(err, 'Expected error on upload progress overflow');
            assert.equal(err.code, 'ETOOLARGE');
            done();
          } catch (e) {
            done(e);
          }
        });
    });

    // T26b: Browser download progress overflow
    it('should emit ETOOLARGE when browser download progress loaded exceeds maxResponseSize', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return ''; }
        getResponseHeader() { return null; }
        send() {
          this.emit('progress', { lengthComputable: true, loaded: 150, total: 200 });
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      clientRequest('GET', 'http://example.com/download')
        .maxResponseSize(50)
        .end((err) => {
          try {
            assert.ok(err, 'Expected error on download progress overflow');
            assert.equal(err.code, 'ETOOLARGE');
            done();
          } catch (e) {
            done(e);
          }
        });
    });

    // T26c: Browser request payload byte length calculation
    it('should emit ETOOLARGE when browser request payload length exceeds maxRequestSize', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        send() {
          assert.fail('send should not be called when request exceeds size');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      clientRequest('POST', 'http://example.com/upload')
        .maxRequestSize(5)
        .send('This payload is definitely longer than 5 bytes')
        .end((err) => {
          try {
            assert.ok(err, 'Expected error for browser request payload exceeding size');
            assert.equal(err.code, 'ETOOLARGE');
            done();
          } catch (e) {
            done(e);
          }
        });
    });

    // T26d: Browser direct Blob payload exceeding maxRequestSize without upload progress
    it('should emit ETOOLARGE on browser direct Blob request exceeding maxRequestSize without upload progress', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        send() {
          assert.fail('send should not be called when Blob exceeds maxRequestSize');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      // Direct Blob object (native Blob or host-like tagged Blob with size 100)
      const mockBlob = typeof Blob !== 'undefined'
        ? new Blob(['x'.repeat(100)])
        : { size: 100, [Symbol.toStringTag]: 'Blob' };

      clientRequest('POST', 'http://example.com/blob')
        .maxRequestSize(50)
        .send(mockBlob)
        .end((err) => {
          try {
            assert.ok(err, 'Expected error on browser direct Blob payload exceeding limit');
            assert.equal(err.code, 'ETOOLARGE');
            done();
          } catch (e) {
            done(e);
          }
        });
    });

    // T43: Browser decoded text response exceeding maxResponseSize despite small wire Content-Length or progress event
    // The mock sets Content-Encoding: gzip so the terminal check uses decoded string UTF-8 size.
    it('should emit ETOOLARGE when browser decompressed response exceeds maxResponseSize despite small Content-Length', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseText = 'x'.repeat(5000); // 5000 bytes decompressed
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return 'content-length: 50\r\ncontent-encoding: gzip'; }
        getResponseHeader(name) {
          if (!name) return null;
          if (name.toLowerCase() === 'content-length') return '50';
          if (name.toLowerCase() === 'content-encoding') return 'gzip';
          return null;
        }
        send() {
          this.emit('progress', { lengthComputable: true, loaded: 50, total: 50 });
          setTimeout(() => {
            this.readyState = 4;
            this.status = 200;
            this.responseText = 'x'.repeat(5000);
            this.emit('readystatechange');
            this.emit('load');
          }, 10);
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      const req = clientRequest('GET', 'http://example.com/compressed')
        .maxResponseSize(100);

      req.end((err) => {
        try {
          assert.ok(err, 'Expected ETOOLARGE on decompressed body exceeding maxResponseSize');
          assert.equal(err.code, 'ETOOLARGE');
          assert.strictEqual(req.hasSizeError(), true);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T44: Browser decompressed multibyte string where raw.length < wireBytes < decodedBytes
    // Content-Encoding: gzip is present so decoded UTF-8 length (2000) is used.
    it('should emit ETOOLARGE when browser decompressed multibyte string exceeds maxResponseSize', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          // 1000 characters, each is 2 bytes in UTF-8, so decodedBytes is 2000.
          this.responseText = 'Ã£'.repeat(1000);
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return 'content-length: 1500\r\ncontent-encoding: gzip'; }
        getResponseHeader(name) {
          if (!name) return null;
          if (name.toLowerCase() === 'content-length') return '1500';
          if (name.toLowerCase() === 'content-encoding') return 'gzip';
          return null;
        }
        send() {
          this.emit('progress', { lengthComputable: true, loaded: 1500, total: 1500 });
          setTimeout(() => {
            this.readyState = 4;
            this.status = 200;
            this.responseText = 'Ã£'.repeat(1000);
            this.emit('readystatechange');
            this.emit('load');
          }, 10);
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      const req = clientRequest('GET', 'http://example.com/compressed-multibyte')
        .maxResponseSize(1600); // 1600 is between 1500 (wire) and 2000 (decoded)

      req.end((err) => {
        try {
          assert.ok(err, 'Expected error for large decompressed response');
          assert.equal(err.code, 'ETOOLARGE');
          assert.strictEqual(req.hasSizeError(), true);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T45: Browser ArrayBuffer response exceeding maxResponseSize when compressed Content-Length is smaller
    // Tests the binary path: decodedBytes(11) > wireBytes(10) via Content-Length; Math.max catches it.
    it('should emit ETOOLARGE on browser ArrayBuffer response exceeding maxResponseSize without wire metadata', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseType = 'arraybuffer';
          // 11-byte ArrayBuffer (decoded), no wire metadata at all => decoded size is used.
          this.response = new ArrayBuffer(11);
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return ''; }
        getResponseHeader() { return null; }
        send() {
          this.readyState = 4;
          this.emit('readystatechange');
          this.emit('load');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      // maxResponseSize(10) with no wire metadata: decoded 11-byte ArrayBuffer must fail.
      const req = clientRequest('GET', 'http://example.com/arraybuffer')
        .maxResponseSize(10);

      req.end((err) => {
        try {
          assert.ok(err, 'Expected ETOOLARGE for oversized ArrayBuffer response without wire metadata');
          assert.equal(err.code, 'ETOOLARGE');
          assert.strictEqual(req.hasSizeError(), true);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T46: Browser size failure with retry configured reports 0 retries
    it('should report 0 retries on browser size error with retry(3) configured', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseText = 'x'.repeat(50);
          this.responseHeaders = {};
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return ''; }
        getResponseHeader() { return null; }
        send() {
          this.readyState = 4;
          this.emit('readystatechange');
          this.emit('load');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      const req = clientRequest('GET', 'http://example.com/retry-test')
        .retry(3)
        .maxResponseSize(10);

      req.end((err) => {
        try {
          assert.ok(err, 'Expected ETOOLARGE');
          assert.equal(err.code, 'ETOOLARGE');
          assert.equal(err.retries, 0, 'Expected err.retries to be 0 for size error');
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T47: Browser compressed response whose decoded size is smaller than wire representation
    it('should not error when browser compressed response wire size exceeds maxResponseSize but decoded size is within limit', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseText = '';
          this.responseHeaders = {
            'content-encoding': 'gzip',
            'content-length': '25'
          };
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return 'Content-Encoding: gzip\r\nContent-Length: 25\r\n'; }
        getResponseHeader(h) { return this.responseHeaders[h.toLowerCase()] || null; }
        send() {
          this.emit('progress', { lengthComputable: true, loaded: 25, total: 25 });
          this.readyState = 4;
          this.emit('readystatechange');
          this.emit('load');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      const req = clientRequest('GET', 'http://example.com/compressed-empty')
        .maxResponseSize(5);

      req.end((err) => {
        try {
          assert.ifError(err);
          assert.strictEqual(req.hasSizeError(), false);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T48: Browser FormData transmits in-limit payload without size error when progress events are absent
    it('should successfully transmit in-limit browser FormData without size error when progress events are absent', (done) => {
      const EventEmitter = require('events');
      let sentPayload = null;
      let contentTypeSet = null;

      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseText = 'OK';
        }
        open() { this.readyState = 1; }
        setRequestHeader(h, v) {
          if (h.toLowerCase() === 'content-type') contentTypeSet = v;
        }
        getAllResponseHeaders() { return ''; }
        getResponseHeader() { return null; }
        send(data) {
          sentPayload = data;
          this.readyState = 4;
          this.emit('readystatechange');
          this.emit('load');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      const MockFormData = class FormData {
        constructor() { this._entries = []; }
        append(name, value) { this._entries.push([name, value]); }
        entries() { return this._entries[Symbol.iterator](); }
        get [Symbol.toStringTag]() { return 'FormData'; }
      };

      const fd = new MockFormData();
      fd.append('key', 'value');

      const req = clientRequest('POST', 'http://example.com/send-fd')
        .maxRequestSize(500)
        .send(fd);

      req.end((err) => {
        try {
          assert.ifError(err);
          assert.strictEqual(req.hasSizeError(), false);
          assert.ok(sentPayload, 'Expected body payload to be transmitted');
          if (contentTypeSet) {
            assert.ok(/multipart\/form-data/i.test(contentTypeSet), 'Expected multipart/form-data content type if set');
          }
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T49: Browser CORS gzip response with unexposed Content-Encoding header enforces decoded size
    it('should enforce decoded size for browser CORS gzip response when Content-Encoding is unexposed', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseText = 'x'.repeat(5000);
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return 'Content-Length: 50\r\n'; }
        getResponseHeader(h) {
          if (h.toLowerCase() === 'content-length') return '50';
          return null; // Content-Encoding not exposed in CORS
        }
        send() {
          this.emit('progress', { lengthComputable: true, loaded: 50, total: 50 });
          this.readyState = 4;
          this.emit('readystatechange');
          this.emit('load');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      const req = clientRequest('GET', 'http://cors-origin.com/gzip-cors').maxResponseSize(100);
      req.end((err) => {
        try {
          assert.ok(err, 'Expected ETOOLARGE for CORS gzip response exceeding limit');
          assert.strictEqual(err.code, 'ETOOLARGE');
          assert.strictEqual(req.hasSizeError(), true);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T50: Legacy XHR 1223 status (204 alias) is treated as bodyless before size check
    it('should normalize legacy XHR 1223 status to 204 and treat as bodyless before size check', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 1223; // IE legacy 204
          this.responseText = '';
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return 'Content-Length: 500\r\n'; }
        getResponseHeader(h) {
          if (h.toLowerCase() === 'content-length') return '500';
          return null;
        }
        send() {
          this.readyState = 4;
          this.emit('readystatechange');
          this.emit('load');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      const mock = new MockXHR();
      clientRequest.getXHR = () => mock;

      const req = clientRequest('GET', 'http://example.com/status-1223').maxResponseSize(50);
      req.end((err, res) => {
        try {
          assert.ifError(err);
          assert.strictEqual(req.hasSizeError(), false);
          assert.strictEqual(res.status, 204);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T51: Browser retry retains multipart payload when maxRequestSize is configured
    it('should retain and resend multipart payload on retry when maxRequestSize is configured', (done) => {
      const EventEmitter = require('events');
      let attempts = 0;
      const sentPayloads = [];

      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.attemptNum = ++attempts;
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return ''; }
        getResponseHeader() { return null; }
        send(d) {
          sentPayloads.push(d);
          if (this.attemptNum === 1) {
            this.status = 500;
            this.readyState = 4;
            this.emit('readystatechange');
            this.emit('load');
          } else {
            this.status = 200;
            this.responseText = 'OK';
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

      const req = clientRequest('POST', 'http://example.com/retry-multipart')
        .field('a', 'b')
        .maxRequestSize(1000)
        .retry(1);

      req.end(async (err) => {
        try {
          assert.ifError(err);
          assert.strictEqual(attempts, 2, 'Expected 2 attempts');
          assert.strictEqual(sentPayloads.length, 2, 'Expected 2 payloads sent across attempts');
          assert.ok(sentPayloads[0], 'Expected valid payload on first attempt');
          assert.ok(sentPayloads[1], 'Expected valid payload on retry attempt');
          if (sentPayloads[0] !== sentPayloads[1]) {
            const getPayloadBytes = async (p) => {
              if (typeof p === 'string') return Buffer.from(p);
              if (Buffer.isBuffer(p)) return p;
              if (p && typeof p.arrayBuffer === 'function') {
                const ab = await p.arrayBuffer();
                return Buffer.from(ab);
              }
              if (p && typeof p.text === 'function') {
                const txt = await p.text();
                return Buffer.from(txt);
              }
              return Buffer.from(String(p));
            };
            const bytes0 = await getPayloadBytes(sentPayloads[0]);
            const bytes1 = await getPayloadBytes(sentPayloads[1]);
            assert.deepStrictEqual(bytes0, bytes1, 'Expected byte-equivalent replayed payload on retry');
          }
          assert.strictEqual(req.hasSizeError(), false);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T52: Browser CORS gzip response with small decoded payload and larger wire bytes succeeds
    it('should succeed when browser unexposed compressed response wire size exceeds maxResponseSize but decoded size is within limit', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseText = ''; // 0 bytes decoded
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return 'Content-Length: 25\r\n'; }
        getResponseHeader(name) {
          if (name && name.toLowerCase() === 'content-length') return '25';
          return null; // Content-Encoding unexposed due to CORS
        }
        send() {
          this.emit('progress', { lengthComputable: true, loaded: 25, total: 25 });
          this.readyState = 4;
          this.emit('readystatechange');
          this.emit('load');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      clientRequest.getXHR = () => new MockXHR();

      const req = clientRequest('GET', 'http://other-domain.com/empty-gzip')
        .maxResponseSize(5);

      req.end((err, res) => {
        try {
          assert.ifError(err);
          assert.strictEqual(req.hasSizeError(), false);
          assert.strictEqual(res.status, 200);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T53: Browser unexposed compressed response with wire progress > limit but decoded size <= limit succeeds
    it('should succeed when browser unexposed compressed response wire size exceeds max during progress but decodes within limit', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseType = '';
          this.response = null;
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return ''; }
        getResponseHeader(name) {
          if (name && name.toLowerCase() === 'content-length') return '143';
          return null; // Content-Encoding not exposed due to CORS
        }
        send() {
          // Progress event reports wire size 143 while decoded response is not yet available
          this.emit('progress', { lengthComputable: true, loaded: 143, total: 143 });
          // Terminal readyState 4 decodes into 120 bytes
          this.readyState = 4;
          this.response = new ArrayBuffer(120);
          this.emit('readystatechange');
          this.emit('load');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      clientRequest.getXHR = () => new MockXHR();

      const req = clientRequest('GET', 'http://other-domain.com/gzip-arraybuffer')
        .responseType('arraybuffer')
        .maxResponseSize(120);

      req.end((err, res) => {
        try {
          assert.ifError(err);
          assert.strictEqual(req.hasSizeError(), false);
          assert.strictEqual(res.status, 200);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T66: Size error with retry(0) configured reports err.retries === 0 in Browser
    it('should report err.retries === 0 on size error with retry(0) configured (Browser)', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseText = 'x'.repeat(100);
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return 'Content-Length: 100\r\n'; }
        getResponseHeader(name) {
          if (name && name.toLowerCase() === 'content-length') return '100';
          return null;
        }
        send() {
          this.readyState = 4;
          this.emit('readystatechange');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      clientRequest.getXHR = () => new MockXHR();

      clientRequest('GET', '/overflow')
        .retry(0)
        .maxResponseSize(10)
        .end((err) => {
          try {
            assert.ok(err, 'Expected size error');
            assert.strictEqual(err.code, 'ETOOLARGE');
            assert.strictEqual(err.retries, 0, 'Expected err.retries to be 0 for browser retry(0)');
            done();
          } catch (e) {
            done(e);
          }
        });
    });

    // T67: Browser multipart request safely transmits fields within configured size limit
    it('should safely transmit browser multipart fields within maxRequestSize', (done) => {
      const EventEmitter = require('events');
      let sentData;
      let sentHeaders = {};
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseText = 'OK';
        }
        open() { this.readyState = 1; }
        setRequestHeader(k, v) { sentHeaders[k.toLowerCase()] = v; }
        getAllResponseHeaders() { return 'content-type: text/plain\r\n'; }
        getResponseHeader(name) {
          if (name && name.toLowerCase() === 'content-type') return 'text/plain';
          return null;
        }
        send(data) {
          sentData = data;
          this.readyState = 4;
          this.emit('readystatechange');
          this.emit('load');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }
      clientRequest.getXHR = () => new MockXHR();

      const clientReq = clientRequest('POST', '/form-test')
        .field('field1', 'val1')
        .field('field2', 'val2')
        .maxRequestSize(5000);

      clientReq.end((err) => {
        try {
          assert.ifError(err);
          assert.ok(sentData, 'Expected request body to be transmitted');
          assert.strictEqual(clientReq.hasSizeError(), false);
          assert.ok(sentHeaders['content-type'], 'Expected Content-Type header to be set');
          assert.ok(sentHeaders['content-type'].includes('multipart/form-data'), 'Expected multipart Content-Type');
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T70: Browser multipart request transmits consistent boundary header and body within size limit
    it('should transmit consistent multipart boundary in header and body within maxRequestSize', (done) => {
      const EventEmitter = require('events');
      let capturedBody;
      let capturedContentType;
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseText = 'OK';
        }
        open() { this.readyState = 1; }
        setRequestHeader(name, value) {
          if (name.toLowerCase() === 'content-type') capturedContentType = value;
        }
        getAllResponseHeaders() { return 'content-type: text/plain\r\n'; }
        getResponseHeader(name) {
          if (name && name.toLowerCase() === 'content-type') return 'text/plain';
          return null;
        }
        send(data) {
          capturedBody = data;
          this.readyState = 4;
          this.emit('readystatechange');
          this.emit('load');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }
      clientRequest.getXHR = () => new MockXHR();

      const clientReq = clientRequest('POST', '/upload')
        .field('field', 'value')
        .maxRequestSize(1000);

      clientReq.end(async (err) => {
        try {
          assert.ifError(err);
          assert.ok(capturedBody, 'Expected request body to be transmitted');
          assert.ok(capturedContentType, 'Expected Content-Type header to be set');

          const boundaryMatch = /(?:^|;\s*)boundary=(?:"([^"]+)"|([^;]+))/i.exec(capturedContentType);
          assert.ok(boundaryMatch, 'Content-Type header must contain boundary parameter');
          const boundary = (boundaryMatch[1] || boundaryMatch[2] || '').trim();
          assert.ok(boundary.length > 0, 'Extracted boundary parameter must not be empty');

          let bodyText = '';
          if (typeof capturedBody === 'string') {
            bodyText = capturedBody;
          } else if (Buffer.isBuffer(capturedBody)) {
            bodyText = capturedBody.toString('utf8');
          } else if (capturedBody instanceof ArrayBuffer) {
            bodyText = Buffer.from(capturedBody).toString('utf8');
          } else if (ArrayBuffer.isView(capturedBody)) {
            bodyText = Buffer.from(capturedBody.buffer, capturedBody.byteOffset, capturedBody.byteLength).toString('utf8');
          } else if (capturedBody && typeof capturedBody.text === 'function') {
            bodyText = await capturedBody.text();
          } else if (capturedBody && typeof capturedBody.arrayBuffer === 'function') {
            const buf = await capturedBody.arrayBuffer();
            bodyText = Buffer.from(buf).toString('utf8');
          } else if (capturedBody && typeof capturedBody.toString === 'function') {
            bodyText = capturedBody.toString();
          }

          assert.ok(bodyText.length > 0, 'Sent body bytes must be non-empty');
          assert.ok(bodyText.includes('--' + boundary), 'Transmitted body payload must contain matching boundary delimiter (--boundary)');
          assert.strictEqual(clientReq.hasSizeError(), false);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T71: In-limit compressed UTF-8 response without BOM completes normally without false size error
    it('should complete normally for responses within maxResponseSize without false size error', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseType = '';
          this.responseText = 'a';
          this.responseURL = 'http://example.com/api/test';
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() {
          return 'Content-Type: text/plain; charset=utf-8\r\nContent-Encoding: gzip\r\nContent-Length: 20\r\n';
        }
        send() {
          this.emit('progress', { direction: 'download', loaded: 20, total: 20 });
          this.readyState = 4;
          this.emit('readystatechange');
          this.emit('load');
        }
        abort() {}
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
        getResponseHeader(name) {
          if (!name) return null;
          const k = name.toLowerCase();
          if (k === 'content-type') return 'text/plain; charset=utf-8';
          if (k === 'content-encoding') return 'gzip';
          if (k === 'content-length') return '20';
          return null;
        }
      }
      clientRequest.getXHR = () => new MockXHR();

      const req = clientRequest('GET', 'http://example.com/api/test').maxResponseSize(1);
      req.end((err, res) => {
        try {
          assert.ifError(err);
          assert.strictEqual(res.text, 'a');
          assert.strictEqual(req.hasSizeError(), false);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T72: Browser compressed UTF-16LE response exceeding maxResponseSize
    it('should emit ETOOLARGE when browser decompressed UTF-16LE response exceeds maxResponseSize', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          // 100 ASCII chars. In UTF-16LE each char is 2 bytes => 200 bytes decoded.
          this.responseText = 'a'.repeat(100);
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() {
          return 'Content-Type: text/plain; charset=utf-16le\r\nContent-Encoding: gzip\r\nContent-Length: 50\r\n';
        }
        getResponseHeader(name) {
          if (!name) return null;
          const k = name.toLowerCase();
          if (k === 'content-type') return 'text/plain; charset=utf-16le';
          if (k === 'content-encoding') return 'gzip';
          if (k === 'content-length') return '50';
          return null;
        }
        send() {
          this.emit('progress', { lengthComputable: true, loaded: 50, total: 50 });
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

      const req = clientRequest('GET', 'http://example.com/compressed-utf16le')
        .maxResponseSize(150); // 150 limit: wire (50) < limit (150) < decoded (200)

      req.end((err) => {
        try {
          assert.ok(err, 'Expected ETOOLARGE when decoded UTF-16LE exceeds limit');
          assert.strictEqual(err.code, 'ETOOLARGE');
          assert.strictEqual(req.hasSizeError(), true);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T73: Browser compressed UTF-16LE response within maxResponseSize succeeds
    it('should succeed when browser decompressed UTF-16LE response is within maxResponseSize', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          // 50 chars in UTF-16LE = 100 bytes decoded
          this.responseText = 'a'.repeat(50);
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() {
          return 'Content-Type: text/plain; charset=utf-16le\r\nContent-Encoding: gzip\r\nContent-Length: 40\r\n';
        }
        getResponseHeader(name) {
          if (!name) return null;
          const k = name.toLowerCase();
          if (k === 'content-type') return 'text/plain; charset=utf-16le';
          if (k === 'content-encoding') return 'gzip';
          if (k === 'content-length') return '40';
          return null;
        }
        send() {
          this.emit('progress', { lengthComputable: true, loaded: 40, total: 40 });
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

      const req = clientRequest('GET', 'http://example.com/compressed-utf16le-within')
        .maxResponseSize(150); // 150 limit: decoded is 100 <= 150

      req.end((err, res) => {
        try {
          assert.ifError(err);
          assert.strictEqual(req.hasSizeError(), false);
          assert.strictEqual(res.status, 200);
          assert.strictEqual(res.text.length, 50);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T74: Browser compressed UTF-16 with BOM semantics
    it('should account for BOM in browser compressed UTF-16 response decoded byte size', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          // 50 chars in UTF-16 without BOM in string => entity was 50*2 + 2 = 102 bytes
          this.responseText = '\uFEFF' + 'b'.repeat(50);
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() {
          return 'Content-Type: text/plain; charset=utf-16\r\nContent-Encoding: gzip\r\nContent-Length: 30\r\n';
        }
        getResponseHeader(name) {
          if (!name) return null;
          const k = name.toLowerCase();
          if (k === 'content-type') return 'text/plain; charset=utf-16';
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

      // Limit 101: decoded 102 bytes exceeds 101 => ETOOLARGE
      const req = clientRequest('GET', 'http://example.com/compressed-utf16-bom')
        .maxResponseSize(101);

      req.end((err) => {
        try {
          assert.ok(err, 'Expected ETOOLARGE when decoded UTF-16 with BOM exceeds limit');
          assert.strictEqual(err.code, 'ETOOLARGE');
          assert.strictEqual(req.hasSizeError(), true);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T75: Browser multipart serialization handles File/Blob entries without synthetic allocation
    it('should serialize File/Blob in browser FormData and enforce maxRequestSize', (done) => {
      const EventEmitter = require('events');
      let capturedBody;
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseText = 'OK';
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return 'content-type: text/plain\r\n'; }
        getResponseHeader(name) {
          if (name && name.toLowerCase() === 'content-type') return 'text/plain';
          return null;
        }
        send(data) {
          capturedBody = data;
          this.readyState = 4;
          this.emit('readystatechange');
          this.emit('load');
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }
      clientRequest.getXHR = () => new MockXHR();

      const blobPart = typeof Blob !== 'undefined'
        ? new Blob(['file-content-here'], { type: 'text/plain' })
        : { size: 17, type: 'text/plain', [Symbol.toStringTag]: 'File', slice: () => {} };

      const MockFormData = class FormData {
        constructor() { this._entries = []; }
        append(name, value) { this._entries.push([name, value]); }
        entries() { return this._entries[Symbol.iterator](); }
        get [Symbol.toStringTag]() { return 'FormData'; }
      };

      const fd = new MockFormData();
      fd.append('upload', blobPart);

      const req = clientRequest('POST', '/blob-upload')
        .maxRequestSize(500)
        .send(fd);

      req.end((err) => {
        try {
          assert.ifError(err);
          assert.strictEqual(req.hasSizeError(), false);
          assert.ok(capturedBody, 'Expected body to be sent');
          done();
        } catch (e) {
          done(e);
        }
      });
    });
    // T75b: Shift_JIS 0x80 single-byte regression â€” U+0080 must count as 1 byte, not 2
    it('should not emit ETOOLARGE for Shift_JIS 0x80 (U+0080) decoded body at maxResponseSize(1)', (done) => {
      const EventEmitter = require('events');
      // Shift_JIS byte 0x80 decodes to U+0080 (C1 control character) â€” a single decoded byte.
      // getCjkDbcsByteLength (generic DBCS) would count U+0080 as 2 bytes (non-ASCII, not Katakana),
      // causing a false ETOOLARGE. getShiftJisByteLength must return 1 for U+0080.
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() {
          return 'Content-Type: text/plain; charset=shift_jis\r\nContent-Encoding: gzip\r\nContent-Length: 1\r\n';
        }
        getResponseHeader(name) {
          if (!name) return null;
          const k = name.toLowerCase();
          if (k === 'content-type') return 'text/plain; charset=shift_jis';
          if (k === 'content-encoding') return 'gzip';
          if (k === 'content-length') return '1';
          return null;
        }
        send() {
          setTimeout(() => {
            this.readyState = 4;
            this.status = 200;
            this.responseText = '\u0080'; // U+0080 â€” Shift_JIS decodes 0x80 to this
            this.emit('readystatechange');
            this.emit('load');
          }, 5);
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      clientRequest.getXHR = () => new MockXHR();

      // Wire body is 1 byte (Shift_JIS 0x80). maxResponseSize(1) must NOT trigger ETOOLARGE.
      const req = clientRequest('GET', 'http://example.com/sjis-c1ctrl')
        .maxResponseSize(1);

      req.end((err, res) => {
        try {
          assert.ifError(err);
          assert.strictEqual(res.status, 200);
          assert.strictEqual(req.hasSizeError(), false);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T76: Browser compressed Shift_JIS text within maxResponseSize succeeds without false ETOOLARGE
    it('should accurately measure Shift_JIS compressed text response within maxResponseSize without false ETOOLARGE', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          // In Shift_JIS, '\u3042' is 2 bytes (0x82 0xA0). In UTF-8 it would be 3 bytes.
          this.responseText = '\u3042';
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() {
          return 'Content-Type: text/plain; charset=shift_jis\r\nContent-Encoding: gzip\r\nContent-Length: 1\r\n';
        }
        getResponseHeader(name) {
          if (!name) return null;
          const k = name.toLowerCase();
          if (k === 'content-type') return 'text/plain; charset=shift_jis';
          if (k === 'content-encoding') return 'gzip';
          if (k === 'content-length') return '1';
          return null;
        }
        send() {
          this.emit('progress', { lengthComputable: true, loaded: 1, total: 1 });
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

      // With maxResponseSize(2), the 2-byte Shift_JIS body must succeed without false ETOOLARGE.
      const req = clientRequest('GET', 'http://example.com/compressed-shift-jis')
        .maxResponseSize(2);

      req.end((err, res) => {
        try {
          assert.ifError(err);
          assert.strictEqual(res.status, 200);
          assert.strictEqual(req.hasSizeError(), false);
          assert.strictEqual(res.text, '\u3042');
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T77: Browser compressed Shift_JIS text exceeding maxResponseSize aborts with ETOOLARGE
    it('should emit ETOOLARGE when browser compressed Shift_JIS text response exceeds maxResponseSize', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          this.responseText = '\u3042';
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() {
          return 'Content-Type: text/plain; charset=shift_jis\r\nContent-Encoding: gzip\r\nContent-Length: 1\r\n';
        }
        getResponseHeader(name) {
          if (!name) return null;
          const k = name.toLowerCase();
          if (k === 'content-type') return 'text/plain; charset=shift_jis';
          if (k === 'content-encoding') return 'gzip';
          if (k === 'content-length') return '1';
          return null;
        }
        send() {
          this.emit('progress', { lengthComputable: true, loaded: 1, total: 1 });
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

      // Limit 1: 2-byte Shift_JIS exceeds 1 => ETOOLARGE
      const req = clientRequest('GET', 'http://example.com/compressed-shift-jis-overflow')
        .maxResponseSize(1);

      req.end((err) => {
        try {
          assert.ok(err, 'Expected ETOOLARGE when Shift_JIS exceeds maxResponseSize');
          assert.strictEqual(err.code, 'ETOOLARGE');
          assert.strictEqual(req.hasSizeError(), true);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T78: Browser compressed GBK text response within maxResponseSize succeeds
    it('should accurately measure GBK compressed text response within maxResponseSize without false ETOOLARGE', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          // In GBK, '\u4E2D' is 2 bytes (0xD6 0xD0). In UTF-8 it would be 3 bytes.
          this.responseText = '\u4E2D';
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() {
          return 'Content-Type: text/plain; charset=gbk\r\nContent-Encoding: gzip\r\nContent-Length: 1\r\n';
        }
        getResponseHeader(name) {
          if (!name) return null;
          const k = name.toLowerCase();
          if (k === 'content-type') return 'text/plain; charset=gbk';
          if (k === 'content-encoding') return 'gzip';
          if (k === 'content-length') return '1';
          return null;
        }
        send() {
          this.emit('progress', { lengthComputable: true, loaded: 1, total: 1 });
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

      // With maxResponseSize(2), the 2-byte GBK body must succeed.
      const req = clientRequest('GET', 'http://example.com/compressed-gbk')
        .maxResponseSize(2);

      req.end((err, res) => {
        try {
          assert.ifError(err);
          assert.strictEqual(res.status, 200);
          assert.strictEqual(req.hasSizeError(), false);
          assert.strictEqual(res.text, '\u4E2D');
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T78b: GBK 0x80 single-byte regression â€” U+20AC (â‚¬) must count as 1 byte, not 2
    it('should not emit ETOOLARGE for GBK 0x80 (U+20AC euro) decoded body at maxResponseSize(1)', (done) => {
      const EventEmitter = require('events');
      // GBK byte 0x80 decodes to U+20AC ('â‚¬') in the browser. The wire body is 1 byte.
      // getCjkDbcsByteLength would incorrectly count 'â‚¬' (non-ASCII) as 2 bytes,
      // causing a false ETOOLARGE. getGbkByteLength must return 1 for U+20AC.
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() {
          return 'Content-Type: text/plain; charset=gbk\r\nContent-Encoding: gzip\r\nContent-Length: 1\r\n';
        }
        getResponseHeader(name) {
          if (!name) return null;
          const k = name.toLowerCase();
          if (k === 'content-type') return 'text/plain; charset=gbk';
          if (k === 'content-encoding') return 'gzip';
          if (k === 'content-length') return '1';
          return null;
        }
        send() {
          setTimeout(() => {
            this.readyState = 4;
            this.status = 200;
            this.responseText = '\u20AC'; // U+20AC â€” GBK decodes 0x80 to this
            this.emit('readystatechange');
            this.emit('load');
          }, 5);
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      clientRequest.getXHR = () => new MockXHR();

      // Wire body is 1 byte (GBK 0x80). maxResponseSize(1) must NOT trigger ETOOLARGE.
      const req = clientRequest('GET', 'http://example.com/gbk-euro')
        .maxResponseSize(1);

      req.end((err, res) => {
        try {
          assert.ifError(err);
          assert.strictEqual(res.status, 200);
          assert.strictEqual(req.hasSizeError(), false);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T79: Browser compressed ISO-2022-JP text exceeding maxResponseSize aborts with ETOOLARGE
    it('should emit ETOOLARGE when browser compressed ISO-2022-JP text response exceeds maxResponseSize', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          // In ISO-2022-JP, '\u3042' is 8 bytes: ESC $ B (3 bytes) + 0x24 0x22 (2 bytes) + ESC ( B (3 bytes).
          this.responseText = '\u3042';
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() {
          return 'Content-Type: text/plain; charset=iso-2022-jp\r\nContent-Encoding: gzip\r\nContent-Length: 1\r\n';
        }
        getResponseHeader(name) {
          if (!name) return null;
          const k = name.toLowerCase();
          if (k === 'content-type') return 'text/plain; charset=iso-2022-jp';
          if (k === 'content-encoding') return 'gzip';
          if (k === 'content-length') return '1';
          return null;
        }
        send() {
          this.emit('progress', { lengthComputable: true, loaded: 1, total: 1 });
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

      // With maxResponseSize(2), the 8-byte ISO-2022-JP body exceeds limit and must abort with ETOOLARGE.
      const req = clientRequest('GET', 'http://example.com/compressed-iso-2022-jp')
        .maxResponseSize(2);

      req.end((err) => {
        try {
          assert.ok(err, 'Expected ETOOLARGE error for ISO-2022-JP exceeding maxResponseSize');
          assert.strictEqual(err.code, 'ETOOLARGE');
          assert.strictEqual(req.hasSizeError(), true);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T80: Browser compressed ISO-2022-JP text within maxResponseSize succeeds
    it('should accurately measure ISO-2022-JP compressed text response within maxResponseSize', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          // '\u3042' in ISO-2022-JP is 8 bytes.
          this.responseText = '\u3042';
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() {
          return 'Content-Type: text/plain; charset=iso-2022-jp\r\nContent-Encoding: gzip\r\nContent-Length: 1\r\n';
        }
        getResponseHeader(name) {
          if (!name) return null;
          const k = name.toLowerCase();
          if (k === 'content-type') return 'text/plain; charset=iso-2022-jp';
          if (k === 'content-encoding') return 'gzip';
          if (k === 'content-length') return '1';
          return null;
        }
        send() {
          this.emit('progress', { lengthComputable: true, loaded: 1, total: 1 });
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

      // With maxResponseSize(8), the 8-byte ISO-2022-JP body is within limit and must succeed.
      const req = clientRequest('GET', 'http://example.com/compressed-iso-2022-jp-within')
        .maxResponseSize(8);

      req.end((err, res) => {
        try {
          assert.ifError(err);
          assert.strictEqual(res.status, 200);
          assert.strictEqual(req.hasSizeError(), false);
          assert.strictEqual(res.text, '\u3042');
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T90: Browser compressed ISO-2022-JP text with JIS X 0201 Roman state (Yen) within maxResponseSize succeeds
    it('should accurately measure ISO-2022-JP compressed text response with JIS X 0201 Roman state (Yen) within maxResponseSize', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          // In ISO-2022-JP, '\u00a5' is 7 bytes: ESC ( J (3 bytes) + 0x5c (1 byte) + ESC ( B (3 bytes).
          this.responseText = '\u00a5';
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() {
          return 'Content-Type: text/plain; charset=iso-2022-jp\r\nContent-Encoding: gzip\r\nContent-Length: 1\r\n';
        }
        getResponseHeader(name) {
          if (!name) return null;
          const k = name.toLowerCase();
          if (k === 'content-type') return 'text/plain; charset=iso-2022-jp';
          if (k === 'content-encoding') return 'gzip';
          if (k === 'content-length') return '1';
          return null;
        }
        send() {
          this.emit('progress', { lengthComputable: true, loaded: 1, total: 1 });
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

      // With maxResponseSize(7), the 7-byte ISO-2022-JP body is within limit and must succeed.
      const req = clientRequest('GET', 'http://example.com/compressed-iso-2022-jp-yen-within')
        .maxResponseSize(7);

      req.end((err, res) => {
        try {
          assert.ifError(err);
          assert.strictEqual(res.status, 200);
          assert.strictEqual(req.hasSizeError(), false);
          assert.strictEqual(res.text, '\u00a5');
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T91: Browser compressed ISO-2022-JP text with JIS X 0201 Roman state (Yen) exceeding maxResponseSize aborts with ETOOLARGE
    it('should emit ETOOLARGE when ISO-2022-JP compressed text response with JIS X 0201 Roman state exceeds maxResponseSize', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          // In ISO-2022-JP, '\u00a5' is 7 bytes: ESC ( J (3 bytes) + 0x5c (1 byte) + ESC ( B (3 bytes).
          this.responseText = '\u00a5';
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() {
          return 'Content-Type: text/plain; charset=iso-2022-jp\r\nContent-Encoding: gzip\r\nContent-Length: 1\r\n';
        }
        getResponseHeader(name) {
          if (!name) return null;
          const k = name.toLowerCase();
          if (k === 'content-type') return 'text/plain; charset=iso-2022-jp';
          if (k === 'content-encoding') return 'gzip';
          if (k === 'content-length') return '1';
          return null;
        }
        send() {
          this.emit('progress', { lengthComputable: true, loaded: 1, total: 1 });
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

      // With maxResponseSize(6), the 7-byte ISO-2022-JP body exceeds limit and must abort with ETOOLARGE.
      const req = clientRequest('GET', 'http://example.com/compressed-iso-2022-jp-yen-exceed')
        .maxResponseSize(6);

      req.end((err) => {
        try {
          assert.ok(err, 'Expected ETOOLARGE error for ISO-2022-JP Roman state exceeding maxResponseSize');
          assert.strictEqual(err.code, 'ETOOLARGE');
          assert.strictEqual(req.hasSizeError(), true);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T84: Browser retry retains multipart payload when only maxResponseSize is configured
    it('should retain and resend multipart payload on retry when only maxResponseSize is configured', (done) => {
      const EventEmitter = require('events');
      let attempts = 0;
      const sentPayloads = [];

      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.attemptNum = ++attempts;
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() { return ''; }
        getResponseHeader() { return null; }
        send(d) {
          sentPayloads.push(d);
          if (this.attemptNum === 1) {
            this.status = 500;
            this.readyState = 4;
            this.emit('readystatechange');
            this.emit('load');
          } else {
            this.status = 200;
            this.responseText = 'OK';
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

      const req = clientRequest('POST', 'http://example.com/retry-multipart-response-size')
        .field('a', 'b')
        .maxResponseSize(1000)
        .retry(1);

      req.end((err) => {
        try {
          assert.ifError(err);
          assert.strictEqual(attempts, 2, 'Expected 2 attempts');
          assert.strictEqual(sentPayloads.length, 2, 'Expected 2 payloads sent across attempts');
          assert.ok(sentPayloads[0], 'Expected valid payload on first attempt');
          assert.ok(sentPayloads[1], 'Expected valid payload on retry attempt');
          assert.strictEqual(sentPayloads[0], sentPayloads[1], 'Expected exact same cached FormData Blob to be replayed on retry');
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T85: Browser decompressed UTF-8 response with BOM byte accounting
    it('should emit ETOOLARGE when browser decompressed UTF-8 response with BOM exceeds maxResponseSize', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          // 1 char in UTF-8. With stripped BOM (EF BB BF), entity was 4 bytes.
          this.responseText = '\uFEFFa';
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

      // Limit 1: entity has 4 bytes (3 BOM + 1 'a') => 4 > 1 => ETOOLARGE
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

    // T87: Browser HZ-GB-2312 stateful encoding correctly counts ~{ / ~} escape overhead
    it('should emit ETOOLARGE when browser compressed HZ-GB-2312 response exceeds maxResponseSize accounting for state escapes', (done) => {
      const EventEmitter = require('events');
      // '\u4E2D' decoded from HZ-GB-2312 is 1 Unicode char.
      // In HZ-GB-2312 wire format: ~{ (2 bytes) + 0xD6 0xD0 (2 bytes) + ~} (2 bytes) = 6 bytes total.
      // maxResponseSize(2) must reject this because 6 > 2.
      const decodedChar = '\u4E2D'; // '\u4E2D'
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() {
          return 'Content-Type: text/plain; charset=hz-gb-2312\r\nContent-Encoding: gzip\r\nContent-Length: 6\r\n';
        }
        getResponseHeader(name) {
          if (!name) return null;
          const k = name.toLowerCase();
          if (k === 'content-type') return 'text/plain; charset=hz-gb-2312';
          if (k === 'content-encoding') return 'gzip';
          if (k === 'content-length') return '6';
          return null;
        }
        send() {
          // Simulate decompressed responseText â€” XHR strips escape sequences and gives Unicode
          setTimeout(() => {
            this.readyState = 4;
            this.status = 200;
            this.responseText = decodedChar;
            this.emit('readystatechange');
            this.emit('load');
          }, 5);
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      clientRequest.getXHR = () => new MockXHR();

      // '\u4E2D' in HZ-GB-2312 = 6 bytes; maxResponseSize(2) must reject it
      const req = clientRequest('GET', 'http://example.com/compressed-hz-gb')
        .maxResponseSize(2);

      req.end((err) => {
        try {
          assert.ok(err, 'Expected ETOOLARGE for HZ-GB-2312 response exceeding maxResponseSize');
          assert.strictEqual(err.code, 'ETOOLARGE');
          assert.strictEqual(req.hasSizeError(), true);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    // T88: Browser HZ-GB-2312 response within limit succeeds (no false ETOOLARGE)
    it('should accurately measure HZ-GB-2312 compressed text response within maxResponseSize without false ETOOLARGE', (done) => {
      const EventEmitter = require('events');
      // '\u4E2D' in HZ-GB-2312 = 6 bytes; maxResponseSize(6) must succeed.
      const decodedChar = '\u4E2D'; // '\u4E2D'
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() {
          return 'Content-Type: text/plain; charset=hz-gb-2312\r\nContent-Encoding: gzip\r\nContent-Length: 6\r\n';
        }
        getResponseHeader(name) {
          if (!name) return null;
          const k = name.toLowerCase();
          if (k === 'content-type') return 'text/plain; charset=hz-gb-2312';
          if (k === 'content-encoding') return 'gzip';
          if (k === 'content-length') return '6';
          return null;
        }
        send() {
          setTimeout(() => {
            this.readyState = 4;
            this.status = 200;
            this.responseText = decodedChar;
            this.emit('readystatechange');
            this.emit('load');
          }, 5);
        }
        abort() { this.emit('abort'); }
        addEventListener(e, cb) { this.on(e, cb); }
        removeEventListener(e, cb) { this.off(e, cb); }
      }

      clientRequest.getXHR = () => new MockXHR();

      // '\u4E2D' in HZ-GB-2312 = exactly 6 bytes; maxResponseSize(6) must not trigger ETOOLARGE
      const req = clientRequest('GET', 'http://example.com/compressed-hz-gb-within')
        .maxResponseSize(6);

      req.end((err, res) => {
        try {
          assert.ifError(err);
          assert.strictEqual(res.status, 200);
          assert.strictEqual(req.hasSizeError(), false);
          done();
        } catch (e) {
          done(e);
        }
      });
    });
  });

  // T29: JSON object payload sizing
  it('should measure byte length for JSON object payload in maxRequestSize', (done) => {
    request
      .post(`${base}/echo`)
      .maxRequestSize(10)
      .send({ key: 'this string value alone exceeds 10 bytes' })
      .end((err) => {
        try {
          assert.ok(err, 'Expected error for JSON payload exceeding maxRequestSize');
          assert.equal(err.code, 'ETOOLARGE');
          done();
        } catch (e) {
          done(e);
        }
      });
  });

  // T30: Multipart .attach() size enforcement
  it('should emit ETOOLARGE on maxRequestSize exceeded during multipart file attach', (done) => {
    const req = request
      .post(`${base}/echo`)
      .maxRequestSize(10)
      .attach('file', Buffer.alloc(100), 'large-file.dat');

    req.end((err) => {
      try {
        assert.ok(err, 'Expected error for attached file exceeding maxRequestSize');
        assert.equal(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T31: Unbuffered chunked response overflow emits ETOOLARGE error
  it('should emit ETOOLARGE on unbuffered chunked response stream overflow', (done) => {
    const req = request
      .get(`${base}/large-response`)
      .buffer(false)
      .maxResponseSize(2);
    req.end((err, res) => {
      if (err) {
        try {
          assert.equal(err.code, 'ETOOLARGE');
          done();
        } catch (e) {
          done(e);
        }
        return;
      }
      res.on('error', (streamErr) => {
        try {
          assert.equal(streamErr.code, 'ETOOLARGE');
          assert.strictEqual(req.hasSizeError(), true);
          done();
        } catch (e) {
          done(e);
        }
      });
    });
  });

  // T32: Unbuffered response with declared Content-Length overflow aborts with ETOOLARGE
  it('should abort with ETOOLARGE on unbuffered response when Content-Length exceeds maxResponseSize', (done) => {
    const req = request
      .get(`${base}/exact-response-5`)
      .buffer(false)
      .maxResponseSize(2);
    req.end((err) => {
      try {
        assert.ok(err, 'Expected error for unbuffered Content-Length overflow');
        assert.equal(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T33: Node multipart request replays serialized body on retry after 500 error
  it('should replay serialized multipart payload on retry after 500 error on Node', (done) => {
    multipartRetryCount = 0;
    multipartAttempts = [];
    request
      .post(`${base}/multipart-retry`)
      .field('key1', 'value1')
      .field('key2', 'value2')
      .maxRequestSize(1000)
      .retry(1)
      .end((err, res) => {
        try {
          assert.ifError(err);
          assert.strictEqual(res.status, 200);
          assert.strictEqual(multipartRetryCount, 2, 'Expected 2 attempts for 500 retry');
          assert.strictEqual(multipartAttempts.length, 2, 'Expected 2 server attempts');
          assert.ok(multipartAttempts[0].body.equals(multipartAttempts[1].body), 'Expected replayed multipart payload to match first attempt byte-for-byte');
          assert.strictEqual(multipartAttempts[0].headers['content-type'], multipartAttempts[1].headers['content-type'], 'Expected matching Content-Type header on retry');
          const bodyStr = res.text || (res.body ? res.body.toString() : '');
          assert.ok(bodyStr.includes('name="key1"'), 'Expected retried request to contain key1');
          assert.ok(bodyStr.includes('value1'), 'Expected retried request to contain value1');
          assert.ok(bodyStr.includes('name="key2"'), 'Expected retried request to contain key2');
          assert.ok(bodyStr.includes('value2'), 'Expected retried request to contain value2');
          done();
        } catch (e) {
          done(e);
        }
      });
  });

  // T34: Node piped response aborts with ETOOLARGE on declared oversized Content-Length before body arrives
  it('should abort piped response with ETOOLARGE on declared oversized Content-Length before body arrives', (done) => {
    const stream = require('stream');
    const dest = new stream.PassThrough();
    let errorFired = false;

    const onErr = (err) => {
      if (errorFired) return;
      errorFired = true;
      try {
        assert.ok(err, 'Expected error on piped response exceeding maxResponseSize');
        assert.equal(err.code, 'ETOOLARGE');
        done();
      } catch (e) {
        done(e);
      }
    };

    dest.on('error', onErr);

    const req = request
      .get(`${base}/pipe-delayed-cl-oversized`)
      .maxResponseSize(10)
      .pipe(dest);

    req.on('error', onErr);
  });

  // T68: Size error with retry(0) configured reports err.retries === 0 in Node
  it('should report err.retries === 0 on size error with retry(0) configured (Node)', (done) => {
    request
      .get(`${base}/large-response`)
      .retry(0)
      .maxResponseSize(10)
      .end((err) => {
        try {
          assert.ok(err, 'Expected size error');
          assert.strictEqual(err.code, 'ETOOLARGE');
          assert.strictEqual(err.retries, 0, 'Expected err.retries to be 0 for retry(0)');
          done();
        } catch (e) {
          done(e);
        }
      });
  });

  // T69: Node multipart upload without maxRequestSize streams directly and completes successfully
  it('should stream Node multipart upload directly when maxRequestSize is not set', (done) => {
    const req = request
      .post(`${base}/echo`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks).toString()));
      })
      .field('field1', 'val1')
      .field('field2', 'val2');

    req.end((err, res) => {
      try {
        assert.ifError(err);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(req.hasSizeError(), false);
        const bodyStr = res.body || '';
        assert.ok(bodyStr.includes('name="field1"'), 'Expected echo to contain field1');
        assert.ok(bodyStr.includes('val1'), 'Expected echo to contain val1');
        assert.ok(bodyStr.includes('name="field2"'), 'Expected echo to contain field2');
        assert.ok(bodyStr.includes('val2'), 'Expected echo to contain val2');
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T81: Node unbuffered chunked response without Content-Length delivers ETOOLARGE to error listeners
  it('should deliver ETOOLARGE to request error listener and response stream on unbuffered chunked overflow', (done) => {
    let reqErr = null;
    let resErr = null;

    const req = request
      .get(`${base}/stream-data`)
      .buffer(false)
      .maxResponseSize(2);

    req.on('error', (err) => {
      reqErr = err;
    });

    req.on('response', (res) => {
      res.on('error', (err) => {
        resErr = err;
      });
    });

    req.end((err) => {
      assert.ifError(err);
      setTimeout(() => {
        try {
          assert.strictEqual(req.hasSizeError(), true);
          assert.ok(reqErr, 'Expected ETOOLARGE in request error listener');
          assert.strictEqual(reqErr.code, 'ETOOLARGE');
          assert.ok(resErr, 'Expected ETOOLARGE in response error listener');
          assert.strictEqual(resErr.code, 'ETOOLARGE');
          done();
        } catch (e) {
          done(e);
        }
      }, 50);
    });
  });

  // T82: Node multipart request replays serialized body on retry after 500 error when only maxResponseSize is configured
  it('should replay serialized multipart payload on retry after 500 error when only maxResponseSize is configured', (done) => {
    multipartRetryCount = 0;
    multipartAttempts = [];
    request
      .post(`${base}/multipart-retry`)
      .field('key1', 'value1')
      .field('key2', 'value2')
      .maxResponseSize(1000)
      .retry(1)
      .end((err, res) => {
        try {
          assert.ifError(err);
          assert.strictEqual(res.status, 200);
          assert.strictEqual(multipartRetryCount, 2, 'Expected 2 attempts for 500 retry');
          assert.strictEqual(multipartAttempts.length, 2, 'Expected 2 server attempts');
          assert.ok(multipartAttempts[0].body.equals(multipartAttempts[1].body), 'Expected replayed multipart payload to match first attempt byte-for-byte');
          assert.strictEqual(multipartAttempts[0].headers['content-type'], multipartAttempts[1].headers['content-type'], 'Expected matching Content-Type header on retry');
          const bodyStr = res.text || (res.body ? res.body.toString() : '');
          assert.ok(bodyStr.includes('name="key1"'), 'Expected retried request to contain key1');
          assert.ok(bodyStr.includes('value1'), 'Expected retried request to contain value1');
          assert.ok(bodyStr.includes('name="key2"'), 'Expected retried request to contain key2');
          assert.ok(bodyStr.includes('value2'), 'Expected retried request to contain value2');
          done();
        } catch (e) {
          done(e);
        }
      });
  });

  // T83: Limited unbuffered Response stream emits end event without data listener
  it('should complete normally with res.once("end", done) on unbuffered response within maxResponseSize without data listener', (done) => {
    let endCalled = false;
    const req = request
      .get(`${base}/stream-data`)
      .buffer(false)
      .maxResponseSize(1000);

    req.on('response', (res) => {
      res.once('end', () => {
        endCalled = true;
      });
    });

    req.end((err, res) => {
      try {
        assert.ifError(err);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(req.hasSizeError(), false);
        res.once('end', () => {
          try {
            assert.strictEqual(endCalled, true, 'Expected res.once("end") to be called without data listener');
            done();
          } catch (e) {
            done(e);
          }
        });
      } catch (e) {
        done(e);
      }
    });
  });

  // T86: Limited unbuffered Node responses route ordinary stream errors into response stream error listener
  it('should emit ECONNRESET on unbuffered response stream when connection resets', (done) => {
    unbufferedRetryCount = 0;
    const req = request
      .get(`${base}/unbuffered-retry-econnreset`)
      .buffer(false)
      .maxResponseSize(1000);

    assert.strictEqual(typeof req.hasSizeError, 'function', 'hasSizeError must be implemented');
    assert.strictEqual(req.hasSizeError(), false);

    req.on('error', () => {});

    req.end((err, res) => {
      assert.ifError(err);
      assert.strictEqual(res.status, 200);
      res.on('error', (streamErr) => {
        try {
          assert.ok(streamErr);
          assert.strictEqual(streamErr.code, 'ECONNRESET');
          done();
        } catch (e) {
          done(e);
        }
      });
    });
  });

  // T89: Early Node response must not settle unbuffered limited upload before upload finishes or crosses limit
  it('should emit ETOOLARGE when early response arrives but unbuffered upload later exceeds maxRequestSize', (done) => {
    const req = request
      .post(`${base}/early-response-limited-upload`)
      .buffer(false)
      .maxRequestSize(10);

    req.write('12345'); // 5 bytes <= 10

    setTimeout(() => {
      const w2 = req.write('1234567890'); // 5 + 10 = 15 > 10!
      assert.strictEqual(w2, false, 'Expected overflowing write() to return false');
      assert.strictEqual(req.hasSizeError(), true);
      req.end((err) => {
        try {
          assert.ok(err, 'Expected error on request exceeding maxRequestSize');
          assert.strictEqual(err.code, 'ETOOLARGE');
          assert.strictEqual(req.hasSizeError(), true);
          done();
        } catch (e) {
          done(e);
        }
      });
    }, 50);
  });

  // T93: Browser decompressed GB18030 response with U+0080 byte accounting (81 30 81 30 = 4 bytes)
  it('should emit ETOOLARGE when browser decompressed GB18030 U+0080 response exceeds maxResponseSize(2)', (done) => {
    const EventEmitter = require('events');
    class MockXHR extends EventEmitter {
      constructor() {
        super();
        this.readyState = 0;
        this.status = 200;
        // In GB18030, U+0080 is encoded as the 4-byte sequence 81 30 81 30
        this.responseText = '\u0080';
      }
      open() { this.readyState = 1; }
      setRequestHeader() {}
      getAllResponseHeaders() {
        return 'Content-Type: text/plain; charset=gb18030\r\nContent-Encoding: gzip\r\nContent-Length: 20\r\n';
      }
      getResponseHeader(name) {
        if (!name) return null;
        const k = name.toLowerCase();
        if (k === 'content-type') return 'text/plain; charset=gb18030';
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

    // Limit 2: U+0080 entity has 4 bytes (81 30 81 30) => 4 > 2 => ETOOLARGE
    const req = clientRequest('GET', 'http://example.com/compressed-gb18030-u0080')
      .maxResponseSize(2);

    req.end((err) => {
      try {
        assert.ok(err, 'Expected ETOOLARGE for 4-byte GB18030 sequence exceeding limit 2');
        assert.strictEqual(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T94: Browser decompressed GB18030 response with U+0080 succeeds within limit
  it('should accurately measure GB18030 U+0080 response within maxResponseSize(4)', (done) => {
    const EventEmitter = require('events');
    class MockXHR extends EventEmitter {
      constructor() {
        super();
        this.readyState = 0;
        this.status = 200;
        this.responseText = '\u0080';
      }
      open() { this.readyState = 1; }
      setRequestHeader() {}
      getAllResponseHeaders() {
        return 'Content-Type: text/plain; charset=gb18030\r\nContent-Encoding: gzip\r\nContent-Length: 20\r\n';
      }
      getResponseHeader(name) {
        if (!name) return null;
        const k = name.toLowerCase();
        if (k === 'content-type') return 'text/plain; charset=gb18030';
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

    // Limit 4: U+0080 is 4 bytes => 4 <= 4 => success
    const req = clientRequest('GET', 'http://example.com/compressed-gb18030-u0080-ok')
      .maxResponseSize(4);

    req.end((err, res) => {
      try {
        assert.ifError(err);
        assert.strictEqual(req.hasSizeError(), false);
        assert.strictEqual(res.status, 200);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T95: Browser decompressed UTF-8 response where XHR text decoder consumed BOM
  it('should emit ETOOLARGE when browser decompressed UTF-8 response consumed BOM but entity was 4 bytes', (done) => {
    const EventEmitter = require('events');
    class MockXHR extends EventEmitter {
      constructor() {
        super();
        this.readyState = 0;
        this.status = 200;
        // Text decoder consumed BOM (EF BB BF), leaving only 'a' in responseText
        this.responseText = 'a';
        // Binary representation preserved before text decoding
        this.response = Buffer.from([0xef, 0xbb, 0xbf, 0x61]);
      }
      open() { this.readyState = 1; }
      setRequestHeader() {}
      getAllResponseHeaders() {
        // Content-Encoding unexposed (e.g. CORS)
        return 'Content-Type: text/plain; charset=utf-8\r\nContent-Length: 10\r\n';
      }
      getResponseHeader(name) {
        if (!name) return null;
        const k = name.toLowerCase();
        if (k === 'content-type') return 'text/plain; charset=utf-8';
        if (k === 'content-length') return '10';
        return null;
      }
      send() {
        this.emit('progress', { lengthComputable: true, loaded: 10, total: 10 });
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

    // Limit 1: 4 entity bytes (3 BOM + 1 char) => 4 > 1 => ETOOLARGE
    const req = clientRequest('GET', 'http://example.com/cors-unexposed-utf8-bom')
      .maxResponseSize(1);

    req.end((err) => {
      try {
        assert.ok(err, 'Expected ETOOLARGE for 4-byte entity exceeding maxResponseSize(1)');
        assert.strictEqual(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T96: Cross-origin 307 redirect preserves POST body
  it('should preserve POST body on cross-origin 307 redirect', (done) => {
    let targetReceivedBody = '';
    let targetHeaders = null;
    const targetServer = http.createServer((tReq, tRes) => {
      let chunks = [];
      tReq.on('data', (c) => chunks.push(c));
      tReq.on('end', () => {
        targetReceivedBody = Buffer.concat(chunks).toString();
        targetHeaders = tReq.headers;
        tRes.writeHead(200, { 'Content-Type': 'text/plain' });
        tRes.end('target-ok');
      });
    });

    targetServer.listen(0, () => {
      const targetPort = targetServer.address().port;
      const redirectServer = http.createServer((rReq, rRes) => {
        rRes.writeHead(307, {
          Location: `http://localhost:${targetPort}/target-307`
        });
        rRes.end();
      });

      redirectServer.listen(0, () => {
        const redirectPort = redirectServer.address().port;
        const payload = JSON.stringify({ message: 'preserved-body-across-origins' });

        request
          .post(`http://localhost:${redirectPort}/origin-307`)
          .set('Content-Type', 'application/json')
          .set('Authorization', 'secret-token')
          .send(payload)
          .redirects(2)
          .end((err, res) => {
            targetServer.close();
            redirectServer.close();
            try {
              assert.ifError(err);
              assert.strictEqual(res.status, 200);
              assert.strictEqual(res.text, 'target-ok');
              assert.strictEqual(targetReceivedBody, payload, 'Expected POST body to be preserved on 307 redirect');
              assert.strictEqual(targetHeaders.authorization, undefined, 'Expected Authorization header to be stripped across origins');
              done();
            } catch (e) {
              done(e);
            }
          });
      });
    });
  });

  // T97: Browser compressed GB18030 response with U+0400 (4 bytes in GB18030) exceeds limit 2
  it('should emit ETOOLARGE when browser decompressed GB18030 U+0400 response exceeds maxResponseSize(2)', (done) => {
    const EventEmitter = require('events');
    class MockXHR extends EventEmitter {
      constructor() {
        super();
        this.readyState = 0;
        this.status = 200;
        // In GB18030, U+0400 is not in the GBK 2-byte repertoire and encodes as a 4-byte sequence
        this.responseText = '\u0400';
      }
      open() { this.readyState = 1; }
      setRequestHeader() {}
      getAllResponseHeaders() {
        return 'Content-Type: text/plain; charset=gb18030\r\nContent-Encoding: gzip\r\nContent-Length: 20\r\n';
      }
      getResponseHeader(name) {
        if (!name) return null;
        const k = name.toLowerCase();
        if (k === 'content-type') return 'text/plain; charset=gb18030';
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

    // Limit 2: U+0400 decoded entity has 4 bytes in GB18030 => 4 > 2 => ETOOLARGE
    const req = clientRequest('GET', 'http://example.com/compressed-gb18030-u0400')
      .responseType('text')
      .maxResponseSize(2);

    req.end((err) => {
      try {
        assert.ok(err, 'Expected ETOOLARGE for 4-byte GB18030 U+0400 exceeding limit 2');
        assert.strictEqual(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T98: Browser compressed GB18030 response with U+0400 succeeds within limit 4
  it('should accurately measure GB18030 U+0400 response within maxResponseSize(4)', (done) => {
    const EventEmitter = require('events');
    class MockXHR extends EventEmitter {
      constructor() {
        super();
        this.readyState = 0;
        this.status = 200;
        this.responseText = '\u0400';
      }
      open() { this.readyState = 1; }
      setRequestHeader() {}
      getAllResponseHeaders() {
        return 'Content-Type: text/plain; charset=gb18030\r\nContent-Encoding: gzip\r\nContent-Length: 20\r\n';
      }
      getResponseHeader(name) {
        if (!name) return null;
        const k = name.toLowerCase();
        if (k === 'content-type') return 'text/plain; charset=gb18030';
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

    const req = clientRequest('GET', 'http://example.com/compressed-gb18030-u0400-ok')
      .responseType('text')
      .maxResponseSize(4);

    req.end((err, res) => {
      try {
        assert.ifError(err);
        assert.strictEqual(req.hasSizeError(), false);
        assert.strictEqual(res.status, 200);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T99: 307 redirect strips Authorization and Cookie on scheme change (HTTPS to HTTP) even if host matches
  it('should strip Authorization and Cookie on 307 redirect across scheme change from HTTPS to HTTP', (done) => {
    const req = request('POST', 'https://example.test/secure-resource');
    req.set('Authorization', 'Bearer secret-token');
    req.set('Cookie', 'session=abc123xyz');
    req.redirects(2);

    req.req = {
      getHeaders: () => ({
        authorization: 'Bearer secret-token',
        cookie: 'session=abc123xyz',
        host: 'example.test'
      }),
      abort: () => {}
    };
    req.end = () => {};

    const mockRes = {
      statusCode: 307,
      headers: {
        location: 'http://example.test/insecure-target'
      },
      resume: () => {},
      setEncoding: () => {},
      on: () => {}
    };

    req._redirect(mockRes);

    try {
      assert.strictEqual(req.url, 'http://example.test/insecure-target');
      assert.strictEqual(req._header.authorization, undefined, 'Authorization must be stripped on HTTPS to HTTP redirect');
      assert.strictEqual(req._header.cookie, undefined, 'Cookie must be stripped on HTTPS to HTTP redirect');
      done();
    } catch (e) {
      done(e);
    }
  });

  // T100: 307 redirect preserves Authorization and Cookie on same-origin redirect (HTTPS to HTTPS on same host)
  it('should preserve Authorization and Cookie on 307 redirect on same origin', (done) => {
    const EventEmitter = require('events');
    const req = request('POST', 'https://example.test/secure-resource')
      .maxResponseSize(5000);
    req.set('Authorization', 'Bearer secret-token');
    req.set('Cookie', 'session=abc123xyz');
    req.redirects(2);

    req.req = {
      getHeaders: () => ({
        authorization: 'Bearer secret-token',
        cookie: 'session=abc123xyz',
        host: 'example.test'
      }),
      abort: () => {}
    };
    req.end = () => {};

    const mockRes = new EventEmitter();
    mockRes.statusCode = 307;
    mockRes.headers = {
      location: 'https://example.test/secure-target'
    };
    mockRes.resume = () => {};
    mockRes.setEncoding = () => {};

    req._redirect(mockRes);
    mockRes.emit('end');

    try {
      assert.strictEqual(req.hasSizeError(), false);
      assert.strictEqual(req.url, 'https://example.test/secure-target');
      assert.strictEqual(req._header.authorization, 'Bearer secret-token', 'Authorization must be preserved on same origin redirect');
      assert.strictEqual(req._header.cookie, 'session=abc123xyz', 'Cookie must be preserved on same origin redirect');
      done();
    } catch (e) {
      done(e);
    }
  });

  // T101: Browser compressed GB18030 response with U+20AC (single-byte Euro 0x80) succeeds at maxResponseSize(1)
  it('should not emit ETOOLARGE for GB18030 0x80 (U+20AC euro) decoded body at maxResponseSize(1)', (done) => {
    const EventEmitter = require('events');
    class MockXHR extends EventEmitter {
      constructor() {
        super();
        this.readyState = 0;
        this.status = 200;
        this.responseText = '\u20AC';
      }
      open() { this.readyState = 1; }
      setRequestHeader() {}
      getAllResponseHeaders() {
        return 'Content-Type: text/plain; charset=gb18030\r\nContent-Encoding: gzip\r\nContent-Length: 20\r\n';
      }
      getResponseHeader(name) {
        if (!name) return null;
        const k = name.toLowerCase();
        if (k === 'content-type') return 'text/plain; charset=gb18030';
        if (k === 'content-encoding') return 'gzip';
        if (k === 'content-length') return '20';
        return null;
      }
      send() {
        setTimeout(() => {
          this.readyState = 4;
          this.emit('readystatechange');
        }, 10);
      }
      abort() { this.aborted = true; }
      addEventListener(e, cb) { this.on(e, cb); }
      removeEventListener(e, cb) { this.off(e, cb); }
    }

    clientRequest.getXHR = () => new MockXHR();

    // GB18030 byte 0x80 decodes to U+20AC (Euro). In GB18030, Euro is a valid single-byte character (1 byte).
    // At maxResponseSize(1), a single Euro character must NOT exceed the limit and must NOT trigger ETOOLARGE.
    const req = clientRequest('GET', 'http://example.com/gb18030-euro-single-byte')
      .responseType('text')
      .maxResponseSize(1);

    req.end((err, res) => {
      try {
        assert.ifError(err);
        assert.strictEqual(req.hasSizeError(), false);
        assert.strictEqual(res.status, 200);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T102: Browser compressed GB18030 response with two Euro characters (2 bytes) exceeds maxResponseSize(1)
  it('should emit ETOOLARGE for GB18030 two Euro characters exceeding maxResponseSize(1)', (done) => {
    const EventEmitter = require('events');
    class MockXHR extends EventEmitter {
      constructor() {
        super();
        this.readyState = 0;
        this.status = 200;
        this.responseText = '\u20AC\u20AC';
      }
      open() { this.readyState = 1; }
      setRequestHeader() {}
      getAllResponseHeaders() {
        return 'Content-Type: text/plain; charset=gb18030\r\nContent-Encoding: gzip\r\nContent-Length: 20\r\n';
      }
      getResponseHeader(name) {
        if (!name) return null;
        const k = name.toLowerCase();
        if (k === 'content-type') return 'text/plain; charset=gb18030';
        if (k === 'content-encoding') return 'gzip';
        if (k === 'content-length') return '20';
        return null;
      }
      send() {
        setTimeout(() => {
          this.readyState = 4;
          this.emit('readystatechange');
        }, 10);
      }
      abort() { this.aborted = true; }
      addEventListener(e, cb) { this.on(e, cb); }
      removeEventListener(e, cb) { this.off(e, cb); }
    }

    clientRequest.getXHR = () => new MockXHR();

    // Two Euro characters in GB18030 = 2 bytes > limit of 1 byte => ETOOLARGE
    const req = clientRequest('GET', 'http://example.com/gb18030-euro-two-bytes')
      .responseType('text')
      .maxResponseSize(1);

    req.end((err) => {
      try {
        assert.ok(err, 'Expected ETOOLARGE for 2-byte GB18030 Euro characters exceeding limit 1');
        assert.strictEqual(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T101: 305 redirect preserves POST body and method
  it('should preserve POST body on 305 redirect', (done) => {
    let targetReceivedBody = '';
    let targetMethod = '';
    const targetServer = http.createServer((tReq, tRes) => {
      let chunks = [];
      targetMethod = tReq.method;
      tReq.on('data', (c) => chunks.push(c));
      tReq.on('end', () => {
        targetReceivedBody = Buffer.concat(chunks).toString();
        tRes.writeHead(200, { 'Content-Type': 'application/json' });
        tRes.end(JSON.stringify({ ok: true }));
      });
    });

    targetServer.listen(0, () => {
      const targetPort = targetServer.address().port;
      const redirectServer = http.createServer((rReq, rRes) => {
        rRes.writeHead(305, {
          Location: `http://localhost:${targetPort}/proxy-target-305`
        });
        rRes.end();
      });

      redirectServer.listen(0, () => {
        const redirectPort = redirectServer.address().port;
        const payload = JSON.stringify({ message: 'preserved-body-305' });

        const req = request
          .post(`http://localhost:${redirectPort}/origin-305`)
          .maxRequestSize(5000)
          .set('Content-Type', 'application/json')
          .send(payload)
          .redirects(2);

        req.end((err, res) => {
            targetServer.close();
            redirectServer.close();
            try {
              assert.ifError(err);
              assert.strictEqual(req.hasSizeError(), false);
              assert.strictEqual(res.status, 200);
              assert.strictEqual(targetMethod, 'POST');
              assert.strictEqual(targetReceivedBody, payload);
              done();
            } catch (e) {
              done(e);
            }
          });
      });
    });
  });

  // T102: Browser responseType('text') decompressed UTF-8 response where text decoder consumed BOM exceeds limit 1
  it('should emit ETOOLARGE when browser responseType("text") decompressed UTF-8 response consumed BOM but entity was 4 bytes', (done) => {
    const EventEmitter = require('events');
    class MockXHR extends EventEmitter {
      constructor() {
        super();
        this.readyState = 0;
        this.status = 200;
        this._raw = Buffer.from([0xef, 0xbb, 0xbf, 0x61]);
        this.responseText = 'a';
        this.response = 'a';
      }
      set responseType(v) {
        this._responseType = v;
        if (v === 'arraybuffer') {
          this.response = this._raw;
        } else if (v === 'text' || !v) {
          this.response = 'a';
        }
      }
      get responseType() {
        return this._responseType || '';
      }
      open() { this.readyState = 1; }
      setRequestHeader() {}
      getAllResponseHeaders() {
        return 'Content-Type: text/plain; charset=utf-8\r\nContent-Length: 10\r\n';
      }
      getResponseHeader(name) {
        if (!name) return null;
        const k = name.toLowerCase();
        if (k === 'content-type') return 'text/plain; charset=utf-8';
        if (k === 'content-length') return '10';
        return null;
      }
      send() {
        this.emit('progress', { lengthComputable: true, loaded: 10, total: 10 });
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

    // Limit 1: 4 entity bytes (3 BOM + 1 char) => 4 > 1 => ETOOLARGE
    const req = clientRequest('GET', 'http://example.com/cors-unexposed-utf8-bom-text')
      .responseType('text')
      .maxResponseSize(1);

    req.end((err) => {
      try {
        assert.ok(err, 'Expected ETOOLARGE for 4-byte entity exceeding maxResponseSize(1) even with responseType("text")');
        assert.strictEqual(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T103: Browser responseType('text') UTF-8 response with BOM succeeds within maxResponseSize(4)
  it('should accurately measure browser responseType("text") UTF-8 response with BOM within maxResponseSize(4)', (done) => {
    const EventEmitter = require('events');
    class MockXHR extends EventEmitter {
      constructor() {
        super();
        this.readyState = 0;
        this.status = 200;
        this._raw = Buffer.from([0xef, 0xbb, 0xbf, 0x61]);
        this.responseText = 'a';
        this.response = 'a';
      }
      set responseType(v) {
        this._responseType = v;
        if (v === 'arraybuffer') {
          this.response = this._raw;
        } else if (v === 'text' || !v) {
          this.response = 'a';
        }
      }
      get responseType() {
        return this._responseType || '';
      }
      open() { this.readyState = 1; }
      setRequestHeader() {}
      getAllResponseHeaders() {
        return 'Content-Type: text/plain; charset=utf-8\r\nContent-Length: 10\r\n';
      }
      getResponseHeader(name) {
        if (!name) return null;
        const k = name.toLowerCase();
        if (k === 'content-type') return 'text/plain; charset=utf-8';
        if (k === 'content-length') return '10';
        return null;
      }
      send() {
        this.emit('progress', { lengthComputable: true, loaded: 4, total: 4 });
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

    // Limit 4: 4 entity bytes (3 BOM + 1 char) <= 4 => succeeds, text reconstructed
    const req = clientRequest('GET', 'http://example.com/cors-unexposed-utf8-bom-text-ok')
      .responseType('text')
      .maxResponseSize(4);

    req.end((err, res) => {
      try {
        assert.ifError(err);
        assert.strictEqual(req.hasSizeError(), false);
        assert.strictEqual(res.text, 'a');
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  // T104: Attaching data and end listeners inside an in-limit .buffer(false).maxResponseSize(...).end callback receives all data chunks and end event
  it('should stream data chunks to data and end listeners attached inside an in-limit .buffer(false).maxResponseSize(...).end callback', (done) => {
    let received = '';
    const req = request
      .get(`${base}/stream-data`)
      .buffer(false)
      .maxResponseSize(1000);

    assert.strictEqual(typeof req.hasSizeError, 'function', 'hasSizeError must be implemented');
    assert.strictEqual(req.hasSizeError(), false);

    req.end((err, res) => {
      try {
        assert.ifError(err);
        assert.ok(res, 'Expected response object in callback');
        assert.strictEqual(req.hasSizeError(), false);
        assert.strictEqual(res.status, 200);

        res.on('data', (chunk) => {
          received += chunk.toString();
        });

        res.on('end', () => {
          try {
            assert.strictEqual(received, 'chunk1chunk2');
            done();
          } catch (e) {
            done(e);
          }
        });
      } catch (e) {
        done(e);
      }
    });
  });

  // T105: Unbuffered limited responses retry post-header ECONNRESET and replay multipart payload
  it('should retry post-header ECONNRESET and replay multipart payload on unbuffered limited response', (done) => {
    let attemptCount = 0;
    let attempt2Body = '';
    const srv = http.createServer((sReq, sRes) => {
      attemptCount++;
      if (attemptCount === 1) {
        sReq.on('data', () => {});
        sReq.on('end', () => {
          sRes.writeHead(200, { 'Content-Type': 'text/plain' });
          sRes.flushHeaders();
          setTimeout(() => {
            if (sReq.socket && !sReq.socket.destroyed) {
              sReq.socket.destroy(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
            }
          }, 20);
        });
      } else {
        let b = '';
        sReq.on('data', (c) => { b += c.toString(); });
        sReq.on('end', () => {
          attempt2Body = b;
          sRes.writeHead(200, { 'Content-Type': 'text/plain' });
          sRes.end('retry-success-payload');
        });
      }
    });

    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      request
        .post(`http://127.0.0.1:${p}/test-unbuf-econnreset-replay`)
        .field('greeting', 'hello_multipart')
        .field('item', 'apple')
        .maxResponseSize(1000)
        .buffer(false)
        .retry(1)
        .end((err, res) => {
          srv.close(() => {
            try {
              assert.ifError(err);
              assert.strictEqual(res.status, 200);
              assert.strictEqual(attemptCount, 2, 'Expected 2 attempts (retried after post-header ECONNRESET)');
              assert(attempt2Body.includes('hello_multipart'), 'Expected replayed multipart field "greeting"');
              assert(attempt2Body.includes('apple'), 'Expected replayed multipart field "item"');
              done();
            } catch (e) {
              done(e);
            }
          });
        });
    });
  });

  // T106: Forced size decoding does NOT break request-event binary responseType overrides
  it('should preserve request-event responseType="arraybuffer" override when maxResponseSize is set', (done) => {
    const clientRequest = require('../../lib/client');
    const EventEmitter = require('events');

    class MockBinaryXHR extends EventEmitter {
      constructor() {
        super();
        this.readyState = 1;
        this.status = 200;
        this.response = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
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

    clientRequest
      .get('http://example.com/binary-data')
      .maxResponseSize(100)
      .on('request', function () {
        this.xhr.responseType = 'arraybuffer';
      })
      .end((err, res) => {
        try {
          assert.ifError(err);
          assert(res.body instanceof ArrayBuffer, 'Expected res.body to be an ArrayBuffer');
          assert.strictEqual(res.body.byteLength, 8);
          done();
        } catch (e) {
          done(e);
        }
      });
  });

  // T107: 307/308 redirects preserve FormData body without retries enabled
  it('should replay multipart FormData body on 307 redirect when maxRequestSize is set and retries=0', (done) => {
    let targetBody = '';
    const srv = http.createServer((sReq, sRes) => {
      if (sReq.url === '/init-307') {
        sReq.resume();
        sReq.on('end', () => {
          sRes.writeHead(307, {
            Location: '/dest-307',
            'Content-Type': 'text/plain'
          });
          sRes.end('redirecting');
        });
      } else if (sReq.url === '/dest-307') {
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
        .post(`http://127.0.0.1:${p}/init-307`)
        .field('username', 'alice')
        .field('token', 'xyz123')
        .maxRequestSize(1000)
        .end((err, res) => {
          srv.close(() => {
            try {
              assert.ifError(err);
              assert.strictEqual(res.status, 200);
              assert.strictEqual(res.text, 'target-ok');
              assert(targetBody.includes('alice'), '307 target received field "username"');
              assert(targetBody.includes('xyz123'), '307 target received field "token"');
              done();
            } catch (e) {
              done(e);
            }
          });
        });
    });
  });
});

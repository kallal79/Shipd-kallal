const EventEmitter = require('events');
const http = require('http');
const zlib = require('zlib');

// Global mock window
global.window = { location: { origin: 'http://example.com' } };

const clientRequest = require('../superagent/src/client');
const nodeRequest = require('../superagent/src/node');

let allPassed = true;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    allPassed = false;
  } else {
    console.log('PASS:', msg);
  }
}

async function runTests() {
  console.log('=== Test 1: Browser size failure after a transient retry ===');
  await new Promise((resolve) => {
    let attempt = 0;
    class MockRetryXHR extends EventEmitter {
      constructor() {
        super();
        attempt++;
        this.attempt = attempt;
        this.readyState = 0;
        this.status = 0;
        this.responseText = '';
      }
      open() { this.readyState = 1; }
      setRequestHeader() {}
      getAllResponseHeaders() { return 'content-type: text/plain'; }
      getResponseHeader(h) {
        if (h.toLowerCase() === 'content-type') return 'text/plain';
        return null;
      }
      send() {
        setTimeout(() => {
          if (this.attempt === 1) {
            // First attempt: transient 500 error
            this.readyState = 4;
            this.status = 500;
            this.responseText = 'Internal Server Error';
            this.emit('readystatechange');
            this.emit('load');
          } else {
            // Second attempt: 200 response with 100 bytes (exceeds limit 10)
            this.readyState = 4;
            this.status = 200;
            this.responseText = 'a'.repeat(100);
            this.emit('readystatechange');
            this.emit('load');
          }
        }, 10);
      }
      abort() { this.emit('abort'); }
      addEventListener(e, cb) { this.on(e, cb); }
      removeEventListener(e, cb) { this.off(e, cb); }
    }

    clientRequest.getXHR = () => new MockRetryXHR();

    let callbackCalled = false;
    const req = clientRequest('GET', 'http://example.com/retry-test')
      .retry(1)
      .maxResponseSize(10);
    req.end((err, res) => {
        callbackCalled = true;
        assert(err !== null, 'Error must be passed to callback');
        assert(err && err.code === 'ETOOLARGE', 'Error code must be ETOOLARGE');
        assert(err && err.retries === 0, 'Error retries must be 0');
        assert(req.hasSizeError() === true, 'req.hasSizeError() must be true');
        resolve();
      });

    setTimeout(() => {
      if (!callbackCalled) {
        assert(false, 'TIMEOUT: Callback was NEVER called on browser size error after retry!');
        resolve();
      }
    }, 500);
  });

  console.log('\n=== Test 2: Unconditional err.retries === 0 contract (without explicit retry) ===');
  // 2A: Browser request size error without retry
  await new Promise((resolve) => {
    class MockXHR extends EventEmitter {
      constructor() { super(); this.readyState = 0; }
      open() { this.readyState = 1; }
      setRequestHeader() {}
      send() {}
      abort() {}
      addEventListener(e, cb) { this.on(e, cb); }
      removeEventListener(e, cb) { this.off(e, cb); }
    }
    clientRequest.getXHR = () => new MockXHR();

    const req = clientRequest('POST', 'http://example.com/no-retry-req')
      .maxRequestSize(10);

    req.send('123456789012345'); // 15 bytes > 10
    req.end((err) => {
      assert(err && err.code === 'ETOOLARGE', 'Browser request size error ETOOLARGE');
      assert(err && err.retries === 0, `Browser request err.retries === 0 without retry (got ${err && err.retries})`);
      resolve();
    });
  });

  // 2B: Browser response size error without retry
  await new Promise((resolve) => {
    class MockXHR extends EventEmitter {
      constructor() { super(); this.readyState = 0; }
      open() { this.readyState = 1; }
      setRequestHeader() {}
      getAllResponseHeaders() { return 'content-type: text/plain'; }
      getResponseHeader(h) { return h.toLowerCase() === 'content-type' ? 'text/plain' : null; }
      send() {
        setTimeout(() => {
          this.readyState = 4;
          this.status = 200;
          this.responseText = 'hello world this is too large';
          this.emit('readystatechange');
          this.emit('load');
        }, 10);
      }
      abort() { this.emit('abort'); }
      addEventListener(e, cb) { this.on(e, cb); }
      removeEventListener(e, cb) { this.off(e, cb); }
    }
    clientRequest.getXHR = () => new MockXHR();

    const req = clientRequest('GET', 'http://example.com/no-retry-res')
      .maxResponseSize(5);

    req.end((err) => {
      assert(err && err.code === 'ETOOLARGE', 'Browser response size error ETOOLARGE');
      assert(err && err.retries === 0, `Browser response err.retries === 0 without retry (got ${err && err.retries})`);
      resolve();
    });
  });

  // 2C: Node request size error without retry
  await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      req.resume();
      res.end('ok');
    });
    server.listen(0, () => {
      const port = server.address().port;
      const req = nodeRequest.post(`http://localhost:${port}`)
        .maxRequestSize(5);

      req.write('toolargebody');
      req.end((err) => {
        assert(err && err.code === 'ETOOLARGE', 'Node request size error ETOOLARGE');
        assert(err && err.retries === 0, `Node request err.retries === 0 without retry (got ${err && err.retries})`);
        server.close(resolve);
      });
    });
  });

  // 2D: Node response size error without retry
  await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('hello world from server too big');
    });
    server.listen(0, () => {
      const port = server.address().port;
      const req = nodeRequest.get(`http://localhost:${port}`)
        .maxResponseSize(5);

      req.end((err) => {
        assert(err && err.code === 'ETOOLARGE', 'Node response size error ETOOLARGE');
        assert(err && err.retries === 0, `Node response err.retries === 0 without retry (got ${err && err.retries})`);
        server.close(resolve);
      });
    });
  });

  console.log('\n=== Test 3: Compressed browser response decoded-size check ===');
  // Compressed response: Content-Encoding: gzip, small wire size, large decompressed text
  await new Promise((resolve) => {
    class MockGzipXHR extends EventEmitter {
      constructor() {
        super();
        this.readyState = 0;
        this.status = 200;
        this.responseHeaders = {
          'content-type': 'text/plain',
          'content-encoding': 'gzip',
          'content-length': '25' // wire length is small (25 bytes < limit 50)
        };
      }
      open() { this.readyState = 1; }
      setRequestHeader() {}
      getAllResponseHeaders() {
        return Object.entries(this.responseHeaders).map(([k, v]) => `${k}: ${v}`).join('\r\n');
      }
      getResponseHeader(h) {
        return this.responseHeaders[h.toLowerCase()] || null;
      }
      send() {
        setTimeout(() => {
          // In browser, XHR automatically decodes gzip, so responseText has decompressed 200 bytes!
          this.readyState = 4;
          this.status = 200;
          this.responseText = 'x'.repeat(200); // 200 bytes > limit 50
          this.emit('readystatechange');
          this.emit('load');
        }, 10);
      }
      abort() { this.emit('abort'); }
      addEventListener(e, cb) { this.on(e, cb); }
      removeEventListener(e, cb) { this.off(e, cb); }
    }
    clientRequest.getXHR = () => new MockGzipXHR();

    const req = clientRequest('GET', 'http://example.com/gzip-test')
      .maxResponseSize(50);

    req.end((err) => {
      assert(err && err.code === 'ETOOLARGE', 'Compressed browser response must fail with ETOOLARGE when decoded size > limit');
      assert(req.hasSizeError() === true, 'req.hasSizeError() must be true');
      resolve();
    });
  });

  console.log('\n=== Test 4: Compressed browser response streaming evasion ===');
  // What if readyState 3 receives chunks?
  await new Promise((resolve) => {
    class MockStreamingGzipXHR extends EventEmitter {
      constructor() {
        super();
        this.readyState = 0;
        this.status = 200;
        this.responseHeaders = {
          'content-type': 'text/plain',
          'content-encoding': 'gzip'
        };
      }
      open() { this.readyState = 1; }
      setRequestHeader() {}
      getAllResponseHeaders() {
        return Object.entries(this.responseHeaders).map(([k, v]) => `${k}: ${v}`).join('\r\n');
      }
      getResponseHeader(h) {
        return this.responseHeaders[h.toLowerCase()] || null;
      }
      send() {
        setTimeout(() => {
          this.readyState = 3;
          this.responseText = 'y'.repeat(100);
          this.emit('readystatechange');
          setTimeout(() => {
            this.readyState = 4;
            this.responseText = 'y'.repeat(200);
            this.emit('readystatechange');
            this.emit('load');
          }, 10);
        }, 10);
      }
      abort() { this.emit('abort'); }
      addEventListener(e, cb) { this.on(e, cb); }
      removeEventListener(e, cb) { this.off(e, cb); }
    }
    clientRequest.getXHR = () => new MockStreamingGzipXHR();

    const req = clientRequest('GET', 'http://example.com/stream-gzip')
      .maxResponseSize(50);

    req.end((err) => {
      assert(err && err.code === 'ETOOLARGE', 'Streaming compressed response must fail at terminal state');
      resolve();
    });
  });

  console.log('\n=== SUMMARY ===');
  if (allPassed) {
    console.log('ALL TESTS PASSED! Every reviewer concern is verified fixed!');
  } else {
    console.error('SOME TESTS FAILED! Needs investigation.');
  }
}

runTests();

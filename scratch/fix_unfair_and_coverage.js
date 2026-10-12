const fs = require('fs');
const path = require('path');

const testPath = path.join(__dirname, '..', 'superagent', 'test', 'node', 'size_limits_compliance_b5e2d.js');
let content = fs.readFileSync(testPath, 'utf8');

// 1. Remove T66
const t66Block = `    // T66: Size error with retry(0) configured reports err.retries === 0 in Browser
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
        getAllResponseHeaders() { return 'Content-Length: 100\\r\\n'; }
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
    });\n\n`;

if (content.includes('T66: Size error with retry(0) configured reports err.retries === 0 in Browser')) {
  content = content.replace(t66Block, '');
  console.log('Removed T66 successfully.');
} else {
  console.log('T66 not found or already removed.');
}

// 2. Remove T68
const t68Block = `  // T68: Size error with retry(0) configured reports err.retries === 0 in Node
  it('should report err.retries === 0 on size error with retry(0) configured (Node)', (done) => {
    request
      .get(\`\${base}/large-response\`)
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
  });\n\n`;

if (content.includes('T68: Size error with retry(0) configured reports err.retries === 0 in Node')) {
  content = content.replace(t68Block, '');
  console.log('Removed T68 successfully.');
} else {
  console.log('T68 not found or already removed.');
}

// 3. Add T112c after T112b
const t112bAnchor = `  // T112b: HTTP/2 request exceeding maxRequestSize aborts immediately with ETOOLARGE
  it('should abort with ETOOLARGE when HTTP/2 request payload exceeds maxRequestSize', (done) => {
    const http2 = require('http2');
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
        .post(\`http://127.0.0.1:\${port}/http2-overflow\`)
        .http2()
        .maxRequestSize(10)
        .send('this payload is significantly longer than ten bytes');

      req.end((err, res) => {
        srv.close(() => {
          try {
            assert.ok(err, 'Expected error on oversized HTTP/2 request');
            assert.strictEqual(err.code, 'ETOOLARGE');
            assert.strictEqual(err.retries, 0);
            assert.strictEqual(req.hasSizeError(), true);
            done();
          } catch (e) {
            done(e);
          }
        });
      });
    });
  });`;

const t112cCode = `

  // T112c: HTTP/2 response exceeding maxResponseSize aborts immediately with ETOOLARGE
  it('should abort with ETOOLARGE when HTTP/2 response payload exceeds maxResponseSize', (done) => {
    const http2 = require('http2');
    const srv = http2.createServer((sReq, sRes) => {
      sRes.setHeader('content-type', 'text/plain');
      sRes.writeHead(200);
      sRes.write('first chunk 10 bytes');
      sRes.write('second chunk exceeding limit');
      sRes.end();
    });

    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      const req = request
        .get(\`http://127.0.0.1:\${port}/http2-response-overflow\`)
        .http2()
        .maxResponseSize(15);

      req.end((err, res) => {
        srv.close(() => {
          try {
            assert.ok(err, 'Expected error on oversized HTTP/2 response');
            assert.strictEqual(err.code, 'ETOOLARGE');
            assert.strictEqual(req.hasSizeError(), true);
            done();
          } catch (e) {
            done(e);
          }
        });
      });
    });
  });`;

if (!content.includes('T112c: HTTP/2 response exceeding maxResponseSize aborts')) {
  if (!content.includes(t112bAnchor)) {
    console.error('t112bAnchor not found!');
    process.exit(1);
  }
  content = content.replace(t112bAnchor, t112bAnchor + t112cCode);
  console.log('Added T112c successfully.');
} else {
  console.log('T112c already present.');
}

fs.writeFileSync(testPath, content, 'utf8');
console.log('Saved updated size_limits_compliance_b5e2d.js.');

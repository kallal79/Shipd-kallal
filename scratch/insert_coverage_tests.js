const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'superagent', 'test', 'node', 'size_limits_compliance_b5e2d.js');
let content = fs.readFileSync(filePath, 'utf8');

// Insert 1: After T74
const t74Anchor = "      req.end((err) => {\n        try {\n          assert.ok(err, 'Expected ETOOLARGE when decoded UTF-16 with BOM exceeds limit');\n          assert.strictEqual(err.code, 'ETOOLARGE');\n          assert.strictEqual(req.hasSizeError(), true);\n          done();\n        } catch (e) {\n          done(e);\n        }\n      });\n    });";

const t74bCode = `

    // T74b: Browser compressed UTF-16LE response with BOM semantics
    it('should account for BOM in browser compressed UTF-16LE response decoded byte size', (done) => {
      const EventEmitter = require('events');
      class MockXHR extends EventEmitter {
        constructor() {
          super();
          this.readyState = 0;
          this.status = 200;
          // BOM U+FEFF followed by 50 ASCII chars in UTF-16LE => 51 code units * 2 = 102 bytes
          this.responseText = '\\uFEFF' + 'x'.repeat(50);
        }
        open() { this.readyState = 1; }
        setRequestHeader() {}
        getAllResponseHeaders() {
          return 'Content-Type: text/plain; charset=utf-16le\\r\\nContent-Encoding: gzip\\r\\nContent-Length: 30\\r\\n';
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

      const req = clientRequest('GET', 'http://example.com/compressed-utf16le-bom')
        .maxResponseSize(101);

      req.end((err) => {
        try {
          assert.ok(err, 'Expected ETOOLARGE when decoded UTF-16LE with BOM exceeds limit');
          assert.strictEqual(err.code, 'ETOOLARGE');
          assert.strictEqual(req.hasSizeError(), true);
          done();
        } catch (e) {
          done(e);
        }
      });
    });`;

if (!content.includes('T74b: Browser compressed UTF-16LE response with BOM')) {
  if (!content.includes(t74Anchor)) {
    console.error('Could not find T74 anchor!');
    process.exit(1);
  }
  content = content.replace(t74Anchor, t74Anchor + t74bCode);
  console.log('Inserted T74b successfully.');
} else {
  console.log('T74b already present.');
}

// Insert 2: After T101
const t101Anchor = "            targetServer.close();\n            redirectServer.close();\n            try {\n              assert.ifError(err);\n              assert.strictEqual(req.hasSizeError(), false);\n              assert.strictEqual(res.status, 200);\n              assert.strictEqual(targetMethod, 'POST');\n              assert.strictEqual(targetReceivedBody, payload);\n              done();\n            } catch (e) {\n              done(e);\n            }\n          });\n      });\n    });\n  });";

const t101bCode = `

  // T101b: 305 redirect preserves and replays multipart payload
  it('should replay multipart payload on 305 redirect when maxRequestSize is configured', (done) => {
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
        .post(\`http://127.0.0.1:\${p}/init-305-mp\`)
        .field('action', 'test305')
        .field('data', 'multipart-payload-val')
        .maxRequestSize(2000)
        .end((err, res) => {
          srv.close(() => {
            try {
              assert.ifError(err);
              assert.strictEqual(res.status, 200);
              assert.strictEqual(res.text, 'target-ok');
              assert(targetBody.includes('test305'), '305 target received field "action"');
              assert(targetBody.includes('multipart-payload-val'), '305 target received field "data"');
              done();
            } catch (e) {
              done(e);
            }
          });
        });
    });
  });`;

if (!content.includes('T101b: 305 redirect preserves and replays multipart payload')) {
  if (!content.includes(t101Anchor)) {
    console.error('Could not find T101 anchor!');
    process.exit(1);
  }
  content = content.replace(t101Anchor, t101Anchor + t101bCode);
  console.log('Inserted T101b successfully.');
} else {
  console.log('T101b already present.');
}

// Insert 3: After T112
const t112Anchor = "            assert.strictEqual(res.text, 'echo: hello http2');\n            srv.close(done);\n          } catch (e) {\n            srv.close();\n            done(e);\n          }\n        });\n    });\n  });";

const t112bCode = `

  // T112b: HTTP/2 request exceeding maxRequestSize aborts immediately with ETOOLARGE
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

if (!content.includes('T112b: HTTP/2 request exceeding maxRequestSize aborts')) {
  if (!content.includes(t112Anchor)) {
    console.error('Could not find T112 anchor!');
    process.exit(1);
  }
  content = content.replace(t112Anchor, t112Anchor + t112bCode);
  console.log('Inserted T112b successfully.');
} else {
  console.log('T112b already present.');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated compliance test file.');

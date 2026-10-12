const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'superagent', 'test', 'node', 'size_limits_compliance_b5e2d.js');
let content = fs.readFileSync(filePath, 'utf8');

const anchor = `  // T127: Callback-only overflow: delivers ETOOLARGE to end callback for unbuffered chunked response without error listener
  it('should deliver ETOOLARGE to end callback for unbuffered chunked response exceeding maxResponseSize without error listener', (done) => {
    const srv = http.createServer((sReq, sRes) => {
      sRes.writeHead(200, { 'Content-Type': 'text/plain' });
      sRes.write('12345');
      setTimeout(() => {
        sRes.write('6789012345'); // Total 15 bytes > 10
        sRes.end();
      }, 20);
    });

    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      request
        .get(\`http://127.0.0.1:\${p}\`)
        .buffer(false)
        .maxResponseSize(10)
        .end((err, res) => {
          srv.close(() => {
            try {
              assert.ok(err, 'Expected error in callback');
              assert.strictEqual(err.code, 'ETOOLARGE');
              assert.strictEqual(res, null);
              done();
            } catch (e) {
              done(e);
            }
          });
        });
    });
  });`;

const newTest = `

  // T127b: Unbuffered response size abort emits error event on Response wrapper exactly once
  it('should emit error event on Response wrapper exactly once when unbuffered response exceeds maxResponseSize', (done) => {
    const srv = http.createServer((sReq, sRes) => {
      sRes.writeHead(200, { 'Content-Type': 'text/plain' });
      sRes.write('ab');
      sRes.end();
    });

    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      let errorEventsCount = 0;

      const req = request
        .get(\`http://127.0.0.1:\${p}\`)
        .buffer(false)
        .maxResponseSize(1);

      req.on('response', (res) => {
        res.on('error', (err) => {
          errorEventsCount++;
          assert.strictEqual(err.code, 'ETOOLARGE');
        });
      });

      req.end((err) => {
        srv.close(() => {
          setTimeout(() => {
            try {
              assert.ok(err);
              assert.strictEqual(err.code, 'ETOOLARGE');
              assert.strictEqual(errorEventsCount, 1, 'Response wrapper must emit error exactly once');
              done();
            } catch (e) {
              done(e);
            }
          }, 30);
        });
      });
    });
  });`;

if (!content.includes('T127b: Unbuffered response size abort emits error event on Response wrapper exactly once')) {
  if (!content.includes(anchor)) {
    console.error('Anchor not found!');
    process.exit(1);
  }
  content = content.replace(anchor, anchor + newTest);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Inserted T127b successfully.');
} else {
  console.log('T127b already present.');
}

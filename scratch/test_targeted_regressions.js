const http = require('http');
const assert = require('assert');
const request = require('../superagent');

describe('Targeted Unbuffered Regressions', () => {
  // Case 1: Callback-only unbuffered response-size overflow
  it('callback-only overflow: invokes callback with ETOOLARGE for chunked unbuffered overflow', (done) => {
    const srv = http.createServer((sReq, sRes) => {
      sRes.writeHead(200, { 'Content-Type': 'text/plain' });
      sRes.write('12345');
      setTimeout(() => {
        sRes.write('6789012345'); // Total 15 bytes > 10 bytes
        sRes.end();
      }, 20);
    });

    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      request
        .get(`http://127.0.0.1:${p}`)
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
  });

  // Case 2: Pre-registered response end listener with retry and a size limit
  it('pre-registered end listener: emits end event exactly once', (done) => {
    const srv = http.createServer((sReq, sRes) => {
      sRes.writeHead(200, { 'Content-Type': 'text/plain' });
      sRes.write('chunkA');
      sRes.end('chunkB');
    });

    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      let endCount = 0;

      const req = request
        .get(`http://127.0.0.1:${p}`)
        .buffer(false)
        .maxResponseSize(100)
        .retry(1)
        .on('response', (res) => {
          res.on('data', () => {});
          res.on('end', () => {
            endCount++;
          });
        });

      req.end((err, res) => {
        try {
          assert.ifError(err);
          assert.ok(res);
          setTimeout(() => {
            srv.close(() => {
              try {
                assert.strictEqual(endCount, 1, 'end event must be emitted exactly once');
                done();
              } catch (e) {
                done(e);
              }
            });
          }, 50);
        } catch (e) {
          srv.close(() => done(e));
        }
      });
    });
  });

  // Case 3: maxRequestSize-only retry receiving response stream (no memory queue)
  it('maxRequestSize-only retry: settles immediately at headers and does not queue chunks in memory', (done) => {
    const srv = http.createServer((sReq, sRes) => {
      sRes.writeHead(200, { 'Content-Type': 'text/plain' });
      sRes.write('stream_chunk_1_');
      sRes.write('stream_chunk_2_');
      sRes.end('stream_chunk_3');
    });

    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      let received = '';

      const req = request
        .get(`http://127.0.0.1:${p}`)
        .buffer(false)
        .maxRequestSize(100)
        .retry(1);

      req.end((err, res) => {
        try {
          assert.ifError(err);
          assert.strictEqual(res.status, 200);
          assert.ok(!req._pendingUnbufferedResponse, 'Must not defer settlement into _pendingUnbufferedResponse');

          res.on('data', (chunk) => {
            received += chunk.toString();
          });

          res.on('end', () => {
            srv.close(() => {
              try {
                assert.strictEqual(received, 'stream_chunk_1_stream_chunk_2_stream_chunk_3');
                done();
              } catch (e) {
                done(e);
              }
            });
          });
        } catch (e) {
          srv.close(() => done(e));
        }
      });
    });
  });
});

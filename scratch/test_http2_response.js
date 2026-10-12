const http2 = require('http2');
const request = require('../superagent');
const assert = require('assert');

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
    .get(`http://127.0.0.1:${port}/http2-response-overflow`)
    .http2()
    .maxResponseSize(15);

  req.end((err, res) => {
    srv.close(() => {
      try {
        console.log('HTTP/2 response err:', err ? err.message : null, 'code:', err ? err.code : null);
        assert.ok(err, 'Expected error on oversized HTTP/2 response');
        assert.strictEqual(err.code, 'ETOOLARGE');
        assert.strictEqual(req.hasSizeError(), true);
        console.log('√ HTTP/2 response overflow PASSED');
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    });
  });
});

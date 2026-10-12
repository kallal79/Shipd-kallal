const http2 = require('http2');
const request = require('../superagent');
const assert = require('assert');

async function testHttp2SizeLimits() {
  console.log('Testing comprehensive HTTP/2 size limits...');
  
  const srv = http2.createServer((sReq, sRes) => {
    let body = '';
    sReq.on('data', (c) => { body += c; });
    sReq.on('end', () => {
      sRes.setHeader('content-type', 'text/plain');
      sRes.writeHead(200);
      sRes.end('response-' + body);
    });
  });

  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const base = `http://127.0.0.1:${port}`;

  // Case 1: In-limit request & response (buffered)
  await new Promise((resolve, reject) => {
    request
      .post(`${base}/in-limit`)
      .http2()
      .maxRequestSize(1024)
      .maxResponseSize(1024)
      .send('hello')
      .end((err, res) => {
        try {
          assert.ifError(err);
          assert.strictEqual(res.text, 'response-hello');
          console.log('  ✅ Case 1 (in-limit): PASS');
          resolve();
        } catch (e) { reject(e); }
      });
  });

  // Case 2: Exceed maxRequestSize
  await new Promise((resolve, reject) => {
    request
      .post(`${base}/req-oversize`)
      .http2()
      .maxRequestSize(4)
      .send('toolargepayload')
      .end((err, res) => {
        try {
          assert(err, 'Expected ETOOLARGE error');
          assert.strictEqual(err.code, 'ETOOLARGE');
          assert.strictEqual(err.retries, 0);
          console.log('  ✅ Case 2 (exceed maxRequestSize): PASS');
          resolve();
        } catch (e) { reject(e); }
      });
  });

  // Case 3: Exceed maxResponseSize
  await new Promise((resolve, reject) => {
    request
      .post(`${base}/res-oversize`)
      .http2()
      .maxResponseSize(5)
      .send('abcdefghij')
      .end((err, res) => {
        try {
          assert(err, 'Expected ETOOLARGE error on response');
          assert.strictEqual(err.code, 'ETOOLARGE');
          assert.strictEqual(err.retries, 0);
          console.log('  ✅ Case 3 (exceed maxResponseSize): PASS');
          resolve();
        } catch (e) { reject(e); }
      });
  });

  srv.close();
  console.log('All HTTP/2 size limit tests passed cleanly!');
}

testHttp2SizeLimits().catch(e => {
  console.error('FAILED:', e);
  process.exit(1);
});

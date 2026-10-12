const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const superagent = require('../superagent');

function countSpoolFiles() {
  return fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('sa-replay-')).length;
}

let port;
const server = http.createServer((req, res) => {
  let body = [];
  req.on('data', chunk => body.push(chunk));
  req.on('end', () => {
    const fullBody = Buffer.concat(body).toString();
    const url = req.url;

    if (url === '/echo') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok: ' + fullBody.length);
    } else if (url === '/head') {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '10' });
      res.end();
    } else if (url === '/redirect-301') {
      res.writeHead(301, { Location: '/target' });
      res.end();
    } else if (url === '/redirect-302') {
      res.writeHead(302, { Location: '/target' });
      res.end();
    } else if (url === '/redirect-303') {
      res.writeHead(303, { Location: '/target' });
      res.end();
    } else if (url === '/redirect-cross-origin') {
      res.writeHead(302, { Location: 'http://localhost:' + port + '/target' });
      res.end();
    } else if (url === '/target') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ method: req.method, bodyLength: fullBody.length }));
    } else if (url.startsWith('/retry-fail-then-ok')) {
      const id = url.split('?')[1] || 'default';
      server._retryCounts = server._retryCounts || {};
      server._retryCounts[id] = (server._retryCounts[id] || 0) + 1;
      if (server._retryCounts[id] < 3) {
        res.writeHead(500);
        res.end('fail attempt ' + server._retryCounts[id]);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, attempt: server._retryCounts[id] }));
      }
    } else if (url.startsWith('/always-fail')) {
      res.writeHead(500);
      res.end('permanent failure');
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('default');
    }
  });
});

async function runTests() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    port = server.address().port;
    resolve();
  }));

  console.log('Test server running on port', port);
  const base = 'http://127.0.0.1:' + port;

  // 1. Unbuffered + maxRequestSize only (GET)
  await new Promise((resolve, reject) => {
    superagent.get(base + '/echo')
      .buffer(false)
      .maxRequestSize(100)
      .end((err, res) => {
        if (err) return reject(err);
        assert.strictEqual(res.status, 200);
        resolve();
      });
  });
  console.log('PASS 1: Unbuffered GET with maxRequestSize only settles');

  // 2. Unbuffered + maxRequestSize only (HEAD)
  await new Promise((resolve, reject) => {
    superagent.head(base + '/head')
      .buffer(false)
      .maxRequestSize(100)
      .end((err, res) => {
        if (err) return reject(err);
        assert.strictEqual(res.status, 200);
        resolve();
      });
  });
  console.log('PASS 2: Unbuffered HEAD with maxRequestSize only settles');

  // 3. Unbuffered + maxRequestSize only (POST string)
  await new Promise((resolve, reject) => {
    superagent.post(base + '/echo')
      .buffer(false)
      .maxRequestSize(100)
      .send('hello world')
      .end((err, res) => {
        if (err) return reject(err);
        assert.strictEqual(res.status, 200);
        resolve();
      });
  });
  console.log('PASS 3: Unbuffered POST string with maxRequestSize only settles');

  // 4. Unbuffered + maxRequestSize only (POST Buffer)
  await new Promise((resolve, reject) => {
    superagent.post(base + '/echo')
      .buffer(false)
      .maxRequestSize(100)
      .send(Buffer.from('hello buffer'))
      .end((err, res) => {
        if (err) return reject(err);
        assert.strictEqual(res.status, 200);
        resolve();
      });
  });
  console.log('PASS 4: Unbuffered POST Buffer with maxRequestSize only settles');

  // 5. Unbuffered + maxRequestSize only (POST JSON object)
  await new Promise((resolve, reject) => {
    superagent.post(base + '/echo')
      .buffer(false)
      .maxRequestSize(100)
      .send({ hello: 'json' })
      .end((err, res) => {
        if (err) return reject(err);
        assert.strictEqual(res.status, 200);
        resolve();
      });
  });
  console.log('PASS 5: Unbuffered POST JSON object with maxRequestSize only settles');

  // 6. Unbuffered + maxRequestSize only (POST FormData)
  await new Promise((resolve, reject) => {
    superagent.post(base + '/echo')
      .buffer(false)
      .maxRequestSize(500)
      .field('name', 'superagent')
      .end((err, res) => {
        if (err) return reject(err);
        assert.strictEqual(res.status, 200);
        resolve();
      });
  });
  console.log('PASS 6: Unbuffered POST FormData with maxRequestSize only settles');

  // 7. Redirect 301 POST -> GET: no body sent, spool cleaned up
  const before301 = countSpoolFiles();
  await new Promise((resolve, reject) => {
    superagent.post(base + '/redirect-301')
      .field('secret', 'leak_me_not')
      .maxResponseSize(1000)
      .retry(1)
      .end((err, res) => {
        if (err) return reject(err);
        assert.strictEqual(res.body.method, 'GET');
        assert.strictEqual(res.body.bodyLength, 0);
        resolve();
      });
  });
  assert.strictEqual(countSpoolFiles(), before301);
  console.log('PASS 7: 301 redirect converts POST to GET, 0 body sent, 0 spool files left');

  // 8. Redirect 302 POST -> GET: no body sent, spool cleaned up
  const before302 = countSpoolFiles();
  await new Promise((resolve, reject) => {
    superagent.post(base + '/redirect-302')
      .field('secret', 'leak_me_not')
      .maxResponseSize(1000)
      .retry(1)
      .end((err, res) => {
        if (err) return reject(err);
        assert.strictEqual(res.body.method, 'GET');
        assert.strictEqual(res.body.bodyLength, 0);
        resolve();
      });
  });
  assert.strictEqual(countSpoolFiles(), before302);
  console.log('PASS 8: 302 redirect converts POST to GET, 0 body sent, 0 spool files left');

  // 9. Redirect 303 POST -> GET: no body sent, spool cleaned up
  const before303 = countSpoolFiles();
  await new Promise((resolve, reject) => {
    superagent.post(base + '/redirect-303')
      .field('secret', 'leak_me_not')
      .maxResponseSize(1000)
      .retry(1)
      .end((err, res) => {
        if (err) return reject(err);
        assert.strictEqual(res.body.method, 'GET');
        assert.strictEqual(res.body.bodyLength, 0);
        resolve();
      });
  });
  assert.strictEqual(countSpoolFiles(), before303);
  console.log('PASS 9: 303 redirect converts POST to GET, 0 body sent, 0 spool files left');

  // 10. Cross-origin redirect: no body sent, spool cleaned up
  const beforeCross = countSpoolFiles();
  await new Promise((resolve, reject) => {
    superagent.post(base + '/redirect-cross-origin')
      .field('secret', 'cross_leak_not')
      .maxResponseSize(1000)
      .retry(1)
      .end((err, res) => {
        if (err) return reject(err);
        assert.strictEqual(res.body.method, 'GET');
        assert.strictEqual(res.body.bodyLength, 0);
        resolve();
      });
  });
  assert.strictEqual(countSpoolFiles(), beforeCross);
  console.log('PASS 10: Cross-origin redirect sends 0 body, 0 spool files left');

  // 11. Replay multi-retry success: 2 retries (3 attempts), successful replay, spool cleaned up
  const beforeMulti = countSpoolFiles();
  await new Promise((resolve, reject) => {
    superagent.post(base + '/retry-fail-then-ok?multi')
      .field('field1', 'val1')
      .field('field2', 'val2')
      .maxResponseSize(2000)
      .retry(3)
      .end((err, res) => {
        if (err) return reject(err);
        assert.strictEqual(res.body.ok, true);
        assert.strictEqual(res.body.attempt, 3);
        resolve();
      });
  });
  assert.strictEqual(countSpoolFiles(), beforeMulti);
  console.log('PASS 11: Multi-retry replay succeeds and leaves 0 spool files');

  // 12. Replay all retries exhausted (failure): spool cleaned up
  const beforeExhaust = countSpoolFiles();
  await new Promise((resolve, reject) => {
    superagent.post(base + '/always-fail')
      .field('field1', 'val1')
      .maxResponseSize(2000)
      .retry(2)
      .end((err, res) => {
        assert(err);
        resolve();
      });
  });
  assert.strictEqual(countSpoolFiles(), beforeExhaust);
  console.log('PASS 12: Exhausted retries error leaves 0 spool files');

  // 13. Piped request spool cleanup
  const beforePipe = countSpoolFiles();
  await new Promise((resolve, reject) => {
    const s = new (require('stream').PassThrough)();
    superagent.post(base + '/echo')
      .field('pipeField', 'pipeValue')
      .maxResponseSize(2000)
      .pipe(s);

    s.on('data', () => {});
    s.on('end', () => {
      setTimeout(resolve, 50);
    });
  });
  assert.strictEqual(countSpoolFiles(), beforePipe);
  console.log('PASS 13: Piped request leaves 0 spool files');

  server.close();
  console.log('\n========================================');
  console.log('ALL 13 VERIFICATION STRESS TESTS PASSED!');
  console.log('========================================\n');
}

runTests().catch(err => {
  console.error('FATAL TEST FAILURE:', err);
  if (server) server.close();
  process.exit(1);
});

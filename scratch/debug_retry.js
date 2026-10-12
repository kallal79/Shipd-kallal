const assert = require('assert');
const http = require('http');
const request = require('../superagent');

let attempts = 0;
const server = http.createServer((req, res) => {
  attempts++;
  console.log('Server received request attempt', attempts);
  if (attempts === 1) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.flushHeaders();
    setTimeout(() => {
      console.log('Server destroying socket on attempt 1');
      req.socket.destroy(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    }, 20);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('all good');
  }
});

server.listen(0, () => {
  const port = server.address().port;
  console.log('Server listening on port', port);
  const r = request
    .get(`http://localhost:${port}/unbuffered-retry`)
    .buffer(false)
    .maxResponseSize(1000)
    .retry(1);

  let cbCount = 0;
  r.end((err, res) => {
    cbCount++;
    console.log('r.end callback called! count =', cbCount, 'err =', err ? err.message : null, 'status =', res ? res.status : null);
    if (cbCount === 1) {
      setTimeout(() => {
        server.close();
        console.log('Finished successfully!');
      }, 100);
    }
  });
});

const http = require('http');
const request = require('../superagent');
const assert = require('assert');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.write('This payload is definitely longer than 2 bytes');
  res.end();
});

server.listen(0, () => {
  const port = server.address().port;
  const url = `http://localhost:${port}/`;
  
  let reqErr = null;
  let resErr = null;
  let cbErr = null;

  const req = request
    .get(url)
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
    cbErr = err;
    setTimeout(() => {
      try {
        console.log('cbErr:', cbErr ? cbErr.code : null);
        console.log('reqErr:', reqErr ? reqErr.code : null);
        console.log('resErr:', resErr ? resErr.code : null);
        assert.ok(cbErr, 'Expected error in callback');
        assert.equal(cbErr.code, 'ETOOLARGE');
        assert.ok(reqErr, 'Expected error in request error listener');
        assert.equal(reqErr.code, 'ETOOLARGE');
        assert.ok(resErr, 'Expected error in response error listener');
        assert.equal(resErr.code, 'ETOOLARGE');
        console.log('ALL OVERFLOW ASSERTIONS PASSED!');
        server.close();
      } catch (e) {
        console.error('FAILED:', e);
        server.close();
        process.exit(1);
      }
    }, 100);
  });
});

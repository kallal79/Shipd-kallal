const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const superagent = require('../superagent');

let redirectReceivedBody = '';
let redirectMethod = '';

const server = http.createServer((req, res) => {
  if (req.url === '/initial') {
    // 302 Found redirecting to /target
    res.writeHead(302, { Location: '/target' });
    res.end();
  } else if (req.url === '/target') {
    redirectMethod = req.method;
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      redirectReceivedBody = Buffer.concat(body).toString();
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
  }
});

server.listen(0, () => {
  const port = server.address().port;
  superagent
    .post('http://127.0.0.1:' + port + '/initial')
    .field('secret_field', 'secret_value')
    .maxResponseSize(1000)
    .retry(1)
    .end((err, res) => {
      console.log('Redirect target received method:', redirectMethod);
      console.log('Redirect target received body length:', redirectReceivedBody.length);
      console.log('Redirect target received body:', redirectReceivedBody);
      server.close();
    });
});

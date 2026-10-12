const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const superagent = require('../superagent');

let attempts = 0;
const server = http.createServer((req, res) => {
  attempts++;
  if (attempts === 1) {
    res.writeHead(500);
    res.end('fail');
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  }
});

server.listen(0, () => {
  const port = server.address().port;
  const beforeFiles = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('sa-replay-'));
  console.log('Before tmp files:', beforeFiles.length);

  superagent
    .post('http://127.0.0.1:' + port)
    .field('test', 'value')
    .maxResponseSize(1000)
    .retry(1)
    .end((err, res) => {
      console.log('Finished with status:', res && res.status);
      setTimeout(() => {
        const afterFiles = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('sa-replay-'));
        console.log('After tmp files:', afterFiles.length);
        server.close();
      }, 500);
    });
});

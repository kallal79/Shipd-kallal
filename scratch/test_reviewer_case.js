const http = require('http');
const request = require('../superagent');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.write('hello world');
  res.end();
});

server.listen(0, () => {
  const port = server.address().port;
  const url = `http://localhost:${port}/`;
  
  const timer = setTimeout(() => {
    console.error('TIMEOUT! res.once("end") was never called!');
    server.close();
    process.exit(1);
  }, 2000);

  request
    .get(url)
    .buffer(false)
    .maxResponseSize(100)
    .on('response', (res) => {
      res.once('end', () => {
        clearTimeout(timer);
        console.log('SUCCESS: res.once("end") called!');
        server.close();
      });
    })
    .end((err, res) => {
      console.log('end callback called, err:', err ? err.message : null);
    });
});

const request = require('./lib/node/index.js');
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('OK');
});

server.listen(0, () => {
  const base = `http://localhost:${server.address().port}`;
  
  let callbackCount = 0;
  const request_ = request.post(`${base}/echo`).maxRequestSize(15);
  
  request_.end((err, res) => {
    callbackCount++;
    console.log('callback called with err:', err ? err.code : null, 'callbackCount:', callbackCount);
    console.log('hasSizeError:', request_.hasSizeError());
    if (callbackCount === 1) {
      setTimeout(() => {
        server.close();
        console.log('Final callbackCount:', callbackCount);
      }, 100);
    }
  });

  request_.write('0123456789'); // 10 bytes
  request_.write('0123456789'); // 10 bytes -> total 20 > 15
});

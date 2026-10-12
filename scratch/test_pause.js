const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.write('hello ');
  setTimeout(() => {
    res.write('world');
    res.end();
  }, 50);
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  http.get(`http://127.0.0.1:${port}`, (res) => {
    console.log('Got headers, pausing res...');
    res.pause();

    setTimeout(() => {
      console.log('Now attaching data and end listeners...');
      let body = '';
      res.on('data', (chunk) => {
        console.log('Got chunk:', chunk.toString());
        body += chunk;
      });
      res.on('end', () => {
        console.log('Got end! Full body:', body);
        server.close();
      });
    }, 100);
  });
});

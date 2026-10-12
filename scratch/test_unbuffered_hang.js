const http = require('http');
const superagent = require('../superagent');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('response text');
});

server.listen(0, () => {
  const port = server.address().port;
  console.log('Server listening on port', port);

  let callbackCalled = false;
  const req = superagent
    .post('http://127.0.0.1:' + port)
    .buffer(false)
    .maxRequestSize(100)
    .send('ok')
    .end((err, res) => {
      callbackCalled = true;
      console.log('CALLBACK CALLED SUCCESSFULLY! Status:', res && res.status);
      server.close();
    });

  setTimeout(() => {
    if (!callbackCalled) {
      console.error('FAIL: Callback was NEVER called! Request hung!');
      server.close();
      process.exit(1);
    } else {
      console.log('PASS: Callback called promptly!');
      process.exit(0);
    }
  }, 2000);
});

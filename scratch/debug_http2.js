const http2 = require('http2');
const request = require('../superagent');

const server = http2.createServer((req, res) => {
  console.log('[Server] Request received');
  let body = '';
  req.on('data', chunk => { 
    body += chunk; 
    console.log('[Server] Received chunk:', chunk.toString());
  });
  req.on('end', () => {
    console.log('[Server] Request end. Sending response...');
    res.setHeader('content-type', 'text/plain');
    res.writeHead(200);
    res.end('echo: ' + body);
    console.log('[Server] Response ended.');
  });
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  console.log('HTTP2 server listening on port', port);
  const req = request
    .post('http://127.0.0.1:' + port + '/test')
    .http2()
    .maxRequestSize(1024)
    .send('ok');

  console.log('req._enableHttp2:', req._enableHttp2);

  req.on('request', r => {
    console.log('[Client] request event. this.req:', r.req ? r.req.constructor.name : null);
    if (r.req) {
      r.req.on('finish', () => console.log('[Client] r.req finish event!'));
      r.req.on('response', (res) => {
        console.log('[Client] r.req response event! status:', res.statusCode);
        res.on('data', c => console.log('[Client] res data:', c.toString()));
        res.on('end', () => console.log('[Client] res end!'));
      });
      if (typeof r.req.getFrame === 'function') {
        console.log('[Client] r.req has getFrame()');
      }
    }
  });

  req.end((err, res) => {
    console.log('CALLBACK REACHED! err:', err, 'res.text:', res && res.text);
    server.close();
    process.exit(0);
  });
});

setTimeout(() => {
  console.log('DEBUG TIMEOUT');
  server.close();
  process.exit(1);
}, 2000);

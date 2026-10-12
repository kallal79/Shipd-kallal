const http = require('http');
const request = require('../superagent');
const assert = require('assert');

const srv = http.createServer((sReq, sRes) => {
  sRes.writeHead(200, { 'Content-Type': 'text/plain' });
  sRes.write('ab');
  sRes.end();
});

srv.listen(0, '127.0.0.1', () => {
  const p = srv.address().port;
  let errorEventsCount = 0;

  const req = request
    .get(`http://127.0.0.1:${p}`)
    .buffer(false)
    .maxResponseSize(1);

  req.on('response', (res) => {
    res.on('error', (err) => {
      errorEventsCount++;
      console.log(`res.on('error') called, count = ${errorEventsCount}, err.code = ${err.code}`);
    });
  });

  req.end((err, res) => {
    srv.close(() => {
      console.log(`Callback finished. err: ${err ? err.code : null}`);
      console.log(`Total errorEventsCount on Response: ${errorEventsCount}`);
    });
  });
});

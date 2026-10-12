const http = require('http');

function test(destroyWithErr, manualEmit) {
  return new Promise((resolve) => {
    const EventEmitter = require('events');
    const { IncomingMessage } = http;

    // Simulate res
    const srv = http.createServer((sReq, sRes) => {
      sRes.writeHead(200);
      sRes.write('ab');
      sRes.end();
    });

    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      const clientReq = http.get(`http://127.0.0.1:${p}`, (res) => {
        // simulate Response wrapper
        const wrapper = new EventEmitter();
        res.on('error', wrapper.emit.bind(wrapper, 'error'));

        let errorCount = 0;
        wrapper.on('error', (e) => {
          errorCount++;
          console.log(`Wrapper error count: ${errorCount}, error: ${e.code}`);
        });

        // Trigger abort
        const error = new Error('Maximum response size reached');
        error.code = 'ETOOLARGE';

        if (manualEmit) {
          wrapper.emit('error', error);
        }
        if (destroyWithErr) {
          res.destroy(error);
        } else {
          res.destroy();
        }

        setTimeout(() => {
          srv.close();
          console.log(`Done test destroyWithErr=${destroyWithErr}, manualEmit=${manualEmit} -> Total: ${errorCount}`);
          resolve(errorCount);
        }, 50);
      });
    });
  });
}

async function run() {
  console.log('--- Test 1: res.destroy(error) without manualEmit ---');
  await test(true, false);

  console.log('\n--- Test 2: manualEmit + res.destroy() ---');
  await test(false, true);

  console.log('\n--- Test 3: current behavior: manualEmit + res.emit + res.destroy(err) ---');
  // current
}

run();

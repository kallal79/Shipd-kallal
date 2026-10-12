const assert = require('node:assert');
const { Readable } = require('node:stream');
const getSetup = require('../support/setup');
const request = require('../support/client');

describe('[node] pipe callback handling', () => {
  let setup;
  let base;

  before(async () => {
    setup = await getSetup();
    base = setup.uri;
  });

  it('should work with pipe without callback', (done) => {
    const body = Readable.from(JSON.stringify({ name: 'john' }));
    const request_ = request
      .post(`${base}/echo`)
      .set('Content-Type', 'application/json')
      .on('response', (res) => {
        assert(res);
        assert.equal(res.status, 200);
        assert.equal(res.text, '{"name":"john"}');
        done();
      });

    body.pipe(request_);
  });

  it('should work with pipe and callback', (done) => {
    const body = Readable.from(JSON.stringify({ name: 'jane' }));
    const request_ = request
      .post(`${base}/echo`)
      .set('Content-Type', 'application/json')
      .on('response', (res) => {
        assert(res);
        assert.equal(res.status, 200);
        assert.equal(res.text, '{"name":"jane"}');
        done();
      });

    body.pipe(request_);
  });
});

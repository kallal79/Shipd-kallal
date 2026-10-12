'use strict';

const assert = require('assert');
const getSetup = require('../support/setup');
const request = require('../support/client');

describe('Request size limits', () => {
  let base;

  before(async () => {
    ({ uri: base } = await getSetup());
  });

  it('enforces maxRequestSize using UTF-8 byte length', (done) => {
    const request_ = request
      .post(`${base}/echo`)
      .maxRequestSize(1)
      .send('é');

    assert.strictEqual(request_.hasSizeError(), false);
    request_.end((error) => {
      assert.strictEqual(error.code, 'ETOOLARGE');
      assert.strictEqual(request_.hasSizeError(), true);
      done();
    });
  });

  it('accepts a request body exactly at the limit', (done) => {
    request
      .post(`${base}/echo`)
      .type('text/plain')
      .maxRequestSize(2)
      .send('é')
      .end((error, res) => {
        assert.ifError(error);
        assert.strictEqual(res.text, 'é');
        done();
      });
  });

  it('enforces maxRequestSize for write()', (done) => {
    const request_ = request.post(`${base}/echo`).maxRequestSize(2);
    request_.write('é');
    request_.write('a');
    request_.end((error) => {
      assert.strictEqual(error.code, 'ETOOLARGE');
      assert.strictEqual(request_.hasSizeError(), true);
      done();
    });
  });

  it('does not retry size errors', (done) => {
    let retryCallbackCalls = 0;
    const request_ = request
      .post(`${base}/echo`)
      .maxRequestSize(1)
      .retry(2, () => {
        retryCallbackCalls++;
        return true;
      })
      .send('too large');

    request_.end((error) => {
      assert.strictEqual(error.code, 'ETOOLARGE');
      assert.strictEqual(retryCallbackCalls, 0);
      done();
    });
  });

  it('enforces multipart Content-Length and emits upload progress', (done) => {
    let uploadProgress = false;
    request
      .post(`${base}/echo`)
      .maxRequestSize(223)
      .attach('document', 'test/node/fixtures/user.html')
      .on('progress', (event) => {
        if (event.direction === 'upload') uploadProgress = true;
      })
      .end((error, res) => {
        assert.ifError(error);
        assert.strictEqual(res.files.document.originalFilename, 'user.html');
        assert.strictEqual(uploadProgress, true);
        done();
      });
  });

  it('reports response size errors once', (done) => {
    let callbackCalls = 0;
    const request_ = request
      .get(`${base}/delay/slowbody`)
      .buffer(true)
      .maxResponseSize(1)
      .retry(2);

    request_.end((error) => {
      callbackCalls++;
      assert.strictEqual(error.code, 'ETOOLARGE');
      assert.strictEqual(callbackCalls, 1);
      assert.strictEqual(request_.hasSizeError(), true);
      done();
    });
  });
});

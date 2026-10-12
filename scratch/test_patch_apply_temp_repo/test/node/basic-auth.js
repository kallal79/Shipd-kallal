const assert = require('assert');
const { format } = require('url');
const request = require('../support/client');
const getSetup = require('../support/setup');

describe('Basic auth', () => {
  let setup;
  let base;

  before(async () => {
    setup = await getSetup();
    base = setup.uri;
  });

  describe('when credentials are present in url', () => {
    it('should set Authorization', (done) => {
      const new_url = new URL(base);
      new_url.username = 'tobi';
      new_url.password = 'learnboost';
      new_url.pathname = '/basic-auth';

      request.get(format(new_url)).end((error, res) => {
        assert.equal(res.status, 200);
        done();
      });
    });
  });

  describe('req.auth(user, pass)', () => {
    it('should set Authorization', (done) => {
      request
        .get(`${base}/basic-auth`)
        .auth('tobi', 'learnboost')
        .end((error, res) => {
          assert.equal(res.status, 200);
          done();
        });
    });
  });

  describe('req.auth(user + ":" + pass)', () => {
    it('should set authorization', (done) => {
      request
        .get(`${base}/basic-auth/again`)
        .auth('tobi')
        .end((error, res) => {
          assert.equal(res.status, 200);
          done();
        });
    });
  });
});

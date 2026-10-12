"use strict";

/**
 * Module dependencies.
 */

const {
  format
} = require('url');
const Stream = require('stream');
const https = require('https');
const http = require('http');
const fs = require('fs');
const zlib = require('zlib');
const util = require('util');
const qs = require('qs');
const mime = require('mime');
let methods = require('methods');
const FormData = require('form-data');
const formidable = require('formidable');
const debug = require('debug')('superagent');
const CookieJar = require('cookiejar');
const safeStringify = require('fast-safe-stringify');
const utils = require('../utils');
const RequestBase = require('../request-base');
const http2 = require('./http2wrapper');
const {
  decompress
} = require('./unzip');
const Response = require('./response');
const {
  mixin,
  hasOwn,
  isBrotliEncoding,
  isGzipOrDeflateEncoding
} = utils;
const {
  chooseDecompresser
} = require('./decompress');
function request(method, url) {
  // callback
  if (typeof url === 'function') {
    return new exports.Request('GET', method).end(url);
  }

  // url first
  if (arguments.length === 1) {
    return new exports.Request('GET', method);
  }
  return new exports.Request(method, url);
}
module.exports = request;
exports = module.exports;

/**
 * Expose `Request`.
 */

exports.Request = Request;

/**
 * Expose the agent function
 */

exports.agent = require('./agent');

/**
 * Noop.
 */

function noop() {}

/**
 * Expose `Response`.
 */

exports.Response = Response;

/**
 * Define "form" mime type.
 */

mime.define({
  'application/x-www-form-urlencoded': ['form', 'urlencoded', 'form-data']
}, true);

/**
 * Protocol map.
 */

exports.protocols = {
  'http:': http,
  'https:': https,
  'http2:': http2
};

/**
 * Default serialization map.
 *
 *     superagent.serialize['application/xml'] = function(obj){
 *       return 'generated xml here';
 *     };
 *
 */

exports.serialize = {
  'application/x-www-form-urlencoded': obj => {
    return qs.stringify(obj, {
      indices: false,
      strictNullHandling: true
    });
  },
  'application/json': safeStringify
};

/**
 * Default parsers.
 *
 *     superagent.parse['application/xml'] = function(res, fn){
 *       fn(null, res);
 *     };
 *
 */

exports.parse = require('./parsers');

/**
 * Default buffering map. Can be used to set certain
 * response types to buffer/not buffer.
 *
 *     superagent.buffer['application/xml'] = true;
 */
exports.buffer = {};

/**
 * Initialize internal header tracking properties on a request instance.
 *
 * @param {Object} req the instance
 * @api private
 */
function _initHeaders(request_) {
  request_._header = {
    // coerces header names to lowercase
  };
  request_.header = {
    // preserves header name case
  };
}

/**
 * Initialize a new `Request` with the given `method` and `url`.
 *
 * @param {String} method
 * @param {String|Object} url
 * @api public
 */

function Request(method, url) {
  Stream.call(this);
  if (typeof url !== 'string') url = format(url);
  this._enableHttp2 = Boolean(process.env.HTTP2_TEST); // internal only
  this._agent = false;
  this._formData = null;
  this.method = method;
  this.url = url;
  _initHeaders(this);
  this.writable = true;
  this._redirects = 0;
  this.redirects(method === 'HEAD' ? 0 : 5);
  this.cookies = '';
  this.qs = {};
  this._query = [];
  this.qsRaw = this._query; // Unused, for backwards compatibility only
  this._redirectList = [];
  this._streamRequest = false;
  this._lookup = undefined;
  this.once('end', this.clearTimeout.bind(this));
}

/**
 * Inherit from `Stream` (which inherits from `EventEmitter`).
 * Mixin `RequestBase`.
 */
util.inherits(Request, Stream);
mixin(Request.prototype, RequestBase.prototype);

/**
 * Enable or Disable http2.
 *
 * Enable http2.
 *
 * ``` js
 * request.get('http://localhost/')
 *   .http2()
 *   .end(callback);
 *
 * request.get('http://localhost/')
 *   .http2(true)
 *   .end(callback);
 * ```
 *
 * Disable http2.
 *
 * ``` js
 * request = request.http2();
 * request.get('http://localhost/')
 *   .http2(false)
 *   .end(callback);
 * ```
 *
 * @param {Boolean} enable
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.http2 = function (bool) {
  if (exports.protocols['http2:'] === undefined) {
    throw new Error('superagent: this version of Node.js does not support http2');
  }
  this._enableHttp2 = bool === undefined ? true : bool;
  return this;
};

/**
 * Queue the given `file` as an attachment to the specified `field`,
 * with optional `options` (or filename).
 *
 * ``` js
 * request.post('http://localhost/upload')
 *   .attach('field', Buffer.from('<b>Hello world</b>'), 'hello.html')
 *   .end(callback);
 * ```
 *
 * A filename may also be used:
 *
 * ``` js
 * request.post('http://localhost/upload')
 *   .attach('files', 'image.jpg')
 *   .end(callback);
 * ```
 *
 * @param {String} field
 * @param {String|fs.ReadStream|Buffer} file
 * @param {String|Object} options
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.attach = function (field, file, options) {
  if (file) {
    if (this._data) {
      throw new Error("superagent can't mix .send() and .attach()");
    }
    let o = options || {};
    if (typeof options === 'string') {
      o = {
        filename: options
      };
    }
    if (typeof file === 'string') {
      if (!o.filename) o.filename = file;
      debug('creating `fs.ReadStream` instance for file: %s', file);
      file = fs.createReadStream(file);
      file.on('error', error => {
        const formData = this._getFormData();
        formData.emit('error', error);
      });
    } else if (!o.filename && file.path) {
      o.filename = file.path;
    }
    this._getFormData().append(field, file, o);
  }
  return this;
};
Request.prototype._getFormData = function () {
  if (!this._formData) {
    this._formData = new FormData();
    this._formData.on('error', error => {
      debug('FormData error', error);
      if (this.called) {
        // The request has already finished and the callback was called.
        // Silently ignore the error.
        return;
      }
      this.callback(error);
      this.abort();
    });
  }
  return this._formData;
};

/**
 * Gets/sets the `Agent` to use for this HTTP request. The default (if this
 * function is not called) is to opt out of connection pooling (`agent: false`).
 *
 * @param {http.Agent} agent
 * @return {http.Agent}
 * @api public
 */

Request.prototype.agent = function (agent) {
  if (arguments.length === 0) return this._agent;
  this._agent = agent;
  return this;
};

/**
 * Gets/sets the `lookup` function to use custom DNS resolver.
 *
 * @param {Function} lookup
 * @return {Function}
 * @api public
 */

Request.prototype.lookup = function (lookup) {
  if (arguments.length === 0) return this._lookup;
  this._lookup = lookup;
  return this;
};

/**
 * Set _Content-Type_ response header passed through `mime.getType()`.
 *
 * Examples:
 *
 *      request.post('/')
 *        .type('xml')
 *        .send(xmlstring)
 *        .end(callback);
 *
 *      request.post('/')
 *        .type('json')
 *        .send(jsonstring)
 *        .end(callback);
 *
 *      request.post('/')
 *        .type('application/json')
 *        .send(jsonstring)
 *        .end(callback);
 *
 * @param {String} type
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.type = function (type) {
  return this.set('Content-Type', type.includes('/') ? type : mime.getType(type));
};

/**
 * Set _Accept_ response header passed through `mime.getType()`.
 *
 * Examples:
 *
 *      superagent.types.json = 'application/json';
 *
 *      request.get('/agent')
 *        .accept('json')
 *        .end(callback);
 *
 *      request.get('/agent')
 *        .accept('application/json')
 *        .end(callback);
 *
 * @param {String} accept
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.accept = function (type) {
  return this.set('Accept', type.includes('/') ? type : mime.getType(type));
};

/**
 * Add query-string `val`.
 *
 * Examples:
 *
 *   request.get('/shoes')
 *     .query('size=10')
 *     .query({ color: 'blue' })
 *
 * @param {Object|String} val
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.query = function (value) {
  if (typeof value === 'string') {
    this._query.push(value);
  } else {
    Object.assign(this.qs, value);
  }
  return this;
};

/**
 * Write raw `data` / `encoding` to the socket.
 *
 * @param {Buffer|String} data
 * @param {String} encoding
 * @return {Boolean}
 * @api public
 */

Request.prototype.write = function (data, encoding) {
  const request_ = this.request();
  if (!this._streamRequest) {
    this._streamRequest = true;
  }
  if (this.hasSizeError()) return false;
  this._requestBytes = (this._requestBytes || 0) + utils.byteLength(data, encoding);
  if (this._maxRequestSize !== undefined && this._requestBytes > this._maxRequestSize) {
    this._failRequestSize();
    return false;
  }
  return request_.write(data, encoding);
};

/**
 * Pipe the request body to `stream`.
 *
 * @param {Stream} stream
 * @param {Object} options
 * @return {Stream}
 * @api public
 */

Request.prototype.pipe = function (stream, options) {
  this.piped = true; // HACK...
  this.buffer(false);
  this.end();
  return this._pipeContinue(stream, options);
};
Request.prototype._pipeContinue = function (stream, options) {
  this.req.once('response', res => {
    // redirect
    if (isRedirect(res.statusCode) && this._redirects++ !== this._maxRedirects) {
      return this._redirect(res) === this ? this._pipeContinue(stream, options) : undefined;
    }
    this.res = res;
    this._emitResponse();
    if (this._aborted) return;
    if (this._shouldDecompress(res)) {
      let decompresser = chooseDecompresser(res);
      decompresser.on('error', error => {
        if (error && error.code === 'Z_BUF_ERROR') {
          // unexpected end of file is ignored by browsers and curl
          stream.emit('end');
          return;
        }
        stream.emit('error', error);
      });
      res.pipe(decompresser).pipe(stream, options);
      // don't emit 'end' until decompresser has completed writing all its data.
      decompresser.once('end', () => this.emit('end'));
    } else {
      res.pipe(stream, options);
      res.once('end', () => this.emit('end'));
    }
  });
  return stream;
};

/**
 * Enable / disable buffering.
 *
 * @return {Boolean} [val]
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.buffer = function (value) {
  this._buffer = value !== false;
  return this;
};

/**
 * Redirect to `url
 *
 * @param {IncomingMessage} res
 * @return {Request} for chaining
 * @api private
 */

Request.prototype._redirect = function (res) {
  let url = res.headers.location;
  if (!url) {
    return this.callback(new Error('No location header for redirect'), res);
  }
  debug('redirect %s -> %s', this.url, url);

  // location
  url = new URL(url, this.url).href;

  // ensure the response is being consumed
  // this is required for Node v0.10+
  res.resume();
  let headers = this.req.getHeaders ? this.req.getHeaders() : this.req._headers;
  const changesOrigin = new URL(url).host !== new URL(this.url).host;

  // implementation of 302 following defacto standard
  if (res.statusCode === 301 || res.statusCode === 302) {
    // strip Content-* related fields
    // in case of POST etc
    headers = utils.cleanHeader(headers, changesOrigin);

    // force GET
    this.method = this.method === 'HEAD' ? 'HEAD' : 'GET';

    // clear data
    this._data = null;
  }

  // 303 is always GET
  if (res.statusCode === 303) {
    // strip Content-* related fields
    // in case of POST etc
    headers = utils.cleanHeader(headers, changesOrigin);

    // force method
    this.method = 'GET';

    // clear data
    this._data = null;
  }

  // 307 preserves method
  // 308 preserves method
  delete headers.host;
  delete this.req;
  delete this._formData;

  // remove all add header except User-Agent
  _initHeaders(this);

  // redirect
  this.res = res;
  this._endCalled = false;
  this.url = url;
  this.qs = {};
  this._query.length = 0;
  this.set(headers);
  this._emitRedirect();
  this._redirectList.push(this.url);
  this.end(this._callback);
  return this;
};

/**
 * Set Authorization field value with `user` and `pass`.
 *
 * Examples:
 *
 *   .auth('tobi', 'learnboost')
 *   .auth('tobi:learnboost')
 *   .auth('tobi')
 *   .auth(accessToken, { type: 'bearer' })
 *
 * @param {String} user
 * @param {String} [pass]
 * @param {Object} [options] options with authorization type 'basic' or 'bearer' ('basic' is default)
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.auth = function (user, pass, options) {
  if (arguments.length === 1) pass = '';
  if (typeof pass === 'object' && pass !== null) {
    // pass is optional and can be replaced with options
    options = pass;
    pass = '';
  }
  if (!options) {
    options = {
      type: 'basic'
    };
  }
  const encoder = string => Buffer.from(string).toString('base64');
  return this._auth(user, pass, options, encoder);
};

/**
 * Set the certificate authority option for https request.
 *
 * @param {Buffer | Array} cert
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.ca = function (cert) {
  this._ca = cert;
  return this;
};

/**
 * Set the client certificate key option for https request.
 *
 * @param {Buffer | String} cert
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.key = function (cert) {
  this._key = cert;
  return this;
};

/**
 * Set the key, certificate, and CA certs of the client in PFX or PKCS12 format.
 *
 * @param {Buffer | String} cert
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.pfx = function (cert) {
  if (typeof cert === 'object' && !Buffer.isBuffer(cert)) {
    this._pfx = cert.pfx;
    this._passphrase = cert.passphrase;
  } else {
    this._pfx = cert;
  }
  return this;
};

/**
 * Set the client certificate option for https request.
 *
 * @param {Buffer | String} cert
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.cert = function (cert) {
  this._cert = cert;
  return this;
};

/**
 * Do not reject expired or invalid TLS certs.
 * sets `rejectUnauthorized=true`. Be warned that this allows MITM attacks.
 *
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.disableTLSCerts = function () {
  this._disableTLSCerts = true;
  return this;
};

/**
 * Return an http[s] request.
 *
 * @return {OutgoingMessage}
 * @api private
 */

// eslint-disable-next-line complexity
Request.prototype.request = function () {
  if (this.req) return this.req;
  const options = {};
  try {
    const query = qs.stringify(this.qs, {
      indices: false,
      strictNullHandling: true
    });
    if (query) {
      this.qs = {};
      this._query.push(query);
    }
    this._finalizeQueryString();
  } catch (err) {
    return this.emit('error', err);
  }
  let {
    url: urlString
  } = this;
  const retries = this._retries;

  // default to http://
  if (urlString.indexOf('http') !== 0) urlString = `http://${urlString}`;
  const url = new URL(urlString);
  let {
    protocol
  } = url;
  let path = `${url.pathname}${url.search}`;

  // support unix sockets
  if (/^https?\+unix:/.test(protocol) === true) {
    // get the protocol
    protocol = `${protocol.split('+')[0]}:`;

    // get the socket path
    options.socketPath = url.hostname.replace(/%2F/g, '/');
    url.host = '';
    url.hostname = '';
  }

  // Override IP address of a hostname
  if (this._connectOverride) {
    const {
      hostname
    } = url;
    const match = hostname in this._connectOverride ? this._connectOverride[hostname] : this._connectOverride['*'];
    if (match) {
      // backup the real host
      if (!this._header.host) {
        this.set('host', url.host);
      }
      let newHost;
      let newPort;
      if (typeof match === 'object') {
        newHost = match.host;
        newPort = match.port;
      } else {
        newHost = match;
        newPort = url.port;
      }

      // wrap [ipv6]
      url.host = /:/.test(newHost) ? `[${newHost}]` : newHost;
      if (newPort) {
        url.host += `:${newPort}`;
        url.port = newPort;
      }
      url.hostname = newHost;
    }
  }

  // options
  options.method = this.method;
  options.port = url.port;
  options.path = path;
  options.host = utils.normalizeHostname(url.hostname); // ex: [::1] -> ::1
  options.ca = this._ca;
  options.key = this._key;
  options.pfx = this._pfx;
  options.cert = this._cert;
  options.passphrase = this._passphrase;
  options.agent = this._agent;
  options.lookup = this._lookup;
  options.rejectUnauthorized = typeof this._disableTLSCerts === 'boolean' ? !this._disableTLSCerts : process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0';

  // Allows request.get('https://1.2.3.4/').set('Host', 'example.com')
  if (this._header.host) {
    options.servername = this._header.host.replace(/:\d+$/, '');
  }
  if (this._trustLocalhost && /^(?:localhost|127\.0\.0\.\d+|(0*:)+:0*1)$/.test(url.hostname)) {
    options.rejectUnauthorized = false;
  }

  // initiate request
  const module_ = this._enableHttp2 ? exports.protocols['http2:'].setProtocol(protocol) : exports.protocols[protocol];

  // request
  this.req = module_.request(options);
  const {
    req
  } = this;

  // set tcp no delay
  req.setNoDelay(true);
  if (options.method !== 'HEAD') {
    req.setHeader('Accept-Encoding', 'gzip, deflate');
  }
  this.protocol = protocol;
  this.host = url.host;

  // expose events
  req.once('drain', () => {
    this.emit('drain');
  });
  req.on('error', error => {
    // flag abortion here for out timeouts
    // because node will emit a faux-error "socket hang up"
    // when request is aborted before a connection is made
    if (this._aborted) return;
    if (this.hasSizeError()) return;
    // if not the same, we are in the **old** (cancelled) request,
    // so need to continue (same as for above)
    if (this._retries !== retries) return;
    // if we've received a response then we don't want to let
    // an error in the request blow up the response
    if (this.response) return;
    this.callback(error);
  });

  // auth
  if (url.username || url.password) {
    this.auth(url.username, url.password);
  }
  if (this.username && this.password) {
    this.auth(this.username, this.password);
  }
  for (const key in this.header) {
    if (hasOwn(this.header, key)) req.setHeader(key, this.header[key]);
  }

  // add cookies
  if (this.cookies) {
    if (hasOwn(this._header, 'cookie')) {
      // merge
      const temporaryJar = new CookieJar.CookieJar();
      temporaryJar.setCookies(this._header.cookie.split('; '));
      temporaryJar.setCookies(this.cookies.split('; '));
      req.setHeader('Cookie', temporaryJar.getCookies(CookieJar.CookieAccessInfo.All).toValueString());
    } else {
      req.setHeader('Cookie', this.cookies);
    }
  }
  return req;
};

/**
 * Invoke the callback with `err` and `res`
 * and handle arity check.
 *
 * @param {Error} err
 * @param {Response} res
 * @api private
 */

Request.prototype.callback = function (error, res) {
  if (this.called) return;
  if (this._shouldRetry(error, res)) {
    return this._retry();
  }

  // Avoid the error which is emitted from 'socket hang up' to cause the fn undefined error on JS runtime.
  const fn = this._callback || noop;
  this.clearTimeout();
  this.called = true;
  if (!error) {
    try {
      if (!this._isResponseOK(res)) {
        let message = 'Unsuccessful HTTP response';
        if (res) {
          message = http.STATUS_CODES[res.status] || message;
        }
        error = new Error(message);
        error.status = res ? res.status : undefined;
      }
    } catch (err) {
      error = err;
      error.status = error.status || (res ? res.status : undefined);
    }
  }

  // It's important that the callback is called outside try/catch
  // to avoid double callback
  if (!error) {
    return fn(null, res);
  }
  error.response = res;
  if (this._maxRetries) error.retries = this._retries - 1;

  // only emit error event if there is a listener
  // otherwise we assume the callback to `.end()` will get the error
  if (error && this.listeners('error').length > 0) {
    this.emit('error', error);
  }
  fn(error, res);
};

/**
 * Check if `obj` is a host object,
 *
 * @param {Object} obj host object
 * @return {Boolean} is a host object
 * @api private
 */
Request.prototype._isHost = function (object) {
  return Buffer.isBuffer(object) || object instanceof Stream || object instanceof FormData;
};

/**
 * Terminate a request after its body exceeds the configured limit.
 *
 * @return {Error}
 * @api private
 */
Request.prototype._failRequestSize = function () {
  const error = this._createSizeError('request');
  if (this.req && !this.req.destroyed) {
    if (typeof this.req.destroy === 'function') this.req.destroy();else if (typeof this.req.abort === 'function') this.req.abort();
  }
  if (this._endCalled) this.callback(error);
  return error;
};

/**
 * Initiate request, invoking callback `fn(err, res)`
 * with an instanceof `Response`.
 *
 * @param {Function} fn
 * @return {Request} for chaining
 * @api public
 */

Request.prototype._emitResponse = function (body, files) {
  const response = new Response(this);
  this.response = response;
  response.redirects = this._redirectList;
  if (undefined !== body) {
    response.body = body;
  }
  response.files = files;
  if (this._endCalled) {
    response.pipe = function () {
      throw new Error("end() has already been called, so it's too late to start piping");
    };
  }
  this.emit('response', response);
  return response;
};

/**
 * Emit `redirect` event, passing an instanceof `Response`.
 *
 * @api private
 */

Request.prototype._emitRedirect = function () {
  const response = new Response(this);
  response.redirects = this._redirectList;
  this.emit('redirect', response);
};
Request.prototype.end = function (fn) {
  this.request();
  debug('%s %s', this.method, this.url);
  if (this._endCalled) {
    throw new Error('.end() was called twice. This is not supported in superagent');
  }
  this._endCalled = true;

  // store callback
  this._callback = fn || noop;
  this._end();
};
Request.prototype._end = function () {
  if (this._aborted) return this.callback(new Error('The request has been aborted even before .end() was called'));
  if (this.hasSizeError()) return this.callback(this._sizeErrorError);
  let data = this._data;
  const {
    req
  } = this;
  const {
    method
  } = this;
  this._setTimeouts();

  // body
  if (method !== 'HEAD' && !req._headerSent) {
    // serialize stuff
    if (typeof data !== 'string') {
      let contentType = req.getHeader('Content-Type');
      // Parse out just the content type from the header (ignore the charset)
      if (contentType) contentType = contentType.split(';')[0];
      let serialize = this._serializer || exports.serialize[contentType];
      if (!serialize && isJSON(contentType)) {
        serialize = exports.serialize['application/json'];
      }
      if (serialize) data = serialize(data);
    }

    // content-length
    if (data && !req.getHeader('Content-Length')) {
      req.setHeader('Content-Length', Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data));
    }
  }
  if (this._maxRequestSize !== undefined && utils.byteLength(data) > this._maxRequestSize) {
    return this._failRequestSize();
  }

  // response
  // eslint-disable-next-line complexity
  req.once('response', res => {
    debug('%s %s -> %s', this.method, this.url, res.statusCode);
    if (this._responseTimeoutTimer) {
      clearTimeout(this._responseTimeoutTimer);
    }
    if (this.piped) {
      return;
    }
    const max = this._maxRedirects;
    const mime = utils.type(res.headers['content-type'] || '') || 'text/plain';
    let type = mime.split('/')[0];
    if (type) type = type.toLowerCase().trim();
    const multipart = type === 'multipart';
    const redirect = isRedirect(res.statusCode);
    const responseType = this._responseType;
    this.res = res;

    // redirect
    if (redirect && this._redirects++ !== max) {
      return this._redirect(res);
    }
    if (this.method === 'HEAD') {
      this.emit('end');
      this.callback(null, this._emitResponse());
      return;
    }

    // zlib support
    if (this._shouldDecompress(res)) {
      decompress(req, res);
    }
    let buffer = this._buffer;
    if (buffer === undefined && mime in exports.buffer) {
      buffer = Boolean(exports.buffer[mime]);
    }
    let parser = this._parser;
    if (undefined === buffer && parser) {
      console.warn("A custom superagent parser has been set, but buffering strategy for the parser hasn't been configured. Call `req.buffer(true or false)` or set `superagent.buffer[mime] = true or false`");
      buffer = true;
    }
    if (!parser) {
      if (responseType) {
        parser = exports.parse.image; // It's actually a generic Buffer
        buffer = true;
      } else if (multipart) {
        const form = formidable.formidable();
        parser = (res, callback) => {
          // Create a PassThrough stream that acts as a proper HTTP request
          const bridgeStream = new Stream.PassThrough();

          // Add HTTP request properties from the current request context
          bridgeStream.method = this.method || 'POST';
          bridgeStream.url = this.url || '/';
          bridgeStream.httpVersion = res.httpVersion || '1.1';
          bridgeStream.headers = res.headers || {};
          bridgeStream.socket = res.socket || {
            readable: true
          };

          // Pipe the response data through the bridge stream
          res.pipe(bridgeStream);
          form.parse(bridgeStream, (err, fields, files) => {
            if (err) return callback(err);

            // Formidable v3 always returns arrays, but SuperAgent expects single values
            // Flatten single-item arrays to maintain backward compatibility
            const flattenedFields = {};
            if (fields) {
              for (const key in fields) {
                const value = fields[key];
                flattenedFields[key] = Array.isArray(value) && value.length === 1 ? value[0] : value;
              }
            }
            const flattenedFiles = {};
            if (files) {
              for (const key in files) {
                const value = files[key];
                flattenedFiles[key] = Array.isArray(value) && value.length === 1 ? value[0] : value;
              }
            }

            // Return flattened fields as the object parameter to match SuperAgent's expected format
            callback(null, flattenedFields, flattenedFiles);
          });
        };
        buffer = true;
      } else if (isBinary(mime)) {
        parser = exports.parse.image;
        buffer = true; // For backwards-compatibility buffering default is ad-hoc MIME-dependent
      } else if (exports.parse[mime]) {
        parser = exports.parse[mime];
      } else if (type === 'text') {
        parser = exports.parse.text;
        buffer = buffer !== false;
        // everyone wants their own white-labeled json
      } else if (isJSON(mime)) {
        parser = exports.parse['application/json'];
        buffer = buffer !== false;
      } else if (buffer) {
        parser = exports.parse.text;
      } else if (undefined === buffer) {
        parser = exports.parse.image; // It's actually a generic Buffer
        buffer = true;
      }
    }

    // by default only buffer text/*, json and messed up thing from hell
    if (undefined === buffer && isText(mime) || isJSON(mime)) {
      buffer = true;
    }
    this._resBuffered = buffer;
    let parserHandlesEnd = false;
    if (buffer) {
      // Protectiona against zip bombs and other nuisance
      let responseBytes = 0;
      const maxResponseSize = this._maxResponseSize === undefined ? 200000000 : this._maxResponseSize;
      res.on('data', buf => {
        if (this.hasSizeError()) return;
        responseBytes += utils.byteLength(buf);
        if (responseBytes > maxResponseSize) {
          const error = this._createSizeError('response');
          // Parsers aren't required to observe error event,
          // so would incorrectly report success
          parserHandlesEnd = false;
          res.destroy(error);
          this.callback(error, null);
        }
      });
    }
    if (parser) {
      try {
        // Unbuffered parsers are supposed to emit response early,
        // which is weird BTW, because response.body won't be there.
        parserHandlesEnd = buffer;
        parser(res, (error, object, files) => {
          if (this.timedout) {
            // Timeout has already handled all callbacks
            return;
          }
          if (this.hasSizeError()) return;

          // Intentional (non-timeout) abort is supposed to preserve partial response,
          // even if it doesn't parse.
          if (error && !this._aborted) {
            return this.callback(error);
          }
          if (parserHandlesEnd) {
            this.emit('end');
            this.callback(null, this._emitResponse(object, files));
          }
        });
      } catch (err) {
        this.callback(err);
        return;
      }
    }
    this.res = res;

    // unbuffered
    if (!buffer) {
      debug('unbuffered %s %s', this.method, this.url);
      this.callback(null, this._emitResponse());
      if (multipart) return; // allow multipart to handle end event
      res.once('end', () => {
        debug('end %s %s', this.method, this.url);
        this.emit('end');
      });
      return;
    }

    // terminating events
    res.once('error', error => {
      parserHandlesEnd = false;
      this.callback(this._sizeErrorError || error, null);
    });
    if (!parserHandlesEnd) res.once('end', () => {
      debug('end %s %s', this.method, this.url);
      // TODO: unless buffering emit earlier to stream
      this.emit('end');
      this.callback(null, this._emitResponse());
    });
  });
  this.emit('request', this);
  const getProgressMonitor = () => {
    const lengthComputable = true;
    const total = req.getHeader('Content-Length');
    const maxRequestSize = this._maxRequestSize;
    let loaded = 0;
    const progress = new Stream.Transform();
    progress._transform = (chunk, encoding, callback) => {
      loaded += utils.byteLength(chunk, encoding);
      if (maxRequestSize !== undefined && loaded > maxRequestSize) {
        const error = this._failRequestSize();
        callback(error);
        return;
      }
      this.emit('progress', {
        direction: 'upload',
        lengthComputable,
        loaded,
        total
      });
      callback(null, chunk);
    };
    progress.on('error', error => {
      if (!this.hasSizeError()) this.callback(error);
    });
    return progress;
  };
  const bufferToChunks = buffer => {
    const chunkSize = 16 * 1024; // default highWaterMark value
    const chunking = new Stream.Readable();
    const totalLength = buffer.length;
    const remainder = totalLength % chunkSize;
    const cutoff = totalLength - remainder;
    for (let i = 0; i < cutoff; i += chunkSize) {
      const chunk = buffer.slice(i, i + chunkSize);
      chunking.push(chunk);
    }
    if (remainder > 0) {
      const remainderBuffer = buffer.slice(-remainder);
      chunking.push(remainderBuffer);
    }
    chunking.push(null); // no more data

    return chunking;
  };

  // if a FormData instance got created, then we send that as the request body
  const formData = this._formData;
  if (formData) {
    // set headers
    const headers = formData.getHeaders();
    for (const i in headers) {
      if (hasOwn(headers, i)) {
        debug('setting FormData header: "%s: %s"', i, headers[i]);
        req.setHeader(i, headers[i]);
      }
    }

    // attempt to get "Content-Length" header
    formData.getLength((error, length) => {
      // TODO: Add chunked encoding when no length (if err)
      if (error) debug('formData.getLength had error', error, length);
      debug('got FormData Content-Length: %s', length);
      if (typeof length === 'number') {
        req.setHeader('Content-Length', length);
        if (this._maxRequestSize !== undefined && length > this._maxRequestSize) {
          this._failRequestSize();
          return;
        }
      }
      if (this.hasSizeError()) return;
      formData.pipe(getProgressMonitor()).pipe(req);
    });
  } else if (Buffer.isBuffer(data)) {
    bufferToChunks(data).pipe(getProgressMonitor()).pipe(req);
  } else {
    req.end(data);
  }
};

// Check whether response has a non-0-sized gzip-encoded body
Request.prototype._shouldDecompress = res => {
  return hasNonEmptyResponseContent(res) && (isGzipOrDeflateEncoding(res) || isBrotliEncoding(res));
};

/**
 * Overrides DNS for selected hostnames. Takes object mapping hostnames to IP addresses.
 *
 * When making a request to a URL with a hostname exactly matching a key in the object,
 * use the given IP address to connect, instead of using DNS to resolve the hostname.
 *
 * A special host `*` matches every hostname (keep redirects in mind!)
 *
 *      request.connect({
 *        'test.example.com': '127.0.0.1',
 *        'ipv6.example.com': '::1',
 *      })
 */
Request.prototype.connect = function (connectOverride) {
  if (typeof connectOverride === 'string') {
    this._connectOverride = {
      '*': connectOverride
    };
  } else if (typeof connectOverride === 'object') {
    this._connectOverride = connectOverride;
  } else {
    this._connectOverride = undefined;
  }
  return this;
};
Request.prototype.trustLocalhost = function (toggle) {
  this._trustLocalhost = toggle === undefined ? true : toggle;
  return this;
};

// generate HTTP verb methods
if (!methods.includes('del')) {
  // create a copy so we don't cause conflicts with
  // other packages using the methods package and
  // npm 3.x
  methods = [...methods];
  methods.push('del');
}
for (let method of methods) {
  const name = method;
  method = method === 'del' ? 'delete' : method;
  method = method.toUpperCase();
  request[name] = (url, data, fn) => {
    const request_ = request(method, url);
    if (typeof data === 'function') {
      fn = data;
      data = null;
    }
    if (data) {
      if (method === 'GET' || method === 'HEAD') {
        request_.query(data);
      } else {
        request_.send(data);
      }
    }
    if (fn) request_.end(fn);
    return request_;
  };
}

/**
 * Check if `mime` is text and should be buffered.
 *
 * @param {String} mime
 * @return {Boolean}
 * @api public
 */

function isText(mime) {
  const parts = mime.split('/');
  let type = parts[0];
  if (type) type = type.toLowerCase().trim();
  let subtype = parts[1];
  if (subtype) subtype = subtype.toLowerCase().trim();
  return type === 'text' || subtype === 'x-www-form-urlencoded';
}

// This is not a catchall, but a start. It might be useful
// in the long run to have file that includes all binary
// content types from https://www.iana.org/assignments/media-types/media-types.xhtml
function isBinary(mime) {
  let [registry, name] = mime.split('/');
  if (registry) registry = registry.toLowerCase().trim();
  if (name) name = name.toLowerCase().trim();
  return ['audio', 'font', 'image', 'video'].includes(registry) || ['gz', 'gzip'].includes(name);
}

/**
 * Check if `mime` is json or has +json structured syntax suffix.
 *
 * @param {String} mime
 * @return {Boolean}
 * @api private
 */

function isJSON(mime) {
  // should match /json or +json
  // but not /json-seq
  return /[/+]json($|[^-\w])/i.test(mime);
}

/**
 * Check if we should follow the redirect `code`.
 *
 * @param {Number} code
 * @return {Boolean}
 * @api private
 */

function isRedirect(code) {
  return [301, 302, 303, 305, 307, 308].includes(code);
}
function hasNonEmptyResponseContent(res) {
  if (res.statusCode === 204 || res.statusCode === 304) {
    // These aren't supposed to have any body
    return false;
  }

  // header content is a string, and distinction between 0 and no information is crucial
  if (res.headers['content-length'] === '0') {
    // We know that the body is empty (unfortunately, this check does not cover chunked encoding)
    return false;
  }
  return true;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmb3JtYXQiLCJyZXF1aXJlIiwiU3RyZWFtIiwiaHR0cHMiLCJodHRwIiwiZnMiLCJ6bGliIiwidXRpbCIsInFzIiwibWltZSIsIm1ldGhvZHMiLCJGb3JtRGF0YSIsImZvcm1pZGFibGUiLCJkZWJ1ZyIsIkNvb2tpZUphciIsInNhZmVTdHJpbmdpZnkiLCJ1dGlscyIsIlJlcXVlc3RCYXNlIiwiaHR0cDIiLCJkZWNvbXByZXNzIiwiUmVzcG9uc2UiLCJtaXhpbiIsImhhc093biIsImlzQnJvdGxpRW5jb2RpbmciLCJpc0d6aXBPckRlZmxhdGVFbmNvZGluZyIsImNob29zZURlY29tcHJlc3NlciIsInJlcXVlc3QiLCJtZXRob2QiLCJ1cmwiLCJleHBvcnRzIiwiUmVxdWVzdCIsImVuZCIsImFyZ3VtZW50cyIsImxlbmd0aCIsIm1vZHVsZSIsImFnZW50Iiwibm9vcCIsImRlZmluZSIsInByb3RvY29scyIsInNlcmlhbGl6ZSIsIm9iaiIsInN0cmluZ2lmeSIsImluZGljZXMiLCJzdHJpY3ROdWxsSGFuZGxpbmciLCJwYXJzZSIsImJ1ZmZlciIsIl9pbml0SGVhZGVycyIsInJlcXVlc3RfIiwiX2hlYWRlciIsImhlYWRlciIsImNhbGwiLCJfZW5hYmxlSHR0cDIiLCJCb29sZWFuIiwicHJvY2VzcyIsImVudiIsIkhUVFAyX1RFU1QiLCJfYWdlbnQiLCJfZm9ybURhdGEiLCJ3cml0YWJsZSIsIl9yZWRpcmVjdHMiLCJyZWRpcmVjdHMiLCJjb29raWVzIiwiX3F1ZXJ5IiwicXNSYXciLCJfcmVkaXJlY3RMaXN0IiwiX3N0cmVhbVJlcXVlc3QiLCJfbG9va3VwIiwidW5kZWZpbmVkIiwib25jZSIsImNsZWFyVGltZW91dCIsImJpbmQiLCJpbmhlcml0cyIsInByb3RvdHlwZSIsImJvb2wiLCJFcnJvciIsImF0dGFjaCIsImZpZWxkIiwiZmlsZSIsIm9wdGlvbnMiLCJfZGF0YSIsIm8iLCJmaWxlbmFtZSIsImNyZWF0ZVJlYWRTdHJlYW0iLCJvbiIsImVycm9yIiwiZm9ybURhdGEiLCJfZ2V0Rm9ybURhdGEiLCJlbWl0IiwicGF0aCIsImFwcGVuZCIsImNhbGxlZCIsImNhbGxiYWNrIiwiYWJvcnQiLCJsb29rdXAiLCJ0eXBlIiwic2V0IiwiaW5jbHVkZXMiLCJnZXRUeXBlIiwiYWNjZXB0IiwicXVlcnkiLCJ2YWx1ZSIsInB1c2giLCJPYmplY3QiLCJhc3NpZ24iLCJ3cml0ZSIsImRhdGEiLCJlbmNvZGluZyIsImhhc1NpemVFcnJvciIsIl9yZXF1ZXN0Qnl0ZXMiLCJieXRlTGVuZ3RoIiwiX21heFJlcXVlc3RTaXplIiwiX2ZhaWxSZXF1ZXN0U2l6ZSIsInBpcGUiLCJzdHJlYW0iLCJwaXBlZCIsIl9waXBlQ29udGludWUiLCJyZXEiLCJyZXMiLCJpc1JlZGlyZWN0Iiwic3RhdHVzQ29kZSIsIl9tYXhSZWRpcmVjdHMiLCJfcmVkaXJlY3QiLCJfZW1pdFJlc3BvbnNlIiwiX2Fib3J0ZWQiLCJfc2hvdWxkRGVjb21wcmVzcyIsImRlY29tcHJlc3NlciIsImNvZGUiLCJfYnVmZmVyIiwiaGVhZGVycyIsImxvY2F0aW9uIiwiVVJMIiwiaHJlZiIsInJlc3VtZSIsImdldEhlYWRlcnMiLCJfaGVhZGVycyIsImNoYW5nZXNPcmlnaW4iLCJob3N0IiwiY2xlYW5IZWFkZXIiLCJfZW5kQ2FsbGVkIiwiX2VtaXRSZWRpcmVjdCIsIl9jYWxsYmFjayIsImF1dGgiLCJ1c2VyIiwicGFzcyIsImVuY29kZXIiLCJzdHJpbmciLCJCdWZmZXIiLCJmcm9tIiwidG9TdHJpbmciLCJfYXV0aCIsImNhIiwiY2VydCIsIl9jYSIsImtleSIsIl9rZXkiLCJwZngiLCJpc0J1ZmZlciIsIl9wZngiLCJfcGFzc3BocmFzZSIsInBhc3NwaHJhc2UiLCJfY2VydCIsImRpc2FibGVUTFNDZXJ0cyIsIl9kaXNhYmxlVExTQ2VydHMiLCJfZmluYWxpemVRdWVyeVN0cmluZyIsImVyciIsInVybFN0cmluZyIsInJldHJpZXMiLCJfcmV0cmllcyIsImluZGV4T2YiLCJwcm90b2NvbCIsInBhdGhuYW1lIiwic2VhcmNoIiwidGVzdCIsInNwbGl0Iiwic29ja2V0UGF0aCIsImhvc3RuYW1lIiwicmVwbGFjZSIsIl9jb25uZWN0T3ZlcnJpZGUiLCJtYXRjaCIsIm5ld0hvc3QiLCJuZXdQb3J0IiwicG9ydCIsIm5vcm1hbGl6ZUhvc3RuYW1lIiwicmVqZWN0VW5hdXRob3JpemVkIiwiTk9ERV9UTFNfUkVKRUNUX1VOQVVUSE9SSVpFRCIsInNlcnZlcm5hbWUiLCJfdHJ1c3RMb2NhbGhvc3QiLCJtb2R1bGVfIiwic2V0UHJvdG9jb2wiLCJzZXROb0RlbGF5Iiwic2V0SGVhZGVyIiwicmVzcG9uc2UiLCJ1c2VybmFtZSIsInBhc3N3b3JkIiwidGVtcG9yYXJ5SmFyIiwic2V0Q29va2llcyIsImNvb2tpZSIsImdldENvb2tpZXMiLCJDb29raWVBY2Nlc3NJbmZvIiwiQWxsIiwidG9WYWx1ZVN0cmluZyIsIl9zaG91bGRSZXRyeSIsIl9yZXRyeSIsImZuIiwiX2lzUmVzcG9uc2VPSyIsIm1lc3NhZ2UiLCJTVEFUVVNfQ09ERVMiLCJzdGF0dXMiLCJfbWF4UmV0cmllcyIsImxpc3RlbmVycyIsIl9pc0hvc3QiLCJvYmplY3QiLCJfY3JlYXRlU2l6ZUVycm9yIiwiZGVzdHJveWVkIiwiZGVzdHJveSIsImJvZHkiLCJmaWxlcyIsIl9lbmQiLCJfc2l6ZUVycm9yRXJyb3IiLCJfc2V0VGltZW91dHMiLCJfaGVhZGVyU2VudCIsImNvbnRlbnRUeXBlIiwiZ2V0SGVhZGVyIiwiX3NlcmlhbGl6ZXIiLCJpc0pTT04iLCJfcmVzcG9uc2VUaW1lb3V0VGltZXIiLCJtYXgiLCJ0b0xvd2VyQ2FzZSIsInRyaW0iLCJtdWx0aXBhcnQiLCJyZWRpcmVjdCIsInJlc3BvbnNlVHlwZSIsIl9yZXNwb25zZVR5cGUiLCJwYXJzZXIiLCJfcGFyc2VyIiwiY29uc29sZSIsIndhcm4iLCJpbWFnZSIsImZvcm0iLCJicmlkZ2VTdHJlYW0iLCJQYXNzVGhyb3VnaCIsImh0dHBWZXJzaW9uIiwic29ja2V0IiwicmVhZGFibGUiLCJmaWVsZHMiLCJmbGF0dGVuZWRGaWVsZHMiLCJBcnJheSIsImlzQXJyYXkiLCJmbGF0dGVuZWRGaWxlcyIsImlzQmluYXJ5IiwidGV4dCIsImlzVGV4dCIsIl9yZXNCdWZmZXJlZCIsInBhcnNlckhhbmRsZXNFbmQiLCJyZXNwb25zZUJ5dGVzIiwibWF4UmVzcG9uc2VTaXplIiwiX21heFJlc3BvbnNlU2l6ZSIsImJ1ZiIsInRpbWVkb3V0IiwiZ2V0UHJvZ3Jlc3NNb25pdG9yIiwibGVuZ3RoQ29tcHV0YWJsZSIsInRvdGFsIiwibWF4UmVxdWVzdFNpemUiLCJsb2FkZWQiLCJwcm9ncmVzcyIsIlRyYW5zZm9ybSIsIl90cmFuc2Zvcm0iLCJjaHVuayIsImRpcmVjdGlvbiIsImJ1ZmZlclRvQ2h1bmtzIiwiY2h1bmtTaXplIiwiY2h1bmtpbmciLCJSZWFkYWJsZSIsInRvdGFsTGVuZ3RoIiwicmVtYWluZGVyIiwiY3V0b2ZmIiwiaSIsInNsaWNlIiwicmVtYWluZGVyQnVmZmVyIiwiZ2V0TGVuZ3RoIiwiaGFzTm9uRW1wdHlSZXNwb25zZUNvbnRlbnQiLCJjb25uZWN0IiwiY29ubmVjdE92ZXJyaWRlIiwidHJ1c3RMb2NhbGhvc3QiLCJ0b2dnbGUiLCJuYW1lIiwidG9VcHBlckNhc2UiLCJzZW5kIiwicGFydHMiLCJzdWJ0eXBlIiwicmVnaXN0cnkiXSwic291cmNlcyI6WyIuLi8uLi9zcmMvbm9kZS9pbmRleC5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogTW9kdWxlIGRlcGVuZGVuY2llcy5cclxuICovXHJcblxyXG5jb25zdCB7IGZvcm1hdCB9ID0gcmVxdWlyZSgndXJsJyk7XHJcbmNvbnN0IFN0cmVhbSA9IHJlcXVpcmUoJ3N0cmVhbScpO1xyXG5jb25zdCBodHRwcyA9IHJlcXVpcmUoJ2h0dHBzJyk7XHJcbmNvbnN0IGh0dHAgPSByZXF1aXJlKCdodHRwJyk7XHJcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKTtcclxuY29uc3QgemxpYiA9IHJlcXVpcmUoJ3psaWInKTtcclxuY29uc3QgdXRpbCA9IHJlcXVpcmUoJ3V0aWwnKTtcclxuY29uc3QgcXMgPSByZXF1aXJlKCdxcycpO1xyXG5jb25zdCBtaW1lID0gcmVxdWlyZSgnbWltZScpO1xyXG5sZXQgbWV0aG9kcyA9IHJlcXVpcmUoJ21ldGhvZHMnKTtcclxuY29uc3QgRm9ybURhdGEgPSByZXF1aXJlKCdmb3JtLWRhdGEnKTtcclxuY29uc3QgZm9ybWlkYWJsZSA9IHJlcXVpcmUoJ2Zvcm1pZGFibGUnKTtcclxuY29uc3QgZGVidWcgPSByZXF1aXJlKCdkZWJ1ZycpKCdzdXBlcmFnZW50Jyk7XHJcbmNvbnN0IENvb2tpZUphciA9IHJlcXVpcmUoJ2Nvb2tpZWphcicpO1xyXG5jb25zdCBzYWZlU3RyaW5naWZ5ID0gcmVxdWlyZSgnZmFzdC1zYWZlLXN0cmluZ2lmeScpO1xyXG5cclxuY29uc3QgdXRpbHMgPSByZXF1aXJlKCcuLi91dGlscycpO1xyXG5jb25zdCBSZXF1ZXN0QmFzZSA9IHJlcXVpcmUoJy4uL3JlcXVlc3QtYmFzZScpO1xyXG5jb25zdCBodHRwMiA9IHJlcXVpcmUoJy4vaHR0cDJ3cmFwcGVyJyk7XHJcbmNvbnN0IHsgZGVjb21wcmVzcyB9ID0gcmVxdWlyZSgnLi91bnppcCcpO1xyXG5jb25zdCBSZXNwb25zZSA9IHJlcXVpcmUoJy4vcmVzcG9uc2UnKTtcclxuXHJcbmNvbnN0IHsgbWl4aW4sIGhhc093biwgaXNCcm90bGlFbmNvZGluZywgaXNHemlwT3JEZWZsYXRlRW5jb2RpbmcgfSA9IHV0aWxzO1xyXG5jb25zdCB7IGNob29zZURlY29tcHJlc3NlciB9ID0gcmVxdWlyZSgnLi9kZWNvbXByZXNzJyk7XHJcblxyXG5mdW5jdGlvbiByZXF1ZXN0KG1ldGhvZCwgdXJsKSB7XHJcbiAgLy8gY2FsbGJhY2tcclxuICBpZiAodHlwZW9mIHVybCA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgcmV0dXJuIG5ldyBleHBvcnRzLlJlcXVlc3QoJ0dFVCcsIG1ldGhvZCkuZW5kKHVybCk7XHJcbiAgfVxyXG5cclxuICAvLyB1cmwgZmlyc3RcclxuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSkge1xyXG4gICAgcmV0dXJuIG5ldyBleHBvcnRzLlJlcXVlc3QoJ0dFVCcsIG1ldGhvZCk7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gbmV3IGV4cG9ydHMuUmVxdWVzdChtZXRob2QsIHVybCk7XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gcmVxdWVzdDtcclxuZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzO1xyXG5cclxuLyoqXHJcbiAqIEV4cG9zZSBgUmVxdWVzdGAuXHJcbiAqL1xyXG5cclxuZXhwb3J0cy5SZXF1ZXN0ID0gUmVxdWVzdDtcclxuXHJcbi8qKlxyXG4gKiBFeHBvc2UgdGhlIGFnZW50IGZ1bmN0aW9uXHJcbiAqL1xyXG5cclxuZXhwb3J0cy5hZ2VudCA9IHJlcXVpcmUoJy4vYWdlbnQnKTtcclxuXHJcbi8qKlxyXG4gKiBOb29wLlxyXG4gKi9cclxuXHJcbmZ1bmN0aW9uIG5vb3AoKSB7fVxyXG5cclxuLyoqXHJcbiAqIEV4cG9zZSBgUmVzcG9uc2VgLlxyXG4gKi9cclxuXHJcbmV4cG9ydHMuUmVzcG9uc2UgPSBSZXNwb25zZTtcclxuXHJcbi8qKlxyXG4gKiBEZWZpbmUgXCJmb3JtXCIgbWltZSB0eXBlLlxyXG4gKi9cclxuXHJcbm1pbWUuZGVmaW5lKFxyXG4gIHtcclxuICAgICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnOiBbJ2Zvcm0nLCAndXJsZW5jb2RlZCcsICdmb3JtLWRhdGEnXVxyXG4gIH0sXHJcbiAgdHJ1ZVxyXG4pO1xyXG5cclxuLyoqXHJcbiAqIFByb3RvY29sIG1hcC5cclxuICovXHJcblxyXG5leHBvcnRzLnByb3RvY29scyA9IHtcclxuICAnaHR0cDonOiBodHRwLFxyXG4gICdodHRwczonOiBodHRwcyxcclxuICAnaHR0cDI6JzogaHR0cDJcclxufTtcclxuXHJcbi8qKlxyXG4gKiBEZWZhdWx0IHNlcmlhbGl6YXRpb24gbWFwLlxyXG4gKlxyXG4gKiAgICAgc3VwZXJhZ2VudC5zZXJpYWxpemVbJ2FwcGxpY2F0aW9uL3htbCddID0gZnVuY3Rpb24ob2JqKXtcclxuICogICAgICAgcmV0dXJuICdnZW5lcmF0ZWQgeG1sIGhlcmUnO1xyXG4gKiAgICAgfTtcclxuICpcclxuICovXHJcblxyXG5leHBvcnRzLnNlcmlhbGl6ZSA9IHtcclxuICAnYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJzogKG9iaikgPT4ge1xyXG4gICAgcmV0dXJuIHFzLnN0cmluZ2lmeShvYmosIHsgaW5kaWNlczogZmFsc2UsIHN0cmljdE51bGxIYW5kbGluZzogdHJ1ZSB9KTtcclxuICB9LFxyXG4gICdhcHBsaWNhdGlvbi9qc29uJzogc2FmZVN0cmluZ2lmeVxyXG59O1xyXG5cclxuLyoqXHJcbiAqIERlZmF1bHQgcGFyc2Vycy5cclxuICpcclxuICogICAgIHN1cGVyYWdlbnQucGFyc2VbJ2FwcGxpY2F0aW9uL3htbCddID0gZnVuY3Rpb24ocmVzLCBmbil7XHJcbiAqICAgICAgIGZuKG51bGwsIHJlcyk7XHJcbiAqICAgICB9O1xyXG4gKlxyXG4gKi9cclxuXHJcbmV4cG9ydHMucGFyc2UgPSByZXF1aXJlKCcuL3BhcnNlcnMnKTtcclxuXHJcbi8qKlxyXG4gKiBEZWZhdWx0IGJ1ZmZlcmluZyBtYXAuIENhbiBiZSB1c2VkIHRvIHNldCBjZXJ0YWluXHJcbiAqIHJlc3BvbnNlIHR5cGVzIHRvIGJ1ZmZlci9ub3QgYnVmZmVyLlxyXG4gKlxyXG4gKiAgICAgc3VwZXJhZ2VudC5idWZmZXJbJ2FwcGxpY2F0aW9uL3htbCddID0gdHJ1ZTtcclxuICovXHJcbmV4cG9ydHMuYnVmZmVyID0ge307XHJcblxyXG4vKipcclxuICogSW5pdGlhbGl6ZSBpbnRlcm5hbCBoZWFkZXIgdHJhY2tpbmcgcHJvcGVydGllcyBvbiBhIHJlcXVlc3QgaW5zdGFuY2UuXHJcbiAqXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSByZXEgdGhlIGluc3RhbmNlXHJcbiAqIEBhcGkgcHJpdmF0ZVxyXG4gKi9cclxuZnVuY3Rpb24gX2luaXRIZWFkZXJzKHJlcXVlc3RfKSB7XHJcbiAgcmVxdWVzdF8uX2hlYWRlciA9IHtcclxuICAgIC8vIGNvZXJjZXMgaGVhZGVyIG5hbWVzIHRvIGxvd2VyY2FzZVxyXG4gIH07XHJcbiAgcmVxdWVzdF8uaGVhZGVyID0ge1xyXG4gICAgLy8gcHJlc2VydmVzIGhlYWRlciBuYW1lIGNhc2VcclxuICB9O1xyXG59XHJcblxyXG4vKipcclxuICogSW5pdGlhbGl6ZSBhIG5ldyBgUmVxdWVzdGAgd2l0aCB0aGUgZ2l2ZW4gYG1ldGhvZGAgYW5kIGB1cmxgLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gbWV0aG9kXHJcbiAqIEBwYXJhbSB7U3RyaW5nfE9iamVjdH0gdXJsXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuZnVuY3Rpb24gUmVxdWVzdChtZXRob2QsIHVybCkge1xyXG4gIFN0cmVhbS5jYWxsKHRoaXMpO1xyXG4gIGlmICh0eXBlb2YgdXJsICE9PSAnc3RyaW5nJykgdXJsID0gZm9ybWF0KHVybCk7XHJcbiAgdGhpcy5fZW5hYmxlSHR0cDIgPSBCb29sZWFuKHByb2Nlc3MuZW52LkhUVFAyX1RFU1QpOyAvLyBpbnRlcm5hbCBvbmx5XHJcbiAgdGhpcy5fYWdlbnQgPSBmYWxzZTtcclxuICB0aGlzLl9mb3JtRGF0YSA9IG51bGw7XHJcbiAgdGhpcy5tZXRob2QgPSBtZXRob2Q7XHJcbiAgdGhpcy51cmwgPSB1cmw7XHJcbiAgX2luaXRIZWFkZXJzKHRoaXMpO1xyXG4gIHRoaXMud3JpdGFibGUgPSB0cnVlO1xyXG4gIHRoaXMuX3JlZGlyZWN0cyA9IDA7XHJcbiAgdGhpcy5yZWRpcmVjdHMobWV0aG9kID09PSAnSEVBRCcgPyAwIDogNSk7XHJcbiAgdGhpcy5jb29raWVzID0gJyc7XHJcbiAgdGhpcy5xcyA9IHt9O1xyXG4gIHRoaXMuX3F1ZXJ5ID0gW107XHJcbiAgdGhpcy5xc1JhdyA9IHRoaXMuX3F1ZXJ5OyAvLyBVbnVzZWQsIGZvciBiYWNrd2FyZHMgY29tcGF0aWJpbGl0eSBvbmx5XHJcbiAgdGhpcy5fcmVkaXJlY3RMaXN0ID0gW107XHJcbiAgdGhpcy5fc3RyZWFtUmVxdWVzdCA9IGZhbHNlO1xyXG4gIHRoaXMuX2xvb2t1cCA9IHVuZGVmaW5lZDtcclxuICB0aGlzLm9uY2UoJ2VuZCcsIHRoaXMuY2xlYXJUaW1lb3V0LmJpbmQodGhpcykpO1xyXG59XHJcblxyXG4vKipcclxuICogSW5oZXJpdCBmcm9tIGBTdHJlYW1gICh3aGljaCBpbmhlcml0cyBmcm9tIGBFdmVudEVtaXR0ZXJgKS5cclxuICogTWl4aW4gYFJlcXVlc3RCYXNlYC5cclxuICovXHJcbnV0aWwuaW5oZXJpdHMoUmVxdWVzdCwgU3RyZWFtKTtcclxuXHJcbm1peGluKFJlcXVlc3QucHJvdG90eXBlLCBSZXF1ZXN0QmFzZS5wcm90b3R5cGUpO1xyXG5cclxuLyoqXHJcbiAqIEVuYWJsZSBvciBEaXNhYmxlIGh0dHAyLlxyXG4gKlxyXG4gKiBFbmFibGUgaHR0cDIuXHJcbiAqXHJcbiAqIGBgYCBqc1xyXG4gKiByZXF1ZXN0LmdldCgnaHR0cDovL2xvY2FsaG9zdC8nKVxyXG4gKiAgIC5odHRwMigpXHJcbiAqICAgLmVuZChjYWxsYmFjayk7XHJcbiAqXHJcbiAqIHJlcXVlc3QuZ2V0KCdodHRwOi8vbG9jYWxob3N0LycpXHJcbiAqICAgLmh0dHAyKHRydWUpXHJcbiAqICAgLmVuZChjYWxsYmFjayk7XHJcbiAqIGBgYFxyXG4gKlxyXG4gKiBEaXNhYmxlIGh0dHAyLlxyXG4gKlxyXG4gKiBgYGAganNcclxuICogcmVxdWVzdCA9IHJlcXVlc3QuaHR0cDIoKTtcclxuICogcmVxdWVzdC5nZXQoJ2h0dHA6Ly9sb2NhbGhvc3QvJylcclxuICogICAuaHR0cDIoZmFsc2UpXHJcbiAqICAgLmVuZChjYWxsYmFjayk7XHJcbiAqIGBgYFxyXG4gKlxyXG4gKiBAcGFyYW0ge0Jvb2xlYW59IGVuYWJsZVxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS5odHRwMiA9IGZ1bmN0aW9uIChib29sKSB7XHJcbiAgaWYgKGV4cG9ydHMucHJvdG9jb2xzWydodHRwMjonXSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoXHJcbiAgICAgICdzdXBlcmFnZW50OiB0aGlzIHZlcnNpb24gb2YgTm9kZS5qcyBkb2VzIG5vdCBzdXBwb3J0IGh0dHAyJ1xyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHRoaXMuX2VuYWJsZUh0dHAyID0gYm9vbCA9PT0gdW5kZWZpbmVkID8gdHJ1ZSA6IGJvb2w7XHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG4vKipcclxuICogUXVldWUgdGhlIGdpdmVuIGBmaWxlYCBhcyBhbiBhdHRhY2htZW50IHRvIHRoZSBzcGVjaWZpZWQgYGZpZWxkYCxcclxuICogd2l0aCBvcHRpb25hbCBgb3B0aW9uc2AgKG9yIGZpbGVuYW1lKS5cclxuICpcclxuICogYGBgIGpzXHJcbiAqIHJlcXVlc3QucG9zdCgnaHR0cDovL2xvY2FsaG9zdC91cGxvYWQnKVxyXG4gKiAgIC5hdHRhY2goJ2ZpZWxkJywgQnVmZmVyLmZyb20oJzxiPkhlbGxvIHdvcmxkPC9iPicpLCAnaGVsbG8uaHRtbCcpXHJcbiAqICAgLmVuZChjYWxsYmFjayk7XHJcbiAqIGBgYFxyXG4gKlxyXG4gKiBBIGZpbGVuYW1lIG1heSBhbHNvIGJlIHVzZWQ6XHJcbiAqXHJcbiAqIGBgYCBqc1xyXG4gKiByZXF1ZXN0LnBvc3QoJ2h0dHA6Ly9sb2NhbGhvc3QvdXBsb2FkJylcclxuICogICAuYXR0YWNoKCdmaWxlcycsICdpbWFnZS5qcGcnKVxyXG4gKiAgIC5lbmQoY2FsbGJhY2spO1xyXG4gKiBgYGBcclxuICpcclxuICogQHBhcmFtIHtTdHJpbmd9IGZpZWxkXHJcbiAqIEBwYXJhbSB7U3RyaW5nfGZzLlJlYWRTdHJlYW18QnVmZmVyfSBmaWxlXHJcbiAqIEBwYXJhbSB7U3RyaW5nfE9iamVjdH0gb3B0aW9uc1xyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS5hdHRhY2ggPSBmdW5jdGlvbiAoZmllbGQsIGZpbGUsIG9wdGlvbnMpIHtcclxuICBpZiAoZmlsZSkge1xyXG4gICAgaWYgKHRoaXMuX2RhdGEpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3VwZXJhZ2VudCBjYW4ndCBtaXggLnNlbmQoKSBhbmQgLmF0dGFjaCgpXCIpO1xyXG4gICAgfVxyXG5cclxuICAgIGxldCBvID0gb3B0aW9ucyB8fCB7fTtcclxuICAgIGlmICh0eXBlb2Ygb3B0aW9ucyA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgbyA9IHsgZmlsZW5hbWU6IG9wdGlvbnMgfTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodHlwZW9mIGZpbGUgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgIGlmICghby5maWxlbmFtZSkgby5maWxlbmFtZSA9IGZpbGU7XHJcbiAgICAgIGRlYnVnKCdjcmVhdGluZyBgZnMuUmVhZFN0cmVhbWAgaW5zdGFuY2UgZm9yIGZpbGU6ICVzJywgZmlsZSk7XHJcbiAgICAgIGZpbGUgPSBmcy5jcmVhdGVSZWFkU3RyZWFtKGZpbGUpO1xyXG4gICAgICBmaWxlLm9uKCdlcnJvcicsIChlcnJvcikgPT4ge1xyXG4gICAgICAgIGNvbnN0IGZvcm1EYXRhID0gdGhpcy5fZ2V0Rm9ybURhdGEoKTtcclxuICAgICAgICBmb3JtRGF0YS5lbWl0KCdlcnJvcicsIGVycm9yKTtcclxuICAgICAgfSk7XHJcbiAgICB9IGVsc2UgaWYgKCFvLmZpbGVuYW1lICYmIGZpbGUucGF0aCkge1xyXG4gICAgICBvLmZpbGVuYW1lID0gZmlsZS5wYXRoO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuX2dldEZvcm1EYXRhKCkuYXBwZW5kKGZpZWxkLCBmaWxlLCBvKTtcclxuICB9XHJcblxyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuX2dldEZvcm1EYXRhID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICghdGhpcy5fZm9ybURhdGEpIHtcclxuICAgIHRoaXMuX2Zvcm1EYXRhID0gbmV3IEZvcm1EYXRhKCk7XHJcbiAgICB0aGlzLl9mb3JtRGF0YS5vbignZXJyb3InLCAoZXJyb3IpID0+IHtcclxuICAgICAgZGVidWcoJ0Zvcm1EYXRhIGVycm9yJywgZXJyb3IpO1xyXG4gICAgICBpZiAodGhpcy5jYWxsZWQpIHtcclxuICAgICAgICAvLyBUaGUgcmVxdWVzdCBoYXMgYWxyZWFkeSBmaW5pc2hlZCBhbmQgdGhlIGNhbGxiYWNrIHdhcyBjYWxsZWQuXHJcbiAgICAgICAgLy8gU2lsZW50bHkgaWdub3JlIHRoZSBlcnJvci5cclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRoaXMuY2FsbGJhY2soZXJyb3IpO1xyXG4gICAgICB0aGlzLmFib3J0KCk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHJldHVybiB0aGlzLl9mb3JtRGF0YTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBHZXRzL3NldHMgdGhlIGBBZ2VudGAgdG8gdXNlIGZvciB0aGlzIEhUVFAgcmVxdWVzdC4gVGhlIGRlZmF1bHQgKGlmIHRoaXNcclxuICogZnVuY3Rpb24gaXMgbm90IGNhbGxlZCkgaXMgdG8gb3B0IG91dCBvZiBjb25uZWN0aW9uIHBvb2xpbmcgKGBhZ2VudDogZmFsc2VgKS5cclxuICpcclxuICogQHBhcmFtIHtodHRwLkFnZW50fSBhZ2VudFxyXG4gKiBAcmV0dXJuIHtodHRwLkFnZW50fVxyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3QucHJvdG90eXBlLmFnZW50ID0gZnVuY3Rpb24gKGFnZW50KSB7XHJcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApIHJldHVybiB0aGlzLl9hZ2VudDtcclxuICB0aGlzLl9hZ2VudCA9IGFnZW50O1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEdldHMvc2V0cyB0aGUgYGxvb2t1cGAgZnVuY3Rpb24gdG8gdXNlIGN1c3RvbSBETlMgcmVzb2x2ZXIuXHJcbiAqXHJcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGxvb2t1cFxyXG4gKiBAcmV0dXJuIHtGdW5jdGlvbn1cclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS5sb29rdXAgPSBmdW5jdGlvbiAobG9va3VwKSB7XHJcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApIHJldHVybiB0aGlzLl9sb29rdXA7XHJcbiAgdGhpcy5fbG9va3VwID0gbG9va3VwO1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFNldCBfQ29udGVudC1UeXBlXyByZXNwb25zZSBoZWFkZXIgcGFzc2VkIHRocm91Z2ggYG1pbWUuZ2V0VHlwZSgpYC5cclxuICpcclxuICogRXhhbXBsZXM6XHJcbiAqXHJcbiAqICAgICAgcmVxdWVzdC5wb3N0KCcvJylcclxuICogICAgICAgIC50eXBlKCd4bWwnKVxyXG4gKiAgICAgICAgLnNlbmQoeG1sc3RyaW5nKVxyXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XHJcbiAqXHJcbiAqICAgICAgcmVxdWVzdC5wb3N0KCcvJylcclxuICogICAgICAgIC50eXBlKCdqc29uJylcclxuICogICAgICAgIC5zZW5kKGpzb25zdHJpbmcpXHJcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcclxuICpcclxuICogICAgICByZXF1ZXN0LnBvc3QoJy8nKVxyXG4gKiAgICAgICAgLnR5cGUoJ2FwcGxpY2F0aW9uL2pzb24nKVxyXG4gKiAgICAgICAgLnNlbmQoanNvbnN0cmluZylcclxuICogICAgICAgIC5lbmQoY2FsbGJhY2spO1xyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gdHlwZVxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS50eXBlID0gZnVuY3Rpb24gKHR5cGUpIHtcclxuICByZXR1cm4gdGhpcy5zZXQoXHJcbiAgICAnQ29udGVudC1UeXBlJyxcclxuICAgIHR5cGUuaW5jbHVkZXMoJy8nKSA/IHR5cGUgOiBtaW1lLmdldFR5cGUodHlwZSlcclxuICApO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFNldCBfQWNjZXB0XyByZXNwb25zZSBoZWFkZXIgcGFzc2VkIHRocm91Z2ggYG1pbWUuZ2V0VHlwZSgpYC5cclxuICpcclxuICogRXhhbXBsZXM6XHJcbiAqXHJcbiAqICAgICAgc3VwZXJhZ2VudC50eXBlcy5qc29uID0gJ2FwcGxpY2F0aW9uL2pzb24nO1xyXG4gKlxyXG4gKiAgICAgIHJlcXVlc3QuZ2V0KCcvYWdlbnQnKVxyXG4gKiAgICAgICAgLmFjY2VwdCgnanNvbicpXHJcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcclxuICpcclxuICogICAgICByZXF1ZXN0LmdldCgnL2FnZW50JylcclxuICogICAgICAgIC5hY2NlcHQoJ2FwcGxpY2F0aW9uL2pzb24nKVxyXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBhY2NlcHRcclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuYWNjZXB0ID0gZnVuY3Rpb24gKHR5cGUpIHtcclxuICByZXR1cm4gdGhpcy5zZXQoJ0FjY2VwdCcsIHR5cGUuaW5jbHVkZXMoJy8nKSA/IHR5cGUgOiBtaW1lLmdldFR5cGUodHlwZSkpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEFkZCBxdWVyeS1zdHJpbmcgYHZhbGAuXHJcbiAqXHJcbiAqIEV4YW1wbGVzOlxyXG4gKlxyXG4gKiAgIHJlcXVlc3QuZ2V0KCcvc2hvZXMnKVxyXG4gKiAgICAgLnF1ZXJ5KCdzaXplPTEwJylcclxuICogICAgIC5xdWVyeSh7IGNvbG9yOiAnYmx1ZScgfSlcclxuICpcclxuICogQHBhcmFtIHtPYmplY3R8U3RyaW5nfSB2YWxcclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUucXVlcnkgPSBmdW5jdGlvbiAodmFsdWUpIHtcclxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xyXG4gICAgdGhpcy5fcXVlcnkucHVzaCh2YWx1ZSk7XHJcbiAgfSBlbHNlIHtcclxuICAgIE9iamVjdC5hc3NpZ24odGhpcy5xcywgdmFsdWUpO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG4vKipcclxuICogV3JpdGUgcmF3IGBkYXRhYCAvIGBlbmNvZGluZ2AgdG8gdGhlIHNvY2tldC5cclxuICpcclxuICogQHBhcmFtIHtCdWZmZXJ8U3RyaW5nfSBkYXRhXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBlbmNvZGluZ1xyXG4gKiBAcmV0dXJuIHtCb29sZWFufVxyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3QucHJvdG90eXBlLndyaXRlID0gZnVuY3Rpb24gKGRhdGEsIGVuY29kaW5nKSB7XHJcbiAgY29uc3QgcmVxdWVzdF8gPSB0aGlzLnJlcXVlc3QoKTtcclxuICBpZiAoIXRoaXMuX3N0cmVhbVJlcXVlc3QpIHtcclxuICAgIHRoaXMuX3N0cmVhbVJlcXVlc3QgPSB0cnVlO1xyXG4gIH1cclxuXHJcbiAgaWYgKHRoaXMuaGFzU2l6ZUVycm9yKCkpIHJldHVybiBmYWxzZTtcclxuXHJcbiAgdGhpcy5fcmVxdWVzdEJ5dGVzID0gKHRoaXMuX3JlcXVlc3RCeXRlcyB8fCAwKSArIHV0aWxzLmJ5dGVMZW5ndGgoZGF0YSwgZW5jb2RpbmcpO1xyXG4gIGlmIChcclxuICAgIHRoaXMuX21heFJlcXVlc3RTaXplICE9PSB1bmRlZmluZWQgJiZcclxuICAgIHRoaXMuX3JlcXVlc3RCeXRlcyA+IHRoaXMuX21heFJlcXVlc3RTaXplXHJcbiAgKSB7XHJcbiAgICB0aGlzLl9mYWlsUmVxdWVzdFNpemUoKTtcclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcblxyXG4gIHJldHVybiByZXF1ZXN0Xy53cml0ZShkYXRhLCBlbmNvZGluZyk7XHJcbn07XHJcblxyXG4vKipcclxuICogUGlwZSB0aGUgcmVxdWVzdCBib2R5IHRvIGBzdHJlYW1gLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmVhbX0gc3RyZWFtXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zXHJcbiAqIEByZXR1cm4ge1N0cmVhbX1cclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS5waXBlID0gZnVuY3Rpb24gKHN0cmVhbSwgb3B0aW9ucykge1xyXG4gIHRoaXMucGlwZWQgPSB0cnVlOyAvLyBIQUNLLi4uXHJcbiAgdGhpcy5idWZmZXIoZmFsc2UpO1xyXG4gIHRoaXMuZW5kKCk7XHJcbiAgcmV0dXJuIHRoaXMuX3BpcGVDb250aW51ZShzdHJlYW0sIG9wdGlvbnMpO1xyXG59O1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuX3BpcGVDb250aW51ZSA9IGZ1bmN0aW9uIChzdHJlYW0sIG9wdGlvbnMpIHtcclxuICB0aGlzLnJlcS5vbmNlKCdyZXNwb25zZScsIChyZXMpID0+IHtcclxuICAgIC8vIHJlZGlyZWN0XHJcbiAgICBpZiAoXHJcbiAgICAgIGlzUmVkaXJlY3QocmVzLnN0YXR1c0NvZGUpICYmXHJcbiAgICAgIHRoaXMuX3JlZGlyZWN0cysrICE9PSB0aGlzLl9tYXhSZWRpcmVjdHNcclxuICAgICkge1xyXG4gICAgICByZXR1cm4gdGhpcy5fcmVkaXJlY3QocmVzKSA9PT0gdGhpc1xyXG4gICAgICAgID8gdGhpcy5fcGlwZUNvbnRpbnVlKHN0cmVhbSwgb3B0aW9ucylcclxuICAgICAgICA6IHVuZGVmaW5lZDtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLnJlcyA9IHJlcztcclxuICAgIHRoaXMuX2VtaXRSZXNwb25zZSgpO1xyXG4gICAgaWYgKHRoaXMuX2Fib3J0ZWQpIHJldHVybjtcclxuXHJcbiAgICBpZiAodGhpcy5fc2hvdWxkRGVjb21wcmVzcyhyZXMpKSB7XHJcblxyXG4gICAgICBsZXQgZGVjb21wcmVzc2VyID0gY2hvb3NlRGVjb21wcmVzc2VyKHJlcyk7XHJcblxyXG4gICAgICBkZWNvbXByZXNzZXIub24oJ2Vycm9yJywgKGVycm9yKSA9PiB7XHJcbiAgICAgICAgaWYgKGVycm9yICYmIGVycm9yLmNvZGUgPT09ICdaX0JVRl9FUlJPUicpIHtcclxuICAgICAgICAgIC8vIHVuZXhwZWN0ZWQgZW5kIG9mIGZpbGUgaXMgaWdub3JlZCBieSBicm93c2VycyBhbmQgY3VybFxyXG4gICAgICAgICAgc3RyZWFtLmVtaXQoJ2VuZCcpO1xyXG4gICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgc3RyZWFtLmVtaXQoJ2Vycm9yJywgZXJyb3IpO1xyXG4gICAgICB9KTtcclxuICAgICAgcmVzLnBpcGUoZGVjb21wcmVzc2VyKS5waXBlKHN0cmVhbSwgb3B0aW9ucyk7XHJcbiAgICAgIC8vIGRvbid0IGVtaXQgJ2VuZCcgdW50aWwgZGVjb21wcmVzc2VyIGhhcyBjb21wbGV0ZWQgd3JpdGluZyBhbGwgaXRzIGRhdGEuXHJcbiAgICAgIGRlY29tcHJlc3Nlci5vbmNlKCdlbmQnLCAoKSA9PiB0aGlzLmVtaXQoJ2VuZCcpKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHJlcy5waXBlKHN0cmVhbSwgb3B0aW9ucyk7XHJcbiAgICAgIHJlcy5vbmNlKCdlbmQnLCAoKSA9PiB0aGlzLmVtaXQoJ2VuZCcpKTtcclxuICAgIH1cclxuICB9KTtcclxuICByZXR1cm4gc3RyZWFtO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEVuYWJsZSAvIGRpc2FibGUgYnVmZmVyaW5nLlxyXG4gKlxyXG4gKiBAcmV0dXJuIHtCb29sZWFufSBbdmFsXVxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS5idWZmZXIgPSBmdW5jdGlvbiAodmFsdWUpIHtcclxuICB0aGlzLl9idWZmZXIgPSB2YWx1ZSAhPT0gZmFsc2U7XHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG4vKipcclxuICogUmVkaXJlY3QgdG8gYHVybFxyXG4gKlxyXG4gKiBAcGFyYW0ge0luY29taW5nTWVzc2FnZX0gcmVzXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHByaXZhdGVcclxuICovXHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS5fcmVkaXJlY3QgPSBmdW5jdGlvbiAocmVzKSB7XHJcbiAgbGV0IHVybCA9IHJlcy5oZWFkZXJzLmxvY2F0aW9uO1xyXG4gIGlmICghdXJsKSB7XHJcbiAgICByZXR1cm4gdGhpcy5jYWxsYmFjayhuZXcgRXJyb3IoJ05vIGxvY2F0aW9uIGhlYWRlciBmb3IgcmVkaXJlY3QnKSwgcmVzKTtcclxuICB9XHJcblxyXG4gIGRlYnVnKCdyZWRpcmVjdCAlcyAtPiAlcycsIHRoaXMudXJsLCB1cmwpO1xyXG5cclxuICAvLyBsb2NhdGlvblxyXG4gIHVybCA9IG5ldyBVUkwodXJsLCB0aGlzLnVybCkuaHJlZjtcclxuXHJcbiAgLy8gZW5zdXJlIHRoZSByZXNwb25zZSBpcyBiZWluZyBjb25zdW1lZFxyXG4gIC8vIHRoaXMgaXMgcmVxdWlyZWQgZm9yIE5vZGUgdjAuMTArXHJcbiAgcmVzLnJlc3VtZSgpO1xyXG5cclxuICBsZXQgaGVhZGVycyA9IHRoaXMucmVxLmdldEhlYWRlcnMgPyB0aGlzLnJlcS5nZXRIZWFkZXJzKCkgOiB0aGlzLnJlcS5faGVhZGVycztcclxuXHJcbiAgY29uc3QgY2hhbmdlc09yaWdpbiA9IG5ldyBVUkwodXJsKS5ob3N0ICE9PSBuZXcgVVJMKHRoaXMudXJsKS5ob3N0O1xyXG5cclxuICAvLyBpbXBsZW1lbnRhdGlvbiBvZiAzMDIgZm9sbG93aW5nIGRlZmFjdG8gc3RhbmRhcmRcclxuICBpZiAocmVzLnN0YXR1c0NvZGUgPT09IDMwMSB8fCByZXMuc3RhdHVzQ29kZSA9PT0gMzAyKSB7XHJcbiAgICAvLyBzdHJpcCBDb250ZW50LSogcmVsYXRlZCBmaWVsZHNcclxuICAgIC8vIGluIGNhc2Ugb2YgUE9TVCBldGNcclxuICAgIGhlYWRlcnMgPSB1dGlscy5jbGVhbkhlYWRlcihoZWFkZXJzLCBjaGFuZ2VzT3JpZ2luKTtcclxuXHJcbiAgICAvLyBmb3JjZSBHRVRcclxuICAgIHRoaXMubWV0aG9kID0gdGhpcy5tZXRob2QgPT09ICdIRUFEJyA/ICdIRUFEJyA6ICdHRVQnO1xyXG5cclxuICAgIC8vIGNsZWFyIGRhdGFcclxuICAgIHRoaXMuX2RhdGEgPSBudWxsO1xyXG4gIH1cclxuXHJcbiAgLy8gMzAzIGlzIGFsd2F5cyBHRVRcclxuICBpZiAocmVzLnN0YXR1c0NvZGUgPT09IDMwMykge1xyXG4gICAgLy8gc3RyaXAgQ29udGVudC0qIHJlbGF0ZWQgZmllbGRzXHJcbiAgICAvLyBpbiBjYXNlIG9mIFBPU1QgZXRjXHJcbiAgICBoZWFkZXJzID0gdXRpbHMuY2xlYW5IZWFkZXIoaGVhZGVycywgY2hhbmdlc09yaWdpbik7XHJcblxyXG4gICAgLy8gZm9yY2UgbWV0aG9kXHJcbiAgICB0aGlzLm1ldGhvZCA9ICdHRVQnO1xyXG5cclxuICAgIC8vIGNsZWFyIGRhdGFcclxuICAgIHRoaXMuX2RhdGEgPSBudWxsO1xyXG4gIH1cclxuXHJcbiAgLy8gMzA3IHByZXNlcnZlcyBtZXRob2RcclxuICAvLyAzMDggcHJlc2VydmVzIG1ldGhvZFxyXG4gIGRlbGV0ZSBoZWFkZXJzLmhvc3Q7XHJcblxyXG4gIGRlbGV0ZSB0aGlzLnJlcTtcclxuICBkZWxldGUgdGhpcy5fZm9ybURhdGE7XHJcblxyXG4gIC8vIHJlbW92ZSBhbGwgYWRkIGhlYWRlciBleGNlcHQgVXNlci1BZ2VudFxyXG4gIF9pbml0SGVhZGVycyh0aGlzKTtcclxuXHJcbiAgLy8gcmVkaXJlY3RcclxuICB0aGlzLnJlcyA9IHJlcztcclxuICB0aGlzLl9lbmRDYWxsZWQgPSBmYWxzZTtcclxuICB0aGlzLnVybCA9IHVybDtcclxuICB0aGlzLnFzID0ge307XHJcbiAgdGhpcy5fcXVlcnkubGVuZ3RoID0gMDtcclxuICB0aGlzLnNldChoZWFkZXJzKTtcclxuICB0aGlzLl9lbWl0UmVkaXJlY3QoKTtcclxuICB0aGlzLl9yZWRpcmVjdExpc3QucHVzaCh0aGlzLnVybCk7XHJcbiAgdGhpcy5lbmQodGhpcy5fY2FsbGJhY2spO1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFNldCBBdXRob3JpemF0aW9uIGZpZWxkIHZhbHVlIHdpdGggYHVzZXJgIGFuZCBgcGFzc2AuXHJcbiAqXHJcbiAqIEV4YW1wbGVzOlxyXG4gKlxyXG4gKiAgIC5hdXRoKCd0b2JpJywgJ2xlYXJuYm9vc3QnKVxyXG4gKiAgIC5hdXRoKCd0b2JpOmxlYXJuYm9vc3QnKVxyXG4gKiAgIC5hdXRoKCd0b2JpJylcclxuICogICAuYXV0aChhY2Nlc3NUb2tlbiwgeyB0eXBlOiAnYmVhcmVyJyB9KVxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gdXNlclxyXG4gKiBAcGFyYW0ge1N0cmluZ30gW3Bhc3NdXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9uc10gb3B0aW9ucyB3aXRoIGF1dGhvcml6YXRpb24gdHlwZSAnYmFzaWMnIG9yICdiZWFyZXInICgnYmFzaWMnIGlzIGRlZmF1bHQpXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3QucHJvdG90eXBlLmF1dGggPSBmdW5jdGlvbiAodXNlciwgcGFzcywgb3B0aW9ucykge1xyXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAxKSBwYXNzID0gJyc7XHJcbiAgaWYgKHR5cGVvZiBwYXNzID09PSAnb2JqZWN0JyAmJiBwYXNzICE9PSBudWxsKSB7XHJcbiAgICAvLyBwYXNzIGlzIG9wdGlvbmFsIGFuZCBjYW4gYmUgcmVwbGFjZWQgd2l0aCBvcHRpb25zXHJcbiAgICBvcHRpb25zID0gcGFzcztcclxuICAgIHBhc3MgPSAnJztcclxuICB9XHJcblxyXG4gIGlmICghb3B0aW9ucykge1xyXG4gICAgb3B0aW9ucyA9IHsgdHlwZTogJ2Jhc2ljJyB9O1xyXG4gIH1cclxuXHJcbiAgY29uc3QgZW5jb2RlciA9IChzdHJpbmcpID0+IEJ1ZmZlci5mcm9tKHN0cmluZykudG9TdHJpbmcoJ2Jhc2U2NCcpO1xyXG5cclxuICByZXR1cm4gdGhpcy5fYXV0aCh1c2VyLCBwYXNzLCBvcHRpb25zLCBlbmNvZGVyKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBTZXQgdGhlIGNlcnRpZmljYXRlIGF1dGhvcml0eSBvcHRpb24gZm9yIGh0dHBzIHJlcXVlc3QuXHJcbiAqXHJcbiAqIEBwYXJhbSB7QnVmZmVyIHwgQXJyYXl9IGNlcnRcclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuY2EgPSBmdW5jdGlvbiAoY2VydCkge1xyXG4gIHRoaXMuX2NhID0gY2VydDtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBTZXQgdGhlIGNsaWVudCBjZXJ0aWZpY2F0ZSBrZXkgb3B0aW9uIGZvciBodHRwcyByZXF1ZXN0LlxyXG4gKlxyXG4gKiBAcGFyYW0ge0J1ZmZlciB8IFN0cmluZ30gY2VydFxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS5rZXkgPSBmdW5jdGlvbiAoY2VydCkge1xyXG4gIHRoaXMuX2tleSA9IGNlcnQ7XHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG4vKipcclxuICogU2V0IHRoZSBrZXksIGNlcnRpZmljYXRlLCBhbmQgQ0EgY2VydHMgb2YgdGhlIGNsaWVudCBpbiBQRlggb3IgUEtDUzEyIGZvcm1hdC5cclxuICpcclxuICogQHBhcmFtIHtCdWZmZXIgfCBTdHJpbmd9IGNlcnRcclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUucGZ4ID0gZnVuY3Rpb24gKGNlcnQpIHtcclxuICBpZiAodHlwZW9mIGNlcnQgPT09ICdvYmplY3QnICYmICFCdWZmZXIuaXNCdWZmZXIoY2VydCkpIHtcclxuICAgIHRoaXMuX3BmeCA9IGNlcnQucGZ4O1xyXG4gICAgdGhpcy5fcGFzc3BocmFzZSA9IGNlcnQucGFzc3BocmFzZTtcclxuICB9IGVsc2Uge1xyXG4gICAgdGhpcy5fcGZ4ID0gY2VydDtcclxuICB9XHJcblxyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFNldCB0aGUgY2xpZW50IGNlcnRpZmljYXRlIG9wdGlvbiBmb3IgaHR0cHMgcmVxdWVzdC5cclxuICpcclxuICogQHBhcmFtIHtCdWZmZXIgfCBTdHJpbmd9IGNlcnRcclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuY2VydCA9IGZ1bmN0aW9uIChjZXJ0KSB7XHJcbiAgdGhpcy5fY2VydCA9IGNlcnQ7XHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG4vKipcclxuICogRG8gbm90IHJlamVjdCBleHBpcmVkIG9yIGludmFsaWQgVExTIGNlcnRzLlxyXG4gKiBzZXRzIGByZWplY3RVbmF1dGhvcml6ZWQ9dHJ1ZWAuIEJlIHdhcm5lZCB0aGF0IHRoaXMgYWxsb3dzIE1JVE0gYXR0YWNrcy5cclxuICpcclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuZGlzYWJsZVRMU0NlcnRzID0gZnVuY3Rpb24gKCkge1xyXG4gIHRoaXMuX2Rpc2FibGVUTFNDZXJ0cyA9IHRydWU7XHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG4vKipcclxuICogUmV0dXJuIGFuIGh0dHBbc10gcmVxdWVzdC5cclxuICpcclxuICogQHJldHVybiB7T3V0Z29pbmdNZXNzYWdlfVxyXG4gKiBAYXBpIHByaXZhdGVcclxuICovXHJcblxyXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgY29tcGxleGl0eVxyXG5SZXF1ZXN0LnByb3RvdHlwZS5yZXF1ZXN0ID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0aGlzLnJlcSkgcmV0dXJuIHRoaXMucmVxO1xyXG5cclxuICBjb25zdCBvcHRpb25zID0ge307XHJcblxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBxdWVyeSA9IHFzLnN0cmluZ2lmeSh0aGlzLnFzLCB7XHJcbiAgICAgIGluZGljZXM6IGZhbHNlLFxyXG4gICAgICBzdHJpY3ROdWxsSGFuZGxpbmc6IHRydWVcclxuICAgIH0pO1xyXG4gICAgaWYgKHF1ZXJ5KSB7XHJcbiAgICAgIHRoaXMucXMgPSB7fTtcclxuICAgICAgdGhpcy5fcXVlcnkucHVzaChxdWVyeSk7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5fZmluYWxpemVRdWVyeVN0cmluZygpO1xyXG4gIH0gY2F0Y2ggKGVycikge1xyXG4gICAgcmV0dXJuIHRoaXMuZW1pdCgnZXJyb3InLCBlcnIpO1xyXG4gIH1cclxuXHJcbiAgbGV0IHsgdXJsOiB1cmxTdHJpbmcgfSA9IHRoaXM7XHJcbiAgY29uc3QgcmV0cmllcyA9IHRoaXMuX3JldHJpZXM7XHJcblxyXG4gIC8vIGRlZmF1bHQgdG8gaHR0cDovL1xyXG4gIGlmICh1cmxTdHJpbmcuaW5kZXhPZignaHR0cCcpICE9PSAwKSB1cmxTdHJpbmcgPSBgaHR0cDovLyR7dXJsU3RyaW5nfWA7XHJcbiAgY29uc3QgdXJsID0gbmV3IFVSTCh1cmxTdHJpbmcpO1xyXG4gIGxldCB7IHByb3RvY29sIH0gPSB1cmw7XHJcbiAgbGV0IHBhdGggPSBgJHt1cmwucGF0aG5hbWV9JHt1cmwuc2VhcmNofWA7XHJcblxyXG4gIC8vIHN1cHBvcnQgdW5peCBzb2NrZXRzXHJcbiAgaWYgKC9eaHR0cHM/XFwrdW5peDovLnRlc3QocHJvdG9jb2wpID09PSB0cnVlKSB7XHJcbiAgICAvLyBnZXQgdGhlIHByb3RvY29sXHJcbiAgICBwcm90b2NvbCA9IGAke3Byb3RvY29sLnNwbGl0KCcrJylbMF19OmA7XHJcblxyXG4gICAgLy8gZ2V0IHRoZSBzb2NrZXQgcGF0aFxyXG4gICAgb3B0aW9ucy5zb2NrZXRQYXRoID0gdXJsLmhvc3RuYW1lLnJlcGxhY2UoLyUyRi9nLCAnLycpO1xyXG4gICAgdXJsLmhvc3QgPSAnJztcclxuICAgIHVybC5ob3N0bmFtZSA9ICcnO1xyXG4gIH1cclxuXHJcbiAgLy8gT3ZlcnJpZGUgSVAgYWRkcmVzcyBvZiBhIGhvc3RuYW1lXHJcbiAgaWYgKHRoaXMuX2Nvbm5lY3RPdmVycmlkZSkge1xyXG4gICAgY29uc3QgeyBob3N0bmFtZSB9ID0gdXJsO1xyXG4gICAgY29uc3QgbWF0Y2ggPVxyXG4gICAgICBob3N0bmFtZSBpbiB0aGlzLl9jb25uZWN0T3ZlcnJpZGVcclxuICAgICAgICA/IHRoaXMuX2Nvbm5lY3RPdmVycmlkZVtob3N0bmFtZV1cclxuICAgICAgICA6IHRoaXMuX2Nvbm5lY3RPdmVycmlkZVsnKiddO1xyXG4gICAgaWYgKG1hdGNoKSB7XHJcbiAgICAgIC8vIGJhY2t1cCB0aGUgcmVhbCBob3N0XHJcbiAgICAgIGlmICghdGhpcy5faGVhZGVyLmhvc3QpIHtcclxuICAgICAgICB0aGlzLnNldCgnaG9zdCcsIHVybC5ob3N0KTtcclxuICAgICAgfVxyXG5cclxuICAgICAgbGV0IG5ld0hvc3Q7XHJcbiAgICAgIGxldCBuZXdQb3J0O1xyXG5cclxuICAgICAgaWYgKHR5cGVvZiBtYXRjaCA9PT0gJ29iamVjdCcpIHtcclxuICAgICAgICBuZXdIb3N0ID0gbWF0Y2guaG9zdDtcclxuICAgICAgICBuZXdQb3J0ID0gbWF0Y2gucG9ydDtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBuZXdIb3N0ID0gbWF0Y2g7XHJcbiAgICAgICAgbmV3UG9ydCA9IHVybC5wb3J0O1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyB3cmFwIFtpcHY2XVxyXG4gICAgICB1cmwuaG9zdCA9IC86Ly50ZXN0KG5ld0hvc3QpID8gYFske25ld0hvc3R9XWAgOiBuZXdIb3N0O1xyXG4gICAgICBpZiAobmV3UG9ydCkge1xyXG4gICAgICAgIHVybC5ob3N0ICs9IGA6JHtuZXdQb3J0fWA7XHJcbiAgICAgICAgdXJsLnBvcnQgPSBuZXdQb3J0O1xyXG4gICAgICB9XHJcblxyXG4gICAgICB1cmwuaG9zdG5hbWUgPSBuZXdIb3N0O1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gb3B0aW9uc1xyXG4gIG9wdGlvbnMubWV0aG9kID0gdGhpcy5tZXRob2Q7XHJcbiAgb3B0aW9ucy5wb3J0ID0gdXJsLnBvcnQ7XHJcbiAgb3B0aW9ucy5wYXRoID0gcGF0aDtcclxuICBvcHRpb25zLmhvc3QgPSB1dGlscy5ub3JtYWxpemVIb3N0bmFtZSh1cmwuaG9zdG5hbWUpOyAvLyBleDogWzo6MV0gLT4gOjoxXHJcbiAgb3B0aW9ucy5jYSA9IHRoaXMuX2NhO1xyXG4gIG9wdGlvbnMua2V5ID0gdGhpcy5fa2V5O1xyXG4gIG9wdGlvbnMucGZ4ID0gdGhpcy5fcGZ4O1xyXG4gIG9wdGlvbnMuY2VydCA9IHRoaXMuX2NlcnQ7XHJcbiAgb3B0aW9ucy5wYXNzcGhyYXNlID0gdGhpcy5fcGFzc3BocmFzZTtcclxuICBvcHRpb25zLmFnZW50ID0gdGhpcy5fYWdlbnQ7XHJcbiAgb3B0aW9ucy5sb29rdXAgPSB0aGlzLl9sb29rdXA7XHJcbiAgb3B0aW9ucy5yZWplY3RVbmF1dGhvcml6ZWQgPVxyXG4gICAgdHlwZW9mIHRoaXMuX2Rpc2FibGVUTFNDZXJ0cyA9PT0gJ2Jvb2xlYW4nXHJcbiAgICAgID8gIXRoaXMuX2Rpc2FibGVUTFNDZXJ0c1xyXG4gICAgICA6IHByb2Nlc3MuZW52Lk5PREVfVExTX1JFSkVDVF9VTkFVVEhPUklaRUQgIT09ICcwJztcclxuXHJcbiAgLy8gQWxsb3dzIHJlcXVlc3QuZ2V0KCdodHRwczovLzEuMi4zLjQvJykuc2V0KCdIb3N0JywgJ2V4YW1wbGUuY29tJylcclxuICBpZiAodGhpcy5faGVhZGVyLmhvc3QpIHtcclxuICAgIG9wdGlvbnMuc2VydmVybmFtZSA9IHRoaXMuX2hlYWRlci5ob3N0LnJlcGxhY2UoLzpcXGQrJC8sICcnKTtcclxuICB9XHJcblxyXG4gIGlmIChcclxuICAgIHRoaXMuX3RydXN0TG9jYWxob3N0ICYmXHJcbiAgICAvXig/OmxvY2FsaG9zdHwxMjdcXC4wXFwuMFxcLlxcZCt8KDAqOikrOjAqMSkkLy50ZXN0KHVybC5ob3N0bmFtZSlcclxuICApIHtcclxuICAgIG9wdGlvbnMucmVqZWN0VW5hdXRob3JpemVkID0gZmFsc2U7XHJcbiAgfVxyXG5cclxuICAvLyBpbml0aWF0ZSByZXF1ZXN0XHJcbiAgY29uc3QgbW9kdWxlXyA9IHRoaXMuX2VuYWJsZUh0dHAyXHJcbiAgICA/IGV4cG9ydHMucHJvdG9jb2xzWydodHRwMjonXS5zZXRQcm90b2NvbChwcm90b2NvbClcclxuICAgIDogZXhwb3J0cy5wcm90b2NvbHNbcHJvdG9jb2xdO1xyXG5cclxuICAvLyByZXF1ZXN0XHJcbiAgdGhpcy5yZXEgPSBtb2R1bGVfLnJlcXVlc3Qob3B0aW9ucyk7XHJcbiAgY29uc3QgeyByZXEgfSA9IHRoaXM7XHJcblxyXG4gIC8vIHNldCB0Y3Agbm8gZGVsYXlcclxuICByZXEuc2V0Tm9EZWxheSh0cnVlKTtcclxuXHJcbiAgaWYgKG9wdGlvbnMubWV0aG9kICE9PSAnSEVBRCcpIHtcclxuICAgIHJlcS5zZXRIZWFkZXIoJ0FjY2VwdC1FbmNvZGluZycsICdnemlwLCBkZWZsYXRlJyk7XHJcbiAgfVxyXG5cclxuICB0aGlzLnByb3RvY29sID0gcHJvdG9jb2w7XHJcbiAgdGhpcy5ob3N0ID0gdXJsLmhvc3Q7XHJcblxyXG4gIC8vIGV4cG9zZSBldmVudHNcclxuICByZXEub25jZSgnZHJhaW4nLCAoKSA9PiB7XHJcbiAgICB0aGlzLmVtaXQoJ2RyYWluJyk7XHJcbiAgfSk7XHJcblxyXG4gIHJlcS5vbignZXJyb3InLCAoZXJyb3IpID0+IHtcclxuICAgIC8vIGZsYWcgYWJvcnRpb24gaGVyZSBmb3Igb3V0IHRpbWVvdXRzXHJcbiAgICAvLyBiZWNhdXNlIG5vZGUgd2lsbCBlbWl0IGEgZmF1eC1lcnJvciBcInNvY2tldCBoYW5nIHVwXCJcclxuICAgIC8vIHdoZW4gcmVxdWVzdCBpcyBhYm9ydGVkIGJlZm9yZSBhIGNvbm5lY3Rpb24gaXMgbWFkZVxyXG4gICAgaWYgKHRoaXMuX2Fib3J0ZWQpIHJldHVybjtcclxuICAgIGlmICh0aGlzLmhhc1NpemVFcnJvcigpKSByZXR1cm47XHJcbiAgICAvLyBpZiBub3QgdGhlIHNhbWUsIHdlIGFyZSBpbiB0aGUgKipvbGQqKiAoY2FuY2VsbGVkKSByZXF1ZXN0LFxyXG4gICAgLy8gc28gbmVlZCB0byBjb250aW51ZSAoc2FtZSBhcyBmb3IgYWJvdmUpXHJcbiAgICBpZiAodGhpcy5fcmV0cmllcyAhPT0gcmV0cmllcykgcmV0dXJuO1xyXG4gICAgLy8gaWYgd2UndmUgcmVjZWl2ZWQgYSByZXNwb25zZSB0aGVuIHdlIGRvbid0IHdhbnQgdG8gbGV0XHJcbiAgICAvLyBhbiBlcnJvciBpbiB0aGUgcmVxdWVzdCBibG93IHVwIHRoZSByZXNwb25zZVxyXG4gICAgaWYgKHRoaXMucmVzcG9uc2UpIHJldHVybjtcclxuICAgIHRoaXMuY2FsbGJhY2soZXJyb3IpO1xyXG4gIH0pO1xyXG5cclxuICAvLyBhdXRoXHJcbiAgaWYgKHVybC51c2VybmFtZSB8fCB1cmwucGFzc3dvcmQpIHtcclxuICAgIHRoaXMuYXV0aCh1cmwudXNlcm5hbWUsIHVybC5wYXNzd29yZCk7XHJcbiAgfVxyXG5cclxuICBpZiAodGhpcy51c2VybmFtZSAmJiB0aGlzLnBhc3N3b3JkKSB7XHJcbiAgICB0aGlzLmF1dGgodGhpcy51c2VybmFtZSwgdGhpcy5wYXNzd29yZCk7XHJcbiAgfVxyXG5cclxuICBmb3IgKGNvbnN0IGtleSBpbiB0aGlzLmhlYWRlcikge1xyXG4gICAgaWYgKGhhc093bih0aGlzLmhlYWRlciwga2V5KSkgcmVxLnNldEhlYWRlcihrZXksIHRoaXMuaGVhZGVyW2tleV0pO1xyXG4gIH1cclxuXHJcbiAgLy8gYWRkIGNvb2tpZXNcclxuICBpZiAodGhpcy5jb29raWVzKSB7XHJcbiAgICBpZiAoaGFzT3duKHRoaXMuX2hlYWRlciwgJ2Nvb2tpZScpKSB7XHJcbiAgICAgIC8vIG1lcmdlXHJcbiAgICAgIGNvbnN0IHRlbXBvcmFyeUphciA9IG5ldyBDb29raWVKYXIuQ29va2llSmFyKCk7XHJcbiAgICAgIHRlbXBvcmFyeUphci5zZXRDb29raWVzKHRoaXMuX2hlYWRlci5jb29raWUuc3BsaXQoJzsgJykpO1xyXG4gICAgICB0ZW1wb3JhcnlKYXIuc2V0Q29va2llcyh0aGlzLmNvb2tpZXMuc3BsaXQoJzsgJykpO1xyXG4gICAgICByZXEuc2V0SGVhZGVyKFxyXG4gICAgICAgICdDb29raWUnLFxyXG4gICAgICAgIHRlbXBvcmFyeUphci5nZXRDb29raWVzKENvb2tpZUphci5Db29raWVBY2Nlc3NJbmZvLkFsbCkudG9WYWx1ZVN0cmluZygpXHJcbiAgICAgICk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICByZXEuc2V0SGVhZGVyKCdDb29raWUnLCB0aGlzLmNvb2tpZXMpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHJlcTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBJbnZva2UgdGhlIGNhbGxiYWNrIHdpdGggYGVycmAgYW5kIGByZXNgXHJcbiAqIGFuZCBoYW5kbGUgYXJpdHkgY2hlY2suXHJcbiAqXHJcbiAqIEBwYXJhbSB7RXJyb3J9IGVyclxyXG4gKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXNcclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuY2FsbGJhY2sgPSBmdW5jdGlvbiAoZXJyb3IsIHJlcykge1xyXG4gIGlmICh0aGlzLmNhbGxlZCkgcmV0dXJuO1xyXG5cclxuICBpZiAodGhpcy5fc2hvdWxkUmV0cnkoZXJyb3IsIHJlcykpIHtcclxuICAgIHJldHVybiB0aGlzLl9yZXRyeSgpO1xyXG4gIH1cclxuXHJcbiAgLy8gQXZvaWQgdGhlIGVycm9yIHdoaWNoIGlzIGVtaXR0ZWQgZnJvbSAnc29ja2V0IGhhbmcgdXAnIHRvIGNhdXNlIHRoZSBmbiB1bmRlZmluZWQgZXJyb3Igb24gSlMgcnVudGltZS5cclxuICBjb25zdCBmbiA9IHRoaXMuX2NhbGxiYWNrIHx8IG5vb3A7XHJcbiAgdGhpcy5jbGVhclRpbWVvdXQoKTtcclxuICB0aGlzLmNhbGxlZCA9IHRydWU7XHJcblxyXG4gIGlmICghZXJyb3IpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGlmICghdGhpcy5faXNSZXNwb25zZU9LKHJlcykpIHtcclxuICAgICAgICBsZXQgbWVzc2FnZSA9ICdVbnN1Y2Nlc3NmdWwgSFRUUCByZXNwb25zZSc7XHJcbiAgICAgICAgaWYgKHJlcykge1xyXG4gICAgICAgICAgbWVzc2FnZSA9IGh0dHAuU1RBVFVTX0NPREVTW3Jlcy5zdGF0dXNdIHx8IG1lc3NhZ2U7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBlcnJvciA9IG5ldyBFcnJvcihtZXNzYWdlKTtcclxuICAgICAgICBlcnJvci5zdGF0dXMgPSByZXMgPyByZXMuc3RhdHVzIDogdW5kZWZpbmVkO1xyXG4gICAgICB9XHJcbiAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgZXJyb3IgPSBlcnI7XHJcbiAgICAgIGVycm9yLnN0YXR1cyA9IGVycm9yLnN0YXR1cyB8fCAocmVzID8gcmVzLnN0YXR1cyA6IHVuZGVmaW5lZCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvLyBJdCdzIGltcG9ydGFudCB0aGF0IHRoZSBjYWxsYmFjayBpcyBjYWxsZWQgb3V0c2lkZSB0cnkvY2F0Y2hcclxuICAvLyB0byBhdm9pZCBkb3VibGUgY2FsbGJhY2tcclxuICBpZiAoIWVycm9yKSB7XHJcbiAgICByZXR1cm4gZm4obnVsbCwgcmVzKTtcclxuICB9XHJcblxyXG4gIGVycm9yLnJlc3BvbnNlID0gcmVzO1xyXG4gIGlmICh0aGlzLl9tYXhSZXRyaWVzKSBlcnJvci5yZXRyaWVzID0gdGhpcy5fcmV0cmllcyAtIDE7XHJcblxyXG4gIC8vIG9ubHkgZW1pdCBlcnJvciBldmVudCBpZiB0aGVyZSBpcyBhIGxpc3RlbmVyXHJcbiAgLy8gb3RoZXJ3aXNlIHdlIGFzc3VtZSB0aGUgY2FsbGJhY2sgdG8gYC5lbmQoKWAgd2lsbCBnZXQgdGhlIGVycm9yXHJcbiAgaWYgKGVycm9yICYmIHRoaXMubGlzdGVuZXJzKCdlcnJvcicpLmxlbmd0aCA+IDApIHtcclxuICAgIHRoaXMuZW1pdCgnZXJyb3InLCBlcnJvcik7XHJcbiAgfVxyXG5cclxuICBmbihlcnJvciwgcmVzKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBDaGVjayBpZiBgb2JqYCBpcyBhIGhvc3Qgb2JqZWN0LFxyXG4gKlxyXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqIGhvc3Qgb2JqZWN0XHJcbiAqIEByZXR1cm4ge0Jvb2xlYW59IGlzIGEgaG9zdCBvYmplY3RcclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5SZXF1ZXN0LnByb3RvdHlwZS5faXNIb3N0ID0gZnVuY3Rpb24gKG9iamVjdCkge1xyXG4gIHJldHVybiAoXHJcbiAgICBCdWZmZXIuaXNCdWZmZXIob2JqZWN0KSB8fFxyXG4gICAgb2JqZWN0IGluc3RhbmNlb2YgU3RyZWFtIHx8XHJcbiAgICBvYmplY3QgaW5zdGFuY2VvZiBGb3JtRGF0YVxyXG4gICk7XHJcbn07XHJcblxyXG4vKipcclxuICogVGVybWluYXRlIGEgcmVxdWVzdCBhZnRlciBpdHMgYm9keSBleGNlZWRzIHRoZSBjb25maWd1cmVkIGxpbWl0LlxyXG4gKlxyXG4gKiBAcmV0dXJuIHtFcnJvcn1cclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5SZXF1ZXN0LnByb3RvdHlwZS5fZmFpbFJlcXVlc3RTaXplID0gZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IGVycm9yID0gdGhpcy5fY3JlYXRlU2l6ZUVycm9yKCdyZXF1ZXN0Jyk7XHJcblxyXG4gIGlmICh0aGlzLnJlcSAmJiAhdGhpcy5yZXEuZGVzdHJveWVkKSB7XHJcbiAgICBpZiAodHlwZW9mIHRoaXMucmVxLmRlc3Ryb3kgPT09ICdmdW5jdGlvbicpIHRoaXMucmVxLmRlc3Ryb3koKTtcclxuICAgIGVsc2UgaWYgKHR5cGVvZiB0aGlzLnJlcS5hYm9ydCA9PT0gJ2Z1bmN0aW9uJykgdGhpcy5yZXEuYWJvcnQoKTtcclxuICB9XHJcblxyXG4gIGlmICh0aGlzLl9lbmRDYWxsZWQpIHRoaXMuY2FsbGJhY2soZXJyb3IpO1xyXG4gIHJldHVybiBlcnJvcjtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBJbml0aWF0ZSByZXF1ZXN0LCBpbnZva2luZyBjYWxsYmFjayBgZm4oZXJyLCByZXMpYFxyXG4gKiB3aXRoIGFuIGluc3RhbmNlb2YgYFJlc3BvbnNlYC5cclxuICpcclxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuX2VtaXRSZXNwb25zZSA9IGZ1bmN0aW9uIChib2R5LCBmaWxlcykge1xyXG4gIGNvbnN0IHJlc3BvbnNlID0gbmV3IFJlc3BvbnNlKHRoaXMpO1xyXG4gIHRoaXMucmVzcG9uc2UgPSByZXNwb25zZTtcclxuICByZXNwb25zZS5yZWRpcmVjdHMgPSB0aGlzLl9yZWRpcmVjdExpc3Q7XHJcbiAgaWYgKHVuZGVmaW5lZCAhPT0gYm9keSkge1xyXG4gICAgcmVzcG9uc2UuYm9keSA9IGJvZHk7XHJcbiAgfVxyXG5cclxuICByZXNwb25zZS5maWxlcyA9IGZpbGVzO1xyXG4gIGlmICh0aGlzLl9lbmRDYWxsZWQpIHtcclxuICAgIHJlc3BvbnNlLnBpcGUgPSBmdW5jdGlvbiAoKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcclxuICAgICAgICBcImVuZCgpIGhhcyBhbHJlYWR5IGJlZW4gY2FsbGVkLCBzbyBpdCdzIHRvbyBsYXRlIHRvIHN0YXJ0IHBpcGluZ1wiXHJcbiAgICAgICk7XHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgdGhpcy5lbWl0KCdyZXNwb25zZScsIHJlc3BvbnNlKTtcclxuICByZXR1cm4gcmVzcG9uc2U7XHJcbn07XHJcblxyXG4vKipcclxuICogRW1pdCBgcmVkaXJlY3RgIGV2ZW50LCBwYXNzaW5nIGFuIGluc3RhbmNlb2YgYFJlc3BvbnNlYC5cclxuICpcclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuX2VtaXRSZWRpcmVjdCA9IGZ1bmN0aW9uICgpIHtcclxuICBjb25zdCByZXNwb25zZSA9IG5ldyBSZXNwb25zZSh0aGlzKTtcclxuICByZXNwb25zZS5yZWRpcmVjdHMgPSB0aGlzLl9yZWRpcmVjdExpc3Q7XHJcbiAgdGhpcy5lbWl0KCdyZWRpcmVjdCcsIHJlc3BvbnNlKTtcclxufTtcclxuXHJcblJlcXVlc3QucHJvdG90eXBlLmVuZCA9IGZ1bmN0aW9uIChmbikge1xyXG4gIHRoaXMucmVxdWVzdCgpO1xyXG4gIGRlYnVnKCclcyAlcycsIHRoaXMubWV0aG9kLCB0aGlzLnVybCk7XHJcblxyXG4gIGlmICh0aGlzLl9lbmRDYWxsZWQpIHtcclxuICAgIHRocm93IG5ldyBFcnJvcihcclxuICAgICAgJy5lbmQoKSB3YXMgY2FsbGVkIHR3aWNlLiBUaGlzIGlzIG5vdCBzdXBwb3J0ZWQgaW4gc3VwZXJhZ2VudCdcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICB0aGlzLl9lbmRDYWxsZWQgPSB0cnVlO1xyXG5cclxuICAvLyBzdG9yZSBjYWxsYmFja1xyXG4gIHRoaXMuX2NhbGxiYWNrID0gZm4gfHwgbm9vcDtcclxuXHJcbiAgdGhpcy5fZW5kKCk7XHJcbn07XHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS5fZW5kID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0aGlzLl9hYm9ydGVkKVxyXG4gICAgcmV0dXJuIHRoaXMuY2FsbGJhY2soXHJcbiAgICAgIG5ldyBFcnJvcignVGhlIHJlcXVlc3QgaGFzIGJlZW4gYWJvcnRlZCBldmVuIGJlZm9yZSAuZW5kKCkgd2FzIGNhbGxlZCcpXHJcbiAgICApO1xyXG5cclxuICBpZiAodGhpcy5oYXNTaXplRXJyb3IoKSkgcmV0dXJuIHRoaXMuY2FsbGJhY2sodGhpcy5fc2l6ZUVycm9yRXJyb3IpO1xyXG5cclxuICBsZXQgZGF0YSA9IHRoaXMuX2RhdGE7XHJcbiAgY29uc3QgeyByZXEgfSA9IHRoaXM7XHJcbiAgY29uc3QgeyBtZXRob2QgfSA9IHRoaXM7XHJcblxyXG4gIHRoaXMuX3NldFRpbWVvdXRzKCk7XHJcblxyXG4gIC8vIGJvZHlcclxuICBpZiAobWV0aG9kICE9PSAnSEVBRCcgJiYgIXJlcS5faGVhZGVyU2VudCkge1xyXG4gICAgLy8gc2VyaWFsaXplIHN0dWZmXHJcbiAgICBpZiAodHlwZW9mIGRhdGEgIT09ICdzdHJpbmcnKSB7XHJcbiAgICAgIGxldCBjb250ZW50VHlwZSA9IHJlcS5nZXRIZWFkZXIoJ0NvbnRlbnQtVHlwZScpO1xyXG4gICAgICAvLyBQYXJzZSBvdXQganVzdCB0aGUgY29udGVudCB0eXBlIGZyb20gdGhlIGhlYWRlciAoaWdub3JlIHRoZSBjaGFyc2V0KVxyXG4gICAgICBpZiAoY29udGVudFR5cGUpIGNvbnRlbnRUeXBlID0gY29udGVudFR5cGUuc3BsaXQoJzsnKVswXTtcclxuICAgICAgbGV0IHNlcmlhbGl6ZSA9IHRoaXMuX3NlcmlhbGl6ZXIgfHwgZXhwb3J0cy5zZXJpYWxpemVbY29udGVudFR5cGVdO1xyXG4gICAgICBpZiAoIXNlcmlhbGl6ZSAmJiBpc0pTT04oY29udGVudFR5cGUpKSB7XHJcbiAgICAgICAgc2VyaWFsaXplID0gZXhwb3J0cy5zZXJpYWxpemVbJ2FwcGxpY2F0aW9uL2pzb24nXTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKHNlcmlhbGl6ZSkgZGF0YSA9IHNlcmlhbGl6ZShkYXRhKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBjb250ZW50LWxlbmd0aFxyXG4gICAgaWYgKGRhdGEgJiYgIXJlcS5nZXRIZWFkZXIoJ0NvbnRlbnQtTGVuZ3RoJykpIHtcclxuICAgICAgcmVxLnNldEhlYWRlcihcclxuICAgICAgICAnQ29udGVudC1MZW5ndGgnLFxyXG4gICAgICAgIEJ1ZmZlci5pc0J1ZmZlcihkYXRhKSA/IGRhdGEubGVuZ3RoIDogQnVmZmVyLmJ5dGVMZW5ndGgoZGF0YSlcclxuICAgICAgKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGlmIChcclxuICAgIHRoaXMuX21heFJlcXVlc3RTaXplICE9PSB1bmRlZmluZWQgJiZcclxuICAgIHV0aWxzLmJ5dGVMZW5ndGgoZGF0YSkgPiB0aGlzLl9tYXhSZXF1ZXN0U2l6ZVxyXG4gICkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2ZhaWxSZXF1ZXN0U2l6ZSgpO1xyXG4gIH1cclxuXHJcbiAgLy8gcmVzcG9uc2VcclxuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgY29tcGxleGl0eVxyXG4gIHJlcS5vbmNlKCdyZXNwb25zZScsIChyZXMpID0+IHtcclxuICAgIGRlYnVnKCclcyAlcyAtPiAlcycsIHRoaXMubWV0aG9kLCB0aGlzLnVybCwgcmVzLnN0YXR1c0NvZGUpO1xyXG5cclxuICAgIGlmICh0aGlzLl9yZXNwb25zZVRpbWVvdXRUaW1lcikge1xyXG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5fcmVzcG9uc2VUaW1lb3V0VGltZXIpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh0aGlzLnBpcGVkKSB7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBtYXggPSB0aGlzLl9tYXhSZWRpcmVjdHM7XHJcbiAgICBjb25zdCBtaW1lID0gdXRpbHMudHlwZShyZXMuaGVhZGVyc1snY29udGVudC10eXBlJ10gfHwgJycpIHx8ICd0ZXh0L3BsYWluJztcclxuICAgIGxldCB0eXBlID0gbWltZS5zcGxpdCgnLycpWzBdO1xyXG4gICAgaWYgKHR5cGUpIHR5cGUgPSB0eXBlLnRvTG93ZXJDYXNlKCkudHJpbSgpO1xyXG4gICAgY29uc3QgbXVsdGlwYXJ0ID0gdHlwZSA9PT0gJ211bHRpcGFydCc7XHJcbiAgICBjb25zdCByZWRpcmVjdCA9IGlzUmVkaXJlY3QocmVzLnN0YXR1c0NvZGUpO1xyXG4gICAgY29uc3QgcmVzcG9uc2VUeXBlID0gdGhpcy5fcmVzcG9uc2VUeXBlO1xyXG5cclxuICAgIHRoaXMucmVzID0gcmVzO1xyXG5cclxuICAgIC8vIHJlZGlyZWN0XHJcbiAgICBpZiAocmVkaXJlY3QgJiYgdGhpcy5fcmVkaXJlY3RzKysgIT09IG1heCkge1xyXG4gICAgICByZXR1cm4gdGhpcy5fcmVkaXJlY3QocmVzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodGhpcy5tZXRob2QgPT09ICdIRUFEJykge1xyXG4gICAgICB0aGlzLmVtaXQoJ2VuZCcpO1xyXG4gICAgICB0aGlzLmNhbGxiYWNrKG51bGwsIHRoaXMuX2VtaXRSZXNwb25zZSgpKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIHpsaWIgc3VwcG9ydFxyXG4gICAgaWYgKHRoaXMuX3Nob3VsZERlY29tcHJlc3MocmVzKSkge1xyXG4gICAgICBkZWNvbXByZXNzKHJlcSwgcmVzKTtcclxuICAgIH1cclxuXHJcbiAgICBsZXQgYnVmZmVyID0gdGhpcy5fYnVmZmVyO1xyXG4gICAgaWYgKGJ1ZmZlciA9PT0gdW5kZWZpbmVkICYmIG1pbWUgaW4gZXhwb3J0cy5idWZmZXIpIHtcclxuICAgICAgYnVmZmVyID0gQm9vbGVhbihleHBvcnRzLmJ1ZmZlclttaW1lXSk7XHJcbiAgICB9XHJcblxyXG4gICAgbGV0IHBhcnNlciA9IHRoaXMuX3BhcnNlcjtcclxuICAgIGlmICh1bmRlZmluZWQgPT09IGJ1ZmZlciAmJiBwYXJzZXIpIHtcclxuICAgICAgY29uc29sZS53YXJuKFxyXG4gICAgICAgIFwiQSBjdXN0b20gc3VwZXJhZ2VudCBwYXJzZXIgaGFzIGJlZW4gc2V0LCBidXQgYnVmZmVyaW5nIHN0cmF0ZWd5IGZvciB0aGUgcGFyc2VyIGhhc24ndCBiZWVuIGNvbmZpZ3VyZWQuIENhbGwgYHJlcS5idWZmZXIodHJ1ZSBvciBmYWxzZSlgIG9yIHNldCBgc3VwZXJhZ2VudC5idWZmZXJbbWltZV0gPSB0cnVlIG9yIGZhbHNlYFwiXHJcbiAgICAgICk7XHJcbiAgICAgIGJ1ZmZlciA9IHRydWU7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFwYXJzZXIpIHtcclxuICAgICAgaWYgKHJlc3BvbnNlVHlwZSkge1xyXG4gICAgICAgIHBhcnNlciA9IGV4cG9ydHMucGFyc2UuaW1hZ2U7IC8vIEl0J3MgYWN0dWFsbHkgYSBnZW5lcmljIEJ1ZmZlclxyXG4gICAgICAgIGJ1ZmZlciA9IHRydWU7XHJcbiAgICAgIH0gZWxzZSBpZiAobXVsdGlwYXJ0KSB7XHJcbiAgICAgICAgY29uc3QgZm9ybSA9IGZvcm1pZGFibGUuZm9ybWlkYWJsZSgpO1xyXG4gICAgICAgIHBhcnNlciA9IChyZXMsIGNhbGxiYWNrKSA9PiB7XHJcbiAgICAgICAgICAvLyBDcmVhdGUgYSBQYXNzVGhyb3VnaCBzdHJlYW0gdGhhdCBhY3RzIGFzIGEgcHJvcGVyIEhUVFAgcmVxdWVzdFxyXG4gICAgICAgICAgY29uc3QgYnJpZGdlU3RyZWFtID0gbmV3IFN0cmVhbS5QYXNzVGhyb3VnaCgpO1xyXG5cclxuICAgICAgICAgIC8vIEFkZCBIVFRQIHJlcXVlc3QgcHJvcGVydGllcyBmcm9tIHRoZSBjdXJyZW50IHJlcXVlc3QgY29udGV4dFxyXG4gICAgICAgICAgYnJpZGdlU3RyZWFtLm1ldGhvZCA9IHRoaXMubWV0aG9kIHx8ICdQT1NUJztcclxuICAgICAgICAgIGJyaWRnZVN0cmVhbS51cmwgPSB0aGlzLnVybCB8fCAnLyc7XHJcbiAgICAgICAgICBicmlkZ2VTdHJlYW0uaHR0cFZlcnNpb24gPSByZXMuaHR0cFZlcnNpb24gfHwgJzEuMSc7XHJcbiAgICAgICAgICBicmlkZ2VTdHJlYW0uaGVhZGVycyA9IHJlcy5oZWFkZXJzIHx8IHt9O1xyXG4gICAgICAgICAgYnJpZGdlU3RyZWFtLnNvY2tldCA9IHJlcy5zb2NrZXQgfHwgeyByZWFkYWJsZTogdHJ1ZSB9O1xyXG5cclxuICAgICAgICAgIC8vIFBpcGUgdGhlIHJlc3BvbnNlIGRhdGEgdGhyb3VnaCB0aGUgYnJpZGdlIHN0cmVhbVxyXG4gICAgICAgICAgcmVzLnBpcGUoYnJpZGdlU3RyZWFtKTtcclxuXHJcbiAgICAgICAgICBmb3JtLnBhcnNlKGJyaWRnZVN0cmVhbSwgKGVyciwgZmllbGRzLCBmaWxlcykgPT4ge1xyXG4gICAgICAgICAgICBpZiAoZXJyKSByZXR1cm4gY2FsbGJhY2soZXJyKTtcclxuXHJcbiAgICAgICAgICAgIC8vIEZvcm1pZGFibGUgdjMgYWx3YXlzIHJldHVybnMgYXJyYXlzLCBidXQgU3VwZXJBZ2VudCBleHBlY3RzIHNpbmdsZSB2YWx1ZXNcclxuICAgICAgICAgICAgLy8gRmxhdHRlbiBzaW5nbGUtaXRlbSBhcnJheXMgdG8gbWFpbnRhaW4gYmFja3dhcmQgY29tcGF0aWJpbGl0eVxyXG4gICAgICAgICAgICBjb25zdCBmbGF0dGVuZWRGaWVsZHMgPSB7fTtcclxuICAgICAgICAgICAgaWYgKGZpZWxkcykge1xyXG4gICAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIGZpZWxkcykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgdmFsdWUgPSBmaWVsZHNba2V5XTtcclxuICAgICAgICAgICAgICAgIGZsYXR0ZW5lZEZpZWxkc1trZXldID0gQXJyYXkuaXNBcnJheSh2YWx1ZSkgJiYgdmFsdWUubGVuZ3RoID09PSAxID8gdmFsdWVbMF0gOiB2YWx1ZTtcclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnN0IGZsYXR0ZW5lZEZpbGVzID0ge307XHJcbiAgICAgICAgICAgIGlmIChmaWxlcykge1xyXG4gICAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIGZpbGVzKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCB2YWx1ZSA9IGZpbGVzW2tleV07XHJcbiAgICAgICAgICAgICAgICBmbGF0dGVuZWRGaWxlc1trZXldID0gQXJyYXkuaXNBcnJheSh2YWx1ZSkgJiYgdmFsdWUubGVuZ3RoID09PSAxID8gdmFsdWVbMF0gOiB2YWx1ZTtcclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIFJldHVybiBmbGF0dGVuZWQgZmllbGRzIGFzIHRoZSBvYmplY3QgcGFyYW1ldGVyIHRvIG1hdGNoIFN1cGVyQWdlbnQncyBleHBlY3RlZCBmb3JtYXRcclxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZmxhdHRlbmVkRmllbGRzLCBmbGF0dGVuZWRGaWxlcyk7XHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICB9O1xyXG4gICAgICAgIGJ1ZmZlciA9IHRydWU7XHJcbiAgICAgIH0gZWxzZSBpZiAoaXNCaW5hcnkobWltZSkpIHtcclxuICAgICAgICBwYXJzZXIgPSBleHBvcnRzLnBhcnNlLmltYWdlO1xyXG4gICAgICAgIGJ1ZmZlciA9IHRydWU7IC8vIEZvciBiYWNrd2FyZHMtY29tcGF0aWJpbGl0eSBidWZmZXJpbmcgZGVmYXVsdCBpcyBhZC1ob2MgTUlNRS1kZXBlbmRlbnRcclxuICAgICAgfSBlbHNlIGlmIChleHBvcnRzLnBhcnNlW21pbWVdKSB7XHJcbiAgICAgICAgcGFyc2VyID0gZXhwb3J0cy5wYXJzZVttaW1lXTtcclxuICAgICAgfSBlbHNlIGlmICh0eXBlID09PSAndGV4dCcpIHtcclxuICAgICAgICBwYXJzZXIgPSBleHBvcnRzLnBhcnNlLnRleHQ7XHJcbiAgICAgICAgYnVmZmVyID0gYnVmZmVyICE9PSBmYWxzZTtcclxuICAgICAgICAvLyBldmVyeW9uZSB3YW50cyB0aGVpciBvd24gd2hpdGUtbGFiZWxlZCBqc29uXHJcbiAgICAgIH0gZWxzZSBpZiAoaXNKU09OKG1pbWUpKSB7XHJcbiAgICAgICAgcGFyc2VyID0gZXhwb3J0cy5wYXJzZVsnYXBwbGljYXRpb24vanNvbiddO1xyXG4gICAgICAgIGJ1ZmZlciA9IGJ1ZmZlciAhPT0gZmFsc2U7XHJcbiAgICAgIH0gZWxzZSBpZiAoYnVmZmVyKSB7XHJcbiAgICAgICAgcGFyc2VyID0gZXhwb3J0cy5wYXJzZS50ZXh0O1xyXG4gICAgICB9IGVsc2UgaWYgKHVuZGVmaW5lZCA9PT0gYnVmZmVyKSB7XHJcbiAgICAgICAgcGFyc2VyID0gZXhwb3J0cy5wYXJzZS5pbWFnZTsgLy8gSXQncyBhY3R1YWxseSBhIGdlbmVyaWMgQnVmZmVyXHJcbiAgICAgICAgYnVmZmVyID0gdHJ1ZTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIGJ5IGRlZmF1bHQgb25seSBidWZmZXIgdGV4dC8qLCBqc29uIGFuZCBtZXNzZWQgdXAgdGhpbmcgZnJvbSBoZWxsXHJcbiAgICBpZiAoKHVuZGVmaW5lZCA9PT0gYnVmZmVyICYmIGlzVGV4dChtaW1lKSkgfHwgaXNKU09OKG1pbWUpKSB7XHJcbiAgICAgIGJ1ZmZlciA9IHRydWU7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5fcmVzQnVmZmVyZWQgPSBidWZmZXI7XHJcbiAgICBsZXQgcGFyc2VySGFuZGxlc0VuZCA9IGZhbHNlO1xyXG4gICAgaWYgKGJ1ZmZlcikge1xyXG4gICAgICAvLyBQcm90ZWN0aW9uYSBhZ2FpbnN0IHppcCBib21icyBhbmQgb3RoZXIgbnVpc2FuY2VcclxuICAgICAgbGV0IHJlc3BvbnNlQnl0ZXMgPSAwO1xyXG4gICAgICBjb25zdCBtYXhSZXNwb25zZVNpemUgPVxyXG4gICAgICAgIHRoaXMuX21heFJlc3BvbnNlU2l6ZSA9PT0gdW5kZWZpbmVkID8gMjAwMDAwMDAwIDogdGhpcy5fbWF4UmVzcG9uc2VTaXplO1xyXG4gICAgICByZXMub24oJ2RhdGEnLCAoYnVmKSA9PiB7XHJcbiAgICAgICAgaWYgKHRoaXMuaGFzU2l6ZUVycm9yKCkpIHJldHVybjtcclxuXHJcbiAgICAgICAgcmVzcG9uc2VCeXRlcyArPSB1dGlscy5ieXRlTGVuZ3RoKGJ1Zik7XHJcbiAgICAgICAgaWYgKHJlc3BvbnNlQnl0ZXMgPiBtYXhSZXNwb25zZVNpemUpIHtcclxuICAgICAgICAgIGNvbnN0IGVycm9yID0gdGhpcy5fY3JlYXRlU2l6ZUVycm9yKCdyZXNwb25zZScpO1xyXG4gICAgICAgICAgLy8gUGFyc2VycyBhcmVuJ3QgcmVxdWlyZWQgdG8gb2JzZXJ2ZSBlcnJvciBldmVudCxcclxuICAgICAgICAgIC8vIHNvIHdvdWxkIGluY29ycmVjdGx5IHJlcG9ydCBzdWNjZXNzXHJcbiAgICAgICAgICBwYXJzZXJIYW5kbGVzRW5kID0gZmFsc2U7XHJcbiAgICAgICAgICByZXMuZGVzdHJveShlcnJvcik7XHJcbiAgICAgICAgICB0aGlzLmNhbGxiYWNrKGVycm9yLCBudWxsKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChwYXJzZXIpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICAvLyBVbmJ1ZmZlcmVkIHBhcnNlcnMgYXJlIHN1cHBvc2VkIHRvIGVtaXQgcmVzcG9uc2UgZWFybHksXHJcbiAgICAgICAgLy8gd2hpY2ggaXMgd2VpcmQgQlRXLCBiZWNhdXNlIHJlc3BvbnNlLmJvZHkgd29uJ3QgYmUgdGhlcmUuXHJcbiAgICAgICAgcGFyc2VySGFuZGxlc0VuZCA9IGJ1ZmZlcjtcclxuXHJcbiAgICAgICAgcGFyc2VyKHJlcywgKGVycm9yLCBvYmplY3QsIGZpbGVzKSA9PiB7XHJcbiAgICAgICAgICBpZiAodGhpcy50aW1lZG91dCkge1xyXG4gICAgICAgICAgICAvLyBUaW1lb3V0IGhhcyBhbHJlYWR5IGhhbmRsZWQgYWxsIGNhbGxiYWNrc1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgaWYgKHRoaXMuaGFzU2l6ZUVycm9yKCkpIHJldHVybjtcclxuXHJcbiAgICAgICAgICAvLyBJbnRlbnRpb25hbCAobm9uLXRpbWVvdXQpIGFib3J0IGlzIHN1cHBvc2VkIHRvIHByZXNlcnZlIHBhcnRpYWwgcmVzcG9uc2UsXHJcbiAgICAgICAgICAvLyBldmVuIGlmIGl0IGRvZXNuJ3QgcGFyc2UuXHJcbiAgICAgICAgICBpZiAoZXJyb3IgJiYgIXRoaXMuX2Fib3J0ZWQpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuY2FsbGJhY2soZXJyb3IpO1xyXG4gICAgICAgICAgfVxyXG5cclxuICAgICAgICAgIGlmIChwYXJzZXJIYW5kbGVzRW5kKSB7XHJcbiAgICAgICAgICAgIHRoaXMuZW1pdCgnZW5kJyk7XHJcbiAgICAgICAgICAgIHRoaXMuY2FsbGJhY2sobnVsbCwgdGhpcy5fZW1pdFJlc3BvbnNlKG9iamVjdCwgZmlsZXMpKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgdGhpcy5jYWxsYmFjayhlcnIpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHRoaXMucmVzID0gcmVzO1xyXG5cclxuICAgIC8vIHVuYnVmZmVyZWRcclxuICAgIGlmICghYnVmZmVyKSB7XHJcbiAgICAgIGRlYnVnKCd1bmJ1ZmZlcmVkICVzICVzJywgdGhpcy5tZXRob2QsIHRoaXMudXJsKTtcclxuICAgICAgdGhpcy5jYWxsYmFjayhudWxsLCB0aGlzLl9lbWl0UmVzcG9uc2UoKSk7XHJcbiAgICAgIGlmIChtdWx0aXBhcnQpIHJldHVybjsgLy8gYWxsb3cgbXVsdGlwYXJ0IHRvIGhhbmRsZSBlbmQgZXZlbnRcclxuICAgICAgcmVzLm9uY2UoJ2VuZCcsICgpID0+IHtcclxuICAgICAgICBkZWJ1ZygnZW5kICVzICVzJywgdGhpcy5tZXRob2QsIHRoaXMudXJsKTtcclxuICAgICAgICB0aGlzLmVtaXQoJ2VuZCcpO1xyXG4gICAgICB9KTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIHRlcm1pbmF0aW5nIGV2ZW50c1xyXG4gICAgcmVzLm9uY2UoJ2Vycm9yJywgKGVycm9yKSA9PiB7XHJcbiAgICAgIHBhcnNlckhhbmRsZXNFbmQgPSBmYWxzZTtcclxuICAgICAgdGhpcy5jYWxsYmFjayh0aGlzLl9zaXplRXJyb3JFcnJvciB8fCBlcnJvciwgbnVsbCk7XHJcbiAgICB9KTtcclxuICAgIGlmICghcGFyc2VySGFuZGxlc0VuZClcclxuICAgICAgcmVzLm9uY2UoJ2VuZCcsICgpID0+IHtcclxuICAgICAgICBkZWJ1ZygnZW5kICVzICVzJywgdGhpcy5tZXRob2QsIHRoaXMudXJsKTtcclxuICAgICAgICAvLyBUT0RPOiB1bmxlc3MgYnVmZmVyaW5nIGVtaXQgZWFybGllciB0byBzdHJlYW1cclxuICAgICAgICB0aGlzLmVtaXQoJ2VuZCcpO1xyXG4gICAgICAgIHRoaXMuY2FsbGJhY2sobnVsbCwgdGhpcy5fZW1pdFJlc3BvbnNlKCkpO1xyXG4gICAgICB9KTtcclxuICB9KTtcclxuXHJcbiAgdGhpcy5lbWl0KCdyZXF1ZXN0JywgdGhpcyk7XHJcblxyXG4gIGNvbnN0IGdldFByb2dyZXNzTW9uaXRvciA9ICgpID0+IHtcclxuICAgIGNvbnN0IGxlbmd0aENvbXB1dGFibGUgPSB0cnVlO1xyXG4gICAgY29uc3QgdG90YWwgPSByZXEuZ2V0SGVhZGVyKCdDb250ZW50LUxlbmd0aCcpO1xyXG4gICAgY29uc3QgbWF4UmVxdWVzdFNpemUgPSB0aGlzLl9tYXhSZXF1ZXN0U2l6ZTtcclxuICAgIGxldCBsb2FkZWQgPSAwO1xyXG5cclxuICAgIGNvbnN0IHByb2dyZXNzID0gbmV3IFN0cmVhbS5UcmFuc2Zvcm0oKTtcclxuICAgIHByb2dyZXNzLl90cmFuc2Zvcm0gPSAoY2h1bmssIGVuY29kaW5nLCBjYWxsYmFjaykgPT4ge1xyXG4gICAgICBsb2FkZWQgKz0gdXRpbHMuYnl0ZUxlbmd0aChjaHVuaywgZW5jb2RpbmcpO1xyXG5cclxuICAgICAgaWYgKG1heFJlcXVlc3RTaXplICE9PSB1bmRlZmluZWQgJiYgbG9hZGVkID4gbWF4UmVxdWVzdFNpemUpIHtcclxuICAgICAgICBjb25zdCBlcnJvciA9IHRoaXMuX2ZhaWxSZXF1ZXN0U2l6ZSgpO1xyXG4gICAgICAgIGNhbGxiYWNrKGVycm9yKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRoaXMuZW1pdCgncHJvZ3Jlc3MnLCB7XHJcbiAgICAgICAgZGlyZWN0aW9uOiAndXBsb2FkJyxcclxuICAgICAgICBsZW5ndGhDb21wdXRhYmxlLFxyXG4gICAgICAgIGxvYWRlZCxcclxuICAgICAgICB0b3RhbFxyXG4gICAgICB9KTtcclxuICAgICAgY2FsbGJhY2sobnVsbCwgY2h1bmspO1xyXG4gICAgfTtcclxuXHJcbiAgICBwcm9ncmVzcy5vbignZXJyb3InLCAoZXJyb3IpID0+IHtcclxuICAgICAgaWYgKCF0aGlzLmhhc1NpemVFcnJvcigpKSB0aGlzLmNhbGxiYWNrKGVycm9yKTtcclxuICAgIH0pO1xyXG5cclxuICAgIHJldHVybiBwcm9ncmVzcztcclxuICB9O1xyXG5cclxuICBjb25zdCBidWZmZXJUb0NodW5rcyA9IChidWZmZXIpID0+IHtcclxuICAgIGNvbnN0IGNodW5rU2l6ZSA9IDE2ICogMTAyNDsgLy8gZGVmYXVsdCBoaWdoV2F0ZXJNYXJrIHZhbHVlXHJcbiAgICBjb25zdCBjaHVua2luZyA9IG5ldyBTdHJlYW0uUmVhZGFibGUoKTtcclxuICAgIGNvbnN0IHRvdGFsTGVuZ3RoID0gYnVmZmVyLmxlbmd0aDtcclxuICAgIGNvbnN0IHJlbWFpbmRlciA9IHRvdGFsTGVuZ3RoICUgY2h1bmtTaXplO1xyXG4gICAgY29uc3QgY3V0b2ZmID0gdG90YWxMZW5ndGggLSByZW1haW5kZXI7XHJcblxyXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjdXRvZmY7IGkgKz0gY2h1bmtTaXplKSB7XHJcbiAgICAgIGNvbnN0IGNodW5rID0gYnVmZmVyLnNsaWNlKGksIGkgKyBjaHVua1NpemUpO1xyXG4gICAgICBjaHVua2luZy5wdXNoKGNodW5rKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAocmVtYWluZGVyID4gMCkge1xyXG4gICAgICBjb25zdCByZW1haW5kZXJCdWZmZXIgPSBidWZmZXIuc2xpY2UoLXJlbWFpbmRlcik7XHJcbiAgICAgIGNodW5raW5nLnB1c2gocmVtYWluZGVyQnVmZmVyKTtcclxuICAgIH1cclxuXHJcbiAgICBjaHVua2luZy5wdXNoKG51bGwpOyAvLyBubyBtb3JlIGRhdGFcclxuXHJcbiAgICByZXR1cm4gY2h1bmtpbmc7XHJcbiAgfTtcclxuXHJcbiAgLy8gaWYgYSBGb3JtRGF0YSBpbnN0YW5jZSBnb3QgY3JlYXRlZCwgdGhlbiB3ZSBzZW5kIHRoYXQgYXMgdGhlIHJlcXVlc3QgYm9keVxyXG4gIGNvbnN0IGZvcm1EYXRhID0gdGhpcy5fZm9ybURhdGE7XHJcbiAgaWYgKGZvcm1EYXRhKSB7XHJcbiAgICAvLyBzZXQgaGVhZGVyc1xyXG4gICAgY29uc3QgaGVhZGVycyA9IGZvcm1EYXRhLmdldEhlYWRlcnMoKTtcclxuICAgIGZvciAoY29uc3QgaSBpbiBoZWFkZXJzKSB7XHJcbiAgICAgIGlmIChoYXNPd24oaGVhZGVycywgaSkpIHtcclxuICAgICAgICBkZWJ1Zygnc2V0dGluZyBGb3JtRGF0YSBoZWFkZXI6IFwiJXM6ICVzXCInLCBpLCBoZWFkZXJzW2ldKTtcclxuICAgICAgICByZXEuc2V0SGVhZGVyKGksIGhlYWRlcnNbaV0pO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gYXR0ZW1wdCB0byBnZXQgXCJDb250ZW50LUxlbmd0aFwiIGhlYWRlclxyXG4gICAgZm9ybURhdGEuZ2V0TGVuZ3RoKChlcnJvciwgbGVuZ3RoKSA9PiB7XHJcbiAgICAgIC8vIFRPRE86IEFkZCBjaHVua2VkIGVuY29kaW5nIHdoZW4gbm8gbGVuZ3RoIChpZiBlcnIpXHJcbiAgICAgIGlmIChlcnJvcikgZGVidWcoJ2Zvcm1EYXRhLmdldExlbmd0aCBoYWQgZXJyb3InLCBlcnJvciwgbGVuZ3RoKTtcclxuXHJcbiAgICAgIGRlYnVnKCdnb3QgRm9ybURhdGEgQ29udGVudC1MZW5ndGg6ICVzJywgbGVuZ3RoKTtcclxuICAgICAgaWYgKHR5cGVvZiBsZW5ndGggPT09ICdudW1iZXInKSB7XHJcbiAgICAgICAgcmVxLnNldEhlYWRlcignQ29udGVudC1MZW5ndGgnLCBsZW5ndGgpO1xyXG5cclxuICAgICAgICBpZiAoXHJcbiAgICAgICAgICB0aGlzLl9tYXhSZXF1ZXN0U2l6ZSAhPT0gdW5kZWZpbmVkICYmXHJcbiAgICAgICAgICBsZW5ndGggPiB0aGlzLl9tYXhSZXF1ZXN0U2l6ZVxyXG4gICAgICAgICkge1xyXG4gICAgICAgICAgdGhpcy5fZmFpbFJlcXVlc3RTaXplKCk7XHJcbiAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAodGhpcy5oYXNTaXplRXJyb3IoKSkgcmV0dXJuO1xyXG4gICAgICBmb3JtRGF0YS5waXBlKGdldFByb2dyZXNzTW9uaXRvcigpKS5waXBlKHJlcSk7XHJcbiAgICB9KTtcclxuICB9IGVsc2UgaWYgKEJ1ZmZlci5pc0J1ZmZlcihkYXRhKSkge1xyXG4gICAgYnVmZmVyVG9DaHVua3MoZGF0YSkucGlwZShnZXRQcm9ncmVzc01vbml0b3IoKSkucGlwZShyZXEpO1xyXG4gIH0gZWxzZSB7XHJcbiAgICByZXEuZW5kKGRhdGEpO1xyXG4gIH1cclxufTtcclxuXHJcbi8vIENoZWNrIHdoZXRoZXIgcmVzcG9uc2UgaGFzIGEgbm9uLTAtc2l6ZWQgZ3ppcC1lbmNvZGVkIGJvZHlcclxuUmVxdWVzdC5wcm90b3R5cGUuX3Nob3VsZERlY29tcHJlc3MgPSAocmVzKSA9PiB7XHJcbiAgcmV0dXJuIGhhc05vbkVtcHR5UmVzcG9uc2VDb250ZW50KHJlcykgJiYgKGlzR3ppcE9yRGVmbGF0ZUVuY29kaW5nKHJlcykgfHwgaXNCcm90bGlFbmNvZGluZyhyZXMpKTtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogT3ZlcnJpZGVzIEROUyBmb3Igc2VsZWN0ZWQgaG9zdG5hbWVzLiBUYWtlcyBvYmplY3QgbWFwcGluZyBob3N0bmFtZXMgdG8gSVAgYWRkcmVzc2VzLlxyXG4gKlxyXG4gKiBXaGVuIG1ha2luZyBhIHJlcXVlc3QgdG8gYSBVUkwgd2l0aCBhIGhvc3RuYW1lIGV4YWN0bHkgbWF0Y2hpbmcgYSBrZXkgaW4gdGhlIG9iamVjdCxcclxuICogdXNlIHRoZSBnaXZlbiBJUCBhZGRyZXNzIHRvIGNvbm5lY3QsIGluc3RlYWQgb2YgdXNpbmcgRE5TIHRvIHJlc29sdmUgdGhlIGhvc3RuYW1lLlxyXG4gKlxyXG4gKiBBIHNwZWNpYWwgaG9zdCBgKmAgbWF0Y2hlcyBldmVyeSBob3N0bmFtZSAoa2VlcCByZWRpcmVjdHMgaW4gbWluZCEpXHJcbiAqXHJcbiAqICAgICAgcmVxdWVzdC5jb25uZWN0KHtcclxuICogICAgICAgICd0ZXN0LmV4YW1wbGUuY29tJzogJzEyNy4wLjAuMScsXHJcbiAqICAgICAgICAnaXB2Ni5leGFtcGxlLmNvbSc6ICc6OjEnLFxyXG4gKiAgICAgIH0pXHJcbiAqL1xyXG5SZXF1ZXN0LnByb3RvdHlwZS5jb25uZWN0ID0gZnVuY3Rpb24gKGNvbm5lY3RPdmVycmlkZSkge1xyXG4gIGlmICh0eXBlb2YgY29ubmVjdE92ZXJyaWRlID09PSAnc3RyaW5nJykge1xyXG4gICAgdGhpcy5fY29ubmVjdE92ZXJyaWRlID0geyAnKic6IGNvbm5lY3RPdmVycmlkZSB9O1xyXG4gIH0gZWxzZSBpZiAodHlwZW9mIGNvbm5lY3RPdmVycmlkZSA9PT0gJ29iamVjdCcpIHtcclxuICAgIHRoaXMuX2Nvbm5lY3RPdmVycmlkZSA9IGNvbm5lY3RPdmVycmlkZTtcclxuICB9IGVsc2Uge1xyXG4gICAgdGhpcy5fY29ubmVjdE92ZXJyaWRlID0gdW5kZWZpbmVkO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS50cnVzdExvY2FsaG9zdCA9IGZ1bmN0aW9uICh0b2dnbGUpIHtcclxuICB0aGlzLl90cnVzdExvY2FsaG9zdCA9IHRvZ2dsZSA9PT0gdW5kZWZpbmVkID8gdHJ1ZSA6IHRvZ2dsZTtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8vIGdlbmVyYXRlIEhUVFAgdmVyYiBtZXRob2RzXHJcbmlmICghbWV0aG9kcy5pbmNsdWRlcygnZGVsJykpIHtcclxuICAvLyBjcmVhdGUgYSBjb3B5IHNvIHdlIGRvbid0IGNhdXNlIGNvbmZsaWN0cyB3aXRoXHJcbiAgLy8gb3RoZXIgcGFja2FnZXMgdXNpbmcgdGhlIG1ldGhvZHMgcGFja2FnZSBhbmRcclxuICAvLyBucG0gMy54XHJcbiAgbWV0aG9kcyA9IFsuLi5tZXRob2RzXTtcclxuICBtZXRob2RzLnB1c2goJ2RlbCcpO1xyXG59XHJcblxyXG5mb3IgKGxldCBtZXRob2Qgb2YgbWV0aG9kcykge1xyXG4gIGNvbnN0IG5hbWUgPSBtZXRob2Q7XHJcbiAgbWV0aG9kID0gbWV0aG9kID09PSAnZGVsJyA/ICdkZWxldGUnIDogbWV0aG9kO1xyXG5cclxuICBtZXRob2QgPSBtZXRob2QudG9VcHBlckNhc2UoKTtcclxuICByZXF1ZXN0W25hbWVdID0gKHVybCwgZGF0YSwgZm4pID0+IHtcclxuICAgIGNvbnN0IHJlcXVlc3RfID0gcmVxdWVzdChtZXRob2QsIHVybCk7XHJcbiAgICBpZiAodHlwZW9mIGRhdGEgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgZm4gPSBkYXRhO1xyXG4gICAgICBkYXRhID0gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoZGF0YSkge1xyXG4gICAgICBpZiAobWV0aG9kID09PSAnR0VUJyB8fCBtZXRob2QgPT09ICdIRUFEJykge1xyXG4gICAgICAgIHJlcXVlc3RfLnF1ZXJ5KGRhdGEpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJlcXVlc3RfLnNlbmQoZGF0YSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAoZm4pIHJlcXVlc3RfLmVuZChmbik7XHJcbiAgICByZXR1cm4gcmVxdWVzdF87XHJcbiAgfTtcclxufVxyXG5cclxuLyoqXHJcbiAqIENoZWNrIGlmIGBtaW1lYCBpcyB0ZXh0IGFuZCBzaG91bGQgYmUgYnVmZmVyZWQuXHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBtaW1lXHJcbiAqIEByZXR1cm4ge0Jvb2xlYW59XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuZnVuY3Rpb24gaXNUZXh0KG1pbWUpIHtcclxuICBjb25zdCBwYXJ0cyA9IG1pbWUuc3BsaXQoJy8nKTtcclxuICBsZXQgdHlwZSA9IHBhcnRzWzBdO1xyXG4gIGlmICh0eXBlKSB0eXBlID0gdHlwZS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcclxuICBsZXQgc3VidHlwZSA9IHBhcnRzWzFdO1xyXG4gIGlmIChzdWJ0eXBlKSBzdWJ0eXBlID0gc3VidHlwZS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcclxuXHJcbiAgcmV0dXJuIHR5cGUgPT09ICd0ZXh0JyB8fCBzdWJ0eXBlID09PSAneC13d3ctZm9ybS11cmxlbmNvZGVkJztcclxufVxyXG5cclxuLy8gVGhpcyBpcyBub3QgYSBjYXRjaGFsbCwgYnV0IGEgc3RhcnQuIEl0IG1pZ2h0IGJlIHVzZWZ1bFxyXG4vLyBpbiB0aGUgbG9uZyBydW4gdG8gaGF2ZSBmaWxlIHRoYXQgaW5jbHVkZXMgYWxsIGJpbmFyeVxyXG4vLyBjb250ZW50IHR5cGVzIGZyb20gaHR0cHM6Ly93d3cuaWFuYS5vcmcvYXNzaWdubWVudHMvbWVkaWEtdHlwZXMvbWVkaWEtdHlwZXMueGh0bWxcclxuZnVuY3Rpb24gaXNCaW5hcnkobWltZSkge1xyXG4gIGxldCBbcmVnaXN0cnksIG5hbWVdID0gbWltZS5zcGxpdCgnLycpO1xyXG4gIGlmIChyZWdpc3RyeSkgcmVnaXN0cnkgPSByZWdpc3RyeS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcclxuICBpZiAobmFtZSkgbmFtZSA9IG5hbWUudG9Mb3dlckNhc2UoKS50cmltKCk7XHJcbiAgcmV0dXJuIChcclxuICAgIFsnYXVkaW8nLCAnZm9udCcsICdpbWFnZScsICd2aWRlbyddLmluY2x1ZGVzKHJlZ2lzdHJ5KSB8fFxyXG4gICAgWydneicsICdnemlwJ10uaW5jbHVkZXMobmFtZSlcclxuICApO1xyXG59XHJcblxyXG4vKipcclxuICogQ2hlY2sgaWYgYG1pbWVgIGlzIGpzb24gb3IgaGFzICtqc29uIHN0cnVjdHVyZWQgc3ludGF4IHN1ZmZpeC5cclxuICpcclxuICogQHBhcmFtIHtTdHJpbmd9IG1pbWVcclxuICogQHJldHVybiB7Qm9vbGVhbn1cclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuZnVuY3Rpb24gaXNKU09OKG1pbWUpIHtcclxuICAvLyBzaG91bGQgbWF0Y2ggL2pzb24gb3IgK2pzb25cclxuICAvLyBidXQgbm90IC9qc29uLXNlcVxyXG4gIHJldHVybiAvWy8rXWpzb24oJHxbXi1cXHddKS9pLnRlc3QobWltZSk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDaGVjayBpZiB3ZSBzaG91bGQgZm9sbG93IHRoZSByZWRpcmVjdCBgY29kZWAuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBjb2RlXHJcbiAqIEByZXR1cm4ge0Jvb2xlYW59XHJcbiAqIEBhcGkgcHJpdmF0ZVxyXG4gKi9cclxuXHJcbmZ1bmN0aW9uIGlzUmVkaXJlY3QoY29kZSkge1xyXG4gIHJldHVybiBbMzAxLCAzMDIsIDMwMywgMzA1LCAzMDcsIDMwOF0uaW5jbHVkZXMoY29kZSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGhhc05vbkVtcHR5UmVzcG9uc2VDb250ZW50KHJlcykge1xyXG4gIGlmIChyZXMuc3RhdHVzQ29kZSA9PT0gMjA0IHx8IHJlcy5zdGF0dXNDb2RlID09PSAzMDQpIHtcclxuICAgIC8vIFRoZXNlIGFyZW4ndCBzdXBwb3NlZCB0byBoYXZlIGFueSBib2R5XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG5cclxuICAvLyBoZWFkZXIgY29udGVudCBpcyBhIHN0cmluZywgYW5kIGRpc3RpbmN0aW9uIGJldHdlZW4gMCBhbmQgbm8gaW5mb3JtYXRpb24gaXMgY3J1Y2lhbFxyXG4gIGlmIChyZXMuaGVhZGVyc1snY29udGVudC1sZW5ndGgnXSA9PT0gJzAnKSB7XHJcbiAgICAvLyBXZSBrbm93IHRoYXQgdGhlIGJvZHkgaXMgZW1wdHkgKHVuZm9ydHVuYXRlbHksIHRoaXMgY2hlY2sgZG9lcyBub3QgY292ZXIgY2h1bmtlZCBlbmNvZGluZylcclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcblxyXG4gIHJldHVybiB0cnVlO1xyXG59XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTTtFQUFFQTtBQUFPLENBQUMsR0FBR0MsT0FBTyxDQUFDLEtBQUssQ0FBQztBQUNqQyxNQUFNQyxNQUFNLEdBQUdELE9BQU8sQ0FBQyxRQUFRLENBQUM7QUFDaEMsTUFBTUUsS0FBSyxHQUFHRixPQUFPLENBQUMsT0FBTyxDQUFDO0FBQzlCLE1BQU1HLElBQUksR0FBR0gsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNSSxFQUFFLEdBQUdKLE9BQU8sQ0FBQyxJQUFJLENBQUM7QUFDeEIsTUFBTUssSUFBSSxHQUFHTCxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU1NLElBQUksR0FBR04s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
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
  if (this._shouldRetry(error, res)) {
    return this._retry();
  }

  // Avoid the error which is emitted from 'socket hang up' to cause the fn undefined error on JS runtime.
  const fn = this._callback || noop;
  this.clearTimeout();
  if (this.called) return console.warn('superagent: double callback bug');
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
      let responseBytesLeft = this._maxResponseSize || 200000000;
      res.on('data', buf => {
        responseBytesLeft -= buf.byteLength || buf.length > 0 ? buf.length : 0;
        if (responseBytesLeft < 0) {
          // This will propagate through error event
          const error = new Error('Maximum response size reached');
          error.code = 'ETOOLARGE';
          // Parsers aren't required to observe error event,
          // so would incorrectly report success
          parserHandlesEnd = false;
          // Will not emit error event
          res.destroy(error);
          // so we do callback now
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
      this.callback(error, null);
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
    let loaded = 0;
    const progress = new Stream.Transform();
    progress._transform = (chunk, encoding, callback) => {
      loaded += chunk.length;
      this.emit('progress', {
        direction: 'upload',
        lengthComputable,
        loaded,
        total
      });
      callback(null, chunk);
    };
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
      }
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmb3JtYXQiLCJyZXF1aXJlIiwiU3RyZWFtIiwiaHR0cHMiLCJodHRwIiwiZnMiLCJ6bGliIiwidXRpbCIsInFzIiwibWltZSIsIm1ldGhvZHMiLCJGb3JtRGF0YSIsImZvcm1pZGFibGUiLCJkZWJ1ZyIsIkNvb2tpZUphciIsInNhZmVTdHJpbmdpZnkiLCJ1dGlscyIsIlJlcXVlc3RCYXNlIiwiaHR0cDIiLCJkZWNvbXByZXNzIiwiUmVzcG9uc2UiLCJtaXhpbiIsImhhc093biIsImlzQnJvdGxpRW5jb2RpbmciLCJpc0d6aXBPckRlZmxhdGVFbmNvZGluZyIsImNob29zZURlY29tcHJlc3NlciIsInJlcXVlc3QiLCJtZXRob2QiLCJ1cmwiLCJleHBvcnRzIiwiUmVxdWVzdCIsImVuZCIsImFyZ3VtZW50cyIsImxlbmd0aCIsIm1vZHVsZSIsImFnZW50Iiwibm9vcCIsImRlZmluZSIsInByb3RvY29scyIsInNlcmlhbGl6ZSIsIm9iaiIsInN0cmluZ2lmeSIsImluZGljZXMiLCJzdHJpY3ROdWxsSGFuZGxpbmciLCJwYXJzZSIsImJ1ZmZlciIsIl9pbml0SGVhZGVycyIsInJlcXVlc3RfIiwiX2hlYWRlciIsImhlYWRlciIsImNhbGwiLCJfZW5hYmxlSHR0cDIiLCJCb29sZWFuIiwicHJvY2VzcyIsImVudiIsIkhUVFAyX1RFU1QiLCJfYWdlbnQiLCJfZm9ybURhdGEiLCJ3cml0YWJsZSIsIl9yZWRpcmVjdHMiLCJyZWRpcmVjdHMiLCJjb29raWVzIiwiX3F1ZXJ5IiwicXNSYXciLCJfcmVkaXJlY3RMaXN0IiwiX3N0cmVhbVJlcXVlc3QiLCJfbG9va3VwIiwidW5kZWZpbmVkIiwib25jZSIsImNsZWFyVGltZW91dCIsImJpbmQiLCJpbmhlcml0cyIsInByb3RvdHlwZSIsImJvb2wiLCJFcnJvciIsImF0dGFjaCIsImZpZWxkIiwiZmlsZSIsIm9wdGlvbnMiLCJfZGF0YSIsIm8iLCJmaWxlbmFtZSIsImNyZWF0ZVJlYWRTdHJlYW0iLCJvbiIsImVycm9yIiwiZm9ybURhdGEiLCJfZ2V0Rm9ybURhdGEiLCJlbWl0IiwicGF0aCIsImFwcGVuZCIsImNhbGxlZCIsImNhbGxiYWNrIiwiYWJvcnQiLCJsb29rdXAiLCJ0eXBlIiwic2V0IiwiaW5jbHVkZXMiLCJnZXRUeXBlIiwiYWNjZXB0IiwicXVlcnkiLCJ2YWx1ZSIsInB1c2giLCJPYmplY3QiLCJhc3NpZ24iLCJ3cml0ZSIsImRhdGEiLCJlbmNvZGluZyIsInBpcGUiLCJzdHJlYW0iLCJwaXBlZCIsIl9waXBlQ29udGludWUiLCJyZXEiLCJyZXMiLCJpc1JlZGlyZWN0Iiwic3RhdHVzQ29kZSIsIl9tYXhSZWRpcmVjdHMiLCJfcmVkaXJlY3QiLCJfZW1pdFJlc3BvbnNlIiwiX2Fib3J0ZWQiLCJfc2hvdWxkRGVjb21wcmVzcyIsImRlY29tcHJlc3NlciIsImNvZGUiLCJfYnVmZmVyIiwiaGVhZGVycyIsImxvY2F0aW9uIiwiVVJMIiwiaHJlZiIsInJlc3VtZSIsImdldEhlYWRlcnMiLCJfaGVhZGVycyIsImNoYW5nZXNPcmlnaW4iLCJob3N0IiwiY2xlYW5IZWFkZXIiLCJfZW5kQ2FsbGVkIiwiX2VtaXRSZWRpcmVjdCIsIl9jYWxsYmFjayIsImF1dGgiLCJ1c2VyIiwicGFzcyIsImVuY29kZXIiLCJzdHJpbmciLCJCdWZmZXIiLCJmcm9tIiwidG9TdHJpbmciLCJfYXV0aCIsImNhIiwiY2VydCIsIl9jYSIsImtleSIsIl9rZXkiLCJwZngiLCJpc0J1ZmZlciIsIl9wZngiLCJfcGFzc3BocmFzZSIsInBhc3NwaHJhc2UiLCJfY2VydCIsImRpc2FibGVUTFNDZXJ0cyIsIl9kaXNhYmxlVExTQ2VydHMiLCJfZmluYWxpemVRdWVyeVN0cmluZyIsImVyciIsInVybFN0cmluZyIsInJldHJpZXMiLCJfcmV0cmllcyIsImluZGV4T2YiLCJwcm90b2NvbCIsInBhdGhuYW1lIiwic2VhcmNoIiwidGVzdCIsInNwbGl0Iiwic29ja2V0UGF0aCIsImhvc3RuYW1lIiwicmVwbGFjZSIsIl9jb25uZWN0T3ZlcnJpZGUiLCJtYXRjaCIsIm5ld0hvc3QiLCJuZXdQb3J0IiwicG9ydCIsIm5vcm1hbGl6ZUhvc3RuYW1lIiwicmVqZWN0VW5hdXRob3JpemVkIiwiTk9ERV9UTFNfUkVKRUNUX1VOQVVUSE9SSVpFRCIsInNlcnZlcm5hbWUiLCJfdHJ1c3RMb2NhbGhvc3QiLCJtb2R1bGVfIiwic2V0UHJvdG9jb2wiLCJzZXROb0RlbGF5Iiwic2V0SGVhZGVyIiwicmVzcG9uc2UiLCJ1c2VybmFtZSIsInBhc3N3b3JkIiwidGVtcG9yYXJ5SmFyIiwic2V0Q29va2llcyIsImNvb2tpZSIsImdldENvb2tpZXMiLCJDb29raWVBY2Nlc3NJbmZvIiwiQWxsIiwidG9WYWx1ZVN0cmluZyIsIl9zaG91bGRSZXRyeSIsIl9yZXRyeSIsImZuIiwiY29uc29sZSIsIndhcm4iLCJfaXNSZXNwb25zZU9LIiwibWVzc2FnZSIsIlNUQVRVU19DT0RFUyIsInN0YXR1cyIsIl9tYXhSZXRyaWVzIiwibGlzdGVuZXJzIiwiX2lzSG9zdCIsIm9iamVjdCIsImJvZHkiLCJmaWxlcyIsIl9lbmQiLCJfc2V0VGltZW91dHMiLCJfaGVhZGVyU2VudCIsImNvbnRlbnRUeXBlIiwiZ2V0SGVhZGVyIiwiX3NlcmlhbGl6ZXIiLCJpc0pTT04iLCJieXRlTGVuZ3RoIiwiX3Jlc3BvbnNlVGltZW91dFRpbWVyIiwibWF4IiwidG9Mb3dlckNhc2UiLCJ0cmltIiwibXVsdGlwYXJ0IiwicmVkaXJlY3QiLCJyZXNwb25zZVR5cGUiLCJfcmVzcG9uc2VUeXBlIiwicGFyc2VyIiwiX3BhcnNlciIsImltYWdlIiwiZm9ybSIsImJyaWRnZVN0cmVhbSIsIlBhc3NUaHJvdWdoIiwiaHR0cFZlcnNpb24iLCJzb2NrZXQiLCJyZWFkYWJsZSIsImZpZWxkcyIsImZsYXR0ZW5lZEZpZWxkcyIsIkFycmF5IiwiaXNBcnJheSIsImZsYXR0ZW5lZEZpbGVzIiwiaXNCaW5hcnkiLCJ0ZXh0IiwiaXNUZXh0IiwiX3Jlc0J1ZmZlcmVkIiwicGFyc2VySGFuZGxlc0VuZCIsInJlc3BvbnNlQnl0ZXNMZWZ0IiwiX21heFJlc3BvbnNlU2l6ZSIsImJ1ZiIsImRlc3Ryb3kiLCJ0aW1lZG91dCIsImdldFByb2dyZXNzTW9uaXRvciIsImxlbmd0aENvbXB1dGFibGUiLCJ0b3RhbCIsImxvYWRlZCIsInByb2dyZXNzIiwiVHJhbnNmb3JtIiwiX3RyYW5zZm9ybSIsImNodW5rIiwiZGlyZWN0aW9uIiwiYnVmZmVyVG9DaHVua3MiLCJjaHVua1NpemUiLCJjaHVua2luZyIsIlJlYWRhYmxlIiwidG90YWxMZW5ndGgiLCJyZW1haW5kZXIiLCJjdXRvZmYiLCJpIiwic2xpY2UiLCJyZW1haW5kZXJCdWZmZXIiLCJnZXRMZW5ndGgiLCJoYXNOb25FbXB0eVJlc3BvbnNlQ29udGVudCIsImNvbm5lY3QiLCJjb25uZWN0T3ZlcnJpZGUiLCJ0cnVzdExvY2FsaG9zdCIsInRvZ2dsZSIsIm5hbWUiLCJ0b1VwcGVyQ2FzZSIsInNlbmQiLCJwYXJ0cyIsInN1YnR5cGUiLCJyZWdpc3RyeSJdLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9ub2RlL2luZGV4LmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBNb2R1bGUgZGVwZW5kZW5jaWVzLlxyXG4gKi9cclxuXHJcbmNvbnN0IHsgZm9ybWF0IH0gPSByZXF1aXJlKCd1cmwnKTtcclxuY29uc3QgU3RyZWFtID0gcmVxdWlyZSgnc3RyZWFtJyk7XHJcbmNvbnN0IGh0dHBzID0gcmVxdWlyZSgnaHR0cHMnKTtcclxuY29uc3QgaHR0cCA9IHJlcXVpcmUoJ2h0dHAnKTtcclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcycpO1xyXG5jb25zdCB6bGliID0gcmVxdWlyZSgnemxpYicpO1xyXG5jb25zdCB1dGlsID0gcmVxdWlyZSgndXRpbCcpO1xyXG5jb25zdCBxcyA9IHJlcXVpcmUoJ3FzJyk7XHJcbmNvbnN0IG1pbWUgPSByZXF1aXJlKCdtaW1lJyk7XHJcbmxldCBtZXRob2RzID0gcmVxdWlyZSgnbWV0aG9kcycpO1xyXG5jb25zdCBGb3JtRGF0YSA9IHJlcXVpcmUoJ2Zvcm0tZGF0YScpO1xyXG5jb25zdCBmb3JtaWRhYmxlID0gcmVxdWlyZSgnZm9ybWlkYWJsZScpO1xyXG5jb25zdCBkZWJ1ZyA9IHJlcXVpcmUoJ2RlYnVnJykoJ3N1cGVyYWdlbnQnKTtcclxuY29uc3QgQ29va2llSmFyID0gcmVxdWlyZSgnY29va2llamFyJyk7XHJcbmNvbnN0IHNhZmVTdHJpbmdpZnkgPSByZXF1aXJlKCdmYXN0LXNhZmUtc3RyaW5naWZ5Jyk7XHJcblxyXG5jb25zdCB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzJyk7XHJcbmNvbnN0IFJlcXVlc3RCYXNlID0gcmVxdWlyZSgnLi4vcmVxdWVzdC1iYXNlJyk7XHJcbmNvbnN0IGh0dHAyID0gcmVxdWlyZSgnLi9odHRwMndyYXBwZXInKTtcclxuY29uc3QgeyBkZWNvbXByZXNzIH0gPSByZXF1aXJlKCcuL3VuemlwJyk7XHJcbmNvbnN0IFJlc3BvbnNlID0gcmVxdWlyZSgnLi9yZXNwb25zZScpO1xyXG5cclxuY29uc3QgeyBtaXhpbiwgaGFzT3duLCBpc0Jyb3RsaUVuY29kaW5nLCBpc0d6aXBPckRlZmxhdGVFbmNvZGluZyB9ID0gdXRpbHM7XHJcbmNvbnN0IHsgY2hvb3NlRGVjb21wcmVzc2VyIH0gPSByZXF1aXJlKCcuL2RlY29tcHJlc3MnKTtcclxuXHJcbmZ1bmN0aW9uIHJlcXVlc3QobWV0aG9kLCB1cmwpIHtcclxuICAvLyBjYWxsYmFja1xyXG4gIGlmICh0eXBlb2YgdXJsID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICByZXR1cm4gbmV3IGV4cG9ydHMuUmVxdWVzdCgnR0VUJywgbWV0aG9kKS5lbmQodXJsKTtcclxuICB9XHJcblxyXG4gIC8vIHVybCBmaXJzdFxyXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAxKSB7XHJcbiAgICByZXR1cm4gbmV3IGV4cG9ydHMuUmVxdWVzdCgnR0VUJywgbWV0aG9kKTtcclxuICB9XHJcblxyXG4gIHJldHVybiBuZXcgZXhwb3J0cy5SZXF1ZXN0KG1ldGhvZCwgdXJsKTtcclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSByZXF1ZXN0O1xyXG5leHBvcnRzID0gbW9kdWxlLmV4cG9ydHM7XHJcblxyXG4vKipcclxuICogRXhwb3NlIGBSZXF1ZXN0YC5cclxuICovXHJcblxyXG5leHBvcnRzLlJlcXVlc3QgPSBSZXF1ZXN0O1xyXG5cclxuLyoqXHJcbiAqIEV4cG9zZSB0aGUgYWdlbnQgZnVuY3Rpb25cclxuICovXHJcblxyXG5leHBvcnRzLmFnZW50ID0gcmVxdWlyZSgnLi9hZ2VudCcpO1xyXG5cclxuLyoqXHJcbiAqIE5vb3AuXHJcbiAqL1xyXG5cclxuZnVuY3Rpb24gbm9vcCgpIHt9XHJcblxyXG4vKipcclxuICogRXhwb3NlIGBSZXNwb25zZWAuXHJcbiAqL1xyXG5cclxuZXhwb3J0cy5SZXNwb25zZSA9IFJlc3BvbnNlO1xyXG5cclxuLyoqXHJcbiAqIERlZmluZSBcImZvcm1cIiBtaW1lIHR5cGUuXHJcbiAqL1xyXG5cclxubWltZS5kZWZpbmUoXHJcbiAge1xyXG4gICAgJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCc6IFsnZm9ybScsICd1cmxlbmNvZGVkJywgJ2Zvcm0tZGF0YSddXHJcbiAgfSxcclxuICB0cnVlXHJcbik7XHJcblxyXG4vKipcclxuICogUHJvdG9jb2wgbWFwLlxyXG4gKi9cclxuXHJcbmV4cG9ydHMucHJvdG9jb2xzID0ge1xyXG4gICdodHRwOic6IGh0dHAsXHJcbiAgJ2h0dHBzOic6IGh0dHBzLFxyXG4gICdodHRwMjonOiBodHRwMlxyXG59O1xyXG5cclxuLyoqXHJcbiAqIERlZmF1bHQgc2VyaWFsaXphdGlvbiBtYXAuXHJcbiAqXHJcbiAqICAgICBzdXBlcmFnZW50LnNlcmlhbGl6ZVsnYXBwbGljYXRpb24veG1sJ10gPSBmdW5jdGlvbihvYmope1xyXG4gKiAgICAgICByZXR1cm4gJ2dlbmVyYXRlZCB4bWwgaGVyZSc7XHJcbiAqICAgICB9O1xyXG4gKlxyXG4gKi9cclxuXHJcbmV4cG9ydHMuc2VyaWFsaXplID0ge1xyXG4gICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnOiAob2JqKSA9PiB7XHJcbiAgICByZXR1cm4gcXMuc3RyaW5naWZ5KG9iaiwgeyBpbmRpY2VzOiBmYWxzZSwgc3RyaWN0TnVsbEhhbmRsaW5nOiB0cnVlIH0pO1xyXG4gIH0sXHJcbiAgJ2FwcGxpY2F0aW9uL2pzb24nOiBzYWZlU3RyaW5naWZ5XHJcbn07XHJcblxyXG4vKipcclxuICogRGVmYXVsdCBwYXJzZXJzLlxyXG4gKlxyXG4gKiAgICAgc3VwZXJhZ2VudC5wYXJzZVsnYXBwbGljYXRpb24veG1sJ10gPSBmdW5jdGlvbihyZXMsIGZuKXtcclxuICogICAgICAgZm4obnVsbCwgcmVzKTtcclxuICogICAgIH07XHJcbiAqXHJcbiAqL1xyXG5cclxuZXhwb3J0cy5wYXJzZSA9IHJlcXVpcmUoJy4vcGFyc2VycycpO1xyXG5cclxuLyoqXHJcbiAqIERlZmF1bHQgYnVmZmVyaW5nIG1hcC4gQ2FuIGJlIHVzZWQgdG8gc2V0IGNlcnRhaW5cclxuICogcmVzcG9uc2UgdHlwZXMgdG8gYnVmZmVyL25vdCBidWZmZXIuXHJcbiAqXHJcbiAqICAgICBzdXBlcmFnZW50LmJ1ZmZlclsnYXBwbGljYXRpb24veG1sJ10gPSB0cnVlO1xyXG4gKi9cclxuZXhwb3J0cy5idWZmZXIgPSB7fTtcclxuXHJcbi8qKlxyXG4gKiBJbml0aWFsaXplIGludGVybmFsIGhlYWRlciB0cmFja2luZyBwcm9wZXJ0aWVzIG9uIGEgcmVxdWVzdCBpbnN0YW5jZS5cclxuICpcclxuICogQHBhcmFtIHtPYmplY3R9IHJlcSB0aGUgaW5zdGFuY2VcclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5mdW5jdGlvbiBfaW5pdEhlYWRlcnMocmVxdWVzdF8pIHtcclxuICByZXF1ZXN0Xy5faGVhZGVyID0ge1xyXG4gICAgLy8gY29lcmNlcyBoZWFkZXIgbmFtZXMgdG8gbG93ZXJjYXNlXHJcbiAgfTtcclxuICByZXF1ZXN0Xy5oZWFkZXIgPSB7XHJcbiAgICAvLyBwcmVzZXJ2ZXMgaGVhZGVyIG5hbWUgY2FzZVxyXG4gIH07XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBJbml0aWFsaXplIGEgbmV3IGBSZXF1ZXN0YCB3aXRoIHRoZSBnaXZlbiBgbWV0aG9kYCBhbmQgYHVybGAuXHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBtZXRob2RcclxuICogQHBhcmFtIHtTdHJpbmd8T2JqZWN0fSB1cmxcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5mdW5jdGlvbiBSZXF1ZXN0KG1ldGhvZCwgdXJsKSB7XHJcbiAgU3RyZWFtLmNhbGwodGhpcyk7XHJcbiAgaWYgKHR5cGVvZiB1cmwgIT09ICdzdHJpbmcnKSB1cmwgPSBmb3JtYXQodXJsKTtcclxuICB0aGlzLl9lbmFibGVIdHRwMiA9IEJvb2xlYW4ocHJvY2Vzcy5lbnYuSFRUUDJfVEVTVCk7IC8vIGludGVybmFsIG9ubHlcclxuICB0aGlzLl9hZ2VudCA9IGZhbHNlO1xyXG4gIHRoaXMuX2Zvcm1EYXRhID0gbnVsbDtcclxuICB0aGlzLm1ldGhvZCA9IG1ldGhvZDtcclxuICB0aGlzLnVybCA9IHVybDtcclxuICBfaW5pdEhlYWRlcnModGhpcyk7XHJcbiAgdGhpcy53cml0YWJsZSA9IHRydWU7XHJcbiAgdGhpcy5fcmVkaXJlY3RzID0gMDtcclxuICB0aGlzLnJlZGlyZWN0cyhtZXRob2QgPT09ICdIRUFEJyA/IDAgOiA1KTtcclxuICB0aGlzLmNvb2tpZXMgPSAnJztcclxuICB0aGlzLnFzID0ge307XHJcbiAgdGhpcy5fcXVlcnkgPSBbXTtcclxuICB0aGlzLnFzUmF3ID0gdGhpcy5fcXVlcnk7IC8vIFVudXNlZCwgZm9yIGJhY2t3YXJkcyBjb21wYXRpYmlsaXR5IG9ubHlcclxuICB0aGlzLl9yZWRpcmVjdExpc3QgPSBbXTtcclxuICB0aGlzLl9zdHJlYW1SZXF1ZXN0ID0gZmFsc2U7XHJcbiAgdGhpcy5fbG9va3VwID0gdW5kZWZpbmVkO1xyXG4gIHRoaXMub25jZSgnZW5kJywgdGhpcy5jbGVhclRpbWVvdXQuYmluZCh0aGlzKSk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBJbmhlcml0IGZyb20gYFN0cmVhbWAgKHdoaWNoIGluaGVyaXRzIGZyb20gYEV2ZW50RW1pdHRlcmApLlxyXG4gKiBNaXhpbiBgUmVxdWVzdEJhc2VgLlxyXG4gKi9cclxudXRpbC5pbmhlcml0cyhSZXF1ZXN0LCBTdHJlYW0pO1xyXG5cclxubWl4aW4oUmVxdWVzdC5wcm90b3R5cGUsIFJlcXVlc3RCYXNlLnByb3RvdHlwZSk7XHJcblxyXG4vKipcclxuICogRW5hYmxlIG9yIERpc2FibGUgaHR0cDIuXHJcbiAqXHJcbiAqIEVuYWJsZSBodHRwMi5cclxuICpcclxuICogYGBgIGpzXHJcbiAqIHJlcXVlc3QuZ2V0KCdodHRwOi8vbG9jYWxob3N0LycpXHJcbiAqICAgLmh0dHAyKClcclxuICogICAuZW5kKGNhbGxiYWNrKTtcclxuICpcclxuICogcmVxdWVzdC5nZXQoJ2h0dHA6Ly9sb2NhbGhvc3QvJylcclxuICogICAuaHR0cDIodHJ1ZSlcclxuICogICAuZW5kKGNhbGxiYWNrKTtcclxuICogYGBgXHJcbiAqXHJcbiAqIERpc2FibGUgaHR0cDIuXHJcbiAqXHJcbiAqIGBgYCBqc1xyXG4gKiByZXF1ZXN0ID0gcmVxdWVzdC5odHRwMigpO1xyXG4gKiByZXF1ZXN0LmdldCgnaHR0cDovL2xvY2FsaG9zdC8nKVxyXG4gKiAgIC5odHRwMihmYWxzZSlcclxuICogICAuZW5kKGNhbGxiYWNrKTtcclxuICogYGBgXHJcbiAqXHJcbiAqIEBwYXJhbSB7Qm9vbGVhbn0gZW5hYmxlXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3QucHJvdG90eXBlLmh0dHAyID0gZnVuY3Rpb24gKGJvb2wpIHtcclxuICBpZiAoZXhwb3J0cy5wcm90b2NvbHNbJ2h0dHAyOiddID09PSB1bmRlZmluZWQpIHtcclxuICAgIHRocm93IG5ldyBFcnJvcihcclxuICAgICAgJ3N1cGVyYWdlbnQ6IHRoaXMgdmVyc2lvbiBvZiBOb2RlLmpzIGRvZXMgbm90IHN1cHBvcnQgaHR0cDInXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgdGhpcy5fZW5hYmxlSHR0cDIgPSBib29sID09PSB1bmRlZmluZWQgPyB0cnVlIDogYm9vbDtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBRdWV1ZSB0aGUgZ2l2ZW4gYGZpbGVgIGFzIGFuIGF0dGFjaG1lbnQgdG8gdGhlIHNwZWNpZmllZCBgZmllbGRgLFxyXG4gKiB3aXRoIG9wdGlvbmFsIGBvcHRpb25zYCAob3IgZmlsZW5hbWUpLlxyXG4gKlxyXG4gKiBgYGAganNcclxuICogcmVxdWVzdC5wb3N0KCdodHRwOi8vbG9jYWxob3N0L3VwbG9hZCcpXHJcbiAqICAgLmF0dGFjaCgnZmllbGQnLCBCdWZmZXIuZnJvbSgnPGI+SGVsbG8gd29ybGQ8L2I+JyksICdoZWxsby5odG1sJylcclxuICogICAuZW5kKGNhbGxiYWNrKTtcclxuICogYGBgXHJcbiAqXHJcbiAqIEEgZmlsZW5hbWUgbWF5IGFsc28gYmUgdXNlZDpcclxuICpcclxuICogYGBgIGpzXHJcbiAqIHJlcXVlc3QucG9zdCgnaHR0cDovL2xvY2FsaG9zdC91cGxvYWQnKVxyXG4gKiAgIC5hdHRhY2goJ2ZpbGVzJywgJ2ltYWdlLmpwZycpXHJcbiAqICAgLmVuZChjYWxsYmFjayk7XHJcbiAqIGBgYFxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gZmllbGRcclxuICogQHBhcmFtIHtTdHJpbmd8ZnMuUmVhZFN0cmVhbXxCdWZmZXJ9IGZpbGVcclxuICogQHBhcmFtIHtTdHJpbmd8T2JqZWN0fSBvcHRpb25zXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3QucHJvdG90eXBlLmF0dGFjaCA9IGZ1bmN0aW9uIChmaWVsZCwgZmlsZSwgb3B0aW9ucykge1xyXG4gIGlmIChmaWxlKSB7XHJcbiAgICBpZiAodGhpcy5fZGF0YSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzdXBlcmFnZW50IGNhbid0IG1peCAuc2VuZCgpIGFuZCAuYXR0YWNoKClcIik7XHJcbiAgICB9XHJcblxyXG4gICAgbGV0IG8gPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgaWYgKHR5cGVvZiBvcHRpb25zID09PSAnc3RyaW5nJykge1xyXG4gICAgICBvID0geyBmaWxlbmFtZTogb3B0aW9ucyB9O1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh0eXBlb2YgZmlsZSA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgaWYgKCFvLmZpbGVuYW1lKSBvLmZpbGVuYW1lID0gZmlsZTtcclxuICAgICAgZGVidWcoJ2NyZWF0aW5nIGBmcy5SZWFkU3RyZWFtYCBpbnN0YW5jZSBmb3IgZmlsZTogJXMnLCBmaWxlKTtcclxuICAgICAgZmlsZSA9IGZzLmNyZWF0ZVJlYWRTdHJlYW0oZmlsZSk7XHJcbiAgICAgIGZpbGUub24oJ2Vycm9yJywgKGVycm9yKSA9PiB7XHJcbiAgICAgICAgY29uc3QgZm9ybURhdGEgPSB0aGlzLl9nZXRGb3JtRGF0YSgpO1xyXG4gICAgICAgIGZvcm1EYXRhLmVtaXQoJ2Vycm9yJywgZXJyb3IpO1xyXG4gICAgICB9KTtcclxuICAgIH0gZWxzZSBpZiAoIW8uZmlsZW5hbWUgJiYgZmlsZS5wYXRoKSB7XHJcbiAgICAgIG8uZmlsZW5hbWUgPSBmaWxlLnBhdGg7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5fZ2V0Rm9ybURhdGEoKS5hcHBlbmQoZmllbGQsIGZpbGUsIG8pO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS5fZ2V0Rm9ybURhdGEgPSBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKCF0aGlzLl9mb3JtRGF0YSkge1xyXG4gICAgdGhpcy5fZm9ybURhdGEgPSBuZXcgRm9ybURhdGEoKTtcclxuICAgIHRoaXMuX2Zvcm1EYXRhLm9uKCdlcnJvcicsIChlcnJvcikgPT4ge1xyXG4gICAgICBkZWJ1ZygnRm9ybURhdGEgZXJyb3InLCBlcnJvcik7XHJcbiAgICAgIGlmICh0aGlzLmNhbGxlZCkge1xyXG4gICAgICAgIC8vIFRoZSByZXF1ZXN0IGhhcyBhbHJlYWR5IGZpbmlzaGVkIGFuZCB0aGUgY2FsbGJhY2sgd2FzIGNhbGxlZC5cclxuICAgICAgICAvLyBTaWxlbnRseSBpZ25vcmUgdGhlIGVycm9yLlxyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG5cclxuICAgICAgdGhpcy5jYWxsYmFjayhlcnJvcik7XHJcbiAgICAgIHRoaXMuYWJvcnQoKTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHRoaXMuX2Zvcm1EYXRhO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEdldHMvc2V0cyB0aGUgYEFnZW50YCB0byB1c2UgZm9yIHRoaXMgSFRUUCByZXF1ZXN0LiBUaGUgZGVmYXVsdCAoaWYgdGhpc1xyXG4gKiBmdW5jdGlvbiBpcyBub3QgY2FsbGVkKSBpcyB0byBvcHQgb3V0IG9mIGNvbm5lY3Rpb24gcG9vbGluZyAoYGFnZW50OiBmYWxzZWApLlxyXG4gKlxyXG4gKiBAcGFyYW0ge2h0dHAuQWdlbnR9IGFnZW50XHJcbiAqIEByZXR1cm4ge2h0dHAuQWdlbnR9XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuYWdlbnQgPSBmdW5jdGlvbiAoYWdlbnQpIHtcclxuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHRoaXMuX2FnZW50O1xyXG4gIHRoaXMuX2FnZW50ID0gYWdlbnQ7XHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG4vKipcclxuICogR2V0cy9zZXRzIHRoZSBgbG9va3VwYCBmdW5jdGlvbiB0byB1c2UgY3VzdG9tIEROUyByZXNvbHZlci5cclxuICpcclxuICogQHBhcmFtIHtGdW5jdGlvbn0gbG9va3VwXHJcbiAqIEByZXR1cm4ge0Z1bmN0aW9ufVxyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3QucHJvdG90eXBlLmxvb2t1cCA9IGZ1bmN0aW9uIChsb29rdXApIHtcclxuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHRoaXMuX2xvb2t1cDtcclxuICB0aGlzLl9sb29rdXAgPSBsb29rdXA7XHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG4vKipcclxuICogU2V0IF9Db250ZW50LVR5cGVfIHJlc3BvbnNlIGhlYWRlciBwYXNzZWQgdGhyb3VnaCBgbWltZS5nZXRUeXBlKClgLlxyXG4gKlxyXG4gKiBFeGFtcGxlczpcclxuICpcclxuICogICAgICByZXF1ZXN0LnBvc3QoJy8nKVxyXG4gKiAgICAgICAgLnR5cGUoJ3htbCcpXHJcbiAqICAgICAgICAuc2VuZCh4bWxzdHJpbmcpXHJcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcclxuICpcclxuICogICAgICByZXF1ZXN0LnBvc3QoJy8nKVxyXG4gKiAgICAgICAgLnR5cGUoJ2pzb24nKVxyXG4gKiAgICAgICAgLnNlbmQoanNvbnN0cmluZylcclxuICogICAgICAgIC5lbmQoY2FsbGJhY2spO1xyXG4gKlxyXG4gKiAgICAgIHJlcXVlc3QucG9zdCgnLycpXHJcbiAqICAgICAgICAudHlwZSgnYXBwbGljYXRpb24vanNvbicpXHJcbiAqICAgICAgICAuc2VuZChqc29uc3RyaW5nKVxyXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSB0eXBlXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3QucHJvdG90eXBlLnR5cGUgPSBmdW5jdGlvbiAodHlwZSkge1xyXG4gIHJldHVybiB0aGlzLnNldChcclxuICAgICdDb250ZW50LVR5cGUnLFxyXG4gICAgdHlwZS5pbmNsdWRlcygnLycpID8gdHlwZSA6IG1pbWUuZ2V0VHlwZSh0eXBlKVxyXG4gICk7XHJcbn07XHJcblxyXG4vKipcclxuICogU2V0IF9BY2NlcHRfIHJlc3BvbnNlIGhlYWRlciBwYXNzZWQgdGhyb3VnaCBgbWltZS5nZXRUeXBlKClgLlxyXG4gKlxyXG4gKiBFeGFtcGxlczpcclxuICpcclxuICogICAgICBzdXBlcmFnZW50LnR5cGVzLmpzb24gPSAnYXBwbGljYXRpb24vanNvbic7XHJcbiAqXHJcbiAqICAgICAgcmVxdWVzdC5nZXQoJy9hZ2VudCcpXHJcbiAqICAgICAgICAuYWNjZXB0KCdqc29uJylcclxuICogICAgICAgIC5lbmQoY2FsbGJhY2spO1xyXG4gKlxyXG4gKiAgICAgIHJlcXVlc3QuZ2V0KCcvYWdlbnQnKVxyXG4gKiAgICAgICAgLmFjY2VwdCgnYXBwbGljYXRpb24vanNvbicpXHJcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcclxuICpcclxuICogQHBhcmFtIHtTdHJpbmd9IGFjY2VwdFxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS5hY2NlcHQgPSBmdW5jdGlvbiAodHlwZSkge1xyXG4gIHJldHVybiB0aGlzLnNldCgnQWNjZXB0JywgdHlwZS5pbmNsdWRlcygnLycpID8gdHlwZSA6IG1pbWUuZ2V0VHlwZSh0eXBlKSk7XHJcbn07XHJcblxyXG4vKipcclxuICogQWRkIHF1ZXJ5LXN0cmluZyBgdmFsYC5cclxuICpcclxuICogRXhhbXBsZXM6XHJcbiAqXHJcbiAqICAgcmVxdWVzdC5nZXQoJy9zaG9lcycpXHJcbiAqICAgICAucXVlcnkoJ3NpemU9MTAnKVxyXG4gKiAgICAgLnF1ZXJ5KHsgY29sb3I6ICdibHVlJyB9KVxyXG4gKlxyXG4gKiBAcGFyYW0ge09iamVjdHxTdHJpbmd9IHZhbFxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS5xdWVyeSA9IGZ1bmN0aW9uICh2YWx1ZSkge1xyXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XHJcbiAgICB0aGlzLl9xdWVyeS5wdXNoKHZhbHVlKTtcclxuICB9IGVsc2Uge1xyXG4gICAgT2JqZWN0LmFzc2lnbih0aGlzLnFzLCB2YWx1ZSk7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBXcml0ZSByYXcgYGRhdGFgIC8gYGVuY29kaW5nYCB0byB0aGUgc29ja2V0LlxyXG4gKlxyXG4gKiBAcGFyYW0ge0J1ZmZlcnxTdHJpbmd9IGRhdGFcclxuICogQHBhcmFtIHtTdHJpbmd9IGVuY29kaW5nXHJcbiAqIEByZXR1cm4ge0Jvb2xlYW59XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbiAoZGF0YSwgZW5jb2RpbmcpIHtcclxuICBjb25zdCByZXF1ZXN0XyA9IHRoaXMucmVxdWVzdCgpO1xyXG4gIGlmICghdGhpcy5fc3RyZWFtUmVxdWVzdCkge1xyXG4gICAgdGhpcy5fc3RyZWFtUmVxdWVzdCA9IHRydWU7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gcmVxdWVzdF8ud3JpdGUoZGF0YSwgZW5jb2RpbmcpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFBpcGUgdGhlIHJlcXVlc3QgYm9keSB0byBgc3RyZWFtYC5cclxuICpcclxuICogQHBhcmFtIHtTdHJlYW19IHN0cmVhbVxyXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9uc1xyXG4gKiBAcmV0dXJuIHtTdHJlYW19XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUucGlwZSA9IGZ1bmN0aW9uIChzdHJlYW0sIG9wdGlvbnMpIHtcclxuICB0aGlzLnBpcGVkID0gdHJ1ZTsgLy8gSEFDSy4uLlxyXG4gIHRoaXMuYnVmZmVyKGZhbHNlKTtcclxuICB0aGlzLmVuZCgpO1xyXG4gIHJldHVybiB0aGlzLl9waXBlQ29udGludWUoc3RyZWFtLCBvcHRpb25zKTtcclxufTtcclxuXHJcblJlcXVlc3QucHJvdG90eXBlLl9waXBlQ29udGludWUgPSBmdW5jdGlvbiAoc3RyZWFtLCBvcHRpb25zKSB7XHJcbiAgdGhpcy5yZXEub25jZSgncmVzcG9uc2UnLCAocmVzKSA9PiB7XHJcbiAgICAvLyByZWRpcmVjdFxyXG4gICAgaWYgKFxyXG4gICAgICBpc1JlZGlyZWN0KHJlcy5zdGF0dXNDb2RlKSAmJlxyXG4gICAgICB0aGlzLl9yZWRpcmVjdHMrKyAhPT0gdGhpcy5fbWF4UmVkaXJlY3RzXHJcbiAgICApIHtcclxuICAgICAgcmV0dXJuIHRoaXMuX3JlZGlyZWN0KHJlcykgPT09IHRoaXNcclxuICAgICAgICA/IHRoaXMuX3BpcGVDb250aW51ZShzdHJlYW0sIG9wdGlvbnMpXHJcbiAgICAgICAgOiB1bmRlZmluZWQ7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5yZXMgPSByZXM7XHJcbiAgICB0aGlzLl9lbWl0UmVzcG9uc2UoKTtcclxuICAgIGlmICh0aGlzLl9hYm9ydGVkKSByZXR1cm47XHJcblxyXG4gICAgaWYgKHRoaXMuX3Nob3VsZERlY29tcHJlc3MocmVzKSkge1xyXG5cclxuICAgICAgbGV0IGRlY29tcHJlc3NlciA9IGNob29zZURlY29tcHJlc3NlcihyZXMpO1xyXG5cclxuICAgICAgZGVjb21wcmVzc2VyLm9uKCdlcnJvcicsIChlcnJvcikgPT4ge1xyXG4gICAgICAgIGlmIChlcnJvciAmJiBlcnJvci5jb2RlID09PSAnWl9CVUZfRVJST1InKSB7XHJcbiAgICAgICAgICAvLyB1bmV4cGVjdGVkIGVuZCBvZiBmaWxlIGlzIGlnbm9yZWQgYnkgYnJvd3NlcnMgYW5kIGN1cmxcclxuICAgICAgICAgIHN0cmVhbS5lbWl0KCdlbmQnKTtcclxuICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHN0cmVhbS5lbWl0KCdlcnJvcicsIGVycm9yKTtcclxuICAgICAgfSk7XHJcbiAgICAgIHJlcy5waXBlKGRlY29tcHJlc3NlcikucGlwZShzdHJlYW0sIG9wdGlvbnMpO1xyXG4gICAgICAvLyBkb24ndCBlbWl0ICdlbmQnIHVudGlsIGRlY29tcHJlc3NlciBoYXMgY29tcGxldGVkIHdyaXRpbmcgYWxsIGl0cyBkYXRhLlxyXG4gICAgICBkZWNvbXByZXNzZXIub25jZSgnZW5kJywgKCkgPT4gdGhpcy5lbWl0KCdlbmQnKSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICByZXMucGlwZShzdHJlYW0sIG9wdGlvbnMpO1xyXG4gICAgICByZXMub25jZSgnZW5kJywgKCkgPT4gdGhpcy5lbWl0KCdlbmQnKSk7XHJcbiAgICB9XHJcbiAgfSk7XHJcbiAgcmV0dXJuIHN0cmVhbTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBFbmFibGUgLyBkaXNhYmxlIGJ1ZmZlcmluZy5cclxuICpcclxuICogQHJldHVybiB7Qm9vbGVhbn0gW3ZhbF1cclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuYnVmZmVyID0gZnVuY3Rpb24gKHZhbHVlKSB7XHJcbiAgdGhpcy5fYnVmZmVyID0gdmFsdWUgIT09IGZhbHNlO1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJlZGlyZWN0IHRvIGB1cmxcclxuICpcclxuICogQHBhcmFtIHtJbmNvbWluZ01lc3NhZ2V9IHJlc1xyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuX3JlZGlyZWN0ID0gZnVuY3Rpb24gKHJlcykge1xyXG4gIGxldCB1cmwgPSByZXMuaGVhZGVycy5sb2NhdGlvbjtcclxuICBpZiAoIXVybCkge1xyXG4gICAgcmV0dXJuIHRoaXMuY2FsbGJhY2sobmV3IEVycm9yKCdObyBsb2NhdGlvbiBoZWFkZXIgZm9yIHJlZGlyZWN0JyksIHJlcyk7XHJcbiAgfVxyXG5cclxuICBkZWJ1ZygncmVkaXJlY3QgJXMgLT4gJXMnLCB0aGlzLnVybCwgdXJsKTtcclxuXHJcbiAgLy8gbG9jYXRpb25cclxuICB1cmwgPSBuZXcgVVJMKHVybCwgdGhpcy51cmwpLmhyZWY7XHJcblxyXG4gIC8vIGVuc3VyZSB0aGUgcmVzcG9uc2UgaXMgYmVpbmcgY29uc3VtZWRcclxuICAvLyB0aGlzIGlzIHJlcXVpcmVkIGZvciBOb2RlIHYwLjEwK1xyXG4gIHJlcy5yZXN1bWUoKTtcclxuXHJcbiAgbGV0IGhlYWRlcnMgPSB0aGlzLnJlcS5nZXRIZWFkZXJzID8gdGhpcy5yZXEuZ2V0SGVhZGVycygpIDogdGhpcy5yZXEuX2hlYWRlcnM7XHJcblxyXG4gIGNvbnN0IGNoYW5nZXNPcmlnaW4gPSBuZXcgVVJMKHVybCkuaG9zdCAhPT0gbmV3IFVSTCh0aGlzLnVybCkuaG9zdDtcclxuXHJcbiAgLy8gaW1wbGVtZW50YXRpb24gb2YgMzAyIGZvbGxvd2luZyBkZWZhY3RvIHN0YW5kYXJkXHJcbiAgaWYgKHJlcy5zdGF0dXNDb2RlID09PSAzMDEgfHwgcmVzLnN0YXR1c0NvZGUgPT09IDMwMikge1xyXG4gICAgLy8gc3RyaXAgQ29udGVudC0qIHJlbGF0ZWQgZmllbGRzXHJcbiAgICAvLyBpbiBjYXNlIG9mIFBPU1QgZXRjXHJcbiAgICBoZWFkZXJzID0gdXRpbHMuY2xlYW5IZWFkZXIoaGVhZGVycywgY2hhbmdlc09yaWdpbik7XHJcblxyXG4gICAgLy8gZm9yY2UgR0VUXHJcbiAgICB0aGlzLm1ldGhvZCA9IHRoaXMubWV0aG9kID09PSAnSEVBRCcgPyAnSEVBRCcgOiAnR0VUJztcclxuXHJcbiAgICAvLyBjbGVhciBkYXRhXHJcbiAgICB0aGlzLl9kYXRhID0gbnVsbDtcclxuICB9XHJcblxyXG4gIC8vIDMwMyBpcyBhbHdheXMgR0VUXHJcbiAgaWYgKHJlcy5zdGF0dXNDb2RlID09PSAzMDMpIHtcclxuICAgIC8vIHN0cmlwIENvbnRlbnQtKiByZWxhdGVkIGZpZWxkc1xyXG4gICAgLy8gaW4gY2FzZSBvZiBQT1NUIGV0Y1xyXG4gICAgaGVhZGVycyA9IHV0aWxzLmNsZWFuSGVhZGVyKGhlYWRlcnMsIGNoYW5nZXNPcmlnaW4pO1xyXG5cclxuICAgIC8vIGZvcmNlIG1ldGhvZFxyXG4gICAgdGhpcy5tZXRob2QgPSAnR0VUJztcclxuXHJcbiAgICAvLyBjbGVhciBkYXRhXHJcbiAgICB0aGlzLl9kYXRhID0gbnVsbDtcclxuICB9XHJcblxyXG4gIC8vIDMwNyBwcmVzZXJ2ZXMgbWV0aG9kXHJcbiAgLy8gMzA4IHByZXNlcnZlcyBtZXRob2RcclxuICBkZWxldGUgaGVhZGVycy5ob3N0O1xyXG5cclxuICBkZWxldGUgdGhpcy5yZXE7XHJcbiAgZGVsZXRlIHRoaXMuX2Zvcm1EYXRhO1xyXG5cclxuICAvLyByZW1vdmUgYWxsIGFkZCBoZWFkZXIgZXhjZXB0IFVzZXItQWdlbnRcclxuICBfaW5pdEhlYWRlcnModGhpcyk7XHJcblxyXG4gIC8vIHJlZGlyZWN0XHJcbiAgdGhpcy5yZXMgPSByZXM7XHJcbiAgdGhpcy5fZW5kQ2FsbGVkID0gZmFsc2U7XHJcbiAgdGhpcy51cmwgPSB1cmw7XHJcbiAgdGhpcy5xcyA9IHt9O1xyXG4gIHRoaXMuX3F1ZXJ5Lmxlbmd0aCA9IDA7XHJcbiAgdGhpcy5zZXQoaGVhZGVycyk7XHJcbiAgdGhpcy5fZW1pdFJlZGlyZWN0KCk7XHJcbiAgdGhpcy5fcmVkaXJlY3RMaXN0LnB1c2godGhpcy51cmwpO1xyXG4gIHRoaXMuZW5kKHRoaXMuX2NhbGxiYWNrKTtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBTZXQgQXV0aG9yaXphdGlvbiBmaWVsZCB2YWx1ZSB3aXRoIGB1c2VyYCBhbmQgYHBhc3NgLlxyXG4gKlxyXG4gKiBFeGFtcGxlczpcclxuICpcclxuICogICAuYXV0aCgndG9iaScsICdsZWFybmJvb3N0JylcclxuICogICAuYXV0aCgndG9iaTpsZWFybmJvb3N0JylcclxuICogICAuYXV0aCgndG9iaScpXHJcbiAqICAgLmF1dGgoYWNjZXNzVG9rZW4sIHsgdHlwZTogJ2JlYXJlcicgfSlcclxuICpcclxuICogQHBhcmFtIHtTdHJpbmd9IHVzZXJcclxuICogQHBhcmFtIHtTdHJpbmd9IFtwYXNzXVxyXG4gKiBAcGFyYW0ge09iamVjdH0gW29wdGlvbnNdIG9wdGlvbnMgd2l0aCBhdXRob3JpemF0aW9uIHR5cGUgJ2Jhc2ljJyBvciAnYmVhcmVyJyAoJ2Jhc2ljJyBpcyBkZWZhdWx0KVxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS5hdXRoID0gZnVuY3Rpb24gKHVzZXIsIHBhc3MsIG9wdGlvbnMpIHtcclxuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSkgcGFzcyA9ICcnO1xyXG4gIGlmICh0eXBlb2YgcGFzcyA9PT0gJ29iamVjdCcgJiYgcGFzcyAhPT0gbnVsbCkge1xyXG4gICAgLy8gcGFzcyBpcyBvcHRpb25hbCBhbmQgY2FuIGJlIHJlcGxhY2VkIHdpdGggb3B0aW9uc1xyXG4gICAgb3B0aW9ucyA9IHBhc3M7XHJcbiAgICBwYXNzID0gJyc7XHJcbiAgfVxyXG5cclxuICBpZiAoIW9wdGlvbnMpIHtcclxuICAgIG9wdGlvbnMgPSB7IHR5cGU6ICdiYXNpYycgfTtcclxuICB9XHJcblxyXG4gIGNvbnN0IGVuY29kZXIgPSAoc3RyaW5nKSA9PiBCdWZmZXIuZnJvbShzdHJpbmcpLnRvU3RyaW5nKCdiYXNlNjQnKTtcclxuXHJcbiAgcmV0dXJuIHRoaXMuX2F1dGgodXNlciwgcGFzcywgb3B0aW9ucywgZW5jb2Rlcik7XHJcbn07XHJcblxyXG4vKipcclxuICogU2V0IHRoZSBjZXJ0aWZpY2F0ZSBhdXRob3JpdHkgb3B0aW9uIGZvciBodHRwcyByZXF1ZXN0LlxyXG4gKlxyXG4gKiBAcGFyYW0ge0J1ZmZlciB8IEFycmF5fSBjZXJ0XHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3QucHJvdG90eXBlLmNhID0gZnVuY3Rpb24gKGNlcnQpIHtcclxuICB0aGlzLl9jYSA9IGNlcnQ7XHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG4vKipcclxuICogU2V0IHRoZSBjbGllbnQgY2VydGlmaWNhdGUga2V5IG9wdGlvbiBmb3IgaHR0cHMgcmVxdWVzdC5cclxuICpcclxuICogQHBhcmFtIHtCdWZmZXIgfCBTdHJpbmd9IGNlcnRcclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUua2V5ID0gZnVuY3Rpb24gKGNlcnQpIHtcclxuICB0aGlzLl9rZXkgPSBjZXJ0O1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFNldCB0aGUga2V5LCBjZXJ0aWZpY2F0ZSwgYW5kIENBIGNlcnRzIG9mIHRoZSBjbGllbnQgaW4gUEZYIG9yIFBLQ1MxMiBmb3JtYXQuXHJcbiAqXHJcbiAqIEBwYXJhbSB7QnVmZmVyIHwgU3RyaW5nfSBjZXJ0XHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3QucHJvdG90eXBlLnBmeCA9IGZ1bmN0aW9uIChjZXJ0KSB7XHJcbiAgaWYgKHR5cGVvZiBjZXJ0ID09PSAnb2JqZWN0JyAmJiAhQnVmZmVyLmlzQnVmZmVyKGNlcnQpKSB7XHJcbiAgICB0aGlzLl9wZnggPSBjZXJ0LnBmeDtcclxuICAgIHRoaXMuX3Bhc3NwaHJhc2UgPSBjZXJ0LnBhc3NwaHJhc2U7XHJcbiAgfSBlbHNlIHtcclxuICAgIHRoaXMuX3BmeCA9IGNlcnQ7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBTZXQgdGhlIGNsaWVudCBjZXJ0aWZpY2F0ZSBvcHRpb24gZm9yIGh0dHBzIHJlcXVlc3QuXHJcbiAqXHJcbiAqIEBwYXJhbSB7QnVmZmVyIHwgU3RyaW5nfSBjZXJ0XHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3QucHJvdG90eXBlLmNlcnQgPSBmdW5jdGlvbiAoY2VydCkge1xyXG4gIHRoaXMuX2NlcnQgPSBjZXJ0O1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIERvIG5vdCByZWplY3QgZXhwaXJlZCBvciBpbnZhbGlkIFRMUyBjZXJ0cy5cclxuICogc2V0cyBgcmVqZWN0VW5hdXRob3JpemVkPXRydWVgLiBCZSB3YXJuZWQgdGhhdCB0aGlzIGFsbG93cyBNSVRNIGF0dGFja3MuXHJcbiAqXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3QucHJvdG90eXBlLmRpc2FibGVUTFNDZXJ0cyA9IGZ1bmN0aW9uICgpIHtcclxuICB0aGlzLl9kaXNhYmxlVExTQ2VydHMgPSB0cnVlO1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJldHVybiBhbiBodHRwW3NdIHJlcXVlc3QuXHJcbiAqXHJcbiAqIEByZXR1cm4ge091dGdvaW5nTWVzc2FnZX1cclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIGNvbXBsZXhpdHlcclxuUmVxdWVzdC5wcm90b3R5cGUucmVxdWVzdCA9IGZ1bmN0aW9uICgpIHtcclxuICBpZiAodGhpcy5yZXEpIHJldHVybiB0aGlzLnJlcTtcclxuXHJcbiAgY29uc3Qgb3B0aW9ucyA9IHt9O1xyXG5cclxuICB0cnkge1xyXG4gICAgY29uc3QgcXVlcnkgPSBxcy5zdHJpbmdpZnkodGhpcy5xcywge1xyXG4gICAgICBpbmRpY2VzOiBmYWxzZSxcclxuICAgICAgc3RyaWN0TnVsbEhhbmRsaW5nOiB0cnVlXHJcbiAgICB9KTtcclxuICAgIGlmIChxdWVyeSkge1xyXG4gICAgICB0aGlzLnFzID0ge307XHJcbiAgICAgIHRoaXMuX3F1ZXJ5LnB1c2gocXVlcnkpO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuX2ZpbmFsaXplUXVlcnlTdHJpbmcoKTtcclxuICB9IGNhdGNoIChlcnIpIHtcclxuICAgIHJldHVybiB0aGlzLmVtaXQoJ2Vycm9yJywgZXJyKTtcclxuICB9XHJcblxyXG4gIGxldCB7IHVybDogdXJsU3RyaW5nIH0gPSB0aGlzO1xyXG4gIGNvbnN0IHJldHJpZXMgPSB0aGlzLl9yZXRyaWVzO1xyXG5cclxuICAvLyBkZWZhdWx0IHRvIGh0dHA6Ly9cclxuICBpZiAodXJsU3RyaW5nLmluZGV4T2YoJ2h0dHAnKSAhPT0gMCkgdXJsU3RyaW5nID0gYGh0dHA6Ly8ke3VybFN0cmluZ31gO1xyXG4gIGNvbnN0IHVybCA9IG5ldyBVUkwodXJsU3RyaW5nKTtcclxuICBsZXQgeyBwcm90b2NvbCB9ID0gdXJsO1xyXG4gIGxldCBwYXRoID0gYCR7dXJsLnBhdGhuYW1lfSR7dXJsLnNlYXJjaH1gO1xyXG5cclxuICAvLyBzdXBwb3J0IHVuaXggc29ja2V0c1xyXG4gIGlmICgvXmh0dHBzP1xcK3VuaXg6Ly50ZXN0KHByb3RvY29sKSA9PT0gdHJ1ZSkge1xyXG4gICAgLy8gZ2V0IHRoZSBwcm90b2NvbFxyXG4gICAgcHJvdG9jb2wgPSBgJHtwcm90b2NvbC5zcGxpdCgnKycpWzBdfTpgO1xyXG5cclxuICAgIC8vIGdldCB0aGUgc29ja2V0IHBhdGhcclxuICAgIG9wdGlvbnMuc29ja2V0UGF0aCA9IHVybC5ob3N0bmFtZS5yZXBsYWNlKC8lMkYvZywgJy8nKTtcclxuICAgIHVybC5ob3N0ID0gJyc7XHJcbiAgICB1cmwuaG9zdG5hbWUgPSAnJztcclxuICB9XHJcblxyXG4gIC8vIE92ZXJyaWRlIElQIGFkZHJlc3Mgb2YgYSBob3N0bmFtZVxyXG4gIGlmICh0aGlzLl9jb25uZWN0T3ZlcnJpZGUpIHtcclxuICAgIGNvbnN0IHsgaG9zdG5hbWUgfSA9IHVybDtcclxuICAgIGNvbnN0IG1hdGNoID1cclxuICAgICAgaG9zdG5hbWUgaW4gdGhpcy5fY29ubmVjdE92ZXJyaWRlXHJcbiAgICAgICAgPyB0aGlzLl9jb25uZWN0T3ZlcnJpZGVbaG9zdG5hbWVdXHJcbiAgICAgICAgOiB0aGlzLl9jb25uZWN0T3ZlcnJpZGVbJyonXTtcclxuICAgIGlmIChtYXRjaCkge1xyXG4gICAgICAvLyBiYWNrdXAgdGhlIHJlYWwgaG9zdFxyXG4gICAgICBpZiAoIXRoaXMuX2hlYWRlci5ob3N0KSB7XHJcbiAgICAgICAgdGhpcy5zZXQoJ2hvc3QnLCB1cmwuaG9zdCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGxldCBuZXdIb3N0O1xyXG4gICAgICBsZXQgbmV3UG9ydDtcclxuXHJcbiAgICAgIGlmICh0eXBlb2YgbWF0Y2ggPT09ICdvYmplY3QnKSB7XHJcbiAgICAgICAgbmV3SG9zdCA9IG1hdGNoLmhvc3Q7XHJcbiAgICAgICAgbmV3UG9ydCA9IG1hdGNoLnBvcnQ7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgbmV3SG9zdCA9IG1hdGNoO1xyXG4gICAgICAgIG5ld1BvcnQgPSB1cmwucG9ydDtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gd3JhcCBbaXB2Nl1cclxuICAgICAgdXJsLmhvc3QgPSAvOi8udGVzdChuZXdIb3N0KSA/IGBbJHtuZXdIb3N0fV1gIDogbmV3SG9zdDtcclxuICAgICAgaWYgKG5ld1BvcnQpIHtcclxuICAgICAgICB1cmwuaG9zdCArPSBgOiR7bmV3UG9ydH1gO1xyXG4gICAgICAgIHVybC5wb3J0ID0gbmV3UG9ydDtcclxuICAgICAgfVxyXG5cclxuICAgICAgdXJsLmhvc3RuYW1lID0gbmV3SG9zdDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIG9wdGlvbnNcclxuICBvcHRpb25zLm1ldGhvZCA9IHRoaXMubWV0aG9kO1xyXG4gIG9wdGlvbnMucG9ydCA9IHVybC5wb3J0O1xyXG4gIG9wdGlvbnMucGF0aCA9IHBhdGg7XHJcbiAgb3B0aW9ucy5ob3N0ID0gdXRpbHMubm9ybWFsaXplSG9zdG5hbWUodXJsLmhvc3RuYW1lKTsgLy8gZXg6IFs6OjFdIC0+IDo6MVxyXG4gIG9wdGlvbnMuY2EgPSB0aGlzLl9jYTtcclxuICBvcHRpb25zLmtleSA9IHRoaXMuX2tleTtcclxuICBvcHRpb25zLnBmeCA9IHRoaXMuX3BmeDtcclxuICBvcHRpb25zLmNlcnQgPSB0aGlzLl9jZXJ0O1xyXG4gIG9wdGlvbnMucGFzc3BocmFzZSA9IHRoaXMuX3Bhc3NwaHJhc2U7XHJcbiAgb3B0aW9ucy5hZ2VudCA9IHRoaXMuX2FnZW50O1xyXG4gIG9wdGlvbnMubG9va3VwID0gdGhpcy5fbG9va3VwO1xyXG4gIG9wdGlvbnMucmVqZWN0VW5hdXRob3JpemVkID1cclxuICAgIHR5cGVvZiB0aGlzLl9kaXNhYmxlVExTQ2VydHMgPT09ICdib29sZWFuJ1xyXG4gICAgICA/ICF0aGlzLl9kaXNhYmxlVExTQ2VydHNcclxuICAgICAgOiBwcm9jZXNzLmVudi5OT0RFX1RMU19SRUpFQ1RfVU5BVVRIT1JJWkVEICE9PSAnMCc7XHJcblxyXG4gIC8vIEFsbG93cyByZXF1ZXN0LmdldCgnaHR0cHM6Ly8xLjIuMy40LycpLnNldCgnSG9zdCcsICdleGFtcGxlLmNvbScpXHJcbiAgaWYgKHRoaXMuX2hlYWRlci5ob3N0KSB7XHJcbiAgICBvcHRpb25zLnNlcnZlcm5hbWUgPSB0aGlzLl9oZWFkZXIuaG9zdC5yZXBsYWNlKC86XFxkKyQvLCAnJyk7XHJcbiAgfVxyXG5cclxuICBpZiAoXHJcbiAgICB0aGlzLl90cnVzdExvY2FsaG9zdCAmJlxyXG4gICAgL14oPzpsb2NhbGhvc3R8MTI3XFwuMFxcLjBcXC5cXGQrfCgwKjopKzowKjEpJC8udGVzdCh1cmwuaG9zdG5hbWUpXHJcbiAgKSB7XHJcbiAgICBvcHRpb25zLnJlamVjdFVuYXV0aG9yaXplZCA9IGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgLy8gaW5pdGlhdGUgcmVxdWVzdFxyXG4gIGNvbnN0IG1vZHVsZV8gPSB0aGlzLl9lbmFibGVIdHRwMlxyXG4gICAgPyBleHBvcnRzLnByb3RvY29sc1snaHR0cDI6J10uc2V0UHJvdG9jb2wocHJvdG9jb2wpXHJcbiAgICA6IGV4cG9ydHMucHJvdG9jb2xzW3Byb3RvY29sXTtcclxuXHJcbiAgLy8gcmVxdWVzdFxyXG4gIHRoaXMucmVxID0gbW9kdWxlXy5yZXF1ZXN0KG9wdGlvbnMpO1xyXG4gIGNvbnN0IHsgcmVxIH0gPSB0aGlzO1xyXG5cclxuICAvLyBzZXQgdGNwIG5vIGRlbGF5XHJcbiAgcmVxLnNldE5vRGVsYXkodHJ1ZSk7XHJcblxyXG4gIGlmIChvcHRpb25zLm1ldGhvZCAhPT0gJ0hFQUQnKSB7XHJcbiAgICByZXEuc2V0SGVhZGVyKCdBY2NlcHQtRW5jb2RpbmcnLCAnZ3ppcCwgZGVmbGF0ZScpO1xyXG4gIH1cclxuXHJcbiAgdGhpcy5wcm90b2NvbCA9IHByb3RvY29sO1xyXG4gIHRoaXMuaG9zdCA9IHVybC5ob3N0O1xyXG5cclxuICAvLyBleHBvc2UgZXZlbnRzXHJcbiAgcmVxLm9uY2UoJ2RyYWluJywgKCkgPT4ge1xyXG4gICAgdGhpcy5lbWl0KCdkcmFpbicpO1xyXG4gIH0pO1xyXG5cclxuICByZXEub24oJ2Vycm9yJywgKGVycm9yKSA9PiB7XHJcbiAgICAvLyBmbGFnIGFib3J0aW9uIGhlcmUgZm9yIG91dCB0aW1lb3V0c1xyXG4gICAgLy8gYmVjYXVzZSBub2RlIHdpbGwgZW1pdCBhIGZhdXgtZXJyb3IgXCJzb2NrZXQgaGFuZyB1cFwiXHJcbiAgICAvLyB3aGVuIHJlcXVlc3QgaXMgYWJvcnRlZCBiZWZvcmUgYSBjb25uZWN0aW9uIGlzIG1hZGVcclxuICAgIGlmICh0aGlzLl9hYm9ydGVkKSByZXR1cm47XHJcbiAgICAvLyBpZiBub3QgdGhlIHNhbWUsIHdlIGFyZSBpbiB0aGUgKipvbGQqKiAoY2FuY2VsbGVkKSByZXF1ZXN0LFxyXG4gICAgLy8gc28gbmVlZCB0byBjb250aW51ZSAoc2FtZSBhcyBmb3IgYWJvdmUpXHJcbiAgICBpZiAodGhpcy5fcmV0cmllcyAhPT0gcmV0cmllcykgcmV0dXJuO1xyXG4gICAgLy8gaWYgd2UndmUgcmVjZWl2ZWQgYSByZXNwb25zZSB0aGVuIHdlIGRvbid0IHdhbnQgdG8gbGV0XHJcbiAgICAvLyBhbiBlcnJvciBpbiB0aGUgcmVxdWVzdCBibG93IHVwIHRoZSByZXNwb25zZVxyXG4gICAgaWYgKHRoaXMucmVzcG9uc2UpIHJldHVybjtcclxuICAgIHRoaXMuY2FsbGJhY2soZXJyb3IpO1xyXG4gIH0pO1xyXG5cclxuICAvLyBhdXRoXHJcbiAgaWYgKHVybC51c2VybmFtZSB8fCB1cmwucGFzc3dvcmQpIHtcclxuICAgIHRoaXMuYXV0aCh1cmwudXNlcm5hbWUsIHVybC5wYXNzd29yZCk7XHJcbiAgfVxyXG5cclxuICBpZiAodGhpcy51c2VybmFtZSAmJiB0aGlzLnBhc3N3b3JkKSB7XHJcbiAgICB0aGlzLmF1dGgodGhpcy51c2VybmFtZSwgdGhpcy5wYXNzd29yZCk7XHJcbiAgfVxyXG5cclxuICBmb3IgKGNvbnN0IGtleSBpbiB0aGlzLmhlYWRlcikge1xyXG4gICAgaWYgKGhhc093bih0aGlzLmhlYWRlciwga2V5KSkgcmVxLnNldEhlYWRlcihrZXksIHRoaXMuaGVhZGVyW2tleV0pO1xyXG4gIH1cclxuXHJcbiAgLy8gYWRkIGNvb2tpZXNcclxuICBpZiAodGhpcy5jb29raWVzKSB7XHJcbiAgICBpZiAoaGFzT3duKHRoaXMuX2hlYWRlciwgJ2Nvb2tpZScpKSB7XHJcbiAgICAgIC8vIG1lcmdlXHJcbiAgICAgIGNvbnN0IHRlbXBvcmFyeUphciA9IG5ldyBDb29raWVKYXIuQ29va2llSmFyKCk7XHJcbiAgICAgIHRlbXBvcmFyeUphci5zZXRDb29raWVzKHRoaXMuX2hlYWRlci5jb29raWUuc3BsaXQoJzsgJykpO1xyXG4gICAgICB0ZW1wb3JhcnlKYXIuc2V0Q29va2llcyh0aGlzLmNvb2tpZXMuc3BsaXQoJzsgJykpO1xyXG4gICAgICByZXEuc2V0SGVhZGVyKFxyXG4gICAgICAgICdDb29raWUnLFxyXG4gICAgICAgIHRlbXBvcmFyeUphci5nZXRDb29raWVzKENvb2tpZUphci5Db29raWVBY2Nlc3NJbmZvLkFsbCkudG9WYWx1ZVN0cmluZygpXHJcbiAgICAgICk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICByZXEuc2V0SGVhZGVyKCdDb29raWUnLCB0aGlzLmNvb2tpZXMpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHJlcTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBJbnZva2UgdGhlIGNhbGxiYWNrIHdpdGggYGVycmAgYW5kIGByZXNgXHJcbiAqIGFuZCBoYW5kbGUgYXJpdHkgY2hlY2suXHJcbiAqXHJcbiAqIEBwYXJhbSB7RXJyb3J9IGVyclxyXG4gKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXNcclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuY2FsbGJhY2sgPSBmdW5jdGlvbiAoZXJyb3IsIHJlcykge1xyXG4gIGlmICh0aGlzLl9zaG91bGRSZXRyeShlcnJvciwgcmVzKSkge1xyXG4gICAgcmV0dXJuIHRoaXMuX3JldHJ5KCk7XHJcbiAgfVxyXG5cclxuICAvLyBBdm9pZCB0aGUgZXJyb3Igd2hpY2ggaXMgZW1pdHRlZCBmcm9tICdzb2NrZXQgaGFuZyB1cCcgdG8gY2F1c2UgdGhlIGZuIHVuZGVmaW5lZCBlcnJvciBvbiBKUyBydW50aW1lLlxyXG4gIGNvbnN0IGZuID0gdGhpcy5fY2FsbGJhY2sgfHwgbm9vcDtcclxuICB0aGlzLmNsZWFyVGltZW91dCgpO1xyXG4gIGlmICh0aGlzLmNhbGxlZCkgcmV0dXJuIGNvbnNvbGUud2Fybignc3VwZXJhZ2VudDogZG91YmxlIGNhbGxiYWNrIGJ1ZycpO1xyXG4gIHRoaXMuY2FsbGVkID0gdHJ1ZTtcclxuXHJcbiAgaWYgKCFlcnJvcikge1xyXG4gICAgdHJ5IHtcclxuICAgICAgaWYgKCF0aGlzLl9pc1Jlc3BvbnNlT0socmVzKSkge1xyXG4gICAgICAgIGxldCBtZXNzYWdlID0gJ1Vuc3VjY2Vzc2Z1bCBIVFRQIHJlc3BvbnNlJztcclxuICAgICAgICBpZiAocmVzKSB7XHJcbiAgICAgICAgICBtZXNzYWdlID0gaHR0cC5TVEFUVVNfQ09ERVNbcmVzLnN0YXR1c10gfHwgbWVzc2FnZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGVycm9yID0gbmV3IEVycm9yKG1lc3NhZ2UpO1xyXG4gICAgICAgIGVycm9yLnN0YXR1cyA9IHJlcyA/IHJlcy5zdGF0dXMgOiB1bmRlZmluZWQ7XHJcbiAgICAgIH1cclxuICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICBlcnJvciA9IGVycjtcclxuICAgICAgZXJyb3Iuc3RhdHVzID0gZXJyb3Iuc3RhdHVzIHx8IChyZXMgPyByZXMuc3RhdHVzIDogdW5kZWZpbmVkKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIEl0J3MgaW1wb3J0YW50IHRoYXQgdGhlIGNhbGxiYWNrIGlzIGNhbGxlZCBvdXRzaWRlIHRyeS9jYXRjaFxyXG4gIC8vIHRvIGF2b2lkIGRvdWJsZSBjYWxsYmFja1xyXG4gIGlmICghZXJyb3IpIHtcclxuICAgIHJldHVybiBmbihudWxsLCByZXMpO1xyXG4gIH1cclxuXHJcbiAgZXJyb3IucmVzcG9uc2UgPSByZXM7XHJcbiAgaWYgKHRoaXMuX21heFJldHJpZXMpIGVycm9yLnJldHJpZXMgPSB0aGlzLl9yZXRyaWVzIC0gMTtcclxuXHJcbiAgLy8gb25seSBlbWl0IGVycm9yIGV2ZW50IGlmIHRoZXJlIGlzIGEgbGlzdGVuZXJcclxuICAvLyBvdGhlcndpc2Ugd2UgYXNzdW1lIHRoZSBjYWxsYmFjayB0byBgLmVuZCgpYCB3aWxsIGdldCB0aGUgZXJyb3JcclxuICBpZiAoZXJyb3IgJiYgdGhpcy5saXN0ZW5lcnMoJ2Vycm9yJykubGVuZ3RoID4gMCkge1xyXG4gICAgdGhpcy5lbWl0KCdlcnJvcicsIGVycm9yKTtcclxuICB9XHJcblxyXG4gIGZuKGVycm9yLCByZXMpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIENoZWNrIGlmIGBvYmpgIGlzIGEgaG9zdCBvYmplY3QsXHJcbiAqXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmogaG9zdCBvYmplY3RcclxuICogQHJldHVybiB7Qm9vbGVhbn0gaXMgYSBob3N0IG9iamVjdFxyXG4gKiBAYXBpIHByaXZhdGVcclxuICovXHJcblJlcXVlc3QucHJvdG90eXBlLl9pc0hvc3QgPSBmdW5jdGlvbiAob2JqZWN0KSB7XHJcbiAgcmV0dXJuIChcclxuICAgIEJ1ZmZlci5pc0J1ZmZlcihvYmplY3QpIHx8XHJcbiAgICBvYmplY3QgaW5zdGFuY2VvZiBTdHJlYW0gfHxcclxuICAgIG9iamVjdCBpbnN0YW5jZW9mIEZvcm1EYXRhXHJcbiAgKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBJbml0aWF0ZSByZXF1ZXN0LCBpbnZva2luZyBjYWxsYmFjayBgZm4oZXJyLCByZXMpYFxyXG4gKiB3aXRoIGFuIGluc3RhbmNlb2YgYFJlc3BvbnNlYC5cclxuICpcclxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuX2VtaXRSZXNwb25zZSA9IGZ1bmN0aW9uIChib2R5LCBmaWxlcykge1xyXG4gIGNvbnN0IHJlc3BvbnNlID0gbmV3IFJlc3BvbnNlKHRoaXMpO1xyXG4gIHRoaXMucmVzcG9uc2UgPSByZXNwb25zZTtcclxuICByZXNwb25zZS5yZWRpcmVjdHMgPSB0aGlzLl9yZWRpcmVjdExpc3Q7XHJcbiAgaWYgKHVuZGVmaW5lZCAhPT0gYm9keSkge1xyXG4gICAgcmVzcG9uc2UuYm9keSA9IGJvZHk7XHJcbiAgfVxyXG5cclxuICByZXNwb25zZS5maWxlcyA9IGZpbGVzO1xyXG4gIGlmICh0aGlzLl9lbmRDYWxsZWQpIHtcclxuICAgIHJlc3BvbnNlLnBpcGUgPSBmdW5jdGlvbiAoKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcclxuICAgICAgICBcImVuZCgpIGhhcyBhbHJlYWR5IGJlZW4gY2FsbGVkLCBzbyBpdCdzIHRvbyBsYXRlIHRvIHN0YXJ0IHBpcGluZ1wiXHJcbiAgICAgICk7XHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgdGhpcy5lbWl0KCdyZXNwb25zZScsIHJlc3BvbnNlKTtcclxuICByZXR1cm4gcmVzcG9uc2U7XHJcbn07XHJcblxyXG4vKipcclxuICogRW1pdCBgcmVkaXJlY3RgIGV2ZW50LCBwYXNzaW5nIGFuIGluc3RhbmNlb2YgYFJlc3BvbnNlYC5cclxuICpcclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuX2VtaXRSZWRpcmVjdCA9IGZ1bmN0aW9uICgpIHtcclxuICBjb25zdCByZXNwb25zZSA9IG5ldyBSZXNwb25zZSh0aGlzKTtcclxuICByZXNwb25zZS5yZWRpcmVjdHMgPSB0aGlzLl9yZWRpcmVjdExpc3Q7XHJcbiAgdGhpcy5lbWl0KCdyZWRpcmVjdCcsIHJlc3BvbnNlKTtcclxufTtcclxuXHJcblJlcXVlc3QucHJvdG90eXBlLmVuZCA9IGZ1bmN0aW9uIChmbikge1xyXG4gIHRoaXMucmVxdWVzdCgpO1xyXG4gIGRlYnVnKCclcyAlcycsIHRoaXMubWV0aG9kLCB0aGlzLnVybCk7XHJcblxyXG4gIGlmICh0aGlzLl9lbmRDYWxsZWQpIHtcclxuICAgIHRocm93IG5ldyBFcnJvcihcclxuICAgICAgJy5lbmQoKSB3YXMgY2FsbGVkIHR3aWNlLiBUaGlzIGlzIG5vdCBzdXBwb3J0ZWQgaW4gc3VwZXJhZ2VudCdcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICB0aGlzLl9lbmRDYWxsZWQgPSB0cnVlO1xyXG5cclxuICAvLyBzdG9yZSBjYWxsYmFja1xyXG4gIHRoaXMuX2NhbGxiYWNrID0gZm4gfHwgbm9vcDtcclxuXHJcbiAgdGhpcy5fZW5kKCk7XHJcbn07XHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS5fZW5kID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0aGlzLl9hYm9ydGVkKVxyXG4gICAgcmV0dXJuIHRoaXMuY2FsbGJhY2soXHJcbiAgICAgIG5ldyBFcnJvcignVGhlIHJlcXVlc3QgaGFzIGJlZW4gYWJvcnRlZCBldmVuIGJlZm9yZSAuZW5kKCkgd2FzIGNhbGxlZCcpXHJcbiAgICApO1xyXG5cclxuICBsZXQgZGF0YSA9IHRoaXMuX2RhdGE7XHJcbiAgY29uc3QgeyByZXEgfSA9IHRoaXM7XHJcbiAgY29uc3QgeyBtZXRob2QgfSA9IHRoaXM7XHJcblxyXG4gIHRoaXMuX3NldFRpbWVvdXRzKCk7XHJcblxyXG4gIC8vIGJvZHlcclxuICBpZiAobWV0aG9kICE9PSAnSEVBRCcgJiYgIXJlcS5faGVhZGVyU2VudCkge1xyXG4gICAgLy8gc2VyaWFsaXplIHN0dWZmXHJcbiAgICBpZiAodHlwZW9mIGRhdGEgIT09ICdzdHJpbmcnKSB7XHJcbiAgICAgIGxldCBjb250ZW50VHlwZSA9IHJlcS5nZXRIZWFkZXIoJ0NvbnRlbnQtVHlwZScpO1xyXG4gICAgICAvLyBQYXJzZSBvdXQganVzdCB0aGUgY29udGVudCB0eXBlIGZyb20gdGhlIGhlYWRlciAoaWdub3JlIHRoZSBjaGFyc2V0KVxyXG4gICAgICBpZiAoY29udGVudFR5cGUpIGNvbnRlbnRUeXBlID0gY29udGVudFR5cGUuc3BsaXQoJzsnKVswXTtcclxuICAgICAgbGV0IHNlcmlhbGl6ZSA9IHRoaXMuX3NlcmlhbGl6ZXIgfHwgZXhwb3J0cy5zZXJpYWxpemVbY29udGVudFR5cGVdO1xyXG4gICAgICBpZiAoIXNlcmlhbGl6ZSAmJiBpc0pTT04oY29udGVudFR5cGUpKSB7XHJcbiAgICAgICAgc2VyaWFsaXplID0gZXhwb3J0cy5zZXJpYWxpemVbJ2FwcGxpY2F0aW9uL2pzb24nXTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKHNlcmlhbGl6ZSkgZGF0YSA9IHNlcmlhbGl6ZShkYXRhKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBjb250ZW50LWxlbmd0aFxyXG4gICAgaWYgKGRhdGEgJiYgIXJlcS5nZXRIZWFkZXIoJ0NvbnRlbnQtTGVuZ3RoJykpIHtcclxuICAgICAgcmVxLnNldEhlYWRlcihcclxuICAgICAgICAnQ29udGVudC1MZW5ndGgnLFxyXG4gICAgICAgIEJ1ZmZlci5pc0J1ZmZlcihkYXRhKSA/IGRhdGEubGVuZ3RoIDogQnVmZmVyLmJ5dGVMZW5ndGgoZGF0YSlcclxuICAgICAgKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIHJlc3BvbnNlXHJcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIGNvbXBsZXhpdHlcclxuICByZXEub25jZSgncmVzcG9uc2UnLCAocmVzKSA9PiB7XHJcbiAgICBkZWJ1ZygnJXMgJXMgLT4gJXMnLCB0aGlzLm1ldGhvZCwgdGhpcy51cmwsIHJlcy5zdGF0dXNDb2RlKTtcclxuXHJcbiAgICBpZiAodGhpcy5fcmVzcG9uc2VUaW1lb3V0VGltZXIpIHtcclxuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX3Jlc3BvbnNlVGltZW91dFRpbWVyKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodGhpcy5waXBlZCkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgbWF4ID0gdGhpcy5fbWF4UmVkaXJlY3RzO1xyXG4gICAgY29uc3QgbWltZSA9IHV0aWxzLnR5cGUocmVzLmhlYWRlcnNbJ2NvbnRlbnQtdHlwZSddIHx8ICcnKSB8fCAndGV4dC9wbGFpbic7XHJcbiAgICBsZXQgdHlwZSA9IG1pbWUuc3BsaXQoJy8nKVswXTtcclxuICAgIGlmICh0eXBlKSB0eXBlID0gdHlwZS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcclxuICAgIGNvbnN0IG11bHRpcGFydCA9IHR5cGUgPT09ICdtdWx0aXBhcnQnO1xyXG4gICAgY29uc3QgcmVkaXJlY3QgPSBpc1JlZGlyZWN0KHJlcy5zdGF0dXNDb2RlKTtcclxuICAgIGNvbnN0IHJlc3BvbnNlVHlwZSA9IHRoaXMuX3Jlc3BvbnNlVHlwZTtcclxuXHJcbiAgICB0aGlzLnJlcyA9IHJlcztcclxuXHJcbiAgICAvLyByZWRpcmVjdFxyXG4gICAgaWYgKHJlZGlyZWN0ICYmIHRoaXMuX3JlZGlyZWN0cysrICE9PSBtYXgpIHtcclxuICAgICAgcmV0dXJuIHRoaXMuX3JlZGlyZWN0KHJlcyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHRoaXMubWV0aG9kID09PSAnSEVBRCcpIHtcclxuICAgICAgdGhpcy5lbWl0KCdlbmQnKTtcclxuICAgICAgdGhpcy5jYWxsYmFjayhudWxsLCB0aGlzLl9lbWl0UmVzcG9uc2UoKSk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICAvLyB6bGliIHN1cHBvcnRcclxuICAgIGlmICh0aGlzLl9zaG91bGREZWNvbXByZXNzKHJlcykpIHtcclxuICAgICAgZGVjb21wcmVzcyhyZXEsIHJlcyk7XHJcbiAgICB9XHJcblxyXG4gICAgbGV0IGJ1ZmZlciA9IHRoaXMuX2J1ZmZlcjtcclxuICAgIGlmIChidWZmZXIgPT09IHVuZGVmaW5lZCAmJiBtaW1lIGluIGV4cG9ydHMuYnVmZmVyKSB7XHJcbiAgICAgIGJ1ZmZlciA9IEJvb2xlYW4oZXhwb3J0cy5idWZmZXJbbWltZV0pO1xyXG4gICAgfVxyXG5cclxuICAgIGxldCBwYXJzZXIgPSB0aGlzLl9wYXJzZXI7XHJcbiAgICBpZiAodW5kZWZpbmVkID09PSBidWZmZXIgJiYgcGFyc2VyKSB7XHJcbiAgICAgIGNvbnNvbGUud2FybihcclxuICAgICAgICBcIkEgY3VzdG9tIHN1cGVyYWdlbnQgcGFyc2VyIGhhcyBiZWVuIHNldCwgYnV0IGJ1ZmZlcmluZyBzdHJhdGVneSBmb3IgdGhlIHBhcnNlciBoYXNuJ3QgYmVlbiBjb25maWd1cmVkLiBDYWxsIGByZXEuYnVmZmVyKHRydWUgb3IgZmFsc2UpYCBvciBzZXQgYHN1cGVyYWdlbnQuYnVmZmVyW21pbWVdID0gdHJ1ZSBvciBmYWxzZWBcIlxyXG4gICAgICApO1xyXG4gICAgICBidWZmZXIgPSB0cnVlO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICghcGFyc2VyKSB7XHJcbiAgICAgIGlmIChyZXNwb25zZVR5cGUpIHtcclxuICAgICAgICBwYXJzZXIgPSBleHBvcnRzLnBhcnNlLmltYWdlOyAvLyBJdCdzIGFjdHVhbGx5IGEgZ2VuZXJpYyBCdWZmZXJcclxuICAgICAgICBidWZmZXIgPSB0cnVlO1xyXG4gICAgICB9IGVsc2UgaWYgKG11bHRpcGFydCkge1xyXG4gICAgICAgIGNvbnN0IGZvcm0gPSBmb3JtaWRhYmxlLmZvcm1pZGFibGUoKTtcclxuICAgICAgICBwYXJzZXIgPSAocmVzLCBjYWxsYmFjaykgPT4ge1xyXG4gICAgICAgICAgLy8gQ3JlYXRlIGEgUGFzc1Rocm91Z2ggc3RyZWFtIHRoYXQgYWN0cyBhcyBhIHByb3BlciBIVFRQIHJlcXVlc3RcclxuICAgICAgICAgIGNvbnN0IGJyaWRnZVN0cmVhbSA9IG5ldyBTdHJlYW0uUGFzc1Rocm91Z2goKTtcclxuXHJcbiAgICAgICAgICAvLyBBZGQgSFRUUCByZXF1ZXN0IHByb3BlcnRpZXMgZnJvbSB0aGUgY3VycmVudCByZXF1ZXN0IGNvbnRleHRcclxuICAgICAgICAgIGJyaWRnZVN0cmVhbS5tZXRob2QgPSB0aGlzLm1ldGhvZCB8fCAnUE9TVCc7XHJcbiAgICAgICAgICBicmlkZ2VTdHJlYW0udXJsID0gdGhpcy51cmwgfHwgJy8nO1xyXG4gICAgICAgICAgYnJpZGdlU3RyZWFtLmh0dHBWZXJzaW9uID0gcmVzLmh0dHBWZXJzaW9uIHx8ICcxLjEnO1xyXG4gICAgICAgICAgYnJpZGdlU3RyZWFtLmhlYWRlcnMgPSByZXMuaGVhZGVycyB8fCB7fTtcclxuICAgICAgICAgIGJyaWRnZVN0cmVhbS5zb2NrZXQgPSByZXMuc29ja2V0IHx8IHsgcmVhZGFibGU6IHRydWUgfTtcclxuXHJcbiAgICAgICAgICAvLyBQaXBlIHRoZSByZXNwb25zZSBkYXRhIHRocm91Z2ggdGhlIGJyaWRnZSBzdHJlYW1cclxuICAgICAgICAgIHJlcy5waXBlKGJyaWRnZVN0cmVhbSk7XHJcblxyXG4gICAgICAgICAgZm9ybS5wYXJzZShicmlkZ2VTdHJlYW0sIChlcnIsIGZpZWxkcywgZmlsZXMpID0+IHtcclxuICAgICAgICAgICAgaWYgKGVycikgcmV0dXJuIGNhbGxiYWNrKGVycik7XHJcblxyXG4gICAgICAgICAgICAvLyBGb3JtaWRhYmxlIHYzIGFsd2F5cyByZXR1cm5zIGFycmF5cywgYnV0IFN1cGVyQWdlbnQgZXhwZWN0cyBzaW5nbGUgdmFsdWVzXHJcbiAgICAgICAgICAgIC8vIEZsYXR0ZW4gc2luZ2xlLWl0ZW0gYXJyYXlzIHRvIG1haW50YWluIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcclxuICAgICAgICAgICAgY29uc3QgZmxhdHRlbmVkRmllbGRzID0ge307XHJcbiAgICAgICAgICAgIGlmIChmaWVsZHMpIHtcclxuICAgICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBmaWVsZHMpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gZmllbGRzW2tleV07XHJcbiAgICAgICAgICAgICAgICBmbGF0dGVuZWRGaWVsZHNba2V5XSA9IEFycmF5LmlzQXJyYXkodmFsdWUpICYmIHZhbHVlLmxlbmd0aCA9PT0gMSA/IHZhbHVlWzBdIDogdmFsdWU7XHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBjb25zdCBmbGF0dGVuZWRGaWxlcyA9IHt9O1xyXG4gICAgICAgICAgICBpZiAoZmlsZXMpIHtcclxuICAgICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBmaWxlcykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgdmFsdWUgPSBmaWxlc1trZXldO1xyXG4gICAgICAgICAgICAgICAgZmxhdHRlbmVkRmlsZXNba2V5XSA9IEFycmF5LmlzQXJyYXkodmFsdWUpICYmIHZhbHVlLmxlbmd0aCA9PT0gMSA/IHZhbHVlWzBdIDogdmFsdWU7XHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBSZXR1cm4gZmxhdHRlbmVkIGZpZWxkcyBhcyB0aGUgb2JqZWN0IHBhcmFtZXRlciB0byBtYXRjaCBTdXBlckFnZW50J3MgZXhwZWN0ZWQgZm9ybWF0XHJcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGZsYXR0ZW5lZEZpZWxkcywgZmxhdHRlbmVkRmlsZXMpO1xyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgfTtcclxuICAgICAgICBidWZmZXIgPSB0cnVlO1xyXG4gICAgICB9IGVsc2UgaWYgKGlzQmluYXJ5KG1pbWUpKSB7XHJcbiAgICAgICAgcGFyc2VyID0gZXhwb3J0cy5wYXJzZS5pbWFnZTtcclxuICAgICAgICBidWZmZXIgPSB0cnVlOyAvLyBGb3IgYmFja3dhcmRzLWNvbXBhdGliaWxpdHkgYnVmZmVyaW5nIGRlZmF1bHQgaXMgYWQtaG9jIE1JTUUtZGVwZW5kZW50XHJcbiAgICAgIH0gZWxzZSBpZiAoZXhwb3J0cy5wYXJzZVttaW1lXSkge1xyXG4gICAgICAgIHBhcnNlciA9IGV4cG9ydHMucGFyc2VbbWltZV07XHJcbiAgICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ3RleHQnKSB7XHJcbiAgICAgICAgcGFyc2VyID0gZXhwb3J0cy5wYXJzZS50ZXh0O1xyXG4gICAgICAgIGJ1ZmZlciA9IGJ1ZmZlciAhPT0gZmFsc2U7XHJcbiAgICAgICAgLy8gZXZlcnlvbmUgd2FudHMgdGhlaXIgb3duIHdoaXRlLWxhYmVsZWQganNvblxyXG4gICAgICB9IGVsc2UgaWYgKGlzSlNPTihtaW1lKSkge1xyXG4gICAgICAgIHBhcnNlciA9IGV4cG9ydHMucGFyc2VbJ2FwcGxpY2F0aW9uL2pzb24nXTtcclxuICAgICAgICBidWZmZXIgPSBidWZmZXIgIT09IGZhbHNlO1xyXG4gICAgICB9IGVsc2UgaWYgKGJ1ZmZlcikge1xyXG4gICAgICAgIHBhcnNlciA9IGV4cG9ydHMucGFyc2UudGV4dDtcclxuICAgICAgfSBlbHNlIGlmICh1bmRlZmluZWQgPT09IGJ1ZmZlcikge1xyXG4gICAgICAgIHBhcnNlciA9IGV4cG9ydHMucGFyc2UuaW1hZ2U7IC8vIEl0J3MgYWN0dWFsbHkgYSBnZW5lcmljIEJ1ZmZlclxyXG4gICAgICAgIGJ1ZmZlciA9IHRydWU7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBieSBkZWZhdWx0IG9ubHkgYnVmZmVyIHRleHQvKiwganNvbiBhbmQgbWVzc2VkIHVwIHRoaW5nIGZyb20gaGVsbFxyXG4gICAgaWYgKCh1bmRlZmluZWQgPT09IGJ1ZmZlciAmJiBpc1RleHQobWltZSkpIHx8IGlzSlNPTihtaW1lKSkge1xyXG4gICAgICBidWZmZXIgPSB0cnVlO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuX3Jlc0J1ZmZlcmVkID0gYnVmZmVyO1xyXG4gICAgbGV0IHBhcnNlckhhbmRsZXNFbmQgPSBmYWxzZTtcclxuICAgIGlmIChidWZmZXIpIHtcclxuICAgICAgLy8gUHJvdGVjdGlvbmEgYWdhaW5zdCB6aXAgYm9tYnMgYW5kIG90aGVyIG51aXNhbmNlXHJcbiAgICAgIGxldCByZXNwb25zZUJ5dGVzTGVmdCA9IHRoaXMuX21heFJlc3BvbnNlU2l6ZSB8fCAyMDAwMDAwMDA7XHJcbiAgICAgIHJlcy5vbignZGF0YScsIChidWYpID0+IHtcclxuICAgICAgICByZXNwb25zZUJ5dGVzTGVmdCAtPSBidWYuYnl0ZUxlbmd0aCB8fCBidWYubGVuZ3RoID4gMCA/IGJ1Zi5sZW5ndGggOiAwO1xyXG4gICAgICAgIGlmIChyZXNwb25zZUJ5dGVzTGVmdCA8IDApIHtcclxuICAgICAgICAgIC8vIFRoaXMgd2lsbCBwcm9wYWdhdGUgdGhyb3VnaCBlcnJvciBldmVudFxyXG4gICAgICAgICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoJ01heGltdW0gcmVzcG9uc2Ugc2l6ZSByZWFjaGVkJyk7XHJcbiAgICAgICAgICBlcnJvci5jb2RlID0gJ0VUT09MQVJHRSc7XHJcbiAgICAgICAgICAvLyBQYXJzZXJzIGFyZW4ndCByZXF1aXJlZCB0byBvYnNlcnZlIGVycm9yIGV2ZW50LFxyXG4gICAgICAgICAgLy8gc28gd291bGQgaW5jb3JyZWN0bHkgcmVwb3J0IHN1Y2Nlc3NcclxuICAgICAgICAgIHBhcnNlckhhbmRsZXNFbmQgPSBmYWxzZTtcclxuICAgICAgICAgIC8vIFdpbGwgbm90IGVtaXQgZXJyb3IgZXZlbnRcclxuICAgICAgICAgIHJlcy5kZXN0cm95KGVycm9yKTtcclxuICAgICAgICAgIC8vIHNvIHdlIGRvIGNhbGxiYWNrIG5vd1xyXG4gICAgICAgICAgdGhpcy5jYWxsYmFjayhlcnJvciwgbnVsbCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAocGFyc2VyKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgLy8gVW5idWZmZXJlZCBwYXJzZXJzIGFyZSBzdXBwb3NlZCB0byBlbWl0IHJlc3BvbnNlIGVhcmx5LFxyXG4gICAgICAgIC8vIHdoaWNoIGlzIHdlaXJkIEJUVywgYmVjYXVzZSByZXNwb25zZS5ib2R5IHdvbid0IGJlIHRoZXJlLlxyXG4gICAgICAgIHBhcnNlckhhbmRsZXNFbmQgPSBidWZmZXI7XHJcblxyXG4gICAgICAgIHBhcnNlcihyZXMsIChlcnJvciwgb2JqZWN0LCBmaWxlcykgPT4ge1xyXG4gICAgICAgICAgaWYgKHRoaXMudGltZWRvdXQpIHtcclxuICAgICAgICAgICAgLy8gVGltZW91dCBoYXMgYWxyZWFkeSBoYW5kbGVkIGFsbCBjYWxsYmFja3NcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgfVxyXG5cclxuICAgICAgICAgIC8vIEludGVudGlvbmFsIChub24tdGltZW91dCkgYWJvcnQgaXMgc3VwcG9zZWQgdG8gcHJlc2VydmUgcGFydGlhbCByZXNwb25zZSxcclxuICAgICAgICAgIC8vIGV2ZW4gaWYgaXQgZG9lc24ndCBwYXJzZS5cclxuICAgICAgICAgIGlmIChlcnJvciAmJiAhdGhpcy5fYWJvcnRlZCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jYWxsYmFjayhlcnJvcik7XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgaWYgKHBhcnNlckhhbmRsZXNFbmQpIHtcclxuICAgICAgICAgICAgdGhpcy5lbWl0KCdlbmQnKTtcclxuICAgICAgICAgICAgdGhpcy5jYWxsYmFjayhudWxsLCB0aGlzLl9lbWl0UmVzcG9uc2Uob2JqZWN0LCBmaWxlcykpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICB0aGlzLmNhbGxiYWNrKGVycik7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5yZXMgPSByZXM7XHJcblxyXG4gICAgLy8gdW5idWZmZXJlZFxyXG4gICAgaWYgKCFidWZmZXIpIHtcclxuICAgICAgZGVidWcoJ3VuYnVmZmVyZWQgJXMgJXMnLCB0aGlzLm1ldGhvZCwgdGhpcy51cmwpO1xyXG4gICAgICB0aGlzLmNhbGxiYWNrKG51bGwsIHRoaXMuX2VtaXRSZXNwb25zZSgpKTtcclxuICAgICAgaWYgKG11bHRpcGFydCkgcmV0dXJuOyAvLyBhbGxvdyBtdWx0aXBhcnQgdG8gaGFuZGxlIGVuZCBldmVudFxyXG4gICAgICByZXMub25jZSgnZW5kJywgKCkgPT4ge1xyXG4gICAgICAgIGRlYnVnKCdlbmQgJXMgJXMnLCB0aGlzLm1ldGhvZCwgdGhpcy51cmwpO1xyXG4gICAgICAgIHRoaXMuZW1pdCgnZW5kJyk7XHJcbiAgICAgIH0pO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgLy8gdGVybWluYXRpbmcgZXZlbnRzXHJcbiAgICByZXMub25jZSgnZXJyb3InLCAoZXJyb3IpID0+IHtcclxuICAgICAgcGFyc2VySGFuZGxlc0VuZCA9IGZhbHNlO1xyXG4gICAgICB0aGlzLmNhbGxiYWNrKGVycm9yLCBudWxsKTtcclxuICAgIH0pO1xyXG4gICAgaWYgKCFwYXJzZXJIYW5kbGVzRW5kKVxyXG4gICAgICByZXMub25jZSgnZW5kJywgKCkgPT4ge1xyXG4gICAgICAgIGRlYnVnKCdlbmQgJXMgJXMnLCB0aGlzLm1ldGhvZCwgdGhpcy51cmwpO1xyXG4gICAgICAgIC8vIFRPRE86IHVubGVzcyBidWZmZXJpbmcgZW1pdCBlYXJsaWVyIHRvIHN0cmVhbVxyXG4gICAgICAgIHRoaXMuZW1pdCgnZW5kJyk7XHJcbiAgICAgICAgdGhpcy5jYWxsYmFjayhudWxsLCB0aGlzLl9lbWl0UmVzcG9uc2UoKSk7XHJcbiAgICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICB0aGlzLmVtaXQoJ3JlcXVlc3QnLCB0aGlzKTtcclxuXHJcbiAgY29uc3QgZ2V0UHJvZ3Jlc3NNb25pdG9yID0gKCkgPT4ge1xyXG4gICAgY29uc3QgbGVuZ3RoQ29tcHV0YWJsZSA9IHRydWU7XHJcbiAgICBjb25zdCB0b3RhbCA9IHJlcS5nZXRIZWFkZXIoJ0NvbnRlbnQtTGVuZ3RoJyk7XHJcbiAgICBsZXQgbG9hZGVkID0gMDtcclxuXHJcbiAgICBjb25zdCBwcm9ncmVzcyA9IG5ldyBTdHJlYW0uVHJhbnNmb3JtKCk7XHJcbiAgICBwcm9ncmVzcy5fdHJhbnNmb3JtID0gKGNodW5rLCBlbmNvZGluZywgY2FsbGJhY2spID0+IHtcclxuICAgICAgbG9hZGVkICs9IGNodW5rLmxlbmd0aDtcclxuICAgICAgdGhpcy5lbWl0KCdwcm9ncmVzcycsIHtcclxuICAgICAgICBkaXJlY3Rpb246ICd1cGxvYWQnLFxyXG4gICAgICAgIGxlbmd0aENvbXB1dGFibGUsXHJcbiAgICAgICAgbG9hZGVkLFxyXG4gICAgICAgIHRvdGFsXHJcbiAgICAgIH0pO1xyXG4gICAgICBjYWxsYmFjayhudWxsLCBjaHVuayk7XHJcbiAgICB9O1xyXG5cclxuICAgIHJldHVybiBwcm9ncmVzcztcclxuICB9O1xyXG5cclxuICBjb25zdCBidWZmZXJUb0NodW5rcyA9IChidWZmZXIpID0+IHtcclxuICAgIGNvbnN0IGNodW5rU2l6ZSA9IDE2ICogMTAyNDsgLy8gZGVmYXVsdCBoaWdoV2F0ZXJNYXJrIHZhbHVlXHJcbiAgICBjb25zdCBjaHVua2luZyA9IG5ldyBTdHJlYW0uUmVhZGFibGUoKTtcclxuICAgIGNvbnN0IHRvdGFsTGVuZ3RoID0gYnVmZmVyLmxlbmd0aDtcclxuICAgIGNvbnN0IHJlbWFpbmRlciA9IHRvdGFsTGVuZ3RoICUgY2h1bmtTaXplO1xyXG4gICAgY29uc3QgY3V0b2ZmID0gdG90YWxMZW5ndGggLSByZW1haW5kZXI7XHJcblxyXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjdXRvZmY7IGkgKz0gY2h1bmtTaXplKSB7XHJcbiAgICAgIGNvbnN0IGNodW5rID0gYnVmZmVyLnNsaWNlKGksIGkgKyBjaHVua1NpemUpO1xyXG4gICAgICBjaHVua2luZy5wdXNoKGNodW5rKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAocmVtYWluZGVyID4gMCkge1xyXG4gICAgICBjb25zdCByZW1haW5kZXJCdWZmZXIgPSBidWZmZXIuc2xpY2UoLXJlbWFpbmRlcik7XHJcbiAgICAgIGNodW5raW5nLnB1c2gocmVtYWluZGVyQnVmZmVyKTtcclxuICAgIH1cclxuXHJcbiAgICBjaHVua2luZy5wdXNoKG51bGwpOyAvLyBubyBtb3JlIGRhdGFcclxuXHJcbiAgICByZXR1cm4gY2h1bmtpbmc7XHJcbiAgfTtcclxuXHJcbiAgLy8gaWYgYSBGb3JtRGF0YSBpbnN0YW5jZSBnb3QgY3JlYXRlZCwgdGhlbiB3ZSBzZW5kIHRoYXQgYXMgdGhlIHJlcXVlc3QgYm9keVxyXG4gIGNvbnN0IGZvcm1EYXRhID0gdGhpcy5fZm9ybURhdGE7XHJcbiAgaWYgKGZvcm1EYXRhKSB7XHJcbiAgICAvLyBzZXQgaGVhZGVyc1xyXG4gICAgY29uc3QgaGVhZGVycyA9IGZvcm1EYXRhLmdldEhlYWRlcnMoKTtcclxuICAgIGZvciAoY29uc3QgaSBpbiBoZWFkZXJzKSB7XHJcbiAgICAgIGlmIChoYXNPd24oaGVhZGVycywgaSkpIHtcclxuICAgICAgICBkZWJ1Zygnc2V0dGluZyBGb3JtRGF0YSBoZWFkZXI6IFwiJXM6ICVzXCInLCBpLCBoZWFkZXJzW2ldKTtcclxuICAgICAgICByZXEuc2V0SGVhZGVyKGksIGhlYWRlcnNbaV0pO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gYXR0ZW1wdCB0byBnZXQgXCJDb250ZW50LUxlbmd0aFwiIGhlYWRlclxyXG4gICAgZm9ybURhdGEuZ2V0TGVuZ3RoKChlcnJvciwgbGVuZ3RoKSA9PiB7XHJcbiAgICAgIC8vIFRPRE86IEFkZCBjaHVua2VkIGVuY29kaW5nIHdoZW4gbm8gbGVuZ3RoIChpZiBlcnIpXHJcbiAgICAgIGlmIChlcnJvcikgZGVidWcoJ2Zvcm1EYXRhLmdldExlbmd0aCBoYWQgZXJyb3InLCBlcnJvciwgbGVuZ3RoKTtcclxuXHJcbiAgICAgIGRlYnVnKCdnb3QgRm9ybURhdGEgQ29udGVudC1MZW5ndGg6ICVzJywgbGVuZ3RoKTtcclxuICAgICAgaWYgKHR5cGVvZiBsZW5ndGggPT09ICdudW1iZXInKSB7XHJcbiAgICAgICAgcmVxLnNldEhlYWRlcignQ29udGVudC1MZW5ndGgnLCBsZW5ndGgpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBmb3JtRGF0YS5waXBlKGdldFByb2dyZXNzTW9uaXRvcigpKS5waXBlKHJlcSk7XHJcbiAgICB9KTtcclxuICB9IGVsc2UgaWYgKEJ1ZmZlci5pc0J1ZmZlcihkYXRhKSkge1xyXG4gICAgYnVmZmVyVG9DaHVua3MoZGF0YSkucGlwZShnZXRQcm9ncmVzc01vbml0b3IoKSkucGlwZShyZXEpO1xyXG4gIH0gZWxzZSB7XHJcbiAgICByZXEuZW5kKGRhdGEpO1xyXG4gIH1cclxufTtcclxuXHJcbi8vIENoZWNrIHdoZXRoZXIgcmVzcG9uc2UgaGFzIGEgbm9uLTAtc2l6ZWQgZ3ppcC1lbmNvZGVkIGJvZHlcclxuUmVxdWVzdC5wcm90b3R5cGUuX3Nob3VsZERlY29tcHJlc3MgPSAocmVzKSA9PiB7XHJcbiAgcmV0dXJuIGhhc05vbkVtcHR5UmVzcG9uc2VDb250ZW50KHJlcykgJiYgKGlzR3ppcE9yRGVmbGF0ZUVuY29kaW5nKHJlcykgfHwgaXNCcm90bGlFbmNvZGluZyhyZXMpKTtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogT3ZlcnJpZGVzIEROUyBmb3Igc2VsZWN0ZWQgaG9zdG5hbWVzLiBUYWtlcyBvYmplY3QgbWFwcGluZyBob3N0bmFtZXMgdG8gSVAgYWRkcmVzc2VzLlxyXG4gKlxyXG4gKiBXaGVuIG1ha2luZyBhIHJlcXVlc3QgdG8gYSBVUkwgd2l0aCBhIGhvc3RuYW1lIGV4YWN0bHkgbWF0Y2hpbmcgYSBrZXkgaW4gdGhlIG9iamVjdCxcclxuICogdXNlIHRoZSBnaXZlbiBJUCBhZGRyZXNzIHRvIGNvbm5lY3QsIGluc3RlYWQgb2YgdXNpbmcgRE5TIHRvIHJlc29sdmUgdGhlIGhvc3RuYW1lLlxyXG4gKlxyXG4gKiBBIHNwZWNpYWwgaG9zdCBgKmAgbWF0Y2hlcyBldmVyeSBob3N0bmFtZSAoa2VlcCByZWRpcmVjdHMgaW4gbWluZCEpXHJcbiAqXHJcbiAqICAgICAgcmVxdWVzdC5jb25uZWN0KHtcclxuICogICAgICAgICd0ZXN0LmV4YW1wbGUuY29tJzogJzEyNy4wLjAuMScsXHJcbiAqICAgICAgICAnaXB2Ni5leGFtcGxlLmNvbSc6ICc6OjEnLFxyXG4gKiAgICAgIH0pXHJcbiAqL1xyXG5SZXF1ZXN0LnByb3RvdHlwZS5jb25uZWN0ID0gZnVuY3Rpb24gKGNvbm5lY3RPdmVycmlkZSkge1xyXG4gIGlmICh0eXBlb2YgY29ubmVjdE92ZXJyaWRlID09PSAnc3RyaW5nJykge1xyXG4gICAgdGhpcy5fY29ubmVjdE92ZXJyaWRlID0geyAnKic6IGNvbm5lY3RPdmVycmlkZSB9O1xyXG4gIH0gZWxzZSBpZiAodHlwZW9mIGNvbm5lY3RPdmVycmlkZSA9PT0gJ29iamVjdCcpIHtcclxuICAgIHRoaXMuX2Nvbm5lY3RPdmVycmlkZSA9IGNvbm5lY3RPdmVycmlkZTtcclxuICB9IGVsc2Uge1xyXG4gICAgdGhpcy5fY29ubmVjdE92ZXJyaWRlID0gdW5kZWZpbmVkO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS50cnVzdExvY2FsaG9zdCA9IGZ1bmN0aW9uICh0b2dnbGUpIHtcclxuICB0aGlzLl90cnVzdExvY2FsaG9zdCA9IHRvZ2dsZSA9PT0gdW5kZWZpbmVkID8gdHJ1ZSA6IHRvZ2dsZTtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8vIGdlbmVyYXRlIEhUVFAgdmVyYiBtZXRob2RzXHJcbmlmICghbWV0aG9kcy5pbmNsdWRlcygnZGVsJykpIHtcclxuICAvLyBjcmVhdGUgYSBjb3B5IHNvIHdlIGRvbid0IGNhdXNlIGNvbmZsaWN0cyB3aXRoXHJcbiAgLy8gb3RoZXIgcGFja2FnZXMgdXNpbmcgdGhlIG1ldGhvZHMgcGFja2FnZSBhbmRcclxuICAvLyBucG0gMy54XHJcbiAgbWV0aG9kcyA9IFsuLi5tZXRob2RzXTtcclxuICBtZXRob2RzLnB1c2goJ2RlbCcpO1xyXG59XHJcblxyXG5mb3IgKGxldCBtZXRob2Qgb2YgbWV0aG9kcykge1xyXG4gIGNvbnN0IG5hbWUgPSBtZXRob2Q7XHJcbiAgbWV0aG9kID0gbWV0aG9kID09PSAnZGVsJyA/ICdkZWxldGUnIDogbWV0aG9kO1xyXG5cclxuICBtZXRob2QgPSBtZXRob2QudG9VcHBlckNhc2UoKTtcclxuICByZXF1ZXN0W25hbWVdID0gKHVybCwgZGF0YSwgZm4pID0+IHtcclxuICAgIGNvbnN0IHJlcXVlc3RfID0gcmVxdWVzdChtZXRob2QsIHVybCk7XHJcbiAgICBpZiAodHlwZW9mIGRhdGEgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgZm4gPSBkYXRhO1xyXG4gICAgICBkYXRhID0gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoZGF0YSkge1xyXG4gICAgICBpZiAobWV0aG9kID09PSAnR0VUJyB8fCBtZXRob2QgPT09ICdIRUFEJykge1xyXG4gICAgICAgIHJlcXVlc3RfLnF1ZXJ5KGRhdGEpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJlcXVlc3RfLnNlbmQoZGF0YSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAoZm4pIHJlcXVlc3RfLmVuZChmbik7XHJcbiAgICByZXR1cm4gcmVxdWVzdF87XHJcbiAgfTtcclxufVxyXG5cclxuLyoqXHJcbiAqIENoZWNrIGlmIGBtaW1lYCBpcyB0ZXh0IGFuZCBzaG91bGQgYmUgYnVmZmVyZWQuXHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBtaW1lXHJcbiAqIEByZXR1cm4ge0Jvb2xlYW59XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuZnVuY3Rpb24gaXNUZXh0KG1pbWUpIHtcclxuICBjb25zdCBwYXJ0cyA9IG1pbWUuc3BsaXQoJy8nKTtcclxuICBsZXQgdHlwZSA9IHBhcnRzWzBdO1xyXG4gIGlmICh0eXBlKSB0eXBlID0gdHlwZS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcclxuICBsZXQgc3VidHlwZSA9IHBhcnRzWzFdO1xyXG4gIGlmIChzdWJ0eXBlKSBzdWJ0eXBlID0gc3VidHlwZS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcclxuXHJcbiAgcmV0dXJuIHR5cGUgPT09ICd0ZXh0JyB8fCBzdWJ0eXBlID09PSAneC13d3ctZm9ybS11cmxlbmNvZGVkJztcclxufVxyXG5cclxuLy8gVGhpcyBpcyBub3QgYSBjYXRjaGFsbCwgYnV0IGEgc3RhcnQuIEl0IG1pZ2h0IGJlIHVzZWZ1bFxyXG4vLyBpbiB0aGUgbG9uZyBydW4gdG8gaGF2ZSBmaWxlIHRoYXQgaW5jbHVkZXMgYWxsIGJpbmFyeVxyXG4vLyBjb250ZW50IHR5cGVzIGZyb20gaHR0cHM6Ly93d3cuaWFuYS5vcmcvYXNzaWdubWVudHMvbWVkaWEtdHlwZXMvbWVkaWEtdHlwZXMueGh0bWxcclxuZnVuY3Rpb24gaXNCaW5hcnkobWltZSkge1xyXG4gIGxldCBbcmVnaXN0cnksIG5hbWVdID0gbWltZS5zcGxpdCgnLycpO1xyXG4gIGlmIChyZWdpc3RyeSkgcmVnaXN0cnkgPSByZWdpc3RyeS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcclxuICBpZiAobmFtZSkgbmFtZSA9IG5hbWUudG9Mb3dlckNhc2UoKS50cmltKCk7XHJcbiAgcmV0dXJuIChcclxuICAgIFsnYXVkaW8nLCAnZm9udCcsICdpbWFnZScsICd2aWRlbyddLmluY2x1ZGVzKHJlZ2lzdHJ5KSB8fFxyXG4gICAgWydneicsICdnemlwJ10uaW5jbHVkZXMobmFtZSlcclxuICApO1xyXG59XHJcblxyXG4vKipcclxuICogQ2hlY2sgaWYgYG1pbWVgIGlzIGpzb24gb3IgaGFzICtqc29uIHN0cnVjdHVyZWQgc3ludGF4IHN1ZmZpeC5cclxuICpcclxuICogQHBhcmFtIHtTdHJpbmd9IG1pbWVcclxuICogQHJldHVybiB7Qm9vbGVhbn1cclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuZnVuY3Rpb24gaXNKU09OKG1pbWUpIHtcclxuICAvLyBzaG91bGQgbWF0Y2ggL2pzb24gb3IgK2pzb25cclxuICAvLyBidXQgbm90IC9qc29uLXNlcVxyXG4gIHJldHVybiAvWy8rXWpzb24oJHxbXi1cXHddKS9pLnRlc3QobWltZSk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDaGVjayBpZiB3ZSBzaG91bGQgZm9sbG93IHRoZSByZWRpcmVjdCBgY29kZWAuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBjb2RlXHJcbiAqIEByZXR1cm4ge0Jvb2xlYW59XHJcbiAqIEBhcGkgcHJpdmF0ZVxyXG4gKi9cclxuXHJcbmZ1bmN0aW9uIGlzUmVkaXJlY3QoY29kZSkge1xyXG4gIHJldHVybiBbMzAxLCAzMDIsIDMwMywgMzA1LCAzMDcsIDMwOF0uaW5jbHVkZXMoY29kZSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGhhc05vbkVtcHR5UmVzcG9uc2VDb250ZW50KHJlcykge1xyXG4gIGlmIChyZXMuc3RhdHVzQ29kZSA9PT0gMjA0IHx8IHJlcy5zdGF0dXNDb2RlID09PSAzMDQpIHtcclxuICAgIC8vIFRoZXNlIGFyZW4ndCBzdXBwb3NlZCB0byBoYXZlIGFueSBib2R5XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG5cclxuICAvLyBoZWFkZXIgY29udGVudCBpcyBhIHN0cmluZywgYW5kIGRpc3RpbmN0aW9uIGJldHdlZW4gMCBhbmQgbm8gaW5mb3JtYXRpb24gaXMgY3J1Y2lhbFxyXG4gIGlmIChyZXMuaGVhZGVyc1snY29udGVudC1sZW5ndGgnXSA9PT0gJzAnKSB7XHJcbiAgICAvLyBXZSBrbm93IHRoYXQgdGhlIGJvZHkgaXMgZW1wdHkgKHVuZm9ydHVuYXRlbHksIHRoaXMgY2hlY2sgZG9lcyBub3QgY292ZXIgY2h1bmtlZCBlbmNvZGluZylcclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcblxyXG4gIHJldHVybiB0cnVlO1xyXG59XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTTtFQUFFQTtBQUFPLENBQUMsR0FBR0MsT0FBTyxDQUFDLEtBQUssQ0FBQztBQUNqQyxNQUFNQyxNQUFNLEdBQUdELE9BQU8sQ0FBQyxRQUFRLENBQUM7QUFDaEMsTUFBTUUsS0FBSyxHQUFHRixPQUFPLENBQUMsT0FBTyxDQUFDO0FBQzlCLE1BQU1HLElBQUksR0FBR0gsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNSSxFQUFFLEdBQUdKLE9BQU8sQ0FBQyxJQUFJLENBQUM7QUFDeEIsTUFBTUssSUFBSSxHQUFHTCxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU1NLElBQUksR0FBR04sT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNTyxF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
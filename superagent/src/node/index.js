/**
 * Module dependencies.
 */

const { format } = require('url');
const Stream = require('stream');
const https = require('https');
const http = require('http');
const fs = require('fs');
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
const { decompress } = require('./unzip');
const Response = require('./response');

const { mixin, hasOwn, isBrotliEncoding, isGzipOrDeflateEncoding } = utils;
const { chooseDecompresser } = require('./decompress');

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

mime.define(
  {
    'application/x-www-form-urlencoded': ['form', 'urlencoded', 'form-data']
  },
  true
);

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
  'application/x-www-form-urlencoded': (obj) => {
    return qs.stringify(obj, { indices: false, strictNullHandling: true });
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
  this._pipeDestination = null;
  this.once('end', this.clearTimeout.bind(this));
  this.on('pipe', (source) => {
    this._sourceStream = source;
  });
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
    throw new Error(
      'superagent: this version of Node.js does not support http2'
    );
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
      o = { filename: options };
    }

    if (typeof file === 'string') {
      if (!o.filename) o.filename = file;
      debug('creating `fs.ReadStream` instance for file: %s', file);
      file = fs.createReadStream(file);
      file.on('error', (error) => {
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
    this._formData.on('error', (error) => {
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
  return this.set(
    'Content-Type',
    type.includes('/') ? type : mime.getType(type)
  );
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

  if (this._aborted || this.hasSizeError()) return false;

  if (!this._streamRequest) {
    this._streamRequest = true;
  }

  const length = Buffer.isBuffer(data)
    ? data.length
    : typeof data === 'string'
      ? Buffer.byteLength(data, encoding)
      : ArrayBuffer.isView(data)
        ? data.byteLength
        : data instanceof ArrayBuffer
          ? data.byteLength
          : 0;

  this._requestBytesSent = (this._requestBytesSent || 0) + length;
  if (!this._checkRequestSize(this._requestBytesSent)) {
    if (this._sourceStream) {
      this._sourceStream.unpipe(this);
      if (typeof this._sourceStream.destroy === 'function') {
        this._sourceStream.destroy();
      } else if (typeof this._sourceStream.resume === 'function') {
        this._sourceStream.resume();
      }
    }
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
  this.piped = true;
  this._pipeDestination = stream;
  this.buffer(false);
  this.end();
  return this._pipeContinue(stream, options);
};

Request.prototype._pipeContinue = function (stream, options) {
  this._pipeDestination = stream;
  const attach = () => {
    if (!this.req) return;
    this.req.once('response', (res) => {
      // Avoid "double callback bug"
      if (this.hasSizeError()) return;

      // redirect
      if (
        isRedirect(res.statusCode) &&
        this._redirects++ !== this._maxRedirects
      ) {
        return this._redirect(res, () => {
          this._pipeContinue(stream, options);
        });
      }

      this.res = res;
      this._emitResponse();
      if (this._aborted) return;

      // Bodyless-aware, compression-aware Content-Length precheck for piped final responses.
      // Immediately aborts unbuffered streams exceeding maxResponseSize before body data arrives.
      if (
        this._maxResponseSize !== undefined &&
        this.method.toUpperCase() !== 'HEAD' &&
        hasNonEmptyResponseContent(res) &&
        !this._shouldDecompress(res)
      ) {
        const clHeader = res.headers['content-length'];
        if (clHeader) {
          const cl = parseInt(clHeader, 10);
          if (!isNaN(cl) && cl > this._maxResponseSize) {
            const error = this._abortWithSizeError('response');
            if (typeof res.destroy === 'function') {
              res.destroy(error);
            }
            return;
          }
        }
      }

      // Route all piped response bytes through the size monitor.
      // This enforces maxResponseSize for the .pipe() use case.
      const monitor = this._getResponseMonitor();
      monitor.on('error', (error) => {
        if (this.res) {
          this.res.unpipe();
          if (typeof this.res.destroy === 'function') {
            this.res.destroy(error);
          }
        }
      });

      if (this._shouldDecompress(res)) {
        let decompresser = chooseDecompresser(res);

        decompresser.on('error', (error) => {
          if (error && error.code === 'Z_BUF_ERROR') {
            // unexpected end of file is ignored by browsers and curl
            stream.emit('end');
            return;
          }

          if (stream) {
            if (stream.listeners('error').length > 0) {
              stream.emit('error', error);
            } else if (typeof stream.destroy === 'function') {
              stream.destroy();
            }
          }
        });
        res.pipe(decompresser).pipe(monitor).pipe(stream, options);
        // don't emit 'end' until monitor has completed writing all its data.
        monitor.once('end', () => {
          this._cleanupSpoolFile();
          this.emit('end');
        });
      } else {
        res.pipe(monitor).pipe(stream, options);
        monitor.once('end', () => {
          this._cleanupSpoolFile();
          this.emit('end');
        });
      }

      res.once('close', () => this._cleanupSpoolFile());
      res.once('error', () => this._cleanupSpoolFile());
      this.once('close', () => this._cleanupSpoolFile());
      this.once('abort', () => this._cleanupSpoolFile());

      if (stream) {
        stream.once('finish', () => this._cleanupSpoolFile());
        stream.once('close', () => this._cleanupSpoolFile());
        stream.once('error', () => this._cleanupSpoolFile());
      }
    });
  };

  if (this.req) {
    attach();
  } else {
    this.once('request', attach);
  }

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

Request.prototype._redirect = function (res, continuation) {
  let url = res.headers.location;
  if (!url) {
    return this.callback(new Error('No location header for redirect'), res);
  }

  debug('redirect %s -> %s', this.url, url);

  // location
  url = new URL(url, this.url).href;

  const changesOrigin = new URL(url).origin !== new URL(this.url).origin;

  this._stripCookiesForCrossOrigin = changesOrigin;
  if (changesOrigin) {
    delete this.username;
    delete this.password;
    delete this.cookies;
  }

  // Only clear request body and spooled multipart data when redirect status converts
  // the method to GET/HEAD (301, 302, 303). 305, 307, and 308 preserve method and body,
  // including across cross-origin redirects.
  if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
    this._cleanupSpoolFile();
    this._formDataTmpLength = null;
    delete this._formDataHeaders;
    this._data = null;
    delete this._formData;
  }

  const proceed = () => {
    if (this._aborted || this.hasSizeError()) return;

    let headers = this.req.getHeaders ? this.req.getHeaders() : this.req._headers;

    // implementation of 302 following defacto standard
    if (res.statusCode === 301 || res.statusCode === 302) {
      // strip Content-* related fields
      // in case of POST etc
      headers = utils.cleanHeader(headers, changesOrigin);

      // force GET
      this.method = this.method === 'HEAD' ? 'HEAD' : 'GET';

      // clear data
      this._data = null;
      delete this._formDataSerialized;
      delete this._formDataHeaders;
      // Clear spool data so the original body is not sent to redirect target
      this._cleanupSpoolFile();
      this._formDataTmpLength = null;
      delete this._formData;
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
      delete this._formDataSerialized;
      delete this._formDataHeaders;
      // Clear spool data so the original body is not sent to redirect target
      this._cleanupSpoolFile();
      this._formDataTmpLength = null;
      delete this._formData;
    }

    if (this.method === 'GET' || this.method === 'HEAD') {
      headers = utils.cleanHeader(headers, changesOrigin);
      this._data = null;
      delete this._formDataSerialized;
      delete this._formDataHeaders;
      this._cleanupSpoolFile();
      this._formDataTmpLength = null;
      delete this._formData;
    } else if (changesOrigin) {
      // 307/308 preserves method: only strip sensitive authorization/cookie headers across origins
      delete headers.authorization;
      delete headers.cookie;
    }

    if (changesOrigin) {
      delete this.username;
      delete this.password;
      if (headers) {
        for (const k of Object.keys(headers)) {
          const lk = k.toLowerCase();
          if (lk === 'authorization' || lk === 'cookie') {
            delete headers[k];
          }
        }
      }
      if (this.header) {
        for (const k of Object.keys(this.header)) {
          const lk = k.toLowerCase();
          if (lk === 'authorization' || lk === 'cookie') {
            delete this.header[k];
          }
        }
      }
      if (this._header) {
        for (const k of Object.keys(this._header)) {
          const lk = k.toLowerCase();
          if (lk === 'authorization' || lk === 'cookie') {
            delete this._header[k];
          }
        }
      }
    }

    // 307 preserves method
    // 308 preserves method
    delete headers.host;

    // Detach and destroy old upload pipeline before starting the redirect attempt
    this._detachSpoolUploadStream();

    delete this.req;
    if (this.method === 'GET' || this.method === 'HEAD') {
      delete this._formData;
    }

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
    if (changesOrigin) {
      delete this.cookies;
      this._stripCookiesForCrossOrigin = true;
    } else {
      this._stripCookiesForCrossOrigin = false;
    }
    this._redirectList.push(this.url);
    this._requestBytesSent = 0; // reset for the new request
    this.end(this._callback);
    if (typeof continuation === 'function') {
      continuation();
    }
  };

  // check redirect response size
  // HEAD redirects carry no body, even when Content-Length is present.
  // Skip all body-size checking for HEAD to avoid false ETOOLARGE.
  if (this._maxResponseSize !== undefined && this.method.toUpperCase() !== 'HEAD') {
    let redirectBytes = 0;
    let redirectStream = res;
    if (this._shouldDecompress(res)) {
      const decompresser = chooseDecompresser(res);
      decompresser.on('error', () => {
        // decompression errors on redirect body checking are non-fatal
      });
      res.pipe(decompresser);
      redirectStream = decompresser;
    } else if (hasNonEmptyResponseContent(res)) {
      // Only precheck Content-Length when NOT compressing and response has body content
      const redirectCl = parseInt(res.headers && res.headers['content-length'], 10);
      if (!isNaN(redirectCl) && redirectCl > this._maxResponseSize) {
        res.destroy();
        const err = this._abortWithSizeError('response');
        if (res.statusCode) err.status = res.statusCode;
        return this;
      }
    }

    let proceeded = false;
    const onProceed = () => {
      if (proceeded) return;
      proceeded = true;
      proceed();
    };

    redirectStream.on('data', (chunk) => {
      if (this.hasSizeError()) return;
      redirectBytes += chunk.length;
      if (redirectBytes > this._maxResponseSize) {
        res.destroy();
        if (redirectStream !== res && typeof redirectStream.destroy === 'function') {
          redirectStream.destroy();
        }
        const err = this._abortWithSizeError('response');
        if (res.statusCode) err.status = res.statusCode;
      }
    });

    redirectStream.once('end', () => {
      onProceed();
    });

    redirectStream.once('error', () => {
      onProceed();
    });

    res.resume();
    return this;
  }

  // ensure the response is being consumed
  // this is required for Node v0.10+
  res.resume();
  proceed();
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
    options = { type: 'basic' };
  }

  const encoder = (string) => Buffer.from(string).toString('base64');

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

  let { url: urlString } = this;
  const retries = this._retries;

  // default to http://
  if (urlString.indexOf('http') !== 0) urlString = `http://${urlString}`;
  const url = new URL(urlString);
  let { protocol } = url;
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
    const { hostname } = url;
    const match =
      hostname in this._connectOverride
        ? this._connectOverride[hostname]
        : this._connectOverride['*'];
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
  options.rejectUnauthorized =
    typeof this._disableTLSCerts === 'boolean'
      ? !this._disableTLSCerts
      : process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0';

  // Allows request.get('https://1.2.3.4/').set('Host', 'example.com')
  if (this._header.host) {
    options.servername = this._header.host.replace(/:\d+$/, '');
  }

  if (
    this._trustLocalhost &&
    /^(?:localhost|127\.0\.0\.\d+|(0*:)+:0*1)$/.test(url.hostname)
  ) {
    options.rejectUnauthorized = false;
  }

  // initiate request
  const module_ = this._enableHttp2
    ? exports.protocols['http2:'].setProtocol(protocol)
    : exports.protocols[protocol];

  // request
  this.req = module_.request(options);
  const { req } = this;

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

  req.on('error', (error) => {
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

  if (this._stripCookiesForCrossOrigin) {
    delete this.username;
    delete this.password;
    delete this.cookies;
    if (this.header) {
      for (const key of Object.keys(this.header)) {
        const lk = key.toLowerCase();
        if (lk === 'authorization' || lk === 'cookie') {
          delete this.header[key];
        }
      }
    }
    if (this._header) {
      for (const key of Object.keys(this._header)) {
        const lk = key.toLowerCase();
        if (lk === 'authorization' || lk === 'cookie') {
          delete this._header[key];
        }
      }
    }
  }

  // auth
  if (url.username || url.password) {
    this.auth(url.username, url.password);
  }

  if (this.username && this.password && !this._stripCookiesForCrossOrigin) {
    this.auth(this.username, this.password);
  }

  for (const key in this.header) {
    if (hasOwn(this.header, key)) req.setHeader(key, this.header[key]);
  }

  // add cookies
  if (this.cookies && !this._stripCookiesForCrossOrigin) {
    if (hasOwn(this._header, 'cookie')) {
      // merge
      const temporaryJar = new CookieJar.CookieJar();
      temporaryJar.setCookies(this._header.cookie.split('; '));
      temporaryJar.setCookies(this.cookies.split('; '));
      req.setHeader(
        'Cookie',
        temporaryJar.getCookies(CookieJar.CookieAccessInfo.All).toValueString()
      );
    } else {
      req.setHeader('Cookie', this.cookies);
    }
  }

  if (this._stripCookiesForCrossOrigin && typeof req.removeHeader === 'function') {
    req.removeHeader('Cookie');
    req.removeHeader('cookie');
    req.removeHeader('Authorization');
    req.removeHeader('authorization');
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
  if (this._sizeError) error = this._sizeError;

  if (this._shouldRetry(error, res)) {
    return this._retry();
  }

  // Request is settling (no more retries) — guarantee spool cleanup for all paths
  this._cleanupSpoolFile();

  const fn = this._callback;
  this.clearTimeout();

  if (!fn) {
    if (error && this.listeners('error').length > 0 && !this._errorEmitted) {
      this._errorEmitted = true;
      this.emit('error', error);
    }
    return;
  }

  if (this.called) return;
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
    // Clean up any disk-spooled replay file on success.
    this._cleanupSpoolFile();
    return fn(null, res);
  }

  error.response = res;
  if (this.hasSizeError() || error.code === 'ETOOLARGE') {
    // Size errors must never trigger automatic retries; retries count is always 0.
    error.retries = 0;
  } else if (this._maxRetries) {
    error.retries = this._retries - 1;
  }

  // only emit error event if there is a listener
  // otherwise we assume the callback to `.end()` will get the error
  if (error && this.listeners('error').length > 0 && !this._errorEmitted) {
    this._errorEmitted = true;
    this.emit('error', error);
  }

  fn(error, res);

  // Clean up any disk-spooled replay file once the request has fully settled.
  // Do this after fn() so the user callback does not race with file deletion.
  this._cleanupSpoolFile();
};

/**
 * Check if `obj` is a host object,
 *
 * @param {Object} obj host object
 * @return {Boolean} is a host object
 * @api private
 */
Request.prototype._isHost = function (object) {
  return (
    Buffer.isBuffer(object) ||
    object instanceof Stream ||
    object instanceof FormData
  );
};

/**
 * Check whether the request upload has completed.
 * For bodyless methods (GET, HEAD), upload is always considered complete.
 * For upload methods, complete only once the request has finished transmitting.
 *
 * @return {Boolean}
 * @api private
 */
Request.prototype._isUploadDone = function () {
  if (this.method === 'GET' || this.method === 'HEAD') return true;
  if (this._uploadComplete) return true;
  const { req } = this;
  if (req) {
    if (req.writableEnded || req.writableFinished || req.finished) {
      this._uploadComplete = true;
      return true;
    }
    const frame = req.frame || (typeof req.getFrame === 'function' && req.frame);
    if (frame && (frame.writableEnded || frame.writableFinished || frame.finished)) {
      this._uploadComplete = true;
      return true;
    }
  }
  return false;
};

/**
 * Abort the request and invoke callback with size limit error.
 * Also protects the emitted Response object from unhandled errors.
 *
 * @param {String} type request or response
 * @return {Error} size error
 * @api private
 */
Request.prototype._abortWithSizeError = function (type) {
  if (this._sizeError) return this._sizeError;

  const error = new Error(`Maximum ${type} size reached`);
  error.code = 'ETOOLARGE';
  error.retries = 0;
  this._sizeError = error;

  // Prevent unhandled error event on the raw IncomingMessage only if no listeners
  if (this.res && this.res.listeners('error').length === 0) {
    this.res.on('error', () => {});
  }

  // Prevent unhandled error event on the raw ClientRequest only if no listeners
  if (this.req && this.req.listeners('error').length === 0) {
    this.req.on('error', () => {});
  }

  if (this._sourceStream) {
    this._sourceStream.unpipe(this);
    if (typeof this._sourceStream.destroy === 'function') {
      this._sourceStream.destroy();
    } else if (typeof this._sourceStream.resume === 'function') {
      this._sourceStream.resume();
    }
  }

  if (this._pipeDestination) {
    const dest = this._pipeDestination;
    this._pipeDestination = null;
    if (typeof dest.destroy === 'function') {
      dest.destroy(dest.listeners('error').length > 0 ? error : undefined);
    } else {
      if (dest.listeners('error').length > 0) {
        dest.emit('error', error);
      }
      if (typeof dest.end === 'function') {
        dest.end();
      }
    }
  }

  if (this._pendingUnbufferedResponse) {
    if (typeof this._pendingUnbufferedResponse._cleanupReplay === 'function') {
      this._pendingUnbufferedResponse._cleanupReplay();
    }
    this._pendingUnbufferedResponse = null;
  }

  if (type === 'response' && this.res) {
    if (!this.res._sizeErrorDestroyed) {
      this.res._sizeErrorDestroyed = true;
      if (this.response && this.response.listeners('error').length === 0) {
        this.response.once('error', () => {});
      }
      if (typeof this.res.destroy === 'function') {
        this.res.destroy(error);
      } else {
        this.res.emit('error', error);
      }
    }
  }

  this.abort();
  if (!this.called) {
    this.callback(error, type === 'response' ? null : undefined);
  } else {
    // If callback was already called (e.g. unbuffered streaming),
    // still emit error on the Request if an error listener is attached.
    if (this.listeners('error').length > 0 && !this._errorEmitted) {
      this._errorEmitted = true;
      this.emit('error', error);
    }
  }
  return error;
};

/**
 * Check whether a request body has exceeded the configured size limit.
 *
 * @param {Number} size request body size in bytes
 * @return {Boolean} whether the request may continue
 * @api private
 */
Request.prototype._checkRequestSize = function (size) {
  if (
    this._maxRequestSize !== undefined &&
    size > this._maxRequestSize
  ) {
    this._abortWithSizeError('request');
    return false;
  }

  return true;
};

/**
 * Monitor and limit response body downloads.
 * A single counting Transform used by _pipeContinue.
 *
 * @return {Transform} response monitor
 * @api private
 */
Request.prototype._getResponseMonitor = function () {
  if (this._maxResponseSize === undefined) {
    return new Stream.PassThrough();
  }

  const max = this._maxResponseSize;
  let loaded = 0;

  const monitor = new Stream.Transform();
  monitor._transform = (chunk, encoding, callback) => {
    loaded += chunk.length;
    if (loaded > max) {
      const error = this._abortWithSizeError('response');
      if (this.res) {
        this.res.unpipe();
        this.res.destroy();
      }
      return callback(error);
    }

    callback(null, chunk);
  };

  return monitor;
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


  const origEmit = response.emit;
  let responseErrorEmitted = false;
  response.emit = function (event, ...args) {
    if (event === 'error') {
      if (responseErrorEmitted) return false;
      responseErrorEmitted = true;
    }
    return origEmit.apply(this, [event, ...args]);
  };

  // Prevent unhandled error crashes when consumer handles response via callback
  response.on('error', noop);

  response.files = files;
  if (this._endCalled) {
    response.pipe = function () {
      throw new Error(
        "end() has already been called, so it's too late to start piping"
      );
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
  if (this._endCalled) {
    throw new Error(
      '.end() was called twice. This is not supported in superagent'
    );
  }

  this._endCalled = true;

  // store callback
  this._callback = fn || noop;

  const canRedirect = this._maxRedirects === undefined || this._maxRedirects > 0;
  const canRetry = Boolean(this._maxRetries && this._maxRetries > 0);
  const hasSizeLimit = this._maxRequestSize !== undefined || this._maxResponseSize !== undefined;
  const needsMultipartReplay = this.method !== 'GET' && this.method !== 'HEAD' && this._formData && (canRetry || canRedirect || hasSizeLimit);

  if (needsMultipartReplay && !this._formDataTmpPath) {
    if (!this._formDataSpoolPromise) {
      const formData = this._formData;
      this._formDataHeaders = formData.getHeaders();
      this._formDataSpoolPromise = new Promise((resolve, reject) => {
        spoolFormDataToDisk(formData, this._maxRequestSize, (error, result) => {
          if (error) return reject(error);
          resolve(result);
        });
      });
    }

    this._formDataSpoolPromise.then((result) => {
      if (this._aborted || this.hasSizeError()) return;
      this._formDataTmpPath = result.tmpPath;
      this._formDataTmpLength = result.totalLength;
      delete this._formData;

      this.request();
      debug('%s %s', this.method, this.url);
      this._end();
    }).catch((error) => {
      if (this.hasSizeError()) return;
      if (error.code === 'ETOOLARGE') {
        this._abortWithSizeError('request');
        return;
      }
      this.callback(error);
    });
    return;
  }

  this.request();
  debug('%s %s', this.method, this.url);

  this._end();
};

/**
 * Spool a Node FormData instance to a temporary file on disk for replay.
 * Using disk storage avoids in-memory duplication and removes any size cap
 * for response-only limits (the disk holds arbitrary-size payloads).
 * - If maxRequestSize is configured and exceeded: callback with ETOOLARGE error.
 * - Otherwise: callback with { tmpPath, totalLength } for the caller to replay.
 *
 * @param {FormData} formData
 * @param {Number} [maxRequestSize]
 * @param {Function} callback (err, { tmpPath, totalLength } | null)
 * @api private
 */
const activeSpoolFiles = new Set();
process.once('exit', () => {
  const pathMod = require('path');
  for (const file of activeSpoolFiles) {
    try {
      fs.unlinkSync(file);
    } catch (_) {
      // ignore
    }
    // Also remove the parent private temp directory created by mkdtemp
    try {
      const dir = pathMod.dirname(file);
      if (dir && dir !== require('os').tmpdir()) {
        fs.rmdirSync(dir);
      }
    } catch (_) {
      // ignore
    }
  }
});

function spoolFormDataToDisk(formData, maxRequestSize, callback) {
  const os = require('os');
  const pathMod = require('path');

  // Use fs.mkdtemp to atomically create a private temporary directory,
  // preventing symlink race conditions (CWE-377).
  const prefix = pathMod.join(os.tmpdir(), 'sa-replay-');
  fs.mkdtemp(prefix, (mkdtempErr, tmpDir) => {
    if (mkdtempErr) {
      return callback(mkdtempErr);
    }

    const tmpPath = pathMod.join(tmpDir, 'body.tmp');
    activeSpoolFiles.add(tmpPath);

    const ws = fs.createWriteStream(tmpPath, { flags: 'wx', mode: 0o600 });
    let totalLength = 0;
    let done = false;
    let limitExceeded = false;

    const cleanup = () => {
      activeSpoolFiles.delete(tmpPath);
      try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
      try { fs.rmdirSync(tmpDir); } catch (_) { /* ignore */ }
    };

    const fail = (err) => {
      if (done) return;
      done = true;
      ws.destroy();
      cleanup();
      callback(err);
    };

    formData.on('data', (chunk) => {
      if (done || limitExceeded) return;
      const len = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      totalLength += len;
      if (maxRequestSize !== undefined && totalLength > maxRequestSize) {
        limitExceeded = true;
        // Stop the stream; fail will fire via ws close or explicitly here
        if (typeof formData.destroy === 'function') {
          formData.destroy();
        } else if (typeof formData.resume === 'function') {
          formData.resume();
        }
        const err = new Error('Maximum request size reached');
        err.code = 'ETOOLARGE';
        err.retries = 0;
        fail(err);
      }
    });

    formData.once('error', fail);
    ws.once('error', fail);

    formData.pipe(ws);

    ws.once('finish', () => {
      if (done || limitExceeded) return;
      done = true;
      callback(null, { tmpPath, totalLength });
    });
  });
}

function cleanupSpoolPath(f) {
  if (!f) return;
  activeSpoolFiles.delete(f);
  const remove = (retries = 3) => {
    fs.unlink(f, (err) => {
      if (err && (err.code === 'EBUSY' || err.code === 'EPERM') && retries > 0) {
        setTimeout(() => remove(retries - 1), 25);
      } else {
        // Try to remove the parent private temp directory created by mkdtemp
        const pathMod = require('path');
        const dir = pathMod.dirname(f);
        if (dir && dir !== require('os').tmpdir()) {
          try { fs.rmdirSync(dir); } catch (_) { /* ignore - dir may still have files */ }
        }
      }
    });
  };
  remove();
}

/**
 * Detach and destroy old spool upload stream and progress monitor before a retry or redirect.
 * Retains the spool file on disk for the next attempt while preventing stale data races.
 * @api private
 */
Request.prototype._detachSpoolUploadStream = function () {
  if (this._spoolProgressMonitor) {
    this._spoolProgressMonitor._detached = true;
    try {
      if (typeof this._spoolProgressMonitor.unpipe === 'function') {
        this._spoolProgressMonitor.unpipe();
      }
    } catch (_) {
      // ignore
    }
    this._spoolProgressMonitor = null;
  }
  if (this._spoolReadStream) {
    try {
      if (typeof this._spoolReadStream.unpipe === 'function') {
        this._spoolReadStream.unpipe();
      }
      if (typeof this._spoolReadStream.destroy === 'function') {
        this._spoolReadStream.destroy();
      }
    } catch (_) {
      // ignore
    }
    this._spoolReadStream = null;
  }
};

/**
 * Clean up the temporary replay spool file if one was created.
 * Safe to call multiple times.
 * @api private
 */
Request.prototype._cleanupSpoolFile = function () {
  this._detachSpoolUploadStream();
  if (this._formDataSpoolPromise) {
    const p = this._formDataSpoolPromise;
    this._formDataSpoolPromise = null;
    p.then((result) => {
      if (result && result.tmpPath) {
        cleanupSpoolPath(result.tmpPath);
      }
    }).catch(() => {});
  }
  if (this._formDataTmpPath) {
    const f = this._formDataTmpPath;
    this._formDataTmpPath = null;
    cleanupSpoolPath(f);
  }
};


Request.prototype._end = function () {
  this._attemptGeneration = (this._attemptGeneration || 0) + 1;
  const currentAttempt = this._attemptGeneration;
  if (this._aborted)
    return this.callback(
      this._sizeError ||
        new Error('The request has been aborted even before .end() was called')
    );

  let data = this._data;
  const { req } = this;
  const { method } = this;

  if (method === 'GET' || method === 'HEAD') {
    this._cleanupSpoolFile();
    this._formDataTmpLength = null;
    delete this._formDataHeaders;
    this._data = null;
    delete this._formData;
    delete this._formDataSerialized;
  }

  this._setTimeouts();

  // body
  // serialize stuff
  if (typeof data !== 'string' && !req._headerSent) {
    let contentType = req.getHeader('Content-Type');
    // Parse out just the content type from the header (ignore the charset)
    if (contentType) contentType = contentType.split(';')[0];
    let serialize = this._serializer || exports.serialize[contentType];
    if (!serialize && isJSON(contentType)) {
      serialize = exports.serialize['application/json'];
    }

    if (serialize) data = serialize(data);
  }

  if (!this._formData && data !== undefined && data !== null) {
    const length = Buffer.isBuffer(data)
      ? data.length
      : typeof data === 'string'
        ? Buffer.byteLength(data)
        : ArrayBuffer.isView(data)
          ? data.byteLength
          : data instanceof ArrayBuffer
            ? data.byteLength
            : undefined;
    if (length !== undefined) {
      if (!Buffer.isBuffer(data)) {
        this._requestBytesSent = (this._requestBytesSent || 0) + length;
        if (!this._checkRequestSize(this._requestBytesSent)) return;
      } else {
        const total = (this._requestBytesSent || 0) + length;
        if (!this._checkRequestSize(total)) return;
      }
    }
  }

  // content-length
  if (method !== 'HEAD' && !req._headerSent && data && !req.getHeader('Content-Length')) {
    req.setHeader(
      'Content-Length',
      Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data)
    );
  }

  const explicitCl = parseInt(this.getHeader('Content-Length') || (req && req.getHeader && req.getHeader('Content-Length')), 10);
  if (!isNaN(explicitCl) && this._maxRequestSize !== undefined && explicitCl > this._maxRequestSize) {
    if (!this._checkRequestSize(explicitCl)) return;
  }

  // Track upload completion for ALL upload paths (not just spooled multipart).
  // This ensures the unbuffered response deferral works for plain .send(), Buffer,
  // stream, and non-spooled FormData uploads — not just disk-spooled multipart.
  const onUploadFinished = () => {
    if (this._uploadComplete) return;
    this._uploadComplete = true;

    if (this._pendingUnbufferedResponse) {
      if (!this._resEnded) {
        // Do NOT settle _pendingUnbufferedResponse from onUploadFinished merely because upload completed.
        // Keep it pending until response has ended to prevent premature settlement before
        // size-limit validation or transient retry conditions are determined.
        return;
      }
      if (!this.called && !this.hasSizeError()) {
        const pending = this._pendingUnbufferedResponse;
        this._pendingUnbufferedResponse = null;
        this.callback(null, pending);
        if (typeof pending._drainReplay === 'function') {
          pending._drainReplay();
        }
      }
      return;
    }

    if (this._pendingBufferedResponse && !this.called && !this.hasSizeError()) {
      const pending = this._pendingBufferedResponse;
      this._pendingBufferedResponse = null;
      this.callback(null, pending);
    }
  };

  req.once('finish', onUploadFinished);

  // Transport-agnostic support: observe HTTP/2 frame or custom stream wrappers
  const observeFrame = (frame) => {
    if (!frame) return;
    if (frame.writableEnded || frame.writableFinished || frame.finished) {
      process.nextTick(onUploadFinished);
    } else {
      frame.once('finish', onUploadFinished);
    }
  };

  if (typeof req.getFrame === 'function') {
    if (req.frame) {
      observeFrame(req.frame);
    } else {
      const origGetFrame = req.getFrame.bind(req);
      req.getFrame = () => {
        const frame = origGetFrame();
        observeFrame(frame);
        return frame;
      };
    }
  }

  // response
  // eslint-disable-next-line complexity
  req.once('response', (res) => {
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
      console.warn(
        "A custom superagent parser has been set, but buffering strategy for the parser hasn't been configured. Call `req.buffer(true or false)` or set `superagent.buffer[mime] = true or false`"
      );
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
          bridgeStream.socket = res.socket || { readable: true };

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
    if ((undefined === buffer && isText(mime)) || isJSON(mime)) {
      buffer = true;
    }

    this._resBuffered = buffer;
    let parserHandlesEnd = false;

    const maxLimit = buffer
      ? (this._maxResponseSize !== undefined ? this._maxResponseSize : 200000000)
      : this._maxResponseSize;

    // Protection against zip bombs and other nuisance (buffered, or unbuffered when maxResponseSize is set)
    // Only precheck Content-Length when NOT compressing/decompressing and response has body content (e.g. not 204 or 304), because
    // maxResponseSize counts uncompressed bytes while Content-Length reflects compressed bytes.
    if (maxLimit !== undefined && this.method.toUpperCase() !== 'HEAD' && hasNonEmptyResponseContent(res) && !this._shouldDecompress(res)) {
      const clHeader = res.headers['content-length'];
      if (clHeader) {
        const cl = parseInt(clHeader, 10);
        if (!isNaN(cl) && cl > maxLimit) {
          parserHandlesEnd = false;
          const error = this._abortWithSizeError('response');
          if (typeof res.destroy === 'function') {
            res.destroy(error);
          }
          return;
        }
      }
    }

    if (maxLimit !== undefined) {
      let responseBytesLeft = maxLimit;
      const onDataChunk = (chunk) => {
        if (this.hasSizeError()) return;

        const len = Buffer.isBuffer(chunk)
          ? chunk.length
          : typeof chunk === 'string'
            ? Buffer.byteLength(chunk)
            : chunk.byteLength || 0;

        responseBytesLeft -= len;
        if (responseBytesLeft < 0) {
          parserHandlesEnd = false;
          const error = this._abortWithSizeError('response');
          if (typeof res.destroy === 'function') {
            res.destroy(error);
          }
        }
      };

      if (this._shouldDecompress(res)) {
        res._onDecompressChunk = onDataChunk;
      } else {
        const origPush = res.push;
        const self = this;
        res.push = function (chunk) {
          if (chunk && !self.hasSizeError()) {
            onDataChunk(chunk);
          }
          return origPush.apply(this, arguments);
        };
      }
    }

    if (parser) {
      try {
        // Unbuffered parsers are supposed to emit response early,
        // which is weird BTW, because response.body won't be there.
        parserHandlesEnd = buffer;

        parser(res, (error, object, files) => {
          if (this.timedout || this.hasSizeError()) {
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
            const uploadComplete = this._maxRequestSize === undefined || this._isUploadDone();
            if (!uploadComplete) {
              this._pendingBufferedResponse = this._emitResponse(object, files);
              return;
            }
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
      const response = this._emitResponse();

      // terminating events: register error handler for unbuffered mode
      res.once('error', (error) => {
        parserHandlesEnd = false;
        if (this._attemptGeneration !== currentAttempt) return;
        if (this.hasSizeError()) return;
        if (res.statusCode === 204 && (error.message === 'aborted' || error.code === 'ECONNRESET')) {
          return this.callback(null, response);
        }
        res.on('error', () => {});
        this.callback(error, null);
      });

      const hasResponseLimit = this._maxResponseSize !== undefined;
      const uploadPending = (this._maxRequestSize !== undefined || this.method !== 'GET') && !this._isUploadDone();
      const hasRetries = Boolean(this._maxRetries && this._retries < this._maxRetries);
      const hasMultipartSpool = Boolean(this._formDataTmpPath || this._formData);
      const shouldDeferCallback = hasResponseLimit || uploadPending || (hasRetries && hasMultipartSpool);

      if (shouldDeferCallback) {
        this._pendingUnbufferedResponse = response;

        let responseEnded = false;
        let endEmitted = false;
        const queuedChunks = [];
        let queuedBytes = 0;
        let replayBytes = 0;
        const MAX_UNBUFFERED_REPLAY_BYTES = 256 * 1024; // Bounded in-memory replay window for unbuffered responses

        const cleanup = () => {
          queuedChunks.length = 0;
          response.removeListener('newListener', onNewListener);
          res.removeListener('data', onResData);
          res.removeListener('end', onResEnd);
          delete response._drainReplay;
          delete response._cleanupReplay;
        };
        response._cleanupReplay = cleanup;

        const settleCallback = () => {
          if (this._attemptGeneration !== currentAttempt) return;
          if (!this.called && !this.hasSizeError()) {
            this._pendingUnbufferedResponse = null;
            this.callback(null, response);
          }
        };

        const drain = () => {
          if (this._attemptGeneration !== currentAttempt) return;
          while (queuedChunks.length > 0) {
            const chunk = queuedChunks.shift();
            response.emit('data', chunk);
          }
          if (responseEnded && !endEmitted && response.listeners('end').length > 0) {
            endEmitted = true;
            process.nextTick(() => {
              if (this._attemptGeneration === currentAttempt) {
                response.emit('end');
              }
            });
          }
        };
        response._drainReplay = drain;

        const onResData = (chunk) => {
          if (!chunk) return;
          if (this._attemptGeneration !== currentAttempt) {
            res.removeListener('data', onResData);
            res.removeListener('end', onResEnd);
            if (typeof res.destroy === 'function') {
              res.destroy();
            }
            cleanup();
            return;
          }
          queuedBytes += chunk.length;
          if (hasResponseLimit && queuedBytes > this._maxResponseSize) {
            this._abortWithSizeError('response');
            return;
          }
          if (response.listeners('data').length > 0) {
            if (queuedChunks.length > 0) {
              drain();
            }
            // Note: Response (src/node/response.js:44) already permanently forwards
            // res.on('data', this.emit.bind(this, 'data')). Do not duplicate emission!
          } else if (replayBytes + chunk.length <= MAX_UNBUFFERED_REPLAY_BYTES) {
            queuedChunks.push(chunk);
            replayBytes += chunk.length;
          } else {
            // Reached bounded replay limit: transition to live streaming via callback settle and drain
            queuedChunks.push(chunk);
            settleCallback();
            if (this._attemptGeneration !== currentAttempt) return;
            drain();
          }
        };

        const onResEnd = () => {
          if (this._attemptGeneration !== currentAttempt) return;
          responseEnded = true;
          if (response.listeners('end').length > 0) {
            endEmitted = true;
          }
        };

        const onNewListener = (event) => {
          if (this._attemptGeneration !== currentAttempt) return;
          if (event === 'data') {
            settleCallback();
            if (queuedChunks.length > 0) {
              process.nextTick(drain);
            }
          } else if (event === 'end' && responseEnded && !endEmitted) {
            endEmitted = true;
            process.nextTick(() => {
              if (this._attemptGeneration === currentAttempt) {
                response.emit('end');
              }
            });
          }
        };

        res.on('data', onResData);
        res.once('end', onResEnd);
        response.on('newListener', onNewListener);

        res.once('error', cleanup);
        this.once('abort', cleanup);
      } else {
        this.callback(null, response);
      }

      res.once('end', () => {
        if (this._attemptGeneration !== currentAttempt) return;
        debug('end %s %s', this.method, this.url);
        if (!multipart) this.emit('end');

        if (this.hasSizeError()) return;

        this._resEnded = true;
        const uploadComplete = this._maxRequestSize === undefined || this._isUploadDone();
        if (!uploadComplete) {
          return;
        }

        if (this._pendingUnbufferedResponse && !this.called) {
          const pending = this._pendingUnbufferedResponse;
          this._pendingUnbufferedResponse = null;
          this.callback(null, pending);
          if (typeof pending._drainReplay === 'function') {
            pending._drainReplay();
          }
        }
      });
      return;
    }

    // terminating events
    res.once('error', (error) => {
      parserHandlesEnd = false;
      if (this._attemptGeneration !== currentAttempt) return;
      if (this.hasSizeError()) return;
      if (res.statusCode === 204 && (error.message === 'aborted' || error.code === 'ECONNRESET')) {
        return this.callback(null, this._emitResponse());
      }
      res.on('error', () => {});
      this.callback(error, null);
    });

    if (!parserHandlesEnd)
      res.once('end', () => {
        if (this._attemptGeneration !== currentAttempt) return;
        debug('end %s %s', this.method, this.url);
        // TODO: unless buffering emit earlier to stream
        this.emit('end');
        if (!this.hasSizeError()) {
          const uploadComplete = this._maxRequestSize === undefined || this._isUploadDone();
          if (!uploadComplete) {
            this._pendingBufferedResponse = this._emitResponse();
            return;
          }
          this.callback(null, this._emitResponse());
        }
      });
  });

  this.emit('request', this);

  const getProgressMonitor = () => {
    const lengthComputable = true;
    const total = req.getHeader('Content-Length');
    let loaded = 0;

    const progress = new Stream.Transform();
    progress._transform = (chunk, encoding, callback) => {
      if (progress._detached) {
        return callback();
      }
      loaded += chunk.length;
      this._requestBytesSent = (this._requestBytesSent || 0) + chunk.length;
      if (!this._checkRequestSize(this._requestBytesSent)) {
        return callback(this._sizeError);
      }
      this.emit('progress', {
        direction: 'upload',
        lengthComputable,
        loaded,
        total
      });
      callback(null, chunk);
    };

    progress.once('finish', onUploadFinished);

    progress.on('error', (error) => {
      if (!this.hasSizeError()) this.callback(error);
    });

    return progress;
  };

  const bufferToChunks = (buffer) => {
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

  // If a disk-spooled multipart payload was already preserved (e.g. for retry), replay it.
  if (this.method !== 'GET' && this.method !== 'HEAD' && this._formDataTmpPath) {
    const headers = this._formDataHeaders || {};
    for (const i in headers) {
      if (hasOwn(headers, i)) {
        req.setHeader(i, headers[i]);
      }
    }
    const tmpLength = this._formDataTmpLength || 0;
    req.setHeader('Content-Length', tmpLength);
    if (!this._checkRequestSize(tmpLength)) {
      this._cleanupSpoolFile();
      return;
    }

    const progressMonitor = getProgressMonitor();
    const stream = fs.createReadStream(this._formDataTmpPath);
    this._spoolReadStream = stream;
    this._spoolProgressMonitor = progressMonitor;
    stream.pipe(progressMonitor).pipe(req);
  } else if (this.method !== 'GET' && this.method !== 'HEAD' && this._formData) {
    const formData = this._formData;
    // set headers
    const headers = formData.getHeaders();
    this._formDataHeaders = headers;
    for (const i in headers) {
      if (hasOwn(headers, i)) {
        debug('setting FormData header: "%s: %s"', i, headers[i]);
        req.setHeader(i, headers[i]);
      }
    }

    // Spool the multipart payload whenever retries, redirects, or transfer size limits are configured.
    const canRedirect = this._maxRedirects === undefined || this._maxRedirects > 0;
    const canRetry = Boolean(this._maxRetries && this._maxRetries > 0);
    const hasSizeLimit = this._maxRequestSize !== undefined || this._maxResponseSize !== undefined;
    const needsMultipartReplay = canRetry || canRedirect || hasSizeLimit;

    if (needsMultipartReplay) {
      if (!this._formDataSpoolPromise) {
        this._formDataSpoolPromise = new Promise((resolve, reject) => {
          spoolFormDataToDisk(formData, this._maxRequestSize, (error, result) => {
            if (error) return reject(error);
            resolve(result);
          });
        });
      }

      this._formDataSpoolPromise.then((result) => {
        if (this._aborted || this.hasSizeError() || !this._formDataSpoolPromise) {
          if (result && result.tmpPath) {
            cleanupSpoolPath(result.tmpPath);
          }
          return;
        }
        const { tmpPath, totalLength } = result;
        this._formDataTmpPath = tmpPath; // used for replay on retry
        this._formDataTmpLength = totalLength;
        delete this._formData;

        req.setHeader('Content-Length', totalLength);
        if (!this._checkRequestSize(totalLength)) {
          this._cleanupSpoolFile();
          return;
        }

        const progressMonitor = getProgressMonitor();
        const stream = fs.createReadStream(tmpPath);
        this._spoolReadStream = stream;
        this._spoolProgressMonitor = progressMonitor;
        stream.pipe(progressMonitor).pipe(req);
      }).catch((error) => {
        if (this.hasSizeError()) return;
        if (error.code === 'ETOOLARGE') {
          this._abortWithSizeError('request');
          return;
        }
        return this.callback(error);
      });
      return;
    } else {
      // Streaming upload path (preserves streaming, bounds memory, no buffering)
      formData.getLength((error, length) => {
        if (error) debug('formData.getLength had error', error, length);

        debug('got FormData Content-Length: %s', length);
        if (typeof length === 'number') {
          req.setHeader('Content-Length', length);
          if (this._maxRequestSize !== undefined && !this._checkRequestSize(length)) {
            return;
          }
        }

        formData.pipe(getProgressMonitor()).pipe(req);
      });
    }
  } else if (Buffer.isBuffer(data)) {
    bufferToChunks(data).pipe(getProgressMonitor()).pipe(req);
  } else {
    req.end(data);
  }
};

// Check whether response has a non-0-sized gzip-encoded body
Request.prototype._shouldDecompress = (res) => {
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
    this._connectOverride = { '*': connectOverride };
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
  return (
    ['audio', 'font', 'image', 'video'].includes(registry) ||
    ['gz', 'gzip'].includes(name)
  );
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

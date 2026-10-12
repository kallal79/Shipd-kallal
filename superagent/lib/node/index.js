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
  this._pipeDestination = null;
  this.once('end', this.clearTimeout.bind(this));
  this.on('pipe', source => {
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
  if (this._aborted || this.hasSizeError()) return false;
  if (!this._streamRequest) {
    this._streamRequest = true;
  }
  const length = Buffer.isBuffer(data) ? data.length : typeof data === 'string' ? Buffer.byteLength(data, encoding) : ArrayBuffer.isView(data) ? data.byteLength : data instanceof ArrayBuffer ? data.byteLength : 0;
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
    this.req.once('response', res => {
      // Avoid "double callback bug"
      if (this.hasSizeError()) return;

      // redirect
      if (isRedirect(res.statusCode) && this._redirects++ !== this._maxRedirects) {
        return this._redirect(res, () => {
          this._pipeContinue(stream, options);
        });
      }
      this.res = res;
      this._emitResponse();
      if (this._aborted) return;

      // Bodyless-aware, compression-aware Content-Length precheck for piped final responses.
      // Immediately aborts unbuffered streams exceeding maxResponseSize before body data arrives.
      if (this._maxResponseSize !== undefined && this.method.toUpperCase() !== 'HEAD' && hasNonEmptyResponseContent(res) && !this._shouldDecompress(res)) {
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
      monitor.on('error', error => {
        if (this.res) {
          this.res.unpipe();
          if (typeof this.res.destroy === 'function') {
            this.res.destroy(error);
          }
        }
      });
      if (this._shouldDecompress(res)) {
        let decompresser = chooseDecompresser(res);
        decompresser.on('error', error => {
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
    redirectStream.on('data', chunk => {
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
      req.setHeader('Cookie', temporaryJar.getCookies(CookieJar.CookieAccessInfo.All).toValueString());
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
  return Buffer.isBuffer(object) || object instanceof Stream || object instanceof FormData;
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
  const {
    req
  } = this;
  if (req) {
    if (req.writableEnded || req.writableFinished || req.finished) {
      this._uploadComplete = true;
      return true;
    }
    const frame = req.frame || typeof req.getFrame === 'function' && req.frame;
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
  if (this._maxRequestSize !== undefined && size > this._maxRequestSize) {
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
  if (this._endCalled) {
    throw new Error('.end() was called twice. This is not supported in superagent');
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
    this._formDataSpoolPromise.then(result => {
      if (this._aborted || this.hasSizeError()) return;
      this._formDataTmpPath = result.tmpPath;
      this._formDataTmpLength = result.totalLength;
      delete this._formData;
      this.request();
      debug('%s %s', this.method, this.url);
      this._end();
    }).catch(error => {
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
    const ws = fs.createWriteStream(tmpPath, {
      flags: 'wx',
      mode: 0o600
    });
    let totalLength = 0;
    let done = false;
    let limitExceeded = false;
    const cleanup = () => {
      activeSpoolFiles.delete(tmpPath);
      try {
        fs.unlinkSync(tmpPath);
      } catch (_) {/* ignore */}
      try {
        fs.rmdirSync(tmpDir);
      } catch (_) {/* ignore */}
    };
    const fail = err => {
      if (done) return;
      done = true;
      ws.destroy();
      cleanup();
      callback(err);
    };
    formData.on('data', chunk => {
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
      callback(null, {
        tmpPath,
        totalLength
      });
    });
  });
}
function cleanupSpoolPath(f) {
  if (!f) return;
  activeSpoolFiles.delete(f);
  const remove = (retries = 3) => {
    fs.unlink(f, err => {
      if (err && (err.code === 'EBUSY' || err.code === 'EPERM') && retries > 0) {
        setTimeout(() => remove(retries - 1), 25);
      } else {
        // Try to remove the parent private temp directory created by mkdtemp
        const pathMod = require('path');
        const dir = pathMod.dirname(f);
        if (dir && dir !== require('os').tmpdir()) {
          try {
            fs.rmdirSync(dir);
          } catch (_) {/* ignore - dir may still have files */}
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
    p.then(result => {
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
  if (this._aborted) return this.callback(this._sizeError || new Error('The request has been aborted even before .end() was called'));
  let data = this._data;
  const {
    req
  } = this;
  const {
    method
  } = this;
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
    const length = Buffer.isBuffer(data) ? data.length : typeof data === 'string' ? Buffer.byteLength(data) : ArrayBuffer.isView(data) ? data.byteLength : data instanceof ArrayBuffer ? data.byteLength : undefined;
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
    req.setHeader('Content-Length', Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data));
  }
  const explicitCl = parseInt(this.getHeader('Content-Length') || req && req.getHeader && req.getHeader('Content-Length'), 10);
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
  const observeFrame = frame => {
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
    const maxLimit = buffer ? this._maxResponseSize !== undefined ? this._maxResponseSize : 200000000 : this._maxResponseSize;

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
      const onDataChunk = chunk => {
        if (this.hasSizeError()) return;
        const len = Buffer.isBuffer(chunk) ? chunk.length : typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength || 0;
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
      res.once('error', error => {
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
      const shouldDeferCallback = hasResponseLimit || uploadPending || hasRetries && hasMultipartSpool;
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
        const onResData = chunk => {
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
        const onNewListener = event => {
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
    res.once('error', error => {
      parserHandlesEnd = false;
      if (this._attemptGeneration !== currentAttempt) return;
      if (this.hasSizeError()) return;
      if (res.statusCode === 204 && (error.message === 'aborted' || error.code === 'ECONNRESET')) {
        return this.callback(null, this._emitResponse());
      }
      res.on('error', () => {});
      this.callback(error, null);
    });
    if (!parserHandlesEnd) res.once('end', () => {
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
      this._formDataSpoolPromise.then(result => {
        if (this._aborted || this.hasSizeError() || !this._formDataSpoolPromise) {
          if (result && result.tmpPath) {
            cleanupSpoolPath(result.tmpPath);
          }
          return;
        }
        const {
          tmpPath,
          totalLength
        } = result;
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
      }).catch(error => {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmb3JtYXQiLCJyZXF1aXJlIiwiU3RyZWFtIiwiaHR0cHMiLCJodHRwIiwiZnMiLCJ1dGlsIiwicXMiLCJtaW1lIiwibWV0aG9kcyIsIkZvcm1EYXRhIiwiZm9ybWlkYWJsZSIsImRlYnVnIiwiQ29va2llSmFyIiwic2FmZVN0cmluZ2lmeSIsInV0aWxzIiwiUmVxdWVzdEJhc2UiLCJodHRwMiIsImRlY29tcHJlc3MiLCJSZXNwb25zZSIsIm1peGluIiwiaGFzT3duIiwiaXNCcm90bGlFbmNvZGluZyIsImlzR3ppcE9yRGVmbGF0ZUVuY29kaW5nIiwiY2hvb3NlRGVjb21wcmVzc2VyIiwicmVxdWVzdCIsIm1ldGhvZCIsInVybCIsImV4cG9ydHMiLCJSZXF1ZXN0IiwiZW5kIiwiYXJndW1lbnRzIiwibGVuZ3RoIiwibW9kdWxlIiwiYWdlbnQiLCJub29wIiwiZGVmaW5lIiwicHJvdG9jb2xzIiwic2VyaWFsaXplIiwib2JqIiwic3RyaW5naWZ5IiwiaW5kaWNlcyIsInN0cmljdE51bGxIYW5kbGluZyIsInBhcnNlIiwiYnVmZmVyIiwiX2luaXRIZWFkZXJzIiwicmVxdWVzdF8iLCJfaGVhZGVyIiwiaGVhZGVyIiwiY2FsbCIsIl9lbmFibGVIdHRwMiIsIkJvb2xlYW4iLCJwcm9jZXNzIiwiZW52IiwiSFRUUDJfVEVTVCIsIl9hZ2VudCIsIl9mb3JtRGF0YSIsIndyaXRhYmxlIiwiX3JlZGlyZWN0cyIsInJlZGlyZWN0cyIsImNvb2tpZXMiLCJfcXVlcnkiLCJxc1JhdyIsIl9yZWRpcmVjdExpc3QiLCJfc3RyZWFtUmVxdWVzdCIsIl9sb29rdXAiLCJ1bmRlZmluZWQiLCJfcGlwZURlc3RpbmF0aW9uIiwib25jZSIsImNsZWFyVGltZW91dCIsImJpbmQiLCJvbiIsInNvdXJjZSIsIl9zb3VyY2VTdHJlYW0iLCJpbmhlcml0cyIsInByb3RvdHlwZSIsImJvb2wiLCJFcnJvciIsImF0dGFjaCIsImZpZWxkIiwiZmlsZSIsIm9wdGlvbnMiLCJfZGF0YSIsIm8iLCJmaWxlbmFtZSIsImNyZWF0ZVJlYWRTdHJlYW0iLCJlcnJvciIsImZvcm1EYXRhIiwiX2dldEZvcm1EYXRhIiwiZW1pdCIsInBhdGgiLCJhcHBlbmQiLCJjYWxsZWQiLCJjYWxsYmFjayIsImFib3J0IiwibG9va3VwIiwidHlwZSIsInNldCIsImluY2x1ZGVzIiwiZ2V0VHlwZSIsImFjY2VwdCIsInF1ZXJ5IiwidmFsdWUiLCJwdXNoIiwiT2JqZWN0IiwiYXNzaWduIiwid3JpdGUiLCJkYXRhIiwiZW5jb2RpbmciLCJfYWJvcnRlZCIsImhhc1NpemVFcnJvciIsIkJ1ZmZlciIsImlzQnVmZmVyIiwiYnl0ZUxlbmd0aCIsIkFycmF5QnVmZmVyIiwiaXNWaWV3IiwiX3JlcXVlc3RCeXRlc1NlbnQiLCJfY2hlY2tSZXF1ZXN0U2l6ZSIsInVucGlwZSIsImRlc3Ryb3kiLCJyZXN1bWUiLCJwaXBlIiwic3RyZWFtIiwicGlwZWQiLCJfcGlwZUNvbnRpbnVlIiwicmVxIiwicmVzIiwiaXNSZWRpcmVjdCIsInN0YXR1c0NvZGUiLCJfbWF4UmVkaXJlY3RzIiwiX3JlZGlyZWN0IiwiX2VtaXRSZXNwb25zZSIsIl9tYXhSZXNwb25zZVNpemUiLCJ0b1VwcGVyQ2FzZSIsImhhc05vbkVtcHR5UmVzcG9uc2VDb250ZW50IiwiX3Nob3VsZERlY29tcHJlc3MiLCJjbEhlYWRlciIsImhlYWRlcnMiLCJjbCIsInBhcnNlSW50IiwiaXNOYU4iLCJfYWJvcnRXaXRoU2l6ZUVycm9yIiwibW9uaXRvciIsIl9nZXRSZXNwb25zZU1vbml0b3IiLCJkZWNvbXByZXNzZXIiLCJjb2RlIiwibGlzdGVuZXJzIiwiX2NsZWFudXBTcG9vbEZpbGUiLCJfYnVmZmVyIiwiY29udGludWF0aW9uIiwibG9jYXRpb24iLCJVUkwiLCJocmVmIiwiY2hhbmdlc09yaWdpbiIsIm9yaWdpbiIsIl9zdHJpcENvb2tpZXNGb3JDcm9zc09yaWdpbiIsInVzZXJuYW1lIiwicGFzc3dvcmQiLCJfZm9ybURhdGFUbXBMZW5ndGgiLCJfZm9ybURhdGFIZWFkZXJzIiwicHJvY2VlZCIsImdldEhlYWRlcnMiLCJfaGVhZGVycyIsImNsZWFuSGVhZGVyIiwiX2Zvcm1EYXRhU2VyaWFsaXplZCIsImF1dGhvcml6YXRpb24iLCJjb29raWUiLCJrIiwia2V5cyIsImxrIiwidG9Mb3dlckNhc2UiLCJob3N0IiwiX2RldGFjaFNwb29sVXBsb2FkU3RyZWFtIiwiX2VuZENhbGxlZCIsIl9lbWl0UmVkaXJlY3QiLCJfY2FsbGJhY2siLCJyZWRpcmVjdEJ5dGVzIiwicmVkaXJlY3RTdHJlYW0iLCJyZWRpcmVjdENsIiwiZXJyIiwic3RhdHVzIiwicHJvY2VlZGVkIiwib25Qcm9jZWVkIiwiY2h1bmsiLCJhdXRoIiwidXNlciIsInBhc3MiLCJlbmNvZGVyIiwic3RyaW5nIiwiZnJvbSIsInRvU3RyaW5nIiwiX2F1dGgiLCJjYSIsImNlcnQiLCJfY2EiLCJrZXkiLCJfa2V5IiwicGZ4IiwiX3BmeCIsIl9wYXNzcGhyYXNlIiwicGFzc3BocmFzZSIsIl9jZXJ0IiwiZGlzYWJsZVRMU0NlcnRzIiwiX2Rpc2FibGVUTFNDZXJ0cyIsIl9maW5hbGl6ZVF1ZXJ5U3RyaW5nIiwidXJsU3RyaW5nIiwicmV0cmllcyIsIl9yZXRyaWVzIiwiaW5kZXhPZiIsInByb3RvY29sIiwicGF0aG5hbWUiLCJzZWFyY2giLCJ0ZXN0Iiwic3BsaXQiLCJzb2NrZXRQYXRoIiwiaG9zdG5hbWUiLCJyZXBsYWNlIiwiX2Nvbm5lY3RPdmVycmlkZSIsIm1hdGNoIiwibmV3SG9zdCIsIm5ld1BvcnQiLCJwb3J0Iiwibm9ybWFsaXplSG9zdG5hbWUiLCJyZWplY3RVbmF1dGhvcml6ZWQiLCJOT0RFX1RMU19SRUpFQ1RfVU5BVVRIT1JJWkVEIiwic2VydmVybmFtZSIsIl90cnVzdExvY2FsaG9zdCIsIm1vZHVsZV8iLCJzZXRQcm90b2NvbCIsInNldE5vRGVsYXkiLCJzZXRIZWFkZXIiLCJyZXNwb25zZSIsInRlbXBvcmFyeUphciIsInNldENvb2tpZXMiLCJnZXRDb29raWVzIiwiQ29va2llQWNjZXNzSW5mbyIsIkFsbCIsInRvVmFsdWVTdHJpbmciLCJyZW1vdmVIZWFkZXIiLCJfc2l6ZUVycm9yIiwiX3Nob3VsZFJldHJ5IiwiX3JldHJ5IiwiZm4iLCJfZXJyb3JFbWl0dGVkIiwiX2lzUmVzcG9uc2VPSyIsIm1lc3NhZ2UiLCJTVEFUVVNfQ09ERVMiLCJfbWF4UmV0cmllcyIsIl9pc0hvc3QiLCJvYmplY3QiLCJfaXNVcGxvYWREb25lIiwiX3VwbG9hZENvbXBsZXRlIiwid3JpdGFibGVFbmRlZCIsIndyaXRhYmxlRmluaXNoZWQiLCJmaW5pc2hlZCIsImZyYW1lIiwiZ2V0RnJhbWUiLCJkZXN0IiwiX3BlbmRpbmdVbmJ1ZmZlcmVkUmVzcG9uc2UiLCJfY2xlYW51cFJlcGxheSIsIl9zaXplRXJyb3JEZXN0cm95ZWQiLCJzaXplIiwiX21heFJlcXVlc3RTaXplIiwiUGFzc1Rocm91Z2giLCJtYXgiLCJsb2FkZWQiLCJUcmFuc2Zvcm0iLCJfdHJhbnNmb3JtIiwiYm9keSIsImZpbGVzIiwib3JpZ0VtaXQiLCJyZXNwb25zZUVycm9yRW1pdHRlZCIsImV2ZW50IiwiYXJncyIsImFwcGx5IiwiY2FuUmVkaXJlY3QiLCJjYW5SZXRyeSIsImhhc1NpemVMaW1pdCIsIm5lZWRzTXVsdGlwYXJ0UmVwbGF5IiwiX2Zvcm1EYXRhVG1wUGF0aCIsIl9mb3JtRGF0YVNwb29sUHJvbWlzZSIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVqZWN0Iiwic3Bvb2xGb3JtRGF0YVRvRGlzayIsInJlc3VsdCIsInRoZW4iLCJ0bXBQYXRoIiwidG90YWxMZW5ndGgiLCJfZW5kIiwiY2F0Y2giLCJhY3RpdmVTcG9vbEZpbGVzIiwiU2V0IiwicGF0aE1vZCIsInVubGlua1N5bmMiLCJfIiwiZGlyIiwiZGlybmFtZSIsInRtcGRpciIsInJtZGlyU3luYyIsIm1heFJlcXVlc3RTaXplIiwib3MiLCJwcmVmaXgiLCJqb2luIiwibWtkdGVtcCIsIm1rZHRlbXBFcnIiLCJ0bXBEaXIiLCJhZGQiLCJ3cyIsImNyZWF0ZVdyaXRlU3RyZWFtIiwiZmxhZ3MiLCJtb2RlIiwiZG9uZSIsImxpbWl0RXhjZWVkZWQiLCJjbGVhbnVwIiwiZGVsZXRlIiwiZmFpbCIsImxlbiIsImNsZWFudXBTcG9vbFBhdGgiLCJmIiwicmVtb3ZlIiwidW5saW5rIiwic2V0VGltZW91dCIsIl9zcG9vbFByb2dyZXNzTW9uaXRvciIsIl9kZXRhY2hlZCIsIl9zcG9vbFJlYWRTdHJlYW0iLCJwIiwiX2F0dGVtcHRHZW5lcmF0aW9uIiwiY3VycmVudEF0dGVtcHQiLCJfc2V0VGltZW91dHMiLCJfaGVhZGVyU2VudCIsImNvbnRlbnRUeXBlIiwiZ2V0SGVhZGVyIiwiX3NlcmlhbGl6ZXIiLCJpc0pTT04iLCJ0b3RhbCIsImV4cGxpY2l0Q2wiLCJvblVwbG9hZEZpbmlzaGVkIiwiX3Jlc0VuZGVkIiwicGVuZGluZyIsIl9kcmFpblJlcGxheSIsIl9wZW5kaW5nQnVmZmVyZWRSZXNwb25zZSIsIm9ic2VydmVGcmFtZSIsIm5leHRUaWNrIiwib3JpZ0dldEZyYW1lIiwiX3Jlc3BvbnNlVGltZW91dFRpbWVyIiwidHJpbSIsIm11bHRpcGFydCIsInJlZGlyZWN0IiwicmVzcG9uc2VUeXBlIiwiX3Jlc3BvbnNlVHlwZSIsInBhcnNlciIsIl9wYXJzZXIiLCJjb25zb2xlIiwid2FybiIsImltYWdlIiwiZm9ybSIsImJyaWRnZVN0cmVhbSIsImh0dHBWZXJzaW9uIiwic29ja2V0IiwicmVhZGFibGUiLCJmaWVsZHMiLCJmbGF0dGVuZWRGaWVsZHMiLCJBcnJheSIsImlzQXJyYXkiLCJmbGF0dGVuZWRGaWxlcyIsImlzQmluYXJ5IiwidGV4dCIsImlzVGV4dCIsIl9yZXNCdWZmZXJlZCIsInBhcnNlckhhbmRsZXNFbmQiLCJtYXhMaW1pdCIsInJlc3BvbnNlQnl0ZXNMZWZ0Iiwib25EYXRhQ2h1bmsiLCJfb25EZWNvbXByZXNzQ2h1bmsiLCJvcmlnUHVzaCIsInNlbGYiLCJ0aW1lZG91dCIsInVwbG9hZENvbXBsZXRlIiwiaGFzUmVzcG9uc2VMaW1pdCIsInVwbG9hZFBlbmRpbmciLCJoYXNSZXRyaWVzIiwiaGFzTXVsdGlwYXJ0U3Bvb2wiLCJzaG91bGREZWZlckNhbGxiYWNrIiwicmVzcG9uc2VFbmRlZCIsImVuZEVtaXR0ZWQiLCJxdWV1ZWRDaHVua3MiLCJxdWV1ZWRCeXRlcyIsInJlcGxheUJ5dGVzIiwiTUFYX1VOQlVGRkVSRURfUkVQTEFZX0JZVEVTIiwicmVtb3ZlTGlzdGVuZXIiLCJvbk5ld0xpc3RlbmVyIiwib25SZXNEYXRhIiwib25SZXNFbmQiLCJzZXR0bGVDYWxsYmFjayIsImRyYWluIiwic2hpZnQiLCJnZXRQcm9ncmVzc01vbml0b3IiLCJsZW5ndGhDb21wdXRhYmxlIiwicHJvZ3Jlc3MiLCJkaXJlY3Rpb24iLCJidWZmZXJUb0NodW5rcyIsImNodW5rU2l6ZSIsImNodW5raW5nIiwiUmVhZGFibGUiLCJyZW1haW5kZXIiLCJjdXRvZmYiLCJpIiwic2xpY2UiLCJyZW1haW5kZXJCdWZmZXIiLCJ0bXBMZW5ndGgiLCJwcm9ncmVzc01vbml0b3IiLCJnZXRMZW5ndGgiLCJjb25uZWN0IiwiY29ubmVjdE92ZXJyaWRlIiwidHJ1c3RMb2NhbGhvc3QiLCJ0b2dnbGUiLCJuYW1lIiwic2VuZCIsInBhcnRzIiwic3VidHlwZSIsInJlZ2lzdHJ5Il0sInNvdXJjZXMiOlsiLi4vLi4vc3JjL25vZGUvaW5kZXguanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBNb2R1bGUgZGVwZW5kZW5jaWVzLlxuICovXG5cbmNvbnN0IHsgZm9ybWF0IH0gPSByZXF1aXJlKCd1cmwnKTtcbmNvbnN0IFN0cmVhbSA9IHJlcXVpcmUoJ3N0cmVhbScpO1xuY29uc3QgaHR0cHMgPSByZXF1aXJlKCdodHRwcycpO1xuY29uc3QgaHR0cCA9IHJlcXVpcmUoJ2h0dHAnKTtcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKTtcbmNvbnN0IHV0aWwgPSByZXF1aXJlKCd1dGlsJyk7XG5jb25zdCBxcyA9IHJlcXVpcmUoJ3FzJyk7XG5jb25zdCBtaW1lID0gcmVxdWlyZSgnbWltZScpO1xubGV0IG1ldGhvZHMgPSByZXF1aXJlKCdtZXRob2RzJyk7XG5jb25zdCBGb3JtRGF0YSA9IHJlcXVpcmUoJ2Zvcm0tZGF0YScpO1xuY29uc3QgZm9ybWlkYWJsZSA9IHJlcXVpcmUoJ2Zvcm1pZGFibGUnKTtcbmNvbnN0IGRlYnVnID0gcmVxdWlyZSgnZGVidWcnKSgnc3VwZXJhZ2VudCcpO1xuY29uc3QgQ29va2llSmFyID0gcmVxdWlyZSgnY29va2llamFyJyk7XG5jb25zdCBzYWZlU3RyaW5naWZ5ID0gcmVxdWlyZSgnZmFzdC1zYWZlLXN0cmluZ2lmeScpO1xuXG5jb25zdCB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzJyk7XG5jb25zdCBSZXF1ZXN0QmFzZSA9IHJlcXVpcmUoJy4uL3JlcXVlc3QtYmFzZScpO1xuY29uc3QgaHR0cDIgPSByZXF1aXJlKCcuL2h0dHAyd3JhcHBlcicpO1xuY29uc3QgeyBkZWNvbXByZXNzIH0gPSByZXF1aXJlKCcuL3VuemlwJyk7XG5jb25zdCBSZXNwb25zZSA9IHJlcXVpcmUoJy4vcmVzcG9uc2UnKTtcblxuY29uc3QgeyBtaXhpbiwgaGFzT3duLCBpc0Jyb3RsaUVuY29kaW5nLCBpc0d6aXBPckRlZmxhdGVFbmNvZGluZyB9ID0gdXRpbHM7XG5jb25zdCB7IGNob29zZURlY29tcHJlc3NlciB9ID0gcmVxdWlyZSgnLi9kZWNvbXByZXNzJyk7XG5cbmZ1bmN0aW9uIHJlcXVlc3QobWV0aG9kLCB1cmwpIHtcbiAgLy8gY2FsbGJhY2tcbiAgaWYgKHR5cGVvZiB1cmwgPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gbmV3IGV4cG9ydHMuUmVxdWVzdCgnR0VUJywgbWV0aG9kKS5lbmQodXJsKTtcbiAgfVxuXG4gIC8vIHVybCBmaXJzdFxuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSkge1xuICAgIHJldHVybiBuZXcgZXhwb3J0cy5SZXF1ZXN0KCdHRVQnLCBtZXRob2QpO1xuICB9XG5cbiAgcmV0dXJuIG5ldyBleHBvcnRzLlJlcXVlc3QobWV0aG9kLCB1cmwpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVlc3Q7XG5leHBvcnRzID0gbW9kdWxlLmV4cG9ydHM7XG5cbi8qKlxuICogRXhwb3NlIGBSZXF1ZXN0YC5cbiAqL1xuXG5leHBvcnRzLlJlcXVlc3QgPSBSZXF1ZXN0O1xuXG4vKipcbiAqIEV4cG9zZSB0aGUgYWdlbnQgZnVuY3Rpb25cbiAqL1xuXG5leHBvcnRzLmFnZW50ID0gcmVxdWlyZSgnLi9hZ2VudCcpO1xuXG4vKipcbiAqIE5vb3AuXG4gKi9cblxuZnVuY3Rpb24gbm9vcCgpIHt9XG5cbi8qKlxuICogRXhwb3NlIGBSZXNwb25zZWAuXG4gKi9cblxuZXhwb3J0cy5SZXNwb25zZSA9IFJlc3BvbnNlO1xuXG4vKipcbiAqIERlZmluZSBcImZvcm1cIiBtaW1lIHR5cGUuXG4gKi9cblxubWltZS5kZWZpbmUoXG4gIHtcbiAgICAnYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJzogWydmb3JtJywgJ3VybGVuY29kZWQnLCAnZm9ybS1kYXRhJ11cbiAgfSxcbiAgdHJ1ZVxuKTtcblxuLyoqXG4gKiBQcm90b2NvbCBtYXAuXG4gKi9cblxuZXhwb3J0cy5wcm90b2NvbHMgPSB7XG4gICdodHRwOic6IGh0dHAsXG4gICdodHRwczonOiBodHRwcyxcbiAgJ2h0dHAyOic6IGh0dHAyXG59O1xuXG4vKipcbiAqIERlZmF1bHQgc2VyaWFsaXphdGlvbiBtYXAuXG4gKlxuICogICAgIHN1cGVyYWdlbnQuc2VyaWFsaXplWydhcHBsaWNhdGlvbi94bWwnXSA9IGZ1bmN0aW9uKG9iail7XG4gKiAgICAgICByZXR1cm4gJ2dlbmVyYXRlZCB4bWwgaGVyZSc7XG4gKiAgICAgfTtcbiAqXG4gKi9cblxuZXhwb3J0cy5zZXJpYWxpemUgPSB7XG4gICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnOiAob2JqKSA9PiB7XG4gICAgcmV0dXJuIHFzLnN0cmluZ2lmeShvYmosIHsgaW5kaWNlczogZmFsc2UsIHN0cmljdE51bGxIYW5kbGluZzogdHJ1ZSB9KTtcbiAgfSxcbiAgJ2FwcGxpY2F0aW9uL2pzb24nOiBzYWZlU3RyaW5naWZ5XG59O1xuXG4vKipcbiAqIERlZmF1bHQgcGFyc2Vycy5cbiAqXG4gKiAgICAgc3VwZXJhZ2VudC5wYXJzZVsnYXBwbGljYXRpb24veG1sJ10gPSBmdW5jdGlvbihyZXMsIGZuKXtcbiAqICAgICAgIGZuKG51bGwsIHJlcyk7XG4gKiAgICAgfTtcbiAqXG4gKi9cblxuZXhwb3J0cy5wYXJzZSA9IHJlcXVpcmUoJy4vcGFyc2VycycpO1xuXG4vKipcbiAqIERlZmF1bHQgYnVmZmVyaW5nIG1hcC4gQ2FuIGJlIHVzZWQgdG8gc2V0IGNlcnRhaW5cbiAqIHJlc3BvbnNlIHR5cGVzIHRvIGJ1ZmZlci9ub3QgYnVmZmVyLlxuICpcbiAqICAgICBzdXBlcmFnZW50LmJ1ZmZlclsnYXBwbGljYXRpb24veG1sJ10gPSB0cnVlO1xuICovXG5leHBvcnRzLmJ1ZmZlciA9IHt9O1xuXG4vKipcbiAqIEluaXRpYWxpemUgaW50ZXJuYWwgaGVhZGVyIHRyYWNraW5nIHByb3BlcnRpZXMgb24gYSByZXF1ZXN0IGluc3RhbmNlLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSByZXEgdGhlIGluc3RhbmNlXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gX2luaXRIZWFkZXJzKHJlcXVlc3RfKSB7XG4gIHJlcXVlc3RfLl9oZWFkZXIgPSB7XG4gICAgLy8gY29lcmNlcyBoZWFkZXIgbmFtZXMgdG8gbG93ZXJjYXNlXG4gIH07XG4gIHJlcXVlc3RfLmhlYWRlciA9IHtcbiAgICAvLyBwcmVzZXJ2ZXMgaGVhZGVyIG5hbWUgY2FzZVxuICB9O1xufVxuXG4vKipcbiAqIEluaXRpYWxpemUgYSBuZXcgYFJlcXVlc3RgIHdpdGggdGhlIGdpdmVuIGBtZXRob2RgIGFuZCBgdXJsYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbWV0aG9kXG4gKiBAcGFyYW0ge1N0cmluZ3xPYmplY3R9IHVybFxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBSZXF1ZXN0KG1ldGhvZCwgdXJsKSB7XG4gIFN0cmVhbS5jYWxsKHRoaXMpO1xuICBpZiAodHlwZW9mIHVybCAhPT0gJ3N0cmluZycpIHVybCA9IGZvcm1hdCh1cmwpO1xuICB0aGlzLl9lbmFibGVIdHRwMiA9IEJvb2xlYW4ocHJvY2Vzcy5lbnYuSFRUUDJfVEVTVCk7IC8vIGludGVybmFsIG9ubHlcbiAgdGhpcy5fYWdlbnQgPSBmYWxzZTtcbiAgdGhpcy5fZm9ybURhdGEgPSBudWxsO1xuICB0aGlzLm1ldGhvZCA9IG1ldGhvZDtcbiAgdGhpcy51cmwgPSB1cmw7XG4gIF9pbml0SGVhZGVycyh0aGlzKTtcbiAgdGhpcy53cml0YWJsZSA9IHRydWU7XG4gIHRoaXMuX3JlZGlyZWN0cyA9IDA7XG4gIHRoaXMucmVkaXJlY3RzKG1ldGhvZCA9PT0gJ0hFQUQnID8gMCA6IDUpO1xuICB0aGlzLmNvb2tpZXMgPSAnJztcbiAgdGhpcy5xcyA9IHt9O1xuICB0aGlzLl9xdWVyeSA9IFtdO1xuICB0aGlzLnFzUmF3ID0gdGhpcy5fcXVlcnk7IC8vIFVudXNlZCwgZm9yIGJhY2t3YXJkcyBjb21wYXRpYmlsaXR5IG9ubHlcbiAgdGhpcy5fcmVkaXJlY3RMaXN0ID0gW107XG4gIHRoaXMuX3N0cmVhbVJlcXVlc3QgPSBmYWxzZTtcbiAgdGhpcy5fbG9va3VwID0gdW5kZWZpbmVkO1xuICB0aGlzLl9waXBlRGVzdGluYXRpb24gPSBudWxsO1xuICB0aGlzLm9uY2UoJ2VuZCcsIHRoaXMuY2xlYXJUaW1lb3V0LmJpbmQodGhpcykpO1xuICB0aGlzLm9uKCdwaXBlJywgKHNvdXJjZSkgPT4ge1xuICAgIHRoaXMuX3NvdXJjZVN0cmVhbSA9IHNvdXJjZTtcbiAgfSk7XG59XG5cbi8qKlxuICogSW5oZXJpdCBmcm9tIGBTdHJlYW1gICh3aGljaCBpbmhlcml0cyBmcm9tIGBFdmVudEVtaXR0ZXJgKS5cbiAqIE1peGluIGBSZXF1ZXN0QmFzZWAuXG4gKi9cbnV0aWwuaW5oZXJpdHMoUmVxdWVzdCwgU3RyZWFtKTtcblxubWl4aW4oUmVxdWVzdC5wcm90b3R5cGUsIFJlcXVlc3RCYXNlLnByb3RvdHlwZSk7XG5cbi8qKlxuICogRW5hYmxlIG9yIERpc2FibGUgaHR0cDIuXG4gKlxuICogRW5hYmxlIGh0dHAyLlxuICpcbiAqIGBgYCBqc1xuICogcmVxdWVzdC5nZXQoJ2h0dHA6Ly9sb2NhbGhvc3QvJylcbiAqICAgLmh0dHAyKClcbiAqICAgLmVuZChjYWxsYmFjayk7XG4gKlxuICogcmVxdWVzdC5nZXQoJ2h0dHA6Ly9sb2NhbGhvc3QvJylcbiAqICAgLmh0dHAyKHRydWUpXG4gKiAgIC5lbmQoY2FsbGJhY2spO1xuICogYGBgXG4gKlxuICogRGlzYWJsZSBodHRwMi5cbiAqXG4gKiBgYGAganNcbiAqIHJlcXVlc3QgPSByZXF1ZXN0Lmh0dHAyKCk7XG4gKiByZXF1ZXN0LmdldCgnaHR0cDovL2xvY2FsaG9zdC8nKVxuICogICAuaHR0cDIoZmFsc2UpXG4gKiAgIC5lbmQoY2FsbGJhY2spO1xuICogYGBgXG4gKlxuICogQHBhcmFtIHtCb29sZWFufSBlbmFibGVcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5odHRwMiA9IGZ1bmN0aW9uIChib29sKSB7XG4gIGlmIChleHBvcnRzLnByb3RvY29sc1snaHR0cDI6J10gPT09IHVuZGVmaW5lZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICdzdXBlcmFnZW50OiB0aGlzIHZlcnNpb24gb2YgTm9kZS5qcyBkb2VzIG5vdCBzdXBwb3J0IGh0dHAyJ1xuICAgICk7XG4gIH1cblxuICB0aGlzLl9lbmFibGVIdHRwMiA9IGJvb2wgPT09IHVuZGVmaW5lZCA/IHRydWUgOiBib29sO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogUXVldWUgdGhlIGdpdmVuIGBmaWxlYCBhcyBhbiBhdHRhY2htZW50IHRvIHRoZSBzcGVjaWZpZWQgYGZpZWxkYCxcbiAqIHdpdGggb3B0aW9uYWwgYG9wdGlvbnNgIChvciBmaWxlbmFtZSkuXG4gKlxuICogYGBgIGpzXG4gKiByZXF1ZXN0LnBvc3QoJ2h0dHA6Ly9sb2NhbGhvc3QvdXBsb2FkJylcbiAqICAgLmF0dGFjaCgnZmllbGQnLCBCdWZmZXIuZnJvbSgnPGI+SGVsbG8gd29ybGQ8L2I+JyksICdoZWxsby5odG1sJylcbiAqICAgLmVuZChjYWxsYmFjayk7XG4gKiBgYGBcbiAqXG4gKiBBIGZpbGVuYW1lIG1heSBhbHNvIGJlIHVzZWQ6XG4gKlxuICogYGBgIGpzXG4gKiByZXF1ZXN0LnBvc3QoJ2h0dHA6Ly9sb2NhbGhvc3QvdXBsb2FkJylcbiAqICAgLmF0dGFjaCgnZmlsZXMnLCAnaW1hZ2UuanBnJylcbiAqICAgLmVuZChjYWxsYmFjayk7XG4gKiBgYGBcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZmllbGRcbiAqIEBwYXJhbSB7U3RyaW5nfGZzLlJlYWRTdHJlYW18QnVmZmVyfSBmaWxlXG4gKiBAcGFyYW0ge1N0cmluZ3xPYmplY3R9IG9wdGlvbnNcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5hdHRhY2ggPSBmdW5jdGlvbiAoZmllbGQsIGZpbGUsIG9wdGlvbnMpIHtcbiAgaWYgKGZpbGUpIHtcbiAgICBpZiAodGhpcy5fZGF0YSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3VwZXJhZ2VudCBjYW4ndCBtaXggLnNlbmQoKSBhbmQgLmF0dGFjaCgpXCIpO1xuICAgIH1cblxuICAgIGxldCBvID0gb3B0aW9ucyB8fCB7fTtcbiAgICBpZiAodHlwZW9mIG9wdGlvbnMgPT09ICdzdHJpbmcnKSB7XG4gICAgICBvID0geyBmaWxlbmFtZTogb3B0aW9ucyB9O1xuICAgIH1cblxuICAgIGlmICh0eXBlb2YgZmlsZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIGlmICghby5maWxlbmFtZSkgby5maWxlbmFtZSA9IGZpbGU7XG4gICAgICBkZWJ1ZygnY3JlYXRpbmcgYGZzLlJlYWRTdHJlYW1gIGluc3RhbmNlIGZvciBmaWxlOiAlcycsIGZpbGUpO1xuICAgICAgZmlsZSA9IGZzLmNyZWF0ZVJlYWRTdHJlYW0oZmlsZSk7XG4gICAgICBmaWxlLm9uKCdlcnJvcicsIChlcnJvcikgPT4ge1xuICAgICAgICBjb25zdCBmb3JtRGF0YSA9IHRoaXMuX2dldEZvcm1EYXRhKCk7XG4gICAgICAgIGZvcm1EYXRhLmVtaXQoJ2Vycm9yJywgZXJyb3IpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIGlmICghby5maWxlbmFtZSAmJiBmaWxlLnBhdGgpIHtcbiAgICAgIG8uZmlsZW5hbWUgPSBmaWxlLnBhdGg7XG4gICAgfVxuXG4gICAgdGhpcy5fZ2V0Rm9ybURhdGEoKS5hcHBlbmQoZmllbGQsIGZpbGUsIG8pO1xuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5fZ2V0Rm9ybURhdGEgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICghdGhpcy5fZm9ybURhdGEpIHtcbiAgICB0aGlzLl9mb3JtRGF0YSA9IG5ldyBGb3JtRGF0YSgpO1xuICAgIHRoaXMuX2Zvcm1EYXRhLm9uKCdlcnJvcicsIChlcnJvcikgPT4ge1xuICAgICAgZGVidWcoJ0Zvcm1EYXRhIGVycm9yJywgZXJyb3IpO1xuICAgICAgaWYgKHRoaXMuY2FsbGVkKSB7XG4gICAgICAgIC8vIFRoZSByZXF1ZXN0IGhhcyBhbHJlYWR5IGZpbmlzaGVkIGFuZCB0aGUgY2FsbGJhY2sgd2FzIGNhbGxlZC5cbiAgICAgICAgLy8gU2lsZW50bHkgaWdub3JlIHRoZSBlcnJvci5cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmNhbGxiYWNrKGVycm9yKTtcbiAgICAgIHRoaXMuYWJvcnQoKTtcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiB0aGlzLl9mb3JtRGF0YTtcbn07XG5cbi8qKlxuICogR2V0cy9zZXRzIHRoZSBgQWdlbnRgIHRvIHVzZSBmb3IgdGhpcyBIVFRQIHJlcXVlc3QuIFRoZSBkZWZhdWx0IChpZiB0aGlzXG4gKiBmdW5jdGlvbiBpcyBub3QgY2FsbGVkKSBpcyB0byBvcHQgb3V0IG9mIGNvbm5lY3Rpb24gcG9vbGluZyAoYGFnZW50OiBmYWxzZWApLlxuICpcbiAqIEBwYXJhbSB7aHR0cC5BZ2VudH0gYWdlbnRcbiAqIEByZXR1cm4ge2h0dHAuQWdlbnR9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3QucHJvdG90eXBlLmFnZW50ID0gZnVuY3Rpb24gKGFnZW50KSB7XG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSByZXR1cm4gdGhpcy5fYWdlbnQ7XG4gIHRoaXMuX2FnZW50ID0gYWdlbnQ7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBHZXRzL3NldHMgdGhlIGBsb29rdXBgIGZ1bmN0aW9uIHRvIHVzZSBjdXN0b20gRE5TIHJlc29sdmVyLlxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGxvb2t1cFxuICogQHJldHVybiB7RnVuY3Rpb259XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3QucHJvdG90eXBlLmxvb2t1cCA9IGZ1bmN0aW9uIChsb29rdXApIHtcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApIHJldHVybiB0aGlzLl9sb29rdXA7XG4gIHRoaXMuX2xvb2t1cCA9IGxvb2t1cDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIFNldCBfQ29udGVudC1UeXBlXyByZXNwb25zZSBoZWFkZXIgcGFzc2VkIHRocm91Z2ggYG1pbWUuZ2V0VHlwZSgpYC5cbiAqXG4gKiBFeGFtcGxlczpcbiAqXG4gKiAgICAgIHJlcXVlc3QucG9zdCgnLycpXG4gKiAgICAgICAgLnR5cGUoJ3htbCcpXG4gKiAgICAgICAgLnNlbmQoeG1sc3RyaW5nKVxuICogICAgICAgIC5lbmQoY2FsbGJhY2spO1xuICpcbiAqICAgICAgcmVxdWVzdC5wb3N0KCcvJylcbiAqICAgICAgICAudHlwZSgnanNvbicpXG4gKiAgICAgICAgLnNlbmQoanNvbnN0cmluZylcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcbiAqXG4gKiAgICAgIHJlcXVlc3QucG9zdCgnLycpXG4gKiAgICAgICAgLnR5cGUoJ2FwcGxpY2F0aW9uL2pzb24nKVxuICogICAgICAgIC5zZW5kKGpzb25zdHJpbmcpXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHR5cGVcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS50eXBlID0gZnVuY3Rpb24gKHR5cGUpIHtcbiAgcmV0dXJuIHRoaXMuc2V0KFxuICAgICdDb250ZW50LVR5cGUnLFxuICAgIHR5cGUuaW5jbHVkZXMoJy8nKSA/IHR5cGUgOiBtaW1lLmdldFR5cGUodHlwZSlcbiAgKTtcbn07XG5cbi8qKlxuICogU2V0IF9BY2NlcHRfIHJlc3BvbnNlIGhlYWRlciBwYXNzZWQgdGhyb3VnaCBgbWltZS5nZXRUeXBlKClgLlxuICpcbiAqIEV4YW1wbGVzOlxuICpcbiAqICAgICAgc3VwZXJhZ2VudC50eXBlcy5qc29uID0gJ2FwcGxpY2F0aW9uL2pzb24nO1xuICpcbiAqICAgICAgcmVxdWVzdC5nZXQoJy9hZ2VudCcpXG4gKiAgICAgICAgLmFjY2VwdCgnanNvbicpXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XG4gKlxuICogICAgICByZXF1ZXN0LmdldCgnL2FnZW50JylcbiAqICAgICAgICAuYWNjZXB0KCdhcHBsaWNhdGlvbi9qc29uJylcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gYWNjZXB0XG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUuYWNjZXB0ID0gZnVuY3Rpb24gKHR5cGUpIHtcbiAgcmV0dXJuIHRoaXMuc2V0KCdBY2NlcHQnLCB0eXBlLmluY2x1ZGVzKCcvJykgPyB0eXBlIDogbWltZS5nZXRUeXBlKHR5cGUpKTtcbn07XG5cbi8qKlxuICogQWRkIHF1ZXJ5LXN0cmluZyBgdmFsYC5cbiAqXG4gKiBFeGFtcGxlczpcbiAqXG4gKiAgIHJlcXVlc3QuZ2V0KCcvc2hvZXMnKVxuICogICAgIC5xdWVyeSgnc2l6ZT0xMCcpXG4gKiAgICAgLnF1ZXJ5KHsgY29sb3I6ICdibHVlJyB9KVxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fFN0cmluZ30gdmFsXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUucXVlcnkgPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICB0aGlzLl9xdWVyeS5wdXNoKHZhbHVlKTtcbiAgfSBlbHNlIHtcbiAgICBPYmplY3QuYXNzaWduKHRoaXMucXMsIHZhbHVlKTtcbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBXcml0ZSByYXcgYGRhdGFgIC8gYGVuY29kaW5nYCB0byB0aGUgc29ja2V0LlxuICpcbiAqIEBwYXJhbSB7QnVmZmVyfFN0cmluZ30gZGF0YVxuICogQHBhcmFtIHtTdHJpbmd9IGVuY29kaW5nXG4gKiBAcmV0dXJuIHtCb29sZWFufVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS53cml0ZSA9IGZ1bmN0aW9uIChkYXRhLCBlbmNvZGluZykge1xuICBjb25zdCByZXF1ZXN0XyA9IHRoaXMucmVxdWVzdCgpO1xuXG4gIGlmICh0aGlzLl9hYm9ydGVkIHx8IHRoaXMuaGFzU2l6ZUVycm9yKCkpIHJldHVybiBmYWxzZTtcblxuICBpZiAoIXRoaXMuX3N0cmVhbVJlcXVlc3QpIHtcbiAgICB0aGlzLl9zdHJlYW1SZXF1ZXN0ID0gdHJ1ZTtcbiAgfVxuXG4gIGNvbnN0IGxlbmd0aCA9IEJ1ZmZlci5pc0J1ZmZlcihkYXRhKVxuICAgID8gZGF0YS5sZW5ndGhcbiAgICA6IHR5cGVvZiBkYXRhID09PSAnc3RyaW5nJ1xuICAgICAgPyBCdWZmZXIuYnl0ZUxlbmd0aChkYXRhLCBlbmNvZGluZylcbiAgICAgIDogQXJyYXlCdWZmZXIuaXNWaWV3KGRhdGEpXG4gICAgICAgID8gZGF0YS5ieXRlTGVuZ3RoXG4gICAgICAgIDogZGF0YSBpbnN0YW5jZW9mIEFycmF5QnVmZmVyXG4gICAgICAgICAgPyBkYXRhLmJ5dGVMZW5ndGhcbiAgICAgICAgICA6IDA7XG5cbiAgdGhpcy5fcmVxdWVzdEJ5dGVzU2VudCA9ICh0aGlzLl9yZXF1ZXN0Qnl0ZXNTZW50IHx8IDApICsgbGVuZ3RoO1xuICBpZiAoIXRoaXMuX2NoZWNrUmVxdWVzdFNpemUodGhpcy5fcmVxdWVzdEJ5dGVzU2VudCkpIHtcbiAgICBpZiAodGhpcy5fc291cmNlU3RyZWFtKSB7XG4gICAgICB0aGlzLl9zb3VyY2VTdHJlYW0udW5waXBlKHRoaXMpO1xuICAgICAgaWYgKHR5cGVvZiB0aGlzLl9zb3VyY2VTdHJlYW0uZGVzdHJveSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICB0aGlzLl9zb3VyY2VTdHJlYW0uZGVzdHJveSgpO1xuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgdGhpcy5fc291cmNlU3RyZWFtLnJlc3VtZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICB0aGlzLl9zb3VyY2VTdHJlYW0ucmVzdW1lKCk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHJldHVybiByZXF1ZXN0Xy53cml0ZShkYXRhLCBlbmNvZGluZyk7XG59O1xuXG4vKipcbiAqIFBpcGUgdGhlIHJlcXVlc3QgYm9keSB0byBgc3RyZWFtYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmVhbX0gc3RyZWFtXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9uc1xuICogQHJldHVybiB7U3RyZWFtfVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5waXBlID0gZnVuY3Rpb24gKHN0cmVhbSwgb3B0aW9ucykge1xuICB0aGlzLnBpcGVkID0gdHJ1ZTtcbiAgdGhpcy5fcGlwZURlc3RpbmF0aW9uID0gc3RyZWFtO1xuICB0aGlzLmJ1ZmZlcihmYWxzZSk7XG4gIHRoaXMuZW5kKCk7XG4gIHJldHVybiB0aGlzLl9waXBlQ29udGludWUoc3RyZWFtLCBvcHRpb25zKTtcbn07XG5cblJlcXVlc3QucHJvdG90eXBlLl9waXBlQ29udGludWUgPSBmdW5jdGlvbiAoc3RyZWFtLCBvcHRpb25zKSB7XG4gIHRoaXMuX3BpcGVEZXN0aW5hdGlvbiA9IHN0cmVhbTtcbiAgY29uc3QgYXR0YWNoID0gKCkgPT4ge1xuICAgIGlmICghdGhpcy5yZXEpIHJldHVybjtcbiAgICB0aGlzLnJlcS5vbmNlKCdyZXNwb25zZScsIChyZXMpID0+IHtcbiAgICAgIC8vIEF2b2lkIFwiZG91YmxlIGNhbGxiYWNrIGJ1Z1wiXG4gICAgICBpZiAodGhpcy5oYXNTaXplRXJyb3IoKSkgcmV0dXJuO1xuXG4gICAgICAvLyByZWRpcmVjdFxuICAgICAgaWYgKFxuICAgICAgICBpc1JlZGlyZWN0KHJlcy5zdGF0dXNDb2RlKSAmJlxuICAgICAgICB0aGlzLl9yZWRpcmVjdHMrKyAhPT0gdGhpcy5fbWF4UmVkaXJlY3RzXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX3JlZGlyZWN0KHJlcywgKCkgPT4ge1xuICAgICAgICAgIHRoaXMuX3BpcGVDb250aW51ZShzdHJlYW0sIG9wdGlvbnMpO1xuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5yZXMgPSByZXM7XG4gICAgICB0aGlzLl9lbWl0UmVzcG9uc2UoKTtcbiAgICAgIGlmICh0aGlzLl9hYm9ydGVkKSByZXR1cm47XG5cbiAgICAgIC8vIEJvZHlsZXNzLWF3YXJlLCBjb21wcmVzc2lvbi1hd2FyZSBDb250ZW50LUxlbmd0aCBwcmVjaGVjayBmb3IgcGlwZWQgZmluYWwgcmVzcG9uc2VzLlxuICAgICAgLy8gSW1tZWRpYXRlbHkgYWJvcnRzIHVuYnVmZmVyZWQgc3RyZWFtcyBleGNlZWRpbmcgbWF4UmVzcG9uc2VTaXplIGJlZm9yZSBib2R5IGRhdGEgYXJyaXZlcy5cbiAgICAgIGlmIChcbiAgICAgICAgdGhpcy5fbWF4UmVzcG9uc2VTaXplICE9PSB1bmRlZmluZWQgJiZcbiAgICAgICAgdGhpcy5tZXRob2QudG9VcHBlckNhc2UoKSAhPT0gJ0hFQUQnICYmXG4gICAgICAgIGhhc05vbkVtcHR5UmVzcG9uc2VDb250ZW50KHJlcykgJiZcbiAgICAgICAgIXRoaXMuX3Nob3VsZERlY29tcHJlc3MocmVzKVxuICAgICAgKSB7XG4gICAgICAgIGNvbnN0IGNsSGVhZGVyID0gcmVzLmhlYWRlcnNbJ2NvbnRlbnQtbGVuZ3RoJ107XG4gICAgICAgIGlmIChjbEhlYWRlcikge1xuICAgICAgICAgIGNvbnN0IGNsID0gcGFyc2VJbnQoY2xIZWFkZXIsIDEwKTtcbiAgICAgICAgICBpZiAoIWlzTmFOKGNsKSAmJiBjbCA+IHRoaXMuX21heFJlc3BvbnNlU2l6ZSkge1xuICAgICAgICAgICAgY29uc3QgZXJyb3IgPSB0aGlzLl9hYm9ydFdpdGhTaXplRXJyb3IoJ3Jlc3BvbnNlJyk7XG4gICAgICAgICAgICBpZiAodHlwZW9mIHJlcy5kZXN0cm95ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICAgIHJlcy5kZXN0cm95KGVycm9yKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gUm91dGUgYWxsIHBpcGVkIHJlc3BvbnNlIGJ5dGVzIHRocm91Z2ggdGhlIHNpemUgbW9uaXRvci5cbiAgICAgIC8vIFRoaXMgZW5mb3JjZXMgbWF4UmVzcG9uc2VTaXplIGZvciB0aGUgLnBpcGUoKSB1c2UgY2FzZS5cbiAgICAgIGNvbnN0IG1vbml0b3IgPSB0aGlzLl9nZXRSZXNwb25zZU1vbml0b3IoKTtcbiAgICAgIG1vbml0b3Iub24oJ2Vycm9yJywgKGVycm9yKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLnJlcykge1xuICAgICAgICAgIHRoaXMucmVzLnVucGlwZSgpO1xuICAgICAgICAgIGlmICh0eXBlb2YgdGhpcy5yZXMuZGVzdHJveSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgdGhpcy5yZXMuZGVzdHJveShlcnJvcik7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgaWYgKHRoaXMuX3Nob3VsZERlY29tcHJlc3MocmVzKSkge1xuICAgICAgICBsZXQgZGVjb21wcmVzc2VyID0gY2hvb3NlRGVjb21wcmVzc2VyKHJlcyk7XG5cbiAgICAgICAgZGVjb21wcmVzc2VyLm9uKCdlcnJvcicsIChlcnJvcikgPT4ge1xuICAgICAgICAgIGlmIChlcnJvciAmJiBlcnJvci5jb2RlID09PSAnWl9CVUZfRVJST1InKSB7XG4gICAgICAgICAgICAvLyB1bmV4cGVjdGVkIGVuZCBvZiBmaWxlIGlzIGlnbm9yZWQgYnkgYnJvd3NlcnMgYW5kIGN1cmxcbiAgICAgICAgICAgIHN0cmVhbS5lbWl0KCdlbmQnKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoc3RyZWFtKSB7XG4gICAgICAgICAgICBpZiAoc3RyZWFtLmxpc3RlbmVycygnZXJyb3InKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgIHN0cmVhbS5lbWl0KCdlcnJvcicsIGVycm9yKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHN0cmVhbS5kZXN0cm95ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICAgIHN0cmVhbS5kZXN0cm95KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmVzLnBpcGUoZGVjb21wcmVzc2VyKS5waXBlKG1vbml0b3IpLnBpcGUoc3RyZWFtLCBvcHRpb25zKTtcbiAgICAgICAgLy8gZG9uJ3QgZW1pdCAnZW5kJyB1bnRpbCBtb25pdG9yIGhhcyBjb21wbGV0ZWQgd3JpdGluZyBhbGwgaXRzIGRhdGEuXG4gICAgICAgIG1vbml0b3Iub25jZSgnZW5kJywgKCkgPT4ge1xuICAgICAgICAgIHRoaXMuX2NsZWFudXBTcG9vbEZpbGUoKTtcbiAgICAgICAgICB0aGlzLmVtaXQoJ2VuZCcpO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlcy5waXBlKG1vbml0b3IpLnBpcGUoc3RyZWFtLCBvcHRpb25zKTtcbiAgICAgICAgbW9uaXRvci5vbmNlKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5fY2xlYW51cFNwb29sRmlsZSgpO1xuICAgICAgICAgIHRoaXMuZW1pdCgnZW5kJyk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICByZXMub25jZSgnY2xvc2UnLCAoKSA9PiB0aGlzLl9jbGVhbnVwU3Bvb2xGaWxlKCkpO1xuICAgICAgcmVzLm9uY2UoJ2Vycm9yJywgKCkgPT4gdGhpcy5fY2xlYW51cFNwb29sRmlsZSgpKTtcbiAgICAgIHRoaXMub25jZSgnY2xvc2UnLCAoKSA9PiB0aGlzLl9jbGVhbnVwU3Bvb2xGaWxlKCkpO1xuICAgICAgdGhpcy5vbmNlKCdhYm9ydCcsICgpID0+IHRoaXMuX2NsZWFudXBTcG9vbEZpbGUoKSk7XG5cbiAgICAgIGlmIChzdHJlYW0pIHtcbiAgICAgICAgc3RyZWFtLm9uY2UoJ2ZpbmlzaCcsICgpID0+IHRoaXMuX2NsZWFudXBTcG9vbEZpbGUoKSk7XG4gICAgICAgIHN0cmVhbS5vbmNlKCdjbG9zZScsICgpID0+IHRoaXMuX2NsZWFudXBTcG9vbEZpbGUoKSk7XG4gICAgICAgIHN0cmVhbS5vbmNlKCdlcnJvcicsICgpID0+IHRoaXMuX2NsZWFudXBTcG9vbEZpbGUoKSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH07XG5cbiAgaWYgKHRoaXMucmVxKSB7XG4gICAgYXR0YWNoKCk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5vbmNlKCdyZXF1ZXN0JywgYXR0YWNoKTtcbiAgfVxuXG4gIHJldHVybiBzdHJlYW07XG59O1xuXG4vKipcbiAqIEVuYWJsZSAvIGRpc2FibGUgYnVmZmVyaW5nLlxuICpcbiAqIEByZXR1cm4ge0Jvb2xlYW59IFt2YWxdXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUuYnVmZmVyID0gZnVuY3Rpb24gKHZhbHVlKSB7XG4gIHRoaXMuX2J1ZmZlciA9IHZhbHVlICE9PSBmYWxzZTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIFJlZGlyZWN0IHRvIGB1cmxcbiAqXG4gKiBAcGFyYW0ge0luY29taW5nTWVzc2FnZX0gcmVzXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblJlcXVlc3QucHJvdG90eXBlLl9yZWRpcmVjdCA9IGZ1bmN0aW9uIChyZXMsIGNvbnRpbnVhdGlvbikge1xuICBsZXQgdXJsID0gcmVzLmhlYWRlcnMubG9jYXRpb247XG4gIGlmICghdXJsKSB7XG4gICAgcmV0dXJuIHRoaXMuY2FsbGJhY2sobmV3IEVycm9yKCdObyBsb2NhdGlvbiBoZWFkZXIgZm9yIHJlZGlyZWN0JyksIHJlcyk7XG4gIH1cblxuICBkZWJ1ZygncmVkaXJlY3QgJXMgLT4gJXMnLCB0aGlzLnVybCwgdXJsKTtcblxuICAvLyBsb2NhdGlvblxuICB1cmwgPSBuZXcgVVJMKHVybCwgdGhpcy51cmwpLmhyZWY7XG5cbiAgY29uc3QgY2hhbmdlc09yaWdpbiA9IG5ldyBVUkwodXJsKS5vcmlnaW4gIT09IG5ldyBVUkwodGhpcy51cmwpLm9yaWdpbjtcblxuICB0aGlzLl9zdHJpcENvb2tpZXNGb3JDcm9zc09yaWdpbiA9IGNoYW5nZXNPcmlnaW47XG4gIGlmIChjaGFuZ2VzT3JpZ2luKSB7XG4gICAgZGVsZXRlIHRoaXMudXNlcm5hbWU7XG4gICAgZGVsZXRlIHRoaXMucGFzc3dvcmQ7XG4gICAgZGVsZXRlIHRoaXMuY29va2llcztcbiAgfVxuXG4gIC8vIE9ubHkgY2xlYXIgcmVxdWVzdCBib2R5IGFuZCBzcG9vbGVkIG11bHRpcGFydCBkYXRhIHdoZW4gcmVkaXJlY3Qgc3RhdHVzIGNvbnZlcnRzXG4gIC8vIHRoZSBtZXRob2QgdG8gR0VUL0hFQUQgKDMwMSwgMzAyLCAzMDMpLiAzMDUsIDMwNywgYW5kIDMwOCBwcmVzZXJ2ZSBtZXRob2QgYW5kIGJvZHksXG4gIC8vIGluY2x1ZGluZyBhY3Jvc3MgY3Jvc3Mtb3JpZ2luIHJlZGlyZWN0cy5cbiAgaWYgKHJlcy5zdGF0dXNDb2RlID09PSAzMDEgfHwgcmVzLnN0YXR1c0NvZGUgPT09IDMwMiB8fCByZXMuc3RhdHVzQ29kZSA9PT0gMzAzKSB7XG4gICAgdGhpcy5fY2xlYW51cFNwb29sRmlsZSgpO1xuICAgIHRoaXMuX2Zvcm1EYXRhVG1wTGVuZ3RoID0gbnVsbDtcbiAgICBkZWxldGUgdGhpcy5fZm9ybURhdGFIZWFkZXJzO1xuICAgIHRoaXMuX2RhdGEgPSBudWxsO1xuICAgIGRlbGV0ZSB0aGlzLl9mb3JtRGF0YTtcbiAgfVxuXG4gIGNvbnN0IHByb2NlZWQgPSAoKSA9PiB7XG4gICAgaWYgKHRoaXMuX2Fib3J0ZWQgfHwgdGhpcy5oYXNTaXplRXJyb3IoKSkgcmV0dXJuO1xuXG4gICAgbGV0IGhlYWRlcnMgPSB0aGlzLnJlcS5nZXRIZWFkZXJzID8gdGhpcy5yZXEuZ2V0SGVhZGVycygpIDogdGhpcy5yZXEuX2hlYWRlcnM7XG5cbiAgICAvLyBpbXBsZW1lbnRhdGlvbiBvZiAzMDIgZm9sbG93aW5nIGRlZmFjdG8gc3RhbmRhcmRcbiAgICBpZiAocmVzLnN0YXR1c0NvZGUgPT09IDMwMSB8fCByZXMuc3RhdHVzQ29kZSA9PT0gMzAyKSB7XG4gICAgICAvLyBzdHJpcCBDb250ZW50LSogcmVsYXRlZCBmaWVsZHNcbiAgICAgIC8vIGluIGNhc2Ugb2YgUE9TVCBldGNcbiAgICAgIGhlYWRlcnMgPSB1dGlscy5jbGVhbkhlYWRlcihoZWFkZXJzLCBjaGFuZ2VzT3JpZ2luKTtcblxuICAgICAgLy8gZm9yY2UgR0VUXG4gICAgICB0aGlzLm1ldGhvZCA9IHRoaXMubWV0aG9kID09PSAnSEVBRCcgPyAnSEVBRCcgOiAnR0VUJztcblxuICAgICAgLy8gY2xlYXIgZGF0YVxuICAgICAgdGhpcy5fZGF0YSA9IG51bGw7XG4gICAgICBkZWxldGUgdGhpcy5fZm9ybURhdGFTZXJpYWxpemVkO1xuICAgICAgZGVsZXRlIHRoaXMuX2Zvcm1EYXRhSGVhZGVycztcbiAgICAgIC8vIENsZWFyIHNwb29sIGRhdGEgc28gdGhlIG9yaWdpbmFsIGJvZHkgaXMgbm90IHNlbnQgdG8gcmVkaXJlY3QgdGFyZ2V0XG4gICAgICB0aGlzLl9jbGVhbnVwU3Bvb2xGaWxlKCk7XG4gICAgICB0aGlzLl9mb3JtRGF0YVRtcExlbmd0aCA9IG51bGw7XG4gICAgICBkZWxldGUgdGhpcy5fZm9ybURhdGE7XG4gICAgfVxuXG4gICAgLy8gMzAzIGlzIGFsd2F5cyBHRVRcbiAgICBpZiAocmVzLnN0YXR1c0NvZGUgPT09IDMwMykge1xuICAgICAgLy8gc3RyaXAgQ29udGVudC0qIHJlbGF0ZWQgZmllbGRzXG4gICAgICAvLyBpbiBjYXNlIG9mIFBPU1QgZXRjXG4gICAgICBoZWFkZXJzID0gdXRpbHMuY2xlYW5IZWFkZXIoaGVhZGVycywgY2hhbmdlc09yaWdpbik7XG5cbiAgICAgIC8vIGZvcmNlIG1ldGhvZFxuICAgICAgdGhpcy5tZXRob2QgPSAnR0VUJztcblxuICAgICAgLy8gY2xlYXIgZGF0YVxuICAgICAgdGhpcy5fZGF0YSA9IG51bGw7XG4gICAgICBkZWxldGUgdGhpcy5fZm9ybURhdGFTZXJpYWxpemVkO1xuICAgICAgZGVsZXRlIHRoaXMuX2Zvcm1EYXRhSGVhZGVycztcbiAgICAgIC8vIENsZWFyIHNwb29sIGRhdGEgc28gdGhlIG9yaWdpbmFsIGJvZHkgaXMgbm90IHNlbnQgdG8gcmVkaXJlY3QgdGFyZ2V0XG4gICAgICB0aGlzLl9jbGVhbnVwU3Bvb2xGaWxlKCk7XG4gICAgICB0aGlzLl9mb3JtRGF0YVRtcExlbmd0aCA9IG51bGw7XG4gICAgICBkZWxldGUgdGhpcy5fZm9ybURhdGE7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMubWV0aG9kID09PSAnR0VUJyB8fCB0aGlzLm1ldGhvZCA9PT0gJ0hFQUQnKSB7XG4gICAgICBoZWFkZXJzID0gdXRpbHMuY2xlYW5IZWFkZXIoaGVhZGVycywgY2hhbmdlc09yaWdpbik7XG4gICAgICB0aGlzLl9kYXRhID0gbnVsbDtcbiAgICAgIGRlbGV0ZSB0aGlzLl9mb3JtRGF0YVNlcmlhbGl6ZWQ7XG4gICAgICBkZWxldGUgdGhpcy5fZm9ybURhdGFIZWFkZXJzO1xuICAgICAgdGhpcy5fY2xlYW51cFNwb29sRmlsZSgpO1xuICAgICAgdGhpcy5fZm9ybURhdGFUbXBMZW5ndGggPSBudWxsO1xuICAgICAgZGVsZXRlIHRoaXMuX2Zvcm1EYXRhO1xuICAgIH0gZWxzZSBpZiAoY2hhbmdlc09yaWdpbikge1xuICAgICAgLy8gMzA3LzMwOCBwcmVzZXJ2ZXMgbWV0aG9kOiBvbmx5IHN0cmlwIHNlbnNpdGl2ZSBhdXRob3JpemF0aW9uL2Nvb2tpZSBoZWFkZXJzIGFjcm9zcyBvcmlnaW5zXG4gICAgICBkZWxldGUgaGVhZGVycy5hdXRob3JpemF0aW9uO1xuICAgICAgZGVsZXRlIGhlYWRlcnMuY29va2llO1xuICAgIH1cblxuICAgIGlmIChjaGFuZ2VzT3JpZ2luKSB7XG4gICAgICBkZWxldGUgdGhpcy51c2VybmFtZTtcbiAgICAgIGRlbGV0ZSB0aGlzLnBhc3N3b3JkO1xuICAgICAgaWYgKGhlYWRlcnMpIHtcbiAgICAgICAgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKGhlYWRlcnMpKSB7XG4gICAgICAgICAgY29uc3QgbGsgPSBrLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgaWYgKGxrID09PSAnYXV0aG9yaXphdGlvbicgfHwgbGsgPT09ICdjb29raWUnKSB7XG4gICAgICAgICAgICBkZWxldGUgaGVhZGVyc1trXTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLmhlYWRlcikge1xuICAgICAgICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXModGhpcy5oZWFkZXIpKSB7XG4gICAgICAgICAgY29uc3QgbGsgPSBrLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgaWYgKGxrID09PSAnYXV0aG9yaXphdGlvbicgfHwgbGsgPT09ICdjb29raWUnKSB7XG4gICAgICAgICAgICBkZWxldGUgdGhpcy5oZWFkZXJba107XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5faGVhZGVyKSB7XG4gICAgICAgIGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyh0aGlzLl9oZWFkZXIpKSB7XG4gICAgICAgICAgY29uc3QgbGsgPSBrLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgaWYgKGxrID09PSAnYXV0aG9yaXphdGlvbicgfHwgbGsgPT09ICdjb29raWUnKSB7XG4gICAgICAgICAgICBkZWxldGUgdGhpcy5faGVhZGVyW2tdO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIDMwNyBwcmVzZXJ2ZXMgbWV0aG9kXG4gICAgLy8gMzA4IHByZXNlcnZlcyBtZXRob2RcbiAgICBkZWxldGUgaGVhZGVycy5ob3N0O1xuXG4gICAgLy8gRGV0YWNoIGFuZCBkZXN0cm95IG9sZCB1cGxvYWQgcGlwZWxpbmUgYmVmb3JlIHN0YXJ0aW5nIHRoZSByZWRpcmVjdCBhdHRlbXB0XG4gICAgdGhpcy5fZGV0YWNoU3Bvb2xVcGxvYWRTdHJlYW0oKTtcblxuICAgIGRlbGV0ZSB0aGlzLnJlcTtcbiAgICBpZiAodGhpcy5tZXRob2QgPT09ICdHRVQnIHx8IHRoaXMubWV0aG9kID09PSAnSEVBRCcpIHtcbiAgICAgIGRlbGV0ZSB0aGlzLl9mb3JtRGF0YTtcbiAgICB9XG5cbiAgICAvLyByZW1vdmUgYWxsIGFkZCBoZWFkZXIgZXhjZXB0IFVzZXItQWdlbnRcbiAgICBfaW5pdEhlYWRlcnModGhpcyk7XG5cbiAgICAvLyByZWRpcmVjdFxuICAgIHRoaXMucmVzID0gcmVzO1xuICAgIHRoaXMuX2VuZENhbGxlZCA9IGZhbHNlO1xuICAgIHRoaXMudXJsID0gdXJsO1xuICAgIHRoaXMucXMgPSB7fTtcbiAgICB0aGlzLl9xdWVyeS5sZW5ndGggPSAwO1xuICAgIHRoaXMuc2V0KGhlYWRlcnMpO1xuICAgIHRoaXMuX2VtaXRSZWRpcmVjdCgpO1xuICAgIGlmIChjaGFuZ2VzT3JpZ2luKSB7XG4gICAgICBkZWxldGUgdGhpcy5jb29raWVzO1xuICAgICAgdGhpcy5fc3RyaXBDb29raWVzRm9yQ3Jvc3NPcmlnaW4gPSB0cnVlO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9zdHJpcENvb2tpZXNGb3JDcm9zc09yaWdpbiA9IGZhbHNlO1xuICAgIH1cbiAgICB0aGlzLl9yZWRpcmVjdExpc3QucHVzaCh0aGlzLnVybCk7XG4gICAgdGhpcy5fcmVxdWVzdEJ5dGVzU2VudCA9IDA7IC8vIHJlc2V0IGZvciB0aGUgbmV3IHJlcXVlc3RcbiAgICB0aGlzLmVuZCh0aGlzLl9jYWxsYmFjayk7XG4gICAgaWYgKHR5cGVvZiBjb250aW51YXRpb24gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNvbnRpbnVhdGlvbigpO1xuICAgIH1cbiAgfTtcblxuICAvLyBjaGVjayByZWRpcmVjdCByZXNwb25zZSBzaXplXG4gIC8vIEhFQUQgcmVkaXJlY3RzIGNhcnJ5IG5vIGJvZHksIGV2ZW4gd2hlbiBDb250ZW50LUxlbmd0aCBpcyBwcmVzZW50LlxuICAvLyBTa2lwIGFsbCBib2R5LXNpemUgY2hlY2tpbmcgZm9yIEhFQUQgdG8gYXZvaWQgZmFsc2UgRVRPT0xBUkdFLlxuICBpZiAodGhpcy5fbWF4UmVzcG9uc2VTaXplICE9PSB1bmRlZmluZWQgJiYgdGhpcy5tZXRob2QudG9VcHBlckNhc2UoKSAhPT0gJ0hFQUQnKSB7XG4gICAgbGV0IHJlZGlyZWN0Qnl0ZXMgPSAwO1xuICAgIGxldCByZWRpcmVjdFN0cmVhbSA9IHJlcztcbiAgICBpZiAodGhpcy5fc2hvdWxkRGVjb21wcmVzcyhyZXMpKSB7XG4gICAgICBjb25zdCBkZWNvbXByZXNzZXIgPSBjaG9vc2VEZWNvbXByZXNzZXIocmVzKTtcbiAgICAgIGRlY29tcHJlc3Nlci5vbignZXJyb3InLCAoKSA9PiB7XG4gICAgICAgIC8vIGRlY29tcHJlc3Npb24gZXJyb3JzIG9uIHJlZGlyZWN0IGJvZHkgY2hlY2tpbmcgYXJlIG5vbi1mYXRhbFxuICAgICAgfSk7XG4gICAgICByZXMucGlwZShkZWNvbXByZXNzZXIpO1xuICAgICAgcmVkaXJlY3RTdHJlYW0gPSBkZWNvbXByZXNzZXI7XG4gICAgfSBlbHNlIGlmIChoYXNOb25FbXB0eVJlc3BvbnNlQ29udGVudChyZXMpKSB7XG4gICAgICAvLyBPbmx5IHByZWNoZWNrIENvbnRlbnQtTGVuZ3RoIHdoZW4gTk9UIGNvbXByZXNzaW5nIGFuZCByZXNwb25zZSBoYXMgYm9keSBjb250ZW50XG4gICAgICBjb25zdCByZWRpcmVjdENsID0gcGFyc2VJbnQocmVzLmhlYWRlcnMgJiYgcmVzLmhlYWRlcnNbJ2NvbnRlbnQtbGVuZ3RoJ10sIDEwKTtcbiAgICAgIGlmICghaXNOYU4ocmVkaXJlY3RDbCkgJiYgcmVkaXJlY3RDbCA+IHRoaXMuX21heFJlc3BvbnNlU2l6ZSkge1xuICAgICAgICByZXMuZGVzdHJveSgpO1xuICAgICAgICBjb25zdCBlcnIgPSB0aGlzLl9hYm9ydFdpdGhTaXplRXJyb3IoJ3Jlc3BvbnNlJyk7XG4gICAgICAgIGlmIChyZXMuc3RhdHVzQ29kZSkgZXJyLnN0YXR1cyA9IHJlcy5zdGF0dXNDb2RlO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgcHJvY2VlZGVkID0gZmFsc2U7XG4gICAgY29uc3Qgb25Qcm9jZWVkID0gKCkgPT4ge1xuICAgICAgaWYgKHByb2NlZWRlZCkgcmV0dXJuO1xuICAgICAgcHJvY2VlZGVkID0gdHJ1ZTtcbiAgICAgIHByb2NlZWQoKTtcbiAgICB9O1xuXG4gICAgcmVkaXJlY3RTdHJlYW0ub24oJ2RhdGEnLCAoY2h1bmspID0+IHtcbiAgICAgIGlmICh0aGlzLmhhc1NpemVFcnJvcigpKSByZXR1cm47XG4gICAgICByZWRpcmVjdEJ5dGVzICs9IGNodW5rLmxlbmd0aDtcbiAgICAgIGlmIChyZWRpcmVjdEJ5dGVzID4gdGhpcy5fbWF4UmVzcG9uc2VTaXplKSB7XG4gICAgICAgIHJlcy5kZXN0cm95KCk7XG4gICAgICAgIGlmIChyZWRpcmVjdFN0cmVhbSAhPT0gcmVzICYmIHR5cGVvZiByZWRpcmVjdFN0cmVhbS5kZXN0cm95ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgcmVkaXJlY3RTdHJlYW0uZGVzdHJveSgpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGVyciA9IHRoaXMuX2Fib3J0V2l0aFNpemVFcnJvcigncmVzcG9uc2UnKTtcbiAgICAgICAgaWYgKHJlcy5zdGF0dXNDb2RlKSBlcnIuc3RhdHVzID0gcmVzLnN0YXR1c0NvZGU7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZWRpcmVjdFN0cmVhbS5vbmNlKCdlbmQnLCAoKSA9PiB7XG4gICAgICBvblByb2NlZWQoKTtcbiAgICB9KTtcblxuICAgIHJlZGlyZWN0U3RyZWFtLm9uY2UoJ2Vycm9yJywgKCkgPT4ge1xuICAgICAgb25Qcm9jZWVkKCk7XG4gICAgfSk7XG5cbiAgICByZXMucmVzdW1lKCk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvLyBlbnN1cmUgdGhlIHJlc3BvbnNlIGlzIGJlaW5nIGNvbnN1bWVkXG4gIC8vIHRoaXMgaXMgcmVxdWlyZWQgZm9yIE5vZGUgdjAuMTArXG4gIHJlcy5yZXN1bWUoKTtcbiAgcHJvY2VlZCgpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogU2V0IEF1dGhvcml6YXRpb24gZmllbGQgdmFsdWUgd2l0aCBgdXNlcmAgYW5kIGBwYXNzYC5cbiAqXG4gKiBFeGFtcGxlczpcbiAqXG4gKiAgIC5hdXRoKCd0b2JpJywgJ2xlYXJuYm9vc3QnKVxuICogICAuYXV0aCgndG9iaTpsZWFybmJvb3N0JylcbiAqICAgLmF1dGgoJ3RvYmknKVxuICogICAuYXV0aChhY2Nlc3NUb2tlbiwgeyB0eXBlOiAnYmVhcmVyJyB9KVxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSB1c2VyXG4gKiBAcGFyYW0ge1N0cmluZ30gW3Bhc3NdXG4gKiBAcGFyYW0ge09iamVjdH0gW29wdGlvbnNdIG9wdGlvbnMgd2l0aCBhdXRob3JpemF0aW9uIHR5cGUgJ2Jhc2ljJyBvciAnYmVhcmVyJyAoJ2Jhc2ljJyBpcyBkZWZhdWx0KVxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3QucHJvdG90eXBlLmF1dGggPSBmdW5jdGlvbiAodXNlciwgcGFzcywgb3B0aW9ucykge1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSkgcGFzcyA9ICcnO1xuICBpZiAodHlwZW9mIHBhc3MgPT09ICdvYmplY3QnICYmIHBhc3MgIT09IG51bGwpIHtcbiAgICAvLyBwYXNzIGlzIG9wdGlvbmFsIGFuZCBjYW4gYmUgcmVwbGFjZWQgd2l0aCBvcHRpb25zXG4gICAgb3B0aW9ucyA9IHBhc3M7XG4gICAgcGFzcyA9ICcnO1xuICB9XG5cbiAgaWYgKCFvcHRpb25zKSB7XG4gICAgb3B0aW9ucyA9IHsgdHlwZTogJ2Jhc2ljJyB9O1xuICB9XG5cbiAgY29uc3QgZW5jb2RlciA9IChzdHJpbmcpID0+IEJ1ZmZlci5mcm9tKHN0cmluZykudG9TdHJpbmcoJ2Jhc2U2NCcpO1xuXG4gIHJldHVybiB0aGlzLl9hdXRoKHVzZXIsIHBhc3MsIG9wdGlvbnMsIGVuY29kZXIpO1xufTtcblxuLyoqXG4gKiBTZXQgdGhlIGNlcnRpZmljYXRlIGF1dGhvcml0eSBvcHRpb24gZm9yIGh0dHBzIHJlcXVlc3QuXG4gKlxuICogQHBhcmFtIHtCdWZmZXIgfCBBcnJheX0gY2VydFxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3QucHJvdG90eXBlLmNhID0gZnVuY3Rpb24gKGNlcnQpIHtcbiAgdGhpcy5fY2EgPSBjZXJ0O1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogU2V0IHRoZSBjbGllbnQgY2VydGlmaWNhdGUga2V5IG9wdGlvbiBmb3IgaHR0cHMgcmVxdWVzdC5cbiAqXG4gKiBAcGFyYW0ge0J1ZmZlciB8IFN0cmluZ30gY2VydFxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3QucHJvdG90eXBlLmtleSA9IGZ1bmN0aW9uIChjZXJ0KSB7XG4gIHRoaXMuX2tleSA9IGNlcnQ7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBTZXQgdGhlIGtleSwgY2VydGlmaWNhdGUsIGFuZCBDQSBjZXJ0cyBvZiB0aGUgY2xpZW50IGluIFBGWCBvciBQS0NTMTIgZm9ybWF0LlxuICpcbiAqIEBwYXJhbSB7QnVmZmVyIHwgU3RyaW5nfSBjZXJ0XG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUucGZ4ID0gZnVuY3Rpb24gKGNlcnQpIHtcbiAgaWYgKHR5cGVvZiBjZXJ0ID09PSAnb2JqZWN0JyAmJiAhQnVmZmVyLmlzQnVmZmVyKGNlcnQpKSB7XG4gICAgdGhpcy5fcGZ4ID0gY2VydC5wZng7XG4gICAgdGhpcy5fcGFzc3BocmFzZSA9IGNlcnQucGFzc3BocmFzZTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLl9wZnggPSBjZXJ0O1xuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIFNldCB0aGUgY2xpZW50IGNlcnRpZmljYXRlIG9wdGlvbiBmb3IgaHR0cHMgcmVxdWVzdC5cbiAqXG4gKiBAcGFyYW0ge0J1ZmZlciB8IFN0cmluZ30gY2VydFxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3QucHJvdG90eXBlLmNlcnQgPSBmdW5jdGlvbiAoY2VydCkge1xuICB0aGlzLl9jZXJ0ID0gY2VydDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIERvIG5vdCByZWplY3QgZXhwaXJlZCBvciBpbnZhbGlkIFRMUyBjZXJ0cy5cbiAqIHNldHMgYHJlamVjdFVuYXV0aG9yaXplZD10cnVlYC4gQmUgd2FybmVkIHRoYXQgdGhpcyBhbGxvd3MgTUlUTSBhdHRhY2tzLlxuICpcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5kaXNhYmxlVExTQ2VydHMgPSBmdW5jdGlvbiAoKSB7XG4gIHRoaXMuX2Rpc2FibGVUTFNDZXJ0cyA9IHRydWU7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBSZXR1cm4gYW4gaHR0cFtzXSByZXF1ZXN0LlxuICpcbiAqIEByZXR1cm4ge091dGdvaW5nTWVzc2FnZX1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBjb21wbGV4aXR5XG5SZXF1ZXN0LnByb3RvdHlwZS5yZXF1ZXN0ID0gZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5yZXEpIHJldHVybiB0aGlzLnJlcTtcblxuICBjb25zdCBvcHRpb25zID0ge307XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBxdWVyeSA9IHFzLnN0cmluZ2lmeSh0aGlzLnFzLCB7XG4gICAgICBpbmRpY2VzOiBmYWxzZSxcbiAgICAgIHN0cmljdE51bGxIYW5kbGluZzogdHJ1ZVxuICAgIH0pO1xuICAgIGlmIChxdWVyeSkge1xuICAgICAgdGhpcy5xcyA9IHt9O1xuICAgICAgdGhpcy5fcXVlcnkucHVzaChxdWVyeSk7XG4gICAgfVxuXG4gICAgdGhpcy5fZmluYWxpemVRdWVyeVN0cmluZygpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICByZXR1cm4gdGhpcy5lbWl0KCdlcnJvcicsIGVycik7XG4gIH1cblxuICBsZXQgeyB1cmw6IHVybFN0cmluZyB9ID0gdGhpcztcbiAgY29uc3QgcmV0cmllcyA9IHRoaXMuX3JldHJpZXM7XG5cbiAgLy8gZGVmYXVsdCB0byBodHRwOi8vXG4gIGlmICh1cmxTdHJpbmcuaW5kZXhPZignaHR0cCcpICE9PSAwKSB1cmxTdHJpbmcgPSBgaHR0cDovLyR7dXJsU3RyaW5nfWA7XG4gIGNvbnN0IHVybCA9IG5ldyBVUkwodXJsU3RyaW5nKTtcbiAgbGV0IHsgcHJvdG9jb2wgfSA9IHVybDtcbiAgbGV0IHBhdGggPSBgJHt1cmwucGF0aG5hbWV9JHt1cmwuc2VhcmNofWA7XG5cbiAgLy8gc3VwcG9ydCB1bml4IHNvY2tldHNcbiAgaWYgKC9eaHR0cHM/XFwrdW5peDovLnRlc3QocHJvdG9jb2wpID09PSB0cnVlKSB7XG4gICAgLy8gZ2V0IHRoZSBwcm90b2NvbFxuICAgIHByb3RvY29sID0gYCR7cHJvdG9jb2wuc3BsaXQoJysnKVswXX06YDtcblxuICAgIC8vIGdldCB0aGUgc29ja2V0IHBhdGhcbiAgICBvcHRpb25zLnNvY2tldFBhdGggPSB1cmwuaG9zdG5hbWUucmVwbGFjZSgvJTJGL2csICcvJyk7XG4gICAgdXJsLmhvc3QgPSAnJztcbiAgICB1cmwuaG9zdG5hbWUgPSAnJztcbiAgfVxuXG4gIC8vIE92ZXJyaWRlIElQIGFkZHJlc3Mgb2YgYSBob3N0bmFtZVxuICBpZiAodGhpcy5fY29ubmVjdE92ZXJyaWRlKSB7XG4gICAgY29uc3QgeyBob3N0bmFtZSB9ID0gdXJsO1xuICAgIGNvbnN0IG1hdGNoID1cbiAgICAgIGhvc3RuYW1lIGluIHRoaXMuX2Nvbm5lY3RPdmVycmlkZVxuICAgICAgICA/IHRoaXMuX2Nvbm5lY3RPdmVycmlkZVtob3N0bmFtZV1cbiAgICAgICAgOiB0aGlzLl9jb25uZWN0T3ZlcnJpZGVbJyonXTtcbiAgICBpZiAobWF0Y2gpIHtcbiAgICAgIC8vIGJhY2t1cCB0aGUgcmVhbCBob3N0XG4gICAgICBpZiAoIXRoaXMuX2hlYWRlci5ob3N0KSB7XG4gICAgICAgIHRoaXMuc2V0KCdob3N0JywgdXJsLmhvc3QpO1xuICAgICAgfVxuXG4gICAgICBsZXQgbmV3SG9zdDtcbiAgICAgIGxldCBuZXdQb3J0O1xuXG4gICAgICBpZiAodHlwZW9mIG1hdGNoID09PSAnb2JqZWN0Jykge1xuICAgICAgICBuZXdIb3N0ID0gbWF0Y2guaG9zdDtcbiAgICAgICAgbmV3UG9ydCA9IG1hdGNoLnBvcnQ7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBuZXdIb3N0ID0gbWF0Y2g7XG4gICAgICAgIG5ld1BvcnQgPSB1cmwucG9ydDtcbiAgICAgIH1cblxuICAgICAgLy8gd3JhcCBbaXB2Nl1cbiAgICAgIHVybC5ob3N0ID0gLzovLnRlc3QobmV3SG9zdCkgPyBgWyR7bmV3SG9zdH1dYCA6IG5ld0hvc3Q7XG4gICAgICBpZiAobmV3UG9ydCkge1xuICAgICAgICB1cmwuaG9zdCArPSBgOiR7bmV3UG9ydH1gO1xuICAgICAgICB1cmwucG9ydCA9IG5ld1BvcnQ7XG4gICAgICB9XG5cbiAgICAgIHVybC5ob3N0bmFtZSA9IG5ld0hvc3Q7XG4gICAgfVxuICB9XG5cbiAgLy8gb3B0aW9uc1xuICBvcHRpb25zLm1ldGhvZCA9IHRoaXMubWV0aG9kO1xuICBvcHRpb25zLnBvcnQgPSB1cmwucG9ydDtcbiAgb3B0aW9ucy5wYXRoID0gcGF0aDtcbiAgb3B0aW9ucy5ob3N0ID0gdXRpbHMubm9ybWFsaXplSG9zdG5hbWUodXJsLmhvc3RuYW1lKTsgLy8gZXg6IFs6OjFdIC0+IDo6MVxuICBvcHRpb25zLmNhID0gdGhpcy5fY2E7XG4gIG9wdGlvbnMua2V5ID0gdGhpcy5fa2V5O1xuICBvcHRpb25zLnBmeCA9IHRoaXMuX3BmeDtcbiAgb3B0aW9ucy5jZXJ0ID0gdGhpcy5fY2VydDtcbiAgb3B0aW9ucy5wYXNzcGhyYXNlID0gdGhpcy5fcGFzc3BocmFzZTtcbiAgb3B0aW9ucy5hZ2VudCA9IHRoaXMuX2FnZW50O1xuICBvcHRpb25zLmxvb2t1cCA9IHRoaXMuX2xvb2t1cDtcbiAgb3B0aW9ucy5yZWplY3RVbmF1dGhvcml6ZWQgPVxuICAgIHR5cGVvZiB0aGlzLl9kaXNhYmxlVExTQ2VydHMgPT09ICdib29sZWFuJ1xuICAgICAgPyAhdGhpcy5fZGlzYWJsZVRMU0NlcnRzXG4gICAgICA6IHByb2Nlc3MuZW52Lk5PREVfVExTX1JFSkVDVF9VTkFVVEhPUklaRUQgIT09ICcwJztcblxuICAvLyBBbGxvd3MgcmVxdWVzdC5nZXQoJ2h0dHBzOi8vMS4yLjMuNC8nKS5zZXQoJ0hvc3QnLCAnZXhhbXBsZS5jb20nKVxuICBpZiAodGhpcy5faGVhZGVyLmhvc3QpIHtcbiAgICBvcHRpb25zLnNlcnZlcm5hbWUgPSB0aGlzLl9oZWFkZXIuaG9zdC5yZXBsYWNlKC86XFxkKyQvLCAnJyk7XG4gIH1cblxuICBpZiAoXG4gICAgdGhpcy5fdHJ1c3RMb2NhbGhvc3QgJiZcbiAgICAvXig/OmxvY2FsaG9zdHwxMjdcXC4wXFwuMFxcLlxcZCt8KDAqOikrOjAqMSkkLy50ZXN0KHVybC5ob3N0bmFtZSlcbiAgKSB7XG4gICAgb3B0aW9ucy5yZWplY3RVbmF1dGhvcml6ZWQgPSBmYWxzZTtcbiAgfVxuXG4gIC8vIGluaXRpYXRlIHJlcXVlc3RcbiAgY29uc3QgbW9kdWxlXyA9IHRoaXMuX2VuYWJsZUh0dHAyXG4gICAgPyBleHBvcnRzLnByb3RvY29sc1snaHR0cDI6J10uc2V0UHJvdG9jb2wocHJvdG9jb2wpXG4gICAgOiBleHBvcnRzLnByb3RvY29sc1twcm90b2NvbF07XG5cbiAgLy8gcmVxdWVzdFxuICB0aGlzLnJlcSA9IG1vZHVsZV8ucmVxdWVzdChvcHRpb25zKTtcbiAgY29uc3QgeyByZXEgfSA9IHRoaXM7XG5cbiAgLy8gc2V0IHRjcCBubyBkZWxheVxuICByZXEuc2V0Tm9EZWxheSh0cnVlKTtcblxuICBpZiAob3B0aW9ucy5tZXRob2QgIT09ICdIRUFEJykge1xuICAgIHJlcS5zZXRIZWFkZXIoJ0FjY2VwdC1FbmNvZGluZycsICdnemlwLCBkZWZsYXRlJyk7XG4gIH1cblxuICB0aGlzLnByb3RvY29sID0gcHJvdG9jb2w7XG4gIHRoaXMuaG9zdCA9IHVybC5ob3N0O1xuXG4gIC8vIGV4cG9zZSBldmVudHNcbiAgcmVxLm9uY2UoJ2RyYWluJywgKCkgPT4ge1xuICAgIHRoaXMuZW1pdCgnZHJhaW4nKTtcbiAgfSk7XG5cbiAgcmVxLm9uKCdlcnJvcicsIChlcnJvcikgPT4ge1xuICAgIC8vIGZsYWcgYWJvcnRpb24gaGVyZSBmb3Igb3V0IHRpbWVvdXRzXG4gICAgLy8gYmVjYXVzZSBub2RlIHdpbGwgZW1pdCBhIGZhdXgtZXJyb3IgXCJzb2NrZXQgaGFuZyB1cFwiXG4gICAgLy8gd2hlbiByZXF1ZXN0IGlzIGFib3J0ZWQgYmVmb3JlIGEgY29ubmVjdGlvbiBpcyBtYWRlXG4gICAgaWYgKHRoaXMuX2Fib3J0ZWQpIHJldHVybjtcbiAgICAvLyBpZiBub3QgdGhlIHNhbWUsIHdlIGFyZSBpbiB0aGUgKipvbGQqKiAoY2FuY2VsbGVkKSByZXF1ZXN0LFxuICAgIC8vIHNvIG5lZWQgdG8gY29udGludWUgKHNhbWUgYXMgZm9yIGFib3ZlKVxuICAgIGlmICh0aGlzLl9yZXRyaWVzICE9PSByZXRyaWVzKSByZXR1cm47XG4gICAgLy8gaWYgd2UndmUgcmVjZWl2ZWQgYSByZXNwb25zZSB0aGVuIHdlIGRvbid0IHdhbnQgdG8gbGV0XG4gICAgLy8gYW4gZXJyb3IgaW4gdGhlIHJlcXVlc3QgYmxvdyB1cCB0aGUgcmVzcG9uc2VcbiAgICBpZiAodGhpcy5yZXNwb25zZSkgcmV0dXJuO1xuICAgIHRoaXMuY2FsbGJhY2soZXJyb3IpO1xuICB9KTtcblxuICBpZiAodGhpcy5fc3RyaXBDb29raWVzRm9yQ3Jvc3NPcmlnaW4pIHtcbiAgICBkZWxldGUgdGhpcy51c2VybmFtZTtcbiAgICBkZWxldGUgdGhpcy5wYXNzd29yZDtcbiAgICBkZWxldGUgdGhpcy5jb29raWVzO1xuICAgIGlmICh0aGlzLmhlYWRlcikge1xuICAgICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXModGhpcy5oZWFkZXIpKSB7XG4gICAgICAgIGNvbnN0IGxrID0ga2V5LnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGlmIChsayA9PT0gJ2F1dGhvcml6YXRpb24nIHx8IGxrID09PSAnY29va2llJykge1xuICAgICAgICAgIGRlbGV0ZSB0aGlzLmhlYWRlcltrZXldO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGlmICh0aGlzLl9oZWFkZXIpIHtcbiAgICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHRoaXMuX2hlYWRlcikpIHtcbiAgICAgICAgY29uc3QgbGsgPSBrZXkudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgaWYgKGxrID09PSAnYXV0aG9yaXphdGlvbicgfHwgbGsgPT09ICdjb29raWUnKSB7XG4gICAgICAgICAgZGVsZXRlIHRoaXMuX2hlYWRlcltrZXldO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gYXV0aFxuICBpZiAodXJsLnVzZXJuYW1lIHx8IHVybC5wYXNzd29yZCkge1xuICAgIHRoaXMuYXV0aCh1cmwudXNlcm5hbWUsIHVybC5wYXNzd29yZCk7XG4gIH1cblxuICBpZiAodGhpcy51c2VybmFtZSAmJiB0aGlzLnBhc3N3b3JkICYmICF0aGlzLl9zdHJpcENvb2tpZXNGb3JDcm9zc09yaWdpbikge1xuICAgIHRoaXMuYXV0aCh0aGlzLnVzZXJuYW1lLCB0aGlzLnBhc3N3b3JkKTtcbiAgfVxuXG4gIGZvciAoY29uc3Qga2V5IGluIHRoaXMuaGVhZGVyKSB7XG4gICAgaWYgKGhhc093bih0aGlzLmhlYWRlciwga2V5KSkgcmVxLnNldEhlYWRlcihrZXksIHRoaXMuaGVhZGVyW2tleV0pO1xuICB9XG5cbiAgLy8gYWRkIGNvb2tpZXNcbiAgaWYgKHRoaXMuY29va2llcyAmJiAhdGhpcy5fc3RyaXBDb29raWVzRm9yQ3Jvc3NPcmlnaW4pIHtcbiAgICBpZiAoaGFzT3duKHRoaXMuX2hlYWRlciwgJ2Nvb2tpZScpKSB7XG4gICAgICAvLyBtZXJnZVxuICAgICAgY29uc3QgdGVtcG9yYXJ5SmFyID0gbmV3IENvb2tpZUphci5Db29raWVKYXIoKTtcbiAgICAgIHRlbXBvcmFyeUphci5zZXRDb29raWVzKHRoaXMuX2hlYWRlci5jb29raWUuc3BsaXQoJzsgJykpO1xuICAgICAgdGVtcG9yYXJ5SmFyLnNldENvb2tpZXModGhpcy5jb29raWVzLnNwbGl0KCc7ICcpKTtcbiAgICAgIHJlcS5zZXRIZWFkZXIoXG4gICAgICAgICdDb29raWUnLFxuICAgICAgICB0ZW1wb3JhcnlKYXIuZ2V0Q29va2llcyhDb29raWVKYXIuQ29va2llQWNjZXNzSW5mby5BbGwpLnRvVmFsdWVTdHJpbmcoKVxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVxLnNldEhlYWRlcignQ29va2llJywgdGhpcy5jb29raWVzKTtcbiAgICB9XG4gIH1cblxuICBpZiAodGhpcy5fc3RyaXBDb29raWVzRm9yQ3Jvc3NPcmlnaW4gJiYgdHlwZW9mIHJlcS5yZW1vdmVIZWFkZXIgPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXEucmVtb3ZlSGVhZGVyKCdDb29raWUnKTtcbiAgICByZXEucmVtb3ZlSGVhZGVyKCdjb29raWUnKTtcbiAgICByZXEucmVtb3ZlSGVhZGVyKCdBdXRob3JpemF0aW9uJyk7XG4gICAgcmVxLnJlbW92ZUhlYWRlcignYXV0aG9yaXphdGlvbicpO1xuICB9XG5cbiAgcmV0dXJuIHJlcTtcbn07XG5cbi8qKlxuICogSW52b2tlIHRoZSBjYWxsYmFjayB3aXRoIGBlcnJgIGFuZCBgcmVzYFxuICogYW5kIGhhbmRsZSBhcml0eSBjaGVjay5cbiAqXG4gKiBAcGFyYW0ge0Vycm9yfSBlcnJcbiAqIEBwYXJhbSB7UmVzcG9uc2V9IHJlc1xuICogQGFwaSBwcml2YXRlXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUuY2FsbGJhY2sgPSBmdW5jdGlvbiAoZXJyb3IsIHJlcykge1xuICBpZiAodGhpcy5fc2l6ZUVycm9yKSBlcnJvciA9IHRoaXMuX3NpemVFcnJvcjtcblxuICBpZiAodGhpcy5fc2hvdWxkUmV0cnkoZXJyb3IsIHJlcykpIHtcbiAgICByZXR1cm4gdGhpcy5fcmV0cnkoKTtcbiAgfVxuXG4gIC8vIFJlcXVlc3QgaXMgc2V0dGxpbmcgKG5vIG1vcmUgcmV0cmllcykg4oCUIGd1YXJhbnRlZSBzcG9vbCBjbGVhbnVwIGZvciBhbGwgcGF0aHNcbiAgdGhpcy5fY2xlYW51cFNwb29sRmlsZSgpO1xuXG4gIGNvbnN0IGZuID0gdGhpcy5fY2FsbGJhY2s7XG4gIHRoaXMuY2xlYXJUaW1lb3V0KCk7XG5cbiAgaWYgKCFmbikge1xuICAgIGlmIChlcnJvciAmJiB0aGlzLmxpc3RlbmVycygnZXJyb3InKS5sZW5ndGggPiAwICYmICF0aGlzLl9lcnJvckVtaXR0ZWQpIHtcbiAgICAgIHRoaXMuX2Vycm9yRW1pdHRlZCA9IHRydWU7XG4gICAgICB0aGlzLmVtaXQoJ2Vycm9yJywgZXJyb3IpO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAodGhpcy5jYWxsZWQpIHJldHVybjtcbiAgdGhpcy5jYWxsZWQgPSB0cnVlO1xuXG4gIGlmICghZXJyb3IpIHtcbiAgICB0cnkge1xuICAgICAgaWYgKCF0aGlzLl9pc1Jlc3BvbnNlT0socmVzKSkge1xuICAgICAgICBsZXQgbWVzc2FnZSA9ICdVbnN1Y2Nlc3NmdWwgSFRUUCByZXNwb25zZSc7XG4gICAgICAgIGlmIChyZXMpIHtcbiAgICAgICAgICBtZXNzYWdlID0gaHR0cC5TVEFUVVNfQ09ERVNbcmVzLnN0YXR1c10gfHwgbWVzc2FnZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGVycm9yID0gbmV3IEVycm9yKG1lc3NhZ2UpO1xuICAgICAgICBlcnJvci5zdGF0dXMgPSByZXMgPyByZXMuc3RhdHVzIDogdW5kZWZpbmVkO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgZXJyb3IgPSBlcnI7XG4gICAgICBlcnJvci5zdGF0dXMgPSBlcnJvci5zdGF0dXMgfHwgKHJlcyA/IHJlcy5zdGF0dXMgOiB1bmRlZmluZWQpO1xuICAgIH1cbiAgfVxuXG4gIC8vIEl0J3MgaW1wb3J0YW50IHRoYXQgdGhlIGNhbGxiYWNrIGlzIGNhbGxlZCBvdXRzaWRlIHRyeS9jYXRjaFxuICAvLyB0byBhdm9pZCBkb3VibGUgY2FsbGJhY2tcbiAgaWYgKCFlcnJvcikge1xuICAgIC8vIENsZWFuIHVwIGFueSBkaXNrLXNwb29sZWQgcmVwbGF5IGZpbGUgb24gc3VjY2Vzcy5cbiAgICB0aGlzLl9jbGVhbnVwU3Bvb2xGaWxlKCk7XG4gICAgcmV0dXJuIGZuKG51bGwsIHJlcyk7XG4gIH1cblxuICBlcnJvci5yZXNwb25zZSA9IHJlcztcbiAgaWYgKHRoaXMuaGFzU2l6ZUVycm9yKCkgfHwgZXJyb3IuY29kZSA9PT0gJ0VUT09MQVJHRScpIHtcbiAgICAvLyBTaXplIGVycm9ycyBtdXN0IG5ldmVyIHRyaWdnZXIgYXV0b21hdGljIHJldHJpZXM7IHJldHJpZXMgY291bnQgaXMgYWx3YXlzIDAuXG4gICAgZXJyb3IucmV0cmllcyA9IDA7XG4gIH0gZWxzZSBpZiAodGhpcy5fbWF4UmV0cmllcykge1xuICAgIGVycm9yLnJldHJpZXMgPSB0aGlzLl9yZXRyaWVzIC0gMTtcbiAgfVxuXG4gIC8vIG9ubHkgZW1pdCBlcnJvciBldmVudCBpZiB0aGVyZSBpcyBhIGxpc3RlbmVyXG4gIC8vIG90aGVyd2lzZSB3ZSBhc3N1bWUgdGhlIGNhbGxiYWNrIHRvIGAuZW5kKClgIHdpbGwgZ2V0IHRoZSBlcnJvclxuICBpZiAoZXJyb3IgJiYgdGhpcy5saXN0ZW5lcnMoJ2Vycm9yJykubGVuZ3RoID4gMCAmJiAhdGhpcy5fZXJyb3JFbWl0dGVkKSB7XG4gICAgdGhpcy5fZXJyb3JFbWl0dGVkID0gdHJ1ZTtcbiAgICB0aGlzLmVtaXQoJ2Vycm9yJywgZXJyb3IpO1xuICB9XG5cbiAgZm4oZXJyb3IsIHJlcyk7XG5cbiAgLy8gQ2xlYW4gdXAgYW55IGRpc2stc3Bvb2xlZCByZXBsYXkgZmlsZSBvbmNlIHRoZSByZXF1ZXN0IGhhcyBmdWxseSBzZXR0bGVkLlxuICAvLyBEbyB0aGlzIGFmdGVyIGZuKCkgc28gdGhlIHVzZXIgY2FsbGJhY2sgZG9lcyBub3QgcmFjZSB3aXRoIGZpbGUgZGVsZXRpb24uXG4gIHRoaXMuX2NsZWFudXBTcG9vbEZpbGUoKTtcbn07XG5cbi8qKlxuICogQ2hlY2sgaWYgYG9iamAgaXMgYSBob3N0IG9iamVjdCxcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqIGhvc3Qgb2JqZWN0XG4gKiBAcmV0dXJuIHtCb29sZWFufSBpcyBhIGhvc3Qgb2JqZWN0XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuUmVxdWVzdC5wcm90b3R5cGUuX2lzSG9zdCA9IGZ1bmN0aW9uIChvYmplY3QpIHtcbiAgcmV0dXJuIChcbiAgICBCdWZmZXIuaXNCdWZmZXIob2JqZWN0KSB8fFxuICAgIG9iamVjdCBpbnN0YW5jZW9mIFN0cmVhbSB8fFxuICAgIG9iamVjdCBpbnN0YW5jZW9mIEZvcm1EYXRhXG4gICk7XG59O1xuXG4vKipcbiAqIENoZWNrIHdoZXRoZXIgdGhlIHJlcXVlc3QgdXBsb2FkIGhhcyBjb21wbGV0ZWQuXG4gKiBGb3IgYm9keWxlc3MgbWV0aG9kcyAoR0VULCBIRUFEKSwgdXBsb2FkIGlzIGFsd2F5cyBjb25zaWRlcmVkIGNvbXBsZXRlLlxuICogRm9yIHVwbG9hZCBtZXRob2RzLCBjb21wbGV0ZSBvbmx5IG9uY2UgdGhlIHJlcXVlc3QgaGFzIGZpbmlzaGVkIHRyYW5zbWl0dGluZy5cbiAqXG4gKiBAcmV0dXJuIHtCb29sZWFufVxuICogQGFwaSBwcml2YXRlXG4gKi9cblJlcXVlc3QucHJvdG90eXBlLl9pc1VwbG9hZERvbmUgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0aGlzLm1ldGhvZCA9PT0gJ0dFVCcgfHwgdGhpcy5tZXRob2QgPT09ICdIRUFEJykgcmV0dXJuIHRydWU7XG4gIGlmICh0aGlzLl91cGxvYWRDb21wbGV0ZSkgcmV0dXJuIHRydWU7XG4gIGNvbnN0IHsgcmVxIH0gPSB0aGlzO1xuICBpZiAocmVxKSB7XG4gICAgaWYgKHJlcS53cml0YWJsZUVuZGVkIHx8IHJlcS53cml0YWJsZUZpbmlzaGVkIHx8IHJlcS5maW5pc2hlZCkge1xuICAgICAgdGhpcy5fdXBsb2FkQ29tcGxldGUgPSB0cnVlO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGNvbnN0IGZyYW1lID0gcmVxLmZyYW1lIHx8ICh0eXBlb2YgcmVxLmdldEZyYW1lID09PSAnZnVuY3Rpb24nICYmIHJlcS5mcmFtZSk7XG4gICAgaWYgKGZyYW1lICYmIChmcmFtZS53cml0YWJsZUVuZGVkIHx8IGZyYW1lLndyaXRhYmxlRmluaXNoZWQgfHwgZnJhbWUuZmluaXNoZWQpKSB7XG4gICAgICB0aGlzLl91cGxvYWRDb21wbGV0ZSA9IHRydWU7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuLyoqXG4gKiBBYm9ydCB0aGUgcmVxdWVzdCBhbmQgaW52b2tlIGNhbGxiYWNrIHdpdGggc2l6ZSBsaW1pdCBlcnJvci5cbiAqIEFsc28gcHJvdGVjdHMgdGhlIGVtaXR0ZWQgUmVzcG9uc2Ugb2JqZWN0IGZyb20gdW5oYW5kbGVkIGVycm9ycy5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gdHlwZSByZXF1ZXN0IG9yIHJlc3BvbnNlXG4gKiBAcmV0dXJuIHtFcnJvcn0gc2l6ZSBlcnJvclxuICogQGFwaSBwcml2YXRlXG4gKi9cblJlcXVlc3QucHJvdG90eXBlLl9hYm9ydFdpdGhTaXplRXJyb3IgPSBmdW5jdGlvbiAodHlwZSkge1xuICBpZiAodGhpcy5fc2l6ZUVycm9yKSByZXR1cm4gdGhpcy5fc2l6ZUVycm9yO1xuXG4gIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKGBNYXhpbXVtICR7dHlwZX0gc2l6ZSByZWFjaGVkYCk7XG4gIGVycm9yLmNvZGUgPSAnRVRPT0xBUkdFJztcbiAgZXJyb3IucmV0cmllcyA9IDA7XG4gIHRoaXMuX3NpemVFcnJvciA9IGVycm9yO1xuXG4gIC8vIFByZXZlbnQgdW5oYW5kbGVkIGVycm9yIGV2ZW50IG9uIHRoZSByYXcgSW5jb21pbmdNZXNzYWdlIG9ubHkgaWYgbm8gbGlzdGVuZXJzXG4gIGlmICh0aGlzLnJlcyAmJiB0aGlzLnJlcy5saXN0ZW5lcnMoJ2Vycm9yJykubGVuZ3RoID09PSAwKSB7XG4gICAgdGhpcy5yZXMub24oJ2Vycm9yJywgKCkgPT4ge30pO1xuICB9XG5cbiAgLy8gUHJldmVudCB1bmhhbmRsZWQgZXJyb3IgZXZlbnQgb24gdGhlIHJhdyBDbGllbnRSZXF1ZXN0IG9ubHkgaWYgbm8gbGlzdGVuZXJzXG4gIGlmICh0aGlzLnJlcSAmJiB0aGlzLnJlcS5saXN0ZW5lcnMoJ2Vycm9yJykubGVuZ3RoID09PSAwKSB7XG4gICAgdGhpcy5yZXEub24oJ2Vycm9yJywgKCkgPT4ge30pO1xuICB9XG5cbiAgaWYgKHRoaXMuX3NvdXJjZVN0cmVhbSkge1xuICAgIHRoaXMuX3NvdXJjZVN0cmVhbS51bnBpcGUodGhpcyk7XG4gICAgaWYgKHR5cGVvZiB0aGlzLl9zb3VyY2VTdHJlYW0uZGVzdHJveSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdGhpcy5fc291cmNlU3RyZWFtLmRlc3Ryb3koKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiB0aGlzLl9zb3VyY2VTdHJlYW0ucmVzdW1lID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aGlzLl9zb3VyY2VTdHJlYW0ucmVzdW1lKCk7XG4gICAgfVxuICB9XG5cbiAgaWYgKHRoaXMuX3BpcGVEZXN0aW5hdGlvbikge1xuICAgIGNvbnN0IGRlc3QgPSB0aGlzLl9waXBlRGVzdGluYXRpb247XG4gICAgdGhpcy5fcGlwZURlc3RpbmF0aW9uID0gbnVsbDtcbiAgICBpZiAodHlwZW9mIGRlc3QuZGVzdHJveSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgZGVzdC5kZXN0cm95KGRlc3QubGlzdGVuZXJzKCdlcnJvcicpLmxlbmd0aCA+IDAgPyBlcnJvciA6IHVuZGVmaW5lZCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChkZXN0Lmxpc3RlbmVycygnZXJyb3InKS5sZW5ndGggPiAwKSB7XG4gICAgICAgIGRlc3QuZW1pdCgnZXJyb3InLCBlcnJvcik7XG4gICAgICB9XG4gICAgICBpZiAodHlwZW9mIGRlc3QuZW5kID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGRlc3QuZW5kKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaWYgKHRoaXMuX3BlbmRpbmdVbmJ1ZmZlcmVkUmVzcG9uc2UpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMuX3BlbmRpbmdVbmJ1ZmZlcmVkUmVzcG9uc2UuX2NsZWFudXBSZXBsYXkgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRoaXMuX3BlbmRpbmdVbmJ1ZmZlcmVkUmVzcG9uc2UuX2NsZWFudXBSZXBsYXkoKTtcbiAgICB9XG4gICAgdGhpcy5fcGVuZGluZ1VuYnVmZmVyZWRSZXNwb25zZSA9IG51bGw7XG4gIH1cblxuICBpZiAodHlwZSA9PT0gJ3Jlc3BvbnNlJyAmJiB0aGlzLnJlcykge1xuICAgIGlmICghdGhpcy5yZXMuX3NpemVFcnJvckRlc3Ryb3llZCkge1xuICAgICAgdGhpcy5yZXMuX3NpemVFcnJvckRlc3Ryb3llZCA9IHRydWU7XG4gICAgICBpZiAodGhpcy5yZXNwb25zZSAmJiB0aGlzLnJlc3BvbnNlLmxpc3RlbmVycygnZXJyb3InKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgdGhpcy5yZXNwb25zZS5vbmNlKCdlcnJvcicsICgpID0+IHt9KTtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2YgdGhpcy5yZXMuZGVzdHJveSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICB0aGlzLnJlcy5kZXN0cm95KGVycm9yKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMucmVzLmVtaXQoJ2Vycm9yJywgZXJyb3IpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHRoaXMuYWJvcnQoKTtcbiAgaWYgKCF0aGlzLmNhbGxlZCkge1xuICAgIHRoaXMuY2FsbGJhY2soZXJyb3IsIHR5cGUgPT09ICdyZXNwb25zZScgPyBudWxsIDogdW5kZWZpbmVkKTtcbiAgfSBlbHNlIHtcbiAgICAvLyBJZiBjYWxsYmFjayB3YXMgYWxyZWFkeSBjYWxsZWQgKGUuZy4gdW5idWZmZXJlZCBzdHJlYW1pbmcpLFxuICAgIC8vIHN0aWxsIGVtaXQgZXJyb3Igb24gdGhlIFJlcXVlc3QgaWYgYW4gZXJyb3IgbGlzdGVuZXIgaXMgYXR0YWNoZWQuXG4gICAgaWYgKHRoaXMubGlzdGVuZXJzKCdlcnJvcicpLmxlbmd0aCA+IDAgJiYgIXRoaXMuX2Vycm9yRW1pdHRlZCkge1xuICAgICAgdGhpcy5fZXJyb3JFbWl0dGVkID0gdHJ1ZTtcbiAgICAgIHRoaXMuZW1pdCgnZXJyb3InLCBlcnJvcik7XG4gICAgfVxuICB9XG4gIHJldHVybiBlcnJvcjtcbn07XG5cbi8qKlxuICogQ2hlY2sgd2hldGhlciBhIHJlcXVlc3QgYm9keSBoYXMgZXhjZWVkZWQgdGhlIGNvbmZpZ3VyZWQgc2l6ZSBsaW1pdC5cbiAqXG4gKiBAcGFyYW0ge051bWJlcn0gc2l6ZSByZXF1ZXN0IGJvZHkgc2l6ZSBpbiBieXRlc1xuICogQHJldHVybiB7Qm9vbGVhbn0gd2hldGhlciB0aGUgcmVxdWVzdCBtYXkgY29udGludWVcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5SZXF1ZXN0LnByb3RvdHlwZS5fY2hlY2tSZXF1ZXN0U2l6ZSA9IGZ1bmN0aW9uIChzaXplKSB7XG4gIGlmIChcbiAgICB0aGlzLl9tYXhSZXF1ZXN0U2l6ZSAhPT0gdW5kZWZpbmVkICYmXG4gICAgc2l6ZSA+IHRoaXMuX21heFJlcXVlc3RTaXplXG4gICkge1xuICAgIHRoaXMuX2Fib3J0V2l0aFNpemVFcnJvcigncmVxdWVzdCcpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufTtcblxuLyoqXG4gKiBNb25pdG9yIGFuZCBsaW1pdCByZXNwb25zZSBib2R5IGRvd25sb2Fkcy5cbiAqIEEgc2luZ2xlIGNvdW50aW5nIFRyYW5zZm9ybSB1c2VkIGJ5IF9waXBlQ29udGludWUuXG4gKlxuICogQHJldHVybiB7VHJhbnNmb3JtfSByZXNwb25zZSBtb25pdG9yXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuUmVxdWVzdC5wcm90b3R5cGUuX2dldFJlc3BvbnNlTW9uaXRvciA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHRoaXMuX21heFJlc3BvbnNlU2l6ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIG5ldyBTdHJlYW0uUGFzc1Rocm91Z2goKTtcbiAgfVxuXG4gIGNvbnN0IG1heCA9IHRoaXMuX21heFJlc3BvbnNlU2l6ZTtcbiAgbGV0IGxvYWRlZCA9IDA7XG5cbiAgY29uc3QgbW9uaXRvciA9IG5ldyBTdHJlYW0uVHJhbnNmb3JtKCk7XG4gIG1vbml0b3IuX3RyYW5zZm9ybSA9IChjaHVuaywgZW5jb2RpbmcsIGNhbGxiYWNrKSA9PiB7XG4gICAgbG9hZGVkICs9IGNodW5rLmxlbmd0aDtcbiAgICBpZiAobG9hZGVkID4gbWF4KSB7XG4gICAgICBjb25zdCBlcnJvciA9IHRoaXMuX2Fib3J0V2l0aFNpemVFcnJvcigncmVzcG9uc2UnKTtcbiAgICAgIGlmICh0aGlzLnJlcykge1xuICAgICAgICB0aGlzLnJlcy51bnBpcGUoKTtcbiAgICAgICAgdGhpcy5yZXMuZGVzdHJveSgpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICB9XG5cbiAgICBjYWxsYmFjayhudWxsLCBjaHVuayk7XG4gIH07XG5cbiAgcmV0dXJuIG1vbml0b3I7XG59O1xuXG5cbi8qKlxuICogSW5pdGlhdGUgcmVxdWVzdCwgaW52b2tpbmcgY2FsbGJhY2sgYGZuKGVyciwgcmVzKWBcbiAqIHdpdGggYW4gaW5zdGFuY2VvZiBgUmVzcG9uc2VgLlxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUuX2VtaXRSZXNwb25zZSA9IGZ1bmN0aW9uIChib2R5LCBmaWxlcykge1xuICBjb25zdCByZXNwb25zZSA9IG5ldyBSZXNwb25zZSh0aGlzKTtcbiAgdGhpcy5yZXNwb25zZSA9IHJlc3BvbnNlO1xuICByZXNwb25zZS5yZWRpcmVjdHMgPSB0aGlzLl9yZWRpcmVjdExpc3Q7XG4gIGlmICh1bmRlZmluZWQgIT09IGJvZHkpIHtcbiAgICByZXNwb25zZS5ib2R5ID0gYm9keTtcbiAgfVxuXG5cbiAgY29uc3Qgb3JpZ0VtaXQgPSByZXNwb25zZS5lbWl0O1xuICBsZXQgcmVzcG9uc2VFcnJvckVtaXR0ZWQgPSBmYWxzZTtcbiAgcmVzcG9uc2UuZW1pdCA9IGZ1bmN0aW9uIChldmVudCwgLi4uYXJncykge1xuICAgIGlmIChldmVudCA9PT0gJ2Vycm9yJykge1xuICAgICAgaWYgKHJlc3BvbnNlRXJyb3JFbWl0dGVkKSByZXR1cm4gZmFsc2U7XG4gICAgICByZXNwb25zZUVycm9yRW1pdHRlZCA9IHRydWU7XG4gICAgfVxuICAgIHJldHVybiBvcmlnRW1pdC5hcHBseSh0aGlzLCBbZXZlbnQsIC4uLmFyZ3NdKTtcbiAgfTtcblxuICAvLyBQcmV2ZW50IHVuaGFuZGxlZCBlcnJvciBjcmFzaGVzIHdoZW4gY29uc3VtZXIgaGFuZGxlcyByZXNwb25zZSB2aWEgY2FsbGJhY2tcbiAgcmVzcG9uc2Uub24oJ2Vycm9yJywgbm9vcCk7XG5cbiAgcmVzcG9uc2UuZmlsZXMgPSBmaWxlcztcbiAgaWYgKHRoaXMuX2VuZENhbGxlZCkge1xuICAgIHJlc3BvbnNlLnBpcGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiZW5kKCkgaGFzIGFscmVhZHkgYmVlbiBjYWxsZWQsIHNvIGl0J3MgdG9vIGxhdGUgdG8gc3RhcnQgcGlwaW5nXCJcbiAgICAgICk7XG4gICAgfTtcbiAgfVxuXG4gIHRoaXMuZW1pdCgncmVzcG9uc2UnLCByZXNwb25zZSk7XG4gIHJldHVybiByZXNwb25zZTtcbn07XG5cbi8qKlxuICogRW1pdCBgcmVkaXJlY3RgIGV2ZW50LCBwYXNzaW5nIGFuIGluc3RhbmNlb2YgYFJlc3BvbnNlYC5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5fZW1pdFJlZGlyZWN0ID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCByZXNwb25zZSA9IG5ldyBSZXNwb25zZSh0aGlzKTtcbiAgcmVzcG9uc2UucmVkaXJlY3RzID0gdGhpcy5fcmVkaXJlY3RMaXN0O1xuICB0aGlzLmVtaXQoJ3JlZGlyZWN0JywgcmVzcG9uc2UpO1xufTtcblxuUmVxdWVzdC5wcm90b3R5cGUuZW5kID0gZnVuY3Rpb24gKGZuKSB7XG4gIGlmICh0aGlzLl9lbmRDYWxsZWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAnLmVuZCgpIHdhcyBjYWxsZWQgdHdpY2UuIFRoaXMgaXMgbm90IHN1cHBvcnRlZCBpbiBzdXBlcmFnZW50J1xuICAgICk7XG4gIH1cblxuICB0aGlzLl9lbmRDYWxsZWQgPSB0cnVlO1xuXG4gIC8vIHN0b3JlIGNhbGxiYWNrXG4gIHRoaXMuX2NhbGxiYWNrID0gZm4gfHwgbm9vcDtcblxuICBjb25zdCBjYW5SZWRpcmVjdCA9IHRoaXMuX21heFJlZGlyZWN0cyA9PT0gdW5kZWZpbmVkIHx8IHRoaXMuX21heFJlZGlyZWN0cyA+IDA7XG4gIGNvbnN0IGNhblJldHJ5ID0gQm9vbGVhbih0aGlzLl9tYXhSZXRyaWVzICYmIHRoaXMuX21heFJldHJpZXMgPiAwKTtcbiAgY29uc3QgaGFzU2l6ZUxpbWl0ID0gdGhpcy5fbWF4UmVxdWVzdFNpemUgIT09IHVuZGVmaW5lZCB8fCB0aGlzLl9tYXhSZXNwb25zZVNpemUgIT09IHVuZGVmaW5lZDtcbiAgY29uc3QgbmVlZHNNdWx0aXBhcnRSZXBsYXkgPSB0aGlzLm1ldGhvZCAhPT0gJ0dFVCcgJiYgdGhpcy5tZXRob2QgIT09ICdIRUFEJyAmJiB0aGlzLl9mb3JtRGF0YSAmJiAoY2FuUmV0cnkgfHwgY2FuUmVkaXJlY3QgfHwgaGFzU2l6ZUxpbWl0KTtcblxuICBpZiAobmVlZHNNdWx0aXBhcnRSZXBsYXkgJiYgIXRoaXMuX2Zvcm1EYXRhVG1wUGF0aCkge1xuICAgIGlmICghdGhpcy5fZm9ybURhdGFTcG9vbFByb21pc2UpIHtcbiAgICAgIGNvbnN0IGZvcm1EYXRhID0gdGhpcy5fZm9ybURhdGE7XG4gICAgICB0aGlzLl9mb3JtRGF0YUhlYWRlcnMgPSBmb3JtRGF0YS5nZXRIZWFkZXJzKCk7XG4gICAgICB0aGlzLl9mb3JtRGF0YVNwb29sUHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgc3Bvb2xGb3JtRGF0YVRvRGlzayhmb3JtRGF0YSwgdGhpcy5fbWF4UmVxdWVzdFNpemUsIChlcnJvciwgcmVzdWx0KSA9PiB7XG4gICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gcmVqZWN0KGVycm9yKTtcbiAgICAgICAgICByZXNvbHZlKHJlc3VsdCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgdGhpcy5fZm9ybURhdGFTcG9vbFByb21pc2UudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICBpZiAodGhpcy5fYWJvcnRlZCB8fCB0aGlzLmhhc1NpemVFcnJvcigpKSByZXR1cm47XG4gICAgICB0aGlzLl9mb3JtRGF0YVRtcFBhdGggPSByZXN1bHQudG1wUGF0aDtcbiAgICAgIHRoaXMuX2Zvcm1EYXRhVG1wTGVuZ3RoID0gcmVzdWx0LnRvdGFsTGVuZ3RoO1xuICAgICAgZGVsZXRlIHRoaXMuX2Zvcm1EYXRhO1xuXG4gICAgICB0aGlzLnJlcXVlc3QoKTtcbiAgICAgIGRlYnVnKCclcyAlcycsIHRoaXMubWV0aG9kLCB0aGlzLnVybCk7XG4gICAgICB0aGlzLl9lbmQoKTtcbiAgICB9KS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgIGlmICh0aGlzLmhhc1NpemVFcnJvcigpKSByZXR1cm47XG4gICAgICBpZiAoZXJyb3IuY29kZSA9PT0gJ0VUT09MQVJHRScpIHtcbiAgICAgICAgdGhpcy5fYWJvcnRXaXRoU2l6ZUVycm9yKCdyZXF1ZXN0Jyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHRoaXMuY2FsbGJhY2soZXJyb3IpO1xuICAgIH0pO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRoaXMucmVxdWVzdCgpO1xuICBkZWJ1ZygnJXMgJXMnLCB0aGlzLm1ldGhvZCwgdGhpcy51cmwpO1xuXG4gIHRoaXMuX2VuZCgpO1xufTtcblxuLyoqXG4gKiBTcG9vbCBhIE5vZGUgRm9ybURhdGEgaW5zdGFuY2UgdG8gYSB0ZW1wb3JhcnkgZmlsZSBvbiBkaXNrIGZvciByZXBsYXkuXG4gKiBVc2luZyBkaXNrIHN0b3JhZ2UgYXZvaWRzIGluLW1lbW9yeSBkdXBsaWNhdGlvbiBhbmQgcmVtb3ZlcyBhbnkgc2l6ZSBjYXBcbiAqIGZvciByZXNwb25zZS1vbmx5IGxpbWl0cyAodGhlIGRpc2sgaG9sZHMgYXJiaXRyYXJ5LXNpemUgcGF5bG9hZHMpLlxuICogLSBJZiBtYXhSZXF1ZXN0U2l6ZSBpcyBjb25maWd1cmVkIGFuZCBleGNlZWRlZDogY2FsbGJhY2sgd2l0aCBFVE9PTEFSR0UgZXJyb3IuXG4gKiAtIE90aGVyd2lzZTogY2FsbGJhY2sgd2l0aCB7IHRtcFBhdGgsIHRvdGFsTGVuZ3RoIH0gZm9yIHRoZSBjYWxsZXIgdG8gcmVwbGF5LlxuICpcbiAqIEBwYXJhbSB7Rm9ybURhdGF9IGZvcm1EYXRhXG4gKiBAcGFyYW0ge051bWJlcn0gW21heFJlcXVlc3RTaXplXVxuICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2sgKGVyciwgeyB0bXBQYXRoLCB0b3RhbExlbmd0aCB9IHwgbnVsbClcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5jb25zdCBhY3RpdmVTcG9vbEZpbGVzID0gbmV3IFNldCgpO1xucHJvY2Vzcy5vbmNlKCdleGl0JywgKCkgPT4ge1xuICBjb25zdCBwYXRoTW9kID0gcmVxdWlyZSgncGF0aCcpO1xuICBmb3IgKGNvbnN0IGZpbGUgb2YgYWN0aXZlU3Bvb2xGaWxlcykge1xuICAgIHRyeSB7XG4gICAgICBmcy51bmxpbmtTeW5jKGZpbGUpO1xuICAgIH0gY2F0Y2ggKF8pIHtcbiAgICAgIC8vIGlnbm9yZVxuICAgIH1cbiAgICAvLyBBbHNvIHJlbW92ZSB0aGUgcGFyZW50IHByaXZhdGUgdGVtcCBkaXJlY3RvcnkgY3JlYXRlZCBieSBta2R0ZW1wXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRpciA9IHBhdGhNb2QuZGlybmFtZShmaWxlKTtcbiAgICAgIGlmIChkaXIgJiYgZGlyICE9PSByZXF1aXJlKCdvcycpLnRtcGRpcigpKSB7XG4gICAgICAgIGZzLnJtZGlyU3luYyhkaXIpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKF8pIHtcbiAgICAgIC8vIGlnbm9yZVxuICAgIH1cbiAgfVxufSk7XG5cbmZ1bmN0aW9uIHNwb29sRm9ybURhdGFUb0Rpc2soZm9ybURhdGEsIG1heFJlcXVlc3RTaXplLCBjYWxsYmFjaykge1xuICBjb25zdCBvcyA9IHJlcXVpcmUoJ29zJyk7XG4gIGNvbnN0IHBhdGhNb2QgPSByZXF1aXJlKCdwYXRoJyk7XG5cbiAgLy8gVXNlIGZzLm1rZHRlbXAgdG8gYXRvbWljYWxseSBjcmVhdGUgYSBwcml2YXRlIHRlbXBvcmFyeSBkaXJlY3RvcnksXG4gIC8vIHByZXZlbnRpbmcgc3ltbGluayByYWNlIGNvbmRpdGlvbnMgKENXRS0zNzcpLlxuICBjb25zdCBwcmVmaXggPSBwYXRoTW9kLmpvaW4ob3MudG1wZGlyKCksICdzYS1yZXBsYXktJyk7XG4gIGZzLm1rZHRlbXAocHJlZml4LCAobWtkdGVtcEVyciwgdG1wRGlyKSA9PiB7XG4gICAgaWYgKG1rZHRlbXBFcnIpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhta2R0ZW1wRXJyKTtcbiAgICB9XG5cbiAgICBjb25zdCB0bXBQYXRoID0gcGF0aE1vZC5qb2luKHRtcERpciwgJ2JvZHkudG1wJyk7XG4gICAgYWN0aXZlU3Bvb2xGaWxlcy5hZGQodG1wUGF0aCk7XG5cbiAgICBjb25zdCB3cyA9IGZzLmNyZWF0ZVdyaXRlU3RyZWFtKHRtcFBhdGgsIHsgZmxhZ3M6ICd3eCcsIG1vZGU6IDBvNjAwIH0pO1xuICAgIGxldCB0b3RhbExlbmd0aCA9IDA7XG4gICAgbGV0IGRvbmUgPSBmYWxzZTtcbiAgICBsZXQgbGltaXRFeGNlZWRlZCA9IGZhbHNlO1xuXG4gICAgY29uc3QgY2xlYW51cCA9ICgpID0+IHtcbiAgICAgIGFjdGl2ZVNwb29sRmlsZXMuZGVsZXRlKHRtcFBhdGgpO1xuICAgICAgdHJ5IHsgZnMudW5saW5rU3luYyh0bXBQYXRoKTsgfSBjYXRjaCAoXykgeyAvKiBpZ25vcmUgKi8gfVxuICAgICAgdHJ5IHsgZnMucm1kaXJTeW5jKHRtcERpcik7IH0gY2F0Y2ggKF8pIHsgLyogaWdub3JlICovIH1cbiAgICB9O1xuXG4gICAgY29uc3QgZmFpbCA9IChlcnIpID0+IHtcbiAgICAgIGlmIChkb25lKSByZXR1cm47XG4gICAgICBkb25lID0gdHJ1ZTtcbiAgICAgIHdzLmRlc3Ryb3koKTtcbiAgICAgIGNsZWFudXAoKTtcbiAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgfTtcblxuICAgIGZvcm1EYXRhLm9uKCdkYXRhJywgKGNodW5rKSA9PiB7XG4gICAgICBpZiAoZG9uZSB8fCBsaW1pdEV4Y2VlZGVkKSByZXR1cm47XG4gICAgICBjb25zdCBsZW4gPSBCdWZmZXIuaXNCdWZmZXIoY2h1bmspID8gY2h1bmsubGVuZ3RoIDogQnVmZmVyLmJ5dGVMZW5ndGgoY2h1bmspO1xuICAgICAgdG90YWxMZW5ndGggKz0gbGVuO1xuICAgICAgaWYgKG1heFJlcXVlc3RTaXplICE9PSB1bmRlZmluZWQgJiYgdG90YWxMZW5ndGggPiBtYXhSZXF1ZXN0U2l6ZSkge1xuICAgICAgICBsaW1pdEV4Y2VlZGVkID0gdHJ1ZTtcbiAgICAgICAgLy8gU3RvcCB0aGUgc3RyZWFtOyBmYWlsIHdpbGwgZmlyZSB2aWEgd3MgY2xvc2Ugb3IgZXhwbGljaXRseSBoZXJlXG4gICAgICAgIGlmICh0eXBlb2YgZm9ybURhdGEuZGVzdHJveSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIGZvcm1EYXRhLmRlc3Ryb3koKTtcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgZm9ybURhdGEucmVzdW1lID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgZm9ybURhdGEucmVzdW1lKCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdNYXhpbXVtIHJlcXVlc3Qgc2l6ZSByZWFjaGVkJyk7XG4gICAgICAgIGVyci5jb2RlID0gJ0VUT09MQVJHRSc7XG4gICAgICAgIGVyci5yZXRyaWVzID0gMDtcbiAgICAgICAgZmFpbChlcnIpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgZm9ybURhdGEub25jZSgnZXJyb3InLCBmYWlsKTtcbiAgICB3cy5vbmNlKCdlcnJvcicsIGZhaWwpO1xuXG4gICAgZm9ybURhdGEucGlwZSh3cyk7XG5cbiAgICB3cy5vbmNlKCdmaW5pc2gnLCAoKSA9PiB7XG4gICAgICBpZiAoZG9uZSB8fCBsaW1pdEV4Y2VlZGVkKSByZXR1cm47XG4gICAgICBkb25lID0gdHJ1ZTtcbiAgICAgIGNhbGxiYWNrKG51bGwsIHsgdG1wUGF0aCwgdG90YWxMZW5ndGggfSk7XG4gICAgfSk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBjbGVhbnVwU3Bvb2xQYXRoKGYpIHtcbiAgaWYgKCFmKSByZXR1cm47XG4gIGFjdGl2ZVNwb29sRmlsZXMuZGVsZXRlKGYpO1xuICBjb25zdCByZW1vdmUgPSAocmV0cmllcyA9IDMpID0+IHtcbiAgICBmcy51bmxpbmsoZiwgKGVycikgPT4ge1xuICAgICAgaWYgKGVyciAmJiAoZXJyLmNvZGUgPT09ICdFQlVTWScgfHwgZXJyLmNvZGUgPT09ICdFUEVSTScpICYmIHJldHJpZXMgPiAwKSB7XG4gICAgICAgIHNldFRpbWVvdXQoKCkgPT4gcmVtb3ZlKHJldHJpZXMgLSAxKSwgMjUpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVHJ5IHRvIHJlbW92ZSB0aGUgcGFyZW50IHByaXZhdGUgdGVtcCBkaXJlY3RvcnkgY3JlYXRlZCBieSBta2R0ZW1wXG4gICAgICAgIGNvbnN0IHBhdGhNb2QgPSByZXF1aXJlKCdwYXRoJyk7XG4gICAgICAgIGNvbnN0IGRpciA9IHBhdGhNb2QuZGlybmFtZShmKTtcbiAgICAgICAgaWYgKGRpciAmJiBkaXIgIT09IHJlcXVpcmUoJ29zJykudG1wZGlyKCkpIHtcbiAgICAgICAgICB0cnkgeyBmcy5ybWRpclN5bmMoZGlyKTsgfSBjYXRjaCAoXykgeyAvKiBpZ25vcmUgLSBkaXIgbWF5IHN0aWxsIGhhdmUgZmlsZXMgKi8gfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gIH07XG4gIHJlbW92ZSgpO1xufVxuXG4vKipcbiAqIERldGFjaCBhbmQgZGVzdHJveSBvbGQgc3Bvb2wgdXBsb2FkIHN0cmVhbSBhbmQgcHJvZ3Jlc3MgbW9uaXRvciBiZWZvcmUgYSByZXRyeSBvciByZWRpcmVjdC5cbiAqIFJldGFpbnMgdGhlIHNwb29sIGZpbGUgb24gZGlzayBmb3IgdGhlIG5leHQgYXR0ZW1wdCB3aGlsZSBwcmV2ZW50aW5nIHN0YWxlIGRhdGEgcmFjZXMuXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuUmVxdWVzdC5wcm90b3R5cGUuX2RldGFjaFNwb29sVXBsb2FkU3RyZWFtID0gZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5fc3Bvb2xQcm9ncmVzc01vbml0b3IpIHtcbiAgICB0aGlzLl9zcG9vbFByb2dyZXNzTW9uaXRvci5fZGV0YWNoZWQgPSB0cnVlO1xuICAgIHRyeSB7XG4gICAgICBpZiAodHlwZW9mIHRoaXMuX3Nwb29sUHJvZ3Jlc3NNb25pdG9yLnVucGlwZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICB0aGlzLl9zcG9vbFByb2dyZXNzTW9uaXRvci51bnBpcGUoKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChfKSB7XG4gICAgICAvLyBpZ25vcmVcbiAgICB9XG4gICAgdGhpcy5fc3Bvb2xQcm9ncmVzc01vbml0b3IgPSBudWxsO1xuICB9XG4gIGlmICh0aGlzLl9zcG9vbFJlYWRTdHJlYW0pIHtcbiAgICB0cnkge1xuICAgICAgaWYgKHR5cGVvZiB0aGlzLl9zcG9vbFJlYWRTdHJlYW0udW5waXBlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHRoaXMuX3Nwb29sUmVhZFN0cmVhbS51bnBpcGUoKTtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2YgdGhpcy5fc3Bvb2xSZWFkU3RyZWFtLmRlc3Ryb3kgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdGhpcy5fc3Bvb2xSZWFkU3RyZWFtLmRlc3Ryb3koKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChfKSB7XG4gICAgICAvLyBpZ25vcmVcbiAgICB9XG4gICAgdGhpcy5fc3Bvb2xSZWFkU3RyZWFtID0gbnVsbDtcbiAgfVxufTtcblxuLyoqXG4gKiBDbGVhbiB1cCB0aGUgdGVtcG9yYXJ5IHJlcGxheSBzcG9vbCBmaWxlIGlmIG9uZSB3YXMgY3JlYXRlZC5cbiAqIFNhZmUgdG8gY2FsbCBtdWx0aXBsZSB0aW1lcy5cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5SZXF1ZXN0LnByb3RvdHlwZS5fY2xlYW51cFNwb29sRmlsZSA9IGZ1bmN0aW9uICgpIHtcbiAgdGhpcy5fZGV0YWNoU3Bvb2xVcGxvYWRTdHJlYW0oKTtcbiAgaWYgKHRoaXMuX2Zvcm1EYXRhU3Bvb2xQcm9taXNlKSB7XG4gICAgY29uc3QgcCA9IHRoaXMuX2Zvcm1EYXRhU3Bvb2xQcm9taXNlO1xuICAgIHRoaXMuX2Zvcm1EYXRhU3Bvb2xQcm9taXNlID0gbnVsbDtcbiAgICBwLnRoZW4oKHJlc3VsdCkgPT4ge1xuICAgICAgaWYgKHJlc3VsdCAmJiByZXN1bHQudG1wUGF0aCkge1xuICAgICAgICBjbGVhbnVwU3Bvb2xQYXRoKHJlc3VsdC50bXBQYXRoKTtcbiAgICAgIH1cbiAgICB9KS5jYXRjaCgoKSA9PiB7fSk7XG4gIH1cbiAgaWYgKHRoaXMuX2Zvcm1EYXRhVG1wUGF0aCkge1xuICAgIGNvbnN0IGYgPSB0aGlzLl9mb3JtRGF0YVRtcFBhdGg7XG4gICAgdGhpcy5fZm9ybURhdGFUbXBQYXRoID0gbnVsbDtcbiAgICBjbGVhbnVwU3Bvb2xQYXRoKGYpO1xuICB9XG59O1xuXG5cblJlcXVlc3QucHJvdG90eXBlLl9lbmQgPSBmdW5jdGlvbiAoKSB7XG4gIHRoaXMuX2F0dGVtcHRHZW5lcmF0aW9uID0gKHRoaXMuX2F0dGVtcHRHZW5lcmF0aW9uIHx8IDApICsgMTtcbiAgY29uc3QgY3VycmVudEF0dGVtcHQgPSB0aGlzLl9hdHRlbXB0R2VuZXJhdGlvbjtcbiAgaWYgKHRoaXMuX2Fib3J0ZWQpXG4gICAgcmV0dXJuIHRoaXMuY2FsbGJhY2soXG4gICAgICB0aGlzLl9zaXplRXJyb3IgfHxcbiAgICAgICAgbmV3IEVycm9yKCdUaGUgcmVxdWVzdCBoYXMgYmVlbiBhYm9ydGVkIGV2ZW4gYmVmb3JlIC5lbmQoKSB3YXMgY2FsbGVkJylcbiAgICApO1xuXG4gIGxldCBkYXRhID0gdGhpcy5fZGF0YTtcbiAgY29uc3QgeyByZXEgfSA9IHRoaXM7XG4gIGNvbnN0IHsgbWV0aG9kIH0gPSB0aGlzO1xuXG4gIGlmIChtZXRob2QgPT09ICdHRVQnIHx8IG1ldGhvZCA9PT0gJ0hFQUQnKSB7XG4gICAgdGhpcy5fY2xlYW51cFNwb29sRmlsZSgpO1xuICAgIHRoaXMuX2Zvcm1EYXRhVG1wTGVuZ3RoID0gbnVsbDtcbiAgICBkZWxldGUgdGhpcy5fZm9ybURhdGFIZWFkZXJzO1xuICAgIHRoaXMuX2RhdGEgPSBudWxsO1xuICAgIGRlbGV0ZSB0aGlzLl9mb3JtRGF0YTtcbiAgICBkZWxldGUgdGhpcy5fZm9ybURhdGFTZXJpYWxpemVkO1xuICB9XG5cbiAgdGhpcy5fc2V0VGltZW91dHMoKTtcblxuICAvLyBib2R5XG4gIC8vIHNlcmlhbGl6ZSBzdHVmZlxuICBpZiAodHlwZW9mIGRhdGEgIT09ICdzdHJpbmcnICYmICFyZXEuX2hlYWRlclNlbnQpIHtcbiAgICBsZXQgY29udGVudFR5cGUgPSByZXEuZ2V0SGVhZGVyKCdDb250ZW50LVR5cGUnKTtcbiAgICAvLyBQYXJzZSBvdXQganVzdCB0aGUgY29udGVudCB0eXBlIGZyb20gdGhlIGhlYWRlciAoaWdub3JlIHRoZSBjaGFyc2V0KVxuICAgIGlmIChjb250ZW50VHlwZSkgY29udGVudFR5cGUgPSBjb250ZW50VHlwZS5zcGxpdCgnOycpWzBdO1xuICAgIGxldCBzZXJpYWxpemUgPSB0aGlzLl9zZXJpYWxpemVyIHx8IGV4cG9ydHMuc2VyaWFsaXplW2NvbnRlbnRUeXBlXTtcbiAgICBpZiAoIXNlcmlhbGl6ZSAmJiBpc0pTT04oY29udGVudFR5cGUpKSB7XG4gICAgICBzZXJpYWxpemUgPSBleHBvcnRzLnNlcmlhbGl6ZVsnYXBwbGljYXRpb24vanNvbiddO1xuICAgIH1cblxuICAgIGlmIChzZXJpYWxpemUpIGRhdGEgPSBzZXJpYWxpemUoZGF0YSk7XG4gIH1cblxuICBpZiAoIXRoaXMuX2Zvcm1EYXRhICYmIGRhdGEgIT09IHVuZGVmaW5lZCAmJiBkYXRhICE9PSBudWxsKSB7XG4gICAgY29uc3QgbGVuZ3RoID0gQnVmZmVyLmlzQnVmZmVyKGRhdGEpXG4gICAgICA/IGRhdGEubGVuZ3RoXG4gICAgICA6IHR5cGVvZiBkYXRhID09PSAnc3RyaW5nJ1xuICAgICAgICA/IEJ1ZmZlci5ieXRlTGVuZ3RoKGRhdGEpXG4gICAgICAgIDogQXJyYXlCdWZmZXIuaXNWaWV3KGRhdGEpXG4gICAgICAgICAgPyBkYXRhLmJ5dGVMZW5ndGhcbiAgICAgICAgICA6IGRhdGEgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlclxuICAgICAgICAgICAgPyBkYXRhLmJ5dGVMZW5ndGhcbiAgICAgICAgICAgIDogdW5kZWZpbmVkO1xuICAgIGlmIChsZW5ndGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoZGF0YSkpIHtcbiAgICAgICAgdGhpcy5fcmVxdWVzdEJ5dGVzU2VudCA9ICh0aGlzLl9yZXF1ZXN0Qnl0ZXNTZW50IHx8IDApICsgbGVuZ3RoO1xuICAgICAgICBpZiAoIXRoaXMuX2NoZWNrUmVxdWVzdFNpemUodGhpcy5fcmVxdWVzdEJ5dGVzU2VudCkpIHJldHVybjtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IHRvdGFsID0gKHRoaXMuX3JlcXVlc3RCeXRlc1NlbnQgfHwgMCkgKyBsZW5ndGg7XG4gICAgICAgIGlmICghdGhpcy5fY2hlY2tSZXF1ZXN0U2l6ZSh0b3RhbCkpIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBjb250ZW50LWxlbmd0aFxuICBpZiAobWV0aG9kICE9PSAnSEVBRCcgJiYgIXJlcS5faGVhZGVyU2VudCAmJiBkYXRhICYmICFyZXEuZ2V0SGVhZGVyKCdDb250ZW50LUxlbmd0aCcpKSB7XG4gICAgcmVxLnNldEhlYWRlcihcbiAgICAgICdDb250ZW50LUxlbmd0aCcsXG4gICAgICBCdWZmZXIuaXNCdWZmZXIoZGF0YSkgPyBkYXRhLmxlbmd0aCA6IEJ1ZmZlci5ieXRlTGVuZ3RoKGRhdGEpXG4gICAgKTtcbiAgfVxuXG4gIGNvbnN0IGV4cGxpY2l0Q2wgPSBwYXJzZUludCh0aGlzLmdldEhlYWRlcignQ29udGVudC1MZW5ndGgnKSB8fCAocmVxICYmIHJlcS5nZXRIZWFkZXIgJiYgcmVxLmdldEhlYWRlcignQ29udGVudC1MZW5ndGgnKSksIDEwKTtcbiAgaWYgKCFpc05hTihleHBsaWNpdENsKSAmJiB0aGlzLl9tYXhSZXF1ZXN0U2l6ZSAhPT0gdW5kZWZpbmVkICYmIGV4cGxpY2l0Q2wgPiB0aGlzLl9tYXhSZXF1ZXN0U2l6ZSkge1xuICAgIGlmICghdGhpcy5fY2hlY2tSZXF1ZXN0U2l6ZShleHBsaWNpdENsKSkgcmV0dXJuO1xuICB9XG5cbiAgLy8gVHJhY2sgdXBsb2FkIGNvbXBsZXRpb24gZm9yIEFMTCB1cGxvYWQgcGF0aHMgKG5vdCBqdXN0IHNwb29sZWQgbXVsdGlwYXJ0KS5cbiAgLy8gVGhpcyBlbnN1cmVzIHRoZSB1bmJ1ZmZlcmVkIHJlc3BvbnNlIGRlZmVycmFsIHdvcmtzIGZvciBwbGFpbiAuc2VuZCgpLCBCdWZmZXIsXG4gIC8vIHN0cmVhbSwgYW5kIG5vbi1zcG9vbGVkIEZvcm1EYXRhIHVwbG9hZHMg4oCUIG5vdCBqdXN0IGRpc2stc3Bvb2xlZCBtdWx0aXBhcnQuXG4gIGNvbnN0IG9uVXBsb2FkRmluaXNoZWQgPSAoKSA9PiB7XG4gICAgaWYgKHRoaXMuX3VwbG9hZENvbXBsZXRlKSByZXR1cm47XG4gICAgdGhpcy5fdXBsb2FkQ29tcGxldGUgPSB0cnVlO1xuXG4gICAgaWYgKHRoaXMuX3BlbmRpbmdVbmJ1ZmZlcmVkUmVzcG9uc2UpIHtcbiAgICAgIGlmICghdGhpcy5fcmVzRW5kZWQpIHtcbiAgICAgICAgLy8gRG8gTk9UIHNldHRsZSBfcGVuZGluZ1VuYnVmZmVyZWRSZXNwb25zZSBmcm9tIG9uVXBsb2FkRmluaXNoZWQgbWVyZWx5IGJlY2F1c2UgdXBsb2FkIGNvbXBsZXRlZC5cbiAgICAgICAgLy8gS2VlcCBpdCBwZW5kaW5nIHVudGlsIHJlc3BvbnNlIGhhcyBlbmRlZCB0byBwcmV2ZW50IHByZW1hdHVyZSBzZXR0bGVtZW50IGJlZm9yZVxuICAgICAgICAvLyBzaXplLWxpbWl0IHZhbGlkYXRpb24gb3IgdHJhbnNpZW50IHJldHJ5IGNvbmRpdGlvbnMgYXJlIGRldGVybWluZWQuXG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGlmICghdGhpcy5jYWxsZWQgJiYgIXRoaXMuaGFzU2l6ZUVycm9yKCkpIHtcbiAgICAgICAgY29uc3QgcGVuZGluZyA9IHRoaXMuX3BlbmRpbmdVbmJ1ZmZlcmVkUmVzcG9uc2U7XG4gICAgICAgIHRoaXMuX3BlbmRpbmdVbmJ1ZmZlcmVkUmVzcG9uc2UgPSBudWxsO1xuICAgICAgICB0aGlzLmNhbGxiYWNrKG51bGwsIHBlbmRpbmcpO1xuICAgICAgICBpZiAodHlwZW9mIHBlbmRpbmcuX2RyYWluUmVwbGF5ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgcGVuZGluZy5fZHJhaW5SZXBsYXkoKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICh0aGlzLl9wZW5kaW5nQnVmZmVyZWRSZXNwb25zZSAmJiAhdGhpcy5jYWxsZWQgJiYgIXRoaXMuaGFzU2l6ZUVycm9yKCkpIHtcbiAgICAgIGNvbnN0IHBlbmRpbmcgPSB0aGlzLl9wZW5kaW5nQnVmZmVyZWRSZXNwb25zZTtcbiAgICAgIHRoaXMuX3BlbmRpbmdCdWZmZXJlZFJlc3BvbnNlID0gbnVsbDtcbiAgICAgIHRoaXMuY2FsbGJhY2sobnVsbCwgcGVuZGluZyk7XG4gICAgfVxuICB9O1xuXG4gIHJlcS5vbmNlKCdmaW5pc2gnLCBvblVwbG9hZEZpbmlzaGVkKTtcblxuICAvLyBUcmFuc3BvcnQtYWdub3N0aWMgc3VwcG9ydDogb2JzZXJ2ZSBIVFRQLzIgZnJhbWUgb3IgY3VzdG9tIHN0cmVhbSB3cmFwcGVyc1xuICBjb25zdCBvYnNlcnZlRnJhbWUgPSAoZnJhbWUpID0+IHtcbiAgICBpZiAoIWZyYW1lKSByZXR1cm47XG4gICAgaWYgKGZyYW1lLndyaXRhYmxlRW5kZWQgfHwgZnJhbWUud3JpdGFibGVGaW5pc2hlZCB8fCBmcmFtZS5maW5pc2hlZCkge1xuICAgICAgcHJvY2Vzcy5uZXh0VGljayhvblVwbG9hZEZpbmlzaGVkKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZnJhbWUub25jZSgnZmluaXNoJywgb25VcGxvYWRGaW5pc2hlZCk7XG4gICAgfVxuICB9O1xuXG4gIGlmICh0eXBlb2YgcmVxLmdldEZyYW1lID09PSAnZnVuY3Rpb24nKSB7XG4gICAgaWYgKHJlcS5mcmFtZSkge1xuICAgICAgb2JzZXJ2ZUZyYW1lKHJlcS5mcmFtZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IG9yaWdHZXRGcmFtZSA9IHJlcS5nZXRGcmFtZS5iaW5kKHJlcSk7XG4gICAgICByZXEuZ2V0RnJhbWUgPSAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGZyYW1lID0gb3JpZ0dldEZyYW1lKCk7XG4gICAgICAgIG9ic2VydmVGcmFtZShmcmFtZSk7XG4gICAgICAgIHJldHVybiBmcmFtZTtcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLy8gcmVzcG9uc2VcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIGNvbXBsZXhpdHlcbiAgcmVxLm9uY2UoJ3Jlc3BvbnNlJywgKHJlcykgPT4ge1xuICAgIGRlYnVnKCclcyAlcyAtPiAlcycsIHRoaXMubWV0aG9kLCB0aGlzLnVybCwgcmVzLnN0YXR1c0NvZGUpO1xuXG4gICAgaWYgKHRoaXMuX3Jlc3BvbnNlVGltZW91dFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5fcmVzcG9uc2VUaW1lb3V0VGltZXIpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLnBpcGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgbWF4ID0gdGhpcy5fbWF4UmVkaXJlY3RzO1xuICAgIGNvbnN0IG1pbWUgPSB1dGlscy50eXBlKHJlcy5oZWFkZXJzWydjb250ZW50LXR5cGUnXSB8fCAnJykgfHwgJ3RleHQvcGxhaW4nO1xuICAgIGxldCB0eXBlID0gbWltZS5zcGxpdCgnLycpWzBdO1xuICAgIGlmICh0eXBlKSB0eXBlID0gdHlwZS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcbiAgICBjb25zdCBtdWx0aXBhcnQgPSB0eXBlID09PSAnbXVsdGlwYXJ0JztcbiAgICBjb25zdCByZWRpcmVjdCA9IGlzUmVkaXJlY3QocmVzLnN0YXR1c0NvZGUpO1xuICAgIGNvbnN0IHJlc3BvbnNlVHlwZSA9IHRoaXMuX3Jlc3BvbnNlVHlwZTtcblxuICAgIHRoaXMucmVzID0gcmVzO1xuXG4gICAgLy8gcmVkaXJlY3RcbiAgICBpZiAocmVkaXJlY3QgJiYgdGhpcy5fcmVkaXJlY3RzKysgIT09IG1heCkge1xuICAgICAgcmV0dXJuIHRoaXMuX3JlZGlyZWN0KHJlcyk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMubWV0aG9kID09PSAnSEVBRCcpIHtcbiAgICAgIHRoaXMuZW1pdCgnZW5kJyk7XG4gICAgICB0aGlzLmNhbGxiYWNrKG51bGwsIHRoaXMuX2VtaXRSZXNwb25zZSgpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyB6bGliIHN1cHBvcnRcbiAgICBpZiAodGhpcy5fc2hvdWxkRGVjb21wcmVzcyhyZXMpKSB7XG4gICAgICBkZWNvbXByZXNzKHJlcSwgcmVzKTtcbiAgICB9XG5cbiAgICBsZXQgYnVmZmVyID0gdGhpcy5fYnVmZmVyO1xuICAgIGlmIChidWZmZXIgPT09IHVuZGVmaW5lZCAmJiBtaW1lIGluIGV4cG9ydHMuYnVmZmVyKSB7XG4gICAgICBidWZmZXIgPSBCb29sZWFuKGV4cG9ydHMuYnVmZmVyW21pbWVdKTtcbiAgICB9XG5cbiAgICBsZXQgcGFyc2VyID0gdGhpcy5fcGFyc2VyO1xuICAgIGlmICh1bmRlZmluZWQgPT09IGJ1ZmZlciAmJiBwYXJzZXIpIHtcbiAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgXCJBIGN1c3RvbSBzdXBlcmFnZW50IHBhcnNlciBoYXMgYmVlbiBzZXQsIGJ1dCBidWZmZXJpbmcgc3RyYXRlZ3kgZm9yIHRoZSBwYXJzZXIgaGFzbid0IGJlZW4gY29uZmlndXJlZC4gQ2FsbCBgcmVxLmJ1ZmZlcih0cnVlIG9yIGZhbHNlKWAgb3Igc2V0IGBzdXBlcmFnZW50LmJ1ZmZlclttaW1lXSA9IHRydWUgb3IgZmFsc2VgXCJcbiAgICAgICk7XG4gICAgICBidWZmZXIgPSB0cnVlO1xuICAgIH1cblxuICAgIGlmICghcGFyc2VyKSB7XG4gICAgICBpZiAocmVzcG9uc2VUeXBlKSB7XG4gICAgICAgIHBhcnNlciA9IGV4cG9ydHMucGFyc2UuaW1hZ2U7IC8vIEl0J3MgYWN0dWFsbHkgYSBnZW5lcmljIEJ1ZmZlclxuICAgICAgICBidWZmZXIgPSB0cnVlO1xuICAgICAgfSBlbHNlIGlmIChtdWx0aXBhcnQpIHtcbiAgICAgICAgY29uc3QgZm9ybSA9IGZvcm1pZGFibGUuZm9ybWlkYWJsZSgpO1xuICAgICAgICBwYXJzZXIgPSAocmVzLCBjYWxsYmFjaykgPT4ge1xuICAgICAgICAgIC8vIENyZWF0ZSBhIFBhc3NUaHJvdWdoIHN0cmVhbSB0aGF0IGFjdHMgYXMgYSBwcm9wZXIgSFRUUCByZXF1ZXN0XG4gICAgICAgICAgY29uc3QgYnJpZGdlU3RyZWFtID0gbmV3IFN0cmVhbS5QYXNzVGhyb3VnaCgpO1xuXG4gICAgICAgICAgLy8gQWRkIEhUVFAgcmVxdWVzdCBwcm9wZXJ0aWVzIGZyb20gdGhlIGN1cnJlbnQgcmVxdWVzdCBjb250ZXh0XG4gICAgICAgICAgYnJpZGdlU3RyZWFtLm1ldGhvZCA9IHRoaXMubWV0aG9kIHx8ICdQT1NUJztcbiAgICAgICAgICBicmlkZ2VTdHJlYW0udXJsID0gdGhpcy51cmwgfHwgJy8nO1xuICAgICAgICAgIGJyaWRnZVN0cmVhbS5odHRwVmVyc2lvbiA9IHJlcy5odHRwVmVyc2lvbiB8fCAnMS4xJztcbiAgICAgICAgICBicmlkZ2VTdHJlYW0uaGVhZGVycyA9IHJlcy5oZWFkZXJzIHx8IHt9O1xuICAgICAgICAgIGJyaWRnZVN0cmVhbS5zb2NrZXQgPSByZXMuc29ja2V0IHx8IHsgcmVhZGFibGU6IHRydWUgfTtcblxuICAgICAgICAgIC8vIFBpcGUgdGhlIHJlc3BvbnNlIGRhdGEgdGhyb3VnaCB0aGUgYnJpZGdlIHN0cmVhbVxuICAgICAgICAgIHJlcy5waXBlKGJyaWRnZVN0cmVhbSk7XG5cbiAgICAgICAgICBmb3JtLnBhcnNlKGJyaWRnZVN0cmVhbSwgKGVyciwgZmllbGRzLCBmaWxlcykgPT4ge1xuICAgICAgICAgICAgaWYgKGVycikgcmV0dXJuIGNhbGxiYWNrKGVycik7XG5cbiAgICAgICAgICAgIC8vIEZvcm1pZGFibGUgdjMgYWx3YXlzIHJldHVybnMgYXJyYXlzLCBidXQgU3VwZXJBZ2VudCBleHBlY3RzIHNpbmdsZSB2YWx1ZXNcbiAgICAgICAgICAgIC8vIEZsYXR0ZW4gc2luZ2xlLWl0ZW0gYXJyYXlzIHRvIG1haW50YWluIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgICAgICAgIGNvbnN0IGZsYXR0ZW5lZEZpZWxkcyA9IHt9O1xuICAgICAgICAgICAgaWYgKGZpZWxkcykge1xuICAgICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBmaWVsZHMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB2YWx1ZSA9IGZpZWxkc1trZXldO1xuICAgICAgICAgICAgICAgIGZsYXR0ZW5lZEZpZWxkc1trZXldID0gQXJyYXkuaXNBcnJheSh2YWx1ZSkgJiYgdmFsdWUubGVuZ3RoID09PSAxID8gdmFsdWVbMF0gOiB2YWx1ZTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBmbGF0dGVuZWRGaWxlcyA9IHt9O1xuICAgICAgICAgICAgaWYgKGZpbGVzKSB7XG4gICAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIGZpbGVzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdmFsdWUgPSBmaWxlc1trZXldO1xuICAgICAgICAgICAgICAgIGZsYXR0ZW5lZEZpbGVzW2tleV0gPSBBcnJheS5pc0FycmF5KHZhbHVlKSAmJiB2YWx1ZS5sZW5ndGggPT09IDEgPyB2YWx1ZVswXSA6IHZhbHVlO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFJldHVybiBmbGF0dGVuZWQgZmllbGRzIGFzIHRoZSBvYmplY3QgcGFyYW1ldGVyIHRvIG1hdGNoIFN1cGVyQWdlbnQncyBleHBlY3RlZCBmb3JtYXRcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGZsYXR0ZW5lZEZpZWxkcywgZmxhdHRlbmVkRmlsZXMpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9O1xuICAgICAgICBidWZmZXIgPSB0cnVlO1xuICAgICAgfSBlbHNlIGlmIChpc0JpbmFyeShtaW1lKSkge1xuICAgICAgICBwYXJzZXIgPSBleHBvcnRzLnBhcnNlLmltYWdlO1xuICAgICAgICBidWZmZXIgPSB0cnVlOyAvLyBGb3IgYmFja3dhcmRzLWNvbXBhdGliaWxpdHkgYnVmZmVyaW5nIGRlZmF1bHQgaXMgYWQtaG9jIE1JTUUtZGVwZW5kZW50XG4gICAgICB9IGVsc2UgaWYgKGV4cG9ydHMucGFyc2VbbWltZV0pIHtcbiAgICAgICAgcGFyc2VyID0gZXhwb3J0cy5wYXJzZVttaW1lXTtcbiAgICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ3RleHQnKSB7XG4gICAgICAgIHBhcnNlciA9IGV4cG9ydHMucGFyc2UudGV4dDtcbiAgICAgICAgYnVmZmVyID0gYnVmZmVyICE9PSBmYWxzZTtcbiAgICAgICAgLy8gZXZlcnlvbmUgd2FudHMgdGhlaXIgb3duIHdoaXRlLWxhYmVsZWQganNvblxuICAgICAgfSBlbHNlIGlmIChpc0pTT04obWltZSkpIHtcbiAgICAgICAgcGFyc2VyID0gZXhwb3J0cy5wYXJzZVsnYXBwbGljYXRpb24vanNvbiddO1xuICAgICAgICBidWZmZXIgPSBidWZmZXIgIT09IGZhbHNlO1xuICAgICAgfSBlbHNlIGlmIChidWZmZXIpIHtcbiAgICAgICAgcGFyc2VyID0gZXhwb3J0cy5wYXJzZS50ZXh0O1xuICAgICAgfSBlbHNlIGlmICh1bmRlZmluZWQgPT09IGJ1ZmZlcikge1xuICAgICAgICBwYXJzZXIgPSBleHBvcnRzLnBhcnNlLmltYWdlOyAvLyBJdCdzIGFjdHVhbGx5IGEgZ2VuZXJpYyBCdWZmZXJcbiAgICAgICAgYnVmZmVyID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBieSBkZWZhdWx0IG9ubHkgYnVmZmVyIHRleHQvKiwganNvbiBhbmQgbWVzc2VkIHVwIHRoaW5nIGZyb20gaGVsbFxuICAgIGlmICgodW5kZWZpbmVkID09PSBidWZmZXIgJiYgaXNUZXh0KG1pbWUpKSB8fCBpc0pTT04obWltZSkpIHtcbiAgICAgIGJ1ZmZlciA9IHRydWU7XG4gICAgfVxuXG4gICAgdGhpcy5fcmVzQnVmZmVyZWQgPSBidWZmZXI7XG4gICAgbGV0IHBhcnNlckhhbmRsZXNFbmQgPSBmYWxzZTtcblxuICAgIGNvbnN0IG1heExpbWl0ID0gYnVmZmVyXG4gICAgICA/ICh0aGlzLl9tYXhSZXNwb25zZVNpemUgIT09IHVuZGVmaW5lZCA/IHRoaXMuX21heFJlc3BvbnNlU2l6ZSA6IDIwMDAwMDAwMClcbiAgICAgIDogdGhpcy5fbWF4UmVzcG9uc2VTaXplO1xuXG4gICAgLy8gUHJvdGVjdGlvbiBhZ2FpbnN0IHppcCBib21icyBhbmQgb3RoZXIgbnVpc2FuY2UgKGJ1ZmZlcmVkLCBvciB1bmJ1ZmZlcmVkIHdoZW4gbWF4UmVzcG9uc2VTaXplIGlzIHNldClcbiAgICAvLyBPbmx5IHByZWNoZWNrIENvbnRlbnQtTGVuZ3RoIHdoZW4gTk9UIGNvbXByZXNzaW5nL2RlY29tcHJlc3NpbmcgYW5kIHJlc3BvbnNlIGhhcyBib2R5IGNvbnRlbnQgKGUuZy4gbm90IDIwNCBvciAzMDQpLCBiZWNhdXNlXG4gICAgLy8gbWF4UmVzcG9uc2VTaXplIGNvdW50cyB1bmNvbXByZXNzZWQgYnl0ZXMgd2hpbGUgQ29udGVudC1MZW5ndGggcmVmbGVjdHMgY29tcHJlc3NlZCBieXRlcy5cbiAgICBpZiAobWF4TGltaXQgIT09IHVuZGVmaW5lZCAmJiB0aGlzLm1ldGhvZC50b1VwcGVyQ2FzZSgpICE9PSAnSEVBRCcgJiYgaGFzTm9uRW1wdHlSZXNwb25zZUNvbnRlbnQocmVzKSAmJiAhdGhpcy5fc2hvdWxkRGVjb21wcmVzcyhyZXMpKSB7XG4gICAgICBjb25zdCBjbEhlYWRlciA9IHJlcy5oZWFkZXJzWydjb250ZW50LWxlbmd0aCddO1xuICAgICAgaWYgKGNsSGVhZGVyKSB7XG4gICAgICAgIGNvbnN0IGNsID0gcGFyc2VJbnQoY2xIZWFkZXIsIDEwKTtcbiAgICAgICAgaWYgKCFpc05hTihjbCkgJiYgY2wgPiBtYXhMaW1pdCkge1xuICAgICAgICAgIHBhcnNlckhhbmRsZXNFbmQgPSBmYWxzZTtcbiAgICAgICAgICBjb25zdCBlcnJvciA9IHRoaXMuX2Fib3J0V2l0aFNpemVFcnJvcigncmVzcG9uc2UnKTtcbiAgICAgICAgICBpZiAodHlwZW9mIHJlcy5kZXN0cm95ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICByZXMuZGVzdHJveShlcnJvcik7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChtYXhMaW1pdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBsZXQgcmVzcG9uc2VCeXRlc0xlZnQgPSBtYXhMaW1pdDtcbiAgICAgIGNvbnN0IG9uRGF0YUNodW5rID0gKGNodW5rKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLmhhc1NpemVFcnJvcigpKSByZXR1cm47XG5cbiAgICAgICAgY29uc3QgbGVuID0gQnVmZmVyLmlzQnVmZmVyKGNodW5rKVxuICAgICAgICAgID8gY2h1bmsubGVuZ3RoXG4gICAgICAgICAgOiB0eXBlb2YgY2h1bmsgPT09ICdzdHJpbmcnXG4gICAgICAgICAgICA/IEJ1ZmZlci5ieXRlTGVuZ3RoKGNodW5rKVxuICAgICAgICAgICAgOiBjaHVuay5ieXRlTGVuZ3RoIHx8IDA7XG5cbiAgICAgICAgcmVzcG9uc2VCeXRlc0xlZnQgLT0gbGVuO1xuICAgICAgICBpZiAocmVzcG9uc2VCeXRlc0xlZnQgPCAwKSB7XG4gICAgICAgICAgcGFyc2VySGFuZGxlc0VuZCA9IGZhbHNlO1xuICAgICAgICAgIGNvbnN0IGVycm9yID0gdGhpcy5fYWJvcnRXaXRoU2l6ZUVycm9yKCdyZXNwb25zZScpO1xuICAgICAgICAgIGlmICh0eXBlb2YgcmVzLmRlc3Ryb3kgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIHJlcy5kZXN0cm95KGVycm9yKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGlmICh0aGlzLl9zaG91bGREZWNvbXByZXNzKHJlcykpIHtcbiAgICAgICAgcmVzLl9vbkRlY29tcHJlc3NDaHVuayA9IG9uRGF0YUNodW5rO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3Qgb3JpZ1B1c2ggPSByZXMucHVzaDtcbiAgICAgICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgICAgIHJlcy5wdXNoID0gZnVuY3Rpb24gKGNodW5rKSB7XG4gICAgICAgICAgaWYgKGNodW5rICYmICFzZWxmLmhhc1NpemVFcnJvcigpKSB7XG4gICAgICAgICAgICBvbkRhdGFDaHVuayhjaHVuayk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBvcmlnUHVzaC5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChwYXJzZXIpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIFVuYnVmZmVyZWQgcGFyc2VycyBhcmUgc3VwcG9zZWQgdG8gZW1pdCByZXNwb25zZSBlYXJseSxcbiAgICAgICAgLy8gd2hpY2ggaXMgd2VpcmQgQlRXLCBiZWNhdXNlIHJlc3BvbnNlLmJvZHkgd29uJ3QgYmUgdGhlcmUuXG4gICAgICAgIHBhcnNlckhhbmRsZXNFbmQgPSBidWZmZXI7XG5cbiAgICAgICAgcGFyc2VyKHJlcywgKGVycm9yLCBvYmplY3QsIGZpbGVzKSA9PiB7XG4gICAgICAgICAgaWYgKHRoaXMudGltZWRvdXQgfHwgdGhpcy5oYXNTaXplRXJyb3IoKSkge1xuICAgICAgICAgICAgLy8gVGltZW91dCBoYXMgYWxyZWFkeSBoYW5kbGVkIGFsbCBjYWxsYmFja3NcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBJbnRlbnRpb25hbCAobm9uLXRpbWVvdXQpIGFib3J0IGlzIHN1cHBvc2VkIHRvIHByZXNlcnZlIHBhcnRpYWwgcmVzcG9uc2UsXG4gICAgICAgICAgLy8gZXZlbiBpZiBpdCBkb2Vzbid0IHBhcnNlLlxuICAgICAgICAgIGlmIChlcnJvciAmJiAhdGhpcy5fYWJvcnRlZCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChwYXJzZXJIYW5kbGVzRW5kKSB7XG4gICAgICAgICAgICB0aGlzLmVtaXQoJ2VuZCcpO1xuICAgICAgICAgICAgY29uc3QgdXBsb2FkQ29tcGxldGUgPSB0aGlzLl9tYXhSZXF1ZXN0U2l6ZSA9PT0gdW5kZWZpbmVkIHx8IHRoaXMuX2lzVXBsb2FkRG9uZSgpO1xuICAgICAgICAgICAgaWYgKCF1cGxvYWRDb21wbGV0ZSkge1xuICAgICAgICAgICAgICB0aGlzLl9wZW5kaW5nQnVmZmVyZWRSZXNwb25zZSA9IHRoaXMuX2VtaXRSZXNwb25zZShvYmplY3QsIGZpbGVzKTtcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5jYWxsYmFjayhudWxsLCB0aGlzLl9lbWl0UmVzcG9uc2Uob2JqZWN0LCBmaWxlcykpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgdGhpcy5jYWxsYmFjayhlcnIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5yZXMgPSByZXM7XG5cbiAgICAvLyB1bmJ1ZmZlcmVkXG4gICAgaWYgKCFidWZmZXIpIHtcbiAgICAgIGRlYnVnKCd1bmJ1ZmZlcmVkICVzICVzJywgdGhpcy5tZXRob2QsIHRoaXMudXJsKTtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gdGhpcy5fZW1pdFJlc3BvbnNlKCk7XG5cbiAgICAgIC8vIHRlcm1pbmF0aW5nIGV2ZW50czogcmVnaXN0ZXIgZXJyb3IgaGFuZGxlciBmb3IgdW5idWZmZXJlZCBtb2RlXG4gICAgICByZXMub25jZSgnZXJyb3InLCAoZXJyb3IpID0+IHtcbiAgICAgICAgcGFyc2VySGFuZGxlc0VuZCA9IGZhbHNlO1xuICAgICAgICBpZiAodGhpcy5fYXR0ZW1wdEdlbmVyYXRpb24gIT09IGN1cnJlbnRBdHRlbXB0KSByZXR1cm47XG4gICAgICAgIGlmICh0aGlzLmhhc1NpemVFcnJvcigpKSByZXR1cm47XG4gICAgICAgIGlmIChyZXMuc3RhdHVzQ29kZSA9PT0gMjA0ICYmIChlcnJvci5tZXNzYWdlID09PSAnYWJvcnRlZCcgfHwgZXJyb3IuY29kZSA9PT0gJ0VDT05OUkVTRVQnKSkge1xuICAgICAgICAgIHJldHVybiB0aGlzLmNhbGxiYWNrKG51bGwsIHJlc3BvbnNlKTtcbiAgICAgICAgfVxuICAgICAgICByZXMub24oJ2Vycm9yJywgKCkgPT4ge30pO1xuICAgICAgICB0aGlzLmNhbGxiYWNrKGVycm9yLCBudWxsKTtcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBoYXNSZXNwb25zZUxpbWl0ID0gdGhpcy5fbWF4UmVzcG9uc2VTaXplICE9PSB1bmRlZmluZWQ7XG4gICAgICBjb25zdCB1cGxvYWRQZW5kaW5nID0gKHRoaXMuX21heFJlcXVlc3RTaXplICE9PSB1bmRlZmluZWQgfHwgdGhpcy5tZXRob2QgIT09ICdHRVQnKSAmJiAhdGhpcy5faXNVcGxvYWREb25lKCk7XG4gICAgICBjb25zdCBoYXNSZXRyaWVzID0gQm9vbGVhbih0aGlzLl9tYXhSZXRyaWVzICYmIHRoaXMuX3JldHJpZXMgPCB0aGlzLl9tYXhSZXRyaWVzKTtcbiAgICAgIGNvbnN0IGhhc011bHRpcGFydFNwb29sID0gQm9vbGVhbih0aGlzLl9mb3JtRGF0YVRtcFBhdGggfHwgdGhpcy5fZm9ybURhdGEpO1xuICAgICAgY29uc3Qgc2hvdWxkRGVmZXJDYWxsYmFjayA9IGhhc1Jlc3BvbnNlTGltaXQgfHwgdXBsb2FkUGVuZGluZyB8fCAoaGFzUmV0cmllcyAmJiBoYXNNdWx0aXBhcnRTcG9vbCk7XG5cbiAgICAgIGlmIChzaG91bGREZWZlckNhbGxiYWNrKSB7XG4gICAgICAgIHRoaXMuX3BlbmRpbmdVbmJ1ZmZlcmVkUmVzcG9uc2UgPSByZXNwb25zZTtcblxuICAgICAgICBsZXQgcmVzcG9uc2VFbmRlZCA9IGZhbHNlO1xuICAgICAgICBsZXQgZW5kRW1pdHRlZCA9IGZhbHNlO1xuICAgICAgICBjb25zdCBxdWV1ZWRDaHVua3MgPSBbXTtcbiAgICAgICAgbGV0IHF1ZXVlZEJ5dGVzID0gMDtcbiAgICAgICAgbGV0IHJlcGxheUJ5dGVzID0gMDtcbiAgICAgICAgY29uc3QgTUFYX1VOQlVGRkVSRURfUkVQTEFZX0JZVEVTID0gMjU2ICogMTAyNDsgLy8gQm91bmRlZCBpbi1tZW1vcnkgcmVwbGF5IHdpbmRvdyBmb3IgdW5idWZmZXJlZCByZXNwb25zZXNcblxuICAgICAgICBjb25zdCBjbGVhbnVwID0gKCkgPT4ge1xuICAgICAgICAgIHF1ZXVlZENodW5rcy5sZW5ndGggPSAwO1xuICAgICAgICAgIHJlc3BvbnNlLnJlbW92ZUxpc3RlbmVyKCduZXdMaXN0ZW5lcicsIG9uTmV3TGlzdGVuZXIpO1xuICAgICAgICAgIHJlcy5yZW1vdmVMaXN0ZW5lcignZGF0YScsIG9uUmVzRGF0YSk7XG4gICAgICAgICAgcmVzLnJlbW92ZUxpc3RlbmVyKCdlbmQnLCBvblJlc0VuZCk7XG4gICAgICAgICAgZGVsZXRlIHJlc3BvbnNlLl9kcmFpblJlcGxheTtcbiAgICAgICAgICBkZWxldGUgcmVzcG9uc2UuX2NsZWFudXBSZXBsYXk7XG4gICAgICAgIH07XG4gICAgICAgIHJlc3BvbnNlLl9jbGVhbnVwUmVwbGF5ID0gY2xlYW51cDtcblxuICAgICAgICBjb25zdCBzZXR0bGVDYWxsYmFjayA9ICgpID0+IHtcbiAgICAgICAgICBpZiAodGhpcy5fYXR0ZW1wdEdlbmVyYXRpb24gIT09IGN1cnJlbnRBdHRlbXB0KSByZXR1cm47XG4gICAgICAgICAgaWYgKCF0aGlzLmNhbGxlZCAmJiAhdGhpcy5oYXNTaXplRXJyb3IoKSkge1xuICAgICAgICAgICAgdGhpcy5fcGVuZGluZ1VuYnVmZmVyZWRSZXNwb25zZSA9IG51bGw7XG4gICAgICAgICAgICB0aGlzLmNhbGxiYWNrKG51bGwsIHJlc3BvbnNlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgZHJhaW4gPSAoKSA9PiB7XG4gICAgICAgICAgaWYgKHRoaXMuX2F0dGVtcHRHZW5lcmF0aW9uICE9PSBjdXJyZW50QXR0ZW1wdCkgcmV0dXJuO1xuICAgICAgICAgIHdoaWxlIChxdWV1ZWRDaHVua3MubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgY29uc3QgY2h1bmsgPSBxdWV1ZWRDaHVua3Muc2hpZnQoKTtcbiAgICAgICAgICAgIHJlc3BvbnNlLmVtaXQoJ2RhdGEnLCBjaHVuayk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChyZXNwb25zZUVuZGVkICYmICFlbmRFbWl0dGVkICYmIHJlc3BvbnNlLmxpc3RlbmVycygnZW5kJykubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgZW5kRW1pdHRlZCA9IHRydWU7XG4gICAgICAgICAgICBwcm9jZXNzLm5leHRUaWNrKCgpID0+IHtcbiAgICAgICAgICAgICAgaWYgKHRoaXMuX2F0dGVtcHRHZW5lcmF0aW9uID09PSBjdXJyZW50QXR0ZW1wdCkge1xuICAgICAgICAgICAgICAgIHJlc3BvbnNlLmVtaXQoJ2VuZCcpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICAgIHJlc3BvbnNlLl9kcmFpblJlcGxheSA9IGRyYWluO1xuXG4gICAgICAgIGNvbnN0IG9uUmVzRGF0YSA9IChjaHVuaykgPT4ge1xuICAgICAgICAgIGlmICghY2h1bmspIHJldHVybjtcbiAgICAgICAgICBpZiAodGhpcy5fYXR0ZW1wdEdlbmVyYXRpb24gIT09IGN1cnJlbnRBdHRlbXB0KSB7XG4gICAgICAgICAgICByZXMucmVtb3ZlTGlzdGVuZXIoJ2RhdGEnLCBvblJlc0RhdGEpO1xuICAgICAgICAgICAgcmVzLnJlbW92ZUxpc3RlbmVyKCdlbmQnLCBvblJlc0VuZCk7XG4gICAgICAgICAgICBpZiAodHlwZW9mIHJlcy5kZXN0cm95ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICAgIHJlcy5kZXN0cm95KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjbGVhbnVwKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIHF1ZXVlZEJ5dGVzICs9IGNodW5rLmxlbmd0aDtcbiAgICAgICAgICBpZiAoaGFzUmVzcG9uc2VMaW1pdCAmJiBxdWV1ZWRCeXRlcyA+IHRoaXMuX21heFJlc3BvbnNlU2l6ZSkge1xuICAgICAgICAgICAgdGhpcy5fYWJvcnRXaXRoU2l6ZUVycm9yKCdyZXNwb25zZScpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAocmVzcG9uc2UubGlzdGVuZXJzKCdkYXRhJykubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgaWYgKHF1ZXVlZENodW5rcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgIGRyYWluKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBOb3RlOiBSZXNwb25zZSAoc3JjL25vZGUvcmVzcG9uc2UuanM6NDQpIGFscmVhZHkgcGVybWFuZW50bHkgZm9yd2FyZHNcbiAgICAgICAgICAgIC8vIHJlcy5vbignZGF0YScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdkYXRhJykpLiBEbyBub3QgZHVwbGljYXRlIGVtaXNzaW9uIVxuICAgICAgICAgIH0gZWxzZSBpZiAocmVwbGF5Qnl0ZXMgKyBjaHVuay5sZW5ndGggPD0gTUFYX1VOQlVGRkVSRURfUkVQTEFZX0JZVEVTKSB7XG4gICAgICAgICAgICBxdWV1ZWRDaHVua3MucHVzaChjaHVuayk7XG4gICAgICAgICAgICByZXBsYXlCeXRlcyArPSBjaHVuay5sZW5ndGg7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIFJlYWNoZWQgYm91bmRlZCByZXBsYXkgbGltaXQ6IHRyYW5zaXRpb24gdG8gbGl2ZSBzdHJlYW1pbmcgdmlhIGNhbGxiYWNrIHNldHRsZSBhbmQgZHJhaW5cbiAgICAgICAgICAgIHF1ZXVlZENodW5rcy5wdXNoKGNodW5rKTtcbiAgICAgICAgICAgIHNldHRsZUNhbGxiYWNrKCk7XG4gICAgICAgICAgICBpZiAodGhpcy5fYXR0ZW1wdEdlbmVyYXRpb24gIT09IGN1cnJlbnRBdHRlbXB0KSByZXR1cm47XG4gICAgICAgICAgICBkcmFpbigpO1xuICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBvblJlc0VuZCA9ICgpID0+IHtcbiAgICAgICAgICBpZiAodGhpcy5fYXR0ZW1wdEdlbmVyYXRpb24gIT09IGN1cnJlbnRBdHRlbXB0KSByZXR1cm47XG4gICAgICAgICAgcmVzcG9uc2VFbmRlZCA9IHRydWU7XG4gICAgICAgICAgaWYgKHJlc3BvbnNlLmxpc3RlbmVycygnZW5kJykubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgZW5kRW1pdHRlZCA9IHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IG9uTmV3TGlzdGVuZXIgPSAoZXZlbnQpID0+IHtcbiAgICAgICAgICBpZiAodGhpcy5fYXR0ZW1wdEdlbmVyYXRpb24gIT09IGN1cnJlbnRBdHRlbXB0KSByZXR1cm47XG4gICAgICAgICAgaWYgKGV2ZW50ID09PSAnZGF0YScpIHtcbiAgICAgICAgICAgIHNldHRsZUNhbGxiYWNrKCk7XG4gICAgICAgICAgICBpZiAocXVldWVkQ2h1bmtzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgcHJvY2Vzcy5uZXh0VGljayhkcmFpbik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIGlmIChldmVudCA9PT0gJ2VuZCcgJiYgcmVzcG9uc2VFbmRlZCAmJiAhZW5kRW1pdHRlZCkge1xuICAgICAgICAgICAgZW5kRW1pdHRlZCA9IHRydWU7XG4gICAgICAgICAgICBwcm9jZXNzLm5leHRUaWNrKCgpID0+IHtcbiAgICAgICAgICAgICAgaWYgKHRoaXMuX2F0dGVtcHRHZW5lcmF0aW9uID09PSBjdXJyZW50QXR0ZW1wdCkge1xuICAgICAgICAgICAgICAgIHJlc3BvbnNlLmVtaXQoJ2VuZCcpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgcmVzLm9uKCdkYXRhJywgb25SZXNEYXRhKTtcbiAgICAgICAgcmVzLm9uY2UoJ2VuZCcsIG9uUmVzRW5kKTtcbiAgICAgICAgcmVzcG9uc2Uub24oJ25ld0xpc3RlbmVyJywgb25OZXdMaXN0ZW5lcik7XG5cbiAgICAgICAgcmVzLm9uY2UoJ2Vycm9yJywgY2xlYW51cCk7XG4gICAgICAgIHRoaXMub25jZSgnYWJvcnQnLCBjbGVhbnVwKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuY2FsbGJhY2sobnVsbCwgcmVzcG9uc2UpO1xuICAgICAgfVxuXG4gICAgICByZXMub25jZSgnZW5kJywgKCkgPT4ge1xuICAgICAgICBpZiAodGhpcy5fYXR0ZW1wdEdlbmVyYXRpb24gIT09IGN1cnJlbnRBdHRlbXB0KSByZXR1cm47XG4gICAgICAgIGRlYnVnKCdlbmQgJXMgJXMnLCB0aGlzLm1ldGhvZCwgdGhpcy51cmwpO1xuICAgICAgICBpZiAoIW11bHRpcGFydCkgdGhpcy5lbWl0KCdlbmQnKTtcblxuICAgICAgICBpZiAodGhpcy5oYXNTaXplRXJyb3IoKSkgcmV0dXJuO1xuXG4gICAgICAgIHRoaXMuX3Jlc0VuZGVkID0gdHJ1ZTtcbiAgICAgICAgY29uc3QgdXBsb2FkQ29tcGxldGUgPSB0aGlzLl9tYXhSZXF1ZXN0U2l6ZSA9PT0gdW5kZWZpbmVkIHx8IHRoaXMuX2lzVXBsb2FkRG9uZSgpO1xuICAgICAgICBpZiAoIXVwbG9hZENvbXBsZXRlKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMuX3BlbmRpbmdVbmJ1ZmZlcmVkUmVzcG9uc2UgJiYgIXRoaXMuY2FsbGVkKSB7XG4gICAgICAgICAgY29uc3QgcGVuZGluZyA9IHRoaXMuX3BlbmRpbmdVbmJ1ZmZlcmVkUmVzcG9uc2U7XG4gICAgICAgICAgdGhpcy5fcGVuZGluZ1VuYnVmZmVyZWRSZXNwb25zZSA9IG51bGw7XG4gICAgICAgICAgdGhpcy5jYWxsYmFjayhudWxsLCBwZW5kaW5nKTtcbiAgICAgICAgICBpZiAodHlwZW9mIHBlbmRpbmcuX2RyYWluUmVwbGF5ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICBwZW5kaW5nLl9kcmFpblJlcGxheSgpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gdGVybWluYXRpbmcgZXZlbnRzXG4gICAgcmVzLm9uY2UoJ2Vycm9yJywgKGVycm9yKSA9PiB7XG4gICAgICBwYXJzZXJIYW5kbGVzRW5kID0gZmFsc2U7XG4gICAgICBpZiAodGhpcy5fYXR0ZW1wdEdlbmVyYXRpb24gIT09IGN1cnJlbnRBdHRlbXB0KSByZXR1cm47XG4gICAgICBpZiAodGhpcy5oYXNTaXplRXJyb3IoKSkgcmV0dXJuO1xuICAgICAgaWYgKHJlcy5zdGF0dXNDb2RlID09PSAyMDQgJiYgKGVycm9yLm1lc3NhZ2UgPT09ICdhYm9ydGVkJyB8fCBlcnJvci5jb2RlID09PSAnRUNPTk5SRVNFVCcpKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmNhbGxiYWNrKG51bGwsIHRoaXMuX2VtaXRSZXNwb25zZSgpKTtcbiAgICAgIH1cbiAgICAgIHJlcy5vbignZXJyb3InLCAoKSA9PiB7fSk7XG4gICAgICB0aGlzLmNhbGxiYWNrKGVycm9yLCBudWxsKTtcbiAgICB9KTtcblxuICAgIGlmICghcGFyc2VySGFuZGxlc0VuZClcbiAgICAgIHJlcy5vbmNlKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLl9hdHRlbXB0R2VuZXJhdGlvbiAhPT0gY3VycmVudEF0dGVtcHQpIHJldHVybjtcbiAgICAgICAgZGVidWcoJ2VuZCAlcyAlcycsIHRoaXMubWV0aG9kLCB0aGlzLnVybCk7XG4gICAgICAgIC8vIFRPRE86IHVubGVzcyBidWZmZXJpbmcgZW1pdCBlYXJsaWVyIHRvIHN0cmVhbVxuICAgICAgICB0aGlzLmVtaXQoJ2VuZCcpO1xuICAgICAgICBpZiAoIXRoaXMuaGFzU2l6ZUVycm9yKCkpIHtcbiAgICAgICAgICBjb25zdCB1cGxvYWRDb21wbGV0ZSA9IHRoaXMuX21heFJlcXVlc3RTaXplID09PSB1bmRlZmluZWQgfHwgdGhpcy5faXNVcGxvYWREb25lKCk7XG4gICAgICAgICAgaWYgKCF1cGxvYWRDb21wbGV0ZSkge1xuICAgICAgICAgICAgdGhpcy5fcGVuZGluZ0J1ZmZlcmVkUmVzcG9uc2UgPSB0aGlzLl9lbWl0UmVzcG9uc2UoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5jYWxsYmFjayhudWxsLCB0aGlzLl9lbWl0UmVzcG9uc2UoKSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9KTtcblxuICB0aGlzLmVtaXQoJ3JlcXVlc3QnLCB0aGlzKTtcblxuICBjb25zdCBnZXRQcm9ncmVzc01vbml0b3IgPSAoKSA9PiB7XG4gICAgY29uc3QgbGVuZ3RoQ29tcHV0YWJsZSA9IHRydWU7XG4gICAgY29uc3QgdG90YWwgPSByZXEuZ2V0SGVhZGVyKCdDb250ZW50LUxlbmd0aCcpO1xuICAgIGxldCBsb2FkZWQgPSAwO1xuXG4gICAgY29uc3QgcHJvZ3Jlc3MgPSBuZXcgU3RyZWFtLlRyYW5zZm9ybSgpO1xuICAgIHByb2dyZXNzLl90cmFuc2Zvcm0gPSAoY2h1bmssIGVuY29kaW5nLCBjYWxsYmFjaykgPT4ge1xuICAgICAgaWYgKHByb2dyZXNzLl9kZXRhY2hlZCkge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2soKTtcbiAgICAgIH1cbiAgICAgIGxvYWRlZCArPSBjaHVuay5sZW5ndGg7XG4gICAgICB0aGlzLl9yZXF1ZXN0Qnl0ZXNTZW50ID0gKHRoaXMuX3JlcXVlc3RCeXRlc1NlbnQgfHwgMCkgKyBjaHVuay5sZW5ndGg7XG4gICAgICBpZiAoIXRoaXMuX2NoZWNrUmVxdWVzdFNpemUodGhpcy5fcmVxdWVzdEJ5dGVzU2VudCkpIHtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKHRoaXMuX3NpemVFcnJvcik7XG4gICAgICB9XG4gICAgICB0aGlzLmVtaXQoJ3Byb2dyZXNzJywge1xuICAgICAgICBkaXJlY3Rpb246ICd1cGxvYWQnLFxuICAgICAgICBsZW5ndGhDb21wdXRhYmxlLFxuICAgICAgICBsb2FkZWQsXG4gICAgICAgIHRvdGFsXG4gICAgICB9KTtcbiAgICAgIGNhbGxiYWNrKG51bGwsIGNodW5rKTtcbiAgICB9O1xuXG4gICAgcHJvZ3Jlc3Mub25jZSgnZmluaXNoJywgb25VcGxvYWRGaW5pc2hlZCk7XG5cbiAgICBwcm9ncmVzcy5vbignZXJyb3InLCAoZXJyb3IpID0+IHtcbiAgICAgIGlmICghdGhpcy5oYXNTaXplRXJyb3IoKSkgdGhpcy5jYWxsYmFjayhlcnJvcik7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gcHJvZ3Jlc3M7XG4gIH07XG5cbiAgY29uc3QgYnVmZmVyVG9DaHVua3MgPSAoYnVmZmVyKSA9PiB7XG4gICAgY29uc3QgY2h1bmtTaXplID0gMTYgKiAxMDI0OyAvLyBkZWZhdWx0IGhpZ2hXYXRlck1hcmsgdmFsdWVcbiAgICBjb25zdCBjaHVua2luZyA9IG5ldyBTdHJlYW0uUmVhZGFibGUoKTtcbiAgICBjb25zdCB0b3RhbExlbmd0aCA9IGJ1ZmZlci5sZW5ndGg7XG4gICAgY29uc3QgcmVtYWluZGVyID0gdG90YWxMZW5ndGggJSBjaHVua1NpemU7XG4gICAgY29uc3QgY3V0b2ZmID0gdG90YWxMZW5ndGggLSByZW1haW5kZXI7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGN1dG9mZjsgaSArPSBjaHVua1NpemUpIHtcbiAgICAgIGNvbnN0IGNodW5rID0gYnVmZmVyLnNsaWNlKGksIGkgKyBjaHVua1NpemUpO1xuICAgICAgY2h1bmtpbmcucHVzaChjaHVuayk7XG4gICAgfVxuXG4gICAgaWYgKHJlbWFpbmRlciA+IDApIHtcbiAgICAgIGNvbnN0IHJlbWFpbmRlckJ1ZmZlciA9IGJ1ZmZlci5zbGljZSgtcmVtYWluZGVyKTtcbiAgICAgIGNodW5raW5nLnB1c2gocmVtYWluZGVyQnVmZmVyKTtcbiAgICB9XG5cbiAgICBjaHVua2luZy5wdXNoKG51bGwpOyAvLyBubyBtb3JlIGRhdGFcblxuICAgIHJldHVybiBjaHVua2luZztcbiAgfTtcblxuICAvLyBJZiBhIGRpc2stc3Bvb2xlZCBtdWx0aXBhcnQgcGF5bG9hZCB3YXMgYWxyZWFkeSBwcmVzZXJ2ZWQgKGUuZy4gZm9yIHJldHJ5KSwgcmVwbGF5IGl0LlxuICBpZiAodGhpcy5tZXRob2QgIT09ICdHRVQnICYmIHRoaXMubWV0aG9kICE9PSAnSEVBRCcgJiYgdGhpcy5fZm9ybURhdGFUbXBQYXRoKSB7XG4gICAgY29uc3QgaGVhZGVycyA9IHRoaXMuX2Zvcm1EYXRhSGVhZGVycyB8fCB7fTtcbiAgICBmb3IgKGNvbnN0IGkgaW4gaGVhZGVycykge1xuICAgICAgaWYgKGhhc093bihoZWFkZXJzLCBpKSkge1xuICAgICAgICByZXEuc2V0SGVhZGVyKGksIGhlYWRlcnNbaV0pO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCB0bXBMZW5ndGggPSB0aGlzLl9mb3JtRGF0YVRtcExlbmd0aCB8fCAwO1xuICAgIHJlcS5zZXRIZWFkZXIoJ0NvbnRlbnQtTGVuZ3RoJywgdG1wTGVuZ3RoKTtcbiAgICBpZiAoIXRoaXMuX2NoZWNrUmVxdWVzdFNpemUodG1wTGVuZ3RoKSkge1xuICAgICAgdGhpcy5fY2xlYW51cFNwb29sRmlsZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHByb2dyZXNzTW9uaXRvciA9IGdldFByb2dyZXNzTW9uaXRvcigpO1xuICAgIGNvbnN0IHN0cmVhbSA9IGZzLmNyZWF0ZVJlYWRTdHJlYW0odGhpcy5fZm9ybURhdGFUbXBQYXRoKTtcbiAgICB0aGlzLl9zcG9vbFJlYWRTdHJlYW0gPSBzdHJlYW07XG4gICAgdGhpcy5fc3Bvb2xQcm9ncmVzc01vbml0b3IgPSBwcm9ncmVzc01vbml0b3I7XG4gICAgc3RyZWFtLnBpcGUocHJvZ3Jlc3NNb25pdG9yKS5waXBlKHJlcSk7XG4gIH0gZWxzZSBpZiAodGhpcy5tZXRob2QgIT09ICdHRVQnICYmIHRoaXMubWV0aG9kICE9PSAnSEVBRCcgJiYgdGhpcy5fZm9ybURhdGEpIHtcbiAgICBjb25zdCBmb3JtRGF0YSA9IHRoaXMuX2Zvcm1EYXRhO1xuICAgIC8vIHNldCBoZWFkZXJzXG4gICAgY29uc3QgaGVhZGVycyA9IGZvcm1EYXRhLmdldEhlYWRlcnMoKTtcbiAgICB0aGlzLl9mb3JtRGF0YUhlYWRlcnMgPSBoZWFkZXJzO1xuICAgIGZvciAoY29uc3QgaSBpbiBoZWFkZXJzKSB7XG4gICAgICBpZiAoaGFzT3duKGhlYWRlcnMsIGkpKSB7XG4gICAgICAgIGRlYnVnKCdzZXR0aW5nIEZvcm1EYXRhIGhlYWRlcjogXCIlczogJXNcIicsIGksIGhlYWRlcnNbaV0pO1xuICAgICAgICByZXEuc2V0SGVhZGVyKGksIGhlYWRlcnNbaV0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFNwb29sIHRoZSBtdWx0aXBhcnQgcGF5bG9hZCB3aGVuZXZlciByZXRyaWVzLCByZWRpcmVjdHMsIG9yIHRyYW5zZmVyIHNpemUgbGltaXRzIGFyZSBjb25maWd1cmVkLlxuICAgIGNvbnN0IGNhblJlZGlyZWN0ID0gdGhpcy5fbWF4UmVkaXJlY3RzID09PSB1bmRlZmluZWQgfHwgdGhpcy5fbWF4UmVkaXJlY3RzID4gMDtcbiAgICBjb25zdCBjYW5SZXRyeSA9IEJvb2xlYW4odGhpcy5fbWF4UmV0cmllcyAmJiB0aGlzLl9tYXhSZXRyaWVzID4gMCk7XG4gICAgY29uc3QgaGFzU2l6ZUxpbWl0ID0gdGhpcy5fbWF4UmVxdWVzdFNpemUgIT09IHVuZGVmaW5lZCB8fCB0aGlzLl9tYXhSZXNwb25zZVNpemUgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBuZWVkc011bHRpcGFydFJlcGxheSA9IGNhblJldHJ5IHx8IGNhblJlZGlyZWN0IHx8IGhhc1NpemVMaW1pdDtcblxuICAgIGlmIChuZWVkc011bHRpcGFydFJlcGxheSkge1xuICAgICAgaWYgKCF0aGlzLl9mb3JtRGF0YVNwb29sUHJvbWlzZSkge1xuICAgICAgICB0aGlzLl9mb3JtRGF0YVNwb29sUHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICBzcG9vbEZvcm1EYXRhVG9EaXNrKGZvcm1EYXRhLCB0aGlzLl9tYXhSZXF1ZXN0U2l6ZSwgKGVycm9yLCByZXN1bHQpID0+IHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIHJlamVjdChlcnJvcik7XG4gICAgICAgICAgICByZXNvbHZlKHJlc3VsdCk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICB0aGlzLl9mb3JtRGF0YVNwb29sUHJvbWlzZS50aGVuKChyZXN1bHQpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuX2Fib3J0ZWQgfHwgdGhpcy5oYXNTaXplRXJyb3IoKSB8fCAhdGhpcy5fZm9ybURhdGFTcG9vbFByb21pc2UpIHtcbiAgICAgICAgICBpZiAocmVzdWx0ICYmIHJlc3VsdC50bXBQYXRoKSB7XG4gICAgICAgICAgICBjbGVhbnVwU3Bvb2xQYXRoKHJlc3VsdC50bXBQYXRoKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHsgdG1wUGF0aCwgdG90YWxMZW5ndGggfSA9IHJlc3VsdDtcbiAgICAgICAgdGhpcy5fZm9ybURhdGFUbXBQYXRoID0gdG1wUGF0aDsgLy8gdXNlZCBmb3IgcmVwbGF5IG9uIHJldHJ5XG4gICAgICAgIHRoaXMuX2Zvcm1EYXRhVG1wTGVuZ3RoID0gdG90YWxMZW5ndGg7XG4gICAgICAgIGRlbGV0ZSB0aGlzLl9mb3JtRGF0YTtcblxuICAgICAgICByZXEuc2V0SGVhZGVyKCdDb250ZW50LUxlbmd0aCcsIHRvdGFsTGVuZ3RoKTtcbiAgICAgICAgaWYgKCF0aGlzLl9jaGVja1JlcXVlc3RTaXplKHRvdGFsTGVuZ3RoKSkge1xuICAgICAgICAgIHRoaXMuX2NsZWFudXBTcG9vbEZpbGUoKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBwcm9ncmVzc01vbml0b3IgPSBnZXRQcm9ncmVzc01vbml0b3IoKTtcbiAgICAgICAgY29uc3Qgc3RyZWFtID0gZnMuY3JlYXRlUmVhZFN0cmVhbSh0bXBQYXRoKTtcbiAgICAgICAgdGhpcy5fc3Bvb2xSZWFkU3RyZWFtID0gc3RyZWFtO1xuICAgICAgICB0aGlzLl9zcG9vbFByb2dyZXNzTW9uaXRvciA9IHByb2dyZXNzTW9uaXRvcjtcbiAgICAgICAgc3RyZWFtLnBpcGUocHJvZ3Jlc3NNb25pdG9yKS5waXBlKHJlcSk7XG4gICAgICB9KS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuaGFzU2l6ZUVycm9yKCkpIHJldHVybjtcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgPT09ICdFVE9PTEFSR0UnKSB7XG4gICAgICAgICAgdGhpcy5fYWJvcnRXaXRoU2l6ZUVycm9yKCdyZXF1ZXN0Jyk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmNhbGxiYWNrKGVycm9yKTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBTdHJlYW1pbmcgdXBsb2FkIHBhdGggKHByZXNlcnZlcyBzdHJlYW1pbmcsIGJvdW5kcyBtZW1vcnksIG5vIGJ1ZmZlcmluZylcbiAgICAgIGZvcm1EYXRhLmdldExlbmd0aCgoZXJyb3IsIGxlbmd0aCkgPT4ge1xuICAgICAgICBpZiAoZXJyb3IpIGRlYnVnKCdmb3JtRGF0YS5nZXRMZW5ndGggaGFkIGVycm9yJywgZXJyb3IsIGxlbmd0aCk7XG5cbiAgICAgICAgZGVidWcoJ2dvdCBGb3JtRGF0YSBDb250ZW50LUxlbmd0aDogJXMnLCBsZW5ndGgpO1xuICAgICAgICBpZiAodHlwZW9mIGxlbmd0aCA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICByZXEuc2V0SGVhZGVyKCdDb250ZW50LUxlbmd0aCcsIGxlbmd0aCk7XG4gICAgICAgICAgaWYgKHRoaXMuX21heFJlcXVlc3RTaXplICE9PSB1bmRlZmluZWQgJiYgIXRoaXMuX2NoZWNrUmVxdWVzdFNpemUobGVuZ3RoKSkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGZvcm1EYXRhLnBpcGUoZ2V0UHJvZ3Jlc3NNb25pdG9yKCkpLnBpcGUocmVxKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfSBlbHNlIGlmIChCdWZmZXIuaXNCdWZmZXIoZGF0YSkpIHtcbiAgICBidWZmZXJUb0NodW5rcyhkYXRhKS5waXBlKGdldFByb2dyZXNzTW9uaXRvcigpKS5waXBlKHJlcSk7XG4gIH0gZWxzZSB7XG4gICAgcmVxLmVuZChkYXRhKTtcbiAgfVxufTtcblxuLy8gQ2hlY2sgd2hldGhlciByZXNwb25zZSBoYXMgYSBub24tMC1zaXplZCBnemlwLWVuY29kZWQgYm9keVxuUmVxdWVzdC5wcm90b3R5cGUuX3Nob3VsZERlY29tcHJlc3MgPSAocmVzKSA9PiB7XG4gIHJldHVybiBoYXNOb25FbXB0eVJlc3BvbnNlQ29udGVudChyZXMpICYmIChpc0d6aXBPckRlZmxhdGVFbmNvZGluZyhyZXMpIHx8IGlzQnJvdGxpRW5jb2RpbmcocmVzKSk7XG59O1xuXG5cbi8qKlxuICogT3ZlcnJpZGVzIEROUyBmb3Igc2VsZWN0ZWQgaG9zdG5hbWVzLiBUYWtlcyBvYmplY3QgbWFwcGluZyBob3N0bmFtZXMgdG8gSVAgYWRkcmVzc2VzLlxuICpcbiAqIFdoZW4gbWFraW5nIGEgcmVxdWVzdCB0byBhIFVSTCB3aXRoIGEgaG9zdG5hbWUgZXhhY3RseSBtYXRjaGluZyBhIGtleSBpbiB0aGUgb2JqZWN0LFxuICogdXNlIHRoZSBnaXZlbiBJUCBhZGRyZXNzIHRvIGNvbm5lY3QsIGluc3RlYWQgb2YgdXNpbmcgRE5TIHRvIHJlc29sdmUgdGhlIGhvc3RuYW1lLlxuICpcbiAqIEEgc3BlY2lhbCBob3N0IGAqYCBtYXRjaGVzIGV2ZXJ5IGhvc3RuYW1lIChrZWVwIHJlZGlyZWN0cyBpbiBtaW5kISlcbiAqXG4gKiAgICAgIHJlcXVlc3QuY29ubmVjdCh7XG4gKiAgICAgICAgJ3Rlc3QuZXhhbXBsZS5jb20nOiAnMTI3LjAuMC4xJyxcbiAqICAgICAgICAnaXB2Ni5leGFtcGxlLmNvbSc6ICc6OjEnLFxuICogICAgICB9KVxuICovXG5SZXF1ZXN0LnByb3RvdHlwZS5jb25uZWN0ID0gZnVuY3Rpb24gKGNvbm5lY3RPdmVycmlkZSkge1xuICBpZiAodHlwZW9mIGNvbm5lY3RPdmVycmlkZSA9PT0gJ3N0cmluZycpIHtcbiAgICB0aGlzLl9jb25uZWN0T3ZlcnJpZGUgPSB7ICcqJzogY29ubmVjdE92ZXJyaWRlIH07XG4gIH0gZWxzZSBpZiAodHlwZW9mIGNvbm5lY3RPdmVycmlkZSA9PT0gJ29iamVjdCcpIHtcbiAgICB0aGlzLl9jb25uZWN0T3ZlcnJpZGUgPSBjb25uZWN0T3ZlcnJpZGU7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5fY29ubmVjdE92ZXJyaWRlID0gdW5kZWZpbmVkO1xuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5SZXF1ZXN0LnByb3RvdHlwZS50cnVzdExvY2FsaG9zdCA9IGZ1bmN0aW9uICh0b2dnbGUpIHtcbiAgdGhpcy5fdHJ1c3RMb2NhbGhvc3QgPSB0b2dnbGUgPT09IHVuZGVmaW5lZCA/IHRydWUgOiB0b2dnbGU7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLy8gZ2VuZXJhdGUgSFRUUCB2ZXJiIG1ldGhvZHNcbmlmICghbWV0aG9kcy5pbmNsdWRlcygnZGVsJykpIHtcbiAgLy8gY3JlYXRlIGEgY29weSBzbyB3ZSBkb24ndCBjYXVzZSBjb25mbGljdHMgd2l0aFxuICAvLyBvdGhlciBwYWNrYWdlcyB1c2luZyB0aGUgbWV0aG9kcyBwYWNrYWdlIGFuZFxuICAvLyBucG0gMy54XG4gIG1ldGhvZHMgPSBbLi4ubWV0aG9kc107XG4gIG1ldGhvZHMucHVzaCgnZGVsJyk7XG59XG5cbmZvciAobGV0IG1ldGhvZCBvZiBtZXRob2RzKSB7XG4gIGNvbnN0IG5hbWUgPSBtZXRob2Q7XG4gIG1ldGhvZCA9IG1ldGhvZCA9PT0gJ2RlbCcgPyAnZGVsZXRlJyA6IG1ldGhvZDtcblxuICBtZXRob2QgPSBtZXRob2QudG9VcHBlckNhc2UoKTtcbiAgcmVxdWVzdFtuYW1lXSA9ICh1cmwsIGRhdGEsIGZuKSA9PiB7XG4gICAgY29uc3QgcmVxdWVzdF8gPSByZXF1ZXN0KG1ldGhvZCwgdXJsKTtcbiAgICBpZiAodHlwZW9mIGRhdGEgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGZuID0gZGF0YTtcbiAgICAgIGRhdGEgPSBudWxsO1xuICAgIH1cblxuICAgIGlmIChkYXRhKSB7XG4gICAgICBpZiAobWV0aG9kID09PSAnR0VUJyB8fCBtZXRob2QgPT09ICdIRUFEJykge1xuICAgICAgICByZXF1ZXN0Xy5xdWVyeShkYXRhKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlcXVlc3RfLnNlbmQoZGF0YSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGZuKSByZXF1ZXN0Xy5lbmQoZm4pO1xuICAgIHJldHVybiByZXF1ZXN0XztcbiAgfTtcbn1cblxuLyoqXG4gKiBDaGVjayBpZiBgbWltZWAgaXMgdGV4dCBhbmQgc2hvdWxkIGJlIGJ1ZmZlcmVkLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBtaW1lXG4gKiBAcmV0dXJuIHtCb29sZWFufVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBpc1RleHQobWltZSkge1xuICBjb25zdCBwYXJ0cyA9IG1pbWUuc3BsaXQoJy8nKTtcbiAgbGV0IHR5cGUgPSBwYXJ0c1swXTtcbiAgaWYgKHR5cGUpIHR5cGUgPSB0eXBlLnRvTG93ZXJDYXNlKCkudHJpbSgpO1xuICBsZXQgc3VidHlwZSA9IHBhcnRzWzFdO1xuICBpZiAoc3VidHlwZSkgc3VidHlwZSA9IHN1YnR5cGUudG9Mb3dlckNhc2UoKS50cmltKCk7XG5cbiAgcmV0dXJuIHR5cGUgPT09ICd0ZXh0JyB8fCBzdWJ0eXBlID09PSAneC13d3ctZm9ybS11cmxlbmNvZGVkJztcbn1cblxuLy8gVGhpcyBpcyBub3QgYSBjYXRjaGFsbCwgYnV0IGEgc3RhcnQuIEl0IG1pZ2h0IGJlIHVzZWZ1bFxuLy8gaW4gdGhlIGxvbmcgcnVuIHRvIGhhdmUgZmlsZSB0aGF0IGluY2x1ZGVzIGFsbCBiaW5hcnlcbi8vIGNvbnRlbnQgdHlwZXMgZnJvbSBodHRwczovL3d3dy5pYW5hLm9yZy9hc3NpZ25tZW50cy9tZWRpYS10eXBlcy9tZWRpYS10eXBlcy54aHRtbFxuZnVuY3Rpb24gaXNCaW5hcnkobWltZSkge1xuICBsZXQgW3JlZ2lzdHJ5LCBuYW1lXSA9IG1pbWUuc3BsaXQoJy8nKTtcbiAgaWYgKHJlZ2lzdHJ5KSByZWdpc3RyeSA9IHJlZ2lzdHJ5LnRvTG93ZXJDYXNlKCkudHJpbSgpO1xuICBpZiAobmFtZSkgbmFtZSA9IG5hbWUudG9Mb3dlckNhc2UoKS50cmltKCk7XG4gIHJldHVybiAoXG4gICAgWydhdWRpbycsICdmb250JywgJ2ltYWdlJywgJ3ZpZGVvJ10uaW5jbHVkZXMocmVnaXN0cnkpIHx8XG4gICAgWydneicsICdnemlwJ10uaW5jbHVkZXMobmFtZSlcbiAgKTtcbn1cblxuLyoqXG4gKiBDaGVjayBpZiBgbWltZWAgaXMganNvbiBvciBoYXMgK2pzb24gc3RydWN0dXJlZCBzeW50YXggc3VmZml4LlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBtaW1lXG4gKiBAcmV0dXJuIHtCb29sZWFufVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gaXNKU09OKG1pbWUpIHtcbiAgLy8gc2hvdWxkIG1hdGNoIC9qc29uIG9yICtqc29uXG4gIC8vIGJ1dCBub3QgL2pzb24tc2VxXG4gIHJldHVybiAvWy8rXWpzb24oJHxbXi1cXHddKS9pLnRlc3QobWltZSk7XG59XG5cbi8qKlxuICogQ2hlY2sgaWYgd2Ugc2hvdWxkIGZvbGxvdyB0aGUgcmVkaXJlY3QgYGNvZGVgLlxuICpcbiAqIEBwYXJhbSB7TnVtYmVyfSBjb2RlXG4gKiBAcmV0dXJuIHtCb29sZWFufVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gaXNSZWRpcmVjdChjb2RlKSB7XG4gIHJldHVybiBbMzAxLCAzMDIsIDMwMywgMzA1LCAzMDcsIDMwOF0uaW5jbHVkZXMoY29kZSk7XG59XG5cbmZ1bmN0aW9uIGhhc05vbkVtcHR5UmVzcG9uc2VDb250ZW50KHJlcykge1xuICBpZiAocmVzLnN0YXR1c0NvZGUgPT09IDIwNCB8fCByZXMuc3RhdHVzQ29kZSA9PT0gMzA0KSB7XG4gICAgLy8gVGhlc2UgYXJlbid0IHN1cHBvc2VkIHRvIGhhdmUgYW55IGJvZHlcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvLyBoZWFkZXIgY29udGVudCBpcyBhIHN0cmluZywgYW5kIGRpc3RpbmN0aW9uIGJldHdlZW4gMCBhbmQgbm8gaW5mb3JtYXRpb24gaXMgY3J1Y2lhbFxuICBpZiAocmVzLmhlYWRlcnNbJ2NvbnRlbnQtbGVuZ3RoJ10gPT09ICcwJykge1xuICAgIC8vIFdlIGtub3cgdGhhdCB0aGUgYm9keSBpcyBlbXB0eSAodW5mb3J0dW5hdGVseSwgdGhpcyBjaGVjayBkb2VzIG5vdCBjb3ZlciBjaHVua2VkIGVuY29kaW5nKVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufVxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNO0VBQUVBO0FBQU8sQ0FBQyxHQUFHQyxPQUFPLENBQUMsS0FBSyxDQUFDO0FBQ2pDLE1BQU1DLE1BQU0sR0FBR0QsT0FBTyxDQUFDLFFBQVEsQ0FBQztBQUNoQyxNQUFNRSxLQUFLLEdBQUdGLE9BQU8sQ0FBQyxPQUFPLENBQUM7QUFDOUIsTUFBTUcsSUFBSSxHQUFHSCxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU1JLEVBQUUsR0FBR0osT0FBTyxDQUFDLElBQUksQ0FBQztBQUN4QixNQUFNSyxJQUFJLEdBQUdMLE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDNUIsTUFBTU0sRUFBRSxHQUFHTixPQUFPLENBQUMsSUFBSSxDQUFDO0FBQ3hCLE1BQU1PLElBQUksR0FBR1AsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixJQUFJUSxPQUFPLEdBQUdSLE9BQU8sQ0FBQyxTQUFTLENBQUM7QUFDaEMsTUFBTVMsUUFBUSxHQUFHVCxPQUFPLENBQUMsV0FBVyxDQUFDO0FBQ3JDLE1BQU1VLFVBQVUsR0FBR1YsT0FBTyxDQUFDLFlBQVksQ0FBQztBQUN4QyxNQUFNVyxLQUFLLEdBQUdYLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxZQUFZLENBQUM7QUFDNUMsTUFBTVksU0FBUyxHQUFHWixPQUFPLENBQUMsV0FBVyxDQUFDO0FBQ3RDLE1BQU1hLGFBQWEsR0FBR2IsT0FBTyxDQUFDLHFCQUFxQixDQUFDO0FBRXBELE1BQU1jLEtBQUssR0FBR2QsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUNqQyxNQUFNZSxXQUFXLEdBQUdmLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQztBQUM5QyxNQUFNZ0IsS0FBSyxHQUFHaEIsT0FBTyxDQUFDLGdCQUFnQixDQUFDO0FBQ3ZDLE1BQU07RUFBRWlCO0FBQVcsQ0FBQyxH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QUM7RUFDdEIsSUFBSUMsT0FBTyxFQUFFQSxPQUFPLEdBQUdBLE9BQU8sQ0FBQzFQLFdBQVcsQ0FBQyxDQUFDLENBQUNnTCxJQUFJLENBQUMsQ0FBQztFQUVuRCxPQUFPMVAsSUFBSSxLQUFLLE1BQU0sSUFBSW9VLE9BQU8sS0FBSyx1QkFBdUI7QUFDL0Q7O0FBRUE7QUFDQTtBQUNBO0FBQ0EsU0FBU3RELFFBQVFBLENBQUN0VyxJQUFJLEVBQUU7RUFDdEIsSUFBSSxDQUFDNlosUUFBUSxFQUFFSixJQUFJLENBQUMsR0FBR3paLElBQUksQ0FBQzZNLEtBQUssQ0FBQyxHQUFHLENBQUM7RUFDdEMsSUFBSWdOLFFBQVEsRUFBRUEsUUFBUSxHQUFHQSxRQUFRLENBQUMzUCxXQUFXLENBQUMsQ0FBQyxDQUFDZ0wsSUFBSSxDQUFDLENBQUM7RUFDdEQsSUFBSXVFLElBQUksRUFBRUEsSUFBSSxHQUFHQSxJQUFJLENBQUN2UCxXQUFXLENBQUMsQ0FBQyxDQUFDZ0wsSUFBSSxDQUFDLENBQUM7RUFDMUMsT0FDRSxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLE9BQU8sQ0FBQyxDQUFDeFAsUUFBUSxDQUFDbVUsUUFBUSxDQUFDLElBQ3RELENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDblUsUUFBUSxDQUFDK1QsSUFBSSxDQUFDO0FBRWpDOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLFNBQVNuRixNQUFNQSxDQUFDdFUsSUFBSSxFQUFFO0VBQ3BCO0VBQ0E7RUFDQSxPQUFPLHFCQUFxQixDQUFDNE0sSUFBSSxDQUFDNU0sSUFBSSxDQUFDO0FBQ3pDOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLFNBQVN1SCxVQUFVQSxDQUFDa0IsSUFBSSxFQUFFO0VBQ3hCLE9BQU8sQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDL0MsUUFBUSxDQUFDK0MsSUFBSSxDQUFDO0FBQ3REO0FBRUEsU0FBU1gsMEJBQTBCQSxDQUFDUixHQUFHLEVBQUU7RUFDdkMsSUFBSUEsR0FBRyxDQUFDRSxVQUFVLEtBQUssR0FBRyxJQUFJRixHQUFHLENBQUNFLFVBQVUsS0FBSyxHQUFHLEVBQUU7SUFDcEQ7SUFDQSxPQUFPLEtBQUs7RUFDZDs7RUFFQTtFQUNBLElBQUlGLEdBQUcsQ0FBQ1csT0FBTyxDQUFDLGdCQUFnQixDQUFDLEtBQUssR0FBRyxFQUFFO0lBQ3pDO0lBQ0EsT0FBTyxLQUFLO0VBQ2Q7RUFFQSxPQUFPLElBQUk7QUFDYiIsImlnbm9yZUxpc3QiOltdfQ==
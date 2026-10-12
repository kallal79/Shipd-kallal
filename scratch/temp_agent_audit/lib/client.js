"use strict";

/**
 * Root reference for iframes.
 */

let root;
if (typeof window !== 'undefined') {
  // Browser window
  root = window;
} else if (typeof self === 'undefined') {
  // Other environments
  console.warn('Using browser-only version of superagent in non-browser environment');
  root = void 0;
} else {
  // Web Worker
  root = self;
}
const Emitter = require('component-emitter');
const safeStringify = require('fast-safe-stringify');
const qs = require('qs');
const RequestBase = require('./request-base');
const {
  isObject,
  mixin,
  hasOwn,
  byteLength
} = require('./utils');
const ResponseBase = require('./response-base');
const Agent = require('./agent-base');

/**
 * Noop.
 */

function noop() {}

/**
 * Expose `request`.
 */

module.exports = function (method, url) {
  // callback
  if (typeof url === 'function') {
    return new exports.Request('GET', method).end(url);
  }

  // url first
  if (arguments.length === 1) {
    return new exports.Request('GET', method);
  }
  return new exports.Request(method, url);
};
exports = module.exports;
const request = exports;
exports.Request = Request;

/**
 * Determine XHR.
 */

request.getXHR = () => {
  if (root.XMLHttpRequest) {
    return new root.XMLHttpRequest();
  }
  throw new Error('Browser-only version of superagent could not find XHR');
};

/**
 * Removes leading and trailing whitespace, added to support IE.
 *
 * @param {String} s
 * @return {String}
 * @api private
 */

const trim = ''.trim ? s => s.trim() : s => s.replace(/(^\s*|\s*$)/g, '');

/**
 * Serialize the given `obj`.
 *
 * @param {Object} obj
 * @return {String}
 * @api private
 */

function serialize(object) {
  if (!isObject(object)) return object;
  const pairs = [];
  for (const key in object) {
    if (hasOwn(object, key)) pushEncodedKeyValuePair(pairs, key, object[key]);
  }
  return pairs.join('&');
}

/**
 * Helps 'serialize' with serializing arrays.
 * Mutates the pairs array.
 *
 * @param {Array} pairs
 * @param {String} key
 * @param {Mixed} val
 */

function pushEncodedKeyValuePair(pairs, key, value) {
  if (value === undefined) return;
  if (value === null) {
    pairs.push(encodeURI(key));
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      pushEncodedKeyValuePair(pairs, key, v);
    }
  } else if (isObject(value)) {
    for (const subkey in value) {
      if (hasOwn(value, subkey)) pushEncodedKeyValuePair(pairs, `${key}[${subkey}]`, value[subkey]);
    }
  } else {
    pairs.push(encodeURI(key) + '=' + encodeURIComponent(value));
  }
}

/**
 * Expose serialization method.
 */

request.serializeObject = serialize;

/**
 * Parse the given x-www-form-urlencoded `str`.
 *
 * @param {String} str
 * @return {Object}
 * @api private
 */

function parseString(string_) {
  const object = {};
  const pairs = string_.split('&');
  let pair;
  let pos;
  for (let i = 0, length_ = pairs.length; i < length_; ++i) {
    pair = pairs[i];
    pos = pair.indexOf('=');
    if (pos === -1) {
      object[decodeURIComponent(pair)] = '';
    } else {
      object[decodeURIComponent(pair.slice(0, pos))] = decodeURIComponent(pair.slice(pos + 1));
    }
  }
  return object;
}

/**
 * Expose parser.
 */

request.parseString = parseString;

/**
 * Default MIME type map.
 *
 *     superagent.types.xml = 'application/xml';
 *
 */

request.types = {
  html: 'text/html',
  json: 'application/json',
  xml: 'text/xml',
  urlencoded: 'application/x-www-form-urlencoded',
  form: 'application/x-www-form-urlencoded',
  'form-data': 'application/x-www-form-urlencoded'
};

/**
 * Default serialization map.
 *
 *     superagent.serialize['application/xml'] = function(obj){
 *       return 'generated xml here';
 *     };
 *
 */

request.serialize = {
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
 *     superagent.parse['application/xml'] = function(str){
 *       return { object parsed from str };
 *     };
 *
 */

request.parse = {
  'application/x-www-form-urlencoded': parseString,
  'application/json': JSON.parse
};

/**
 * Parse the given header `str` into
 * an object containing the mapped fields.
 *
 * @param {String} str
 * @return {Object}
 * @api private
 */

function parseHeader(string_) {
  const lines = string_.split(/\r?\n/);
  const fields = {};
  let index;
  let line;
  let field;
  let value;
  for (let i = 0, length_ = lines.length; i < length_; ++i) {
    line = lines[i];
    index = line.indexOf(':');
    if (index === -1) {
      // could be empty line, just skip it
      continue;
    }
    field = line.slice(0, index).toLowerCase();
    value = trim(line.slice(index + 1));
    fields[field] = value;
  }
  return fields;
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
 * Initialize a new `Response` with the given `xhr`.
 *
 *  - set flags (.ok, .error, etc)
 *  - parse header
 *
 * Examples:
 *
 *  Aliasing `superagent` as `request` is nice:
 *
 *      request = superagent;
 *
 *  We can use the promise-like API, or pass callbacks:
 *
 *      request.get('/').end(function(res){});
 *      request.get('/', function(res){});
 *
 *  Sending data can be chained:
 *
 *      request
 *        .post('/user')
 *        .send({ name: 'tj' })
 *        .end(function(res){});
 *
 *  Or passed to `.send()`:
 *
 *      request
 *        .post('/user')
 *        .send({ name: 'tj' }, function(res){});
 *
 *  Or passed to `.post()`:
 *
 *      request
 *        .post('/user', { name: 'tj' })
 *        .end(function(res){});
 *
 * Or further reduced to a single call for simple cases:
 *
 *      request
 *        .post('/user', { name: 'tj' }, function(res){});
 *
 * @param {XMLHTTPRequest} xhr
 * @param {Object} options
 * @api private
 */

function Response(request_) {
  this.req = request_;
  this.xhr = this.req.xhr;
  // responseText is accessible only if responseType is '' or 'text' and on older browsers
  this.text = this.req.method !== 'HEAD' && (this.xhr.responseType === '' || this.xhr.responseType === 'text') || typeof this.xhr.responseType === 'undefined' ? this.xhr.responseText : null;
  this.statusText = this.req.xhr.statusText;
  let {
    status
  } = this.xhr;
  // handle IE9 bug: http://stackoverflow.com/questions/10046972/msie-returns-status-code-of-1223-for-ajax-request
  if (status === 1223) {
    status = 204;
  }
  this._setStatusProperties(status);
  this.headers = parseHeader(this.xhr.getAllResponseHeaders());
  this.header = this.headers;
  // getAllResponseHeaders sometimes falsely returns "" for CORS requests, but
  // getResponseHeader still works. so we get content-type even if getting
  // other headers fails.
  this.header['content-type'] = this.xhr.getResponseHeader('content-type');
  this._setHeaderProperties(this.header);
  if (this.text === null && request_._responseType) {
    this.body = this.xhr.response;
  } else {
    this.body = this.req.method === 'HEAD' ? null : this._parseBody(this.text ? this.text : this.xhr.response);
  }
}
mixin(Response.prototype, ResponseBase.prototype);

/**
 * Parse the given body `str`.
 *
 * Used for auto-parsing of bodies. Parsers
 * are defined on the `superagent.parse` object.
 *
 * @param {String} str
 * @return {Mixed}
 * @api private
 */

Response.prototype._parseBody = function (string_) {
  let parse = request.parse[this.type];
  if (this.req._parser) {
    return this.req._parser(this, string_);
  }
  if (!parse && isJSON(this.type)) {
    parse = request.parse['application/json'];
  }
  return parse && string_ && (string_.length > 0 || string_ instanceof Object) ? parse(string_) : null;
};

/**
 * Return an `Error` representative of this response.
 *
 * @return {Error}
 * @api public
 */

Response.prototype.toError = function () {
  const {
    req
  } = this;
  const {
    method
  } = req;
  const {
    url
  } = req;
  const message = `cannot ${method} ${url} (${this.status})`;
  const error = new Error(message);
  error.status = this.status;
  error.method = method;
  error.url = url;
  return error;
};

/**
 * Expose `Response`.
 */

request.Response = Response;

/**
 * Initialize a new `Request` with the given `method` and `url`.
 *
 * @param {String} method
 * @param {String} url
 * @api public
 */

function Request(method, url) {
  const self = this;
  this._query = this._query || [];
  this.method = method;
  this.url = url;
  this.header = {}; // preserves header name case
  this._header = {}; // coerces header names to lowercase
  this.on('end', () => {
    let error = null;
    let res = null;
    try {
      res = new Response(self);
    } catch (err) {
      error = new Error('Parser is unable to parse the response');
      error.parse = true;
      error.original = err;
      // issue #675: return the raw response if the response parsing fails
      if (self.xhr) {
        // ie9 doesn't have 'response' property
        error.rawResponse = typeof self.xhr.responseType === 'undefined' ? self.xhr.responseText : self.xhr.response;
        // issue #876: return the http status code if the response parsing fails
        error.status = self.xhr.status ? self.xhr.status : null;
        error.statusCode = error.status; // backwards-compat only
      } else {
        error.rawResponse = null;
        error.status = null;
      }
      return self.callback(error);
    }
    self.emit('response', res);
    let new_error;
    try {
      if (!self._isResponseOK(res)) {
        new_error = new Error(res.statusText || res.text || 'Unsuccessful HTTP response');
      }
    } catch (err) {
      new_error = err; // ok() callback can throw
    }

    // #1000 don't catch errors from the callback to avoid double calling it
    if (new_error) {
      new_error.original = error;
      new_error.response = res;
      new_error.status = new_error.status || res.status;
      self.callback(new_error, res);
    } else {
      self.callback(null, res);
    }
  });
}

/**
 * Mixin `Emitter` and `RequestBase`.
 */

// eslint-disable-next-line new-cap
Emitter(Request.prototype);
mixin(Request.prototype, RequestBase.prototype);

/**
 * Set Content-Type to `type`, mapping values from `request.types`.
 *
 * Examples:
 *
 *      superagent.types.xml = 'application/xml';
 *
 *      request.post('/')
 *        .type('xml')
 *        .send(xmlstring)
 *        .end(callback);
 *
 *      request.post('/')
 *        .type('application/xml')
 *        .send(xmlstring)
 *        .end(callback);
 *
 * @param {String} type
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.type = function (type) {
  this.set('Content-Type', request.types[type] || type);
  return this;
};

/**
 * Set Accept to `type`, mapping values from `request.types`.
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
  this.set('Accept', request.types[type] || type);
  return this;
};

/**
 * Set Authorization field value with `user` and `pass`.
 *
 * @param {String} user
 * @param {String} [pass] optional in case of using 'bearer' as type
 * @param {Object} options with 'type' property 'auto', 'basic' or 'bearer' (default 'basic')
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
      type: typeof btoa === 'function' ? 'basic' : 'auto'
    };
  }
  const encoder = options.encoder ? options.encoder : string => {
    if (typeof btoa === 'function') {
      return btoa(string);
    }
    throw new Error('Cannot use basic auth, btoa is not a function');
  };
  return this._auth(user, pass, options, encoder);
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
  if (typeof value !== 'string') value = serialize(value);
  if (value) this._query.push(value);
  return this;
};

/**
 * Queue the given `file` as an attachment to the specified `field`,
 * with optional `options` (or filename).
 *
 * ``` js
 * request.post('/upload')
 *   .attach('content', new Blob(['<a id="a"><b id="b">hey!</b></a>'], { type: "text/html"}))
 *   .end(callback);
 * ```
 *
 * @param {String} field
 * @param {Blob|File} file
 * @param {String|Object} options
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.attach = function (field, file, options) {
  if (file) {
    if (this._data) {
      throw new Error("superagent can't mix .send() and .attach()");
    }
    this._getFormData().append(field, file, options || file.name);
  }
  return this;
};
Request.prototype._getFormData = function () {
  if (!this._formData) {
    this._formData = new root.FormData();
  }
  return this._formData;
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
  const fn = this._callback;
  this.clearTimeout();
  this.called = true;
  if (error) {
    if (this._maxRetries) error.retries = this._retries - 1;
    this.emit('error', error);
  }
  fn(error, res);
};

/**
 * Invoke callback with x-domain error.
 *
 * @api private
 */

Request.prototype.crossDomainError = function () {
  const error = new Error('Request has been terminated\nPossible causes: the network is offline, Origin is not allowed by Access-Control-Allow-Origin, the page is being unloaded, etc.');
  error.crossDomain = true;
  error.status = this.status;
  error.method = this.method;
  error.url = this.url;
  this.callback(error);
};

// This only warns, because the request is still likely to work
Request.prototype.agent = function () {
  console.warn('This is not supported in browser version of superagent');
  return this;
};
Request.prototype.ca = Request.prototype.agent;
Request.prototype.buffer = Request.prototype.ca;

// This throws, because it can't send/receive data as expected
Request.prototype.write = () => {
  throw new Error('Streaming is not supported in browser version of superagent');
};
Request.prototype.pipe = Request.prototype.write;

/**
 * Check if `obj` is a host object,
 * we don't want to serialize these :)
 *
 * @param {Object} obj host object
 * @return {Boolean} is a host object
 * @api private
 */
Request.prototype._isHost = function (object) {
  // Native objects stringify to [object File], [object Blob], [object FormData], etc.
  return object && typeof object === 'object' && !Array.isArray(object) && Object.prototype.toString.call(object) !== '[object Object]';
};

/**
 * Initiate request, invoking callback `fn(res)`
 * with an instanceof `Response`.
 *
 * @param {Function} fn
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.end = function (fn) {
  if (this._endCalled) {
    console.warn('Warning: .end() was called twice. This is not supported in superagent');
  }
  this._endCalled = true;

  // store callback
  this._callback = fn || noop;

  // querystring
  this._finalizeQueryString();
  this._end();
};
Request.prototype._setUploadTimeout = function () {
  const self = this;

  // upload timeout it's wokrs only if deadline timeout is off
  if (this._uploadTimeout && !this._uploadTimeoutTimer) {
    this._uploadTimeoutTimer = setTimeout(() => {
      self._timeoutError('Upload timeout of ', self._uploadTimeout, 'ETIMEDOUT');
    }, this._uploadTimeout);
  }
};

// eslint-disable-next-line complexity
Request.prototype._end = function () {
  if (this._aborted) return this.callback(new Error('The request has been aborted even before .end() was called'));
  const self = this;
  this.xhr = request.getXHR();
  const {
    xhr
  } = this;
  let data = this._formData || this._data;
  this._setTimeouts();

  // state change
  xhr.addEventListener('readystatechange', () => {
    const {
      readyState
    } = xhr;
    if (readyState >= 2 && self._responseTimeoutTimer) {
      clearTimeout(self._responseTimeoutTimer);
    }
    if (readyState !== 4) {
      return;
    }
    if (self.hasSizeError()) return;

    // In IE9, reads to any property (e.g. status) off of an aborted XHR will
    // result in the error "Could not complete the operation due to error c00c023f"
    let status;
    try {
      status = xhr.status;
    } catch (err) {
      status = 0;
    }
    if (!status) {
      if (self.timedout || self._aborted) return;
      return self.crossDomainError();
    }
    if (self._maxResponseSize !== undefined && getResponseSize(xhr) > self._maxResponseSize) {
      const error = self._createSizeError('response');
      xhr.abort();
      return self.callback(error);
    }
    self.emit('end');
  });

  // progress
  const handleProgress = (direction, e) => {
    if (direction === 'upload' && self._maxRequestSize !== undefined && e.loaded > self._maxRequestSize) {
      const error = self._createSizeError('request');
      xhr.abort();
      self.callback(error);
      return;
    }
    if (e.total > 0) {
      e.percent = e.loaded / e.total * 100;
      if (e.percent === 100) {
        clearTimeout(self._uploadTimeoutTimer);
      }
    }
    e.direction = direction;
    self.emit('progress', e);
  };
  if (this.hasListeners('progress') || this._maxRequestSize !== undefined) {
    try {
      xhr.addEventListener('progress', handleProgress.bind(null, 'download'));
      if (xhr.upload) {
        xhr.upload.addEventListener('progress', handleProgress.bind(null, 'upload'));
      }
    } catch (err) {
      // Accessing xhr.upload fails in IE from a web worker, so just pretend it doesn't exist.
      // Reported here:
      // https://connect.microsoft.com/IE/feedback/details/837245/xmlhttprequest-upload-throws-invalid-argument-when-used-from-web-worker-context
    }
  }
  if (xhr.upload) {
    this._setUploadTimeout();
  }

  // initiate request
  try {
    if (this.username && this.password) {
      xhr.open(this.method, this.url, true, this.username, this.password);
    } else {
      xhr.open(this.method, this.url, true);
    }
  } catch (err) {
    // see #1149
    return this.callback(err);
  }

  // CORS
  if (this._withCredentials) xhr.withCredentials = true;

  // body
  if (!this._formData && this.method !== 'GET' && this.method !== 'HEAD' && typeof data !== 'string' && !this._isHost(data)) {
    // serialize stuff
    const contentType = this._header['content-type'];
    let serialize = this._serializer || request.serialize[contentType ? contentType.split(';')[0] : ''];
    if (!serialize && isJSON(contentType)) {
      serialize = request.serialize['application/json'];
    }
    if (serialize) data = serialize(data);
  }
  if (this._maxRequestSize !== undefined && byteLength(data) > this._maxRequestSize) {
    const error = this._createSizeError('request');
    xhr.abort();
    return this.callback(error);
  }

  // set header fields
  for (const field in this.header) {
    if (this.header[field] === null) continue;
    if (hasOwn(this.header, field)) xhr.setRequestHeader(field, this.header[field]);
  }
  if (this._responseType) {
    xhr.responseType = this._responseType;
  }

  // send stuff
  this.emit('request', this);

  // IE11 xhr.send(undefined) sends 'undefined' string as POST payload (instead of nothing)
  // We need null here if data is undefined
  xhr.send(typeof data === 'undefined' ? null : data);
};
request.agent = () => new Agent();
function getResponseSize(xhr) {
  if (xhr.response && typeof xhr.response.byteLength === 'number') {
    return xhr.response.byteLength;
  }
  if (xhr.response && typeof xhr.response.size === 'number') {
    return xhr.response.size;
  }
  try {
    return byteLength(xhr.responseText || '');
  } catch (error) {
    // responseText is inaccessible for responseType values such as json.
    return 0;
  }
}
for (const method of ['GET', 'POST', 'OPTIONS', 'PATCH', 'PUT', 'DELETE']) {
  Agent.prototype[method.toLowerCase()] = function (url, fn) {
    const request_ = new request.Request(method, url);
    this._setDefaults(request_);
    if (fn) {
      request_.end(fn);
    }
    return request_;
  };
}
Agent.prototype.del = Agent.prototype.delete;

/**
 * GET `url` with optional callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed|Function} [data] or fn
 * @param {Function} [fn]
 * @return {Request}
 * @api public
 */

request.get = (url, data, fn) => {
  const request_ = request('GET', url);
  if (typeof data === 'function') {
    fn = data;
    data = null;
  }
  if (data) request_.query(data);
  if (fn) request_.end(fn);
  return request_;
};

/**
 * HEAD `url` with optional callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed|Function} [data] or fn
 * @param {Function} [fn]
 * @return {Request}
 * @api public
 */

request.head = (url, data, fn) => {
  const request_ = request('HEAD', url);
  if (typeof data === 'function') {
    fn = data;
    data = null;
  }
  if (data) request_.query(data);
  if (fn) request_.end(fn);
  return request_;
};

/**
 * OPTIONS query to `url` with optional callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed|Function} [data] or fn
 * @param {Function} [fn]
 * @return {Request}
 * @api public
 */

request.options = (url, data, fn) => {
  const request_ = request('OPTIONS', url);
  if (typeof data === 'function') {
    fn = data;
    data = null;
  }
  if (data) request_.send(data);
  if (fn) request_.end(fn);
  return request_;
};

/**
 * DELETE `url` with optional `data` and callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed} [data]
 * @param {Function} [fn]
 * @return {Request}
 * @api public
 */

function del(url, data, fn) {
  const request_ = request('DELETE', url);
  if (typeof data === 'function') {
    fn = data;
    data = null;
  }
  if (data) request_.send(data);
  if (fn) request_.end(fn);
  return request_;
}
request.del = del;
request.delete = del;

/**
 * PATCH `url` with optional `data` and callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed} [data]
 * @param {Function} [fn]
 * @return {Request}
 * @api public
 */

request.patch = (url, data, fn) => {
  const request_ = request('PATCH', url);
  if (typeof data === 'function') {
    fn = data;
    data = null;
  }
  if (data) request_.send(data);
  if (fn) request_.end(fn);
  return request_;
};

/**
 * POST `url` with optional `data` and callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed} [data]
 * @param {Function} [fn]
 * @return {Request}
 * @api public
 */

request.post = (url, data, fn) => {
  const request_ = request('POST', url);
  if (typeof data === 'function') {
    fn = data;
    data = null;
  }
  if (data) request_.send(data);
  if (fn) request_.end(fn);
  return request_;
};

/**
 * PUT `url` with optional `data` and callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed|Function} [data] or fn
 * @param {Function} [fn]
 * @return {Request}
 * @api public
 */

request.put = (url, data, fn) => {
  const request_ = request('PUT', url);
  if (typeof data === 'function') {
    fn = data;
    data = null;
  }
  if (data) request_.send(data);
  if (fn) request_.end(fn);
  return request_;
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJyb290Iiwid2luZG93Iiwic2VsZiIsImNvbnNvbGUiLCJ3YXJuIiwiRW1pdHRlciIsInJlcXVpcmUiLCJzYWZlU3RyaW5naWZ5IiwicXMiLCJSZXF1ZXN0QmFzZSIsImlzT2JqZWN0IiwibWl4aW4iLCJoYXNPd24iLCJieXRlTGVuZ3RoIiwiUmVzcG9uc2VCYXNlIiwiQWdlbnQiLCJub29wIiwibW9kdWxlIiwiZXhwb3J0cyIsIm1ldGhvZCIsInVybCIsIlJlcXVlc3QiLCJlbmQiLCJhcmd1bWVudHMiLCJsZW5ndGgiLCJyZXF1ZXN0IiwiZ2V0WEhSIiwiWE1MSHR0cFJlcXVlc3QiLCJFcnJvciIsInRyaW0iLCJzIiwicmVwbGFjZSIsInNlcmlhbGl6ZSIsIm9iamVjdCIsInBhaXJzIiwia2V5IiwicHVzaEVuY29kZWRLZXlWYWx1ZVBhaXIiLCJqb2luIiwidmFsdWUiLCJ1bmRlZmluZWQiLCJwdXNoIiwiZW5jb2RlVVJJIiwiQXJyYXkiLCJpc0FycmF5IiwidiIsInN1YmtleSIsImVuY29kZVVSSUNvbXBvbmVudCIsInNlcmlhbGl6ZU9iamVjdCIsInBhcnNlU3RyaW5nIiwic3RyaW5nXyIsInNwbGl0IiwicGFpciIsInBvcyIsImkiLCJsZW5ndGhfIiwiaW5kZXhPZiIsImRlY29kZVVSSUNvbXBvbmVudCIsInNsaWNlIiwidHlwZXMiLCJodG1sIiwianNvbiIsInhtbCIsInVybGVuY29kZWQiLCJmb3JtIiwib2JqIiwic3RyaW5naWZ5IiwiaW5kaWNlcyIsInN0cmljdE51bGxIYW5kbGluZyIsInBhcnNlIiwiSlNPTiIsInBhcnNlSGVhZGVyIiwibGluZXMiLCJmaWVsZHMiLCJpbmRleCIsImxpbmUiLCJmaWVsZCIsInRvTG93ZXJDYXNlIiwiaXNKU09OIiwibWltZSIsInRlc3QiLCJSZXNwb25zZSIsInJlcXVlc3RfIiwicmVxIiwieGhyIiwidGV4dCIsInJlc3BvbnNlVHlwZSIsInJlc3BvbnNlVGV4dCIsInN0YXR1c1RleHQiLCJzdGF0dXMiLCJfc2V0U3RhdHVzUHJvcGVydGllcyIsImhlYWRlcnMiLCJnZXRBbGxSZXNwb25zZUhlYWRlcnMiLCJoZWFkZXIiLCJnZXRSZXNwb25zZUhlYWRlciIsIl9zZXRIZWFkZXJQcm9wZXJ0aWVzIiwiX3Jlc3BvbnNlVHlwZSIsImJvZHkiLCJyZXNwb25zZSIsIl9wYXJzZUJvZHkiLCJwcm90b3R5cGUiLCJ0eXBlIiwiX3BhcnNlciIsIk9iamVjdCIsInRvRXJyb3IiLCJtZXNzYWdlIiwiZXJyb3IiLCJfcXVlcnkiLCJfaGVhZGVyIiwib24iLCJyZXMiLCJlcnIiLCJvcmlnaW5hbCIsInJhd1Jlc3BvbnNlIiwic3RhdHVzQ29kZSIsImNhbGxiYWNrIiwiZW1pdCIsIm5ld19lcnJvciIsIl9pc1Jlc3BvbnNlT0siLCJzZXQiLCJhY2NlcHQiLCJhdXRoIiwidXNlciIsInBhc3MiLCJvcHRpb25zIiwiYnRvYSIsImVuY29kZXIiLCJzdHJpbmciLCJfYXV0aCIsInF1ZXJ5IiwiYXR0YWNoIiwiZmlsZSIsIl9kYXRhIiwiX2dldEZvcm1EYXRhIiwiYXBwZW5kIiwibmFtZSIsIl9mb3JtRGF0YSIsIkZvcm1EYXRhIiwiY2FsbGVkIiwiX3Nob3VsZFJldHJ5IiwiX3JldHJ5IiwiZm4iLCJfY2FsbGJhY2siLCJjbGVhclRpbWVvdXQiLCJfbWF4UmV0cmllcyIsInJldHJpZXMiLCJfcmV0cmllcyIsImNyb3NzRG9tYWluRXJyb3IiLCJjcm9zc0RvbWFpbiIsImFnZW50IiwiY2EiLCJidWZmZXIiLCJ3cml0ZSIsInBpcGUiLCJfaXNIb3N0IiwidG9TdHJpbmciLCJjYWxsIiwiX2VuZENhbGxlZCIsIl9maW5hbGl6ZVF1ZXJ5U3RyaW5nIiwiX2VuZCIsIl9zZXRVcGxvYWRUaW1lb3V0IiwiX3VwbG9hZFRpbWVvdXQiLCJfdXBsb2FkVGltZW91dFRpbWVyIiwic2V0VGltZW91dCIsIl90aW1lb3V0RXJyb3IiLCJfYWJvcnRlZCIsImRhdGEiLCJfc2V0VGltZW91dHMiLCJhZGRFdmVudExpc3RlbmVyIiwicmVhZHlTdGF0ZSIsIl9yZXNwb25zZVRpbWVvdXRUaW1lciIsImhhc1NpemVFcnJvciIsInRpbWVkb3V0IiwiX21heFJlc3BvbnNlU2l6ZSIsImdldFJlc3BvbnNlU2l6ZSIsIl9jcmVhdGVTaXplRXJyb3IiLCJhYm9ydCIsImhhbmRsZVByb2dyZXNzIiwiZGlyZWN0aW9uIiwiZSIsIl9tYXhSZXF1ZXN0U2l6ZSIsImxvYWRlZCIsInRvdGFsIiwicGVyY2VudCIsImhhc0xpc3RlbmVycyIsImJpbmQiLCJ1cGxvYWQiLCJ1c2VybmFtZSIsInBhc3N3b3JkIiwib3BlbiIsIl93aXRoQ3JlZGVudGlhbHMiLCJ3aXRoQ3JlZGVudGlhbHMiLCJjb250ZW50VHlwZSIsIl9zZXJpYWxpemVyIiwic2V0UmVxdWVzdEhlYWRlciIsInNlbmQiLCJzaXplIiwiX3NldERlZmF1bHRzIiwiZGVsIiwiZGVsZXRlIiwiZ2V0IiwiaGVhZCIsInBhdGNoIiwicG9zdCIsInB1dCJdLCJzb3VyY2VzIjpbIi4uL3NyYy9jbGllbnQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFJvb3QgcmVmZXJlbmNlIGZvciBpZnJhbWVzLlxyXG4gKi9cclxuXHJcbmxldCByb290O1xyXG5pZiAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcpIHtcclxuICAvLyBCcm93c2VyIHdpbmRvd1xyXG4gIHJvb3QgPSB3aW5kb3c7XHJcbn0gZWxzZSBpZiAodHlwZW9mIHNlbGYgPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgLy8gT3RoZXIgZW52aXJvbm1lbnRzXHJcbiAgY29uc29sZS53YXJuKFxyXG4gICAgJ1VzaW5nIGJyb3dzZXItb25seSB2ZXJzaW9uIG9mIHN1cGVyYWdlbnQgaW4gbm9uLWJyb3dzZXIgZW52aXJvbm1lbnQnXHJcbiAgKTtcclxuICByb290ID0gdGhpcztcclxufSBlbHNlIHtcclxuICAvLyBXZWIgV29ya2VyXHJcbiAgcm9vdCA9IHNlbGY7XHJcbn1cclxuXHJcbmNvbnN0IEVtaXR0ZXIgPSByZXF1aXJlKCdjb21wb25lbnQtZW1pdHRlcicpO1xyXG5jb25zdCBzYWZlU3RyaW5naWZ5ID0gcmVxdWlyZSgnZmFzdC1zYWZlLXN0cmluZ2lmeScpO1xyXG5jb25zdCBxcyA9IHJlcXVpcmUoJ3FzJyk7XHJcbmNvbnN0IFJlcXVlc3RCYXNlID0gcmVxdWlyZSgnLi9yZXF1ZXN0LWJhc2UnKTtcclxuY29uc3QgeyBpc09iamVjdCwgbWl4aW4sIGhhc093biwgYnl0ZUxlbmd0aCB9ID0gcmVxdWlyZSgnLi91dGlscycpO1xyXG5jb25zdCBSZXNwb25zZUJhc2UgPSByZXF1aXJlKCcuL3Jlc3BvbnNlLWJhc2UnKTtcclxuY29uc3QgQWdlbnQgPSByZXF1aXJlKCcuL2FnZW50LWJhc2UnKTtcclxuXHJcbi8qKlxyXG4gKiBOb29wLlxyXG4gKi9cclxuXHJcbmZ1bmN0aW9uIG5vb3AoKSB7fVxyXG5cclxuLyoqXHJcbiAqIEV4cG9zZSBgcmVxdWVzdGAuXHJcbiAqL1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAobWV0aG9kLCB1cmwpIHtcclxuICAvLyBjYWxsYmFja1xyXG4gIGlmICh0eXBlb2YgdXJsID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICByZXR1cm4gbmV3IGV4cG9ydHMuUmVxdWVzdCgnR0VUJywgbWV0aG9kKS5lbmQodXJsKTtcclxuICB9XHJcblxyXG4gIC8vIHVybCBmaXJzdFxyXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAxKSB7XHJcbiAgICByZXR1cm4gbmV3IGV4cG9ydHMuUmVxdWVzdCgnR0VUJywgbWV0aG9kKTtcclxuICB9XHJcblxyXG4gIHJldHVybiBuZXcgZXhwb3J0cy5SZXF1ZXN0KG1ldGhvZCwgdXJsKTtcclxufTtcclxuXHJcbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cztcclxuXHJcbmNvbnN0IHJlcXVlc3QgPSBleHBvcnRzO1xyXG5cclxuZXhwb3J0cy5SZXF1ZXN0ID0gUmVxdWVzdDtcclxuXHJcbi8qKlxyXG4gKiBEZXRlcm1pbmUgWEhSLlxyXG4gKi9cclxuXHJcbnJlcXVlc3QuZ2V0WEhSID0gKCkgPT4ge1xyXG4gIGlmIChyb290LlhNTEh0dHBSZXF1ZXN0KSB7XHJcbiAgICByZXR1cm4gbmV3IHJvb3QuWE1MSHR0cFJlcXVlc3QoKTtcclxuICB9XHJcblxyXG4gIHRocm93IG5ldyBFcnJvcignQnJvd3Nlci1vbmx5IHZlcnNpb24gb2Ygc3VwZXJhZ2VudCBjb3VsZCBub3QgZmluZCBYSFInKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZW1vdmVzIGxlYWRpbmcgYW5kIHRyYWlsaW5nIHdoaXRlc3BhY2UsIGFkZGVkIHRvIHN1cHBvcnQgSUUuXHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBzXHJcbiAqIEByZXR1cm4ge1N0cmluZ31cclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuY29uc3QgdHJpbSA9ICcnLnRyaW0gPyAocykgPT4gcy50cmltKCkgOiAocykgPT4gcy5yZXBsYWNlKC8oXlxccyp8XFxzKiQpL2csICcnKTtcclxuXHJcbi8qKlxyXG4gKiBTZXJpYWxpemUgdGhlIGdpdmVuIGBvYmpgLlxyXG4gKlxyXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqXHJcbiAqIEByZXR1cm4ge1N0cmluZ31cclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuZnVuY3Rpb24gc2VyaWFsaXplKG9iamVjdCkge1xyXG4gIGlmICghaXNPYmplY3Qob2JqZWN0KSkgcmV0dXJuIG9iamVjdDtcclxuICBjb25zdCBwYWlycyA9IFtdO1xyXG4gIGZvciAoY29uc3Qga2V5IGluIG9iamVjdCkge1xyXG4gICAgaWYgKGhhc093bihvYmplY3QsIGtleSkpIHB1c2hFbmNvZGVkS2V5VmFsdWVQYWlyKHBhaXJzLCBrZXksIG9iamVjdFtrZXldKTtcclxuICB9XHJcblxyXG4gIHJldHVybiBwYWlycy5qb2luKCcmJyk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBIZWxwcyAnc2VyaWFsaXplJyB3aXRoIHNlcmlhbGl6aW5nIGFycmF5cy5cclxuICogTXV0YXRlcyB0aGUgcGFpcnMgYXJyYXkuXHJcbiAqXHJcbiAqIEBwYXJhbSB7QXJyYXl9IHBhaXJzXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBrZXlcclxuICogQHBhcmFtIHtNaXhlZH0gdmFsXHJcbiAqL1xyXG5cclxuZnVuY3Rpb24gcHVzaEVuY29kZWRLZXlWYWx1ZVBhaXIocGFpcnMsIGtleSwgdmFsdWUpIHtcclxuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuO1xyXG4gIGlmICh2YWx1ZSA9PT0gbnVsbCkge1xyXG4gICAgcGFpcnMucHVzaChlbmNvZGVVUkkoa2V5KSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG5cclxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcclxuICAgIGZvciAoY29uc3QgdiBvZiB2YWx1ZSkge1xyXG4gICAgICBwdXNoRW5jb2RlZEtleVZhbHVlUGFpcihwYWlycywga2V5LCB2KTtcclxuICAgIH1cclxuICB9IGVsc2UgaWYgKGlzT2JqZWN0KHZhbHVlKSkge1xyXG4gICAgZm9yIChjb25zdCBzdWJrZXkgaW4gdmFsdWUpIHtcclxuICAgICAgaWYgKGhhc093bih2YWx1ZSwgc3Via2V5KSlcclxuICAgICAgICBwdXNoRW5jb2RlZEtleVZhbHVlUGFpcihwYWlycywgYCR7a2V5fVske3N1YmtleX1dYCwgdmFsdWVbc3Via2V5XSk7XHJcbiAgICB9XHJcbiAgfSBlbHNlIHtcclxuICAgIHBhaXJzLnB1c2goZW5jb2RlVVJJKGtleSkgKyAnPScgKyBlbmNvZGVVUklDb21wb25lbnQodmFsdWUpKTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBFeHBvc2Ugc2VyaWFsaXphdGlvbiBtZXRob2QuXHJcbiAqL1xyXG5cclxucmVxdWVzdC5zZXJpYWxpemVPYmplY3QgPSBzZXJpYWxpemU7XHJcblxyXG4vKipcclxuICogUGFyc2UgdGhlIGdpdmVuIHgtd3d3LWZvcm0tdXJsZW5jb2RlZCBgc3RyYC5cclxuICpcclxuICogQHBhcmFtIHtTdHJpbmd9IHN0clxyXG4gKiBAcmV0dXJuIHtPYmplY3R9XHJcbiAqIEBhcGkgcHJpdmF0ZVxyXG4gKi9cclxuXHJcbmZ1bmN0aW9uIHBhcnNlU3RyaW5nKHN0cmluZ18pIHtcclxuICBjb25zdCBvYmplY3QgPSB7fTtcclxuICBjb25zdCBwYWlycyA9IHN0cmluZ18uc3BsaXQoJyYnKTtcclxuICBsZXQgcGFpcjtcclxuICBsZXQgcG9zO1xyXG5cclxuICBmb3IgKGxldCBpID0gMCwgbGVuZ3RoXyA9IHBhaXJzLmxlbmd0aDsgaSA8IGxlbmd0aF87ICsraSkge1xyXG4gICAgcGFpciA9IHBhaXJzW2ldO1xyXG4gICAgcG9zID0gcGFpci5pbmRleE9mKCc9Jyk7XHJcbiAgICBpZiAocG9zID09PSAtMSkge1xyXG4gICAgICBvYmplY3RbZGVjb2RlVVJJQ29tcG9uZW50KHBhaXIpXSA9ICcnO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgb2JqZWN0W2RlY29kZVVSSUNvbXBvbmVudChwYWlyLnNsaWNlKDAsIHBvcykpXSA9IGRlY29kZVVSSUNvbXBvbmVudChcclxuICAgICAgICBwYWlyLnNsaWNlKHBvcyArIDEpXHJcbiAgICAgICk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICByZXR1cm4gb2JqZWN0O1xyXG59XHJcblxyXG4vKipcclxuICogRXhwb3NlIHBhcnNlci5cclxuICovXHJcblxyXG5yZXF1ZXN0LnBhcnNlU3RyaW5nID0gcGFyc2VTdHJpbmc7XHJcblxyXG4vKipcclxuICogRGVmYXVsdCBNSU1FIHR5cGUgbWFwLlxyXG4gKlxyXG4gKiAgICAgc3VwZXJhZ2VudC50eXBlcy54bWwgPSAnYXBwbGljYXRpb24veG1sJztcclxuICpcclxuICovXHJcblxyXG5yZXF1ZXN0LnR5cGVzID0ge1xyXG4gIGh0bWw6ICd0ZXh0L2h0bWwnLFxyXG4gIGpzb246ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICB4bWw6ICd0ZXh0L3htbCcsXHJcbiAgdXJsZW5jb2RlZDogJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCcsXHJcbiAgZm9ybTogJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCcsXHJcbiAgJ2Zvcm0tZGF0YSc6ICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnXHJcbn07XHJcblxyXG4vKipcclxuICogRGVmYXVsdCBzZXJpYWxpemF0aW9uIG1hcC5cclxuICpcclxuICogICAgIHN1cGVyYWdlbnQuc2VyaWFsaXplWydhcHBsaWNhdGlvbi94bWwnXSA9IGZ1bmN0aW9uKG9iail7XHJcbiAqICAgICAgIHJldHVybiAnZ2VuZXJhdGVkIHhtbCBoZXJlJztcclxuICogICAgIH07XHJcbiAqXHJcbiAqL1xyXG5cclxucmVxdWVzdC5zZXJpYWxpemUgPSB7XHJcbiAgJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCc6IChvYmopID0+IHtcclxuICAgIHJldHVybiBxcy5zdHJpbmdpZnkob2JqLCB7IGluZGljZXM6IGZhbHNlLCBzdHJpY3ROdWxsSGFuZGxpbmc6IHRydWUgfSk7XHJcbiAgfSxcclxuICAnYXBwbGljYXRpb24vanNvbic6IHNhZmVTdHJpbmdpZnlcclxufTtcclxuXHJcbi8qKlxyXG4gKiBEZWZhdWx0IHBhcnNlcnMuXHJcbiAqXHJcbiAqICAgICBzdXBlcmFnZW50LnBhcnNlWydhcHBsaWNhdGlvbi94bWwnXSA9IGZ1bmN0aW9uKHN0cil7XHJcbiAqICAgICAgIHJldHVybiB7IG9iamVjdCBwYXJzZWQgZnJvbSBzdHIgfTtcclxuICogICAgIH07XHJcbiAqXHJcbiAqL1xyXG5cclxucmVxdWVzdC5wYXJzZSA9IHtcclxuICAnYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJzogcGFyc2VTdHJpbmcsXHJcbiAgJ2FwcGxpY2F0aW9uL2pzb24nOiBKU09OLnBhcnNlXHJcbn07XHJcblxyXG4vKipcclxuICogUGFyc2UgdGhlIGdpdmVuIGhlYWRlciBgc3RyYCBpbnRvXHJcbiAqIGFuIG9iamVjdCBjb250YWluaW5nIHRoZSBtYXBwZWQgZmllbGRzLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXHJcbiAqIEByZXR1cm4ge09iamVjdH1cclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuZnVuY3Rpb24gcGFyc2VIZWFkZXIoc3RyaW5nXykge1xyXG4gIGNvbnN0IGxpbmVzID0gc3RyaW5nXy5zcGxpdCgvXFxyP1xcbi8pO1xyXG4gIGNvbnN0IGZpZWxkcyA9IHt9O1xyXG4gIGxldCBpbmRleDtcclxuICBsZXQgbGluZTtcclxuICBsZXQgZmllbGQ7XHJcbiAgbGV0IHZhbHVlO1xyXG5cclxuICBmb3IgKGxldCBpID0gMCwgbGVuZ3RoXyA9IGxpbmVzLmxlbmd0aDsgaSA8IGxlbmd0aF87ICsraSkge1xyXG4gICAgbGluZSA9IGxpbmVzW2ldO1xyXG4gICAgaW5kZXggPSBsaW5lLmluZGV4T2YoJzonKTtcclxuICAgIGlmIChpbmRleCA9PT0gLTEpIHtcclxuICAgICAgLy8gY291bGQgYmUgZW1wdHkgbGluZSwganVzdCBza2lwIGl0XHJcbiAgICAgIGNvbnRpbnVlO1xyXG4gICAgfVxyXG5cclxuICAgIGZpZWxkID0gbGluZS5zbGljZSgwLCBpbmRleCkudG9Mb3dlckNhc2UoKTtcclxuICAgIHZhbHVlID0gdHJpbShsaW5lLnNsaWNlKGluZGV4ICsgMSkpO1xyXG4gICAgZmllbGRzW2ZpZWxkXSA9IHZhbHVlO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIGZpZWxkcztcclxufVxyXG5cclxuLyoqXHJcbiAqIENoZWNrIGlmIGBtaW1lYCBpcyBqc29uIG9yIGhhcyAranNvbiBzdHJ1Y3R1cmVkIHN5bnRheCBzdWZmaXguXHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBtaW1lXHJcbiAqIEByZXR1cm4ge0Jvb2xlYW59XHJcbiAqIEBhcGkgcHJpdmF0ZVxyXG4gKi9cclxuXHJcbmZ1bmN0aW9uIGlzSlNPTihtaW1lKSB7XHJcbiAgLy8gc2hvdWxkIG1hdGNoIC9qc29uIG9yICtqc29uXHJcbiAgLy8gYnV0IG5vdCAvanNvbi1zZXFcclxuICByZXR1cm4gL1svK11qc29uKCR8W14tXFx3XSkvaS50ZXN0KG1pbWUpO1xyXG59XHJcblxyXG4vKipcclxuICogSW5pdGlhbGl6ZSBhIG5ldyBgUmVzcG9uc2VgIHdpdGggdGhlIGdpdmVuIGB4aHJgLlxyXG4gKlxyXG4gKiAgLSBzZXQgZmxhZ3MgKC5vaywgLmVycm9yLCBldGMpXHJcbiAqICAtIHBhcnNlIGhlYWRlclxyXG4gKlxyXG4gKiBFeGFtcGxlczpcclxuICpcclxuICogIEFsaWFzaW5nIGBzdXBlcmFnZW50YCBhcyBgcmVxdWVzdGAgaXMgbmljZTpcclxuICpcclxuICogICAgICByZXF1ZXN0ID0gc3VwZXJhZ2VudDtcclxuICpcclxuICogIFdlIGNhbiB1c2UgdGhlIHByb21pc2UtbGlrZSBBUEksIG9yIHBhc3MgY2FsbGJhY2tzOlxyXG4gKlxyXG4gKiAgICAgIHJlcXVlc3QuZ2V0KCcvJykuZW5kKGZ1bmN0aW9uKHJlcyl7fSk7XHJcbiAqICAgICAgcmVxdWVzdC5nZXQoJy8nLCBmdW5jdGlvbihyZXMpe30pO1xyXG4gKlxyXG4gKiAgU2VuZGluZyBkYXRhIGNhbiBiZSBjaGFpbmVkOlxyXG4gKlxyXG4gKiAgICAgIHJlcXVlc3RcclxuICogICAgICAgIC5wb3N0KCcvdXNlcicpXHJcbiAqICAgICAgICAuc2VuZCh7IG5hbWU6ICd0aicgfSlcclxuICogICAgICAgIC5lbmQoZnVuY3Rpb24ocmVzKXt9KTtcclxuICpcclxuICogIE9yIHBhc3NlZCB0byBgLnNlbmQoKWA6XHJcbiAqXHJcbiAqICAgICAgcmVxdWVzdFxyXG4gKiAgICAgICAgLnBvc3QoJy91c2VyJylcclxuICogICAgICAgIC5zZW5kKHsgbmFtZTogJ3RqJyB9LCBmdW5jdGlvbihyZXMpe30pO1xyXG4gKlxyXG4gKiAgT3IgcGFzc2VkIHRvIGAucG9zdCgpYDpcclxuICpcclxuICogICAgICByZXF1ZXN0XHJcbiAqICAgICAgICAucG9zdCgnL3VzZXInLCB7IG5hbWU6ICd0aicgfSlcclxuICogICAgICAgIC5lbmQoZnVuY3Rpb24ocmVzKXt9KTtcclxuICpcclxuICogT3IgZnVydGhlciByZWR1Y2VkIHRvIGEgc2luZ2xlIGNhbGwgZm9yIHNpbXBsZSBjYXNlczpcclxuICpcclxuICogICAgICByZXF1ZXN0XHJcbiAqICAgICAgICAucG9zdCgnL3VzZXInLCB7IG5hbWU6ICd0aicgfSwgZnVuY3Rpb24ocmVzKXt9KTtcclxuICpcclxuICogQHBhcmFtIHtYTUxIVFRQUmVxdWVzdH0geGhyXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zXHJcbiAqIEBhcGkgcHJpdmF0ZVxyXG4gKi9cclxuXHJcbmZ1bmN0aW9uIFJlc3BvbnNlKHJlcXVlc3RfKSB7XHJcbiAgdGhpcy5yZXEgPSByZXF1ZXN0XztcclxuICB0aGlzLnhociA9IHRoaXMucmVxLnhocjtcclxuICAvLyByZXNwb25zZVRleHQgaXMgYWNjZXNzaWJsZSBvbmx5IGlmIHJlc3BvbnNlVHlwZSBpcyAnJyBvciAndGV4dCcgYW5kIG9uIG9sZGVyIGJyb3dzZXJzXHJcbiAgdGhpcy50ZXh0ID1cclxuICAgICh0aGlzLnJlcS5tZXRob2QgIT09ICdIRUFEJyAmJlxyXG4gICAgICAodGhpcy54aHIucmVzcG9uc2VUeXBlID09PSAnJyB8fCB0aGlzLnhoci5yZXNwb25zZVR5cGUgPT09ICd0ZXh0JykpIHx8XHJcbiAgICB0eXBlb2YgdGhpcy54aHIucmVzcG9uc2VUeXBlID09PSAndW5kZWZpbmVkJ1xyXG4gICAgICA/IHRoaXMueGhyLnJlc3BvbnNlVGV4dFxyXG4gICAgICA6IG51bGw7XHJcbiAgdGhpcy5zdGF0dXNUZXh0ID0gdGhpcy5yZXEueGhyLnN0YXR1c1RleHQ7XHJcbiAgbGV0IHsgc3RhdHVzIH0gPSB0aGlzLnhocjtcclxuICAvLyBoYW5kbGUgSUU5IGJ1ZzogaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy8xMDA0Njk3Mi9tc2llLXJldHVybnMtc3RhdHVzLWNvZGUtb2YtMTIyMy1mb3ItYWpheC1yZXF1ZXN0XHJcbiAgaWYgKHN0YXR1cyA9PT0gMTIyMykge1xyXG4gICAgc3RhdHVzID0gMjA0O1xyXG4gIH1cclxuXHJcbiAgdGhpcy5fc2V0U3RhdHVzUHJvcGVydGllcyhzdGF0dXMpO1xyXG4gIHRoaXMuaGVhZGVycyA9IHBhcnNlSGVhZGVyKHRoaXMueGhyLmdldEFsbFJlc3BvbnNlSGVhZGVycygpKTtcclxuICB0aGlzLmhlYWRlciA9IHRoaXMuaGVhZGVycztcclxuICAvLyBnZXRBbGxSZXNwb25zZUhlYWRlcnMgc29tZXRpbWVzIGZhbHNlbHkgcmV0dXJucyBcIlwiIGZvciBDT1JTIHJlcXVlc3RzLCBidXRcclxuICAvLyBnZXRSZXNwb25zZUhlYWRlciBzdGlsbCB3b3Jrcy4gc28gd2UgZ2V0IGNvbnRlbnQtdHlwZSBldmVuIGlmIGdldHRpbmdcclxuICAvLyBvdGhlciBoZWFkZXJzIGZhaWxzLlxyXG4gIHRoaXMuaGVhZGVyWydjb250ZW50LXR5cGUnXSA9IHRoaXMueGhyLmdldFJlc3BvbnNlSGVhZGVyKCdjb250ZW50LXR5cGUnKTtcclxuICB0aGlzLl9zZXRIZWFkZXJQcm9wZXJ0aWVzKHRoaXMuaGVhZGVyKTtcclxuXHJcbiAgaWYgKHRoaXMudGV4dCA9PT0gbnVsbCAmJiByZXF1ZXN0Xy5fcmVzcG9uc2VUeXBlKSB7XHJcbiAgICB0aGlzLmJvZHkgPSB0aGlzLnhoci5yZXNwb25zZTtcclxuICB9IGVsc2Uge1xyXG4gICAgdGhpcy5ib2R5ID1cclxuICAgICAgdGhpcy5yZXEubWV0aG9kID09PSAnSEVBRCdcclxuICAgICAgICA/IG51bGxcclxuICAgICAgICA6IHRoaXMuX3BhcnNlQm9keSh0aGlzLnRleHQgPyB0aGlzLnRleHQgOiB0aGlzLnhoci5yZXNwb25zZSk7XHJcbiAgfVxyXG59XHJcblxyXG5taXhpbihSZXNwb25zZS5wcm90b3R5cGUsIFJlc3BvbnNlQmFzZS5wcm90b3R5cGUpO1xyXG5cclxuLyoqXHJcbiAqIFBhcnNlIHRoZSBnaXZlbiBib2R5IGBzdHJgLlxyXG4gKlxyXG4gKiBVc2VkIGZvciBhdXRvLXBhcnNpbmcgb2YgYm9kaWVzLiBQYXJzZXJzXHJcbiAqIGFyZSBkZWZpbmVkIG9uIHRoZSBgc3VwZXJhZ2VudC5wYXJzZWAgb2JqZWN0LlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXHJcbiAqIEByZXR1cm4ge01peGVkfVxyXG4gKiBAYXBpIHByaXZhdGVcclxuICovXHJcblxyXG5SZXNwb25zZS5wcm90b3R5cGUuX3BhcnNlQm9keSA9IGZ1bmN0aW9uIChzdHJpbmdfKSB7XHJcbiAgbGV0IHBhcnNlID0gcmVxdWVzdC5wYXJzZVt0aGlzLnR5cGVdO1xyXG4gIGlmICh0aGlzLnJlcS5fcGFyc2VyKSB7XHJcbiAgICByZXR1cm4gdGhpcy5yZXEuX3BhcnNlcih0aGlzLCBzdHJpbmdfKTtcclxuICB9XHJcblxyXG4gIGlmICghcGFyc2UgJiYgaXNKU09OKHRoaXMudHlwZSkpIHtcclxuICAgIHBhcnNlID0gcmVxdWVzdC5wYXJzZVsnYXBwbGljYXRpb24vanNvbiddO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHBhcnNlICYmIHN0cmluZ18gJiYgKHN0cmluZ18ubGVuZ3RoID4gMCB8fCBzdHJpbmdfIGluc3RhbmNlb2YgT2JqZWN0KVxyXG4gICAgPyBwYXJzZShzdHJpbmdfKVxyXG4gICAgOiBudWxsO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJldHVybiBhbiBgRXJyb3JgIHJlcHJlc2VudGF0aXZlIG9mIHRoaXMgcmVzcG9uc2UuXHJcbiAqXHJcbiAqIEByZXR1cm4ge0Vycm9yfVxyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlc3BvbnNlLnByb3RvdHlwZS50b0Vycm9yID0gZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IHsgcmVxIH0gPSB0aGlzO1xyXG4gIGNvbnN0IHsgbWV0aG9kIH0gPSByZXE7XHJcbiAgY29uc3QgeyB1cmwgfSA9IHJlcTtcclxuXHJcbiAgY29uc3QgbWVzc2FnZSA9IGBjYW5ub3QgJHttZXRob2R9ICR7dXJsfSAoJHt0aGlzLnN0YXR1c30pYDtcclxuICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcihtZXNzYWdlKTtcclxuICBlcnJvci5zdGF0dXMgPSB0aGlzLnN0YXR1cztcclxuICBlcnJvci5tZXRob2QgPSBtZXRob2Q7XHJcbiAgZXJyb3IudXJsID0gdXJsO1xyXG5cclxuICByZXR1cm4gZXJyb3I7XHJcbn07XHJcblxyXG4vKipcclxuICogRXhwb3NlIGBSZXNwb25zZWAuXHJcbiAqL1xyXG5cclxucmVxdWVzdC5SZXNwb25zZSA9IFJlc3BvbnNlO1xyXG5cclxuLyoqXHJcbiAqIEluaXRpYWxpemUgYSBuZXcgYFJlcXVlc3RgIHdpdGggdGhlIGdpdmVuIGBtZXRob2RgIGFuZCBgdXJsYC5cclxuICpcclxuICogQHBhcmFtIHtTdHJpbmd9IG1ldGhvZFxyXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuZnVuY3Rpb24gUmVxdWVzdChtZXRob2QsIHVybCkge1xyXG4gIGNvbnN0IHNlbGYgPSB0aGlzO1xyXG4gIHRoaXMuX3F1ZXJ5ID0gdGhpcy5fcXVlcnkgfHwgW107XHJcbiAgdGhpcy5tZXRob2QgPSBtZXRob2Q7XHJcbiAgdGhpcy51cmwgPSB1cmw7XHJcbiAgdGhpcy5oZWFkZXIgPSB7fTsgLy8gcHJlc2VydmVzIGhlYWRlciBuYW1lIGNhc2VcclxuICB0aGlzLl9oZWFkZXIgPSB7fTsgLy8gY29lcmNlcyBoZWFkZXIgbmFtZXMgdG8gbG93ZXJjYXNlXHJcbiAgdGhpcy5vbignZW5kJywgKCkgPT4ge1xyXG4gICAgbGV0IGVycm9yID0gbnVsbDtcclxuICAgIGxldCByZXMgPSBudWxsO1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIHJlcyA9IG5ldyBSZXNwb25zZShzZWxmKTtcclxuICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICBlcnJvciA9IG5ldyBFcnJvcignUGFyc2VyIGlzIHVuYWJsZSB0byBwYXJzZSB0aGUgcmVzcG9uc2UnKTtcclxuICAgICAgZXJyb3IucGFyc2UgPSB0cnVlO1xyXG4gICAgICBlcnJvci5vcmlnaW5hbCA9IGVycjtcclxuICAgICAgLy8gaXNzdWUgIzY3NTogcmV0dXJuIHRoZSByYXcgcmVzcG9uc2UgaWYgdGhlIHJlc3BvbnNlIHBhcnNpbmcgZmFpbHNcclxuICAgICAgaWYgKHNlbGYueGhyKSB7XHJcbiAgICAgICAgLy8gaWU5IGRvZXNuJ3QgaGF2ZSAncmVzcG9uc2UnIHByb3BlcnR5XHJcbiAgICAgICAgZXJyb3IucmF3UmVzcG9uc2UgPVxyXG4gICAgICAgICAgdHlwZW9mIHNlbGYueGhyLnJlc3BvbnNlVHlwZSA9PT0gJ3VuZGVmaW5lZCdcclxuICAgICAgICAgICAgPyBzZWxmLnhoci5yZXNwb25zZVRleHRcclxuICAgICAgICAgICAgOiBzZWxmLnhoci5yZXNwb25zZTtcclxuICAgICAgICAvLyBpc3N1ZSAjODc2OiByZXR1cm4gdGhlIGh0dHAgc3RhdHVzIGNvZGUgaWYgdGhlIHJlc3BvbnNlIHBhcnNpbmcgZmFpbHNcclxuICAgICAgICBlcnJvci5zdGF0dXMgPSBzZWxmLnhoci5zdGF0dXMgPyBzZWxmLnhoci5zdGF0dXMgOiBudWxsO1xyXG4gICAgICAgIGVycm9yLnN0YXR1c0NvZGUgPSBlcnJvci5zdGF0dXM7IC8vIGJhY2t3YXJkcy1jb21wYXQgb25seVxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGVycm9yLnJhd1Jlc3BvbnNlID0gbnVsbDtcclxuICAgICAgICBlcnJvci5zdGF0dXMgPSBudWxsO1xyXG4gICAgICB9XHJcblxyXG4gICAgICByZXR1cm4gc2VsZi5jYWxsYmFjayhlcnJvcik7XHJcbiAgICB9XHJcblxyXG4gICAgc2VsZi5lbWl0KCdyZXNwb25zZScsIHJlcyk7XHJcblxyXG4gICAgbGV0IG5ld19lcnJvcjtcclxuICAgIHRyeSB7XHJcbiAgICAgIGlmICghc2VsZi5faXNSZXNwb25zZU9LKHJlcykpIHtcclxuICAgICAgICBuZXdfZXJyb3IgPSBuZXcgRXJyb3IoXHJcbiAgICAgICAgICByZXMuc3RhdHVzVGV4dCB8fCByZXMudGV4dCB8fCAnVW5zdWNjZXNzZnVsIEhUVFAgcmVzcG9uc2UnXHJcbiAgICAgICAgKTtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgIG5ld19lcnJvciA9IGVycjsgLy8gb2soKSBjYWxsYmFjayBjYW4gdGhyb3dcclxuICAgIH1cclxuXHJcbiAgICAvLyAjMTAwMCBkb24ndCBjYXRjaCBlcnJvcnMgZnJvbSB0aGUgY2FsbGJhY2sgdG8gYXZvaWQgZG91YmxlIGNhbGxpbmcgaXRcclxuICAgIGlmIChuZXdfZXJyb3IpIHtcclxuICAgICAgbmV3X2Vycm9yLm9yaWdpbmFsID0gZXJyb3I7XHJcbiAgICAgIG5ld19lcnJvci5yZXNwb25zZSA9IHJlcztcclxuICAgICAgbmV3X2Vycm9yLnN0YXR1cyA9IG5ld19lcnJvci5zdGF0dXMgfHwgcmVzLnN0YXR1cztcclxuICAgICAgc2VsZi5jYWxsYmFjayhuZXdfZXJyb3IsIHJlcyk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBzZWxmLmNhbGxiYWNrKG51bGwsIHJlcyk7XHJcbiAgICB9XHJcbiAgfSk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBNaXhpbiBgRW1pdHRlcmAgYW5kIGBSZXF1ZXN0QmFzZWAuXHJcbiAqL1xyXG5cclxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5ldy1jYXBcclxuRW1pdHRlcihSZXF1ZXN0LnByb3RvdHlwZSk7XHJcblxyXG5taXhpbihSZXF1ZXN0LnByb3RvdHlwZSwgUmVxdWVzdEJhc2UucHJvdG90eXBlKTtcclxuXHJcbi8qKlxyXG4gKiBTZXQgQ29udGVudC1UeXBlIHRvIGB0eXBlYCwgbWFwcGluZyB2YWx1ZXMgZnJvbSBgcmVxdWVzdC50eXBlc2AuXHJcbiAqXHJcbiAqIEV4YW1wbGVzOlxyXG4gKlxyXG4gKiAgICAgIHN1cGVyYWdlbnQudHlwZXMueG1sID0gJ2FwcGxpY2F0aW9uL3htbCc7XHJcbiAqXHJcbiAqICAgICAgcmVxdWVzdC5wb3N0KCcvJylcclxuICogICAgICAgIC50eXBlKCd4bWwnKVxyXG4gKiAgICAgICAgLnNlbmQoeG1sc3RyaW5nKVxyXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XHJcbiAqXHJcbiAqICAgICAgcmVxdWVzdC5wb3N0KCcvJylcclxuICogICAgICAgIC50eXBlKCdhcHBsaWNhdGlvbi94bWwnKVxyXG4gKiAgICAgICAgLnNlbmQoeG1sc3RyaW5nKVxyXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSB0eXBlXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3QucHJvdG90eXBlLnR5cGUgPSBmdW5jdGlvbiAodHlwZSkge1xyXG4gIHRoaXMuc2V0KCdDb250ZW50LVR5cGUnLCByZXF1ZXN0LnR5cGVzW3R5cGVdIHx8IHR5cGUpO1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFNldCBBY2NlcHQgdG8gYHR5cGVgLCBtYXBwaW5nIHZhbHVlcyBmcm9tIGByZXF1ZXN0LnR5cGVzYC5cclxuICpcclxuICogRXhhbXBsZXM6XHJcbiAqXHJcbiAqICAgICAgc3VwZXJhZ2VudC50eXBlcy5qc29uID0gJ2FwcGxpY2F0aW9uL2pzb24nO1xyXG4gKlxyXG4gKiAgICAgIHJlcXVlc3QuZ2V0KCcvYWdlbnQnKVxyXG4gKiAgICAgICAgLmFjY2VwdCgnanNvbicpXHJcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcclxuICpcclxuICogICAgICByZXF1ZXN0LmdldCgnL2FnZW50JylcclxuICogICAgICAgIC5hY2NlcHQoJ2FwcGxpY2F0aW9uL2pzb24nKVxyXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBhY2NlcHRcclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuYWNjZXB0ID0gZnVuY3Rpb24gKHR5cGUpIHtcclxuICB0aGlzLnNldCgnQWNjZXB0JywgcmVxdWVzdC50eXBlc1t0eXBlXSB8fCB0eXBlKTtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBTZXQgQXV0aG9yaXphdGlvbiBmaWVsZCB2YWx1ZSB3aXRoIGB1c2VyYCBhbmQgYHBhc3NgLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gdXNlclxyXG4gKiBAcGFyYW0ge1N0cmluZ30gW3Bhc3NdIG9wdGlvbmFsIGluIGNhc2Ugb2YgdXNpbmcgJ2JlYXJlcicgYXMgdHlwZVxyXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyB3aXRoICd0eXBlJyBwcm9wZXJ0eSAnYXV0bycsICdiYXNpYycgb3IgJ2JlYXJlcicgKGRlZmF1bHQgJ2Jhc2ljJylcclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuYXV0aCA9IGZ1bmN0aW9uICh1c2VyLCBwYXNzLCBvcHRpb25zKSB7XHJcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDEpIHBhc3MgPSAnJztcclxuICBpZiAodHlwZW9mIHBhc3MgPT09ICdvYmplY3QnICYmIHBhc3MgIT09IG51bGwpIHtcclxuICAgIC8vIHBhc3MgaXMgb3B0aW9uYWwgYW5kIGNhbiBiZSByZXBsYWNlZCB3aXRoIG9wdGlvbnNcclxuICAgIG9wdGlvbnMgPSBwYXNzO1xyXG4gICAgcGFzcyA9ICcnO1xyXG4gIH1cclxuXHJcbiAgaWYgKCFvcHRpb25zKSB7XHJcbiAgICBvcHRpb25zID0ge1xyXG4gICAgICB0eXBlOiB0eXBlb2YgYnRvYSA9PT0gJ2Z1bmN0aW9uJyA/ICdiYXNpYycgOiAnYXV0bydcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBjb25zdCBlbmNvZGVyID0gb3B0aW9ucy5lbmNvZGVyXHJcbiAgICA/IG9wdGlvbnMuZW5jb2RlclxyXG4gICAgOiAoc3RyaW5nKSA9PiB7XHJcbiAgICAgICAgaWYgKHR5cGVvZiBidG9hID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICByZXR1cm4gYnRvYShzdHJpbmcpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgdXNlIGJhc2ljIGF1dGgsIGJ0b2EgaXMgbm90IGEgZnVuY3Rpb24nKTtcclxuICAgICAgfTtcclxuXHJcbiAgcmV0dXJuIHRoaXMuX2F1dGgodXNlciwgcGFzcywgb3B0aW9ucywgZW5jb2Rlcik7XHJcbn07XHJcblxyXG4vKipcclxuICogQWRkIHF1ZXJ5LXN0cmluZyBgdmFsYC5cclxuICpcclxuICogRXhhbXBsZXM6XHJcbiAqXHJcbiAqICAgcmVxdWVzdC5nZXQoJy9zaG9lcycpXHJcbiAqICAgICAucXVlcnkoJ3NpemU9MTAnKVxyXG4gKiAgICAgLnF1ZXJ5KHsgY29sb3I6ICdibHVlJyB9KVxyXG4gKlxyXG4gKiBAcGFyYW0ge09iamVjdHxTdHJpbmd9IHZhbFxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS5xdWVyeSA9IGZ1bmN0aW9uICh2YWx1ZSkge1xyXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnKSB2YWx1ZSA9IHNlcmlhbGl6ZSh2YWx1ZSk7XHJcbiAgaWYgKHZhbHVlKSB0aGlzLl9xdWVyeS5wdXNoKHZhbHVlKTtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBRdWV1ZSB0aGUgZ2l2ZW4gYGZpbGVgIGFzIGFuIGF0dGFjaG1lbnQgdG8gdGhlIHNwZWNpZmllZCBgZmllbGRgLFxyXG4gKiB3aXRoIG9wdGlvbmFsIGBvcHRpb25zYCAob3IgZmlsZW5hbWUpLlxyXG4gKlxyXG4gKiBgYGAganNcclxuICogcmVxdWVzdC5wb3N0KCcvdXBsb2FkJylcclxuICogICAuYXR0YWNoKCdjb250ZW50JywgbmV3IEJsb2IoWyc8YSBpZD1cImFcIj48YiBpZD1cImJcIj5oZXkhPC9iPjwvYT4nXSwgeyB0eXBlOiBcInRleHQvaHRtbFwifSkpXHJcbiAqICAgLmVuZChjYWxsYmFjayk7XHJcbiAqIGBgYFxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gZmllbGRcclxuICogQHBhcmFtIHtCbG9ifEZpbGV9IGZpbGVcclxuICogQHBhcmFtIHtTdHJpbmd8T2JqZWN0fSBvcHRpb25zXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3QucHJvdG90eXBlLmF0dGFjaCA9IGZ1bmN0aW9uIChmaWVsZCwgZmlsZSwgb3B0aW9ucykge1xyXG4gIGlmIChmaWxlKSB7XHJcbiAgICBpZiAodGhpcy5fZGF0YSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzdXBlcmFnZW50IGNhbid0IG1peCAuc2VuZCgpIGFuZCAuYXR0YWNoKClcIik7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5fZ2V0Rm9ybURhdGEoKS5hcHBlbmQoZmllbGQsIGZpbGUsIG9wdGlvbnMgfHwgZmlsZS5uYW1lKTtcclxuICB9XHJcblxyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuX2dldEZvcm1EYXRhID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICghdGhpcy5fZm9ybURhdGEpIHtcclxuICAgIHRoaXMuX2Zvcm1EYXRhID0gbmV3IHJvb3QuRm9ybURhdGEoKTtcclxuICB9XHJcblxyXG4gIHJldHVybiB0aGlzLl9mb3JtRGF0YTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBJbnZva2UgdGhlIGNhbGxiYWNrIHdpdGggYGVycmAgYW5kIGByZXNgXHJcbiAqIGFuZCBoYW5kbGUgYXJpdHkgY2hlY2suXHJcbiAqXHJcbiAqIEBwYXJhbSB7RXJyb3J9IGVyclxyXG4gKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXNcclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuY2FsbGJhY2sgPSBmdW5jdGlvbiAoZXJyb3IsIHJlcykge1xyXG4gIGlmICh0aGlzLmNhbGxlZCkgcmV0dXJuO1xyXG5cclxuICBpZiAodGhpcy5fc2hvdWxkUmV0cnkoZXJyb3IsIHJlcykpIHtcclxuICAgIHJldHVybiB0aGlzLl9yZXRyeSgpO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgZm4gPSB0aGlzLl9jYWxsYmFjaztcclxuICB0aGlzLmNsZWFyVGltZW91dCgpO1xyXG4gIHRoaXMuY2FsbGVkID0gdHJ1ZTtcclxuXHJcbiAgaWYgKGVycm9yKSB7XHJcbiAgICBpZiAodGhpcy5fbWF4UmV0cmllcykgZXJyb3IucmV0cmllcyA9IHRoaXMuX3JldHJpZXMgLSAxO1xyXG4gICAgdGhpcy5lbWl0KCdlcnJvcicsIGVycm9yKTtcclxuICB9XHJcblxyXG4gIGZuKGVycm9yLCByZXMpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEludm9rZSBjYWxsYmFjayB3aXRoIHgtZG9tYWluIGVycm9yLlxyXG4gKlxyXG4gKiBAYXBpIHByaXZhdGVcclxuICovXHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS5jcm9zc0RvbWFpbkVycm9yID0gZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKFxyXG4gICAgJ1JlcXVlc3QgaGFzIGJlZW4gdGVybWluYXRlZFxcblBvc3NpYmxlIGNhdXNlczogdGhlIG5ldHdvcmsgaXMgb2ZmbGluZSwgT3JpZ2luIGlzIG5vdCBhbGxvd2VkIGJ5IEFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbiwgdGhlIHBhZ2UgaXMgYmVpbmcgdW5sb2FkZWQsIGV0Yy4nXHJcbiAgKTtcclxuICBlcnJvci5jcm9zc0RvbWFpbiA9IHRydWU7XHJcblxyXG4gIGVycm9yLnN0YXR1cyA9IHRoaXMuc3RhdHVzO1xyXG4gIGVycm9yLm1ldGhvZCA9IHRoaXMubWV0aG9kO1xyXG4gIGVycm9yLnVybCA9IHRoaXMudXJsO1xyXG5cclxuICB0aGlzLmNhbGxiYWNrKGVycm9yKTtcclxufTtcclxuXHJcbi8vIFRoaXMgb25seSB3YXJucywgYmVjYXVzZSB0aGUgcmVxdWVzdCBpcyBzdGlsbCBsaWtlbHkgdG8gd29ya1xyXG5SZXF1ZXN0LnByb3RvdHlwZS5hZ2VudCA9IGZ1bmN0aW9uICgpIHtcclxuICBjb25zb2xlLndhcm4oJ1RoaXMgaXMgbm90IHN1cHBvcnRlZCBpbiBicm93c2VyIHZlcnNpb24gb2Ygc3VwZXJhZ2VudCcpO1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuY2EgPSBSZXF1ZXN0LnByb3RvdHlwZS5hZ2VudDtcclxuUmVxdWVzdC5wcm90b3R5cGUuYnVmZmVyID0gUmVxdWVzdC5wcm90b3R5cGUuY2E7XHJcblxyXG4vLyBUaGlzIHRocm93cywgYmVjYXVzZSBpdCBjYW4ndCBzZW5kL3JlY2VpdmUgZGF0YSBhcyBleHBlY3RlZFxyXG5SZXF1ZXN0LnByb3RvdHlwZS53cml0ZSA9ICgpID0+IHtcclxuICB0aHJvdyBuZXcgRXJyb3IoXHJcbiAgICAnU3RyZWFtaW5nIGlzIG5vdCBzdXBwb3J0ZWQgaW4gYnJvd3NlciB2ZXJzaW9uIG9mIHN1cGVyYWdlbnQnXHJcbiAgKTtcclxufTtcclxuXHJcblJlcXVlc3QucHJvdG90eXBlLnBpcGUgPSBSZXF1ZXN0LnByb3RvdHlwZS53cml0ZTtcclxuXHJcbi8qKlxyXG4gKiBDaGVjayBpZiBgb2JqYCBpcyBhIGhvc3Qgb2JqZWN0LFxyXG4gKiB3ZSBkb24ndCB3YW50IHRvIHNlcmlhbGl6ZSB0aGVzZSA6KVxyXG4gKlxyXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqIGhvc3Qgb2JqZWN0XHJcbiAqIEByZXR1cm4ge0Jvb2xlYW59IGlzIGEgaG9zdCBvYmplY3RcclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5SZXF1ZXN0LnByb3RvdHlwZS5faXNIb3N0ID0gZnVuY3Rpb24gKG9iamVjdCkge1xyXG4gIC8vIE5hdGl2ZSBvYmplY3RzIHN0cmluZ2lmeSB0byBbb2JqZWN0IEZpbGVdLCBbb2JqZWN0IEJsb2JdLCBbb2JqZWN0IEZvcm1EYXRhXSwgZXRjLlxyXG4gIHJldHVybiAoXHJcbiAgICBvYmplY3QgJiZcclxuICAgIHR5cGVvZiBvYmplY3QgPT09ICdvYmplY3QnICYmXHJcbiAgICAhQXJyYXkuaXNBcnJheShvYmplY3QpICYmXHJcbiAgICBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwob2JqZWN0KSAhPT0gJ1tvYmplY3QgT2JqZWN0XSdcclxuICApO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEluaXRpYXRlIHJlcXVlc3QsIGludm9raW5nIGNhbGxiYWNrIGBmbihyZXMpYFxyXG4gKiB3aXRoIGFuIGluc3RhbmNlb2YgYFJlc3BvbnNlYC5cclxuICpcclxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuZW5kID0gZnVuY3Rpb24gKGZuKSB7XHJcbiAgaWYgKHRoaXMuX2VuZENhbGxlZCkge1xyXG4gICAgY29uc29sZS53YXJuKFxyXG4gICAgICAnV2FybmluZzogLmVuZCgpIHdhcyBjYWxsZWQgdHdpY2UuIFRoaXMgaXMgbm90IHN1cHBvcnRlZCBpbiBzdXBlcmFnZW50J1xyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHRoaXMuX2VuZENhbGxlZCA9IHRydWU7XHJcblxyXG4gIC8vIHN0b3JlIGNhbGxiYWNrXHJcbiAgdGhpcy5fY2FsbGJhY2sgPSBmbiB8fCBub29wO1xyXG5cclxuICAvLyBxdWVyeXN0cmluZ1xyXG4gIHRoaXMuX2ZpbmFsaXplUXVlcnlTdHJpbmcoKTtcclxuXHJcbiAgdGhpcy5fZW5kKCk7XHJcbn07XHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS5fc2V0VXBsb2FkVGltZW91dCA9IGZ1bmN0aW9uICgpIHtcclxuICBjb25zdCBzZWxmID0gdGhpcztcclxuXHJcbiAgLy8gdXBsb2FkIHRpbWVvdXQgaXQncyB3b2tycyBvbmx5IGlmIGRlYWRsaW5lIHRpbWVvdXQgaXMgb2ZmXHJcbiAgaWYgKHRoaXMuX3VwbG9hZFRpbWVvdXQgJiYgIXRoaXMuX3VwbG9hZFRpbWVvdXRUaW1lcikge1xyXG4gICAgdGhpcy5fdXBsb2FkVGltZW91dFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgIHNlbGYuX3RpbWVvdXRFcnJvcihcclxuICAgICAgICAnVXBsb2FkIHRpbWVvdXQgb2YgJyxcclxuICAgICAgICBzZWxmLl91cGxvYWRUaW1lb3V0LFxyXG4gICAgICAgICdFVElNRURPVVQnXHJcbiAgICAgICk7XHJcbiAgICB9LCB0aGlzLl91cGxvYWRUaW1lb3V0KTtcclxuICB9XHJcbn07XHJcblxyXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgY29tcGxleGl0eVxyXG5SZXF1ZXN0LnByb3RvdHlwZS5fZW5kID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0aGlzLl9hYm9ydGVkKVxyXG4gICAgcmV0dXJuIHRoaXMuY2FsbGJhY2soXHJcbiAgICAgIG5ldyBFcnJvcignVGhlIHJlcXVlc3QgaGFzIGJlZW4gYWJvcnRlZCBldmVuIGJlZm9yZSAuZW5kKCkgd2FzIGNhbGxlZCcpXHJcbiAgICApO1xyXG5cclxuICBjb25zdCBzZWxmID0gdGhpcztcclxuICB0aGlzLnhociA9IHJlcXVlc3QuZ2V0WEhSKCk7XHJcbiAgY29uc3QgeyB4aHIgfSA9IHRoaXM7XHJcbiAgbGV0IGRhdGEgPSB0aGlzLl9mb3JtRGF0YSB8fCB0aGlzLl9kYXRhO1xyXG5cclxuICB0aGlzLl9zZXRUaW1lb3V0cygpO1xyXG5cclxuICAvLyBzdGF0ZSBjaGFuZ2VcclxuICB4aHIuYWRkRXZlbnRMaXN0ZW5lcigncmVhZHlzdGF0ZWNoYW5nZScsICgpID0+IHtcclxuICAgIGNvbnN0IHsgcmVhZHlTdGF0ZSB9ID0geGhyO1xyXG4gICAgaWYgKHJlYWR5U3RhdGUgPj0gMiAmJiBzZWxmLl9yZXNwb25zZVRpbWVvdXRUaW1lcikge1xyXG4gICAgICBjbGVhclRpbWVvdXQoc2VsZi5fcmVzcG9uc2VUaW1lb3V0VGltZXIpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChyZWFkeVN0YXRlICE9PSA0KSB7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoc2VsZi5oYXNTaXplRXJyb3IoKSkgcmV0dXJuO1xyXG5cclxuICAgIC8vIEluIElFOSwgcmVhZHMgdG8gYW55IHByb3BlcnR5IChlLmcuIHN0YXR1cykgb2ZmIG9mIGFuIGFib3J0ZWQgWEhSIHdpbGxcclxuICAgIC8vIHJlc3VsdCBpbiB0aGUgZXJyb3IgXCJDb3VsZCBub3QgY29tcGxldGUgdGhlIG9wZXJhdGlvbiBkdWUgdG8gZXJyb3IgYzAwYzAyM2ZcIlxyXG4gICAgbGV0IHN0YXR1cztcclxuICAgIHRyeSB7XHJcbiAgICAgIHN0YXR1cyA9IHhoci5zdGF0dXM7XHJcbiAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgc3RhdHVzID0gMDtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIXN0YXR1cykge1xyXG4gICAgICBpZiAoc2VsZi50aW1lZG91dCB8fCBzZWxmLl9hYm9ydGVkKSByZXR1cm47XHJcbiAgICAgIHJldHVybiBzZWxmLmNyb3NzRG9tYWluRXJyb3IoKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoXHJcbiAgICAgIHNlbGYuX21heFJlc3BvbnNlU2l6ZSAhPT0gdW5kZWZpbmVkICYmXHJcbiAgICAgIGdldFJlc3BvbnNlU2l6ZSh4aHIpID4gc2VsZi5fbWF4UmVzcG9uc2VTaXplXHJcbiAgICApIHtcclxuICAgICAgY29uc3QgZXJyb3IgPSBzZWxmLl9jcmVhdGVTaXplRXJyb3IoJ3Jlc3BvbnNlJyk7XHJcbiAgICAgIHhoci5hYm9ydCgpO1xyXG4gICAgICByZXR1cm4gc2VsZi5jYWxsYmFjayhlcnJvcik7XHJcbiAgICB9XHJcblxyXG4gICAgc2VsZi5lbWl0KCdlbmQnKTtcclxuICB9KTtcclxuXHJcbiAgLy8gcHJvZ3Jlc3NcclxuICBjb25zdCBoYW5kbGVQcm9ncmVzcyA9IChkaXJlY3Rpb24sIGUpID0+IHtcclxuICAgIGlmIChcclxuICAgICAgZGlyZWN0aW9uID09PSAndXBsb2FkJyAmJlxyXG4gICAgICBzZWxmLl9tYXhSZXF1ZXN0U2l6ZSAhPT0gdW5kZWZpbmVkICYmXHJcbiAgICAgIGUubG9hZGVkID4gc2VsZi5fbWF4UmVxdWVzdFNpemVcclxuICAgICkge1xyXG4gICAgICBjb25zdCBlcnJvciA9IHNlbGYuX2NyZWF0ZVNpemVFcnJvcigncmVxdWVzdCcpO1xyXG4gICAgICB4aHIuYWJvcnQoKTtcclxuICAgICAgc2VsZi5jYWxsYmFjayhlcnJvcik7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoZS50b3RhbCA+IDApIHtcclxuICAgICAgZS5wZXJjZW50ID0gKGUubG9hZGVkIC8gZS50b3RhbCkgKiAxMDA7XHJcblxyXG4gICAgICBpZiAoZS5wZXJjZW50ID09PSAxMDApIHtcclxuICAgICAgICBjbGVhclRpbWVvdXQoc2VsZi5fdXBsb2FkVGltZW91dFRpbWVyKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGUuZGlyZWN0aW9uID0gZGlyZWN0aW9uO1xyXG4gICAgc2VsZi5lbWl0KCdwcm9ncmVzcycsIGUpO1xyXG4gIH07XHJcblxyXG4gIGlmICh0aGlzLmhhc0xpc3RlbmVycygncHJvZ3Jlc3MnKSB8fCB0aGlzLl9tYXhSZXF1ZXN0U2l6ZSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICB4aHIuYWRkRXZlbnRMaXN0ZW5lcigncHJvZ3Jlc3MnLCBoYW5kbGVQcm9ncmVzcy5iaW5kKG51bGwsICdkb3dubG9hZCcpKTtcclxuICAgICAgaWYgKHhoci51cGxvYWQpIHtcclxuICAgICAgICB4aHIudXBsb2FkLmFkZEV2ZW50TGlzdGVuZXIoXHJcbiAgICAgICAgICAncHJvZ3Jlc3MnLFxyXG4gICAgICAgICAgaGFuZGxlUHJvZ3Jlc3MuYmluZChudWxsLCAndXBsb2FkJylcclxuICAgICAgICApO1xyXG4gICAgICB9XHJcbiAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgLy8gQWNjZXNzaW5nIHhoci51cGxvYWQgZmFpbHMgaW4gSUUgZnJvbSBhIHdlYiB3b3JrZXIsIHNvIGp1c3QgcHJldGVuZCBpdCBkb2Vzbid0IGV4aXN0LlxyXG4gICAgICAvLyBSZXBvcnRlZCBoZXJlOlxyXG4gICAgICAvLyBodHRwczovL2Nvbm5lY3QubWljcm9zb2Z0LmNvbS9JRS9mZWVkYmFjay9kZXRhaWxzLzgzNzI0NS94bWxodHRwcmVxdWVzdC11cGxvYWQtdGhyb3dzLWludmFsaWQtYXJndW1lbnQtd2hlbi11c2VkLWZyb20td2ViLXdvcmtlci1jb250ZXh0XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBpZiAoeGhyLnVwbG9hZCkge1xyXG4gICAgdGhpcy5fc2V0VXBsb2FkVGltZW91dCgpO1xyXG4gIH1cclxuXHJcbiAgLy8gaW5pdGlhdGUgcmVxdWVzdFxyXG4gIHRyeSB7XHJcbiAgICBpZiAodGhpcy51c2VybmFtZSAmJiB0aGlzLnBhc3N3b3JkKSB7XHJcbiAgICAgIHhoci5vcGVuKHRoaXMubWV0aG9kLCB0aGlzLnVybCwgdHJ1ZSwgdGhpcy51c2VybmFtZSwgdGhpcy5wYXNzd29yZCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICB4aHIub3Blbih0aGlzLm1ldGhvZCwgdGhpcy51cmwsIHRydWUpO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGVycikge1xyXG4gICAgLy8gc2VlICMxMTQ5XHJcbiAgICByZXR1cm4gdGhpcy5jYWxsYmFjayhlcnIpO1xyXG4gIH1cclxuXHJcbiAgLy8gQ09SU1xyXG4gIGlmICh0aGlzLl93aXRoQ3JlZGVudGlhbHMpIHhoci53aXRoQ3JlZGVudGlhbHMgPSB0cnVlO1xyXG5cclxuICAvLyBib2R5XHJcbiAgaWYgKFxyXG4gICAgIXRoaXMuX2Zvcm1EYXRhICYmXHJcbiAgICB0aGlzLm1ldGhvZCAhPT0gJ0dFVCcgJiZcclxuICAgIHRoaXMubWV0aG9kICE9PSAnSEVBRCcgJiZcclxuICAgIHR5cGVvZiBkYXRhICE9PSAnc3RyaW5nJyAmJlxyXG4gICAgIXRoaXMuX2lzSG9zdChkYXRhKVxyXG4gICkge1xyXG4gICAgLy8gc2VyaWFsaXplIHN0dWZmXHJcbiAgICBjb25zdCBjb250ZW50VHlwZSA9IHRoaXMuX2hlYWRlclsnY29udGVudC10eXBlJ107XHJcbiAgICBsZXQgc2VyaWFsaXplID1cclxuICAgICAgdGhpcy5fc2VyaWFsaXplciB8fFxyXG4gICAgICByZXF1ZXN0LnNlcmlhbGl6ZVtjb250ZW50VHlwZSA/IGNvbnRlbnRUeXBlLnNwbGl0KCc7JylbMF0gOiAnJ107XHJcbiAgICBpZiAoIXNlcmlhbGl6ZSAmJiBpc0pTT04oY29udGVudFR5cGUpKSB7XHJcbiAgICAgIHNlcmlhbGl6ZSA9IHJlcXVlc3Quc2VyaWFsaXplWydhcHBsaWNhdGlvbi9qc29uJ107XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHNlcmlhbGl6ZSkgZGF0YSA9IHNlcmlhbGl6ZShkYXRhKTtcclxuICB9XHJcblxyXG4gIGlmIChcclxuICAgIHRoaXMuX21heFJlcXVlc3RTaXplICE9PSB1bmRlZmluZWQgJiZcclxuICAgIGJ5dGVMZW5ndGgoZGF0YSkgPiB0aGlzLl9tYXhSZXF1ZXN0U2l6ZVxyXG4gICkge1xyXG4gICAgY29uc3QgZXJyb3IgPSB0aGlzLl9jcmVhdGVTaXplRXJyb3IoJ3JlcXVlc3QnKTtcclxuICAgIHhoci5hYm9ydCgpO1xyXG4gICAgcmV0dXJuIHRoaXMuY2FsbGJhY2soZXJyb3IpO1xyXG4gIH1cclxuXHJcbiAgLy8gc2V0IGhlYWRlciBmaWVsZHNcclxuICBmb3IgKGNvbnN0IGZpZWxkIGluIHRoaXMuaGVhZGVyKSB7XHJcbiAgICBpZiAodGhpcy5oZWFkZXJbZmllbGRdID09PSBudWxsKSBjb250aW51ZTtcclxuXHJcbiAgICBpZiAoaGFzT3duKHRoaXMuaGVhZGVyLCBmaWVsZCkpXHJcbiAgICAgIHhoci5zZXRSZXF1ZXN0SGVhZGVyKGZpZWxkLCB0aGlzLmhlYWRlcltmaWVsZF0pO1xyXG4gIH1cclxuXHJcbiAgaWYgKHRoaXMuX3Jlc3BvbnNlVHlwZSkge1xyXG4gICAgeGhyLnJlc3BvbnNlVHlwZSA9IHRoaXMuX3Jlc3BvbnNlVHlwZTtcclxuICB9XHJcblxyXG4gIC8vIHNlbmQgc3R1ZmZcclxuICB0aGlzLmVtaXQoJ3JlcXVlc3QnLCB0aGlzKTtcclxuXHJcbiAgLy8gSUUxMSB4aHIuc2VuZCh1bmRlZmluZWQpIHNlbmRzICd1bmRlZmluZWQnIHN0cmluZyBhcyBQT1NUIHBheWxvYWQgKGluc3RlYWQgb2Ygbm90aGluZylcclxuICAvLyBXZSBuZWVkIG51bGwgaGVyZSBpZiBkYXRhIGlzIHVuZGVmaW5lZFxyXG4gIHhoci5zZW5kKHR5cGVvZiBkYXRhID09PSAndW5kZWZpbmVkJyA/IG51bGwgOiBkYXRhKTtcclxufTtcclxuXHJcbnJlcXVlc3QuYWdlbnQgPSAoKSA9PiBuZXcgQWdlbnQoKTtcclxuXHJcbmZ1bmN0aW9uIGdldFJlc3BvbnNlU2l6ZSh4aHIpIHtcclxuICBpZiAoeGhyLnJlc3BvbnNlICYmIHR5cGVvZiB4aHIucmVzcG9uc2UuYnl0ZUxlbmd0aCA9PT0gJ251bWJlcicpIHtcclxuICAgIHJldHVybiB4aHIucmVzcG9uc2UuYnl0ZUxlbmd0aDtcclxuICB9XHJcblxyXG4gIGlmICh4aHIucmVzcG9uc2UgJiYgdHlwZW9mIHhoci5yZXNwb25zZS5zaXplID09PSAnbnVtYmVyJykge1xyXG4gICAgcmV0dXJuIHhoci5yZXNwb25zZS5zaXplO1xyXG4gIH1cclxuXHJcbiAgdHJ5IHtcclxuICAgIHJldHVybiBieXRlTGVuZ3RoKHhoci5yZXNwb25zZVRleHQgfHwgJycpO1xyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAvLyByZXNwb25zZVRleHQgaXMgaW5hY2Nlc3NpYmxlIGZvciByZXNwb25zZVR5cGUgdmFsdWVzIHN1Y2ggYXMganNvbi5cclxuICAgIHJldHVybiAwO1xyXG4gIH1cclxufVxyXG5cclxuZm9yIChjb25zdCBtZXRob2Qgb2YgWydHRVQnLCAnUE9TVCcsICdPUFRJT05TJywgJ1BBVENIJywgJ1BVVCcsICdERUxFVEUnXSkge1xyXG4gIEFnZW50LnByb3RvdHlwZVttZXRob2QudG9Mb3dlckNhc2UoKV0gPSBmdW5jdGlvbiAodXJsLCBmbikge1xyXG4gICAgY29uc3QgcmVxdWVzdF8gPSBuZXcgcmVxdWVzdC5SZXF1ZXN0KG1ldGhvZCwgdXJsKTtcclxuICAgIHRoaXMuX3NldERlZmF1bHRzKHJlcXVlc3RfKTtcclxuICAgIGlmIChmbikge1xyXG4gICAgICByZXF1ZXN0Xy5lbmQoZm4pO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXF1ZXN0XztcclxuICB9O1xyXG59XHJcblxyXG5BZ2VudC5wcm90b3R5cGUuZGVsID0gQWdlbnQucHJvdG90eXBlLmRlbGV0ZTtcclxuXHJcbi8qKlxyXG4gKiBHRVQgYHVybGAgd2l0aCBvcHRpb25hbCBjYWxsYmFjayBgZm4ocmVzKWAuXHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSB1cmxcclxuICogQHBhcmFtIHtNaXhlZHxGdW5jdGlvbn0gW2RhdGFdIG9yIGZuXHJcbiAqIEBwYXJhbSB7RnVuY3Rpb259IFtmbl1cclxuICogQHJldHVybiB7UmVxdWVzdH1cclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5yZXF1ZXN0LmdldCA9ICh1cmwsIGRhdGEsIGZuKSA9PiB7XHJcbiAgY29uc3QgcmVxdWVzdF8gPSByZXF1ZXN0KCdHRVQnLCB1cmwpO1xyXG4gIGlmICh0eXBlb2YgZGF0YSA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgZm4gPSBkYXRhO1xyXG4gICAgZGF0YSA9IG51bGw7XHJcbiAgfVxyXG5cclxuICBpZiAoZGF0YSkgcmVxdWVzdF8ucXVlcnkoZGF0YSk7XHJcbiAgaWYgKGZuKSByZXF1ZXN0Xy5lbmQoZm4pO1xyXG4gIHJldHVybiByZXF1ZXN0XztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBIRUFEIGB1cmxgIHdpdGggb3B0aW9uYWwgY2FsbGJhY2sgYGZuKHJlcylgLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXHJcbiAqIEBwYXJhbSB7TWl4ZWR8RnVuY3Rpb259IFtkYXRhXSBvciBmblxyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbZm5dXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxucmVxdWVzdC5oZWFkID0gKHVybCwgZGF0YSwgZm4pID0+IHtcclxuICBjb25zdCByZXF1ZXN0XyA9IHJlcXVlc3QoJ0hFQUQnLCB1cmwpO1xyXG4gIGlmICh0eXBlb2YgZGF0YSA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgZm4gPSBkYXRhO1xyXG4gICAgZGF0YSA9IG51bGw7XHJcbiAgfVxyXG5cclxuICBpZiAoZGF0YSkgcmVxdWVzdF8ucXVlcnkoZGF0YSk7XHJcbiAgaWYgKGZuKSByZXF1ZXN0Xy5lbmQoZm4pO1xyXG4gIHJldHVybiByZXF1ZXN0XztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBPUFRJT05TIHF1ZXJ5IHRvIGB1cmxgIHdpdGggb3B0aW9uYWwgY2FsbGJhY2sgYGZuKHJlcylgLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXHJcbiAqIEBwYXJhbSB7TWl4ZWR8RnVuY3Rpb259IFtkYXRhXSBvciBmblxyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbZm5dXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxucmVxdWVzdC5vcHRpb25zID0gKHVybCwgZGF0YSwgZm4pID0+IHtcclxuICBjb25zdCByZXF1ZXN0XyA9IHJlcXVlc3QoJ09QVElPTlMnLCB1cmwpO1xyXG4gIGlmICh0eXBlb2YgZGF0YSA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgZm4gPSBkYXRhO1xyXG4gICAgZGF0YSA9IG51bGw7XHJcbiAgfVxyXG5cclxuICBpZiAoZGF0YSkgcmVxdWVzdF8uc2VuZChkYXRhKTtcclxuICBpZiAoZm4pIHJlcXVlc3RfLmVuZChmbik7XHJcbiAgcmV0dXJuIHJlcXVlc3RfO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIERFTEVURSBgdXJsYCB3aXRoIG9wdGlvbmFsIGBkYXRhYCBhbmQgY2FsbGJhY2sgYGZuKHJlcylgLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXHJcbiAqIEBwYXJhbSB7TWl4ZWR9IFtkYXRhXVxyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbZm5dXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuZnVuY3Rpb24gZGVsKHVybCwgZGF0YSwgZm4pIHtcclxuICBjb25zdCByZXF1ZXN0XyA9IHJlcXVlc3QoJ0RFTEVURScsIHVybCk7XHJcbiAgaWYgKHR5cGVvZiBkYXRhID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICBmbiA9IGRhdGE7XHJcbiAgICBkYXRhID0gbnVsbDtcclxuICB9XHJcblxyXG4gIGlmIChkYXRhKSByZXF1ZXN0Xy5zZW5kKGRhdGEpO1xyXG4gIGlmIChmbikgcmVxdWVzdF8uZW5kKGZuKTtcclxuICByZXR1cm4gcmVxdWVzdF87XHJcbn1cclxuXHJcbnJlcXVlc3QuZGVsID0gZGVsO1xyXG5yZXF1ZXN0LmRlbGV0ZSA9IGRlbDtcclxuXHJcbi8qKlxyXG4gKiBQQVRDSCBgdXJsYCB3aXRoIG9wdGlvbmFsIGBkYXRhYCBhbmQgY2FsbGJhY2sgYGZuKHJlcylgLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXHJcbiAqIEBwYXJhbSB7TWl4ZWR9IFtkYXRhXVxyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbZm5dXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxucmVxdWVzdC5wYXRjaCA9ICh1cmwsIGRhdGEsIGZuKSA9PiB7XHJcbiAgY29uc3QgcmVxdWVzdF8gPSByZXF1ZXN0KCdQQVRDSCcsIHVybCk7XHJcbiAgaWYgKHR5cGVvZiBkYXRhID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICBmbiA9IGRhdGE7XHJcbiAgICBkYXRhID0gbnVsbDtcclxuICB9XHJcblxyXG4gIGlmIChkYXRhKSByZXF1ZXN0Xy5zZW5kKGRhdGEpO1xyXG4gIGlmIChmbikgcmVxdWVzdF8uZW5kKGZuKTtcclxuICByZXR1cm4gcmVxdWVzdF87XHJcbn07XHJcblxyXG4vKipcclxuICogUE9TVCBgdXJsYCB3aXRoIG9wdGlvbmFsIGBkYXRhYCBhbmQgY2FsbGJhY2sgYGZuKHJlcylgLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXHJcbiAqIEBwYXJhbSB7TWl4ZWR9IFtkYXRhXVxyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbZm5dXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxucmVxdWVzdC5wb3N0ID0gKHVybCwgZGF0YSwgZm4pID0+IHtcclxuICBjb25zdCByZXF1ZXN0XyA9IHJlcXVlc3QoJ1BPU1QnLCB1cmwpO1xyXG4gIGlmICh0eXBlb2YgZGF0YSA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgZm4gPSBkYXRhO1xyXG4gICAgZGF0YSA9IG51bGw7XHJcbiAgfVxyXG5cclxuICBpZiAoZGF0YSkgcmVxdWVzdF8uc2VuZChkYXRhKTtcclxuICBpZiAoZm4pIHJlcXVlc3RfLmVuZChmbik7XHJcbiAgcmV0dXJuIHJlcXVlc3RfO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFBVVCBgdXJsYCB3aXRoIG9wdGlvbmFsIGBkYXRhYCBhbmQgY2FsbGJhY2sgYGZuKHJlcylgLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXHJcbiAqIEBwYXJhbSB7TWl4ZWR8RnVuY3Rpb259IFtkYXRhXSBvciBmblxyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbZm5dXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxucmVxdWVzdC5wdXQgPSAodXJsLCBkYXRhLCBmbikgPT4ge1xyXG4gIGNvbnN0IHJlcXVlc3RfID0gcmVxdWVzdCgnUFVUJywgdXJsKTtcclxuICBpZiAodHlwZW9mIGRhdGEgPT09ICdmdW5jdGlvbicpIHtcclxuICAgIGZuID0gZGF0YTtcclxuICAgIGRhdGEgPSBudWxsO1xyXG4gIH1cclxuXHJcbiAgaWYgKGRhdGEpIHJlcXVlc3RfLnNlbmQoZGF0YSk7XHJcbiAgaWYgKGZuKSByZXF1ZXN0Xy5lbmQoZm4pO1xyXG4gIHJldHVybiByZXF1ZXN0XztcclxufTtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTs7QUFFQSxJQUFJQSxJQUFJO0FBQ1IsSUFBSSxPQUFPQyxNQUFNLEtBQUssV0FBVyxFQUFFO0VBQ2pDO0VBQ0FELElBQUksR0FBR0MsTUFBTTtBQUNmLENBQUMsTUFBTSxJQUFJLE9BQU9DLElBQUksS0FBSyxXQUFXLEVBQUU7RUFDdEM7RUFDQUMsT0FBTyxDQUFDQyxJQUFJLENBQ1YscUVBQ0YsQ0FBQztFQUNESixJQUFJLFNBQU87QUFDYixDQUFDLE1BQU07RUFDTDtFQUNBQSxJQUFJLEdBQUdFLElBQUk7QUFDYjtBQUVBLE1BQU1HLE9BQU8sR0FBR0MsT0FBTyxDQUFDLG1CQUFtQixDQUFDO0FBQzVDLE1BQU1DLGFBQWEsR0FBR0QsT0FBTyxDQUFDLHFCQUFxQixDQUFDO0FBQ3BELE1BQU1FLEVBQUUsR0FBR0YsT0FBTyxDQUFDLElBQUksQ0FBQztBQUN4QixNQUFNRyxXQUFXLEdBQUdILE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQztBQUM3QyxNQUFNO0VBQUVJLFFBQVE7RUFBRUMsS0FBSztFQUFFQyxNQUFNO0VBQUVDO0FBQVcsQ0FBQyxHQUFHUCxPQUFPLENBQUMsU0FBUyxDQUFDO0FB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
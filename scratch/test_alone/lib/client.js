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
  hasOwn
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
  if (this._shouldRetry(error, res)) {
    return this._retry();
  }
  const fn = this._callback;
  this.clearTimeout();
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
    self.emit('end');
  });

  // progress
  const handleProgress = (direction, e) => {
    if (e.total > 0) {
      e.percent = e.loaded / e.total * 100;
      if (e.percent === 100) {
        clearTimeout(self._uploadTimeoutTimer);
      }
    }
    e.direction = direction;
    self.emit('progress', e);
  };
  if (this.hasListeners('progress')) {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJyb290Iiwid2luZG93Iiwic2VsZiIsImNvbnNvbGUiLCJ3YXJuIiwiRW1pdHRlciIsInJlcXVpcmUiLCJzYWZlU3RyaW5naWZ5IiwicXMiLCJSZXF1ZXN0QmFzZSIsImlzT2JqZWN0IiwibWl4aW4iLCJoYXNPd24iLCJSZXNwb25zZUJhc2UiLCJBZ2VudCIsIm5vb3AiLCJtb2R1bGUiLCJleHBvcnRzIiwibWV0aG9kIiwidXJsIiwiUmVxdWVzdCIsImVuZCIsImFyZ3VtZW50cyIsImxlbmd0aCIsInJlcXVlc3QiLCJnZXRYSFIiLCJYTUxIdHRwUmVxdWVzdCIsIkVycm9yIiwidHJpbSIsInMiLCJyZXBsYWNlIiwic2VyaWFsaXplIiwib2JqZWN0IiwicGFpcnMiLCJrZXkiLCJwdXNoRW5jb2RlZEtleVZhbHVlUGFpciIsImpvaW4iLCJ2YWx1ZSIsInVuZGVmaW5lZCIsInB1c2giLCJlbmNvZGVVUkkiLCJBcnJheSIsImlzQXJyYXkiLCJ2Iiwic3Via2V5IiwiZW5jb2RlVVJJQ29tcG9uZW50Iiwic2VyaWFsaXplT2JqZWN0IiwicGFyc2VTdHJpbmciLCJzdHJpbmdfIiwic3BsaXQiLCJwYWlyIiwicG9zIiwiaSIsImxlbmd0aF8iLCJpbmRleE9mIiwiZGVjb2RlVVJJQ29tcG9uZW50Iiwic2xpY2UiLCJ0eXBlcyIsImh0bWwiLCJqc29uIiwieG1sIiwidXJsZW5jb2RlZCIsImZvcm0iLCJvYmoiLCJzdHJpbmdpZnkiLCJpbmRpY2VzIiwic3RyaWN0TnVsbEhhbmRsaW5nIiwicGFyc2UiLCJKU09OIiwicGFyc2VIZWFkZXIiLCJsaW5lcyIsImZpZWxkcyIsImluZGV4IiwibGluZSIsImZpZWxkIiwidG9Mb3dlckNhc2UiLCJpc0pTT04iLCJtaW1lIiwidGVzdCIsIlJlc3BvbnNlIiwicmVxdWVzdF8iLCJyZXEiLCJ4aHIiLCJ0ZXh0IiwicmVzcG9uc2VUeXBlIiwicmVzcG9uc2VUZXh0Iiwic3RhdHVzVGV4dCIsInN0YXR1cyIsIl9zZXRTdGF0dXNQcm9wZXJ0aWVzIiwiaGVhZGVycyIsImdldEFsbFJlc3BvbnNlSGVhZGVycyIsImhlYWRlciIsImdldFJlc3BvbnNlSGVhZGVyIiwiX3NldEhlYWRlclByb3BlcnRpZXMiLCJfcmVzcG9uc2VUeXBlIiwiYm9keSIsInJlc3BvbnNlIiwiX3BhcnNlQm9keSIsInByb3RvdHlwZSIsInR5cGUiLCJfcGFyc2VyIiwiT2JqZWN0IiwidG9FcnJvciIsIm1lc3NhZ2UiLCJlcnJvciIsIl9xdWVyeSIsIl9oZWFkZXIiLCJvbiIsInJlcyIsImVyciIsIm9yaWdpbmFsIiwicmF3UmVzcG9uc2UiLCJzdGF0dXNDb2RlIiwiY2FsbGJhY2siLCJlbWl0IiwibmV3X2Vycm9yIiwiX2lzUmVzcG9uc2VPSyIsInNldCIsImFjY2VwdCIsImF1dGgiLCJ1c2VyIiwicGFzcyIsIm9wdGlvbnMiLCJidG9hIiwiZW5jb2RlciIsInN0cmluZyIsIl9hdXRoIiwicXVlcnkiLCJhdHRhY2giLCJmaWxlIiwiX2RhdGEiLCJfZ2V0Rm9ybURhdGEiLCJhcHBlbmQiLCJuYW1lIiwiX2Zvcm1EYXRhIiwiRm9ybURhdGEiLCJfc2hvdWxkUmV0cnkiLCJfcmV0cnkiLCJmbiIsIl9jYWxsYmFjayIsImNsZWFyVGltZW91dCIsIl9tYXhSZXRyaWVzIiwicmV0cmllcyIsIl9yZXRyaWVzIiwiY3Jvc3NEb21haW5FcnJvciIsImNyb3NzRG9tYWluIiwiYWdlbnQiLCJjYSIsImJ1ZmZlciIsIndyaXRlIiwicGlwZSIsIl9pc0hvc3QiLCJ0b1N0cmluZyIsImNhbGwiLCJfZW5kQ2FsbGVkIiwiX2ZpbmFsaXplUXVlcnlTdHJpbmciLCJfZW5kIiwiX3NldFVwbG9hZFRpbWVvdXQiLCJfdXBsb2FkVGltZW91dCIsIl91cGxvYWRUaW1lb3V0VGltZXIiLCJzZXRUaW1lb3V0IiwiX3RpbWVvdXRFcnJvciIsIl9hYm9ydGVkIiwiZGF0YSIsIl9zZXRUaW1lb3V0cyIsImFkZEV2ZW50TGlzdGVuZXIiLCJyZWFkeVN0YXRlIiwiX3Jlc3BvbnNlVGltZW91dFRpbWVyIiwidGltZWRvdXQiLCJoYW5kbGVQcm9ncmVzcyIsImRpcmVjdGlvbiIsImUiLCJ0b3RhbCIsInBlcmNlbnQiLCJsb2FkZWQiLCJoYXNMaXN0ZW5lcnMiLCJiaW5kIiwidXBsb2FkIiwidXNlcm5hbWUiLCJwYXNzd29yZCIsIm9wZW4iLCJfd2l0aENyZWRlbnRpYWxzIiwid2l0aENyZWRlbnRpYWxzIiwiY29udGVudFR5cGUiLCJfc2VyaWFsaXplciIsInNldFJlcXVlc3RIZWFkZXIiLCJzZW5kIiwiX3NldERlZmF1bHRzIiwiZGVsIiwiZGVsZXRlIiwiZ2V0IiwiaGVhZCIsInBhdGNoIiwicG9zdCIsInB1dCJdLCJzb3VyY2VzIjpbIi4uL3NyYy9jbGllbnQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFJvb3QgcmVmZXJlbmNlIGZvciBpZnJhbWVzLlxyXG4gKi9cclxuXHJcbmxldCByb290O1xyXG5pZiAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcpIHtcclxuICAvLyBCcm93c2VyIHdpbmRvd1xyXG4gIHJvb3QgPSB3aW5kb3c7XHJcbn0gZWxzZSBpZiAodHlwZW9mIHNlbGYgPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgLy8gT3RoZXIgZW52aXJvbm1lbnRzXHJcbiAgY29uc29sZS53YXJuKFxyXG4gICAgJ1VzaW5nIGJyb3dzZXItb25seSB2ZXJzaW9uIG9mIHN1cGVyYWdlbnQgaW4gbm9uLWJyb3dzZXIgZW52aXJvbm1lbnQnXHJcbiAgKTtcclxuICByb290ID0gdGhpcztcclxufSBlbHNlIHtcclxuICAvLyBXZWIgV29ya2VyXHJcbiAgcm9vdCA9IHNlbGY7XHJcbn1cclxuXHJcbmNvbnN0IEVtaXR0ZXIgPSByZXF1aXJlKCdjb21wb25lbnQtZW1pdHRlcicpO1xyXG5jb25zdCBzYWZlU3RyaW5naWZ5ID0gcmVxdWlyZSgnZmFzdC1zYWZlLXN0cmluZ2lmeScpO1xyXG5jb25zdCBxcyA9IHJlcXVpcmUoJ3FzJyk7XHJcbmNvbnN0IFJlcXVlc3RCYXNlID0gcmVxdWlyZSgnLi9yZXF1ZXN0LWJhc2UnKTtcclxuY29uc3QgeyBpc09iamVjdCwgbWl4aW4sIGhhc093biB9ID0gcmVxdWlyZSgnLi91dGlscycpO1xyXG5jb25zdCBSZXNwb25zZUJhc2UgPSByZXF1aXJlKCcuL3Jlc3BvbnNlLWJhc2UnKTtcclxuY29uc3QgQWdlbnQgPSByZXF1aXJlKCcuL2FnZW50LWJhc2UnKTtcclxuXHJcbi8qKlxyXG4gKiBOb29wLlxyXG4gKi9cclxuXHJcbmZ1bmN0aW9uIG5vb3AoKSB7fVxyXG5cclxuLyoqXHJcbiAqIEV4cG9zZSBgcmVxdWVzdGAuXHJcbiAqL1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAobWV0aG9kLCB1cmwpIHtcclxuICAvLyBjYWxsYmFja1xyXG4gIGlmICh0eXBlb2YgdXJsID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICByZXR1cm4gbmV3IGV4cG9ydHMuUmVxdWVzdCgnR0VUJywgbWV0aG9kKS5lbmQodXJsKTtcclxuICB9XHJcblxyXG4gIC8vIHVybCBmaXJzdFxyXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAxKSB7XHJcbiAgICByZXR1cm4gbmV3IGV4cG9ydHMuUmVxdWVzdCgnR0VUJywgbWV0aG9kKTtcclxuICB9XHJcblxyXG4gIHJldHVybiBuZXcgZXhwb3J0cy5SZXF1ZXN0KG1ldGhvZCwgdXJsKTtcclxufTtcclxuXHJcbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cztcclxuXHJcbmNvbnN0IHJlcXVlc3QgPSBleHBvcnRzO1xyXG5cclxuZXhwb3J0cy5SZXF1ZXN0ID0gUmVxdWVzdDtcclxuXHJcbi8qKlxyXG4gKiBEZXRlcm1pbmUgWEhSLlxyXG4gKi9cclxuXHJcbnJlcXVlc3QuZ2V0WEhSID0gKCkgPT4ge1xyXG4gIGlmIChyb290LlhNTEh0dHBSZXF1ZXN0KSB7XHJcbiAgICByZXR1cm4gbmV3IHJvb3QuWE1MSHR0cFJlcXVlc3QoKTtcclxuICB9XHJcblxyXG4gIHRocm93IG5ldyBFcnJvcignQnJvd3Nlci1vbmx5IHZlcnNpb24gb2Ygc3VwZXJhZ2VudCBjb3VsZCBub3QgZmluZCBYSFInKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZW1vdmVzIGxlYWRpbmcgYW5kIHRyYWlsaW5nIHdoaXRlc3BhY2UsIGFkZGVkIHRvIHN1cHBvcnQgSUUuXHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBzXHJcbiAqIEByZXR1cm4ge1N0cmluZ31cclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuY29uc3QgdHJpbSA9ICcnLnRyaW0gPyAocykgPT4gcy50cmltKCkgOiAocykgPT4gcy5yZXBsYWNlKC8oXlxccyp8XFxzKiQpL2csICcnKTtcclxuXHJcbi8qKlxyXG4gKiBTZXJpYWxpemUgdGhlIGdpdmVuIGBvYmpgLlxyXG4gKlxyXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqXHJcbiAqIEByZXR1cm4ge1N0cmluZ31cclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuZnVuY3Rpb24gc2VyaWFsaXplKG9iamVjdCkge1xyXG4gIGlmICghaXNPYmplY3Qob2JqZWN0KSkgcmV0dXJuIG9iamVjdDtcclxuICBjb25zdCBwYWlycyA9IFtdO1xyXG4gIGZvciAoY29uc3Qga2V5IGluIG9iamVjdCkge1xyXG4gICAgaWYgKGhhc093bihvYmplY3QsIGtleSkpIHB1c2hFbmNvZGVkS2V5VmFsdWVQYWlyKHBhaXJzLCBrZXksIG9iamVjdFtrZXldKTtcclxuICB9XHJcblxyXG4gIHJldHVybiBwYWlycy5qb2luKCcmJyk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBIZWxwcyAnc2VyaWFsaXplJyB3aXRoIHNlcmlhbGl6aW5nIGFycmF5cy5cclxuICogTXV0YXRlcyB0aGUgcGFpcnMgYXJyYXkuXHJcbiAqXHJcbiAqIEBwYXJhbSB7QXJyYXl9IHBhaXJzXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBrZXlcclxuICogQHBhcmFtIHtNaXhlZH0gdmFsXHJcbiAqL1xyXG5cclxuZnVuY3Rpb24gcHVzaEVuY29kZWRLZXlWYWx1ZVBhaXIocGFpcnMsIGtleSwgdmFsdWUpIHtcclxuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuO1xyXG4gIGlmICh2YWx1ZSA9PT0gbnVsbCkge1xyXG4gICAgcGFpcnMucHVzaChlbmNvZGVVUkkoa2V5KSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG5cclxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcclxuICAgIGZvciAoY29uc3QgdiBvZiB2YWx1ZSkge1xyXG4gICAgICBwdXNoRW5jb2RlZEtleVZhbHVlUGFpcihwYWlycywga2V5LCB2KTtcclxuICAgIH1cclxuICB9IGVsc2UgaWYgKGlzT2JqZWN0KHZhbHVlKSkge1xyXG4gICAgZm9yIChjb25zdCBzdWJrZXkgaW4gdmFsdWUpIHtcclxuICAgICAgaWYgKGhhc093bih2YWx1ZSwgc3Via2V5KSlcclxuICAgICAgICBwdXNoRW5jb2RlZEtleVZhbHVlUGFpcihwYWlycywgYCR7a2V5fVske3N1YmtleX1dYCwgdmFsdWVbc3Via2V5XSk7XHJcbiAgICB9XHJcbiAgfSBlbHNlIHtcclxuICAgIHBhaXJzLnB1c2goZW5jb2RlVVJJKGtleSkgKyAnPScgKyBlbmNvZGVVUklDb21wb25lbnQodmFsdWUpKTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBFeHBvc2Ugc2VyaWFsaXphdGlvbiBtZXRob2QuXHJcbiAqL1xyXG5cclxucmVxdWVzdC5zZXJpYWxpemVPYmplY3QgPSBzZXJpYWxpemU7XHJcblxyXG4vKipcclxuICogUGFyc2UgdGhlIGdpdmVuIHgtd3d3LWZvcm0tdXJsZW5jb2RlZCBgc3RyYC5cclxuICpcclxuICogQHBhcmFtIHtTdHJpbmd9IHN0clxyXG4gKiBAcmV0dXJuIHtPYmplY3R9XHJcbiAqIEBhcGkgcHJpdmF0ZVxyXG4gKi9cclxuXHJcbmZ1bmN0aW9uIHBhcnNlU3RyaW5nKHN0cmluZ18pIHtcclxuICBjb25zdCBvYmplY3QgPSB7fTtcclxuICBjb25zdCBwYWlycyA9IHN0cmluZ18uc3BsaXQoJyYnKTtcclxuICBsZXQgcGFpcjtcclxuICBsZXQgcG9zO1xyXG5cclxuICBmb3IgKGxldCBpID0gMCwgbGVuZ3RoXyA9IHBhaXJzLmxlbmd0aDsgaSA8IGxlbmd0aF87ICsraSkge1xyXG4gICAgcGFpciA9IHBhaXJzW2ldO1xyXG4gICAgcG9zID0gcGFpci5pbmRleE9mKCc9Jyk7XHJcbiAgICBpZiAocG9zID09PSAtMSkge1xyXG4gICAgICBvYmplY3RbZGVjb2RlVVJJQ29tcG9uZW50KHBhaXIpXSA9ICcnO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgb2JqZWN0W2RlY29kZVVSSUNvbXBvbmVudChwYWlyLnNsaWNlKDAsIHBvcykpXSA9IGRlY29kZVVSSUNvbXBvbmVudChcclxuICAgICAgICBwYWlyLnNsaWNlKHBvcyArIDEpXHJcbiAgICAgICk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICByZXR1cm4gb2JqZWN0O1xyXG59XHJcblxyXG4vKipcclxuICogRXhwb3NlIHBhcnNlci5cclxuICovXHJcblxyXG5yZXF1ZXN0LnBhcnNlU3RyaW5nID0gcGFyc2VTdHJpbmc7XHJcblxyXG4vKipcclxuICogRGVmYXVsdCBNSU1FIHR5cGUgbWFwLlxyXG4gKlxyXG4gKiAgICAgc3VwZXJhZ2VudC50eXBlcy54bWwgPSAnYXBwbGljYXRpb24veG1sJztcclxuICpcclxuICovXHJcblxyXG5yZXF1ZXN0LnR5cGVzID0ge1xyXG4gIGh0bWw6ICd0ZXh0L2h0bWwnLFxyXG4gIGpzb246ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICB4bWw6ICd0ZXh0L3htbCcsXHJcbiAgdXJsZW5jb2RlZDogJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCcsXHJcbiAgZm9ybTogJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCcsXHJcbiAgJ2Zvcm0tZGF0YSc6ICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnXHJcbn07XHJcblxyXG4vKipcclxuICogRGVmYXVsdCBzZXJpYWxpemF0aW9uIG1hcC5cclxuICpcclxuICogICAgIHN1cGVyYWdlbnQuc2VyaWFsaXplWydhcHBsaWNhdGlvbi94bWwnXSA9IGZ1bmN0aW9uKG9iail7XHJcbiAqICAgICAgIHJldHVybiAnZ2VuZXJhdGVkIHhtbCBoZXJlJztcclxuICogICAgIH07XHJcbiAqXHJcbiAqL1xyXG5cclxucmVxdWVzdC5zZXJpYWxpemUgPSB7XHJcbiAgJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCc6IChvYmopID0+IHtcclxuICAgIHJldHVybiBxcy5zdHJpbmdpZnkob2JqLCB7IGluZGljZXM6IGZhbHNlLCBzdHJpY3ROdWxsSGFuZGxpbmc6IHRydWUgfSk7XHJcbiAgfSxcclxuICAnYXBwbGljYXRpb24vanNvbic6IHNhZmVTdHJpbmdpZnlcclxufTtcclxuXHJcbi8qKlxyXG4gKiBEZWZhdWx0IHBhcnNlcnMuXHJcbiAqXHJcbiAqICAgICBzdXBlcmFnZW50LnBhcnNlWydhcHBsaWNhdGlvbi94bWwnXSA9IGZ1bmN0aW9uKHN0cil7XHJcbiAqICAgICAgIHJldHVybiB7IG9iamVjdCBwYXJzZWQgZnJvbSBzdHIgfTtcclxuICogICAgIH07XHJcbiAqXHJcbiAqL1xyXG5cclxucmVxdWVzdC5wYXJzZSA9IHtcclxuICAnYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJzogcGFyc2VTdHJpbmcsXHJcbiAgJ2FwcGxpY2F0aW9uL2pzb24nOiBKU09OLnBhcnNlXHJcbn07XHJcblxyXG4vKipcclxuICogUGFyc2UgdGhlIGdpdmVuIGhlYWRlciBgc3RyYCBpbnRvXHJcbiAqIGFuIG9iamVjdCBjb250YWluaW5nIHRoZSBtYXBwZWQgZmllbGRzLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXHJcbiAqIEByZXR1cm4ge09iamVjdH1cclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuZnVuY3Rpb24gcGFyc2VIZWFkZXIoc3RyaW5nXykge1xyXG4gIGNvbnN0IGxpbmVzID0gc3RyaW5nXy5zcGxpdCgvXFxyP1xcbi8pO1xyXG4gIGNvbnN0IGZpZWxkcyA9IHt9O1xyXG4gIGxldCBpbmRleDtcclxuICBsZXQgbGluZTtcclxuICBsZXQgZmllbGQ7XHJcbiAgbGV0IHZhbHVlO1xyXG5cclxuICBmb3IgKGxldCBpID0gMCwgbGVuZ3RoXyA9IGxpbmVzLmxlbmd0aDsgaSA8IGxlbmd0aF87ICsraSkge1xyXG4gICAgbGluZSA9IGxpbmVzW2ldO1xyXG4gICAgaW5kZXggPSBsaW5lLmluZGV4T2YoJzonKTtcclxuICAgIGlmIChpbmRleCA9PT0gLTEpIHtcclxuICAgICAgLy8gY291bGQgYmUgZW1wdHkgbGluZSwganVzdCBza2lwIGl0XHJcbiAgICAgIGNvbnRpbnVlO1xyXG4gICAgfVxyXG5cclxuICAgIGZpZWxkID0gbGluZS5zbGljZSgwLCBpbmRleCkudG9Mb3dlckNhc2UoKTtcclxuICAgIHZhbHVlID0gdHJpbShsaW5lLnNsaWNlKGluZGV4ICsgMSkpO1xyXG4gICAgZmllbGRzW2ZpZWxkXSA9IHZhbHVlO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIGZpZWxkcztcclxufVxyXG5cclxuLyoqXHJcbiAqIENoZWNrIGlmIGBtaW1lYCBpcyBqc29uIG9yIGhhcyAranNvbiBzdHJ1Y3R1cmVkIHN5bnRheCBzdWZmaXguXHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBtaW1lXHJcbiAqIEByZXR1cm4ge0Jvb2xlYW59XHJcbiAqIEBhcGkgcHJpdmF0ZVxyXG4gKi9cclxuXHJcbmZ1bmN0aW9uIGlzSlNPTihtaW1lKSB7XHJcbiAgLy8gc2hvdWxkIG1hdGNoIC9qc29uIG9yICtqc29uXHJcbiAgLy8gYnV0IG5vdCAvanNvbi1zZXFcclxuICByZXR1cm4gL1svK11qc29uKCR8W14tXFx3XSkvaS50ZXN0KG1pbWUpO1xyXG59XHJcblxyXG4vKipcclxuICogSW5pdGlhbGl6ZSBhIG5ldyBgUmVzcG9uc2VgIHdpdGggdGhlIGdpdmVuIGB4aHJgLlxyXG4gKlxyXG4gKiAgLSBzZXQgZmxhZ3MgKC5vaywgLmVycm9yLCBldGMpXHJcbiAqICAtIHBhcnNlIGhlYWRlclxyXG4gKlxyXG4gKiBFeGFtcGxlczpcclxuICpcclxuICogIEFsaWFzaW5nIGBzdXBlcmFnZW50YCBhcyBgcmVxdWVzdGAgaXMgbmljZTpcclxuICpcclxuICogICAgICByZXF1ZXN0ID0gc3VwZXJhZ2VudDtcclxuICpcclxuICogIFdlIGNhbiB1c2UgdGhlIHByb21pc2UtbGlrZSBBUEksIG9yIHBhc3MgY2FsbGJhY2tzOlxyXG4gKlxyXG4gKiAgICAgIHJlcXVlc3QuZ2V0KCcvJykuZW5kKGZ1bmN0aW9uKHJlcyl7fSk7XHJcbiAqICAgICAgcmVxdWVzdC5nZXQoJy8nLCBmdW5jdGlvbihyZXMpe30pO1xyXG4gKlxyXG4gKiAgU2VuZGluZyBkYXRhIGNhbiBiZSBjaGFpbmVkOlxyXG4gKlxyXG4gKiAgICAgIHJlcXVlc3RcclxuICogICAgICAgIC5wb3N0KCcvdXNlcicpXHJcbiAqICAgICAgICAuc2VuZCh7IG5hbWU6ICd0aicgfSlcclxuICogICAgICAgIC5lbmQoZnVuY3Rpb24ocmVzKXt9KTtcclxuICpcclxuICogIE9yIHBhc3NlZCB0byBgLnNlbmQoKWA6XHJcbiAqXHJcbiAqICAgICAgcmVxdWVzdFxyXG4gKiAgICAgICAgLnBvc3QoJy91c2VyJylcclxuICogICAgICAgIC5zZW5kKHsgbmFtZTogJ3RqJyB9LCBmdW5jdGlvbihyZXMpe30pO1xyXG4gKlxyXG4gKiAgT3IgcGFzc2VkIHRvIGAucG9zdCgpYDpcclxuICpcclxuICogICAgICByZXF1ZXN0XHJcbiAqICAgICAgICAucG9zdCgnL3VzZXInLCB7IG5hbWU6ICd0aicgfSlcclxuICogICAgICAgIC5lbmQoZnVuY3Rpb24ocmVzKXt9KTtcclxuICpcclxuICogT3IgZnVydGhlciByZWR1Y2VkIHRvIGEgc2luZ2xlIGNhbGwgZm9yIHNpbXBsZSBjYXNlczpcclxuICpcclxuICogICAgICByZXF1ZXN0XHJcbiAqICAgICAgICAucG9zdCgnL3VzZXInLCB7IG5hbWU6ICd0aicgfSwgZnVuY3Rpb24ocmVzKXt9KTtcclxuICpcclxuICogQHBhcmFtIHtYTUxIVFRQUmVxdWVzdH0geGhyXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zXHJcbiAqIEBhcGkgcHJpdmF0ZVxyXG4gKi9cclxuXHJcbmZ1bmN0aW9uIFJlc3BvbnNlKHJlcXVlc3RfKSB7XHJcbiAgdGhpcy5yZXEgPSByZXF1ZXN0XztcclxuICB0aGlzLnhociA9IHRoaXMucmVxLnhocjtcclxuICAvLyByZXNwb25zZVRleHQgaXMgYWNjZXNzaWJsZSBvbmx5IGlmIHJlc3BvbnNlVHlwZSBpcyAnJyBvciAndGV4dCcgYW5kIG9uIG9sZGVyIGJyb3dzZXJzXHJcbiAgdGhpcy50ZXh0ID1cclxuICAgICh0aGlzLnJlcS5tZXRob2QgIT09ICdIRUFEJyAmJlxyXG4gICAgICAodGhpcy54aHIucmVzcG9uc2VUeXBlID09PSAnJyB8fCB0aGlzLnhoci5yZXNwb25zZVR5cGUgPT09ICd0ZXh0JykpIHx8XHJcbiAgICB0eXBlb2YgdGhpcy54aHIucmVzcG9uc2VUeXBlID09PSAndW5kZWZpbmVkJ1xyXG4gICAgICA/IHRoaXMueGhyLnJlc3BvbnNlVGV4dFxyXG4gICAgICA6IG51bGw7XHJcbiAgdGhpcy5zdGF0dXNUZXh0ID0gdGhpcy5yZXEueGhyLnN0YXR1c1RleHQ7XHJcbiAgbGV0IHsgc3RhdHVzIH0gPSB0aGlzLnhocjtcclxuICAvLyBoYW5kbGUgSUU5IGJ1ZzogaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy8xMDA0Njk3Mi9tc2llLXJldHVybnMtc3RhdHVzLWNvZGUtb2YtMTIyMy1mb3ItYWpheC1yZXF1ZXN0XHJcbiAgaWYgKHN0YXR1cyA9PT0gMTIyMykge1xyXG4gICAgc3RhdHVzID0gMjA0O1xyXG4gIH1cclxuXHJcbiAgdGhpcy5fc2V0U3RhdHVzUHJvcGVydGllcyhzdGF0dXMpO1xyXG4gIHRoaXMuaGVhZGVycyA9IHBhcnNlSGVhZGVyKHRoaXMueGhyLmdldEFsbFJlc3BvbnNlSGVhZGVycygpKTtcclxuICB0aGlzLmhlYWRlciA9IHRoaXMuaGVhZGVycztcclxuICAvLyBnZXRBbGxSZXNwb25zZUhlYWRlcnMgc29tZXRpbWVzIGZhbHNlbHkgcmV0dXJucyBcIlwiIGZvciBDT1JTIHJlcXVlc3RzLCBidXRcclxuICAvLyBnZXRSZXNwb25zZUhlYWRlciBzdGlsbCB3b3Jrcy4gc28gd2UgZ2V0IGNvbnRlbnQtdHlwZSBldmVuIGlmIGdldHRpbmdcclxuICAvLyBvdGhlciBoZWFkZXJzIGZhaWxzLlxyXG4gIHRoaXMuaGVhZGVyWydjb250ZW50LXR5cGUnXSA9IHRoaXMueGhyLmdldFJlc3BvbnNlSGVhZGVyKCdjb250ZW50LXR5cGUnKTtcclxuICB0aGlzLl9zZXRIZWFkZXJQcm9wZXJ0aWVzKHRoaXMuaGVhZGVyKTtcclxuXHJcbiAgaWYgKHRoaXMudGV4dCA9PT0gbnVsbCAmJiByZXF1ZXN0Xy5fcmVzcG9uc2VUeXBlKSB7XHJcbiAgICB0aGlzLmJvZHkgPSB0aGlzLnhoci5yZXNwb25zZTtcclxuICB9IGVsc2Uge1xyXG4gICAgdGhpcy5ib2R5ID1cclxuICAgICAgdGhpcy5yZXEubWV0aG9kID09PSAnSEVBRCdcclxuICAgICAgICA/IG51bGxcclxuICAgICAgICA6IHRoaXMuX3BhcnNlQm9keSh0aGlzLnRleHQgPyB0aGlzLnRleHQgOiB0aGlzLnhoci5yZXNwb25zZSk7XHJcbiAgfVxyXG59XHJcblxyXG5taXhpbihSZXNwb25zZS5wcm90b3R5cGUsIFJlc3BvbnNlQmFzZS5wcm90b3R5cGUpO1xyXG5cclxuLyoqXHJcbiAqIFBhcnNlIHRoZSBnaXZlbiBib2R5IGBzdHJgLlxyXG4gKlxyXG4gKiBVc2VkIGZvciBhdXRvLXBhcnNpbmcgb2YgYm9kaWVzLiBQYXJzZXJzXHJcbiAqIGFyZSBkZWZpbmVkIG9uIHRoZSBgc3VwZXJhZ2VudC5wYXJzZWAgb2JqZWN0LlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXHJcbiAqIEByZXR1cm4ge01peGVkfVxyXG4gKiBAYXBpIHByaXZhdGVcclxuICovXHJcblxyXG5SZXNwb25zZS5wcm90b3R5cGUuX3BhcnNlQm9keSA9IGZ1bmN0aW9uIChzdHJpbmdfKSB7XHJcbiAgbGV0IHBhcnNlID0gcmVxdWVzdC5wYXJzZVt0aGlzLnR5cGVdO1xyXG4gIGlmICh0aGlzLnJlcS5fcGFyc2VyKSB7XHJcbiAgICByZXR1cm4gdGhpcy5yZXEuX3BhcnNlcih0aGlzLCBzdHJpbmdfKTtcclxuICB9XHJcblxyXG4gIGlmICghcGFyc2UgJiYgaXNKU09OKHRoaXMudHlwZSkpIHtcclxuICAgIHBhcnNlID0gcmVxdWVzdC5wYXJzZVsnYXBwbGljYXRpb24vanNvbiddO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHBhcnNlICYmIHN0cmluZ18gJiYgKHN0cmluZ18ubGVuZ3RoID4gMCB8fCBzdHJpbmdfIGluc3RhbmNlb2YgT2JqZWN0KVxyXG4gICAgPyBwYXJzZShzdHJpbmdfKVxyXG4gICAgOiBudWxsO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJldHVybiBhbiBgRXJyb3JgIHJlcHJlc2VudGF0aXZlIG9mIHRoaXMgcmVzcG9uc2UuXHJcbiAqXHJcbiAqIEByZXR1cm4ge0Vycm9yfVxyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlc3BvbnNlLnByb3RvdHlwZS50b0Vycm9yID0gZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IHsgcmVxIH0gPSB0aGlzO1xyXG4gIGNvbnN0IHsgbWV0aG9kIH0gPSByZXE7XHJcbiAgY29uc3QgeyB1cmwgfSA9IHJlcTtcclxuXHJcbiAgY29uc3QgbWVzc2FnZSA9IGBjYW5ub3QgJHttZXRob2R9ICR7dXJsfSAoJHt0aGlzLnN0YXR1c30pYDtcclxuICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcihtZXNzYWdlKTtcclxuICBlcnJvci5zdGF0dXMgPSB0aGlzLnN0YXR1cztcclxuICBlcnJvci5tZXRob2QgPSBtZXRob2Q7XHJcbiAgZXJyb3IudXJsID0gdXJsO1xyXG5cclxuICByZXR1cm4gZXJyb3I7XHJcbn07XHJcblxyXG4vKipcclxuICogRXhwb3NlIGBSZXNwb25zZWAuXHJcbiAqL1xyXG5cclxucmVxdWVzdC5SZXNwb25zZSA9IFJlc3BvbnNlO1xyXG5cclxuLyoqXHJcbiAqIEluaXRpYWxpemUgYSBuZXcgYFJlcXVlc3RgIHdpdGggdGhlIGdpdmVuIGBtZXRob2RgIGFuZCBgdXJsYC5cclxuICpcclxuICogQHBhcmFtIHtTdHJpbmd9IG1ldGhvZFxyXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuZnVuY3Rpb24gUmVxdWVzdChtZXRob2QsIHVybCkge1xyXG4gIGNvbnN0IHNlbGYgPSB0aGlzO1xyXG4gIHRoaXMuX3F1ZXJ5ID0gdGhpcy5fcXVlcnkgfHwgW107XHJcbiAgdGhpcy5tZXRob2QgPSBtZXRob2Q7XHJcbiAgdGhpcy51cmwgPSB1cmw7XHJcbiAgdGhpcy5oZWFkZXIgPSB7fTsgLy8gcHJlc2VydmVzIGhlYWRlciBuYW1lIGNhc2VcclxuICB0aGlzLl9oZWFkZXIgPSB7fTsgLy8gY29lcmNlcyBoZWFkZXIgbmFtZXMgdG8gbG93ZXJjYXNlXHJcbiAgdGhpcy5vbignZW5kJywgKCkgPT4ge1xyXG4gICAgbGV0IGVycm9yID0gbnVsbDtcclxuICAgIGxldCByZXMgPSBudWxsO1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIHJlcyA9IG5ldyBSZXNwb25zZShzZWxmKTtcclxuICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICBlcnJvciA9IG5ldyBFcnJvcignUGFyc2VyIGlzIHVuYWJsZSB0byBwYXJzZSB0aGUgcmVzcG9uc2UnKTtcclxuICAgICAgZXJyb3IucGFyc2UgPSB0cnVlO1xyXG4gICAgICBlcnJvci5vcmlnaW5hbCA9IGVycjtcclxuICAgICAgLy8gaXNzdWUgIzY3NTogcmV0dXJuIHRoZSByYXcgcmVzcG9uc2UgaWYgdGhlIHJlc3BvbnNlIHBhcnNpbmcgZmFpbHNcclxuICAgICAgaWYgKHNlbGYueGhyKSB7XHJcbiAgICAgICAgLy8gaWU5IGRvZXNuJ3QgaGF2ZSAncmVzcG9uc2UnIHByb3BlcnR5XHJcbiAgICAgICAgZXJyb3IucmF3UmVzcG9uc2UgPVxyXG4gICAgICAgICAgdHlwZW9mIHNlbGYueGhyLnJlc3BvbnNlVHlwZSA9PT0gJ3VuZGVmaW5lZCdcclxuICAgICAgICAgICAgPyBzZWxmLnhoci5yZXNwb25zZVRleHRcclxuICAgICAgICAgICAgOiBzZWxmLnhoci5yZXNwb25zZTtcclxuICAgICAgICAvLyBpc3N1ZSAjODc2OiByZXR1cm4gdGhlIGh0dHAgc3RhdHVzIGNvZGUgaWYgdGhlIHJlc3BvbnNlIHBhcnNpbmcgZmFpbHNcclxuICAgICAgICBlcnJvci5zdGF0dXMgPSBzZWxmLnhoci5zdGF0dXMgPyBzZWxmLnhoci5zdGF0dXMgOiBudWxsO1xyXG4gICAgICAgIGVycm9yLnN0YXR1c0NvZGUgPSBlcnJvci5zdGF0dXM7IC8vIGJhY2t3YXJkcy1jb21wYXQgb25seVxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGVycm9yLnJhd1Jlc3BvbnNlID0gbnVsbDtcclxuICAgICAgICBlcnJvci5zdGF0dXMgPSBudWxsO1xyXG4gICAgICB9XHJcblxyXG4gICAgICByZXR1cm4gc2VsZi5jYWxsYmFjayhlcnJvcik7XHJcbiAgICB9XHJcblxyXG4gICAgc2VsZi5lbWl0KCdyZXNwb25zZScsIHJlcyk7XHJcblxyXG4gICAgbGV0IG5ld19lcnJvcjtcclxuICAgIHRyeSB7XHJcbiAgICAgIGlmICghc2VsZi5faXNSZXNwb25zZU9LKHJlcykpIHtcclxuICAgICAgICBuZXdfZXJyb3IgPSBuZXcgRXJyb3IoXHJcbiAgICAgICAgICByZXMuc3RhdHVzVGV4dCB8fCByZXMudGV4dCB8fCAnVW5zdWNjZXNzZnVsIEhUVFAgcmVzcG9uc2UnXHJcbiAgICAgICAgKTtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgIG5ld19lcnJvciA9IGVycjsgLy8gb2soKSBjYWxsYmFjayBjYW4gdGhyb3dcclxuICAgIH1cclxuXHJcbiAgICAvLyAjMTAwMCBkb24ndCBjYXRjaCBlcnJvcnMgZnJvbSB0aGUgY2FsbGJhY2sgdG8gYXZvaWQgZG91YmxlIGNhbGxpbmcgaXRcclxuICAgIGlmIChuZXdfZXJyb3IpIHtcclxuICAgICAgbmV3X2Vycm9yLm9yaWdpbmFsID0gZXJyb3I7XHJcbiAgICAgIG5ld19lcnJvci5yZXNwb25zZSA9IHJlcztcclxuICAgICAgbmV3X2Vycm9yLnN0YXR1cyA9IG5ld19lcnJvci5zdGF0dXMgfHwgcmVzLnN0YXR1cztcclxuICAgICAgc2VsZi5jYWxsYmFjayhuZXdfZXJyb3IsIHJlcyk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBzZWxmLmNhbGxiYWNrKG51bGwsIHJlcyk7XHJcbiAgICB9XHJcbiAgfSk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBNaXhpbiBgRW1pdHRlcmAgYW5kIGBSZXF1ZXN0QmFzZWAuXHJcbiAqL1xyXG5cclxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5ldy1jYXBcclxuRW1pdHRlcihSZXF1ZXN0LnByb3RvdHlwZSk7XHJcblxyXG5taXhpbihSZXF1ZXN0LnByb3RvdHlwZSwgUmVxdWVzdEJhc2UucHJvdG90eXBlKTtcclxuXHJcbi8qKlxyXG4gKiBTZXQgQ29udGVudC1UeXBlIHRvIGB0eXBlYCwgbWFwcGluZyB2YWx1ZXMgZnJvbSBgcmVxdWVzdC50eXBlc2AuXHJcbiAqXHJcbiAqIEV4YW1wbGVzOlxyXG4gKlxyXG4gKiAgICAgIHN1cGVyYWdlbnQudHlwZXMueG1sID0gJ2FwcGxpY2F0aW9uL3htbCc7XHJcbiAqXHJcbiAqICAgICAgcmVxdWVzdC5wb3N0KCcvJylcclxuICogICAgICAgIC50eXBlKCd4bWwnKVxyXG4gKiAgICAgICAgLnNlbmQoeG1sc3RyaW5nKVxyXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XHJcbiAqXHJcbiAqICAgICAgcmVxdWVzdC5wb3N0KCcvJylcclxuICogICAgICAgIC50eXBlKCdhcHBsaWNhdGlvbi94bWwnKVxyXG4gKiAgICAgICAgLnNlbmQoeG1sc3RyaW5nKVxyXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSB0eXBlXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3QucHJvdG90eXBlLnR5cGUgPSBmdW5jdGlvbiAodHlwZSkge1xyXG4gIHRoaXMuc2V0KCdDb250ZW50LVR5cGUnLCByZXF1ZXN0LnR5cGVzW3R5cGVdIHx8IHR5cGUpO1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFNldCBBY2NlcHQgdG8gYHR5cGVgLCBtYXBwaW5nIHZhbHVlcyBmcm9tIGByZXF1ZXN0LnR5cGVzYC5cclxuICpcclxuICogRXhhbXBsZXM6XHJcbiAqXHJcbiAqICAgICAgc3VwZXJhZ2VudC50eXBlcy5qc29uID0gJ2FwcGxpY2F0aW9uL2pzb24nO1xyXG4gKlxyXG4gKiAgICAgIHJlcXVlc3QuZ2V0KCcvYWdlbnQnKVxyXG4gKiAgICAgICAgLmFjY2VwdCgnanNvbicpXHJcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcclxuICpcclxuICogICAgICByZXF1ZXN0LmdldCgnL2FnZW50JylcclxuICogICAgICAgIC5hY2NlcHQoJ2FwcGxpY2F0aW9uL2pzb24nKVxyXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBhY2NlcHRcclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuYWNjZXB0ID0gZnVuY3Rpb24gKHR5cGUpIHtcclxuICB0aGlzLnNldCgnQWNjZXB0JywgcmVxdWVzdC50eXBlc1t0eXBlXSB8fCB0eXBlKTtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBTZXQgQXV0aG9yaXphdGlvbiBmaWVsZCB2YWx1ZSB3aXRoIGB1c2VyYCBhbmQgYHBhc3NgLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gdXNlclxyXG4gKiBAcGFyYW0ge1N0cmluZ30gW3Bhc3NdIG9wdGlvbmFsIGluIGNhc2Ugb2YgdXNpbmcgJ2JlYXJlcicgYXMgdHlwZVxyXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyB3aXRoICd0eXBlJyBwcm9wZXJ0eSAnYXV0bycsICdiYXNpYycgb3IgJ2JlYXJlcicgKGRlZmF1bHQgJ2Jhc2ljJylcclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuYXV0aCA9IGZ1bmN0aW9uICh1c2VyLCBwYXNzLCBvcHRpb25zKSB7XHJcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDEpIHBhc3MgPSAnJztcclxuICBpZiAodHlwZW9mIHBhc3MgPT09ICdvYmplY3QnICYmIHBhc3MgIT09IG51bGwpIHtcclxuICAgIC8vIHBhc3MgaXMgb3B0aW9uYWwgYW5kIGNhbiBiZSByZXBsYWNlZCB3aXRoIG9wdGlvbnNcclxuICAgIG9wdGlvbnMgPSBwYXNzO1xyXG4gICAgcGFzcyA9ICcnO1xyXG4gIH1cclxuXHJcbiAgaWYgKCFvcHRpb25zKSB7XHJcbiAgICBvcHRpb25zID0ge1xyXG4gICAgICB0eXBlOiB0eXBlb2YgYnRvYSA9PT0gJ2Z1bmN0aW9uJyA/ICdiYXNpYycgOiAnYXV0bydcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBjb25zdCBlbmNvZGVyID0gb3B0aW9ucy5lbmNvZGVyXHJcbiAgICA/IG9wdGlvbnMuZW5jb2RlclxyXG4gICAgOiAoc3RyaW5nKSA9PiB7XHJcbiAgICAgICAgaWYgKHR5cGVvZiBidG9hID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICByZXR1cm4gYnRvYShzdHJpbmcpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgdXNlIGJhc2ljIGF1dGgsIGJ0b2EgaXMgbm90IGEgZnVuY3Rpb24nKTtcclxuICAgICAgfTtcclxuXHJcbiAgcmV0dXJuIHRoaXMuX2F1dGgodXNlciwgcGFzcywgb3B0aW9ucywgZW5jb2Rlcik7XHJcbn07XHJcblxyXG4vKipcclxuICogQWRkIHF1ZXJ5LXN0cmluZyBgdmFsYC5cclxuICpcclxuICogRXhhbXBsZXM6XHJcbiAqXHJcbiAqICAgcmVxdWVzdC5nZXQoJy9zaG9lcycpXHJcbiAqICAgICAucXVlcnkoJ3NpemU9MTAnKVxyXG4gKiAgICAgLnF1ZXJ5KHsgY29sb3I6ICdibHVlJyB9KVxyXG4gKlxyXG4gKiBAcGFyYW0ge09iamVjdHxTdHJpbmd9IHZhbFxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS5xdWVyeSA9IGZ1bmN0aW9uICh2YWx1ZSkge1xyXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnKSB2YWx1ZSA9IHNlcmlhbGl6ZSh2YWx1ZSk7XHJcbiAgaWYgKHZhbHVlKSB0aGlzLl9xdWVyeS5wdXNoKHZhbHVlKTtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBRdWV1ZSB0aGUgZ2l2ZW4gYGZpbGVgIGFzIGFuIGF0dGFjaG1lbnQgdG8gdGhlIHNwZWNpZmllZCBgZmllbGRgLFxyXG4gKiB3aXRoIG9wdGlvbmFsIGBvcHRpb25zYCAob3IgZmlsZW5hbWUpLlxyXG4gKlxyXG4gKiBgYGAganNcclxuICogcmVxdWVzdC5wb3N0KCcvdXBsb2FkJylcclxuICogICAuYXR0YWNoKCdjb250ZW50JywgbmV3IEJsb2IoWyc8YSBpZD1cImFcIj48YiBpZD1cImJcIj5oZXkhPC9iPjwvYT4nXSwgeyB0eXBlOiBcInRleHQvaHRtbFwifSkpXHJcbiAqICAgLmVuZChjYWxsYmFjayk7XHJcbiAqIGBgYFxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gZmllbGRcclxuICogQHBhcmFtIHtCbG9ifEZpbGV9IGZpbGVcclxuICogQHBhcmFtIHtTdHJpbmd8T2JqZWN0fSBvcHRpb25zXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3QucHJvdG90eXBlLmF0dGFjaCA9IGZ1bmN0aW9uIChmaWVsZCwgZmlsZSwgb3B0aW9ucykge1xyXG4gIGlmIChmaWxlKSB7XHJcbiAgICBpZiAodGhpcy5fZGF0YSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzdXBlcmFnZW50IGNhbid0IG1peCAuc2VuZCgpIGFuZCAuYXR0YWNoKClcIik7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5fZ2V0Rm9ybURhdGEoKS5hcHBlbmQoZmllbGQsIGZpbGUsIG9wdGlvbnMgfHwgZmlsZS5uYW1lKTtcclxuICB9XHJcblxyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuX2dldEZvcm1EYXRhID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICghdGhpcy5fZm9ybURhdGEpIHtcclxuICAgIHRoaXMuX2Zvcm1EYXRhID0gbmV3IHJvb3QuRm9ybURhdGEoKTtcclxuICB9XHJcblxyXG4gIHJldHVybiB0aGlzLl9mb3JtRGF0YTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBJbnZva2UgdGhlIGNhbGxiYWNrIHdpdGggYGVycmAgYW5kIGByZXNgXHJcbiAqIGFuZCBoYW5kbGUgYXJpdHkgY2hlY2suXHJcbiAqXHJcbiAqIEBwYXJhbSB7RXJyb3J9IGVyclxyXG4gKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXNcclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuY2FsbGJhY2sgPSBmdW5jdGlvbiAoZXJyb3IsIHJlcykge1xyXG4gIGlmICh0aGlzLl9zaG91bGRSZXRyeShlcnJvciwgcmVzKSkge1xyXG4gICAgcmV0dXJuIHRoaXMuX3JldHJ5KCk7XHJcbiAgfVxyXG5cclxuICBjb25zdCBmbiA9IHRoaXMuX2NhbGxiYWNrO1xyXG4gIHRoaXMuY2xlYXJUaW1lb3V0KCk7XHJcblxyXG4gIGlmIChlcnJvcikge1xyXG4gICAgaWYgKHRoaXMuX21heFJldHJpZXMpIGVycm9yLnJldHJpZXMgPSB0aGlzLl9yZXRyaWVzIC0gMTtcclxuICAgIHRoaXMuZW1pdCgnZXJyb3InLCBlcnJvcik7XHJcbiAgfVxyXG5cclxuICBmbihlcnJvciwgcmVzKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBJbnZva2UgY2FsbGJhY2sgd2l0aCB4LWRvbWFpbiBlcnJvci5cclxuICpcclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuY3Jvc3NEb21haW5FcnJvciA9IGZ1bmN0aW9uICgpIHtcclxuICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcihcclxuICAgICdSZXF1ZXN0IGhhcyBiZWVuIHRlcm1pbmF0ZWRcXG5Qb3NzaWJsZSBjYXVzZXM6IHRoZSBuZXR3b3JrIGlzIG9mZmxpbmUsIE9yaWdpbiBpcyBub3QgYWxsb3dlZCBieSBBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4sIHRoZSBwYWdlIGlzIGJlaW5nIHVubG9hZGVkLCBldGMuJ1xyXG4gICk7XHJcbiAgZXJyb3IuY3Jvc3NEb21haW4gPSB0cnVlO1xyXG5cclxuICBlcnJvci5zdGF0dXMgPSB0aGlzLnN0YXR1cztcclxuICBlcnJvci5tZXRob2QgPSB0aGlzLm1ldGhvZDtcclxuICBlcnJvci51cmwgPSB0aGlzLnVybDtcclxuXHJcbiAgdGhpcy5jYWxsYmFjayhlcnJvcik7XHJcbn07XHJcblxyXG4vLyBUaGlzIG9ubHkgd2FybnMsIGJlY2F1c2UgdGhlIHJlcXVlc3QgaXMgc3RpbGwgbGlrZWx5IHRvIHdvcmtcclxuUmVxdWVzdC5wcm90b3R5cGUuYWdlbnQgPSBmdW5jdGlvbiAoKSB7XHJcbiAgY29uc29sZS53YXJuKCdUaGlzIGlzIG5vdCBzdXBwb3J0ZWQgaW4gYnJvd3NlciB2ZXJzaW9uIG9mIHN1cGVyYWdlbnQnKTtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcblJlcXVlc3QucHJvdG90eXBlLmNhID0gUmVxdWVzdC5wcm90b3R5cGUuYWdlbnQ7XHJcblJlcXVlc3QucHJvdG90eXBlLmJ1ZmZlciA9IFJlcXVlc3QucHJvdG90eXBlLmNhO1xyXG5cclxuLy8gVGhpcyB0aHJvd3MsIGJlY2F1c2UgaXQgY2FuJ3Qgc2VuZC9yZWNlaXZlIGRhdGEgYXMgZXhwZWN0ZWRcclxuUmVxdWVzdC5wcm90b3R5cGUud3JpdGUgPSAoKSA9PiB7XHJcbiAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgJ1N0cmVhbWluZyBpcyBub3Qgc3VwcG9ydGVkIGluIGJyb3dzZXIgdmVyc2lvbiBvZiBzdXBlcmFnZW50J1xyXG4gICk7XHJcbn07XHJcblxyXG5SZXF1ZXN0LnByb3RvdHlwZS5waXBlID0gUmVxdWVzdC5wcm90b3R5cGUud3JpdGU7XHJcblxyXG4vKipcclxuICogQ2hlY2sgaWYgYG9iamAgaXMgYSBob3N0IG9iamVjdCxcclxuICogd2UgZG9uJ3Qgd2FudCB0byBzZXJpYWxpemUgdGhlc2UgOilcclxuICpcclxuICogQHBhcmFtIHtPYmplY3R9IG9iaiBob3N0IG9iamVjdFxyXG4gKiBAcmV0dXJuIHtCb29sZWFufSBpcyBhIGhvc3Qgb2JqZWN0XHJcbiAqIEBhcGkgcHJpdmF0ZVxyXG4gKi9cclxuUmVxdWVzdC5wcm90b3R5cGUuX2lzSG9zdCA9IGZ1bmN0aW9uIChvYmplY3QpIHtcclxuICAvLyBOYXRpdmUgb2JqZWN0cyBzdHJpbmdpZnkgdG8gW29iamVjdCBGaWxlXSwgW29iamVjdCBCbG9iXSwgW29iamVjdCBGb3JtRGF0YV0sIGV0Yy5cclxuICByZXR1cm4gKFxyXG4gICAgb2JqZWN0ICYmXHJcbiAgICB0eXBlb2Ygb2JqZWN0ID09PSAnb2JqZWN0JyAmJlxyXG4gICAgIUFycmF5LmlzQXJyYXkob2JqZWN0KSAmJlxyXG4gICAgT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9iamVjdCkgIT09ICdbb2JqZWN0IE9iamVjdF0nXHJcbiAgKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBJbml0aWF0ZSByZXF1ZXN0LCBpbnZva2luZyBjYWxsYmFjayBgZm4ocmVzKWBcclxuICogd2l0aCBhbiBpbnN0YW5jZW9mIGBSZXNwb25zZWAuXHJcbiAqXHJcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3QucHJvdG90eXBlLmVuZCA9IGZ1bmN0aW9uIChmbikge1xyXG4gIGlmICh0aGlzLl9lbmRDYWxsZWQpIHtcclxuICAgIGNvbnNvbGUud2FybihcclxuICAgICAgJ1dhcm5pbmc6IC5lbmQoKSB3YXMgY2FsbGVkIHR3aWNlLiBUaGlzIGlzIG5vdCBzdXBwb3J0ZWQgaW4gc3VwZXJhZ2VudCdcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICB0aGlzLl9lbmRDYWxsZWQgPSB0cnVlO1xyXG5cclxuICAvLyBzdG9yZSBjYWxsYmFja1xyXG4gIHRoaXMuX2NhbGxiYWNrID0gZm4gfHwgbm9vcDtcclxuXHJcbiAgLy8gcXVlcnlzdHJpbmdcclxuICB0aGlzLl9maW5hbGl6ZVF1ZXJ5U3RyaW5nKCk7XHJcblxyXG4gIHRoaXMuX2VuZCgpO1xyXG59O1xyXG5cclxuUmVxdWVzdC5wcm90b3R5cGUuX3NldFVwbG9hZFRpbWVvdXQgPSBmdW5jdGlvbiAoKSB7XHJcbiAgY29uc3Qgc2VsZiA9IHRoaXM7XHJcblxyXG4gIC8vIHVwbG9hZCB0aW1lb3V0IGl0J3Mgd29rcnMgb25seSBpZiBkZWFkbGluZSB0aW1lb3V0IGlzIG9mZlxyXG4gIGlmICh0aGlzLl91cGxvYWRUaW1lb3V0ICYmICF0aGlzLl91cGxvYWRUaW1lb3V0VGltZXIpIHtcclxuICAgIHRoaXMuX3VwbG9hZFRpbWVvdXRUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICBzZWxmLl90aW1lb3V0RXJyb3IoXHJcbiAgICAgICAgJ1VwbG9hZCB0aW1lb3V0IG9mICcsXHJcbiAgICAgICAgc2VsZi5fdXBsb2FkVGltZW91dCxcclxuICAgICAgICAnRVRJTUVET1VUJ1xyXG4gICAgICApO1xyXG4gICAgfSwgdGhpcy5fdXBsb2FkVGltZW91dCk7XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIGNvbXBsZXhpdHlcclxuUmVxdWVzdC5wcm90b3R5cGUuX2VuZCA9IGZ1bmN0aW9uICgpIHtcclxuICBpZiAodGhpcy5fYWJvcnRlZClcclxuICAgIHJldHVybiB0aGlzLmNhbGxiYWNrKFxyXG4gICAgICBuZXcgRXJyb3IoJ1RoZSByZXF1ZXN0IGhhcyBiZWVuIGFib3J0ZWQgZXZlbiBiZWZvcmUgLmVuZCgpIHdhcyBjYWxsZWQnKVxyXG4gICAgKTtcclxuXHJcbiAgY29uc3Qgc2VsZiA9IHRoaXM7XHJcbiAgdGhpcy54aHIgPSByZXF1ZXN0LmdldFhIUigpO1xyXG4gIGNvbnN0IHsgeGhyIH0gPSB0aGlzO1xyXG4gIGxldCBkYXRhID0gdGhpcy5fZm9ybURhdGEgfHwgdGhpcy5fZGF0YTtcclxuXHJcbiAgdGhpcy5fc2V0VGltZW91dHMoKTtcclxuXHJcbiAgLy8gc3RhdGUgY2hhbmdlXHJcbiAgeGhyLmFkZEV2ZW50TGlzdGVuZXIoJ3JlYWR5c3RhdGVjaGFuZ2UnLCAoKSA9PiB7XHJcbiAgICBjb25zdCB7IHJlYWR5U3RhdGUgfSA9IHhocjtcclxuICAgIGlmIChyZWFkeVN0YXRlID49IDIgJiYgc2VsZi5fcmVzcG9uc2VUaW1lb3V0VGltZXIpIHtcclxuICAgICAgY2xlYXJUaW1lb3V0KHNlbGYuX3Jlc3BvbnNlVGltZW91dFRpbWVyKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAocmVhZHlTdGF0ZSAhPT0gNCkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgLy8gSW4gSUU5LCByZWFkcyB0byBhbnkgcHJvcGVydHkgKGUuZy4gc3RhdHVzKSBvZmYgb2YgYW4gYWJvcnRlZCBYSFIgd2lsbFxyXG4gICAgLy8gcmVzdWx0IGluIHRoZSBlcnJvciBcIkNvdWxkIG5vdCBjb21wbGV0ZSB0aGUgb3BlcmF0aW9uIGR1ZSB0byBlcnJvciBjMDBjMDIzZlwiXHJcbiAgICBsZXQgc3RhdHVzO1xyXG4gICAgdHJ5IHtcclxuICAgICAgc3RhdHVzID0geGhyLnN0YXR1cztcclxuICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICBzdGF0dXMgPSAwO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICghc3RhdHVzKSB7XHJcbiAgICAgIGlmIChzZWxmLnRpbWVkb3V0IHx8IHNlbGYuX2Fib3J0ZWQpIHJldHVybjtcclxuICAgICAgcmV0dXJuIHNlbGYuY3Jvc3NEb21haW5FcnJvcigpO1xyXG4gICAgfVxyXG5cclxuICAgIHNlbGYuZW1pdCgnZW5kJyk7XHJcbiAgfSk7XHJcblxyXG4gIC8vIHByb2dyZXNzXHJcbiAgY29uc3QgaGFuZGxlUHJvZ3Jlc3MgPSAoZGlyZWN0aW9uLCBlKSA9PiB7XHJcbiAgICBpZiAoZS50b3RhbCA+IDApIHtcclxuICAgICAgZS5wZXJjZW50ID0gKGUubG9hZGVkIC8gZS50b3RhbCkgKiAxMDA7XHJcblxyXG4gICAgICBpZiAoZS5wZXJjZW50ID09PSAxMDApIHtcclxuICAgICAgICBjbGVhclRpbWVvdXQoc2VsZi5fdXBsb2FkVGltZW91dFRpbWVyKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGUuZGlyZWN0aW9uID0gZGlyZWN0aW9uO1xyXG4gICAgc2VsZi5lbWl0KCdwcm9ncmVzcycsIGUpO1xyXG4gIH07XHJcblxyXG4gIGlmICh0aGlzLmhhc0xpc3RlbmVycygncHJvZ3Jlc3MnKSkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgeGhyLmFkZEV2ZW50TGlzdGVuZXIoJ3Byb2dyZXNzJywgaGFuZGxlUHJvZ3Jlc3MuYmluZChudWxsLCAnZG93bmxvYWQnKSk7XHJcbiAgICAgIGlmICh4aHIudXBsb2FkKSB7XHJcbiAgICAgICAgeGhyLnVwbG9hZC5hZGRFdmVudExpc3RlbmVyKFxyXG4gICAgICAgICAgJ3Byb2dyZXNzJyxcclxuICAgICAgICAgIGhhbmRsZVByb2dyZXNzLmJpbmQobnVsbCwgJ3VwbG9hZCcpXHJcbiAgICAgICAgKTtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgIC8vIEFjY2Vzc2luZyB4aHIudXBsb2FkIGZhaWxzIGluIElFIGZyb20gYSB3ZWIgd29ya2VyLCBzbyBqdXN0IHByZXRlbmQgaXQgZG9lc24ndCBleGlzdC5cclxuICAgICAgLy8gUmVwb3J0ZWQgaGVyZTpcclxuICAgICAgLy8gaHR0cHM6Ly9jb25uZWN0Lm1pY3Jvc29mdC5jb20vSUUvZmVlZGJhY2svZGV0YWlscy84MzcyNDUveG1saHR0cHJlcXVlc3QtdXBsb2FkLXRocm93cy1pbnZhbGlkLWFyZ3VtZW50LXdoZW4tdXNlZC1mcm9tLXdlYi13b3JrZXItY29udGV4dFxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgaWYgKHhoci51cGxvYWQpIHtcclxuICAgIHRoaXMuX3NldFVwbG9hZFRpbWVvdXQoKTtcclxuICB9XHJcblxyXG4gIC8vIGluaXRpYXRlIHJlcXVlc3RcclxuICB0cnkge1xyXG4gICAgaWYgKHRoaXMudXNlcm5hbWUgJiYgdGhpcy5wYXNzd29yZCkge1xyXG4gICAgICB4aHIub3Blbih0aGlzLm1ldGhvZCwgdGhpcy51cmwsIHRydWUsIHRoaXMudXNlcm5hbWUsIHRoaXMucGFzc3dvcmQpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgeGhyLm9wZW4odGhpcy5tZXRob2QsIHRoaXMudXJsLCB0cnVlKTtcclxuICAgIH1cclxuICB9IGNhdGNoIChlcnIpIHtcclxuICAgIC8vIHNlZSAjMTE0OVxyXG4gICAgcmV0dXJuIHRoaXMuY2FsbGJhY2soZXJyKTtcclxuICB9XHJcblxyXG4gIC8vIENPUlNcclxuICBpZiAodGhpcy5fd2l0aENyZWRlbnRpYWxzKSB4aHIud2l0aENyZWRlbnRpYWxzID0gdHJ1ZTtcclxuXHJcbiAgLy8gYm9keVxyXG4gIGlmIChcclxuICAgICF0aGlzLl9mb3JtRGF0YSAmJlxyXG4gICAgdGhpcy5tZXRob2QgIT09ICdHRVQnICYmXHJcbiAgICB0aGlzLm1ldGhvZCAhPT0gJ0hFQUQnICYmXHJcbiAgICB0eXBlb2YgZGF0YSAhPT0gJ3N0cmluZycgJiZcclxuICAgICF0aGlzLl9pc0hvc3QoZGF0YSlcclxuICApIHtcclxuICAgIC8vIHNlcmlhbGl6ZSBzdHVmZlxyXG4gICAgY29uc3QgY29udGVudFR5cGUgPSB0aGlzLl9oZWFkZXJbJ2NvbnRlbnQtdHlwZSddO1xyXG4gICAgbGV0IHNlcmlhbGl6ZSA9XHJcbiAgICAgIHRoaXMuX3NlcmlhbGl6ZXIgfHxcclxuICAgICAgcmVxdWVzdC5zZXJpYWxpemVbY29udGVudFR5cGUgPyBjb250ZW50VHlwZS5zcGxpdCgnOycpWzBdIDogJyddO1xyXG4gICAgaWYgKCFzZXJpYWxpemUgJiYgaXNKU09OKGNvbnRlbnRUeXBlKSkge1xyXG4gICAgICBzZXJpYWxpemUgPSByZXF1ZXN0LnNlcmlhbGl6ZVsnYXBwbGljYXRpb24vanNvbiddO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChzZXJpYWxpemUpIGRhdGEgPSBzZXJpYWxpemUoZGF0YSk7XHJcbiAgfVxyXG5cclxuICAvLyBzZXQgaGVhZGVyIGZpZWxkc1xyXG4gIGZvciAoY29uc3QgZmllbGQgaW4gdGhpcy5oZWFkZXIpIHtcclxuICAgIGlmICh0aGlzLmhlYWRlcltmaWVsZF0gPT09IG51bGwpIGNvbnRpbnVlO1xyXG5cclxuICAgIGlmIChoYXNPd24odGhpcy5oZWFkZXIsIGZpZWxkKSlcclxuICAgICAgeGhyLnNldFJlcXVlc3RIZWFkZXIoZmllbGQsIHRoaXMuaGVhZGVyW2ZpZWxkXSk7XHJcbiAgfVxyXG5cclxuICBpZiAodGhpcy5fcmVzcG9uc2VUeXBlKSB7XHJcbiAgICB4aHIucmVzcG9uc2VUeXBlID0gdGhpcy5fcmVzcG9uc2VUeXBlO1xyXG4gIH1cclxuXHJcbiAgLy8gc2VuZCBzdHVmZlxyXG4gIHRoaXMuZW1pdCgncmVxdWVzdCcsIHRoaXMpO1xyXG5cclxuICAvLyBJRTExIHhoci5zZW5kKHVuZGVmaW5lZCkgc2VuZHMgJ3VuZGVmaW5lZCcgc3RyaW5nIGFzIFBPU1QgcGF5bG9hZCAoaW5zdGVhZCBvZiBub3RoaW5nKVxyXG4gIC8vIFdlIG5lZWQgbnVsbCBoZXJlIGlmIGRhdGEgaXMgdW5kZWZpbmVkXHJcbiAgeGhyLnNlbmQodHlwZW9mIGRhdGEgPT09ICd1bmRlZmluZWQnID8gbnVsbCA6IGRhdGEpO1xyXG59O1xyXG5cclxucmVxdWVzdC5hZ2VudCA9ICgpID0+IG5ldyBBZ2VudCgpO1xyXG5cclxuZm9yIChjb25zdCBtZXRob2Qgb2YgWydHRVQnLCAnUE9TVCcsICdPUFRJT05TJywgJ1BBVENIJywgJ1BVVCcsICdERUxFVEUnXSkge1xyXG4gIEFnZW50LnByb3RvdHlwZVttZXRob2QudG9Mb3dlckNhc2UoKV0gPSBmdW5jdGlvbiAodXJsLCBmbikge1xyXG4gICAgY29uc3QgcmVxdWVzdF8gPSBuZXcgcmVxdWVzdC5SZXF1ZXN0KG1ldGhvZCwgdXJsKTtcclxuICAgIHRoaXMuX3NldERlZmF1bHRzKHJlcXVlc3RfKTtcclxuICAgIGlmIChmbikge1xyXG4gICAgICByZXF1ZXN0Xy5lbmQoZm4pO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXF1ZXN0XztcclxuICB9O1xyXG59XHJcblxyXG5BZ2VudC5wcm90b3R5cGUuZGVsID0gQWdlbnQucHJvdG90eXBlLmRlbGV0ZTtcclxuXHJcbi8qKlxyXG4gKiBHRVQgYHVybGAgd2l0aCBvcHRpb25hbCBjYWxsYmFjayBgZm4ocmVzKWAuXHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSB1cmxcclxuICogQHBhcmFtIHtNaXhlZHxGdW5jdGlvbn0gW2RhdGFdIG9yIGZuXHJcbiAqIEBwYXJhbSB7RnVuY3Rpb259IFtmbl1cclxuICogQHJldHVybiB7UmVxdWVzdH1cclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5yZXF1ZXN0LmdldCA9ICh1cmwsIGRhdGEsIGZuKSA9PiB7XHJcbiAgY29uc3QgcmVxdWVzdF8gPSByZXF1ZXN0KCdHRVQnLCB1cmwpO1xyXG4gIGlmICh0eXBlb2YgZGF0YSA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgZm4gPSBkYXRhO1xyXG4gICAgZGF0YSA9IG51bGw7XHJcbiAgfVxyXG5cclxuICBpZiAoZGF0YSkgcmVxdWVzdF8ucXVlcnkoZGF0YSk7XHJcbiAgaWYgKGZuKSByZXF1ZXN0Xy5lbmQoZm4pO1xyXG4gIHJldHVybiByZXF1ZXN0XztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBIRUFEIGB1cmxgIHdpdGggb3B0aW9uYWwgY2FsbGJhY2sgYGZuKHJlcylgLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXHJcbiAqIEBwYXJhbSB7TWl4ZWR8RnVuY3Rpb259IFtkYXRhXSBvciBmblxyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbZm5dXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxucmVxdWVzdC5oZWFkID0gKHVybCwgZGF0YSwgZm4pID0+IHtcclxuICBjb25zdCByZXF1ZXN0XyA9IHJlcXVlc3QoJ0hFQUQnLCB1cmwpO1xyXG4gIGlmICh0eXBlb2YgZGF0YSA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgZm4gPSBkYXRhO1xyXG4gICAgZGF0YSA9IG51bGw7XHJcbiAgfVxyXG5cclxuICBpZiAoZGF0YSkgcmVxdWVzdF8ucXVlcnkoZGF0YSk7XHJcbiAgaWYgKGZuKSByZXF1ZXN0Xy5lbmQoZm4pO1xyXG4gIHJldHVybiByZXF1ZXN0XztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBPUFRJT05TIHF1ZXJ5IHRvIGB1cmxgIHdpdGggb3B0aW9uYWwgY2FsbGJhY2sgYGZuKHJlcylgLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXHJcbiAqIEBwYXJhbSB7TWl4ZWR8RnVuY3Rpb259IFtkYXRhXSBvciBmblxyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbZm5dXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxucmVxdWVzdC5vcHRpb25zID0gKHVybCwgZGF0YSwgZm4pID0+IHtcclxuICBjb25zdCByZXF1ZXN0XyA9IHJlcXVlc3QoJ09QVElPTlMnLCB1cmwpO1xyXG4gIGlmICh0eXBlb2YgZGF0YSA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgZm4gPSBkYXRhO1xyXG4gICAgZGF0YSA9IG51bGw7XHJcbiAgfVxyXG5cclxuICBpZiAoZGF0YSkgcmVxdWVzdF8uc2VuZChkYXRhKTtcclxuICBpZiAoZm4pIHJlcXVlc3RfLmVuZChmbik7XHJcbiAgcmV0dXJuIHJlcXVlc3RfO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIERFTEVURSBgdXJsYCB3aXRoIG9wdGlvbmFsIGBkYXRhYCBhbmQgY2FsbGJhY2sgYGZuKHJlcylgLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXHJcbiAqIEBwYXJhbSB7TWl4ZWR9IFtkYXRhXVxyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbZm5dXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuZnVuY3Rpb24gZGVsKHVybCwgZGF0YSwgZm4pIHtcclxuICBjb25zdCByZXF1ZXN0XyA9IHJlcXVlc3QoJ0RFTEVURScsIHVybCk7XHJcbiAgaWYgKHR5cGVvZiBkYXRhID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICBmbiA9IGRhdGE7XHJcbiAgICBkYXRhID0gbnVsbDtcclxuICB9XHJcblxyXG4gIGlmIChkYXRhKSByZXF1ZXN0Xy5zZW5kKGRhdGEpO1xyXG4gIGlmIChmbikgcmVxdWVzdF8uZW5kKGZuKTtcclxuICByZXR1cm4gcmVxdWVzdF87XHJcbn1cclxuXHJcbnJlcXVlc3QuZGVsID0gZGVsO1xyXG5yZXF1ZXN0LmRlbGV0ZSA9IGRlbDtcclxuXHJcbi8qKlxyXG4gKiBQQVRDSCBgdXJsYCB3aXRoIG9wdGlvbmFsIGBkYXRhYCBhbmQgY2FsbGJhY2sgYGZuKHJlcylgLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXHJcbiAqIEBwYXJhbSB7TWl4ZWR9IFtkYXRhXVxyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbZm5dXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxucmVxdWVzdC5wYXRjaCA9ICh1cmwsIGRhdGEsIGZuKSA9PiB7XHJcbiAgY29uc3QgcmVxdWVzdF8gPSByZXF1ZXN0KCdQQVRDSCcsIHVybCk7XHJcbiAgaWYgKHR5cGVvZiBkYXRhID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICBmbiA9IGRhdGE7XHJcbiAgICBkYXRhID0gbnVsbDtcclxuICB9XHJcblxyXG4gIGlmIChkYXRhKSByZXF1ZXN0Xy5zZW5kKGRhdGEpO1xyXG4gIGlmIChmbikgcmVxdWVzdF8uZW5kKGZuKTtcclxuICByZXR1cm4gcmVxdWVzdF87XHJcbn07XHJcblxyXG4vKipcclxuICogUE9TVCBgdXJsYCB3aXRoIG9wdGlvbmFsIGBkYXRhYCBhbmQgY2FsbGJhY2sgYGZuKHJlcylgLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXHJcbiAqIEBwYXJhbSB7TWl4ZWR9IFtkYXRhXVxyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbZm5dXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxucmVxdWVzdC5wb3N0ID0gKHVybCwgZGF0YSwgZm4pID0+IHtcclxuICBjb25zdCByZXF1ZXN0XyA9IHJlcXVlc3QoJ1BPU1QnLCB1cmwpO1xyXG4gIGlmICh0eXBlb2YgZGF0YSA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgZm4gPSBkYXRhO1xyXG4gICAgZGF0YSA9IG51bGw7XHJcbiAgfVxyXG5cclxuICBpZiAoZGF0YSkgcmVxdWVzdF8uc2VuZChkYXRhKTtcclxuICBpZiAoZm4pIHJlcXVlc3RfLmVuZChmbik7XHJcbiAgcmV0dXJuIHJlcXVlc3RfO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFBVVCBgdXJsYCB3aXRoIG9wdGlvbmFsIGBkYXRhYCBhbmQgY2FsbGJhY2sgYGZuKHJlcylgLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXHJcbiAqIEBwYXJhbSB7TWl4ZWR8RnVuY3Rpb259IFtkYXRhXSBvciBmblxyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbZm5dXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxucmVxdWVzdC5wdXQgPSAodXJsLCBkYXRhLCBmbikgPT4ge1xyXG4gIGNvbnN0IHJlcXVlc3RfID0gcmVxdWVzdCgnUFVUJywgdXJsKTtcclxuICBpZiAodHlwZW9mIGRhdGEgPT09ICdmdW5jdGlvbicpIHtcclxuICAgIGZuID0gZGF0YTtcclxuICAgIGRhdGEgPSBudWxsO1xyXG4gIH1cclxuXHJcbiAgaWYgKGRhdGEpIHJlcXVlc3RfLnNlbmQoZGF0YSk7XHJcbiAgaWYgKGZuKSByZXF1ZXN0Xy5lbmQoZm4pO1xyXG4gIHJldHVybiByZXF1ZXN0XztcclxufTtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTs7QUFFQSxJQUFJQSxJQUFJO0FBQ1IsSUFBSSxPQUFPQyxNQUFNLEtBQUssV0FBVyxFQUFFO0VBQ2pDO0VBQ0FELElBQUksR0FBR0MsTUFBTTtBQUNmLENBQUMsTUFBTSxJQUFJLE9BQU9DLElBQUksS0FBSyxXQUFXLEVBQUU7RUFDdEM7RUFDQUMsT0FBTyxDQUFDQyxJQUFJLENBQ1YscUVBQ0YsQ0FBQztFQUNESixJQUFJLFNBQU87QUFDYixDQUFDLE1BQU07RUFDTDtFQUNBQSxJ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QyxPQUFPLEVBQUVMLEdBQUcsQ0FBQztFQUN0QyxJQUFJLE9BQU9nSixJQUFJLEtBQUssVUFBVSxFQUFFO0lBQzlCekIsRUFBRSxHQUFHeUIsSUFBSTtJQUNUQSxJQUFJLEdBQUcsSUFBSTtFQUNiO0VBRUEsSUFBSUEsSUFBSSxFQUFFbkYsUUFBUSxDQUFDMEcsSUFBSSxDQUFDdkIsSUFBSSxDQUFDO0VBQzdCLElBQUl6QixFQUFFLEVBQUUxRCxRQUFRLENBQUMzRCxHQUFHLENBQUNxSCxFQUFFLENBQUM7RUFDeEIsT0FBTzFELFFBQVE7QUFDakIsQ0FBQzs7QUFFRDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUF4RCxPQUFPLENBQUN5SyxJQUFJLEdBQUcsQ0FBQzlLLEdBQUcsRUFBRWdKLElBQUksRUFBRXpCLEVBQUUsS0FBSztFQUNoQyxNQUFNMUQsUUFBUSxHQUFHeEQsT0FBTyxDQUFDLE1BQU0sRUFBRUwsR0FBRyxDQUFDO0VBQ3JDLElBQUksT0FBT2dKLElBQUksS0FBSyxVQUFVLEVBQUU7SUFDOUJ6QixFQUFFLEdBQUd5QixJQUFJO0lBQ1RBLElBQUksR0FBRyxJQUFJO0VBQ2I7RUFFQSxJQUFJQSxJQUFJLEVBQUVuRixRQUFRLENBQUMwRyxJQUFJLENBQUN2QixJQUFJLENBQUM7RUFDN0IsSUFBSXpCLEVBQUUsRUFBRTFELFFBQVEsQ0FBQzNELEdBQUcsQ0FBQ3FILEVBQUUsQ0FBQztFQUN4QixPQUFPMUQsUUFBUTtBQUNqQixDQUFDOztBQUVEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQXhELE9BQU8sQ0FBQzBLLEdBQUcsR0FBRyxDQUFDL0ssR0FBRyxFQUFFZ0osSUFBSSxFQUFFekIsRUFBRSxLQUFLO0VBQy9CLE1BQU0xRCxRQUFRLEdBQUd4RCxPQUFPLENBQUMsS0FBSyxFQUFFTCxHQUFHLENBQUM7RUFDcEMsSUFBSSxPQUFPZ0osSUFBSSxLQUFLLFVBQVUsRUFBRTtJQUM5QnpCLEVBQUUsR0FBR3lCLElBQUk7SUFDVEEsSUFBSSxHQUFHLElBQUk7RUFDYjtFQUVBLElBQUlBLElBQUksRUFBRW5GLFFBQVEsQ0FBQzBHLElBQUksQ0FBQ3ZCLElBQUksQ0FBQztFQUM3QixJQUFJekIsRUFBRSxFQUFFMUQsUUFBUSxDQUFDM0QsR0FBRyxDQUFDcUgsRUFBRSxDQUFDO0VBQ3hCLE9BQU8xRCxRQUFRO0FBQ2pCLENBQUMiLCJpZ25vcmVMaXN0IjpbXX0=
"use strict";

/**
 * Module of mixed-in functions shared between node and client code
 */
const {
  isObject,
  hasOwn
} = require('./utils');

/**
 * Expose `RequestBase`.
 */

module.exports = RequestBase;

/**
 * Initialize a new `RequestBase`.
 *
 * @api public
 */

function RequestBase() {}

/**
 * Clear previous timeout.
 *
 * @return {Request} for chaining
 * @api public
 */

RequestBase.prototype.clearTimeout = function () {
  clearTimeout(this._timer);
  clearTimeout(this._responseTimeoutTimer);
  clearTimeout(this._uploadTimeoutTimer);
  delete this._timer;
  delete this._responseTimeoutTimer;
  delete this._uploadTimeoutTimer;
  return this;
};

/**
 * Override default response body parser
 *
 * This function will be called to convert incoming data into request.body
 *
 * @param {Function}
 * @api public
 */

RequestBase.prototype.parse = function (fn) {
  this._parser = fn;
  return this;
};

/**
 * Set format of binary response body.
 * In browser valid formats are 'blob' and 'arraybuffer',
 * which return Blob and ArrayBuffer, respectively.
 *
 * In Node all values result in Buffer.
 *
 * Examples:
 *
 *      req.get('/')
 *        .responseType('blob')
 *        .end(callback);
 *
 * @param {String} val
 * @return {Request} for chaining
 * @api public
 */

RequestBase.prototype.responseType = function (value) {
  this._responseType = value;
  return this;
};

/**
 * Override default request body serializer
 *
 * This function will be called to convert data set via .send or .attach into payload to send
 *
 * @param {Function}
 * @api public
 */

RequestBase.prototype.serialize = function (fn) {
  this._serializer = fn;
  return this;
};

/**
 * Set timeouts.
 *
 * - response timeout is time between sending request and receiving the first byte of the response. Includes DNS and connection time.
 * - deadline is the time from start of the request to receiving response body in full. If the deadline is too short large files may not load at all on slow connections.
 * - upload is the time  since last bit of data was sent or received. This timeout works only if deadline timeout is off
 *
 * Value of 0 or false means no timeout.
 *
 * @param {Number|Object} ms or {response, deadline}
 * @return {Request} for chaining
 * @api public
 */

RequestBase.prototype.timeout = function (options) {
  if (!options || typeof options !== 'object') {
    this._timeout = options;
    this._responseTimeout = 0;
    this._uploadTimeout = 0;
    return this;
  }
  for (const option in options) {
    if (hasOwn(options, option)) {
      switch (option) {
        case 'deadline':
          this._timeout = options.deadline;
          break;
        case 'response':
          this._responseTimeout = options.response;
          break;
        case 'upload':
          this._uploadTimeout = options.upload;
          break;
        default:
          console.warn('Unknown timeout option', option);
      }
    }
  }
  return this;
};

/**
 * Set number of retry attempts on error.
 *
 * Failed requests will be retried 'count' times if timeout or err.code >= 500.
 *
 * @param {Number} count
 * @param {Function} [fn]
 * @return {Request} for chaining
 * @api public
 */

RequestBase.prototype.retry = function (count, fn) {
  // Default to 1 if no count passed or true
  if (arguments.length === 0 || count === true) count = 1;
  if (count <= 0) count = 0;
  this._maxRetries = count;
  this._retries = 0;
  this._retryCallback = fn;
  return this;
};

//
// NOTE: we do not include ESOCKETTIMEDOUT because that is from `request` package
//       <https://github.com/sindresorhus/got/pull/537>
//
// NOTE: we do not include EADDRINFO because it was removed from libuv in 2014
//       <https://github.com/libuv/libuv/commit/02e1ebd40b807be5af46343ea873331b2ee4e9c1>
//       <https://github.com/request/request/search?q=ESOCKETTIMEDOUT&unscoped_q=ESOCKETTIMEDOUT>
//
//
// TODO: expose these as configurable defaults
//
const ERROR_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'EADDRINUSE', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'ENETUNREACH', 'EAI_AGAIN']);
const STATUS_CODES = new Set([408, 413, 429, 500, 502, 503, 504, 521, 522, 524]);

// TODO: we would need to make this easily configurable before adding it in (e.g. some might want to add POST)
// const METHODS = new Set(['GET', 'PUT', 'HEAD', 'DELETE', 'OPTIONS', 'TRACE']);

/**
 * Determine if a request should be retried.
 * (Inspired by https://github.com/sindresorhus/got#retry)
 *
 * @param {Error} err an error
 * @param {Response} [res] response
 * @returns {Boolean} if segment should be retried
 */
RequestBase.prototype._shouldRetry = function (error, res) {
  // If the terminal callback was already delivered, never retry
  if (this.called) {
    return false;
  }

  // Size-limit errors are deterministic and must never trigger a retry,
  // even if the user has configured a custom retry predicate.
  if (this.hasSizeError() || error && error.code === 'ETOOLARGE') {
    return false;
  }
  if (!this._maxRetries || this._retries++ >= this._maxRetries) {
    return false;
  }
  if (this._retryCallback) {
    try {
      const override = this._retryCallback(error, res);
      if (override === true) return true;
      if (override === false) return false;
      // undefined falls back to defaults
    } catch (err) {
      console.error(err);
    }
  }

  // TODO: we would need to make this easily configurable before adding it in (e.g. some might want to add POST)
  /*
  if (
    this.req &&
    this.req.method &&
    !METHODS.has(this.req.method.toUpperCase())
  )
    return false;
  */
  if (res && res.status && STATUS_CODES.has(res.status)) return true;
  if (error) {
    if (error.code && ERROR_CODES.has(error.code)) return true;
    // Superagent timeout
    if (error.timeout && error.code === 'ECONNABORTED') return true;
    if (error.crossDomain) return true;
  }
  return false;
};

/**
 * Retry request
 *
 * @return {Request} for chaining
 * @api private
 */

RequestBase.prototype._retry = function () {
  // Guard: if the terminal callback was already delivered to the caller,
  // we cannot safely retry — doing so would invoke the end-callback twice.
  // This prevents double-callback in the unbuffered path where .callback()
  // fires immediately on response headers (no response size limit) and then
  // an ECONNRESET on the body triggers the retry error handler.
  if (this.called) {
    return false;
  }

  // Guard: if multipart spooling is still in progress, wait for it before opening the retry attempt
  if (this._formDataSpoolPromise && !this._formDataTmpPath) {
    this._formDataSpoolPromise.then(() => {
      this._retry();
    }).catch(() => {});
    return true;
  }
  this.called = false;
  this.clearTimeout();

  // Detach and destroy old upload pipeline before resetting the counter
  if (typeof this._detachSpoolUploadStream === 'function') {
    this._detachSpoolUploadStream();
  }
  const oldRes = this.res;
  const oldResponse = this.response || this._pendingUnbufferedResponse;
  const oldReq = this.req;
  this.res = null;
  this.response = null;
  this._responseBytesReceived = undefined;
  this._requestBytesSent = 0;

  // Clean up and stop previous attempt's response streams so stale data cannot leak into or settle the retry
  if (oldResponse && typeof oldResponse._cleanupReplay === 'function') {
    oldResponse._cleanupReplay();
  }
  if (oldResponse && typeof oldResponse.on === 'function') {
    oldResponse.on('error', () => {});
  }
  if (oldRes) {
    if (typeof oldRes.on === 'function') {
      oldRes.on('error', () => {});
    }
    if (typeof oldRes.destroy === 'function') {
      oldRes.destroy();
    } else if (typeof oldRes.resume === 'function') {
      oldRes.resume();
    }
  }
  if (oldReq) {
    if (typeof oldReq.on === 'function') {
      oldReq.on('error', () => {});
    }
    this.req = null;
    this.req = this.request();
  }
  this._aborted = false;
  this.timedout = false;
  this.timedoutError = null;

  // Reset upload-completion tracking for the new attempt.
  // _formDataTmpPath is intentionally kept: the disk spool file is re-used for replay.
  this._uploadComplete = false;
  this._resEnded = false;
  this._pendingUnbufferedResponse = null;
  this._pendingBufferedResponse = null;

  // Do NOT reset _endCalled here: it records that the public .end() was called
  // and is used by _abortWithSizeError (browser) and _emitResponse (node)
  // to gate their per-response guards correctly.
  return this._end();
};

/**
 * Promise support
 *
 * @param {Function} resolve
 * @param {Function} [reject]
 * @return {Request}
 */

RequestBase.prototype.then = function (resolve, reject) {
  if (!this._fullfilledPromise) {
    const self = this;
    if (this._endCalled) {
      console.warn('Warning: superagent request was sent twice, because both .end() and .then() were called. Never call .end() if you use promises');
    }
    this._fullfilledPromise = new Promise((resolve, reject) => {
      self.on('abort', () => {
        if (this._sizeError) {
          reject(this._sizeError);
          return;
        }
        if (this._maxRetries && this._maxRetries > this._retries) {
          return;
        }
        if (this.timedout && this.timedoutError) {
          reject(this.timedoutError);
          return;
        }
        const error = new Error('Aborted');
        error.code = 'ABORTED';
        error.status = this.status;
        error.method = this.method;
        error.url = this.url;
        reject(error);
      });
      self.end((error, res) => {
        if (error) reject(error);else resolve(res);
      });
    });
  }
  return this._fullfilledPromise.then(resolve, reject);
};
RequestBase.prototype.catch = function (callback) {
  return this.then(undefined, callback);
};

/**
 * Allow for extension
 */

RequestBase.prototype.use = function (fn) {
  fn(this);
  return this;
};
RequestBase.prototype.ok = function (callback) {
  if (typeof callback !== 'function') throw new Error('Callback required');
  this._okCallback = callback;
  return this;
};
RequestBase.prototype._isResponseOK = function (res) {
  if (!res) {
    return false;
  }
  if (this._okCallback) {
    return this._okCallback(res);
  }
  return res.status >= 200 && res.status < 300;
};

/**
 * Get request header `field`.
 * Case-insensitive.
 *
 * @param {String} field
 * @return {String}
 * @api public
 */

RequestBase.prototype.get = function (field) {
  return this._header[field.toLowerCase()];
};

/**
 * Get case-insensitive header `field` value.
 * This is a deprecated internal API. Use `.get(field)` instead.
 *
 * (getHeader is no longer used internally by the superagent code base)
 *
 * @param {String} field
 * @return {String}
 * @api private
 * @deprecated
 */

RequestBase.prototype.getHeader = RequestBase.prototype.get;

/**
 * Set header `field` to `val`, or multiple fields with one object.
 * Case-insensitive.
 *
 * Examples:
 *
 *      req.get('/')
 *        .set('Accept', 'application/json')
 *        .set('X-API-Key', 'foobar')
 *        .end(callback);
 *
 *      req.get('/')
 *        .set({ Accept: 'application/json', 'X-API-Key': 'foobar' })
 *        .end(callback);
 *
 * @param {String|Object} field
 * @param {String} val
 * @return {Request} for chaining
 * @api public
 */

RequestBase.prototype.set = function (field, value) {
  if (isObject(field)) {
    for (const key in field) {
      if (hasOwn(field, key)) this.set(key, field[key]);
    }
    return this;
  }
  this._header[field.toLowerCase()] = value;
  this.header[field] = value;
  return this;
};

/**
 * Remove header `field`.
 * Case-insensitive.
 *
 * Example:
 *
 *      req.get('/')
 *        .unset('User-Agent')
 *        .end(callback);
 *
 * @param {String} field field name
 */
RequestBase.prototype.unset = function (field) {
  delete this._header[field.toLowerCase()];
  delete this.header[field];
  return this;
};

/**
 * Write the field `name` and `val`, or multiple fields with one object
 * for "multipart/form-data" request bodies.
 *
 * ``` js
 * request.post('/upload')
 *   .field('foo', 'bar')
 *   .end(callback);
 *
 * request.post('/upload')
 *   .field({ foo: 'bar', baz: 'qux' })
 *   .end(callback);
 * ```
 *
 * @param {String|Object} name name of field
 * @param {String|Blob|File|Buffer|fs.ReadStream} val value of field
 * @param {String} options extra options, e.g. 'blob'
 * @return {Request} for chaining
 * @api public
 */
RequestBase.prototype.field = function (name, value, options) {
  // name should be either a string or an object.
  if (name === null || undefined === name) {
    throw new Error('.field(name, val) name can not be empty');
  }
  if (this._data) {
    throw new Error(".field() can't be used if .send() is used. Please use only .send() or only .field() & .attach()");
  }
  if (isObject(name)) {
    for (const key in name) {
      if (hasOwn(name, key)) this.field(key, name[key]);
    }
    return this;
  }
  if (Array.isArray(value)) {
    for (const i in value) {
      if (hasOwn(value, i)) this.field(name, value[i]);
    }
    return this;
  }

  // val should be defined now
  if (value === null || undefined === value) {
    throw new Error('.field(name, val) val can not be empty');
  }
  if (typeof value === 'boolean') {
    value = String(value);
  }
  if (!this._formFields) this._formFields = [];
  this._formFields.push([name, value, options]);

  // fix https://github.com/ladjs/superagent/issues/1680
  if (options) this._getFormData().append(name, value, options);else this._getFormData().append(name, value);
  return this;
};

/**
 * Abort the request, and clear potential timeout.
 *
 * @return {Request} request
 * @api public
 */
RequestBase.prototype.abort = function () {
  if (this._aborted) {
    return this;
  }
  this._aborted = true;
  if (typeof this._cleanupSpoolFile === 'function') {
    this._cleanupSpoolFile();
  }
  if (this.xhr) this.xhr.abort(); // browser
  if (this.req) {
    this.req.abort(); // node
  }
  this.clearTimeout();
  this.emit('abort');
  return this;
};
RequestBase.prototype._auth = function (user, pass, options, base64Encoder) {
  switch (options.type) {
    case 'basic':
      this.set('Authorization', `Basic ${base64Encoder(`${user}:${pass}`)}`);
      break;
    case 'auto':
      this.username = user;
      this.password = pass;
      break;
    case 'bearer':
      // usage would be .auth(accessToken, { type: 'bearer' })
      this.set('Authorization', `Bearer ${user}`);
      break;
    default:
      break;
  }
  return this;
};

/**
 * Enable transmission of cookies with x-domain requests.
 *
 * Note that for this to work the origin must not be
 * using "Access-Control-Allow-Origin" with a wildcard,
 * and also must set "Access-Control-Allow-Credentials"
 * to "true".
 * @param {Boolean} [on=true] - Set 'withCredentials' state
 * @return {Request} for chaining
 * @api public
 */

RequestBase.prototype.withCredentials = function (on) {
  // This is browser-only functionality. Node side is no-op.
  if (on === undefined) on = true;
  this._withCredentials = on;
  return this;
};

/**
 * Set the max redirects to `n`. Does nothing in browser XHR implementation.
 *
 * @param {Number} n
 * @return {Request} for chaining
 * @api public
 */

RequestBase.prototype.redirects = function (n) {
  this._maxRedirects = n;
  return this;
};

/**
 * Set maximum size of response body, in bytes. Counts uncompressed size.
 * Default 200MB for buffered responses.
 *
 * @param {Number} n number of bytes
 * @return {Request} for chaining
 * @api public
 */
RequestBase.prototype.maxResponseSize = function (n) {
  if (typeof n !== 'number') {
    throw new TypeError('Invalid argument');
  }
  this._maxResponseSize = n;
  return this;
};

/**
 * Maximum size of request body, in bytes.
 *
 * @param {Number} n number of bytes
 * @return {Request} for chaining
 * @api public
 */
RequestBase.prototype.maxRequestSize = function (n) {
  if (typeof n !== 'number') {
    throw new TypeError('Invalid argument');
  }
  this._maxRequestSize = n;
  return this;
};

/**
 * Check whether this request exceeded its request or response size limit.
 *
 * @return {Boolean}
 * @api public
 */
RequestBase.prototype.hasSizeError = function () {
  return Boolean(this._sizeError);
};

/**
 * Convert to a plain javascript object (not JSON string) of scalar properties.
 * Note as this method is designed to return a useful non-this value,
 * it cannot be chained.
 *
 * @return {Object} describing method, url, and data of this request
 * @api public
 */

RequestBase.prototype.toJSON = function () {
  return {
    method: this.method,
    url: this.url,
    data: this._data,
    headers: this._header
  };
};

/**
 * Send `data` as the request body, defaulting the `.type()` to "json" when
 * an object is given.
 *
 * Examples:
 *
 *       // manual json
 *       request.post('/user')
 *         .type('json')
 *         .send('{"name":"tj"}')
 *         .end(callback)
 *
 *       // auto json
 *       request.post('/user')
 *         .send({ name: 'tj' })
 *         .end(callback)
 *
 *       // manual x-www-form-urlencoded
 *       request.post('/user')
 *         .type('form')
 *         .send('name=tj')
 *         .end(callback)
 *
 *       // auto x-www-form-urlencoded
 *       request.post('/user')
 *         .type('form')
 *         .send({ name: 'tj' })
 *         .end(callback)
 *
 *       // defaults to x-www-form-urlencoded
 *      request.post('/user')
 *        .send('name=tobi')
 *        .send('species=ferret')
 *        .end(callback)
 *
 * @param {String|Object} data
 * @return {Request} for chaining
 * @api public
 */

// eslint-disable-next-line complexity
RequestBase.prototype.send = function (data) {
  const isObject_ = isObject(data);
  let type = this._header['content-type'];
  if (this._formData) {
    throw new Error(".send() can't be used if .attach() or .field() is used. Please use only .send() or only .field() & .attach()");
  }
  if (isObject_ && !this._data) {
    if (Array.isArray(data)) {
      this._data = [];
    } else if (!this._isHost(data)) {
      this._data = {};
    }
  } else if (data && this._data && this._isHost(this._data)) {
    throw new Error("Can't merge these send calls");
  }

  // merge
  if (isObject_ && isObject(this._data)) {
    for (const key in data) {
      if (typeof data[key] == 'bigint' && !data[key].toJSON) throw new Error('Cannot serialize BigInt value to json');
      if (hasOwn(data, key)) this._data[key] = data[key];
    }
  } else if (typeof data === 'bigint') throw new Error("Cannot send value of type BigInt");else if (typeof data === 'string') {
    // default to x-www-form-urlencoded
    if (!type) this.type('form');
    type = this._header['content-type'];
    if (type) type = type.toLowerCase().trim();
    if (type === 'application/x-www-form-urlencoded') {
      this._data = this._data ? `${this._data}&${data}` : data;
    } else {
      this._data = (this._data || '') + data;
    }
  } else {
    this._data = data;
  }
  if (!isObject_ || this._isHost(data)) {
    return this;
  }

  // default to json
  if (!type) this.type('json');
  return this;
};

/**
 * Sort `querystring` by the sort function
 *
 *
 * Examples:
 *
 *       // default order
 *       request.get('/user')
 *         .query('name=Nick')
 *         .query('search=Manny')
 *         .sortQuery()
 *         .end(callback)
 *
 *       // customized sort function
 *       request.get('/user')
 *         .query('name=Nick')
 *         .query('search=Manny')
 *         .sortQuery(function(a, b){
 *           return a.length - b.length;
 *         })
 *         .end(callback)
 *
 *
 * @param {Function} sort
 * @return {Request} for chaining
 * @api public
 */

RequestBase.prototype.sortQuery = function (sort) {
  // _sort default to true but otherwise can be a function or boolean
  this._sort = typeof sort === 'undefined' ? true : sort;
  return this;
};

/**
 * Compose querystring to append to req.url
 *
 * @api private
 */
RequestBase.prototype._finalizeQueryString = function () {
  const query = this._query.join('&');
  if (query) {
    this.url += (this.url.includes('?') ? '&' : '?') + query;
  }
  this._query.length = 0; // Makes the call idempotent

  if (this._sort) {
    const index = this.url.indexOf('?');
    if (index >= 0) {
      const queryArray = this.url.slice(index + 1).split('&');
      if (typeof this._sort === 'function') {
        queryArray.sort(this._sort);
      } else {
        queryArray.sort();
      }
      this.url = this.url.slice(0, index) + '?' + queryArray.join('&');
    }
  }
};

// For backwards compat only
RequestBase.prototype._appendQueryString = () => {
  console.warn('Unsupported');
};

/**
 * Invoke callback with timeout error.
 *
 * @api private
 */

RequestBase.prototype._timeoutError = function (reason, timeout, errno) {
  if (this._aborted) {
    return;
  }
  const error = new Error(`${reason + timeout}ms exceeded`);
  error.timeout = timeout;
  error.code = 'ECONNABORTED';
  error.errno = errno;
  this.timedout = true;
  this.timedoutError = error;
  this.abort();
  this.callback(error);
};
RequestBase.prototype._setTimeouts = function () {
  const self = this;

  // deadline
  if (this._timeout && !this._timer) {
    this._timer = setTimeout(() => {
      self._timeoutError('Timeout of ', self._timeout, 'ETIME');
    }, this._timeout);
  }

  // response timeout
  if (this._responseTimeout && !this._responseTimeoutTimer) {
    this._responseTimeoutTimer = setTimeout(() => {
      self._timeoutError('Response timeout of ', self._responseTimeout, 'ETIMEDOUT');
    }, this._responseTimeout);
  }
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJpc09iamVjdCIsImhhc093biIsInJlcXVpcmUiLCJtb2R1bGUiLCJleHBvcnRzIiwiUmVxdWVzdEJhc2UiLCJwcm90b3R5cGUiLCJjbGVhclRpbWVvdXQiLCJfdGltZXIiLCJfcmVzcG9uc2VUaW1lb3V0VGltZXIiLCJfdXBsb2FkVGltZW91dFRpbWVyIiwicGFyc2UiLCJmbiIsIl9wYXJzZXIiLCJyZXNwb25zZVR5cGUiLCJ2YWx1ZSIsIl9yZXNwb25zZVR5cGUiLCJzZXJpYWxpemUiLCJfc2VyaWFsaXplciIsInRpbWVvdXQiLCJvcHRpb25zIiwiX3RpbWVvdXQiLCJfcmVzcG9uc2VUaW1lb3V0IiwiX3VwbG9hZFRpbWVvdXQiLCJvcHRpb24iLCJkZWFkbGluZSIsInJlc3BvbnNlIiwidXBsb2FkIiwiY29uc29sZSIsIndhcm4iLCJyZXRyeSIsImNvdW50IiwiYXJndW1lbnRzIiwibGVuZ3RoIiwiX21heFJldHJpZXMiLCJfcmV0cmllcyIsIl9yZXRyeUNhbGxiYWNrIiwiRVJST1JfQ09ERVMiLCJTZXQiLCJTVEFUVVNfQ09ERVMiLCJfc2hvdWxkUmV0cnkiLCJlcnJvciIsInJlcyIsImNhbGxlZCIsImhhc1NpemVFcnJvciIsImNvZGUiLCJvdmVycmlkZSIsImVyciIsInN0YXR1cyIsImhhcyIsImNyb3NzRG9tYWluIiwiX3JldHJ5IiwiX2Zvcm1EYXRhU3Bvb2xQcm9taXNlIiwiX2Zvcm1EYXRhVG1wUGF0aCIsInRoZW4iLCJjYXRjaCIsIl9kZXRhY2hTcG9vbFVwbG9hZFN0cmVhbSIsIm9sZFJlcyIsIm9sZFJlc3BvbnNlIiwiX3BlbmRpbmdVbmJ1ZmZlcmVkUmVzcG9uc2UiLCJvbGRSZXEiLCJyZXEiLCJfcmVzcG9uc2VCeXRlc1JlY2VpdmVkIiwidW5kZWZpbmVkIiwiX3JlcXVlc3RCeXRlc1NlbnQiLCJfY2xlYW51cFJlcGxheSIsIm9uIiwiZGVzdHJveSIsInJlc3VtZSIsInJlcXVlc3QiLCJfYWJvcnRlZCIsInRpbWVkb3V0IiwidGltZWRvdXRFcnJvciIsIl91cGxvYWRDb21wbGV0ZSIsIl9yZXNFbmRlZCIsIl9wZW5kaW5nQnVmZmVyZWRSZXNwb25zZSIsIl9lbmQiLCJyZXNvbHZlIiwicmVqZWN0IiwiX2Z1bGxmaWxsZWRQcm9taXNlIiwic2VsZiIsIl9lbmRDYWxsZWQiLCJQcm9taXNlIiwiX3NpemVFcnJvciIsIkVycm9yIiwibWV0aG9kIiwidXJsIiwiZW5kIiwiY2FsbGJhY2siLCJ1c2UiLCJvayIsIl9va0NhbGxiYWNrIiwiX2lzUmVzcG9uc2VPSyIsImdldCIsImZpZWxkIiwiX2hlYWRlciIsInRvTG93ZXJDYXNlIiwiZ2V0SGVhZGVyIiwic2V0Iiwia2V5IiwiaGVhZGVyIiwidW5zZXQiLCJuYW1lIiwiX2RhdGEiLCJBcnJheSIsImlzQXJyYXkiLCJpIiwiU3RyaW5nIiwiX2Zvcm1GaWVsZHMiLCJwdXNoIiwiX2dldEZvcm1EYXRhIiwiYXBwZW5kIiwiYWJvcnQiLCJfY2xlYW51cFNwb29sRmlsZSIsInhociIsImVtaXQiLCJfYXV0aCIsInVzZXIiLCJwYXNzIiwiYmFzZTY0RW5jb2RlciIsInR5cGUiLCJ1c2VybmFtZSIsInBhc3N3b3JkIiwid2l0aENyZWRlbnRpYWxzIiwiX3dpdGhDcmVkZW50aWFscyIsInJlZGlyZWN0cyIsIm4iLCJfbWF4UmVkaXJlY3RzIiwibWF4UmVzcG9uc2VTaXplIiwiVHlwZUVycm9yIiwiX21heFJlc3BvbnNlU2l6ZSIsIm1heFJlcXVlc3RTaXplIiwiX21heFJlcXVlc3RTaXplIiwiQm9vbGVhbiIsInRvSlNPTiIsImRhdGEiLCJoZWFkZXJzIiwic2VuZCIsImlzT2JqZWN0XyIsIl9mb3JtRGF0YSIsIl9pc0hvc3QiLCJ0cmltIiwic29ydFF1ZXJ5Iiwic29ydCIsIl9zb3J0IiwiX2ZpbmFsaXplUXVlcnlTdHJpbmciLCJxdWVyeSIsIl9xdWVyeSIsImpvaW4iLCJpbmNsdWRlcyIsImluZGV4IiwiaW5kZXhPZiIsInF1ZXJ5QXJyYXkiLCJzbGljZSIsInNwbGl0IiwiX2FwcGVuZFF1ZXJ5U3RyaW5nIiwiX3RpbWVvdXRFcnJvciIsInJlYXNvbiIsImVycm5vIiwiX3NldFRpbWVvdXRzIiwic2V0VGltZW91dCJdLCJzb3VyY2VzIjpbIi4uL3NyYy9yZXF1ZXN0LWJhc2UuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBNb2R1bGUgb2YgbWl4ZWQtaW4gZnVuY3Rpb25zIHNoYXJlZCBiZXR3ZWVuIG5vZGUgYW5kIGNsaWVudCBjb2RlXG4gKi9cbmNvbnN0IHsgaXNPYmplY3QsIGhhc093biB9ID0gcmVxdWlyZSgnLi91dGlscycpO1xuXG4vKipcbiAqIEV4cG9zZSBgUmVxdWVzdEJhc2VgLlxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gUmVxdWVzdEJhc2U7XG5cbi8qKlxuICogSW5pdGlhbGl6ZSBhIG5ldyBgUmVxdWVzdEJhc2VgLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gUmVxdWVzdEJhc2UoKSB7fVxuXG4vKipcbiAqIENsZWFyIHByZXZpb3VzIHRpbWVvdXQuXG4gKlxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3RCYXNlLnByb3RvdHlwZS5jbGVhclRpbWVvdXQgPSBmdW5jdGlvbiAoKSB7XG4gIGNsZWFyVGltZW91dCh0aGlzLl90aW1lcik7XG4gIGNsZWFyVGltZW91dCh0aGlzLl9yZXNwb25zZVRpbWVvdXRUaW1lcik7XG4gIGNsZWFyVGltZW91dCh0aGlzLl91cGxvYWRUaW1lb3V0VGltZXIpO1xuICBkZWxldGUgdGhpcy5fdGltZXI7XG4gIGRlbGV0ZSB0aGlzLl9yZXNwb25zZVRpbWVvdXRUaW1lcjtcbiAgZGVsZXRlIHRoaXMuX3VwbG9hZFRpbWVvdXRUaW1lcjtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIE92ZXJyaWRlIGRlZmF1bHQgcmVzcG9uc2UgYm9keSBwYXJzZXJcbiAqXG4gKiBUaGlzIGZ1bmN0aW9uIHdpbGwgYmUgY2FsbGVkIHRvIGNvbnZlcnQgaW5jb21pbmcgZGF0YSBpbnRvIHJlcXVlc3QuYm9keVxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3RCYXNlLnByb3RvdHlwZS5wYXJzZSA9IGZ1bmN0aW9uIChmbikge1xuICB0aGlzLl9wYXJzZXIgPSBmbjtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIFNldCBmb3JtYXQgb2YgYmluYXJ5IHJlc3BvbnNlIGJvZHkuXG4gKiBJbiBicm93c2VyIHZhbGlkIGZvcm1hdHMgYXJlICdibG9iJyBhbmQgJ2FycmF5YnVmZmVyJyxcbiAqIHdoaWNoIHJldHVybiBCbG9iIGFuZCBBcnJheUJ1ZmZlciwgcmVzcGVjdGl2ZWx5LlxuICpcbiAqIEluIE5vZGUgYWxsIHZhbHVlcyByZXN1bHQgaW4gQnVmZmVyLlxuICpcbiAqIEV4YW1wbGVzOlxuICpcbiAqICAgICAgcmVxLmdldCgnLycpXG4gKiAgICAgICAgLnJlc3BvbnNlVHlwZSgnYmxvYicpXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHZhbFxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3RCYXNlLnByb3RvdHlwZS5yZXNwb25zZVR5cGUgPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgdGhpcy5fcmVzcG9uc2VUeXBlID0gdmFsdWU7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBPdmVycmlkZSBkZWZhdWx0IHJlcXVlc3QgYm9keSBzZXJpYWxpemVyXG4gKlxuICogVGhpcyBmdW5jdGlvbiB3aWxsIGJlIGNhbGxlZCB0byBjb252ZXJ0IGRhdGEgc2V0IHZpYSAuc2VuZCBvciAuYXR0YWNoIGludG8gcGF5bG9hZCB0byBzZW5kXG4gKlxuICogQHBhcmFtIHtGdW5jdGlvbn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdEJhc2UucHJvdG90eXBlLnNlcmlhbGl6ZSA9IGZ1bmN0aW9uIChmbikge1xuICB0aGlzLl9zZXJpYWxpemVyID0gZm47XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBTZXQgdGltZW91dHMuXG4gKlxuICogLSByZXNwb25zZSB0aW1lb3V0IGlzIHRpbWUgYmV0d2VlbiBzZW5kaW5nIHJlcXVlc3QgYW5kIHJlY2VpdmluZyB0aGUgZmlyc3QgYnl0ZSBvZiB0aGUgcmVzcG9uc2UuIEluY2x1ZGVzIEROUyBhbmQgY29ubmVjdGlvbiB0aW1lLlxuICogLSBkZWFkbGluZSBpcyB0aGUgdGltZSBmcm9tIHN0YXJ0IG9mIHRoZSByZXF1ZXN0IHRvIHJlY2VpdmluZyByZXNwb25zZSBib2R5IGluIGZ1bGwuIElmIHRoZSBkZWFkbGluZSBpcyB0b28gc2hvcnQgbGFyZ2UgZmlsZXMgbWF5IG5vdCBsb2FkIGF0IGFsbCBvbiBzbG93IGNvbm5lY3Rpb25zLlxuICogLSB1cGxvYWQgaXMgdGhlIHRpbWUgIHNpbmNlIGxhc3QgYml0IG9mIGRhdGEgd2FzIHNlbnQgb3IgcmVjZWl2ZWQuIFRoaXMgdGltZW91dCB3b3JrcyBvbmx5IGlmIGRlYWRsaW5lIHRpbWVvdXQgaXMgb2ZmXG4gKlxuICogVmFsdWUgb2YgMCBvciBmYWxzZSBtZWFucyBubyB0aW1lb3V0LlxuICpcbiAqIEBwYXJhbSB7TnVtYmVyfE9iamVjdH0gbXMgb3Ige3Jlc3BvbnNlLCBkZWFkbGluZX1cbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUudGltZW91dCA9IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gIGlmICghb3B0aW9ucyB8fCB0eXBlb2Ygb3B0aW9ucyAhPT0gJ29iamVjdCcpIHtcbiAgICB0aGlzLl90aW1lb3V0ID0gb3B0aW9ucztcbiAgICB0aGlzLl9yZXNwb25zZVRpbWVvdXQgPSAwO1xuICAgIHRoaXMuX3VwbG9hZFRpbWVvdXQgPSAwO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgZm9yIChjb25zdCBvcHRpb24gaW4gb3B0aW9ucykge1xuICAgIGlmIChoYXNPd24ob3B0aW9ucywgb3B0aW9uKSkge1xuICAgICAgc3dpdGNoIChvcHRpb24pIHtcbiAgICAgICAgY2FzZSAnZGVhZGxpbmUnOlxuICAgICAgICAgIHRoaXMuX3RpbWVvdXQgPSBvcHRpb25zLmRlYWRsaW5lO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdyZXNwb25zZSc6XG4gICAgICAgICAgdGhpcy5fcmVzcG9uc2VUaW1lb3V0ID0gb3B0aW9ucy5yZXNwb25zZTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAndXBsb2FkJzpcbiAgICAgICAgICB0aGlzLl91cGxvYWRUaW1lb3V0ID0gb3B0aW9ucy51cGxvYWQ7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgY29uc29sZS53YXJuKCdVbmtub3duIHRpbWVvdXQgb3B0aW9uJywgb3B0aW9uKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogU2V0IG51bWJlciBvZiByZXRyeSBhdHRlbXB0cyBvbiBlcnJvci5cbiAqXG4gKiBGYWlsZWQgcmVxdWVzdHMgd2lsbCBiZSByZXRyaWVkICdjb3VudCcgdGltZXMgaWYgdGltZW91dCBvciBlcnIuY29kZSA+PSA1MDAuXG4gKlxuICogQHBhcmFtIHtOdW1iZXJ9IGNvdW50XG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbZm5dXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdEJhc2UucHJvdG90eXBlLnJldHJ5ID0gZnVuY3Rpb24gKGNvdW50LCBmbikge1xuICAvLyBEZWZhdWx0IHRvIDEgaWYgbm8gY291bnQgcGFzc2VkIG9yIHRydWVcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDAgfHwgY291bnQgPT09IHRydWUpIGNvdW50ID0gMTtcbiAgaWYgKGNvdW50IDw9IDApIGNvdW50ID0gMDtcbiAgdGhpcy5fbWF4UmV0cmllcyA9IGNvdW50O1xuICB0aGlzLl9yZXRyaWVzID0gMDtcbiAgdGhpcy5fcmV0cnlDYWxsYmFjayA9IGZuO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8vXG4vLyBOT1RFOiB3ZSBkbyBub3QgaW5jbHVkZSBFU09DS0VUVElNRURPVVQgYmVjYXVzZSB0aGF0IGlzIGZyb20gYHJlcXVlc3RgIHBhY2thZ2Vcbi8vICAgICAgIDxodHRwczovL2dpdGh1Yi5jb20vc2luZHJlc29yaHVzL2dvdC9wdWxsLzUzNz5cbi8vXG4vLyBOT1RFOiB3ZSBkbyBub3QgaW5jbHVkZSBFQUREUklORk8gYmVjYXVzZSBpdCB3YXMgcmVtb3ZlZCBmcm9tIGxpYnV2IGluIDIwMTRcbi8vICAgICAgIDxodHRwczovL2dpdGh1Yi5jb20vbGlidXYvbGlidXYvY29tbWl0LzAyZTFlYmQ0MGI4MDdiZTVhZjQ2MzQzZWE4NzMzMzFiMmVlNGU5YzE+XG4vLyAgICAgICA8aHR0cHM6Ly9naXRodWIuY29tL3JlcXVlc3QvcmVxdWVzdC9zZWFyY2g/cT1FU09DS0VUVElNRURPVVQmdW5zY29wZWRfcT1FU09DS0VUVElNRURPVVQ+XG4vL1xuLy9cbi8vIFRPRE86IGV4cG9zZSB0aGVzZSBhcyBjb25maWd1cmFibGUgZGVmYXVsdHNcbi8vXG5jb25zdCBFUlJPUl9DT0RFUyA9IG5ldyBTZXQoW1xuICAnRVRJTUVET1VUJyxcbiAgJ0VDT05OUkVTRVQnLFxuICAnRUFERFJJTlVTRScsXG4gICdFQ09OTlJFRlVTRUQnLFxuICAnRVBJUEUnLFxuICAnRU5PVEZPVU5EJyxcbiAgJ0VORVRVTlJFQUNIJyxcbiAgJ0VBSV9BR0FJTidcbl0pO1xuXG5jb25zdCBTVEFUVVNfQ09ERVMgPSBuZXcgU2V0KFtcbiAgNDA4LCA0MTMsIDQyOSwgNTAwLCA1MDIsIDUwMywgNTA0LCA1MjEsIDUyMiwgNTI0XG5dKTtcblxuLy8gVE9ETzogd2Ugd291bGQgbmVlZCB0byBtYWtlIHRoaXMgZWFzaWx5IGNvbmZpZ3VyYWJsZSBiZWZvcmUgYWRkaW5nIGl0IGluIChlLmcuIHNvbWUgbWlnaHQgd2FudCB0byBhZGQgUE9TVClcbi8vIGNvbnN0IE1FVEhPRFMgPSBuZXcgU2V0KFsnR0VUJywgJ1BVVCcsICdIRUFEJywgJ0RFTEVURScsICdPUFRJT05TJywgJ1RSQUNFJ10pO1xuXG4vKipcbiAqIERldGVybWluZSBpZiBhIHJlcXVlc3Qgc2hvdWxkIGJlIHJldHJpZWQuXG4gKiAoSW5zcGlyZWQgYnkgaHR0cHM6Ly9naXRodWIuY29tL3NpbmRyZXNvcmh1cy9nb3QjcmV0cnkpXG4gKlxuICogQHBhcmFtIHtFcnJvcn0gZXJyIGFuIGVycm9yXG4gKiBAcGFyYW0ge1Jlc3BvbnNlfSBbcmVzXSByZXNwb25zZVxuICogQHJldHVybnMge0Jvb2xlYW59IGlmIHNlZ21lbnQgc2hvdWxkIGJlIHJldHJpZWRcbiAqL1xuUmVxdWVzdEJhc2UucHJvdG90eXBlLl9zaG91bGRSZXRyeSA9IGZ1bmN0aW9uIChlcnJvciwgcmVzKSB7XG4gIC8vIElmIHRoZSB0ZXJtaW5hbCBjYWxsYmFjayB3YXMgYWxyZWFkeSBkZWxpdmVyZWQsIG5ldmVyIHJldHJ5XG4gIGlmICh0aGlzLmNhbGxlZCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8vIFNpemUtbGltaXQgZXJyb3JzIGFyZSBkZXRlcm1pbmlzdGljIGFuZCBtdXN0IG5ldmVyIHRyaWdnZXIgYSByZXRyeSxcbiAgLy8gZXZlbiBpZiB0aGUgdXNlciBoYXMgY29uZmlndXJlZCBhIGN1c3RvbSByZXRyeSBwcmVkaWNhdGUuXG4gIGlmICh0aGlzLmhhc1NpemVFcnJvcigpIHx8IChlcnJvciAmJiBlcnJvci5jb2RlID09PSAnRVRPT0xBUkdFJykpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBpZiAoIXRoaXMuX21heFJldHJpZXMgfHwgdGhpcy5fcmV0cmllcysrID49IHRoaXMuX21heFJldHJpZXMpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBpZiAodGhpcy5fcmV0cnlDYWxsYmFjaykge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBvdmVycmlkZSA9IHRoaXMuX3JldHJ5Q2FsbGJhY2soZXJyb3IsIHJlcyk7XG4gICAgICBpZiAob3ZlcnJpZGUgPT09IHRydWUpIHJldHVybiB0cnVlO1xuICAgICAgaWYgKG92ZXJyaWRlID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlO1xuICAgICAgLy8gdW5kZWZpbmVkIGZhbGxzIGJhY2sgdG8gZGVmYXVsdHNcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoZXJyKTtcbiAgICB9XG4gIH1cblxuICAvLyBUT0RPOiB3ZSB3b3VsZCBuZWVkIHRvIG1ha2UgdGhpcyBlYXNpbHkgY29uZmlndXJhYmxlIGJlZm9yZSBhZGRpbmcgaXQgaW4gKGUuZy4gc29tZSBtaWdodCB3YW50IHRvIGFkZCBQT1NUKVxuICAvKlxuICBpZiAoXG4gICAgdGhpcy5yZXEgJiZcbiAgICB0aGlzLnJlcS5tZXRob2QgJiZcbiAgICAhTUVUSE9EUy5oYXModGhpcy5yZXEubWV0aG9kLnRvVXBwZXJDYXNlKCkpXG4gIClcbiAgICByZXR1cm4gZmFsc2U7XG4gICovXG4gIGlmIChyZXMgJiYgcmVzLnN0YXR1cyAmJiBTVEFUVVNfQ09ERVMuaGFzKHJlcy5zdGF0dXMpKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKGVycm9yKSB7XG4gICAgaWYgKGVycm9yLmNvZGUgJiYgRVJST1JfQ09ERVMuaGFzKGVycm9yLmNvZGUpKSByZXR1cm4gdHJ1ZTtcbiAgICAvLyBTdXBlcmFnZW50IHRpbWVvdXRcbiAgICBpZiAoZXJyb3IudGltZW91dCAmJiBlcnJvci5jb2RlID09PSAnRUNPTk5BQk9SVEVEJykgcmV0dXJuIHRydWU7XG4gICAgaWYgKGVycm9yLmNyb3NzRG9tYWluKSByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIHJldHVybiBmYWxzZTtcbn07XG5cbi8qKlxuICogUmV0cnkgcmVxdWVzdFxuICpcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwcml2YXRlXG4gKi9cblxuUmVxdWVzdEJhc2UucHJvdG90eXBlLl9yZXRyeSA9IGZ1bmN0aW9uICgpIHtcbiAgLy8gR3VhcmQ6IGlmIHRoZSB0ZXJtaW5hbCBjYWxsYmFjayB3YXMgYWxyZWFkeSBkZWxpdmVyZWQgdG8gdGhlIGNhbGxlcixcbiAgLy8gd2UgY2Fubm90IHNhZmVseSByZXRyeSDigJQgZG9pbmcgc28gd291bGQgaW52b2tlIHRoZSBlbmQtY2FsbGJhY2sgdHdpY2UuXG4gIC8vIFRoaXMgcHJldmVudHMgZG91YmxlLWNhbGxiYWNrIGluIHRoZSB1bmJ1ZmZlcmVkIHBhdGggd2hlcmUgLmNhbGxiYWNrKClcbiAgLy8gZmlyZXMgaW1tZWRpYXRlbHkgb24gcmVzcG9uc2UgaGVhZGVycyAobm8gcmVzcG9uc2Ugc2l6ZSBsaW1pdCkgYW5kIHRoZW5cbiAgLy8gYW4gRUNPTk5SRVNFVCBvbiB0aGUgYm9keSB0cmlnZ2VycyB0aGUgcmV0cnkgZXJyb3IgaGFuZGxlci5cbiAgaWYgKHRoaXMuY2FsbGVkKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gR3VhcmQ6IGlmIG11bHRpcGFydCBzcG9vbGluZyBpcyBzdGlsbCBpbiBwcm9ncmVzcywgd2FpdCBmb3IgaXQgYmVmb3JlIG9wZW5pbmcgdGhlIHJldHJ5IGF0dGVtcHRcbiAgaWYgKHRoaXMuX2Zvcm1EYXRhU3Bvb2xQcm9taXNlICYmICF0aGlzLl9mb3JtRGF0YVRtcFBhdGgpIHtcbiAgICB0aGlzLl9mb3JtRGF0YVNwb29sUHJvbWlzZS50aGVuKCgpID0+IHtcbiAgICAgIHRoaXMuX3JldHJ5KCk7XG4gICAgfSkuY2F0Y2goKCkgPT4ge30pO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgdGhpcy5jYWxsZWQgPSBmYWxzZTtcbiAgdGhpcy5jbGVhclRpbWVvdXQoKTtcblxuXG4gIC8vIERldGFjaCBhbmQgZGVzdHJveSBvbGQgdXBsb2FkIHBpcGVsaW5lIGJlZm9yZSByZXNldHRpbmcgdGhlIGNvdW50ZXJcbiAgaWYgKHR5cGVvZiB0aGlzLl9kZXRhY2hTcG9vbFVwbG9hZFN0cmVhbSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHRoaXMuX2RldGFjaFNwb29sVXBsb2FkU3RyZWFtKCk7XG4gIH1cblxuICBjb25zdCBvbGRSZXMgPSB0aGlzLnJlcztcbiAgY29uc3Qgb2xkUmVzcG9uc2UgPSB0aGlzLnJlc3BvbnNlIHx8IHRoaXMuX3BlbmRpbmdVbmJ1ZmZlcmVkUmVzcG9uc2U7XG4gIGNvbnN0IG9sZFJlcSA9IHRoaXMucmVxO1xuXG4gIHRoaXMucmVzID0gbnVsbDtcbiAgdGhpcy5yZXNwb25zZSA9IG51bGw7XG4gIHRoaXMuX3Jlc3BvbnNlQnl0ZXNSZWNlaXZlZCA9IHVuZGVmaW5lZDtcbiAgdGhpcy5fcmVxdWVzdEJ5dGVzU2VudCA9IDA7XG5cbiAgLy8gQ2xlYW4gdXAgYW5kIHN0b3AgcHJldmlvdXMgYXR0ZW1wdCdzIHJlc3BvbnNlIHN0cmVhbXMgc28gc3RhbGUgZGF0YSBjYW5ub3QgbGVhayBpbnRvIG9yIHNldHRsZSB0aGUgcmV0cnlcbiAgaWYgKG9sZFJlc3BvbnNlICYmIHR5cGVvZiBvbGRSZXNwb25zZS5fY2xlYW51cFJlcGxheSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIG9sZFJlc3BvbnNlLl9jbGVhbnVwUmVwbGF5KCk7XG4gIH1cbiAgaWYgKG9sZFJlc3BvbnNlICYmIHR5cGVvZiBvbGRSZXNwb25zZS5vbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIG9sZFJlc3BvbnNlLm9uKCdlcnJvcicsICgpID0+IHt9KTtcbiAgfVxuICBpZiAob2xkUmVzKSB7XG4gICAgaWYgKHR5cGVvZiBvbGRSZXMub24gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIG9sZFJlcy5vbignZXJyb3InLCAoKSA9PiB7fSk7XG4gICAgfVxuICAgIGlmICh0eXBlb2Ygb2xkUmVzLmRlc3Ryb3kgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIG9sZFJlcy5kZXN0cm95KCk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2Ygb2xkUmVzLnJlc3VtZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgb2xkUmVzLnJlc3VtZSgpO1xuICAgIH1cbiAgfVxuICBpZiAob2xkUmVxKSB7XG4gICAgaWYgKHR5cGVvZiBvbGRSZXEub24gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIG9sZFJlcS5vbignZXJyb3InLCAoKSA9PiB7fSk7XG4gICAgfVxuICAgIHRoaXMucmVxID0gbnVsbDtcbiAgICB0aGlzLnJlcSA9IHRoaXMucmVxdWVzdCgpO1xuICB9XG5cbiAgdGhpcy5fYWJvcnRlZCA9IGZhbHNlO1xuICB0aGlzLnRpbWVkb3V0ID0gZmFsc2U7XG4gIHRoaXMudGltZWRvdXRFcnJvciA9IG51bGw7XG5cbiAgLy8gUmVzZXQgdXBsb2FkLWNvbXBsZXRpb24gdHJhY2tpbmcgZm9yIHRoZSBuZXcgYXR0ZW1wdC5cbiAgLy8gX2Zvcm1EYXRhVG1wUGF0aCBpcyBpbnRlbnRpb25hbGx5IGtlcHQ6IHRoZSBkaXNrIHNwb29sIGZpbGUgaXMgcmUtdXNlZCBmb3IgcmVwbGF5LlxuICB0aGlzLl91cGxvYWRDb21wbGV0ZSA9IGZhbHNlO1xuICB0aGlzLl9yZXNFbmRlZCA9IGZhbHNlO1xuICB0aGlzLl9wZW5kaW5nVW5idWZmZXJlZFJlc3BvbnNlID0gbnVsbDtcbiAgdGhpcy5fcGVuZGluZ0J1ZmZlcmVkUmVzcG9uc2UgPSBudWxsO1xuXG4gIC8vIERvIE5PVCByZXNldCBfZW5kQ2FsbGVkIGhlcmU6IGl0IHJlY29yZHMgdGhhdCB0aGUgcHVibGljIC5lbmQoKSB3YXMgY2FsbGVkXG4gIC8vIGFuZCBpcyB1c2VkIGJ5IF9hYm9ydFdpdGhTaXplRXJyb3IgKGJyb3dzZXIpIGFuZCBfZW1pdFJlc3BvbnNlIChub2RlKVxuICAvLyB0byBnYXRlIHRoZWlyIHBlci1yZXNwb25zZSBndWFyZHMgY29ycmVjdGx5LlxuICByZXR1cm4gdGhpcy5fZW5kKCk7XG59O1xuXG4vKipcbiAqIFByb21pc2Ugc3VwcG9ydFxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IHJlc29sdmVcbiAqIEBwYXJhbSB7RnVuY3Rpb259IFtyZWplY3RdXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fVxuICovXG5cblJlcXVlc3RCYXNlLnByb3RvdHlwZS50aGVuID0gZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICBpZiAoIXRoaXMuX2Z1bGxmaWxsZWRQcm9taXNlKSB7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHRoaXMuX2VuZENhbGxlZCkge1xuICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICAnV2FybmluZzogc3VwZXJhZ2VudCByZXF1ZXN0IHdhcyBzZW50IHR3aWNlLCBiZWNhdXNlIGJvdGggLmVuZCgpIGFuZCAudGhlbigpIHdlcmUgY2FsbGVkLiBOZXZlciBjYWxsIC5lbmQoKSBpZiB5b3UgdXNlIHByb21pc2VzJ1xuICAgICAgKTtcbiAgICB9XG5cbiAgICB0aGlzLl9mdWxsZmlsbGVkUHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHNlbGYub24oJ2Fib3J0JywgKCkgPT4ge1xuICAgICAgICBpZiAodGhpcy5fc2l6ZUVycm9yKSB7XG4gICAgICAgICAgcmVqZWN0KHRoaXMuX3NpemVFcnJvcik7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMuX21heFJldHJpZXMgJiYgdGhpcy5fbWF4UmV0cmllcyA+IHRoaXMuX3JldHJpZXMpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy50aW1lZG91dCAmJiB0aGlzLnRpbWVkb3V0RXJyb3IpIHtcbiAgICAgICAgICByZWplY3QodGhpcy50aW1lZG91dEVycm9yKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcignQWJvcnRlZCcpO1xuICAgICAgICBlcnJvci5jb2RlID0gJ0FCT1JURUQnO1xuICAgICAgICBlcnJvci5zdGF0dXMgPSB0aGlzLnN0YXR1cztcbiAgICAgICAgZXJyb3IubWV0aG9kID0gdGhpcy5tZXRob2Q7XG4gICAgICAgIGVycm9yLnVybCA9IHRoaXMudXJsO1xuICAgICAgICByZWplY3QoZXJyb3IpO1xuICAgICAgfSk7XG4gICAgICBzZWxmLmVuZCgoZXJyb3IsIHJlcykgPT4ge1xuICAgICAgICBpZiAoZXJyb3IpIHJlamVjdChlcnJvcik7XG4gICAgICAgIGVsc2UgcmVzb2x2ZShyZXMpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gdGhpcy5fZnVsbGZpbGxlZFByb21pc2UudGhlbihyZXNvbHZlLCByZWplY3QpO1xufTtcblxuUmVxdWVzdEJhc2UucHJvdG90eXBlLmNhdGNoID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gIHJldHVybiB0aGlzLnRoZW4odW5kZWZpbmVkLCBjYWxsYmFjayk7XG59O1xuXG4vKipcbiAqIEFsbG93IGZvciBleHRlbnNpb25cbiAqL1xuXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24gKGZuKSB7XG4gIGZuKHRoaXMpO1xuICByZXR1cm4gdGhpcztcbn07XG5cblJlcXVlc3RCYXNlLnByb3RvdHlwZS5vayA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICBpZiAodHlwZW9mIGNhbGxiYWNrICE9PSAnZnVuY3Rpb24nKSB0aHJvdyBuZXcgRXJyb3IoJ0NhbGxiYWNrIHJlcXVpcmVkJyk7XG4gIHRoaXMuX29rQ2FsbGJhY2sgPSBjYWxsYmFjaztcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUuX2lzUmVzcG9uc2VPSyA9IGZ1bmN0aW9uIChyZXMpIHtcbiAgaWYgKCFyZXMpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBpZiAodGhpcy5fb2tDYWxsYmFjaykge1xuICAgIHJldHVybiB0aGlzLl9va0NhbGxiYWNrKHJlcyk7XG4gIH1cblxuICByZXR1cm4gcmVzLnN0YXR1cyA+PSAyMDAgJiYgcmVzLnN0YXR1cyA8IDMwMDtcbn07XG5cbi8qKlxuICogR2V0IHJlcXVlc3QgaGVhZGVyIGBmaWVsZGAuXG4gKiBDYXNlLWluc2Vuc2l0aXZlLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBmaWVsZFxuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24gKGZpZWxkKSB7XG4gIHJldHVybiB0aGlzLl9oZWFkZXJbZmllbGQudG9Mb3dlckNhc2UoKV07XG59O1xuXG4vKipcbiAqIEdldCBjYXNlLWluc2Vuc2l0aXZlIGhlYWRlciBgZmllbGRgIHZhbHVlLlxuICogVGhpcyBpcyBhIGRlcHJlY2F0ZWQgaW50ZXJuYWwgQVBJLiBVc2UgYC5nZXQoZmllbGQpYCBpbnN0ZWFkLlxuICpcbiAqIChnZXRIZWFkZXIgaXMgbm8gbG9uZ2VyIHVzZWQgaW50ZXJuYWxseSBieSB0aGUgc3VwZXJhZ2VudCBjb2RlIGJhc2UpXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGZpZWxkXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKiBAYXBpIHByaXZhdGVcbiAqIEBkZXByZWNhdGVkXG4gKi9cblxuUmVxdWVzdEJhc2UucHJvdG90eXBlLmdldEhlYWRlciA9IFJlcXVlc3RCYXNlLnByb3RvdHlwZS5nZXQ7XG5cbi8qKlxuICogU2V0IGhlYWRlciBgZmllbGRgIHRvIGB2YWxgLCBvciBtdWx0aXBsZSBmaWVsZHMgd2l0aCBvbmUgb2JqZWN0LlxuICogQ2FzZS1pbnNlbnNpdGl2ZS5cbiAqXG4gKiBFeGFtcGxlczpcbiAqXG4gKiAgICAgIHJlcS5nZXQoJy8nKVxuICogICAgICAgIC5zZXQoJ0FjY2VwdCcsICdhcHBsaWNhdGlvbi9qc29uJylcbiAqICAgICAgICAuc2V0KCdYLUFQSS1LZXknLCAnZm9vYmFyJylcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcbiAqXG4gKiAgICAgIHJlcS5nZXQoJy8nKVxuICogICAgICAgIC5zZXQoeyBBY2NlcHQ6ICdhcHBsaWNhdGlvbi9qc29uJywgJ1gtQVBJLUtleSc6ICdmb29iYXInIH0pXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XG4gKlxuICogQHBhcmFtIHtTdHJpbmd8T2JqZWN0fSBmaWVsZFxuICogQHBhcmFtIHtTdHJpbmd9IHZhbFxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3RCYXNlLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbiAoZmllbGQsIHZhbHVlKSB7XG4gIGlmIChpc09iamVjdChmaWVsZCkpIHtcbiAgICBmb3IgKGNvbnN0IGtleSBpbiBmaWVsZCkge1xuICAgICAgaWYgKGhhc093bihmaWVsZCwga2V5KSkgdGhpcy5zZXQoa2V5LCBmaWVsZFtrZXldKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIHRoaXMuX2hlYWRlcltmaWVsZC50b0xvd2VyQ2FzZSgpXSA9IHZhbHVlO1xuICB0aGlzLmhlYWRlcltmaWVsZF0gPSB2YWx1ZTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIFJlbW92ZSBoZWFkZXIgYGZpZWxkYC5cbiAqIENhc2UtaW5zZW5zaXRpdmUuXG4gKlxuICogRXhhbXBsZTpcbiAqXG4gKiAgICAgIHJlcS5nZXQoJy8nKVxuICogICAgICAgIC51bnNldCgnVXNlci1BZ2VudCcpXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGZpZWxkIGZpZWxkIG5hbWVcbiAqL1xuUmVxdWVzdEJhc2UucHJvdG90eXBlLnVuc2V0ID0gZnVuY3Rpb24gKGZpZWxkKSB7XG4gIGRlbGV0ZSB0aGlzLl9oZWFkZXJbZmllbGQudG9Mb3dlckNhc2UoKV07XG4gIGRlbGV0ZSB0aGlzLmhlYWRlcltmaWVsZF07XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBXcml0ZSB0aGUgZmllbGQgYG5hbWVgIGFuZCBgdmFsYCwgb3IgbXVsdGlwbGUgZmllbGRzIHdpdGggb25lIG9iamVjdFxuICogZm9yIFwibXVsdGlwYXJ0L2Zvcm0tZGF0YVwiIHJlcXVlc3QgYm9kaWVzLlxuICpcbiAqIGBgYCBqc1xuICogcmVxdWVzdC5wb3N0KCcvdXBsb2FkJylcbiAqICAgLmZpZWxkKCdmb28nLCAnYmFyJylcbiAqICAgLmVuZChjYWxsYmFjayk7XG4gKlxuICogcmVxdWVzdC5wb3N0KCcvdXBsb2FkJylcbiAqICAgLmZpZWxkKHsgZm9vOiAnYmFyJywgYmF6OiAncXV4JyB9KVxuICogICAuZW5kKGNhbGxiYWNrKTtcbiAqIGBgYFxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfE9iamVjdH0gbmFtZSBuYW1lIG9mIGZpZWxkXG4gKiBAcGFyYW0ge1N0cmluZ3xCbG9ifEZpbGV8QnVmZmVyfGZzLlJlYWRTdHJlYW19IHZhbCB2YWx1ZSBvZiBmaWVsZFxuICogQHBhcmFtIHtTdHJpbmd9IG9wdGlvbnMgZXh0cmEgb3B0aW9ucywgZS5nLiAnYmxvYidcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuUmVxdWVzdEJhc2UucHJvdG90eXBlLmZpZWxkID0gZnVuY3Rpb24gKG5hbWUsIHZhbHVlLCBvcHRpb25zKSB7XG4gIC8vIG5hbWUgc2hvdWxkIGJlIGVpdGhlciBhIHN0cmluZyBvciBhbiBvYmplY3QuXG4gIGlmIChuYW1lID09PSBudWxsIHx8IHVuZGVmaW5lZCA9PT0gbmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcignLmZpZWxkKG5hbWUsIHZhbCkgbmFtZSBjYW4gbm90IGJlIGVtcHR5Jyk7XG4gIH1cblxuICBpZiAodGhpcy5fZGF0YSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiLmZpZWxkKCkgY2FuJ3QgYmUgdXNlZCBpZiAuc2VuZCgpIGlzIHVzZWQuIFBsZWFzZSB1c2Ugb25seSAuc2VuZCgpIG9yIG9ubHkgLmZpZWxkKCkgJiAuYXR0YWNoKClcIlxuICAgICk7XG4gIH1cblxuICBpZiAoaXNPYmplY3QobmFtZSkpIHtcbiAgICBmb3IgKGNvbnN0IGtleSBpbiBuYW1lKSB7XG4gICAgICBpZiAoaGFzT3duKG5hbWUsIGtleSkpIHRoaXMuZmllbGQoa2V5LCBuYW1lW2tleV0pO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgZm9yIChjb25zdCBpIGluIHZhbHVlKSB7XG4gICAgICBpZiAoaGFzT3duKHZhbHVlLCBpKSkgdGhpcy5maWVsZChuYW1lLCB2YWx1ZVtpXSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvLyB2YWwgc2hvdWxkIGJlIGRlZmluZWQgbm93XG4gIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB1bmRlZmluZWQgPT09IHZhbHVlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCcuZmllbGQobmFtZSwgdmFsKSB2YWwgY2FuIG5vdCBiZSBlbXB0eScpO1xuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgdmFsdWUgPSBTdHJpbmcodmFsdWUpO1xuICB9XG5cbiAgaWYgKCF0aGlzLl9mb3JtRmllbGRzKSB0aGlzLl9mb3JtRmllbGRzID0gW107XG4gIHRoaXMuX2Zvcm1GaWVsZHMucHVzaChbbmFtZSwgdmFsdWUsIG9wdGlvbnNdKTtcblxuICAvLyBmaXggaHR0cHM6Ly9naXRodWIuY29tL2xhZGpzL3N1cGVyYWdlbnQvaXNzdWVzLzE2ODBcbiAgaWYgKG9wdGlvbnMpIHRoaXMuX2dldEZvcm1EYXRhKCkuYXBwZW5kKG5hbWUsIHZhbHVlLCBvcHRpb25zKTtcbiAgZWxzZSB0aGlzLl9nZXRGb3JtRGF0YSgpLmFwcGVuZChuYW1lLCB2YWx1ZSk7XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIEFib3J0IHRoZSByZXF1ZXN0LCBhbmQgY2xlYXIgcG90ZW50aWFsIHRpbWVvdXQuXG4gKlxuICogQHJldHVybiB7UmVxdWVzdH0gcmVxdWVzdFxuICogQGFwaSBwdWJsaWNcbiAqL1xuUmVxdWVzdEJhc2UucHJvdG90eXBlLmFib3J0ID0gZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5fYWJvcnRlZCkge1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgdGhpcy5fYWJvcnRlZCA9IHRydWU7XG4gIGlmICh0eXBlb2YgdGhpcy5fY2xlYW51cFNwb29sRmlsZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHRoaXMuX2NsZWFudXBTcG9vbEZpbGUoKTtcbiAgfVxuICBpZiAodGhpcy54aHIpIHRoaXMueGhyLmFib3J0KCk7IC8vIGJyb3dzZXJcbiAgaWYgKHRoaXMucmVxKSB7XG4gICAgdGhpcy5yZXEuYWJvcnQoKTsgLy8gbm9kZVxuICB9XG5cbiAgdGhpcy5jbGVhclRpbWVvdXQoKTtcbiAgdGhpcy5lbWl0KCdhYm9ydCcpO1xuICByZXR1cm4gdGhpcztcbn07XG5cblJlcXVlc3RCYXNlLnByb3RvdHlwZS5fYXV0aCA9IGZ1bmN0aW9uICh1c2VyLCBwYXNzLCBvcHRpb25zLCBiYXNlNjRFbmNvZGVyKSB7XG4gIHN3aXRjaCAob3B0aW9ucy50eXBlKSB7XG4gICAgY2FzZSAnYmFzaWMnOlxuICAgICAgdGhpcy5zZXQoJ0F1dGhvcml6YXRpb24nLCBgQmFzaWMgJHtiYXNlNjRFbmNvZGVyKGAke3VzZXJ9OiR7cGFzc31gKX1gKTtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAnYXV0byc6XG4gICAgICB0aGlzLnVzZXJuYW1lID0gdXNlcjtcbiAgICAgIHRoaXMucGFzc3dvcmQgPSBwYXNzO1xuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlICdiZWFyZXInOiAvLyB1c2FnZSB3b3VsZCBiZSAuYXV0aChhY2Nlc3NUb2tlbiwgeyB0eXBlOiAnYmVhcmVyJyB9KVxuICAgICAgdGhpcy5zZXQoJ0F1dGhvcml6YXRpb24nLCBgQmVhcmVyICR7dXNlcn1gKTtcbiAgICAgIGJyZWFrO1xuICAgIGRlZmF1bHQ6XG4gICAgICBicmVhaztcbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBFbmFibGUgdHJhbnNtaXNzaW9uIG9mIGNvb2tpZXMgd2l0aCB4LWRvbWFpbiByZXF1ZXN0cy5cbiAqXG4gKiBOb3RlIHRoYXQgZm9yIHRoaXMgdG8gd29yayB0aGUgb3JpZ2luIG11c3Qgbm90IGJlXG4gKiB1c2luZyBcIkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpblwiIHdpdGggYSB3aWxkY2FyZCxcbiAqIGFuZCBhbHNvIG11c3Qgc2V0IFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctQ3JlZGVudGlhbHNcIlxuICogdG8gXCJ0cnVlXCIuXG4gKiBAcGFyYW0ge0Jvb2xlYW59IFtvbj10cnVlXSAtIFNldCAnd2l0aENyZWRlbnRpYWxzJyBzdGF0ZVxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3RCYXNlLnByb3RvdHlwZS53aXRoQ3JlZGVudGlhbHMgPSBmdW5jdGlvbiAob24pIHtcbiAgLy8gVGhpcyBpcyBicm93c2VyLW9ubHkgZnVuY3Rpb25hbGl0eS4gTm9kZSBzaWRlIGlzIG5vLW9wLlxuICBpZiAob24gPT09IHVuZGVmaW5lZCkgb24gPSB0cnVlO1xuICB0aGlzLl93aXRoQ3JlZGVudGlhbHMgPSBvbjtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIFNldCB0aGUgbWF4IHJlZGlyZWN0cyB0byBgbmAuIERvZXMgbm90aGluZyBpbiBicm93c2VyIFhIUiBpbXBsZW1lbnRhdGlvbi5cbiAqXG4gKiBAcGFyYW0ge051bWJlcn0gblxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3RCYXNlLnByb3RvdHlwZS5yZWRpcmVjdHMgPSBmdW5jdGlvbiAobikge1xuICB0aGlzLl9tYXhSZWRpcmVjdHMgPSBuO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogU2V0IG1heGltdW0gc2l6ZSBvZiByZXNwb25zZSBib2R5LCBpbiBieXRlcy4gQ291bnRzIHVuY29tcHJlc3NlZCBzaXplLlxuICogRGVmYXVsdCAyMDBNQiBmb3IgYnVmZmVyZWQgcmVzcG9uc2VzLlxuICpcbiAqIEBwYXJhbSB7TnVtYmVyfSBuIG51bWJlciBvZiBieXRlc1xuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUubWF4UmVzcG9uc2VTaXplID0gZnVuY3Rpb24gKG4pIHtcbiAgaWYgKHR5cGVvZiBuICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0ludmFsaWQgYXJndW1lbnQnKTtcbiAgfVxuXG4gIHRoaXMuX21heFJlc3BvbnNlU2l6ZSA9IG47XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBNYXhpbXVtIHNpemUgb2YgcmVxdWVzdCBib2R5LCBpbiBieXRlcy5cbiAqXG4gKiBAcGFyYW0ge051bWJlcn0gbiBudW1iZXIgb2YgYnl0ZXNcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuUmVxdWVzdEJhc2UucHJvdG90eXBlLm1heFJlcXVlc3RTaXplID0gZnVuY3Rpb24gKG4pIHtcbiAgaWYgKHR5cGVvZiBuICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0ludmFsaWQgYXJndW1lbnQnKTtcbiAgfVxuXG4gIHRoaXMuX21heFJlcXVlc3RTaXplID0gbjtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIENoZWNrIHdoZXRoZXIgdGhpcyByZXF1ZXN0IGV4Y2VlZGVkIGl0cyByZXF1ZXN0IG9yIHJlc3BvbnNlIHNpemUgbGltaXQuXG4gKlxuICogQHJldHVybiB7Qm9vbGVhbn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblJlcXVlc3RCYXNlLnByb3RvdHlwZS5oYXNTaXplRXJyb3IgPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiBCb29sZWFuKHRoaXMuX3NpemVFcnJvcik7XG59O1xuXG4vKipcbiAqIENvbnZlcnQgdG8gYSBwbGFpbiBqYXZhc2NyaXB0IG9iamVjdCAobm90IEpTT04gc3RyaW5nKSBvZiBzY2FsYXIgcHJvcGVydGllcy5cbiAqIE5vdGUgYXMgdGhpcyBtZXRob2QgaXMgZGVzaWduZWQgdG8gcmV0dXJuIGEgdXNlZnVsIG5vbi10aGlzIHZhbHVlLFxuICogaXQgY2Fubm90IGJlIGNoYWluZWQuXG4gKlxuICogQHJldHVybiB7T2JqZWN0fSBkZXNjcmliaW5nIG1ldGhvZCwgdXJsLCBhbmQgZGF0YSBvZiB0aGlzIHJlcXVlc3RcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdEJhc2UucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uICgpIHtcbiAgcmV0dXJuIHtcbiAgICBtZXRob2Q6IHRoaXMubWV0aG9kLFxuICAgIHVybDogdGhpcy51cmwsXG4gICAgZGF0YTogdGhpcy5fZGF0YSxcbiAgICBoZWFkZXJzOiB0aGlzLl9oZWFkZXJcbiAgfTtcbn07XG5cbi8qKlxuICogU2VuZCBgZGF0YWAgYXMgdGhlIHJlcXVlc3QgYm9keSwgZGVmYXVsdGluZyB0aGUgYC50eXBlKClgIHRvIFwianNvblwiIHdoZW5cbiAqIGFuIG9iamVjdCBpcyBnaXZlbi5cbiAqXG4gKiBFeGFtcGxlczpcbiAqXG4gKiAgICAgICAvLyBtYW51YWwganNvblxuICogICAgICAgcmVxdWVzdC5wb3N0KCcvdXNlcicpXG4gKiAgICAgICAgIC50eXBlKCdqc29uJylcbiAqICAgICAgICAgLnNlbmQoJ3tcIm5hbWVcIjpcInRqXCJ9JylcbiAqICAgICAgICAgLmVuZChjYWxsYmFjaylcbiAqXG4gKiAgICAgICAvLyBhdXRvIGpzb25cbiAqICAgICAgIHJlcXVlc3QucG9zdCgnL3VzZXInKVxuICogICAgICAgICAuc2VuZCh7IG5hbWU6ICd0aicgfSlcbiAqICAgICAgICAgLmVuZChjYWxsYmFjaylcbiAqXG4gKiAgICAgICAvLyBtYW51YWwgeC13d3ctZm9ybS11cmxlbmNvZGVkXG4gKiAgICAgICByZXF1ZXN0LnBvc3QoJy91c2VyJylcbiAqICAgICAgICAgLnR5cGUoJ2Zvcm0nKVxuICogICAgICAgICAuc2VuZCgnbmFtZT10aicpXG4gKiAgICAgICAgIC5lbmQoY2FsbGJhY2spXG4gKlxuICogICAgICAgLy8gYXV0byB4LXd3dy1mb3JtLXVybGVuY29kZWRcbiAqICAgICAgIHJlcXVlc3QucG9zdCgnL3VzZXInKVxuICogICAgICAgICAudHlwZSgnZm9ybScpXG4gKiAgICAgICAgIC5zZW5kKHsgbmFtZTogJ3RqJyB9KVxuICogICAgICAgICAuZW5kKGNhbGxiYWNrKVxuICpcbiAqICAgICAgIC8vIGRlZmF1bHRzIHRvIHgtd3d3LWZvcm0tdXJsZW5jb2RlZFxuICogICAgICByZXF1ZXN0LnBvc3QoJy91c2VyJylcbiAqICAgICAgICAuc2VuZCgnbmFtZT10b2JpJylcbiAqICAgICAgICAuc2VuZCgnc3BlY2llcz1mZXJyZXQnKVxuICogICAgICAgIC5lbmQoY2FsbGJhY2spXG4gKlxuICogQHBhcmFtIHtTdHJpbmd8T2JqZWN0fSBkYXRhXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIGNvbXBsZXhpdHlcblJlcXVlc3RCYXNlLnByb3RvdHlwZS5zZW5kID0gZnVuY3Rpb24gKGRhdGEpIHtcbiAgY29uc3QgaXNPYmplY3RfID0gaXNPYmplY3QoZGF0YSk7XG4gIGxldCB0eXBlID0gdGhpcy5faGVhZGVyWydjb250ZW50LXR5cGUnXTtcblxuICBpZiAodGhpcy5fZm9ybURhdGEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIi5zZW5kKCkgY2FuJ3QgYmUgdXNlZCBpZiAuYXR0YWNoKCkgb3IgLmZpZWxkKCkgaXMgdXNlZC4gUGxlYXNlIHVzZSBvbmx5IC5zZW5kKCkgb3Igb25seSAuZmllbGQoKSAmIC5hdHRhY2goKVwiXG4gICAgKTtcbiAgfVxuXG4gIGlmIChpc09iamVjdF8gJiYgIXRoaXMuX2RhdGEpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShkYXRhKSkge1xuICAgICAgdGhpcy5fZGF0YSA9IFtdO1xuICAgIH0gZWxzZSBpZiAoIXRoaXMuX2lzSG9zdChkYXRhKSkge1xuICAgICAgdGhpcy5fZGF0YSA9IHt9O1xuICAgIH1cbiAgfSBlbHNlIGlmIChkYXRhICYmIHRoaXMuX2RhdGEgJiYgdGhpcy5faXNIb3N0KHRoaXMuX2RhdGEpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQ2FuJ3QgbWVyZ2UgdGhlc2Ugc2VuZCBjYWxsc1wiKTtcbiAgfVxuXG4gIC8vIG1lcmdlXG4gIGlmIChpc09iamVjdF8gJiYgaXNPYmplY3QodGhpcy5fZGF0YSkpIHtcbiAgICBmb3IgKGNvbnN0IGtleSBpbiBkYXRhKSB7XG4gICAgICBpZiAodHlwZW9mIGRhdGFba2V5XSA9PSAnYmlnaW50JyAmJiAhZGF0YVtrZXldLnRvSlNPTilcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3Qgc2VyaWFsaXplIEJpZ0ludCB2YWx1ZSB0byBqc29uJyk7XG4gICAgICBpZiAoaGFzT3duKGRhdGEsIGtleSkpIHRoaXMuX2RhdGFba2V5XSA9IGRhdGFba2V5XTtcbiAgICB9XG4gIH1cbiAgZWxzZSBpZiAodHlwZW9mIGRhdGEgPT09ICdiaWdpbnQnKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3Qgc2VuZCB2YWx1ZSBvZiB0eXBlIEJpZ0ludFwiKTtcbiAgZWxzZSBpZiAodHlwZW9mIGRhdGEgPT09ICdzdHJpbmcnKSB7XG4gICAgLy8gZGVmYXVsdCB0byB4LXd3dy1mb3JtLXVybGVuY29kZWRcbiAgICBpZiAoIXR5cGUpIHRoaXMudHlwZSgnZm9ybScpO1xuICAgIHR5cGUgPSB0aGlzLl9oZWFkZXJbJ2NvbnRlbnQtdHlwZSddO1xuICAgIGlmICh0eXBlKSB0eXBlID0gdHlwZS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcbiAgICBpZiAodHlwZSA9PT0gJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCcpIHtcbiAgICAgIHRoaXMuX2RhdGEgPSB0aGlzLl9kYXRhID8gYCR7dGhpcy5fZGF0YX0mJHtkYXRhfWAgOiBkYXRhO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9kYXRhID0gKHRoaXMuX2RhdGEgfHwgJycpICsgZGF0YTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5fZGF0YSA9IGRhdGE7XG4gIH1cblxuICBpZiAoIWlzT2JqZWN0XyB8fCB0aGlzLl9pc0hvc3QoZGF0YSkpIHtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vIGRlZmF1bHQgdG8ganNvblxuICBpZiAoIXR5cGUpIHRoaXMudHlwZSgnanNvbicpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogU29ydCBgcXVlcnlzdHJpbmdgIGJ5IHRoZSBzb3J0IGZ1bmN0aW9uXG4gKlxuICpcbiAqIEV4YW1wbGVzOlxuICpcbiAqICAgICAgIC8vIGRlZmF1bHQgb3JkZXJcbiAqICAgICAgIHJlcXVlc3QuZ2V0KCcvdXNlcicpXG4gKiAgICAgICAgIC5xdWVyeSgnbmFtZT1OaWNrJylcbiAqICAgICAgICAgLnF1ZXJ5KCdzZWFyY2g9TWFubnknKVxuICogICAgICAgICAuc29ydFF1ZXJ5KClcbiAqICAgICAgICAgLmVuZChjYWxsYmFjaylcbiAqXG4gKiAgICAgICAvLyBjdXN0b21pemVkIHNvcnQgZnVuY3Rpb25cbiAqICAgICAgIHJlcXVlc3QuZ2V0KCcvdXNlcicpXG4gKiAgICAgICAgIC5xdWVyeSgnbmFtZT1OaWNrJylcbiAqICAgICAgICAgLnF1ZXJ5KCdzZWFyY2g9TWFubnknKVxuICogICAgICAgICAuc29ydFF1ZXJ5KGZ1bmN0aW9uKGEsIGIpe1xuICogICAgICAgICAgIHJldHVybiBhLmxlbmd0aCAtIGIubGVuZ3RoO1xuICogICAgICAgICB9KVxuICogICAgICAgICAuZW5kKGNhbGxiYWNrKVxuICpcbiAqXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBzb3J0XG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdEJhc2UucHJvdG90eXBlLnNvcnRRdWVyeSA9IGZ1bmN0aW9uIChzb3J0KSB7XG4gIC8vIF9zb3J0IGRlZmF1bHQgdG8gdHJ1ZSBidXQgb3RoZXJ3aXNlIGNhbiBiZSBhIGZ1bmN0aW9uIG9yIGJvb2xlYW5cbiAgdGhpcy5fc29ydCA9IHR5cGVvZiBzb3J0ID09PSAndW5kZWZpbmVkJyA/IHRydWUgOiBzb3J0O1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogQ29tcG9zZSBxdWVyeXN0cmluZyB0byBhcHBlbmQgdG8gcmVxLnVybFxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUuX2ZpbmFsaXplUXVlcnlTdHJpbmcgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IHF1ZXJ5ID0gdGhpcy5fcXVlcnkuam9pbignJicpO1xuICBpZiAocXVlcnkpIHtcbiAgICB0aGlzLnVybCArPSAodGhpcy51cmwuaW5jbHVkZXMoJz8nKSA/ICcmJyA6ICc/JykgKyBxdWVyeTtcbiAgfVxuXG4gIHRoaXMuX3F1ZXJ5Lmxlbmd0aCA9IDA7IC8vIE1ha2VzIHRoZSBjYWxsIGlkZW1wb3RlbnRcblxuICBpZiAodGhpcy5fc29ydCkge1xuICAgIGNvbnN0IGluZGV4ID0gdGhpcy51cmwuaW5kZXhPZignPycpO1xuICAgIGlmIChpbmRleCA+PSAwKSB7XG4gICAgICBjb25zdCBxdWVyeUFycmF5ID0gdGhpcy51cmwuc2xpY2UoaW5kZXggKyAxKS5zcGxpdCgnJicpO1xuICAgICAgaWYgKHR5cGVvZiB0aGlzLl9zb3J0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHF1ZXJ5QXJyYXkuc29ydCh0aGlzLl9zb3J0KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHF1ZXJ5QXJyYXkuc29ydCgpO1xuICAgICAgfVxuXG4gICAgICB0aGlzLnVybCA9IHRoaXMudXJsLnNsaWNlKDAsIGluZGV4KSArICc/JyArIHF1ZXJ5QXJyYXkuam9pbignJicpO1xuICAgIH1cbiAgfVxufTtcblxuLy8gRm9yIGJhY2t3YXJkcyBjb21wYXQgb25seVxuUmVxdWVzdEJhc2UucHJvdG90eXBlLl9hcHBlbmRRdWVyeVN0cmluZyA9ICgpID0+IHtcbiAgY29uc29sZS53YXJuKCdVbnN1cHBvcnRlZCcpO1xufTtcblxuLyoqXG4gKiBJbnZva2UgY2FsbGJhY2sgd2l0aCB0aW1lb3V0IGVycm9yLlxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblJlcXVlc3RCYXNlLnByb3RvdHlwZS5fdGltZW91dEVycm9yID0gZnVuY3Rpb24gKHJlYXNvbiwgdGltZW91dCwgZXJybm8pIHtcbiAgaWYgKHRoaXMuX2Fib3J0ZWQpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcihgJHtyZWFzb24gKyB0aW1lb3V0fW1zIGV4Y2VlZGVkYCk7XG4gIGVycm9yLnRpbWVvdXQgPSB0aW1lb3V0O1xuICBlcnJvci5jb2RlID0gJ0VDT05OQUJPUlRFRCc7XG4gIGVycm9yLmVycm5vID0gZXJybm87XG4gIHRoaXMudGltZWRvdXQgPSB0cnVlO1xuICB0aGlzLnRpbWVkb3V0RXJyb3IgPSBlcnJvcjtcbiAgdGhpcy5hYm9ydCgpO1xuICB0aGlzLmNhbGxiYWNrKGVycm9yKTtcbn07XG5cblJlcXVlc3RCYXNlLnByb3RvdHlwZS5fc2V0VGltZW91dHMgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IHNlbGYgPSB0aGlzO1xuXG4gIC8vIGRlYWRsaW5lXG4gIGlmICh0aGlzLl90aW1lb3V0ICYmICF0aGlzLl90aW1lcikge1xuICAgIHRoaXMuX3RpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICBzZWxmLl90aW1lb3V0RXJyb3IoJ1RpbWVvdXQgb2YgJywgc2VsZi5fdGltZW91dCwgJ0VUSU1FJyk7XG4gICAgfSwgdGhpcy5fdGltZW91dCk7XG4gIH1cblxuICAvLyByZXNwb25zZSB0aW1lb3V0XG4gIGlmICh0aGlzLl9yZXNwb25zZVRpbWVvdXQgJiYgIXRoaXMuX3Jlc3BvbnNlVGltZW91dFRpbWVyKSB7XG4gICAgdGhpcy5fcmVzcG9uc2VUaW1lb3V0VGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHNlbGYuX3RpbWVvdXRFcnJvcihcbiAgICAgICAgJ1Jlc3BvbnNlIHRpbWVvdXQgb2YgJyxcbiAgICAgICAgc2VsZi5fcmVzcG9uc2VUaW1lb3V0LFxuICAgICAgICAnRVRJTUVET1VUJ1xuICAgICAgKTtcbiAgICB9LCB0aGlzLl9yZXNwb25zZVRpbWVvdXQpO1xuICB9XG59O1xuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBLE1BQU07RUFBRUEsUUFBUTtFQUFFQztBQUFPLENBQUMsR0FBR0MsT0FBTyxDQUFDLFNBQVMsQ0FBQzs7QUFFL0M7QUFDQTtBQUNBOztBQUVBQyxNQUFNLENBQUNDLE9BQU8sR0FBR0MsV0FBVzs7QUFFNUI7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxTQUFTQSxXQUFXQSxDQUFBLEVBQUcsQ0FBQzs7QUFFeEI7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBQSxXQUFXLENBQUNDLFNBQVMsQ0FBQ0MsWUFBWSxHQUFHLFlBQVk7RUFDL0NBLFlBQVksQ0FBQyxJQUFJLENBQUNDLE1BQU0sQ0FBQztFQUN6QkQsWUFBWSxDQUFDLElBQUksQ0FBQ0UscUJBQXFCLENBQUM7RUFDeENGLFlBQVksQ0FBQyxJQUFJLENBQUNHLG1CQUFtQixDQUFDO0VBQ3RDLE9BQU8sSUFBSSxDQUFDRixNQUFNO0VBQ2xCLE9BQU8sSUFBSSxDQUFDQyxxQkFBcUI7RUFDakMsT0FBTyxJQUFJLENBQUNDLG1CQUFtQjtFQUMvQixPQUFPLElBQUk7QUFDYixD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
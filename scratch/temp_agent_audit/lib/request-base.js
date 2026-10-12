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
  // A size limit is a deterministic client-side failure. It must not be
  // retried, even when a custom retry callback would otherwise opt in.
  if (error && error.code === 'ETOOLARGE') {
    if (this._maxRetries) this._retries++;
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
  this.clearTimeout();

  // node
  if (this.req) {
    this.req = null;
    this.req = this.request();
  }
  this._aborted = false;
  this.timedout = false;
  this.timedoutError = null;
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
 * Maximum size of buffered response body, in bytes. Counts uncompressed size.
 * Default 200MB.
 *
 * @param {Number} n number of bytes
 * @return {Request} for chaining
 */
RequestBase.prototype.maxResponseSize = function (n) {
  if (typeof n !== 'number') {
    throw new TypeError('Invalid argument');
  }
  this._maxResponseSize = n;
  return this;
};

/**
 * Maximum size of the request body, in bytes.
 *
 * @param {Number} n number of bytes
 * @return {Request} for chaining
 */
RequestBase.prototype.maxRequestSize = function (n) {
  if (typeof n !== 'number') {
    throw new TypeError('Invalid argument');
  }
  this._maxRequestSize = n;
  return this;
};

/**
 * Return whether a request or response size limit was exceeded.
 *
 * @return {Boolean}
 */
RequestBase.prototype.hasSizeError = function () {
  return this._sizeError === true;
};

/**
 * Create and remember a size-limit error.
 *
 * @param {String} kind request or response
 * @return {Error}
 * @api private
 */
RequestBase.prototype._createSizeError = function (kind) {
  if (!this._sizeErrorError) {
    const error = new Error(`Maximum ${kind} size reached`);
    error.code = 'ETOOLARGE';
    this._sizeErrorError = error;
  }
  this._sizeError = true;
  return this._sizeErrorError;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJpc09iamVjdCIsImhhc093biIsInJlcXVpcmUiLCJtb2R1bGUiLCJleHBvcnRzIiwiUmVxdWVzdEJhc2UiLCJwcm90b3R5cGUiLCJjbGVhclRpbWVvdXQiLCJfdGltZXIiLCJfcmVzcG9uc2VUaW1lb3V0VGltZXIiLCJfdXBsb2FkVGltZW91dFRpbWVyIiwicGFyc2UiLCJmbiIsIl9wYXJzZXIiLCJyZXNwb25zZVR5cGUiLCJ2YWx1ZSIsIl9yZXNwb25zZVR5cGUiLCJzZXJpYWxpemUiLCJfc2VyaWFsaXplciIsInRpbWVvdXQiLCJvcHRpb25zIiwiX3RpbWVvdXQiLCJfcmVzcG9uc2VUaW1lb3V0IiwiX3VwbG9hZFRpbWVvdXQiLCJvcHRpb24iLCJkZWFkbGluZSIsInJlc3BvbnNlIiwidXBsb2FkIiwiY29uc29sZSIsIndhcm4iLCJyZXRyeSIsImNvdW50IiwiYXJndW1lbnRzIiwibGVuZ3RoIiwiX21heFJldHJpZXMiLCJfcmV0cmllcyIsIl9yZXRyeUNhbGxiYWNrIiwiRVJST1JfQ09ERVMiLCJTZXQiLCJTVEFUVVNfQ09ERVMiLCJfc2hvdWxkUmV0cnkiLCJlcnJvciIsInJlcyIsImNvZGUiLCJvdmVycmlkZSIsImVyciIsInN0YXR1cyIsImhhcyIsImNyb3NzRG9tYWluIiwiX3JldHJ5IiwicmVxIiwicmVxdWVzdCIsIl9hYm9ydGVkIiwidGltZWRvdXQiLCJ0aW1lZG91dEVycm9yIiwiX2VuZCIsInRoZW4iLCJyZXNvbHZlIiwicmVqZWN0IiwiX2Z1bGxmaWxsZWRQcm9taXNlIiwic2VsZiIsIl9lbmRDYWxsZWQiLCJQcm9taXNlIiwib24iLCJFcnJvciIsIm1ldGhvZCIsInVybCIsImVuZCIsImNhdGNoIiwiY2FsbGJhY2siLCJ1bmRlZmluZWQiLCJ1c2UiLCJvayIsIl9va0NhbGxiYWNrIiwiX2lzUmVzcG9uc2VPSyIsImdldCIsImZpZWxkIiwiX2hlYWRlciIsInRvTG93ZXJDYXNlIiwiZ2V0SGVhZGVyIiwic2V0Iiwia2V5IiwiaGVhZGVyIiwidW5zZXQiLCJuYW1lIiwiX2RhdGEiLCJBcnJheSIsImlzQXJyYXkiLCJpIiwiU3RyaW5nIiwiX2dldEZvcm1EYXRhIiwiYXBwZW5kIiwiYWJvcnQiLCJ4aHIiLCJlbWl0IiwiX2F1dGgiLCJ1c2VyIiwicGFzcyIsImJhc2U2NEVuY29kZXIiLCJ0eXBlIiwidXNlcm5hbWUiLCJwYXNzd29yZCIsIndpdGhDcmVkZW50aWFscyIsIl93aXRoQ3JlZGVudGlhbHMiLCJyZWRpcmVjdHMiLCJuIiwiX21heFJlZGlyZWN0cyIsIm1heFJlc3BvbnNlU2l6ZSIsIlR5cGVFcnJvciIsIl9tYXhSZXNwb25zZVNpemUiLCJtYXhSZXF1ZXN0U2l6ZSIsIl9tYXhSZXF1ZXN0U2l6ZSIsImhhc1NpemVFcnJvciIsIl9zaXplRXJyb3IiLCJfY3JlYXRlU2l6ZUVycm9yIiwia2luZCIsIl9zaXplRXJyb3JFcnJvciIsInRvSlNPTiIsImRhdGEiLCJoZWFkZXJzIiwic2VuZCIsImlzT2JqZWN0XyIsIl9mb3JtRGF0YSIsIl9pc0hvc3QiLCJ0cmltIiwic29ydFF1ZXJ5Iiwic29ydCIsIl9zb3J0IiwiX2ZpbmFsaXplUXVlcnlTdHJpbmciLCJxdWVyeSIsIl9xdWVyeSIsImpvaW4iLCJpbmNsdWRlcyIsImluZGV4IiwiaW5kZXhPZiIsInF1ZXJ5QXJyYXkiLCJzbGljZSIsInNwbGl0IiwiX2FwcGVuZFF1ZXJ5U3RyaW5nIiwiX3RpbWVvdXRFcnJvciIsInJlYXNvbiIsImVycm5vIiwiX3NldFRpbWVvdXRzIiwic2V0VGltZW91dCJdLCJzb3VyY2VzIjpbIi4uL3NyYy9yZXF1ZXN0LWJhc2UuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIE1vZHVsZSBvZiBtaXhlZC1pbiBmdW5jdGlvbnMgc2hhcmVkIGJldHdlZW4gbm9kZSBhbmQgY2xpZW50IGNvZGVcclxuICovXHJcbmNvbnN0IHsgaXNPYmplY3QsIGhhc093biB9ID0gcmVxdWlyZSgnLi91dGlscycpO1xyXG5cclxuLyoqXHJcbiAqIEV4cG9zZSBgUmVxdWVzdEJhc2VgLlxyXG4gKi9cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gUmVxdWVzdEJhc2U7XHJcblxyXG4vKipcclxuICogSW5pdGlhbGl6ZSBhIG5ldyBgUmVxdWVzdEJhc2VgLlxyXG4gKlxyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcbmZ1bmN0aW9uIFJlcXVlc3RCYXNlKCkge31cclxuXHJcbi8qKlxyXG4gKiBDbGVhciBwcmV2aW91cyB0aW1lb3V0LlxyXG4gKlxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUuY2xlYXJUaW1lb3V0ID0gZnVuY3Rpb24gKCkge1xyXG4gIGNsZWFyVGltZW91dCh0aGlzLl90aW1lcik7XHJcbiAgY2xlYXJUaW1lb3V0KHRoaXMuX3Jlc3BvbnNlVGltZW91dFRpbWVyKTtcclxuICBjbGVhclRpbWVvdXQodGhpcy5fdXBsb2FkVGltZW91dFRpbWVyKTtcclxuICBkZWxldGUgdGhpcy5fdGltZXI7XHJcbiAgZGVsZXRlIHRoaXMuX3Jlc3BvbnNlVGltZW91dFRpbWVyO1xyXG4gIGRlbGV0ZSB0aGlzLl91cGxvYWRUaW1lb3V0VGltZXI7XHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG4vKipcclxuICogT3ZlcnJpZGUgZGVmYXVsdCByZXNwb25zZSBib2R5IHBhcnNlclxyXG4gKlxyXG4gKiBUaGlzIGZ1bmN0aW9uIHdpbGwgYmUgY2FsbGVkIHRvIGNvbnZlcnQgaW5jb21pbmcgZGF0YSBpbnRvIHJlcXVlc3QuYm9keVxyXG4gKlxyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufVxyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3RCYXNlLnByb3RvdHlwZS5wYXJzZSA9IGZ1bmN0aW9uIChmbikge1xyXG4gIHRoaXMuX3BhcnNlciA9IGZuO1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFNldCBmb3JtYXQgb2YgYmluYXJ5IHJlc3BvbnNlIGJvZHkuXHJcbiAqIEluIGJyb3dzZXIgdmFsaWQgZm9ybWF0cyBhcmUgJ2Jsb2InIGFuZCAnYXJyYXlidWZmZXInLFxyXG4gKiB3aGljaCByZXR1cm4gQmxvYiBhbmQgQXJyYXlCdWZmZXIsIHJlc3BlY3RpdmVseS5cclxuICpcclxuICogSW4gTm9kZSBhbGwgdmFsdWVzIHJlc3VsdCBpbiBCdWZmZXIuXHJcbiAqXHJcbiAqIEV4YW1wbGVzOlxyXG4gKlxyXG4gKiAgICAgIHJlcS5nZXQoJy8nKVxyXG4gKiAgICAgICAgLnJlc3BvbnNlVHlwZSgnYmxvYicpXHJcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcclxuICpcclxuICogQHBhcmFtIHtTdHJpbmd9IHZhbFxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUucmVzcG9uc2VUeXBlID0gZnVuY3Rpb24gKHZhbHVlKSB7XHJcbiAgdGhpcy5fcmVzcG9uc2VUeXBlID0gdmFsdWU7XHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG4vKipcclxuICogT3ZlcnJpZGUgZGVmYXVsdCByZXF1ZXN0IGJvZHkgc2VyaWFsaXplclxyXG4gKlxyXG4gKiBUaGlzIGZ1bmN0aW9uIHdpbGwgYmUgY2FsbGVkIHRvIGNvbnZlcnQgZGF0YSBzZXQgdmlhIC5zZW5kIG9yIC5hdHRhY2ggaW50byBwYXlsb2FkIHRvIHNlbmRcclxuICpcclxuICogQHBhcmFtIHtGdW5jdGlvbn1cclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUuc2VyaWFsaXplID0gZnVuY3Rpb24gKGZuKSB7XHJcbiAgdGhpcy5fc2VyaWFsaXplciA9IGZuO1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFNldCB0aW1lb3V0cy5cclxuICpcclxuICogLSByZXNwb25zZSB0aW1lb3V0IGlzIHRpbWUgYmV0d2VlbiBzZW5kaW5nIHJlcXVlc3QgYW5kIHJlY2VpdmluZyB0aGUgZmlyc3QgYnl0ZSBvZiB0aGUgcmVzcG9uc2UuIEluY2x1ZGVzIEROUyBhbmQgY29ubmVjdGlvbiB0aW1lLlxyXG4gKiAtIGRlYWRsaW5lIGlzIHRoZSB0aW1lIGZyb20gc3RhcnQgb2YgdGhlIHJlcXVlc3QgdG8gcmVjZWl2aW5nIHJlc3BvbnNlIGJvZHkgaW4gZnVsbC4gSWYgdGhlIGRlYWRsaW5lIGlzIHRvbyBzaG9ydCBsYXJnZSBmaWxlcyBtYXkgbm90IGxvYWQgYXQgYWxsIG9uIHNsb3cgY29ubmVjdGlvbnMuXHJcbiAqIC0gdXBsb2FkIGlzIHRoZSB0aW1lICBzaW5jZSBsYXN0IGJpdCBvZiBkYXRhIHdhcyBzZW50IG9yIHJlY2VpdmVkLiBUaGlzIHRpbWVvdXQgd29ya3Mgb25seSBpZiBkZWFkbGluZSB0aW1lb3V0IGlzIG9mZlxyXG4gKlxyXG4gKiBWYWx1ZSBvZiAwIG9yIGZhbHNlIG1lYW5zIG5vIHRpbWVvdXQuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfE9iamVjdH0gbXMgb3Ige3Jlc3BvbnNlLCBkZWFkbGluZX1cclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLnRpbWVvdXQgPSBmdW5jdGlvbiAob3B0aW9ucykge1xyXG4gIGlmICghb3B0aW9ucyB8fCB0eXBlb2Ygb3B0aW9ucyAhPT0gJ29iamVjdCcpIHtcclxuICAgIHRoaXMuX3RpbWVvdXQgPSBvcHRpb25zO1xyXG4gICAgdGhpcy5fcmVzcG9uc2VUaW1lb3V0ID0gMDtcclxuICAgIHRoaXMuX3VwbG9hZFRpbWVvdXQgPSAwO1xyXG4gICAgcmV0dXJuIHRoaXM7XHJcbiAgfVxyXG5cclxuICBmb3IgKGNvbnN0IG9wdGlvbiBpbiBvcHRpb25zKSB7XHJcbiAgICBpZiAoaGFzT3duKG9wdGlvbnMsIG9wdGlvbikpIHtcclxuICAgICAgc3dpdGNoIChvcHRpb24pIHtcclxuICAgICAgICBjYXNlICdkZWFkbGluZSc6XHJcbiAgICAgICAgICB0aGlzLl90aW1lb3V0ID0gb3B0aW9ucy5kZWFkbGluZTtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIGNhc2UgJ3Jlc3BvbnNlJzpcclxuICAgICAgICAgIHRoaXMuX3Jlc3BvbnNlVGltZW91dCA9IG9wdGlvbnMucmVzcG9uc2U7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgICBjYXNlICd1cGxvYWQnOlxyXG4gICAgICAgICAgdGhpcy5fdXBsb2FkVGltZW91dCA9IG9wdGlvbnMudXBsb2FkO1xyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgIGNvbnNvbGUud2FybignVW5rbm93biB0aW1lb3V0IG9wdGlvbicsIG9wdGlvbik7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFNldCBudW1iZXIgb2YgcmV0cnkgYXR0ZW1wdHMgb24gZXJyb3IuXHJcbiAqXHJcbiAqIEZhaWxlZCByZXF1ZXN0cyB3aWxsIGJlIHJldHJpZWQgJ2NvdW50JyB0aW1lcyBpZiB0aW1lb3V0IG9yIGVyci5jb2RlID49IDUwMC5cclxuICpcclxuICogQHBhcmFtIHtOdW1iZXJ9IGNvdW50XHJcbiAqIEBwYXJhbSB7RnVuY3Rpb259IFtmbl1cclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLnJldHJ5ID0gZnVuY3Rpb24gKGNvdW50LCBmbikge1xyXG4gIC8vIERlZmF1bHQgdG8gMSBpZiBubyBjb3VudCBwYXNzZWQgb3IgdHJ1ZVxyXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwIHx8IGNvdW50ID09PSB0cnVlKSBjb3VudCA9IDE7XHJcbiAgaWYgKGNvdW50IDw9IDApIGNvdW50ID0gMDtcclxuICB0aGlzLl9tYXhSZXRyaWVzID0gY291bnQ7XHJcbiAgdGhpcy5fcmV0cmllcyA9IDA7XHJcbiAgdGhpcy5fcmV0cnlDYWxsYmFjayA9IGZuO1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLy9cclxuLy8gTk9URTogd2UgZG8gbm90IGluY2x1ZGUgRVNPQ0tFVFRJTUVET1VUIGJlY2F1c2UgdGhhdCBpcyBmcm9tIGByZXF1ZXN0YCBwYWNrYWdlXHJcbi8vICAgICAgIDxodHRwczovL2dpdGh1Yi5jb20vc2luZHJlc29yaHVzL2dvdC9wdWxsLzUzNz5cclxuLy9cclxuLy8gTk9URTogd2UgZG8gbm90IGluY2x1ZGUgRUFERFJJTkZPIGJlY2F1c2UgaXQgd2FzIHJlbW92ZWQgZnJvbSBsaWJ1diBpbiAyMDE0XHJcbi8vICAgICAgIDxodHRwczovL2dpdGh1Yi5jb20vbGlidXYvbGlidXYvY29tbWl0LzAyZTFlYmQ0MGI4MDdiZTVhZjQ2MzQzZWE4NzMzMzFiMmVlNGU5YzE+XHJcbi8vICAgICAgIDxodHRwczovL2dpdGh1Yi5jb20vcmVxdWVzdC9yZXF1ZXN0L3NlYXJjaD9xPUVTT0NLRVRUSU1FRE9VVCZ1bnNjb3BlZF9xPUVTT0NLRVRUSU1FRE9VVD5cclxuLy9cclxuLy9cclxuLy8gVE9ETzogZXhwb3NlIHRoZXNlIGFzIGNvbmZpZ3VyYWJsZSBkZWZhdWx0c1xyXG4vL1xyXG5jb25zdCBFUlJPUl9DT0RFUyA9IG5ldyBTZXQoW1xyXG4gICdFVElNRURPVVQnLFxyXG4gICdFQ09OTlJFU0VUJyxcclxuICAnRUFERFJJTlVTRScsXHJcbiAgJ0VDT05OUkVGVVNFRCcsXHJcbiAgJ0VQSVBFJyxcclxuICAnRU5PVEZPVU5EJyxcclxuICAnRU5FVFVOUkVBQ0gnLFxyXG4gICdFQUlfQUdBSU4nXHJcbl0pO1xyXG5cclxuY29uc3QgU1RBVFVTX0NPREVTID0gbmV3IFNldChbXHJcbiAgNDA4LCA0MTMsIDQyOSwgNTAwLCA1MDIsIDUwMywgNTA0LCA1MjEsIDUyMiwgNTI0XHJcbl0pO1xyXG5cclxuLy8gVE9ETzogd2Ugd291bGQgbmVlZCB0byBtYWtlIHRoaXMgZWFzaWx5IGNvbmZpZ3VyYWJsZSBiZWZvcmUgYWRkaW5nIGl0IGluIChlLmcuIHNvbWUgbWlnaHQgd2FudCB0byBhZGQgUE9TVClcclxuLy8gY29uc3QgTUVUSE9EUyA9IG5ldyBTZXQoWydHRVQnLCAnUFVUJywgJ0hFQUQnLCAnREVMRVRFJywgJ09QVElPTlMnLCAnVFJBQ0UnXSk7XHJcblxyXG4vKipcclxuICogRGV0ZXJtaW5lIGlmIGEgcmVxdWVzdCBzaG91bGQgYmUgcmV0cmllZC5cclxuICogKEluc3BpcmVkIGJ5IGh0dHBzOi8vZ2l0aHViLmNvbS9zaW5kcmVzb3JodXMvZ290I3JldHJ5KVxyXG4gKlxyXG4gKiBAcGFyYW0ge0Vycm9yfSBlcnIgYW4gZXJyb3JcclxuICogQHBhcmFtIHtSZXNwb25zZX0gW3Jlc10gcmVzcG9uc2VcclxuICogQHJldHVybnMge0Jvb2xlYW59IGlmIHNlZ21lbnQgc2hvdWxkIGJlIHJldHJpZWRcclxuICovXHJcblJlcXVlc3RCYXNlLnByb3RvdHlwZS5fc2hvdWxkUmV0cnkgPSBmdW5jdGlvbiAoZXJyb3IsIHJlcykge1xyXG4gIC8vIEEgc2l6ZSBsaW1pdCBpcyBhIGRldGVybWluaXN0aWMgY2xpZW50LXNpZGUgZmFpbHVyZS4gSXQgbXVzdCBub3QgYmVcclxuICAvLyByZXRyaWVkLCBldmVuIHdoZW4gYSBjdXN0b20gcmV0cnkgY2FsbGJhY2sgd291bGQgb3RoZXJ3aXNlIG9wdCBpbi5cclxuICBpZiAoZXJyb3IgJiYgZXJyb3IuY29kZSA9PT0gJ0VUT09MQVJHRScpIHtcclxuICAgIGlmICh0aGlzLl9tYXhSZXRyaWVzKSB0aGlzLl9yZXRyaWVzKys7XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG5cclxuICBpZiAoIXRoaXMuX21heFJldHJpZXMgfHwgdGhpcy5fcmV0cmllcysrID49IHRoaXMuX21heFJldHJpZXMpIHtcclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcblxyXG4gIGlmICh0aGlzLl9yZXRyeUNhbGxiYWNrKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBvdmVycmlkZSA9IHRoaXMuX3JldHJ5Q2FsbGJhY2soZXJyb3IsIHJlcyk7XHJcbiAgICAgIGlmIChvdmVycmlkZSA9PT0gdHJ1ZSkgcmV0dXJuIHRydWU7XHJcbiAgICAgIGlmIChvdmVycmlkZSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZTtcclxuICAgICAgLy8gdW5kZWZpbmVkIGZhbGxzIGJhY2sgdG8gZGVmYXVsdHNcclxuICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGVycik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvLyBUT0RPOiB3ZSB3b3VsZCBuZWVkIHRvIG1ha2UgdGhpcyBlYXNpbHkgY29uZmlndXJhYmxlIGJlZm9yZSBhZGRpbmcgaXQgaW4gKGUuZy4gc29tZSBtaWdodCB3YW50IHRvIGFkZCBQT1NUKVxyXG4gIC8qXHJcbiAgaWYgKFxyXG4gICAgdGhpcy5yZXEgJiZcclxuICAgIHRoaXMucmVxLm1ldGhvZCAmJlxyXG4gICAgIU1FVEhPRFMuaGFzKHRoaXMucmVxLm1ldGhvZC50b1VwcGVyQ2FzZSgpKVxyXG4gIClcclxuICAgIHJldHVybiBmYWxzZTtcclxuICAqL1xyXG4gIGlmIChyZXMgJiYgcmVzLnN0YXR1cyAmJiBTVEFUVVNfQ09ERVMuaGFzKHJlcy5zdGF0dXMpKSByZXR1cm4gdHJ1ZTtcclxuICBpZiAoZXJyb3IpIHtcclxuICAgIGlmIChlcnJvci5jb2RlICYmIEVSUk9SX0NPREVTLmhhcyhlcnJvci5jb2RlKSkgcmV0dXJuIHRydWU7XHJcbiAgICAvLyBTdXBlcmFnZW50IHRpbWVvdXRcclxuICAgIGlmIChlcnJvci50aW1lb3V0ICYmIGVycm9yLmNvZGUgPT09ICdFQ09OTkFCT1JURUQnKSByZXR1cm4gdHJ1ZTtcclxuICAgIGlmIChlcnJvci5jcm9zc0RvbWFpbikgcmV0dXJuIHRydWU7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gZmFsc2U7XHJcbn07XHJcblxyXG4vKipcclxuICogUmV0cnkgcmVxdWVzdFxyXG4gKlxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLl9yZXRyeSA9IGZ1bmN0aW9uICgpIHtcclxuICB0aGlzLmNsZWFyVGltZW91dCgpO1xyXG5cclxuICAvLyBub2RlXHJcbiAgaWYgKHRoaXMucmVxKSB7XHJcbiAgICB0aGlzLnJlcSA9IG51bGw7XHJcbiAgICB0aGlzLnJlcSA9IHRoaXMucmVxdWVzdCgpO1xyXG4gIH1cclxuXHJcbiAgdGhpcy5fYWJvcnRlZCA9IGZhbHNlO1xyXG4gIHRoaXMudGltZWRvdXQgPSBmYWxzZTtcclxuICB0aGlzLnRpbWVkb3V0RXJyb3IgPSBudWxsO1xyXG5cclxuICByZXR1cm4gdGhpcy5fZW5kKCk7XHJcbn07XHJcblxyXG4vKipcclxuICogUHJvbWlzZSBzdXBwb3J0XHJcbiAqXHJcbiAqIEBwYXJhbSB7RnVuY3Rpb259IHJlc29sdmVcclxuICogQHBhcmFtIHtGdW5jdGlvbn0gW3JlamVjdF1cclxuICogQHJldHVybiB7UmVxdWVzdH1cclxuICovXHJcblxyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUudGhlbiA9IGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcclxuICBpZiAoIXRoaXMuX2Z1bGxmaWxsZWRQcm9taXNlKSB7XHJcbiAgICBjb25zdCBzZWxmID0gdGhpcztcclxuICAgIGlmICh0aGlzLl9lbmRDYWxsZWQpIHtcclxuICAgICAgY29uc29sZS53YXJuKFxyXG4gICAgICAgICdXYXJuaW5nOiBzdXBlcmFnZW50IHJlcXVlc3Qgd2FzIHNlbnQgdHdpY2UsIGJlY2F1c2UgYm90aCAuZW5kKCkgYW5kIC50aGVuKCkgd2VyZSBjYWxsZWQuIE5ldmVyIGNhbGwgLmVuZCgpIGlmIHlvdSB1c2UgcHJvbWlzZXMnXHJcbiAgICAgICk7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5fZnVsbGZpbGxlZFByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICAgIHNlbGYub24oJ2Fib3J0JywgKCkgPT4ge1xyXG4gICAgICAgIGlmICh0aGlzLl9tYXhSZXRyaWVzICYmIHRoaXMuX21heFJldHJpZXMgPiB0aGlzLl9yZXRyaWVzKSB7XHJcbiAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAodGhpcy50aW1lZG91dCAmJiB0aGlzLnRpbWVkb3V0RXJyb3IpIHtcclxuICAgICAgICAgIHJlamVjdCh0aGlzLnRpbWVkb3V0RXJyb3IpO1xyXG4gICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoJ0Fib3J0ZWQnKTtcclxuICAgICAgICBlcnJvci5jb2RlID0gJ0FCT1JURUQnO1xyXG4gICAgICAgIGVycm9yLnN0YXR1cyA9IHRoaXMuc3RhdHVzO1xyXG4gICAgICAgIGVycm9yLm1ldGhvZCA9IHRoaXMubWV0aG9kO1xyXG4gICAgICAgIGVycm9yLnVybCA9IHRoaXMudXJsO1xyXG4gICAgICAgIHJlamVjdChlcnJvcik7XHJcbiAgICAgIH0pO1xyXG4gICAgICBzZWxmLmVuZCgoZXJyb3IsIHJlcykgPT4ge1xyXG4gICAgICAgIGlmIChlcnJvcikgcmVqZWN0KGVycm9yKTtcclxuICAgICAgICBlbHNlIHJlc29sdmUocmVzKTtcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHJldHVybiB0aGlzLl9mdWxsZmlsbGVkUHJvbWlzZS50aGVuKHJlc29sdmUsIHJlamVjdCk7XHJcbn07XHJcblxyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUuY2F0Y2ggPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcclxuICByZXR1cm4gdGhpcy50aGVuKHVuZGVmaW5lZCwgY2FsbGJhY2spO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEFsbG93IGZvciBleHRlbnNpb25cclxuICovXHJcblxyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24gKGZuKSB7XHJcbiAgZm4odGhpcyk7XHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUub2sgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcclxuICBpZiAodHlwZW9mIGNhbGxiYWNrICE9PSAnZnVuY3Rpb24nKSB0aHJvdyBuZXcgRXJyb3IoJ0NhbGxiYWNrIHJlcXVpcmVkJyk7XHJcbiAgdGhpcy5fb2tDYWxsYmFjayA9IGNhbGxiYWNrO1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLl9pc1Jlc3BvbnNlT0sgPSBmdW5jdGlvbiAocmVzKSB7XHJcbiAgaWYgKCFyZXMpIHtcclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcblxyXG4gIGlmICh0aGlzLl9va0NhbGxiYWNrKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fb2tDYWxsYmFjayhyZXMpO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHJlcy5zdGF0dXMgPj0gMjAwICYmIHJlcy5zdGF0dXMgPCAzMDA7XHJcbn07XHJcblxyXG4vKipcclxuICogR2V0IHJlcXVlc3QgaGVhZGVyIGBmaWVsZGAuXHJcbiAqIENhc2UtaW5zZW5zaXRpdmUuXHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBmaWVsZFxyXG4gKiBAcmV0dXJuIHtTdHJpbmd9XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uIChmaWVsZCkge1xyXG4gIHJldHVybiB0aGlzLl9oZWFkZXJbZmllbGQudG9Mb3dlckNhc2UoKV07XHJcbn07XHJcblxyXG4vKipcclxuICogR2V0IGNhc2UtaW5zZW5zaXRpdmUgaGVhZGVyIGBmaWVsZGAgdmFsdWUuXHJcbiAqIFRoaXMgaXMgYSBkZXByZWNhdGVkIGludGVybmFsIEFQSS4gVXNlIGAuZ2V0KGZpZWxkKWAgaW5zdGVhZC5cclxuICpcclxuICogKGdldEhlYWRlciBpcyBubyBsb25nZXIgdXNlZCBpbnRlcm5hbGx5IGJ5IHRoZSBzdXBlcmFnZW50IGNvZGUgYmFzZSlcclxuICpcclxuICogQHBhcmFtIHtTdHJpbmd9IGZpZWxkXHJcbiAqIEByZXR1cm4ge1N0cmluZ31cclxuICogQGFwaSBwcml2YXRlXHJcbiAqIEBkZXByZWNhdGVkXHJcbiAqL1xyXG5cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLmdldEhlYWRlciA9IFJlcXVlc3RCYXNlLnByb3RvdHlwZS5nZXQ7XHJcblxyXG4vKipcclxuICogU2V0IGhlYWRlciBgZmllbGRgIHRvIGB2YWxgLCBvciBtdWx0aXBsZSBmaWVsZHMgd2l0aCBvbmUgb2JqZWN0LlxyXG4gKiBDYXNlLWluc2Vuc2l0aXZlLlxyXG4gKlxyXG4gKiBFeGFtcGxlczpcclxuICpcclxuICogICAgICByZXEuZ2V0KCcvJylcclxuICogICAgICAgIC5zZXQoJ0FjY2VwdCcsICdhcHBsaWNhdGlvbi9qc29uJylcclxuICogICAgICAgIC5zZXQoJ1gtQVBJLUtleScsICdmb29iYXInKVxyXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XHJcbiAqXHJcbiAqICAgICAgcmVxLmdldCgnLycpXHJcbiAqICAgICAgICAuc2V0KHsgQWNjZXB0OiAnYXBwbGljYXRpb24vanNvbicsICdYLUFQSS1LZXknOiAnZm9vYmFyJyB9KVxyXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfE9iamVjdH0gZmllbGRcclxuICogQHBhcmFtIHtTdHJpbmd9IHZhbFxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24gKGZpZWxkLCB2YWx1ZSkge1xyXG4gIGlmIChpc09iamVjdChmaWVsZCkpIHtcclxuICAgIGZvciAoY29uc3Qga2V5IGluIGZpZWxkKSB7XHJcbiAgICAgIGlmIChoYXNPd24oZmllbGQsIGtleSkpIHRoaXMuc2V0KGtleSwgZmllbGRba2V5XSk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHRoaXM7XHJcbiAgfVxyXG5cclxuICB0aGlzLl9oZWFkZXJbZmllbGQudG9Mb3dlckNhc2UoKV0gPSB2YWx1ZTtcclxuICB0aGlzLmhlYWRlcltmaWVsZF0gPSB2YWx1ZTtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZW1vdmUgaGVhZGVyIGBmaWVsZGAuXHJcbiAqIENhc2UtaW5zZW5zaXRpdmUuXHJcbiAqXHJcbiAqIEV4YW1wbGU6XHJcbiAqXHJcbiAqICAgICAgcmVxLmdldCgnLycpXHJcbiAqICAgICAgICAudW5zZXQoJ1VzZXItQWdlbnQnKVxyXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBmaWVsZCBmaWVsZCBuYW1lXHJcbiAqL1xyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUudW5zZXQgPSBmdW5jdGlvbiAoZmllbGQpIHtcclxuICBkZWxldGUgdGhpcy5faGVhZGVyW2ZpZWxkLnRvTG93ZXJDYXNlKCldO1xyXG4gIGRlbGV0ZSB0aGlzLmhlYWRlcltmaWVsZF07XHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG4vKipcclxuICogV3JpdGUgdGhlIGZpZWxkIGBuYW1lYCBhbmQgYHZhbGAsIG9yIG11bHRpcGxlIGZpZWxkcyB3aXRoIG9uZSBvYmplY3RcclxuICogZm9yIFwibXVsdGlwYXJ0L2Zvcm0tZGF0YVwiIHJlcXVlc3QgYm9kaWVzLlxyXG4gKlxyXG4gKiBgYGAganNcclxuICogcmVxdWVzdC5wb3N0KCcvdXBsb2FkJylcclxuICogICAuZmllbGQoJ2ZvbycsICdiYXInKVxyXG4gKiAgIC5lbmQoY2FsbGJhY2spO1xyXG4gKlxyXG4gKiByZXF1ZXN0LnBvc3QoJy91cGxvYWQnKVxyXG4gKiAgIC5maWVsZCh7IGZvbzogJ2JhcicsIGJhejogJ3F1eCcgfSlcclxuICogICAuZW5kKGNhbGxiYWNrKTtcclxuICogYGBgXHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfE9iamVjdH0gbmFtZSBuYW1lIG9mIGZpZWxkXHJcbiAqIEBwYXJhbSB7U3RyaW5nfEJsb2J8RmlsZXxCdWZmZXJ8ZnMuUmVhZFN0cmVhbX0gdmFsIHZhbHVlIG9mIGZpZWxkXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBvcHRpb25zIGV4dHJhIG9wdGlvbnMsIGUuZy4gJ2Jsb2InXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLmZpZWxkID0gZnVuY3Rpb24gKG5hbWUsIHZhbHVlLCBvcHRpb25zKSB7XHJcbiAgLy8gbmFtZSBzaG91bGQgYmUgZWl0aGVyIGEgc3RyaW5nIG9yIGFuIG9iamVjdC5cclxuICBpZiAobmFtZSA9PT0gbnVsbCB8fCB1bmRlZmluZWQgPT09IG5hbWUpIHtcclxuICAgIHRocm93IG5ldyBFcnJvcignLmZpZWxkKG5hbWUsIHZhbCkgbmFtZSBjYW4gbm90IGJlIGVtcHR5Jyk7XHJcbiAgfVxyXG5cclxuICBpZiAodGhpcy5fZGF0YSkge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICBcIi5maWVsZCgpIGNhbid0IGJlIHVzZWQgaWYgLnNlbmQoKSBpcyB1c2VkLiBQbGVhc2UgdXNlIG9ubHkgLnNlbmQoKSBvciBvbmx5IC5maWVsZCgpICYgLmF0dGFjaCgpXCJcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBpZiAoaXNPYmplY3QobmFtZSkpIHtcclxuICAgIGZvciAoY29uc3Qga2V5IGluIG5hbWUpIHtcclxuICAgICAgaWYgKGhhc093bihuYW1lLCBrZXkpKSB0aGlzLmZpZWxkKGtleSwgbmFtZVtrZXldKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gdGhpcztcclxuICB9XHJcblxyXG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xyXG4gICAgZm9yIChjb25zdCBpIGluIHZhbHVlKSB7XHJcbiAgICAgIGlmIChoYXNPd24odmFsdWUsIGkpKSB0aGlzLmZpZWxkKG5hbWUsIHZhbHVlW2ldKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gdGhpcztcclxuICB9XHJcblxyXG4gIC8vIHZhbCBzaG91bGQgYmUgZGVmaW5lZCBub3dcclxuICBpZiAodmFsdWUgPT09IG51bGwgfHwgdW5kZWZpbmVkID09PSB2YWx1ZSkge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKCcuZmllbGQobmFtZSwgdmFsKSB2YWwgY2FuIG5vdCBiZSBlbXB0eScpO1xyXG4gIH1cclxuXHJcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ2Jvb2xlYW4nKSB7XHJcbiAgICB2YWx1ZSA9IFN0cmluZyh2YWx1ZSk7XHJcbiAgfVxyXG5cclxuICAvLyBmaXggaHR0cHM6Ly9naXRodWIuY29tL2xhZGpzL3N1cGVyYWdlbnQvaXNzdWVzLzE2ODBcclxuICBpZiAob3B0aW9ucykgdGhpcy5fZ2V0Rm9ybURhdGEoKS5hcHBlbmQobmFtZSwgdmFsdWUsIG9wdGlvbnMpO1xyXG4gIGVsc2UgdGhpcy5fZ2V0Rm9ybURhdGEoKS5hcHBlbmQobmFtZSwgdmFsdWUpO1xyXG5cclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBBYm9ydCB0aGUgcmVxdWVzdCwgYW5kIGNsZWFyIHBvdGVudGlhbCB0aW1lb3V0LlxyXG4gKlxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSByZXF1ZXN0XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUuYWJvcnQgPSBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHRoaXMuX2Fib3J0ZWQpIHtcclxuICAgIHJldHVybiB0aGlzO1xyXG4gIH1cclxuXHJcbiAgdGhpcy5fYWJvcnRlZCA9IHRydWU7XHJcbiAgaWYgKHRoaXMueGhyKSB0aGlzLnhoci5hYm9ydCgpOyAvLyBicm93c2VyXHJcbiAgaWYgKHRoaXMucmVxKSB7XHJcbiAgICB0aGlzLnJlcS5hYm9ydCgpOyAvLyBub2RlXHJcbiAgfVxyXG5cclxuICB0aGlzLmNsZWFyVGltZW91dCgpO1xyXG4gIHRoaXMuZW1pdCgnYWJvcnQnKTtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcblJlcXVlc3RCYXNlLnByb3RvdHlwZS5fYXV0aCA9IGZ1bmN0aW9uICh1c2VyLCBwYXNzLCBvcHRpb25zLCBiYXNlNjRFbmNvZGVyKSB7XHJcbiAgc3dpdGNoIChvcHRpb25zLnR5cGUpIHtcclxuICAgIGNhc2UgJ2Jhc2ljJzpcclxuICAgICAgdGhpcy5zZXQoJ0F1dGhvcml6YXRpb24nLCBgQmFzaWMgJHtiYXNlNjRFbmNvZGVyKGAke3VzZXJ9OiR7cGFzc31gKX1gKTtcclxuICAgICAgYnJlYWs7XHJcblxyXG4gICAgY2FzZSAnYXV0byc6XHJcbiAgICAgIHRoaXMudXNlcm5hbWUgPSB1c2VyO1xyXG4gICAgICB0aGlzLnBhc3N3b3JkID0gcGFzcztcclxuICAgICAgYnJlYWs7XHJcblxyXG4gICAgY2FzZSAnYmVhcmVyJzogLy8gdXNhZ2Ugd291bGQgYmUgLmF1dGgoYWNjZXNzVG9rZW4sIHsgdHlwZTogJ2JlYXJlcicgfSlcclxuICAgICAgdGhpcy5zZXQoJ0F1dGhvcml6YXRpb24nLCBgQmVhcmVyICR7dXNlcn1gKTtcclxuICAgICAgYnJlYWs7XHJcbiAgICBkZWZhdWx0OlxyXG4gICAgICBicmVhaztcclxuICB9XHJcblxyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEVuYWJsZSB0cmFuc21pc3Npb24gb2YgY29va2llcyB3aXRoIHgtZG9tYWluIHJlcXVlc3RzLlxyXG4gKlxyXG4gKiBOb3RlIHRoYXQgZm9yIHRoaXMgdG8gd29yayB0aGUgb3JpZ2luIG11c3Qgbm90IGJlXHJcbiAqIHVzaW5nIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luXCIgd2l0aCBhIHdpbGRjYXJkLFxyXG4gKiBhbmQgYWxzbyBtdXN0IHNldCBcIkFjY2Vzcy1Db250cm9sLUFsbG93LUNyZWRlbnRpYWxzXCJcclxuICogdG8gXCJ0cnVlXCIuXHJcbiAqIEBwYXJhbSB7Qm9vbGVhbn0gW29uPXRydWVdIC0gU2V0ICd3aXRoQ3JlZGVudGlhbHMnIHN0YXRlXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3RCYXNlLnByb3RvdHlwZS53aXRoQ3JlZGVudGlhbHMgPSBmdW5jdGlvbiAob24pIHtcclxuICAvLyBUaGlzIGlzIGJyb3dzZXItb25seSBmdW5jdGlvbmFsaXR5LiBOb2RlIHNpZGUgaXMgbm8tb3AuXHJcbiAgaWYgKG9uID09PSB1bmRlZmluZWQpIG9uID0gdHJ1ZTtcclxuICB0aGlzLl93aXRoQ3JlZGVudGlhbHMgPSBvbjtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBTZXQgdGhlIG1heCByZWRpcmVjdHMgdG8gYG5gLiBEb2VzIG5vdGhpbmcgaW4gYnJvd3NlciBYSFIgaW1wbGVtZW50YXRpb24uXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBuXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3RCYXNlLnByb3RvdHlwZS5yZWRpcmVjdHMgPSBmdW5jdGlvbiAobikge1xyXG4gIHRoaXMuX21heFJlZGlyZWN0cyA9IG47XHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG4vKipcclxuICogTWF4aW11bSBzaXplIG9mIGJ1ZmZlcmVkIHJlc3BvbnNlIGJvZHksIGluIGJ5dGVzLiBDb3VudHMgdW5jb21wcmVzc2VkIHNpemUuXHJcbiAqIERlZmF1bHQgMjAwTUIuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBuIG51bWJlciBvZiBieXRlc1xyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICovXHJcblJlcXVlc3RCYXNlLnByb3RvdHlwZS5tYXhSZXNwb25zZVNpemUgPSBmdW5jdGlvbiAobikge1xyXG4gIGlmICh0eXBlb2YgbiAhPT0gJ251bWJlcicpIHtcclxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0ludmFsaWQgYXJndW1lbnQnKTtcclxuICB9XHJcblxyXG4gIHRoaXMuX21heFJlc3BvbnNlU2l6ZSA9IG47XHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG4vKipcclxuICogTWF4aW11bSBzaXplIG9mIHRoZSByZXF1ZXN0IGJvZHksIGluIGJ5dGVzLlxyXG4gKlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbiBudW1iZXIgb2YgYnl0ZXNcclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqL1xyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUubWF4UmVxdWVzdFNpemUgPSBmdW5jdGlvbiAobikge1xyXG4gIGlmICh0eXBlb2YgbiAhPT0gJ251bWJlcicpIHtcclxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0ludmFsaWQgYXJndW1lbnQnKTtcclxuICB9XHJcblxyXG4gIHRoaXMuX21heFJlcXVlc3RTaXplID0gbjtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZXR1cm4gd2hldGhlciBhIHJlcXVlc3Qgb3IgcmVzcG9uc2Ugc2l6ZSBsaW1pdCB3YXMgZXhjZWVkZWQuXHJcbiAqXHJcbiAqIEByZXR1cm4ge0Jvb2xlYW59XHJcbiAqL1xyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUuaGFzU2l6ZUVycm9yID0gZnVuY3Rpb24gKCkge1xyXG4gIHJldHVybiB0aGlzLl9zaXplRXJyb3IgPT09IHRydWU7XHJcbn07XHJcblxyXG4vKipcclxuICogQ3JlYXRlIGFuZCByZW1lbWJlciBhIHNpemUtbGltaXQgZXJyb3IuXHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBraW5kIHJlcXVlc3Qgb3IgcmVzcG9uc2VcclxuICogQHJldHVybiB7RXJyb3J9XHJcbiAqIEBhcGkgcHJpdmF0ZVxyXG4gKi9cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLl9jcmVhdGVTaXplRXJyb3IgPSBmdW5jdGlvbiAoa2luZCkge1xyXG4gIGlmICghdGhpcy5fc2l6ZUVycm9yRXJyb3IpIHtcclxuICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKGBNYXhpbXVtICR7a2luZH0gc2l6ZSByZWFjaGVkYCk7XHJcbiAgICBlcnJvci5jb2RlID0gJ0VUT09MQVJHRSc7XHJcbiAgICB0aGlzLl9zaXplRXJyb3JFcnJvciA9IGVycm9yO1xyXG4gIH1cclxuXHJcbiAgdGhpcy5fc2l6ZUVycm9yID0gdHJ1ZTtcclxuICByZXR1cm4gdGhpcy5fc2l6ZUVycm9yRXJyb3I7XHJcbn07XHJcblxyXG4vKipcclxuICogQ29udmVydCB0byBhIHBsYWluIGphdmFzY3JpcHQgb2JqZWN0IChub3QgSlNPTiBzdHJpbmcpIG9mIHNjYWxhciBwcm9wZXJ0aWVzLlxyXG4gKiBOb3RlIGFzIHRoaXMgbWV0aG9kIGlzIGRlc2lnbmVkIHRvIHJldHVybiBhIHVzZWZ1bCBub24tdGhpcyB2YWx1ZSxcclxuICogaXQgY2Fubm90IGJlIGNoYWluZWQuXHJcbiAqXHJcbiAqIEByZXR1cm4ge09iamVjdH0gZGVzY3JpYmluZyBtZXRob2QsIHVybCwgYW5kIGRhdGEgb2YgdGhpcyByZXF1ZXN0XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uICgpIHtcclxuICByZXR1cm4ge1xyXG4gICAgbWV0aG9kOiB0aGlzLm1ldGhvZCxcclxuICAgIHVybDogdGhpcy51cmwsXHJcbiAgICBkYXRhOiB0aGlzLl9kYXRhLFxyXG4gICAgaGVhZGVyczogdGhpcy5faGVhZGVyXHJcbiAgfTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBTZW5kIGBkYXRhYCBhcyB0aGUgcmVxdWVzdCBib2R5LCBkZWZhdWx0aW5nIHRoZSBgLnR5cGUoKWAgdG8gXCJqc29uXCIgd2hlblxyXG4gKiBhbiBvYmplY3QgaXMgZ2l2ZW4uXHJcbiAqXHJcbiAqIEV4YW1wbGVzOlxyXG4gKlxyXG4gKiAgICAgICAvLyBtYW51YWwganNvblxyXG4gKiAgICAgICByZXF1ZXN0LnBvc3QoJy91c2VyJylcclxuICogICAgICAgICAudHlwZSgnanNvbicpXHJcbiAqICAgICAgICAgLnNlbmQoJ3tcIm5hbWVcIjpcInRqXCJ9JylcclxuICogICAgICAgICAuZW5kKGNhbGxiYWNrKVxyXG4gKlxyXG4gKiAgICAgICAvLyBhdXRvIGpzb25cclxuICogICAgICAgcmVxdWVzdC5wb3N0KCcvdXNlcicpXHJcbiAqICAgICAgICAgLnNlbmQoeyBuYW1lOiAndGonIH0pXHJcbiAqICAgICAgICAgLmVuZChjYWxsYmFjaylcclxuICpcclxuICogICAgICAgLy8gbWFudWFsIHgtd3d3LWZvcm0tdXJsZW5jb2RlZFxyXG4gKiAgICAgICByZXF1ZXN0LnBvc3QoJy91c2VyJylcclxuICogICAgICAgICAudHlwZSgnZm9ybScpXHJcbiAqICAgICAgICAgLnNlbmQoJ25hbWU9dGonKVxyXG4gKiAgICAgICAgIC5lbmQoY2FsbGJhY2spXHJcbiAqXHJcbiAqICAgICAgIC8vIGF1dG8geC13d3ctZm9ybS11cmxlbmNvZGVkXHJcbiAqICAgICAgIHJlcXVlc3QucG9zdCgnL3VzZXInKVxyXG4gKiAgICAgICAgIC50eXBlKCdmb3JtJylcclxuICogICAgICAgICAuc2VuZCh7IG5hbWU6ICd0aicgfSlcclxuICogICAgICAgICAuZW5kKGNhbGxiYWNrKVxyXG4gKlxyXG4gKiAgICAgICAvLyBkZWZhdWx0cyB0byB4LXd3dy1mb3JtLXVybGVuY29kZWRcclxuICogICAgICByZXF1ZXN0LnBvc3QoJy91c2VyJylcclxuICogICAgICAgIC5zZW5kKCduYW1lPXRvYmknKVxyXG4gKiAgICAgICAgLnNlbmQoJ3NwZWNpZXM9ZmVycmV0JylcclxuICogICAgICAgIC5lbmQoY2FsbGJhY2spXHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfE9iamVjdH0gZGF0YVxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgY29tcGxleGl0eVxyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUuc2VuZCA9IGZ1bmN0aW9uIChkYXRhKSB7XHJcbiAgY29uc3QgaXNPYmplY3RfID0gaXNPYmplY3QoZGF0YSk7XHJcbiAgbGV0IHR5cGUgPSB0aGlzLl9oZWFkZXJbJ2NvbnRlbnQtdHlwZSddO1xyXG5cclxuICBpZiAodGhpcy5fZm9ybURhdGEpIHtcclxuICAgIHRocm93IG5ldyBFcnJvcihcclxuICAgICAgXCIuc2VuZCgpIGNhbid0IGJlIHVzZWQgaWYgLmF0dGFjaCgpIG9yIC5maWVsZCgpIGlzIHVzZWQuIFBsZWFzZSB1c2Ugb25seSAuc2VuZCgpIG9yIG9ubHkgLmZpZWxkKCkgJiAuYXR0YWNoKClcIlxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIGlmIChpc09iamVjdF8gJiYgIXRoaXMuX2RhdGEpIHtcclxuICAgIGlmIChBcnJheS5pc0FycmF5KGRhdGEpKSB7XHJcbiAgICAgIHRoaXMuX2RhdGEgPSBbXTtcclxuICAgIH0gZWxzZSBpZiAoIXRoaXMuX2lzSG9zdChkYXRhKSkge1xyXG4gICAgICB0aGlzLl9kYXRhID0ge307XHJcbiAgICB9XHJcbiAgfSBlbHNlIGlmIChkYXRhICYmIHRoaXMuX2RhdGEgJiYgdGhpcy5faXNIb3N0KHRoaXMuX2RhdGEpKSB7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW4ndCBtZXJnZSB0aGVzZSBzZW5kIGNhbGxzXCIpO1xyXG4gIH1cclxuXHJcbiAgLy8gbWVyZ2VcclxuICBpZiAoaXNPYmplY3RfICYmIGlzT2JqZWN0KHRoaXMuX2RhdGEpKSB7XHJcbiAgICBmb3IgKGNvbnN0IGtleSBpbiBkYXRhKSB7XHJcbiAgICAgIGlmICh0eXBlb2YgZGF0YVtrZXldID09ICdiaWdpbnQnICYmICFkYXRhW2tleV0udG9KU09OKVxyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IHNlcmlhbGl6ZSBCaWdJbnQgdmFsdWUgdG8ganNvbicpO1xyXG4gICAgICBpZiAoaGFzT3duKGRhdGEsIGtleSkpIHRoaXMuX2RhdGFba2V5XSA9IGRhdGFba2V5XTtcclxuICAgIH1cclxuICB9XHJcbiAgZWxzZSBpZiAodHlwZW9mIGRhdGEgPT09ICdiaWdpbnQnKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3Qgc2VuZCB2YWx1ZSBvZiB0eXBlIEJpZ0ludFwiKTtcclxuICBlbHNlIGlmICh0eXBlb2YgZGF0YSA9PT0gJ3N0cmluZycpIHtcclxuICAgIC8vIGRlZmF1bHQgdG8geC13d3ctZm9ybS11cmxlbmNvZGVkXHJcbiAgICBpZiAoIXR5cGUpIHRoaXMudHlwZSgnZm9ybScpO1xyXG4gICAgdHlwZSA9IHRoaXMuX2hlYWRlclsnY29udGVudC10eXBlJ107XHJcbiAgICBpZiAodHlwZSkgdHlwZSA9IHR5cGUudG9Mb3dlckNhc2UoKS50cmltKCk7XHJcbiAgICBpZiAodHlwZSA9PT0gJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCcpIHtcclxuICAgICAgdGhpcy5fZGF0YSA9IHRoaXMuX2RhdGEgPyBgJHt0aGlzLl9kYXRhfSYke2RhdGF9YCA6IGRhdGE7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICB0aGlzLl9kYXRhID0gKHRoaXMuX2RhdGEgfHwgJycpICsgZGF0YTtcclxuICAgIH1cclxuICB9IGVsc2Uge1xyXG4gICAgdGhpcy5fZGF0YSA9IGRhdGE7XHJcbiAgfVxyXG5cclxuICBpZiAoIWlzT2JqZWN0XyB8fCB0aGlzLl9pc0hvc3QoZGF0YSkpIHtcclxuICAgIHJldHVybiB0aGlzO1xyXG4gIH1cclxuXHJcbiAgLy8gZGVmYXVsdCB0byBqc29uXHJcbiAgaWYgKCF0eXBlKSB0aGlzLnR5cGUoJ2pzb24nKTtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBTb3J0IGBxdWVyeXN0cmluZ2AgYnkgdGhlIHNvcnQgZnVuY3Rpb25cclxuICpcclxuICpcclxuICogRXhhbXBsZXM6XHJcbiAqXHJcbiAqICAgICAgIC8vIGRlZmF1bHQgb3JkZXJcclxuICogICAgICAgcmVxdWVzdC5nZXQoJy91c2VyJylcclxuICogICAgICAgICAucXVlcnkoJ25hbWU9TmljaycpXHJcbiAqICAgICAgICAgLnF1ZXJ5KCdzZWFyY2g9TWFubnknKVxyXG4gKiAgICAgICAgIC5zb3J0UXVlcnkoKVxyXG4gKiAgICAgICAgIC5lbmQoY2FsbGJhY2spXHJcbiAqXHJcbiAqICAgICAgIC8vIGN1c3RvbWl6ZWQgc29ydCBmdW5jdGlvblxyXG4gKiAgICAgICByZXF1ZXN0LmdldCgnL3VzZXInKVxyXG4gKiAgICAgICAgIC5xdWVyeSgnbmFtZT1OaWNrJylcclxuICogICAgICAgICAucXVlcnkoJ3NlYXJjaD1NYW5ueScpXHJcbiAqICAgICAgICAgLnNvcnRRdWVyeShmdW5jdGlvbihhLCBiKXtcclxuICogICAgICAgICAgIHJldHVybiBhLmxlbmd0aCAtIGIubGVuZ3RoO1xyXG4gKiAgICAgICAgIH0pXHJcbiAqICAgICAgICAgLmVuZChjYWxsYmFjaylcclxuICpcclxuICpcclxuICogQHBhcmFtIHtGdW5jdGlvbn0gc29ydFxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUuc29ydFF1ZXJ5ID0gZnVuY3Rpb24gKHNvcnQpIHtcclxuICAvLyBfc29ydCBkZWZhdWx0IHRvIHRydWUgYnV0IG90aGVyd2lzZSBjYW4gYmUgYSBmdW5jdGlvbiBvciBib29sZWFuXHJcbiAgdGhpcy5fc29ydCA9IHR5cGVvZiBzb3J0ID09PSAndW5kZWZpbmVkJyA/IHRydWUgOiBzb3J0O1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIENvbXBvc2UgcXVlcnlzdHJpbmcgdG8gYXBwZW5kIHRvIHJlcS51cmxcclxuICpcclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUuX2ZpbmFsaXplUXVlcnlTdHJpbmcgPSBmdW5jdGlvbiAoKSB7XHJcbiAgY29uc3QgcXVlcnkgPSB0aGlzLl9xdWVyeS5qb2luKCcmJyk7XHJcbiAgaWYgKHF1ZXJ5KSB7XHJcbiAgICB0aGlzLnVybCArPSAodGhpcy51cmwuaW5jbHVkZXMoJz8nKSA/ICcmJyA6ICc/JykgKyBxdWVyeTtcclxuICB9XHJcblxyXG4gIHRoaXMuX3F1ZXJ5Lmxlbmd0aCA9IDA7IC8vIE1ha2VzIHRoZSBjYWxsIGlkZW1wb3RlbnRcclxuXHJcbiAgaWYgKHRoaXMuX3NvcnQpIHtcclxuICAgIGNvbnN0IGluZGV4ID0gdGhpcy51cmwuaW5kZXhPZignPycpO1xyXG4gICAgaWYgKGluZGV4ID49IDApIHtcclxuICAgICAgY29uc3QgcXVlcnlBcnJheSA9IHRoaXMudXJsLnNsaWNlKGluZGV4ICsgMSkuc3BsaXQoJyYnKTtcclxuICAgICAgaWYgKHR5cGVvZiB0aGlzLl9zb3J0ID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgcXVlcnlBcnJheS5zb3J0KHRoaXMuX3NvcnQpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHF1ZXJ5QXJyYXkuc29ydCgpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICB0aGlzLnVybCA9IHRoaXMudXJsLnNsaWNlKDAsIGluZGV4KSArICc/JyArIHF1ZXJ5QXJyYXkuam9pbignJicpO1xyXG4gICAgfVxyXG4gIH1cclxufTtcclxuXHJcbi8vIEZvciBiYWNrd2FyZHMgY29tcGF0IG9ubHlcclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLl9hcHBlbmRRdWVyeVN0cmluZyA9ICgpID0+IHtcclxuICBjb25zb2xlLndhcm4oJ1Vuc3VwcG9ydGVkJyk7XHJcbn07XHJcblxyXG4vKipcclxuICogSW52b2tlIGNhbGxiYWNrIHdpdGggdGltZW91dCBlcnJvci5cclxuICpcclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLl90aW1lb3V0RXJyb3IgPSBmdW5jdGlvbiAocmVhc29uLCB0aW1lb3V0LCBlcnJubykge1xyXG4gIGlmICh0aGlzLl9hYm9ydGVkKSB7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG5cclxuICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcihgJHtyZWFzb24gKyB0aW1lb3V0fW1zIGV4Y2VlZGVkYCk7XHJcbiAgZXJyb3IudGltZW91dCA9IHRpbWVvdXQ7XHJcbiAgZXJyb3IuY29kZSA9ICdFQ09OTkFCT1JURUQnO1xyXG4gIGVycm9yLmVycm5vID0gZXJybm87XHJcbiAgdGhpcy50aW1lZG91dCA9IHRydWU7XHJcbiAgdGhpcy50aW1lZG91dEVycm9yID0gZXJyb3I7XHJcbiAgdGhpcy5hYm9ydCgpO1xyXG4gIHRoaXMuY2FsbGJhY2soZXJyb3IpO1xyXG59O1xyXG5cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLl9zZXRUaW1lb3V0cyA9IGZ1bmN0aW9uICgpIHtcclxuICBjb25zdCBzZWxmID0gdGhpcztcclxuXHJcbiAgLy8gZGVhZGxpbmVcclxuICBpZiAodGhpcy5fdGltZW91dCAmJiAhdGhpcy5fdGltZXIpIHtcclxuICAgIHRoaXMuX3RpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgIHNlbGYuX3RpbWVvdXRFcnJvcignVGltZW91dCBvZiAnLCBzZWxmLl90aW1lb3V0LCAnRVRJTUUnKTtcclxuICAgIH0sIHRoaXMuX3RpbWVvdXQpO1xyXG4gIH1cclxuXHJcbiAgLy8gcmVzcG9uc2UgdGltZW91dFxyXG4gIGlmICh0aGlzLl9yZXNwb25zZVRpbWVvdXQgJiYgIXRoaXMuX3Jlc3BvbnNlVGltZW91dFRpbWVyKSB7XHJcbiAgICB0aGlzLl9yZXNwb25zZVRpbWVvdXRUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICBzZWxmLl90aW1lb3V0RXJyb3IoXHJcbiAgICAgICAgJ1Jlc3BvbnNlIHRpbWVvdXQgb2YgJyxcclxuICAgICAgICBzZWxmLl9yZXNwb25zZVRpbWVvdXQsXHJcbiAgICAgICAgJ0VUSU1FRE9VVCdcclxuICAgICAgKTtcclxuICAgIH0sIHRoaXMuX3Jlc3BvbnNlVGltZW91dCk7XHJcbiAgfVxyXG59O1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0EsTUFBTTtFQUFFQSxRQUFRO0VBQUVDO0FBQU8sQ0FBQyxHQUFHQyxPQUFPLENBQUMsU0FBUyxDQUFDOztBQUUvQztBQUNBO0FBQ0E7O0FBRUFDLE1BQU0sQ0FBQ0MsT0FBTyxHQUFHQyxXQUFXOztBQUU1QjtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLFNBQVNBLFdBQVdBLENBQUEsRUFBRyxDQUFDOztBQUV4QjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUFBLFdBQVcsQ0FBQ0MsU0FBUyxDQUFDQyxZQUFZLEdBQUcsWUFBWTtFQUMvQ0EsWUFBWSxDQUFDLElBQUksQ0FBQ0MsTUFBTSxDQUFDO0VBQ3pCRCxZQUFZLENBQUMsSUFBSSxDQUFDRSxxQkFBcUIsQ0FBQztFQUN4Q0YsWUFBWSxDQUFDLElBQUksQ0FBQ0csbUJBQW1CLENBQUM7RUFDdEMsT0FBTyxJQUFJLENBQUNGLE1BQU07RUFDbEIsT0FBTyxJQUFJLENBQUNDLHFCQUFxQjtFQUNqQyxPQUFPLElBQUksQ0FBQ0MsbUJBQW1CO0VBQy9CLE9BQU8sSUFBSTtBQUNiLENBQUM7O0FBRUQ7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQUwsV0FBVyxDQUFDQyxTQUFTLENBQUNLLEtBQUssR0FBRyxVQUFVQyxFQUFF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
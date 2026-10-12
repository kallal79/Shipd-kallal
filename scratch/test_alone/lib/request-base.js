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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJpc09iamVjdCIsImhhc093biIsInJlcXVpcmUiLCJtb2R1bGUiLCJleHBvcnRzIiwiUmVxdWVzdEJhc2UiLCJwcm90b3R5cGUiLCJjbGVhclRpbWVvdXQiLCJfdGltZXIiLCJfcmVzcG9uc2VUaW1lb3V0VGltZXIiLCJfdXBsb2FkVGltZW91dFRpbWVyIiwicGFyc2UiLCJmbiIsIl9wYXJzZXIiLCJyZXNwb25zZVR5cGUiLCJ2YWx1ZSIsIl9yZXNwb25zZVR5cGUiLCJzZXJpYWxpemUiLCJfc2VyaWFsaXplciIsInRpbWVvdXQiLCJvcHRpb25zIiwiX3RpbWVvdXQiLCJfcmVzcG9uc2VUaW1lb3V0IiwiX3VwbG9hZFRpbWVvdXQiLCJvcHRpb24iLCJkZWFkbGluZSIsInJlc3BvbnNlIiwidXBsb2FkIiwiY29uc29sZSIsIndhcm4iLCJyZXRyeSIsImNvdW50IiwiYXJndW1lbnRzIiwibGVuZ3RoIiwiX21heFJldHJpZXMiLCJfcmV0cmllcyIsIl9yZXRyeUNhbGxiYWNrIiwiRVJST1JfQ09ERVMiLCJTZXQiLCJTVEFUVVNfQ09ERVMiLCJfc2hvdWxkUmV0cnkiLCJlcnJvciIsInJlcyIsIm92ZXJyaWRlIiwiZXJyIiwic3RhdHVzIiwiaGFzIiwiY29kZSIsImNyb3NzRG9tYWluIiwiX3JldHJ5IiwicmVxIiwicmVxdWVzdCIsIl9hYm9ydGVkIiwidGltZWRvdXQiLCJ0aW1lZG91dEVycm9yIiwiX2VuZCIsInRoZW4iLCJyZXNvbHZlIiwicmVqZWN0IiwiX2Z1bGxmaWxsZWRQcm9taXNlIiwic2VsZiIsIl9lbmRDYWxsZWQiLCJQcm9taXNlIiwib24iLCJFcnJvciIsIm1ldGhvZCIsInVybCIsImVuZCIsImNhdGNoIiwiY2FsbGJhY2siLCJ1bmRlZmluZWQiLCJ1c2UiLCJvayIsIl9va0NhbGxiYWNrIiwiX2lzUmVzcG9uc2VPSyIsImdldCIsImZpZWxkIiwiX2hlYWRlciIsInRvTG93ZXJDYXNlIiwiZ2V0SGVhZGVyIiwic2V0Iiwia2V5IiwiaGVhZGVyIiwidW5zZXQiLCJuYW1lIiwiX2RhdGEiLCJBcnJheSIsImlzQXJyYXkiLCJpIiwiU3RyaW5nIiwiX2dldEZvcm1EYXRhIiwiYXBwZW5kIiwiYWJvcnQiLCJ4aHIiLCJlbWl0IiwiX2F1dGgiLCJ1c2VyIiwicGFzcyIsImJhc2U2NEVuY29kZXIiLCJ0eXBlIiwidXNlcm5hbWUiLCJwYXNzd29yZCIsIndpdGhDcmVkZW50aWFscyIsIl93aXRoQ3JlZGVudGlhbHMiLCJyZWRpcmVjdHMiLCJuIiwiX21heFJlZGlyZWN0cyIsIm1heFJlc3BvbnNlU2l6ZSIsIlR5cGVFcnJvciIsIl9tYXhSZXNwb25zZVNpemUiLCJ0b0pTT04iLCJkYXRhIiwiaGVhZGVycyIsInNlbmQiLCJpc09iamVjdF8iLCJfZm9ybURhdGEiLCJfaXNIb3N0IiwidHJpbSIsInNvcnRRdWVyeSIsInNvcnQiLCJfc29ydCIsIl9maW5hbGl6ZVF1ZXJ5U3RyaW5nIiwicXVlcnkiLCJfcXVlcnkiLCJqb2luIiwiaW5jbHVkZXMiLCJpbmRleCIsImluZGV4T2YiLCJxdWVyeUFycmF5Iiwic2xpY2UiLCJzcGxpdCIsIl9hcHBlbmRRdWVyeVN0cmluZyIsIl90aW1lb3V0RXJyb3IiLCJyZWFzb24iLCJlcnJubyIsIl9zZXRUaW1lb3V0cyIsInNldFRpbWVvdXQiXSwic291cmNlcyI6WyIuLi9zcmMvcmVxdWVzdC1iYXNlLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBNb2R1bGUgb2YgbWl4ZWQtaW4gZnVuY3Rpb25zIHNoYXJlZCBiZXR3ZWVuIG5vZGUgYW5kIGNsaWVudCBjb2RlXHJcbiAqL1xyXG5jb25zdCB7IGlzT2JqZWN0LCBoYXNPd24gfSA9IHJlcXVpcmUoJy4vdXRpbHMnKTtcclxuXHJcbi8qKlxyXG4gKiBFeHBvc2UgYFJlcXVlc3RCYXNlYC5cclxuICovXHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFJlcXVlc3RCYXNlO1xyXG5cclxuLyoqXHJcbiAqIEluaXRpYWxpemUgYSBuZXcgYFJlcXVlc3RCYXNlYC5cclxuICpcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5mdW5jdGlvbiBSZXF1ZXN0QmFzZSgpIHt9XHJcblxyXG4vKipcclxuICogQ2xlYXIgcHJldmlvdXMgdGltZW91dC5cclxuICpcclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLmNsZWFyVGltZW91dCA9IGZ1bmN0aW9uICgpIHtcclxuICBjbGVhclRpbWVvdXQodGhpcy5fdGltZXIpO1xyXG4gIGNsZWFyVGltZW91dCh0aGlzLl9yZXNwb25zZVRpbWVvdXRUaW1lcik7XHJcbiAgY2xlYXJUaW1lb3V0KHRoaXMuX3VwbG9hZFRpbWVvdXRUaW1lcik7XHJcbiAgZGVsZXRlIHRoaXMuX3RpbWVyO1xyXG4gIGRlbGV0ZSB0aGlzLl9yZXNwb25zZVRpbWVvdXRUaW1lcjtcclxuICBkZWxldGUgdGhpcy5fdXBsb2FkVGltZW91dFRpbWVyO1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIE92ZXJyaWRlIGRlZmF1bHQgcmVzcG9uc2UgYm9keSBwYXJzZXJcclxuICpcclxuICogVGhpcyBmdW5jdGlvbiB3aWxsIGJlIGNhbGxlZCB0byBjb252ZXJ0IGluY29taW5nIGRhdGEgaW50byByZXF1ZXN0LmJvZHlcclxuICpcclxuICogQHBhcmFtIHtGdW5jdGlvbn1cclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUucGFyc2UgPSBmdW5jdGlvbiAoZm4pIHtcclxuICB0aGlzLl9wYXJzZXIgPSBmbjtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBTZXQgZm9ybWF0IG9mIGJpbmFyeSByZXNwb25zZSBib2R5LlxyXG4gKiBJbiBicm93c2VyIHZhbGlkIGZvcm1hdHMgYXJlICdibG9iJyBhbmQgJ2FycmF5YnVmZmVyJyxcclxuICogd2hpY2ggcmV0dXJuIEJsb2IgYW5kIEFycmF5QnVmZmVyLCByZXNwZWN0aXZlbHkuXHJcbiAqXHJcbiAqIEluIE5vZGUgYWxsIHZhbHVlcyByZXN1bHQgaW4gQnVmZmVyLlxyXG4gKlxyXG4gKiBFeGFtcGxlczpcclxuICpcclxuICogICAgICByZXEuZ2V0KCcvJylcclxuICogICAgICAgIC5yZXNwb25zZVR5cGUoJ2Jsb2InKVxyXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSB2YWxcclxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLnJlc3BvbnNlVHlwZSA9IGZ1bmN0aW9uICh2YWx1ZSkge1xyXG4gIHRoaXMuX3Jlc3BvbnNlVHlwZSA9IHZhbHVlO1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIE92ZXJyaWRlIGRlZmF1bHQgcmVxdWVzdCBib2R5IHNlcmlhbGl6ZXJcclxuICpcclxuICogVGhpcyBmdW5jdGlvbiB3aWxsIGJlIGNhbGxlZCB0byBjb252ZXJ0IGRhdGEgc2V0IHZpYSAuc2VuZCBvciAuYXR0YWNoIGludG8gcGF5bG9hZCB0byBzZW5kXHJcbiAqXHJcbiAqIEBwYXJhbSB7RnVuY3Rpb259XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLnNlcmlhbGl6ZSA9IGZ1bmN0aW9uIChmbikge1xyXG4gIHRoaXMuX3NlcmlhbGl6ZXIgPSBmbjtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBTZXQgdGltZW91dHMuXHJcbiAqXHJcbiAqIC0gcmVzcG9uc2UgdGltZW91dCBpcyB0aW1lIGJldHdlZW4gc2VuZGluZyByZXF1ZXN0IGFuZCByZWNlaXZpbmcgdGhlIGZpcnN0IGJ5dGUgb2YgdGhlIHJlc3BvbnNlLiBJbmNsdWRlcyBETlMgYW5kIGNvbm5lY3Rpb24gdGltZS5cclxuICogLSBkZWFkbGluZSBpcyB0aGUgdGltZSBmcm9tIHN0YXJ0IG9mIHRoZSByZXF1ZXN0IHRvIHJlY2VpdmluZyByZXNwb25zZSBib2R5IGluIGZ1bGwuIElmIHRoZSBkZWFkbGluZSBpcyB0b28gc2hvcnQgbGFyZ2UgZmlsZXMgbWF5IG5vdCBsb2FkIGF0IGFsbCBvbiBzbG93IGNvbm5lY3Rpb25zLlxyXG4gKiAtIHVwbG9hZCBpcyB0aGUgdGltZSAgc2luY2UgbGFzdCBiaXQgb2YgZGF0YSB3YXMgc2VudCBvciByZWNlaXZlZC4gVGhpcyB0aW1lb3V0IHdvcmtzIG9ubHkgaWYgZGVhZGxpbmUgdGltZW91dCBpcyBvZmZcclxuICpcclxuICogVmFsdWUgb2YgMCBvciBmYWxzZSBtZWFucyBubyB0aW1lb3V0LlxyXG4gKlxyXG4gKiBAcGFyYW0ge051bWJlcnxPYmplY3R9IG1zIG9yIHtyZXNwb25zZSwgZGVhZGxpbmV9XHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3RCYXNlLnByb3RvdHlwZS50aW1lb3V0ID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcclxuICBpZiAoIW9wdGlvbnMgfHwgdHlwZW9mIG9wdGlvbnMgIT09ICdvYmplY3QnKSB7XHJcbiAgICB0aGlzLl90aW1lb3V0ID0gb3B0aW9ucztcclxuICAgIHRoaXMuX3Jlc3BvbnNlVGltZW91dCA9IDA7XHJcbiAgICB0aGlzLl91cGxvYWRUaW1lb3V0ID0gMDtcclxuICAgIHJldHVybiB0aGlzO1xyXG4gIH1cclxuXHJcbiAgZm9yIChjb25zdCBvcHRpb24gaW4gb3B0aW9ucykge1xyXG4gICAgaWYgKGhhc093bihvcHRpb25zLCBvcHRpb24pKSB7XHJcbiAgICAgIHN3aXRjaCAob3B0aW9uKSB7XHJcbiAgICAgICAgY2FzZSAnZGVhZGxpbmUnOlxyXG4gICAgICAgICAgdGhpcy5fdGltZW91dCA9IG9wdGlvbnMuZGVhZGxpbmU7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgICBjYXNlICdyZXNwb25zZSc6XHJcbiAgICAgICAgICB0aGlzLl9yZXNwb25zZVRpbWVvdXQgPSBvcHRpb25zLnJlc3BvbnNlO1xyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgY2FzZSAndXBsb2FkJzpcclxuICAgICAgICAgIHRoaXMuX3VwbG9hZFRpbWVvdXQgPSBvcHRpb25zLnVwbG9hZDtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICBjb25zb2xlLndhcm4oJ1Vua25vd24gdGltZW91dCBvcHRpb24nLCBvcHRpb24pO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBTZXQgbnVtYmVyIG9mIHJldHJ5IGF0dGVtcHRzIG9uIGVycm9yLlxyXG4gKlxyXG4gKiBGYWlsZWQgcmVxdWVzdHMgd2lsbCBiZSByZXRyaWVkICdjb3VudCcgdGltZXMgaWYgdGltZW91dCBvciBlcnIuY29kZSA+PSA1MDAuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBjb3VudFxyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbZm5dXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3RCYXNlLnByb3RvdHlwZS5yZXRyeSA9IGZ1bmN0aW9uIChjb3VudCwgZm4pIHtcclxuICAvLyBEZWZhdWx0IHRvIDEgaWYgbm8gY291bnQgcGFzc2VkIG9yIHRydWVcclxuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMCB8fCBjb3VudCA9PT0gdHJ1ZSkgY291bnQgPSAxO1xyXG4gIGlmIChjb3VudCA8PSAwKSBjb3VudCA9IDA7XHJcbiAgdGhpcy5fbWF4UmV0cmllcyA9IGNvdW50O1xyXG4gIHRoaXMuX3JldHJpZXMgPSAwO1xyXG4gIHRoaXMuX3JldHJ5Q2FsbGJhY2sgPSBmbjtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8vXHJcbi8vIE5PVEU6IHdlIGRvIG5vdCBpbmNsdWRlIEVTT0NLRVRUSU1FRE9VVCBiZWNhdXNlIHRoYXQgaXMgZnJvbSBgcmVxdWVzdGAgcGFja2FnZVxyXG4vLyAgICAgICA8aHR0cHM6Ly9naXRodWIuY29tL3NpbmRyZXNvcmh1cy9nb3QvcHVsbC81Mzc+XHJcbi8vXHJcbi8vIE5PVEU6IHdlIGRvIG5vdCBpbmNsdWRlIEVBRERSSU5GTyBiZWNhdXNlIGl0IHdhcyByZW1vdmVkIGZyb20gbGlidXYgaW4gMjAxNFxyXG4vLyAgICAgICA8aHR0cHM6Ly9naXRodWIuY29tL2xpYnV2L2xpYnV2L2NvbW1pdC8wMmUxZWJkNDBiODA3YmU1YWY0NjM0M2VhODczMzMxYjJlZTRlOWMxPlxyXG4vLyAgICAgICA8aHR0cHM6Ly9naXRodWIuY29tL3JlcXVlc3QvcmVxdWVzdC9zZWFyY2g/cT1FU09DS0VUVElNRURPVVQmdW5zY29wZWRfcT1FU09DS0VUVElNRURPVVQ+XHJcbi8vXHJcbi8vXHJcbi8vIFRPRE86IGV4cG9zZSB0aGVzZSBhcyBjb25maWd1cmFibGUgZGVmYXVsdHNcclxuLy9cclxuY29uc3QgRVJST1JfQ09ERVMgPSBuZXcgU2V0KFtcclxuICAnRVRJTUVET1VUJyxcclxuICAnRUNPTk5SRVNFVCcsXHJcbiAgJ0VBRERSSU5VU0UnLFxyXG4gICdFQ09OTlJFRlVTRUQnLFxyXG4gICdFUElQRScsXHJcbiAgJ0VOT1RGT1VORCcsXHJcbiAgJ0VORVRVTlJFQUNIJyxcclxuICAnRUFJX0FHQUlOJ1xyXG5dKTtcclxuXHJcbmNvbnN0IFNUQVRVU19DT0RFUyA9IG5ldyBTZXQoW1xyXG4gIDQwOCwgNDEzLCA0MjksIDUwMCwgNTAyLCA1MDMsIDUwNCwgNTIxLCA1MjIsIDUyNFxyXG5dKTtcclxuXHJcbi8vIFRPRE86IHdlIHdvdWxkIG5lZWQgdG8gbWFrZSB0aGlzIGVhc2lseSBjb25maWd1cmFibGUgYmVmb3JlIGFkZGluZyBpdCBpbiAoZS5nLiBzb21lIG1pZ2h0IHdhbnQgdG8gYWRkIFBPU1QpXHJcbi8vIGNvbnN0IE1FVEhPRFMgPSBuZXcgU2V0KFsnR0VUJywgJ1BVVCcsICdIRUFEJywgJ0RFTEVURScsICdPUFRJT05TJywgJ1RSQUNFJ10pO1xyXG5cclxuLyoqXHJcbiAqIERldGVybWluZSBpZiBhIHJlcXVlc3Qgc2hvdWxkIGJlIHJldHJpZWQuXHJcbiAqIChJbnNwaXJlZCBieSBodHRwczovL2dpdGh1Yi5jb20vc2luZHJlc29yaHVzL2dvdCNyZXRyeSlcclxuICpcclxuICogQHBhcmFtIHtFcnJvcn0gZXJyIGFuIGVycm9yXHJcbiAqIEBwYXJhbSB7UmVzcG9uc2V9IFtyZXNdIHJlc3BvbnNlXHJcbiAqIEByZXR1cm5zIHtCb29sZWFufSBpZiBzZWdtZW50IHNob3VsZCBiZSByZXRyaWVkXHJcbiAqL1xyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUuX3Nob3VsZFJldHJ5ID0gZnVuY3Rpb24gKGVycm9yLCByZXMpIHtcclxuICBpZiAoIXRoaXMuX21heFJldHJpZXMgfHwgdGhpcy5fcmV0cmllcysrID49IHRoaXMuX21heFJldHJpZXMpIHtcclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcblxyXG4gIGlmICh0aGlzLl9yZXRyeUNhbGxiYWNrKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBvdmVycmlkZSA9IHRoaXMuX3JldHJ5Q2FsbGJhY2soZXJyb3IsIHJlcyk7XHJcbiAgICAgIGlmIChvdmVycmlkZSA9PT0gdHJ1ZSkgcmV0dXJuIHRydWU7XHJcbiAgICAgIGlmIChvdmVycmlkZSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZTtcclxuICAgICAgLy8gdW5kZWZpbmVkIGZhbGxzIGJhY2sgdG8gZGVmYXVsdHNcclxuICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGVycik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvLyBUT0RPOiB3ZSB3b3VsZCBuZWVkIHRvIG1ha2UgdGhpcyBlYXNpbHkgY29uZmlndXJhYmxlIGJlZm9yZSBhZGRpbmcgaXQgaW4gKGUuZy4gc29tZSBtaWdodCB3YW50IHRvIGFkZCBQT1NUKVxyXG4gIC8qXHJcbiAgaWYgKFxyXG4gICAgdGhpcy5yZXEgJiZcclxuICAgIHRoaXMucmVxLm1ldGhvZCAmJlxyXG4gICAgIU1FVEhPRFMuaGFzKHRoaXMucmVxLm1ldGhvZC50b1VwcGVyQ2FzZSgpKVxyXG4gIClcclxuICAgIHJldHVybiBmYWxzZTtcclxuICAqL1xyXG4gIGlmIChyZXMgJiYgcmVzLnN0YXR1cyAmJiBTVEFUVVNfQ09ERVMuaGFzKHJlcy5zdGF0dXMpKSByZXR1cm4gdHJ1ZTtcclxuICBpZiAoZXJyb3IpIHtcclxuICAgIGlmIChlcnJvci5jb2RlICYmIEVSUk9SX0NPREVTLmhhcyhlcnJvci5jb2RlKSkgcmV0dXJuIHRydWU7XHJcbiAgICAvLyBTdXBlcmFnZW50IHRpbWVvdXRcclxuICAgIGlmIChlcnJvci50aW1lb3V0ICYmIGVycm9yLmNvZGUgPT09ICdFQ09OTkFCT1JURUQnKSByZXR1cm4gdHJ1ZTtcclxuICAgIGlmIChlcnJvci5jcm9zc0RvbWFpbikgcmV0dXJuIHRydWU7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gZmFsc2U7XHJcbn07XHJcblxyXG4vKipcclxuICogUmV0cnkgcmVxdWVzdFxyXG4gKlxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLl9yZXRyeSA9IGZ1bmN0aW9uICgpIHtcclxuICB0aGlzLmNsZWFyVGltZW91dCgpO1xyXG5cclxuICAvLyBub2RlXHJcbiAgaWYgKHRoaXMucmVxKSB7XHJcbiAgICB0aGlzLnJlcSA9IG51bGw7XHJcbiAgICB0aGlzLnJlcSA9IHRoaXMucmVxdWVzdCgpO1xyXG4gIH1cclxuXHJcbiAgdGhpcy5fYWJvcnRlZCA9IGZhbHNlO1xyXG4gIHRoaXMudGltZWRvdXQgPSBmYWxzZTtcclxuICB0aGlzLnRpbWVkb3V0RXJyb3IgPSBudWxsO1xyXG5cclxuICByZXR1cm4gdGhpcy5fZW5kKCk7XHJcbn07XHJcblxyXG4vKipcclxuICogUHJvbWlzZSBzdXBwb3J0XHJcbiAqXHJcbiAqIEBwYXJhbSB7RnVuY3Rpb259IHJlc29sdmVcclxuICogQHBhcmFtIHtGdW5jdGlvbn0gW3JlamVjdF1cclxuICogQHJldHVybiB7UmVxdWVzdH1cclxuICovXHJcblxyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUudGhlbiA9IGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcclxuICBpZiAoIXRoaXMuX2Z1bGxmaWxsZWRQcm9taXNlKSB7XHJcbiAgICBjb25zdCBzZWxmID0gdGhpcztcclxuICAgIGlmICh0aGlzLl9lbmRDYWxsZWQpIHtcclxuICAgICAgY29uc29sZS53YXJuKFxyXG4gICAgICAgICdXYXJuaW5nOiBzdXBlcmFnZW50IHJlcXVlc3Qgd2FzIHNlbnQgdHdpY2UsIGJlY2F1c2UgYm90aCAuZW5kKCkgYW5kIC50aGVuKCkgd2VyZSBjYWxsZWQuIE5ldmVyIGNhbGwgLmVuZCgpIGlmIHlvdSB1c2UgcHJvbWlzZXMnXHJcbiAgICAgICk7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5fZnVsbGZpbGxlZFByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICAgIHNlbGYub24oJ2Fib3J0JywgKCkgPT4ge1xyXG4gICAgICAgIGlmICh0aGlzLl9tYXhSZXRyaWVzICYmIHRoaXMuX21heFJldHJpZXMgPiB0aGlzLl9yZXRyaWVzKSB7XHJcbiAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAodGhpcy50aW1lZG91dCAmJiB0aGlzLnRpbWVkb3V0RXJyb3IpIHtcclxuICAgICAgICAgIHJlamVjdCh0aGlzLnRpbWVkb3V0RXJyb3IpO1xyXG4gICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoJ0Fib3J0ZWQnKTtcclxuICAgICAgICBlcnJvci5jb2RlID0gJ0FCT1JURUQnO1xyXG4gICAgICAgIGVycm9yLnN0YXR1cyA9IHRoaXMuc3RhdHVzO1xyXG4gICAgICAgIGVycm9yLm1ldGhvZCA9IHRoaXMubWV0aG9kO1xyXG4gICAgICAgIGVycm9yLnVybCA9IHRoaXMudXJsO1xyXG4gICAgICAgIHJlamVjdChlcnJvcik7XHJcbiAgICAgIH0pO1xyXG4gICAgICBzZWxmLmVuZCgoZXJyb3IsIHJlcykgPT4ge1xyXG4gICAgICAgIGlmIChlcnJvcikgcmVqZWN0KGVycm9yKTtcclxuICAgICAgICBlbHNlIHJlc29sdmUocmVzKTtcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHJldHVybiB0aGlzLl9mdWxsZmlsbGVkUHJvbWlzZS50aGVuKHJlc29sdmUsIHJlamVjdCk7XHJcbn07XHJcblxyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUuY2F0Y2ggPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcclxuICByZXR1cm4gdGhpcy50aGVuKHVuZGVmaW5lZCwgY2FsbGJhY2spO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEFsbG93IGZvciBleHRlbnNpb25cclxuICovXHJcblxyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24gKGZuKSB7XHJcbiAgZm4odGhpcyk7XHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUub2sgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcclxuICBpZiAodHlwZW9mIGNhbGxiYWNrICE9PSAnZnVuY3Rpb24nKSB0aHJvdyBuZXcgRXJyb3IoJ0NhbGxiYWNrIHJlcXVpcmVkJyk7XHJcbiAgdGhpcy5fb2tDYWxsYmFjayA9IGNhbGxiYWNrO1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLl9pc1Jlc3BvbnNlT0sgPSBmdW5jdGlvbiAocmVzKSB7XHJcbiAgaWYgKCFyZXMpIHtcclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcblxyXG4gIGlmICh0aGlzLl9va0NhbGxiYWNrKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fb2tDYWxsYmFjayhyZXMpO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHJlcy5zdGF0dXMgPj0gMjAwICYmIHJlcy5zdGF0dXMgPCAzMDA7XHJcbn07XHJcblxyXG4vKipcclxuICogR2V0IHJlcXVlc3QgaGVhZGVyIGBmaWVsZGAuXHJcbiAqIENhc2UtaW5zZW5zaXRpdmUuXHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBmaWVsZFxyXG4gKiBAcmV0dXJuIHtTdHJpbmd9XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uIChmaWVsZCkge1xyXG4gIHJldHVybiB0aGlzLl9oZWFkZXJbZmllbGQudG9Mb3dlckNhc2UoKV07XHJcbn07XHJcblxyXG4vKipcclxuICogR2V0IGNhc2UtaW5zZW5zaXRpdmUgaGVhZGVyIGBmaWVsZGAgdmFsdWUuXHJcbiAqIFRoaXMgaXMgYSBkZXByZWNhdGVkIGludGVybmFsIEFQSS4gVXNlIGAuZ2V0KGZpZWxkKWAgaW5zdGVhZC5cclxuICpcclxuICogKGdldEhlYWRlciBpcyBubyBsb25nZXIgdXNlZCBpbnRlcm5hbGx5IGJ5IHRoZSBzdXBlcmFnZW50IGNvZGUgYmFzZSlcclxuICpcclxuICogQHBhcmFtIHtTdHJpbmd9IGZpZWxkXHJcbiAqIEByZXR1cm4ge1N0cmluZ31cclxuICogQGFwaSBwcml2YXRlXHJcbiAqIEBkZXByZWNhdGVkXHJcbiAqL1xyXG5cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLmdldEhlYWRlciA9IFJlcXVlc3RCYXNlLnByb3RvdHlwZS5nZXQ7XHJcblxyXG4vKipcclxuICogU2V0IGhlYWRlciBgZmllbGRgIHRvIGB2YWxgLCBvciBtdWx0aXBsZSBmaWVsZHMgd2l0aCBvbmUgb2JqZWN0LlxyXG4gKiBDYXNlLWluc2Vuc2l0aXZlLlxyXG4gKlxyXG4gKiBFeGFtcGxlczpcclxuICpcclxuICogICAgICByZXEuZ2V0KCcvJylcclxuICogICAgICAgIC5zZXQoJ0FjY2VwdCcsICdhcHBsaWNhdGlvbi9qc29uJylcclxuICogICAgICAgIC5zZXQoJ1gtQVBJLUtleScsICdmb29iYXInKVxyXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XHJcbiAqXHJcbiAqICAgICAgcmVxLmdldCgnLycpXHJcbiAqICAgICAgICAuc2V0KHsgQWNjZXB0OiAnYXBwbGljYXRpb24vanNvbicsICdYLUFQSS1LZXknOiAnZm9vYmFyJyB9KVxyXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfE9iamVjdH0gZmllbGRcclxuICogQHBhcmFtIHtTdHJpbmd9IHZhbFxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24gKGZpZWxkLCB2YWx1ZSkge1xyXG4gIGlmIChpc09iamVjdChmaWVsZCkpIHtcclxuICAgIGZvciAoY29uc3Qga2V5IGluIGZpZWxkKSB7XHJcbiAgICAgIGlmIChoYXNPd24oZmllbGQsIGtleSkpIHRoaXMuc2V0KGtleSwgZmllbGRba2V5XSk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHRoaXM7XHJcbiAgfVxyXG5cclxuICB0aGlzLl9oZWFkZXJbZmllbGQudG9Mb3dlckNhc2UoKV0gPSB2YWx1ZTtcclxuICB0aGlzLmhlYWRlcltmaWVsZF0gPSB2YWx1ZTtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZW1vdmUgaGVhZGVyIGBmaWVsZGAuXHJcbiAqIENhc2UtaW5zZW5zaXRpdmUuXHJcbiAqXHJcbiAqIEV4YW1wbGU6XHJcbiAqXHJcbiAqICAgICAgcmVxLmdldCgnLycpXHJcbiAqICAgICAgICAudW5zZXQoJ1VzZXItQWdlbnQnKVxyXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBmaWVsZCBmaWVsZCBuYW1lXHJcbiAqL1xyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUudW5zZXQgPSBmdW5jdGlvbiAoZmllbGQpIHtcclxuICBkZWxldGUgdGhpcy5faGVhZGVyW2ZpZWxkLnRvTG93ZXJDYXNlKCldO1xyXG4gIGRlbGV0ZSB0aGlzLmhlYWRlcltmaWVsZF07XHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG4vKipcclxuICogV3JpdGUgdGhlIGZpZWxkIGBuYW1lYCBhbmQgYHZhbGAsIG9yIG11bHRpcGxlIGZpZWxkcyB3aXRoIG9uZSBvYmplY3RcclxuICogZm9yIFwibXVsdGlwYXJ0L2Zvcm0tZGF0YVwiIHJlcXVlc3QgYm9kaWVzLlxyXG4gKlxyXG4gKiBgYGAganNcclxuICogcmVxdWVzdC5wb3N0KCcvdXBsb2FkJylcclxuICogICAuZmllbGQoJ2ZvbycsICdiYXInKVxyXG4gKiAgIC5lbmQoY2FsbGJhY2spO1xyXG4gKlxyXG4gKiByZXF1ZXN0LnBvc3QoJy91cGxvYWQnKVxyXG4gKiAgIC5maWVsZCh7IGZvbzogJ2JhcicsIGJhejogJ3F1eCcgfSlcclxuICogICAuZW5kKGNhbGxiYWNrKTtcclxuICogYGBgXHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfE9iamVjdH0gbmFtZSBuYW1lIG9mIGZpZWxkXHJcbiAqIEBwYXJhbSB7U3RyaW5nfEJsb2J8RmlsZXxCdWZmZXJ8ZnMuUmVhZFN0cmVhbX0gdmFsIHZhbHVlIG9mIGZpZWxkXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBvcHRpb25zIGV4dHJhIG9wdGlvbnMsIGUuZy4gJ2Jsb2InXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLmZpZWxkID0gZnVuY3Rpb24gKG5hbWUsIHZhbHVlLCBvcHRpb25zKSB7XHJcbiAgLy8gbmFtZSBzaG91bGQgYmUgZWl0aGVyIGEgc3RyaW5nIG9yIGFuIG9iamVjdC5cclxuICBpZiAobmFtZSA9PT0gbnVsbCB8fCB1bmRlZmluZWQgPT09IG5hbWUpIHtcclxuICAgIHRocm93IG5ldyBFcnJvcignLmZpZWxkKG5hbWUsIHZhbCkgbmFtZSBjYW4gbm90IGJlIGVtcHR5Jyk7XHJcbiAgfVxyXG5cclxuICBpZiAodGhpcy5fZGF0YSkge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICBcIi5maWVsZCgpIGNhbid0IGJlIHVzZWQgaWYgLnNlbmQoKSBpcyB1c2VkLiBQbGVhc2UgdXNlIG9ubHkgLnNlbmQoKSBvciBvbmx5IC5maWVsZCgpICYgLmF0dGFjaCgpXCJcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBpZiAoaXNPYmplY3QobmFtZSkpIHtcclxuICAgIGZvciAoY29uc3Qga2V5IGluIG5hbWUpIHtcclxuICAgICAgaWYgKGhhc093bihuYW1lLCBrZXkpKSB0aGlzLmZpZWxkKGtleSwgbmFtZVtrZXldKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gdGhpcztcclxuICB9XHJcblxyXG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xyXG4gICAgZm9yIChjb25zdCBpIGluIHZhbHVlKSB7XHJcbiAgICAgIGlmIChoYXNPd24odmFsdWUsIGkpKSB0aGlzLmZpZWxkKG5hbWUsIHZhbHVlW2ldKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gdGhpcztcclxuICB9XHJcblxyXG4gIC8vIHZhbCBzaG91bGQgYmUgZGVmaW5lZCBub3dcclxuICBpZiAodmFsdWUgPT09IG51bGwgfHwgdW5kZWZpbmVkID09PSB2YWx1ZSkge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKCcuZmllbGQobmFtZSwgdmFsKSB2YWwgY2FuIG5vdCBiZSBlbXB0eScpO1xyXG4gIH1cclxuXHJcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ2Jvb2xlYW4nKSB7XHJcbiAgICB2YWx1ZSA9IFN0cmluZyh2YWx1ZSk7XHJcbiAgfVxyXG5cclxuICAvLyBmaXggaHR0cHM6Ly9naXRodWIuY29tL2xhZGpzL3N1cGVyYWdlbnQvaXNzdWVzLzE2ODBcclxuICBpZiAob3B0aW9ucykgdGhpcy5fZ2V0Rm9ybURhdGEoKS5hcHBlbmQobmFtZSwgdmFsdWUsIG9wdGlvbnMpO1xyXG4gIGVsc2UgdGhpcy5fZ2V0Rm9ybURhdGEoKS5hcHBlbmQobmFtZSwgdmFsdWUpO1xyXG5cclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBBYm9ydCB0aGUgcmVxdWVzdCwgYW5kIGNsZWFyIHBvdGVudGlhbCB0aW1lb3V0LlxyXG4gKlxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSByZXF1ZXN0XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUuYWJvcnQgPSBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHRoaXMuX2Fib3J0ZWQpIHtcclxuICAgIHJldHVybiB0aGlzO1xyXG4gIH1cclxuXHJcbiAgdGhpcy5fYWJvcnRlZCA9IHRydWU7XHJcbiAgaWYgKHRoaXMueGhyKSB0aGlzLnhoci5hYm9ydCgpOyAvLyBicm93c2VyXHJcbiAgaWYgKHRoaXMucmVxKSB7XHJcbiAgICB0aGlzLnJlcS5hYm9ydCgpOyAvLyBub2RlXHJcbiAgfVxyXG5cclxuICB0aGlzLmNsZWFyVGltZW91dCgpO1xyXG4gIHRoaXMuZW1pdCgnYWJvcnQnKTtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcblJlcXVlc3RCYXNlLnByb3RvdHlwZS5fYXV0aCA9IGZ1bmN0aW9uICh1c2VyLCBwYXNzLCBvcHRpb25zLCBiYXNlNjRFbmNvZGVyKSB7XHJcbiAgc3dpdGNoIChvcHRpb25zLnR5cGUpIHtcclxuICAgIGNhc2UgJ2Jhc2ljJzpcclxuICAgICAgdGhpcy5zZXQoJ0F1dGhvcml6YXRpb24nLCBgQmFzaWMgJHtiYXNlNjRFbmNvZGVyKGAke3VzZXJ9OiR7cGFzc31gKX1gKTtcclxuICAgICAgYnJlYWs7XHJcblxyXG4gICAgY2FzZSAnYXV0byc6XHJcbiAgICAgIHRoaXMudXNlcm5hbWUgPSB1c2VyO1xyXG4gICAgICB0aGlzLnBhc3N3b3JkID0gcGFzcztcclxuICAgICAgYnJlYWs7XHJcblxyXG4gICAgY2FzZSAnYmVhcmVyJzogLy8gdXNhZ2Ugd291bGQgYmUgLmF1dGgoYWNjZXNzVG9rZW4sIHsgdHlwZTogJ2JlYXJlcicgfSlcclxuICAgICAgdGhpcy5zZXQoJ0F1dGhvcml6YXRpb24nLCBgQmVhcmVyICR7dXNlcn1gKTtcclxuICAgICAgYnJlYWs7XHJcbiAgICBkZWZhdWx0OlxyXG4gICAgICBicmVhaztcclxuICB9XHJcblxyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEVuYWJsZSB0cmFuc21pc3Npb24gb2YgY29va2llcyB3aXRoIHgtZG9tYWluIHJlcXVlc3RzLlxyXG4gKlxyXG4gKiBOb3RlIHRoYXQgZm9yIHRoaXMgdG8gd29yayB0aGUgb3JpZ2luIG11c3Qgbm90IGJlXHJcbiAqIHVzaW5nIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luXCIgd2l0aCBhIHdpbGRjYXJkLFxyXG4gKiBhbmQgYWxzbyBtdXN0IHNldCBcIkFjY2Vzcy1Db250cm9sLUFsbG93LUNyZWRlbnRpYWxzXCJcclxuICogdG8gXCJ0cnVlXCIuXHJcbiAqIEBwYXJhbSB7Qm9vbGVhbn0gW29uPXRydWVdIC0gU2V0ICd3aXRoQ3JlZGVudGlhbHMnIHN0YXRlXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3RCYXNlLnByb3RvdHlwZS53aXRoQ3JlZGVudGlhbHMgPSBmdW5jdGlvbiAob24pIHtcclxuICAvLyBUaGlzIGlzIGJyb3dzZXItb25seSBmdW5jdGlvbmFsaXR5LiBOb2RlIHNpZGUgaXMgbm8tb3AuXHJcbiAgaWYgKG9uID09PSB1bmRlZmluZWQpIG9uID0gdHJ1ZTtcclxuICB0aGlzLl93aXRoQ3JlZGVudGlhbHMgPSBvbjtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBTZXQgdGhlIG1heCByZWRpcmVjdHMgdG8gYG5gLiBEb2VzIG5vdGhpbmcgaW4gYnJvd3NlciBYSFIgaW1wbGVtZW50YXRpb24uXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBuXHJcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcblJlcXVlc3RCYXNlLnByb3RvdHlwZS5yZWRpcmVjdHMgPSBmdW5jdGlvbiAobikge1xyXG4gIHRoaXMuX21heFJlZGlyZWN0cyA9IG47XHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG4vKipcclxuICogTWF4aW11bSBzaXplIG9mIGJ1ZmZlcmVkIHJlc3BvbnNlIGJvZHksIGluIGJ5dGVzLiBDb3VudHMgdW5jb21wcmVzc2VkIHNpemUuXHJcbiAqIERlZmF1bHQgMjAwTUIuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBuIG51bWJlciBvZiBieXRlc1xyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICovXHJcblJlcXVlc3RCYXNlLnByb3RvdHlwZS5tYXhSZXNwb25zZVNpemUgPSBmdW5jdGlvbiAobikge1xyXG4gIGlmICh0eXBlb2YgbiAhPT0gJ251bWJlcicpIHtcclxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0ludmFsaWQgYXJndW1lbnQnKTtcclxuICB9XHJcblxyXG4gIHRoaXMuX21heFJlc3BvbnNlU2l6ZSA9IG47XHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG4vKipcclxuICogQ29udmVydCB0byBhIHBsYWluIGphdmFzY3JpcHQgb2JqZWN0IChub3QgSlNPTiBzdHJpbmcpIG9mIHNjYWxhciBwcm9wZXJ0aWVzLlxyXG4gKiBOb3RlIGFzIHRoaXMgbWV0aG9kIGlzIGRlc2lnbmVkIHRvIHJldHVybiBhIHVzZWZ1bCBub24tdGhpcyB2YWx1ZSxcclxuICogaXQgY2Fubm90IGJlIGNoYWluZWQuXHJcbiAqXHJcbiAqIEByZXR1cm4ge09iamVjdH0gZGVzY3JpYmluZyBtZXRob2QsIHVybCwgYW5kIGRhdGEgb2YgdGhpcyByZXF1ZXN0XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uICgpIHtcclxuICByZXR1cm4ge1xyXG4gICAgbWV0aG9kOiB0aGlzLm1ldGhvZCxcclxuICAgIHVybDogdGhpcy51cmwsXHJcbiAgICBkYXRhOiB0aGlzLl9kYXRhLFxyXG4gICAgaGVhZGVyczogdGhpcy5faGVhZGVyXHJcbiAgfTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBTZW5kIGBkYXRhYCBhcyB0aGUgcmVxdWVzdCBib2R5LCBkZWZhdWx0aW5nIHRoZSBgLnR5cGUoKWAgdG8gXCJqc29uXCIgd2hlblxyXG4gKiBhbiBvYmplY3QgaXMgZ2l2ZW4uXHJcbiAqXHJcbiAqIEV4YW1wbGVzOlxyXG4gKlxyXG4gKiAgICAgICAvLyBtYW51YWwganNvblxyXG4gKiAgICAgICByZXF1ZXN0LnBvc3QoJy91c2VyJylcclxuICogICAgICAgICAudHlwZSgnanNvbicpXHJcbiAqICAgICAgICAgLnNlbmQoJ3tcIm5hbWVcIjpcInRqXCJ9JylcclxuICogICAgICAgICAuZW5kKGNhbGxiYWNrKVxyXG4gKlxyXG4gKiAgICAgICAvLyBhdXRvIGpzb25cclxuICogICAgICAgcmVxdWVzdC5wb3N0KCcvdXNlcicpXHJcbiAqICAgICAgICAgLnNlbmQoeyBuYW1lOiAndGonIH0pXHJcbiAqICAgICAgICAgLmVuZChjYWxsYmFjaylcclxuICpcclxuICogICAgICAgLy8gbWFudWFsIHgtd3d3LWZvcm0tdXJsZW5jb2RlZFxyXG4gKiAgICAgICByZXF1ZXN0LnBvc3QoJy91c2VyJylcclxuICogICAgICAgICAudHlwZSgnZm9ybScpXHJcbiAqICAgICAgICAgLnNlbmQoJ25hbWU9dGonKVxyXG4gKiAgICAgICAgIC5lbmQoY2FsbGJhY2spXHJcbiAqXHJcbiAqICAgICAgIC8vIGF1dG8geC13d3ctZm9ybS11cmxlbmNvZGVkXHJcbiAqICAgICAgIHJlcXVlc3QucG9zdCgnL3VzZXInKVxyXG4gKiAgICAgICAgIC50eXBlKCdmb3JtJylcclxuICogICAgICAgICAuc2VuZCh7IG5hbWU6ICd0aicgfSlcclxuICogICAgICAgICAuZW5kKGNhbGxiYWNrKVxyXG4gKlxyXG4gKiAgICAgICAvLyBkZWZhdWx0cyB0byB4LXd3dy1mb3JtLXVybGVuY29kZWRcclxuICogICAgICByZXF1ZXN0LnBvc3QoJy91c2VyJylcclxuICogICAgICAgIC5zZW5kKCduYW1lPXRvYmknKVxyXG4gKiAgICAgICAgLnNlbmQoJ3NwZWNpZXM9ZmVycmV0JylcclxuICogICAgICAgIC5lbmQoY2FsbGJhY2spXHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfE9iamVjdH0gZGF0YVxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgY29tcGxleGl0eVxyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUuc2VuZCA9IGZ1bmN0aW9uIChkYXRhKSB7XHJcbiAgY29uc3QgaXNPYmplY3RfID0gaXNPYmplY3QoZGF0YSk7XHJcbiAgbGV0IHR5cGUgPSB0aGlzLl9oZWFkZXJbJ2NvbnRlbnQtdHlwZSddO1xyXG5cclxuICBpZiAodGhpcy5fZm9ybURhdGEpIHtcclxuICAgIHRocm93IG5ldyBFcnJvcihcclxuICAgICAgXCIuc2VuZCgpIGNhbid0IGJlIHVzZWQgaWYgLmF0dGFjaCgpIG9yIC5maWVsZCgpIGlzIHVzZWQuIFBsZWFzZSB1c2Ugb25seSAuc2VuZCgpIG9yIG9ubHkgLmZpZWxkKCkgJiAuYXR0YWNoKClcIlxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIGlmIChpc09iamVjdF8gJiYgIXRoaXMuX2RhdGEpIHtcclxuICAgIGlmIChBcnJheS5pc0FycmF5KGRhdGEpKSB7XHJcbiAgICAgIHRoaXMuX2RhdGEgPSBbXTtcclxuICAgIH0gZWxzZSBpZiAoIXRoaXMuX2lzSG9zdChkYXRhKSkge1xyXG4gICAgICB0aGlzLl9kYXRhID0ge307XHJcbiAgICB9XHJcbiAgfSBlbHNlIGlmIChkYXRhICYmIHRoaXMuX2RhdGEgJiYgdGhpcy5faXNIb3N0KHRoaXMuX2RhdGEpKSB7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW4ndCBtZXJnZSB0aGVzZSBzZW5kIGNhbGxzXCIpO1xyXG4gIH1cclxuXHJcbiAgLy8gbWVyZ2VcclxuICBpZiAoaXNPYmplY3RfICYmIGlzT2JqZWN0KHRoaXMuX2RhdGEpKSB7XHJcbiAgICBmb3IgKGNvbnN0IGtleSBpbiBkYXRhKSB7XHJcbiAgICAgIGlmICh0eXBlb2YgZGF0YVtrZXldID09ICdiaWdpbnQnICYmICFkYXRhW2tleV0udG9KU09OKVxyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IHNlcmlhbGl6ZSBCaWdJbnQgdmFsdWUgdG8ganNvbicpO1xyXG4gICAgICBpZiAoaGFzT3duKGRhdGEsIGtleSkpIHRoaXMuX2RhdGFba2V5XSA9IGRhdGFba2V5XTtcclxuICAgIH1cclxuICB9XHJcbiAgZWxzZSBpZiAodHlwZW9mIGRhdGEgPT09ICdiaWdpbnQnKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3Qgc2VuZCB2YWx1ZSBvZiB0eXBlIEJpZ0ludFwiKTtcclxuICBlbHNlIGlmICh0eXBlb2YgZGF0YSA9PT0gJ3N0cmluZycpIHtcclxuICAgIC8vIGRlZmF1bHQgdG8geC13d3ctZm9ybS11cmxlbmNvZGVkXHJcbiAgICBpZiAoIXR5cGUpIHRoaXMudHlwZSgnZm9ybScpO1xyXG4gICAgdHlwZSA9IHRoaXMuX2hlYWRlclsnY29udGVudC10eXBlJ107XHJcbiAgICBpZiAodHlwZSkgdHlwZSA9IHR5cGUudG9Mb3dlckNhc2UoKS50cmltKCk7XHJcbiAgICBpZiAodHlwZSA9PT0gJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCcpIHtcclxuICAgICAgdGhpcy5fZGF0YSA9IHRoaXMuX2RhdGEgPyBgJHt0aGlzLl9kYXRhfSYke2RhdGF9YCA6IGRhdGE7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICB0aGlzLl9kYXRhID0gKHRoaXMuX2RhdGEgfHwgJycpICsgZGF0YTtcclxuICAgIH1cclxuICB9IGVsc2Uge1xyXG4gICAgdGhpcy5fZGF0YSA9IGRhdGE7XHJcbiAgfVxyXG5cclxuICBpZiAoIWlzT2JqZWN0XyB8fCB0aGlzLl9pc0hvc3QoZGF0YSkpIHtcclxuICAgIHJldHVybiB0aGlzO1xyXG4gIH1cclxuXHJcbiAgLy8gZGVmYXVsdCB0byBqc29uXHJcbiAgaWYgKCF0eXBlKSB0aGlzLnR5cGUoJ2pzb24nKTtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBTb3J0IGBxdWVyeXN0cmluZ2AgYnkgdGhlIHNvcnQgZnVuY3Rpb25cclxuICpcclxuICpcclxuICogRXhhbXBsZXM6XHJcbiAqXHJcbiAqICAgICAgIC8vIGRlZmF1bHQgb3JkZXJcclxuICogICAgICAgcmVxdWVzdC5nZXQoJy91c2VyJylcclxuICogICAgICAgICAucXVlcnkoJ25hbWU9TmljaycpXHJcbiAqICAgICAgICAgLnF1ZXJ5KCdzZWFyY2g9TWFubnknKVxyXG4gKiAgICAgICAgIC5zb3J0UXVlcnkoKVxyXG4gKiAgICAgICAgIC5lbmQoY2FsbGJhY2spXHJcbiAqXHJcbiAqICAgICAgIC8vIGN1c3RvbWl6ZWQgc29ydCBmdW5jdGlvblxyXG4gKiAgICAgICByZXF1ZXN0LmdldCgnL3VzZXInKVxyXG4gKiAgICAgICAgIC5xdWVyeSgnbmFtZT1OaWNrJylcclxuICogICAgICAgICAucXVlcnkoJ3NlYXJjaD1NYW5ueScpXHJcbiAqICAgICAgICAgLnNvcnRRdWVyeShmdW5jdGlvbihhLCBiKXtcclxuICogICAgICAgICAgIHJldHVybiBhLmxlbmd0aCAtIGIubGVuZ3RoO1xyXG4gKiAgICAgICAgIH0pXHJcbiAqICAgICAgICAgLmVuZChjYWxsYmFjaylcclxuICpcclxuICpcclxuICogQHBhcmFtIHtGdW5jdGlvbn0gc29ydFxyXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUuc29ydFF1ZXJ5ID0gZnVuY3Rpb24gKHNvcnQpIHtcclxuICAvLyBfc29ydCBkZWZhdWx0IHRvIHRydWUgYnV0IG90aGVyd2lzZSBjYW4gYmUgYSBmdW5jdGlvbiBvciBib29sZWFuXHJcbiAgdGhpcy5fc29ydCA9IHR5cGVvZiBzb3J0ID09PSAndW5kZWZpbmVkJyA/IHRydWUgOiBzb3J0O1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIENvbXBvc2UgcXVlcnlzdHJpbmcgdG8gYXBwZW5kIHRvIHJlcS51cmxcclxuICpcclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5SZXF1ZXN0QmFzZS5wcm90b3R5cGUuX2ZpbmFsaXplUXVlcnlTdHJpbmcgPSBmdW5jdGlvbiAoKSB7XHJcbiAgY29uc3QgcXVlcnkgPSB0aGlzLl9xdWVyeS5qb2luKCcmJyk7XHJcbiAgaWYgKHF1ZXJ5KSB7XHJcbiAgICB0aGlzLnVybCArPSAodGhpcy51cmwuaW5jbHVkZXMoJz8nKSA/ICcmJyA6ICc/JykgKyBxdWVyeTtcclxuICB9XHJcblxyXG4gIHRoaXMuX3F1ZXJ5Lmxlbmd0aCA9IDA7IC8vIE1ha2VzIHRoZSBjYWxsIGlkZW1wb3RlbnRcclxuXHJcbiAgaWYgKHRoaXMuX3NvcnQpIHtcclxuICAgIGNvbnN0IGluZGV4ID0gdGhpcy51cmwuaW5kZXhPZignPycpO1xyXG4gICAgaWYgKGluZGV4ID49IDApIHtcclxuICAgICAgY29uc3QgcXVlcnlBcnJheSA9IHRoaXMudXJsLnNsaWNlKGluZGV4ICsgMSkuc3BsaXQoJyYnKTtcclxuICAgICAgaWYgKHR5cGVvZiB0aGlzLl9zb3J0ID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgcXVlcnlBcnJheS5zb3J0KHRoaXMuX3NvcnQpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHF1ZXJ5QXJyYXkuc29ydCgpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICB0aGlzLnVybCA9IHRoaXMudXJsLnNsaWNlKDAsIGluZGV4KSArICc/JyArIHF1ZXJ5QXJyYXkuam9pbignJicpO1xyXG4gICAgfVxyXG4gIH1cclxufTtcclxuXHJcbi8vIEZvciBiYWNrd2FyZHMgY29tcGF0IG9ubHlcclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLl9hcHBlbmRRdWVyeVN0cmluZyA9ICgpID0+IHtcclxuICBjb25zb2xlLndhcm4oJ1Vuc3VwcG9ydGVkJyk7XHJcbn07XHJcblxyXG4vKipcclxuICogSW52b2tlIGNhbGxiYWNrIHdpdGggdGltZW91dCBlcnJvci5cclxuICpcclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLl90aW1lb3V0RXJyb3IgPSBmdW5jdGlvbiAocmVhc29uLCB0aW1lb3V0LCBlcnJubykge1xyXG4gIGlmICh0aGlzLl9hYm9ydGVkKSB7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG5cclxuICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcihgJHtyZWFzb24gKyB0aW1lb3V0fW1zIGV4Y2VlZGVkYCk7XHJcbiAgZXJyb3IudGltZW91dCA9IHRpbWVvdXQ7XHJcbiAgZXJyb3IuY29kZSA9ICdFQ09OTkFCT1JURUQnO1xyXG4gIGVycm9yLmVycm5vID0gZXJybm87XHJcbiAgdGhpcy50aW1lZG91dCA9IHRydWU7XHJcbiAgdGhpcy50aW1lZG91dEVycm9yID0gZXJyb3I7XHJcbiAgdGhpcy5hYm9ydCgpO1xyXG4gIHRoaXMuY2FsbGJhY2soZXJyb3IpO1xyXG59O1xyXG5cclxuUmVxdWVzdEJhc2UucHJvdG90eXBlLl9zZXRUaW1lb3V0cyA9IGZ1bmN0aW9uICgpIHtcclxuICBjb25zdCBzZWxmID0gdGhpcztcclxuXHJcbiAgLy8gZGVhZGxpbmVcclxuICBpZiAodGhpcy5fdGltZW91dCAmJiAhdGhpcy5fdGltZXIpIHtcclxuICAgIHRoaXMuX3RpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgIHNlbGYuX3RpbWVvdXRFcnJvcignVGltZW91dCBvZiAnLCBzZWxmLl90aW1lb3V0LCAnRVRJTUUnKTtcclxuICAgIH0sIHRoaXMuX3RpbWVvdXQpO1xyXG4gIH1cclxuXHJcbiAgLy8gcmVzcG9uc2UgdGltZW91dFxyXG4gIGlmICh0aGlzLl9yZXNwb25zZVRpbWVvdXQgJiYgIXRoaXMuX3Jlc3BvbnNlVGltZW91dFRpbWVyKSB7XHJcbiAgICB0aGlzLl9yZXNwb25zZVRpbWVvdXRUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICBzZWxmLl90aW1lb3V0RXJyb3IoXHJcbiAgICAgICAgJ1Jlc3BvbnNlIHRpbWVvdXQgb2YgJyxcclxuICAgICAgICBzZWxmLl9yZXNwb25zZVRpbWVvdXQsXHJcbiAgICAgICAgJ0VUSU1FRE9VVCdcclxuICAgICAgKTtcclxuICAgIH0sIHRoaXMuX3Jlc3BvbnNlVGltZW91dCk7XHJcbiAgfVxyXG59O1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0EsTUFBTTtFQUFFQSxRQUFRO0VBQUVDO0FBQU8sQ0FBQyxHQUFHQyxPQUFPLENBQUMsU0FBUyxDQUFDOztBQUUvQztBQUNBO0FBQ0E7O0FBRUFDLE1BQU0sQ0FBQ0MsT0FBTyxHQUFHQyxXQUFXOztBQUU1QjtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLFNBQVNBLFdBQVdBLENBQUEsRUFBRyxDQUFDOztBQUV4QjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUFBLFdBQVcsQ0FBQ0MsU0FBUyxDQUFDQyxZQUFZLEdBQUcsWUFBWTtFQUMvQ0EsWUFBWSxDQUFDLElBQUksQ0FBQ0MsTUFBTSxDQUFDO0VBQ3pCRCxZQUFZLENBQUMsSUFBSSxDQUFDRSxxQkFBcUIsQ0FBQztFQUN4Q0YsWUFBWSxDQUFDLElBQUksQ0FBQ0csbUJBQW1CLENBQUM7RUFDdEMsT0FBTyxJQUFJLENBQUNGLE1BQU07RUFDbEIsT0FBTyxJQUFJLENBQUNDLHFCQUFxQjtFQUNqQyxPQUFPLElBQUksQ0FBQ0MsbUJBQW1CO0VBQy9CLE9BQU8sSUFBSTtBQUNiLENBQUM7O0FBRUQ7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQUwsV0FBVyxDQUFDQyxTQUFTLENBQUNLLEtBQUssR0FBRyxVQUFVQyxFQUFFLEVBQUU7RUFDMUMsSUFBSSxDQUFDQyxPQUFPLEdBQUdELEVBQUU7RUFDakIsT0FBTyxJQUFJO0FBQ2IsQ0FBQzs7QUFFRDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBUCxXQUFXLENBQUNDLFNBQVMsQ0FBQ1EsWUFBWSxHQUFHLFVBQVVDLEtBQUssRUFBRTtFQUNwRCxJQUFJLENBQUNDLGFBQWEsR0FBR0QsS0FBSztFQUMxQixPQUFPLElBQUk7QUFDYixDQUFDOztBQUVEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUFWLFdBQVcsQ0FBQ0MsU0FBUyxDQUFDVyxTQUFTLEdBQUcsVUFBVUwsRUFBRSxFQUFFO0VBQzlDLElBQUksQ0FBQ00sV0FBVyxHQUFHTixFQUFFO0VBQ3JCLE9BQU8sSUFBSTtBQUNiLENBQUM7O0FBRUQ7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUFQLFdBQVcsQ0FBQ0MsU0FBUyxDQUFDYSxPQUFPLEdBQUcsVUFBVUMsT0FBTyxFQUFFO0VBQ2pELElBQUksQ0FBQ0EsT0FBTyxJQUFJLE9BQU9BLE9BQU8sS0FBSyxRQUFRLEVBQUU7SUFDM0MsSUFBSSxDQUFDQyxRQUFRLEdBQUdELE9BQU87SUFDdkIsSUFBSSxDQUFDRSxnQkFBZ0IsR0FBRyxDQUFDO0lBQ3pCLElBQUksQ0FBQ0MsY0FBYyxHQUFHLENBQUM7SUFDdkIsT0FBTyxJQUFJO0VBQ2I7RUFFQSxLQUFLLE1BQU1DLE1BQU0sSUFBSUosT0FBTyxFQUFFO0lBQzVCLElBQUluQixNQUFNLENBQUNtQixPQUFPLEVBQUVJLE1BQU0sQ0FBQyxFQUFFO01BQzNCLFFBQVFBLE1BQU07UUFDWixLQUFLLFVBQVU7VUFDYixJQUFJLENBQUNILFFBQVEsR0FBR0QsT0FBTyxDQUFDSyxRQUFRO1VBQ2hDO1FBQ0YsS0FBSyxVQUFVO1VBQ2IsSUFBSSxDQUFDSCxnQkFBZ0IsR0FBR0YsT0FBTyxDQUFDTSxRQUFRO1VBQ3hDO1FBQ0YsS0FBSyxRQUFRO1VBQ1gsSUFBSSxDQUFDSCxjQUFjLEdBQUdILE9BQU8sQ0FBQ08sTUFBTTtVQUNwQztRQUNGO1VBQ0VDLE9BQU8sQ0FBQ0MsSUFBSSxDQUFDLHdCQUF3QixFQUFFTCxNQUFNLENBQUM7TUFDbEQ7SUFDRjtFQUNGO0VBRUEsT0FBTyxJQUFJO0FBQ2IsQ0FBQzs7QUFFRDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQW5CLFdBQVcsQ0FBQ0MsU0FBUyxDQUFDd0IsS0FBSyxHQUFHLFVBQVVDLEtBQUssRUFBRW5CLEVBQUUsRUFBRTtFQUNqRDtFQUNBLElBQUlvQixTQUFTLENBQUNDLE1BQU0sS0FBSyxDQUFDLElBQUlGLEtBQUssS0FBSyxJQUFJLEVBQUVBLEtBQUssR0FBRyxDQUFDO0VBQ3ZELElBQUlBLEtBQUssSUFBSSxDQUFDLEVBQUVBLEtBQUssR0FBRyxDQUFDO0VBQ3pCLElBQUksQ0FBQ0csV0FBVyxHQUFHSCxLQUFLO0VBQ3hCLElBQUksQ0FBQ0ksUUFBUSxHQUFHLENBQUM7RUFDakIsSUFBSSxDQUFDQyxjQUFjLEdBQUd4QixFQUFFO0VBQ3hCLE9BQU8sSUFBSTtBQUNiLENBQUM7O0FBRUQ7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLE1BQU15QixXQUFXLEdBQUcsSUFBSUMsR0FBRyxDQUFDLENBQzFCLFdBQVcsRUFDWCxZQUFZLEVBQ1osWUFBWSxFQUNaLGNBQWMsRUFDZCxPQUFPLEVBQ1AsV0FBVyxFQUNYLGFBQWEsRUFDYixXQUFXLENBQ1osQ0FBQztBQUVGLE1BQU1DLFlBQVksR0FBRyxJQUFJRCxHQUFHLENBQUMsQ0FDM0IsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUNqRCxDQUFDOztBQUVGO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBakMsV0FBVyxDQUFDQyxTQUFTLENBQUNrQyxZQUFZLEdBQUcsVUFBVUMsS0FBSyxFQUFFQyxHQUFHLEVBQUU7RUFDekQsSUFBSSxDQUFDLElBQUksQ0FBQ1IsV0FBVyxJQUFJLElBQUksQ0FBQ0MsUUFBUSxFQUFFLElBQUksSUFBSSxDQUFDRCxXQUFXLEVBQUU7SUFDNUQsT0FBTyxLQUFLO0VBQ2Q7RUFFQSxJQUFJLElBQUksQ0FBQ0UsY0FBYyxFQUFFO0lBQ3ZCLElBQUk7TUFDRixNQUFNTyxRQUFRLEdBQUcsSUFBSSxDQUFDUCxjQUFjLENBQUNLLEtBQUssRUFBRUMsR0FBRyxDQUFDO01BQ2hELElBQUlDLFFBQVEsS0FBSyxJQUFJLEVBQUUsT0FBTyxJQUFJO01BQ2xDLElBQUlBLFFBQVEsS0FBSyxLQUFLLEVBQUUsT0FBTyxLQUFLO01BQ3BDO0lBQ0YsQ0FBQyxDQUFDLE9BQU9DLEdBQUcsRUFBRTtNQUNaaEIsT0FBTyxDQUFDYSxLQUFLLENBQUNHLEdBQUcsQ0FBQztJQUNwQjtFQUNGOztFQUVBO0VBQ0E7QUFDRjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNFLElBQUlGLEdBQUcsSUFBSUEsR0FBRyxDQUFDRyxNQUFNLElBQUlOLFlBQVksQ0FBQ08sR0FBRyxDQUFDSixHQUFHLENBQUNHLE1BQU0sQ0FBQyxFQUFFLE9BQU8sSUFBSTtFQUNsRSxJQUFJSixLQUFLLEVBQUU7SUFDVCxJQUFJQSxLQUFLLENBQUNNLElBQUksSUFBSVYsV0FBVyxDQUFDUyxHQUFHLENBQUNMLEtBQUssQ0FBQ00sSUFBSSxDQUFDLEVBQUUsT0FBTyxJQUFJO0lBQzFEO0lBQ0EsSUFBSU4sS0FBSyxDQUFDdEIsT0FBTyxJQUFJc0IsS0FBSyxDQUFDTSxJQUFJLEtBQUssY0FBYyxFQUFFLE9BQU8sSUFBSTtJQUMvRCxJQUFJTixLQUFLLENBQUNPLFdBQVcsRUFBRSxPQUFPLElBQUk7RUFDcEM7RUFFQSxPQUFPLEtBQUs7QUFDZCxDQUFDOztBQUVEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTNDLFdBQVcsQ0FBQ0MsU0FBUyxDQUFDMkMsTUFBTSxHQUFHLFlBQVk7RUFDekMsSUFBSSxDQUFDMUMsWUFBWSxDQUFDLENBQUM7O0VBRW5CO0VBQ0EsSUFBSSxJQUFJLENBQUMyQyxHQUFHLEVBQUU7SUFDWixJQUFJLENBQUNBLEdBQUcsR0FBRyxJQUFJO0lBQ2YsSUFBSSxDQUFDQSxHQUFHLEdBQUcsSUFBSSxDQUFDQyxPQUFPLENBQUMsQ0FBQztFQUMzQjtFQUVBLElBQUksQ0FBQ0MsUUFBUSxHQUFHLEtBQUs7RUFDckIsSUFBSSxDQUFDQyxRQUFRLEdBQUcsS0FBSztFQUNyQixJQUFJLENBQUNDLGFBQWEsR0FBRyxJQUFJO0VBRXpCLE9BQU8sSUFBSSxDQUFDQyxJQUFJLENBQUMsQ0FBQztBQUNwQixDQUFDOztBQUVEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBbEQsV0FBVyxDQUFDQyxTQUFTLENBQUNrRCxJQUFJLEdBQUcsVUFBVUMsT0FBTyxFQUFFQyxNQUFNLEVBQUU7RUFDdEQsSUFBSSxDQUFDLElBQUksQ0FBQ0Msa0JBQWtCLEVBQUU7SUFDNUIsTUFBTUMsSUFBSSxHQUFHLElBQUk7SUFDakIsSUFBSSxJQUFJLENBQUNDLFVBQVUsRUFBRTtNQUNuQmpDLE9BQU8sQ0FBQ0MsSUFBSSxDQUNWLGdJQUNGLENBQUM7SUFDSDtJQUVBLElBQUksQ0FBQzhCLGtCQUFrQixHQUFHLElBQUlHLE9BQU8sQ0FBQyxDQUFDTCxPQUFPLEVBQUVDLE1BQU0sS0FBSztNQUN6REUsSUFBSSxDQUFDRyxFQUFFLENBQUMsT0FBTyxFQUFFLE1BQU07UUFDckIsSUFBSSxJQUFJLENBQUM3QixXQUFXLElBQUksSUFBSSxDQUFDQSxXQUFXLEdBQUcsSUFBSSxDQUFDQyxRQUFRLEVBQUU7VUFDeEQ7UUFDRjtRQUVBLElBQUksSUFBSSxDQUFDa0IsUUFBUSxJQUFJLElBQUksQ0FBQ0MsYUFBYSxFQUFFO1VBQ3ZDSSxNQUFNLENBQUMsSUFBSSxDQUFDSixhQUFhLENBQUM7VUFDMUI7UUFDRjtRQUVBLE1BQU1iLEtBQUssR0FBRyxJQUFJdUIsS0FBSyxDQUFDLFNBQVMsQ0FBQztRQUNsQ3ZCLEtBQUssQ0FBQ00sSUFBSSxHQUFHLFNBQVM7UUFDdEJOLEtBQUssQ0FBQ0ksTUFBTSxHQUFHLElBQUksQ0FBQ0EsTUFBTTtRQUMxQkosS0FBSyxDQUFDd0IsTUFBTSxHQUFHLElBQUksQ0FBQ0EsTUFBTTtRQUMxQnhCLEtBQUssQ0FBQ3lCLEdBQUcsR0FBRyxJQUFJLENBQUNBLEdBQUc7UUFDcEJSLE1BQU0sQ0FBQ2pCLEtBQUssQ0FBQztNQUNmLENBQUMsQ0FBQztNQUNGbUIsSUFBSSxDQUFDTyxHQUFHLENBQUMsQ0FBQzFCLEtBQUssRUFBRUMsR0FBRyxLQUFLO1FBQ3ZCLElBQUlELEtBQUssRUFBRWlCLE1BQU0sQ0FBQ2pCLEtBQUssQ0FBQyxDQUFDLEtBQ3BCZ0IsT0FBTyxDQUFDZixHQUFHLENBQUM7TUFDbkIsQ0FBQyxDQUFDO0lBQ0osQ0FBQyxDQUFDO0VBQ0o7RUFFQSxPQUFPLElBQUksQ0FBQ2lCLGtCQUFrQixDQUFDSCxJQUFJLENBQUNDLE9BQU8sRUFBRUMsTUFBTSxDQUFDO0FBQ3RELENBQUM7QUFFRHJELFdBQVcsQ0FBQ0MsU0FBUyxDQUFDOEQsS0FBSyxHQUFHLFVBQVVDLFFBQVEsRUFBRTtFQUNoRCxPQUFPLElBQUksQ0FBQ2IsSUFBSSxDQUFDYyxTQUFTLEVBQUVELFFBQVEsQ0FBQztBQUN2QyxDQUFDOztBQUVEO0FBQ0E7QUFDQTs7QUFFQWhFLFdBQVcsQ0FBQ0MsU0FBUyxDQUFDaUUsR0FBRyxHQUFHLFVBQVUzRCxFQUFFLEVBQUU7RUFDeENBLEVBQUUsQ0FBQyxJQUFJLENBQUM7RUFDUixPQUFPLElBQUk7QUFDYixDQUFDO0FBRURQLFdBQVcsQ0FBQ0MsU0FBUyxDQUFDa0UsRUFBRSxHQUFHLFVBQVVILFFBQVEsRUFBRTtFQUM3QyxJQUFJLE9BQU9BLFFBQVEsS0FBSyxVQUFVLEVBQUUsTUFBTSxJQUFJTCxLQUFLLENBQUMsbUJBQW1CLENBQUM7RUFDeEUsSUFBSSxDQUFDUyxXQUFXLEdBQUdKLFFBQVE7RUFDM0IsT0FBTyxJQUFJO0FBQ2IsQ0FBQztBQUVEaEUsV0FBVyxDQUFDQyxTQUFTLENBQUNvRSxhQUFhLEdBQUcsVUFBVWhDLEdBQUcsRUFBRTtFQUNuRCxJQUFJLENBQUNBLEdBQUcsRUFBRTtJQUNSLE9BQU8sS0FBSztFQUNkO0VBRUEsSUFBSSxJQUFJLENBQUMrQixXQUFXLEVBQUU7SUFDcEIsT0FBTyxJQUFJLENBQUNBLFdBQVcsQ0FBQy9CLEdBQUcsQ0FBQztFQUM5QjtFQUVBLE9BQU9BLEdBQUcsQ0FBQ0csTUFBTSxJQUFJLEdBQUcsSUFBSUgsR0FBRyxDQUFDRyxNQUFNLEdBQUcsR0FBRztBQUM5QyxDQUFDOztBQUVEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUF4QyxXQUFXLENBQUNDLFNBQVMsQ0FBQ3FFLEdBQUcsR0FBRyxVQUFVQyxLQUFLLEVBQUU7RUFDM0MsT0FBTyxJQUFJLENBQUNDLE9BQU8sQ0FBQ0QsS0FBSyxDQUFDRSxXQUFXLENBQUMsQ0FBQyxDQUFDO0FBQzFDLENBQUM7O0FBRUQ7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQXpFLFdBQVcsQ0FBQ0MsU0FBUyxDQUFDeUUsU0FBUyxHQUFHMUUsV0FBVyxDQUFDQyxTQUFTLENBQUNxRSxHQUFHOztBQUUzRDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBdEUsV0FBVyxDQUFDQyxTQUFTLENBQUMwRSxHQUFHLEdBQUcsVUFBVUosS0FBSyxFQUFFN0QsS0FBSyxFQUFFO0VBQ2xELElBQUlmLFFBQVEsQ0FBQzRFLEtBQUssQ0FBQyxFQUFFO0lBQ25CLEtBQUssTUFBTUssR0FBRyxJQUFJTCxLQUFLLEVBQUU7TUFDdkIsSUFBSTNFLE1BQU0sQ0FBQzJFLEtBQUssRUFBRUssR0FBRyxDQUFDLEVBQUUsSUFBSSxDQUFDRCxHQUFHLENBQUNDLEdBQUcsRUFBRUwsS0FBSyxDQUFDSyxHQUFHLENBQUMsQ0FBQztJQUNuRDtJQUVBLE9BQU8sSUFBSTtFQUNiO0VBRUEsSUFBSSxDQUFDSixPQUFPLENBQUNELEtBQUssQ0FBQ0UsV0FBVyxDQUFDLENBQUMsQ0FBQyxHQUFHL0QsS0FBSztFQUN6QyxJQUFJLENBQUNtRSxNQUFNLENBQUNOLEtBQUssQ0FBQyxHQUFHN0QsS0FBSztFQUMxQixPQUFPLElBQUk7QUFDYixDQUFDOztBQUVEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBVixXQUFXLENBQUNDLFNBQVMsQ0FBQzZFLEtBQUssR0FBRyxVQUFVUCxLQUFLLEVBQUU7RUFDN0MsT0FBTyxJQUFJLENBQUNDLE9BQU8sQ0FBQ0QsS0FBSyxDQUFDRSxXQUFXLENBQUMsQ0FBQyxDQUFDO0VBQ3hDLE9BQU8sSUFBSSxDQUFDSSxNQUFNLENBQUNOLEtBQUssQ0FBQztFQUN6QixPQUFPLElBQUk7QUFDYixDQUFDOztBQUVEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQXZFLFdBQVcsQ0FBQ0MsU0FBUyxDQUFDc0UsS0FBSyxHQUFHLFVBQVVRLElBQUksRUFBRXJFLEtBQUssRUFBRUssT0FBTyxFQUFFO0VBQzVEO0VBQ0EsSUFBSWdFLElBQUksS0FBSyxJQUFJLElBQUlkLFNBQVMsS0FBS2MsSUFBSSxFQUFFO0lBQ3ZDLE1BQU0sSUFBSXBCLEtBQUssQ0FBQyx5Q0FBeUMsQ0FBQztFQUM1RDtFQUVBLElBQUksSUFBSSxDQUFDcUIsS0FBSyxFQUFFO0lBQ2QsTUFBTSxJQUFJckIsS0FBSyxDQUNiLGlHQUNGLENBQUM7RUFDSDtFQUVBLElBQUloRSxRQUFRLENBQUNvRixJQUFJLENBQUMsRUFBRTtJQUNsQixLQUFLLE1BQU1ILEdBQUcsSUFBSUcsSUFBSSxFQUFFO01BQ3RCLElBQUluRixNQUFNLENBQUNtRixJQUFJLEVBQUVILEdBQUcsQ0FBQyxFQUFFLElBQUksQ0FBQ0wsS0FBSyxDQUFDSyxHQUFHLEVBQUVHLElBQUksQ0FBQ0gsR0FBRyxDQUFDLENBQUM7SUFDbkQ7SUFFQSxPQUFPLElBQUk7RUFDYjtFQUVBLElBQUlLLEtBQUssQ0FBQ0MsT0FBTyxDQUFDeEUsS0FBSyxDQUFDLEVBQUU7SUFDeEIsS0FBSyxNQUFNeUUsQ0FBQyxJQUFJekUsS0FBSyxFQUFFO01BQ3JCLElBQUlkLE1BQU0sQ0FBQ2MsS0FBSyxFQUFFeUUsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDWixLQUFLLENBQUNRLElBQUksRUFBRXJFLEtBQUssQ0FBQ3lFLENBQUMsQ0FBQyxDQUFDO0lBQ2xEO0lBRUEsT0FBTyxJQUFJO0VBQ2I7O0VBRUE7RUFDQSxJQUFJekUsS0FBSyxLQUFLLElBQUksSUFBSXVELFNBQVMsS0FBS3ZELEtBQUssRUFBRTtJQUN6QyxNQUFNLElBQUlpRCxLQUFLLENBQUMsd0NBQXdDLENBQUM7RUFDM0Q7RUFFQSxJQUFJLE9BQU9qRCxLQUFLLEtBQUssU0FBUyxFQUFFO0lBQzlCQSxLQUFLLEdBQUcwRSxNQUFNLENBQUMxRSxLQUFLLENBQUM7RUFDdkI7O0VBRUE7RUFDQSxJQUFJSyxPQUFPLEVBQUUsSUFBSSxDQUFDc0UsWUFBWSxDQUFDLENBQUMsQ0FBQ0MsTUFBTSxDQUFDUCxJQUFJLEVBQUVyRSxLQUFLLEVBQUVLLE9BQU8sQ0FBQyxDQUFDLEtBQ3pELElBQUksQ0FBQ3NFLFlBQVksQ0FBQyxDQUFDLENBQUNDLE1BQU0sQ0FBQ1AsSUFBSSxFQUFFckUsS0FBSyxDQUFDO0VBRTVDLE9BQU8sSUFBSTtBQUNiLENBQUM7O0FBRUQ7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0FWLFdBQVcsQ0FBQ0MsU0FBUyxDQUFDc0YsS0FBSyxHQUFHLFlBQVk7RUFDeEMsSUFBSSxJQUFJLENBQUN4QyxRQUFRLEVBQUU7SUFDakIsT0FBTyxJQUFJO0VBQ2I7RUFFQSxJQUFJLENBQUNBLFFBQVEsR0FBRyxJQUFJO0VBQ3BCLElBQUksSUFBSSxDQUFDeUMsR0FBRyxFQUFFLElBQUksQ0FBQ0EsR0FBRyxDQUFDRCxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7RUFDaEMsSUFBSSxJQUFJLENBQUMxQyxHQUFHLEVBQUU7SUFDWixJQUFJLENBQUNBLEdBQUcsQ0FBQzBDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztFQUNwQjtFQUVBLElBQUksQ0FBQ3JGLFlBQVksQ0FBQyxDQUFDO0VBQ25CLElBQUksQ0FBQ3VGLElBQUksQ0FBQyxPQUFPLENBQUM7RUFDbEIsT0FBTyxJQUFJO0FBQ2IsQ0FBQztBQUVEekYsV0FBVyxDQUFDQyxTQUFTLENBQUN5RixLQUFLLEdBQUcsVUFBVUMsSUFBSSxFQUFFQyxJQUFJLEVBQUU3RSxPQUFPLEVBQUU4RSxhQUFhLEVBQUU7RUFDMUUsUUFBUTlFLE9BQU8sQ0FBQytFLElBQUk7SUFDbEIsS0FBSyxPQUFPO01BQ1YsSUFBSSxDQUFDbkIsR0FBRyxDQUFDLGVBQWUsRUFBRSxTQUFTa0IsYUFBYSxDQUFDLEdBQUdGLElBQUksSUFBSUMsSUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDO01BQ3RFO0lBRUYsS0FBSyxNQUFNO01BQ1QsSUFBSSxDQUFDRyxRQUFRLEdBQUdKLElBQUk7TUFDcEIsSUFBSSxDQUFDSyxRQUFRLEdBQUdKLElBQUk7TUFDcEI7SUFFRixLQUFLLFFBQVE7TUFBRTtNQUNiLElBQUksQ0FBQ2pCLEdBQUcsQ0FBQyxlQUFlLEVBQUUsVUFBVWdCLElBQUksRUFBRSxDQUFDO01BQzNDO0lBQ0Y7TUFDRTtFQUNKO0VBRUEsT0FBTyxJQUFJO0FBQ2IsQ0FBQzs7QUFFRDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBM0YsV0FBVyxDQUFDQyxTQUFTLENBQUNnRyxlQUFlLEdBQUcsVUFBVXZDLEVBQUUsRUFBRTtFQUNwRDtFQUNBLElBQUlBLEVBQUUsS0FBS08sU0FBUyxFQUFFUCxFQUFFLEdBQUcsSUFBSTtFQUMvQixJQUFJLENBQUN3QyxnQkFBZ0IsR0FBR3hDLEVBQUU7RUFDMUIsT0FBTyxJQUFJO0FBQ2IsQ0FBQzs7QUFFRDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTFELFdBQVcsQ0FBQ0MsU0FBUyxDQUFDa0csU0FBUyxHQUFHLFVBQVVDLENBQUMsRUFBRTtFQUM3QyxJQUFJLENBQUNDLGFBQWEsR0FBR0QsQ0FBQztFQUN0QixPQUFPLElBQUk7QUFDYixDQUFDOztBQUVEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0FwRyxXQUFXLENBQUNDLFNBQVMsQ0FBQ3FHLGVBQWUsR0FBRyxVQUFVRixDQUFDLEVBQUU7RUFDbkQsSUFBSSxPQUFPQSxDQUFDLEtBQUssUUFBUSxFQUFFO0lBQ3pCLE1BQU0sSUFBSUcsU0FBUyxDQUFDLGtCQUFrQixDQUFDO0VBQ3pDO0VBRUEsSUFBSSxDQUFDQyxnQkFBZ0IsR0FBR0osQ0FBQztFQUN6QixPQUFPLElBQUk7QUFDYixDQUFDOztBQUVEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUFwRyxXQUFXLENBQUNDLFNBQVMsQ0FBQ3dHLE1BQU0sR0FBRyxZQUFZO0VBQ3pDLE9BQU87SUFDTDdDLE1BQU0sRUFBRSxJQUFJLENBQUNBLE1BQU07SUFDbkJDLEdBQUcsRUFBRSxJQUFJLENBQUNBLEdBQUc7SUFDYjZDLElBQUksRUFBRSxJQUFJLENBQUMxQixLQUFLO0lBQ2hCMkIsT0FBTyxFQUFFLElBQUksQ0FBQ25DO0VBQ2hCLENBQUM7QUFDSCxDQUFDOztBQUVEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBeEUsV0FBVyxDQUFDQyxTQUFTLENBQUMyRyxJQUFJLEdBQUcsVUFBVUYsSUFBSSxFQUFFO0VBQzNDLE1BQU1HLFNBQVMsR0FBR2xILFFBQVEsQ0FBQytHLElBQUksQ0FBQztFQUNoQyxJQUFJWixJQUFJLEdBQUcsSUFBSSxDQUFDdEIsT0FBTyxDQUFDLGNBQWMsQ0FBQztFQUV2QyxJQUFJLElBQUksQ0FBQ3NDLFNBQVMsRUFBRTtJQUNsQixNQUFNLElBQUluRCxLQUFLLENBQ2IsOEdBQ0YsQ0FBQztFQUNIO0VBRUEsSUFBSWtELFNBQVMsSUFBSSxDQUFDLElBQUksQ0FBQzdCLEtBQUssRUFBRTtJQUM1QixJQUFJQyxLQUFLLENBQUNDLE9BQU8sQ0FBQ3dCLElBQUksQ0FBQyxFQUFFO01BQ3ZCLElBQUksQ0FBQzFCLEtBQUssR0FBRyxFQUFFO0lBQ2pCLENBQUMsTUFBTSxJQUFJLENBQUMsSUFBSSxDQUFDK0IsT0FBTyxDQUFDTCxJQUFJLENBQUMsRUFBRTtNQUM5QixJQUFJLENBQUMxQixLQUFLLEdBQUcsQ0FBQyxDQUFDO0lBQ2pCO0VBQ0YsQ0FBQyxNQUFNLElBQUkwQixJQUFJLElBQUksSUFBSSxDQUFDMUIsS0FBSyxJQUFJLElBQUksQ0FBQytCLE9BQU8sQ0FBQyxJQUFJLENBQUMvQixLQUFLLENBQUMsRUFBRTtJQUN6RCxNQUFNLElBQUlyQixLQUFLLENBQUMsOEJBQThCLENBQUM7RUFDakQ7O0VBRUE7RUFDQSxJQUFJa0QsU0FBUyxJQUFJbEgsUUFBUSxDQUFDLElBQUksQ0FBQ3FGLEtBQUssQ0FBQyxFQUFFO0lBQ3JDLEtBQUssTUFBTUosR0FBRyxJQUFJOEIsSUFBSSxFQUFFO01BQ3RCLElBQUksT0FBT0EsSUFBSSxDQUFDOUIsR0FBRyxDQUFDLElBQUksUUFBUSxJQUFJLENBQUM4QixJQUFJLENBQUM5QixHQUFHLENBQUMsQ0FBQzZCLE1BQU0sRUFDbkQsTUFBTSxJQUFJOUMsS0FBSyxDQUFDLHVDQUF1QyxDQUFDO01BQzFELElBQUkvRCxNQUFNLENBQUM4RyxJQUFJLEVBQUU5QixHQUFHLENBQUMsRUFBRSxJQUFJLENBQUNJLEtBQUssQ0FBQ0osR0FBRyxDQUFDLEdBQUc4QixJQUFJLENBQUM5QixHQUFHLENBQUM7SUFDcEQ7RUFDRixDQUFDLE1BQ0ksSUFBSSxPQUFPOEIsSUFBSSxLQUFLLFFBQVEsRUFBRSxNQUFNLElBQUkvQyxLQUFLLENBQUMsa0NBQWtDLENBQUMsQ0FBQyxLQUNsRixJQUFJLE9BQU8rQyxJQUFJLEtBQUssUUFBUSxFQUFFO0lBQ2pDO0lBQ0EsSUFBSSxDQUFDWixJQUFJLEVBQUUsSUFBSSxDQUFDQSxJQUFJLENBQUMsTUFBTSxDQUFDO0lBQzVCQSxJQUFJLEdBQUcsSUFBSSxDQUFDdEIsT0FBTyxDQUFDLGNBQWMsQ0FBQztJQUNuQyxJQUFJc0IsSUFBSSxFQUFFQSxJQUFJLEdBQUdBLElBQUksQ0FBQ3JCLFdBQVcsQ0FBQyxDQUFDLENBQUN1QyxJQUFJLENBQUMsQ0FBQztJQUMxQyxJQUFJbEIsSUFBSSxLQUFLLG1DQUFtQyxFQUFFO01BQ2hELElBQUksQ0FBQ2QsS0FBSyxHQUFHLElBQUksQ0FBQ0EsS0FBSyxHQUFHLEdBQUcsSUFBSSxDQUFDQSxLQUFLLElBQUkwQixJQUFJLEVBQUUsR0FBR0EsSUFBSTtJQUMxRCxDQUFDLE1BQU07TUFDTCxJQUFJLENBQUMxQixLQUFLLEdBQUcsQ0FBQyxJQUFJLENBQUNBLEtBQUssSUFBSSxFQUFFLElBQUkwQixJQUFJO0lBQ3hDO0VBQ0YsQ0FBQyxNQUFNO0lBQ0wsSUFBSSxDQUFDMUIsS0FBSyxHQUFHMEIsSUFBSTtFQUNuQjtFQUVBLElBQUksQ0FBQ0csU0FBUyxJQUFJLElBQUksQ0FBQ0UsT0FBTyxDQUFDTCxJQUFJLENBQUMsRUFBRTtJQUNwQyxPQUFPLElBQUk7RUFDYjs7RUFFQTtFQUNBLElBQUksQ0FBQ1osSUFBSSxFQUFFLElBQUksQ0FBQ0EsSUFBSSxDQUFDLE1BQU0sQ0FBQztFQUM1QixPQUFPLElBQUk7QUFDYixDQUFDOztBQUVEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTlGLFdBQVcsQ0FBQ0MsU0FBUyxDQUFDZ0gsU0FBUyxHQUFHLFVBQVVDLElBQUksRUFBRTtFQUNoRDtFQUNBLElBQUksQ0FBQ0MsS0FBSyxHQUFHLE9BQU9ELElBQUksS0FBSyxXQUFXLEdBQUcsSUFBSSxHQUFHQSxJQUFJO0VBQ3RELE9BQU8sSUFBSTtBQUNiLENBQUM7O0FBRUQ7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBbEgsV0FBVyxDQUFDQyxTQUFTLENBQUNtSCxvQkFBb0IsR0FBRyxZQUFZO0VBQ3ZELE1BQU1DLEtBQUssR0FBRyxJQUFJLENBQUNDLE1BQU0sQ0FBQ0MsSUFBSSxDQUFDLEdBQUcsQ0FBQztFQUNuQyxJQUFJRixLQUFLLEVBQUU7SUFDVCxJQUFJLENBQUN4RCxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUNBLEdBQUcsQ0FBQzJELFFBQVEsQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLEdBQUcsR0FBRyxJQUFJSCxLQUFLO0VBQzFEO0VBRUEsSUFBSSxDQUFDQyxNQUFNLENBQUMxRixNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUM7O0VBRXhCLElBQUksSUFBSSxDQUFDdUYsS0FBSyxFQUFFO0lBQ2QsTUFBTU0sS0FBSyxHQUFHLElBQUksQ0FBQzVELEdBQUcsQ0FBQzZELE9BQU8sQ0FBQyxHQUFHLENBQUM7SUFDbkMsSUFBSUQsS0FBSyxJQUFJLENBQUMsRUFBRTtNQUNkLE1BQU1FLFVBQVUsR0FBRyxJQUFJLENBQUM5RCxHQUFHLENBQUMrRCxLQUFLLENBQUNILEtBQUssR0FBRyxDQUFDLENBQUMsQ0FBQ0ksS0FBSyxDQUFDLEdBQUcsQ0FBQztNQUN2RCxJQUFJLE9BQU8sSUFBSSxDQUFDVixLQUFLLEtBQUssVUFBVSxFQUFFO1FBQ3BDUSxVQUFVLENBQUNULElBQUksQ0FBQyxJQUFJLENBQUNDLEtBQUssQ0FBQztNQUM3QixDQUFDLE1BQU07UUFDTFEsVUFBVSxDQUFDVCxJQUFJLENBQUMsQ0FBQztNQUNuQjtNQUVBLElBQUksQ0FBQ3JELEdBQUcsR0FBRyxJQUFJLENBQUNBLEdBQUcsQ0FBQytELEtBQUssQ0FBQyxDQUFDLEVBQUVILEtBQUssQ0FBQyxHQUFHLEdBQUcsR0FBR0UsVUFBVSxDQUFDSixJQUFJLENBQUMsR0FBRyxDQUFDO0lBQ2xFO0VBQ0Y7QUFDRixDQUFDOztBQUVEO0FBQ0F2SCxXQUFXLENBQUNDLFNBQVMsQ0FBQzZILGtCQUFrQixHQUFHLE1BQU07RUFDL0N2RyxPQUFPLENBQUNDLElBQUksQ0FBQyxhQUFhLENBQUM7QUFDN0IsQ0FBQzs7QUFFRDtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBeEIsV0FBVyxDQUFDQyxTQUFTLENBQUM4SCxhQUFhLEdBQUcsVUFBVUMsTUFBTSxFQUFFbEgsT0FBTyxFQUFFbUgsS0FBSyxFQUFFO0VBQ3RFLElBQUksSUFBSSxDQUFDbEYsUUFBUSxFQUFFO0lBQ2pCO0VBQ0Y7RUFFQSxNQUFNWCxLQUFLLEdBQUcsSUFBSXVCLEtBQUssQ0FBQyxHQUFHcUUsTUFBTSxHQUFHbEgsT0FBTyxhQUFhLENBQUM7RUFDekRzQixLQUFLLENBQUN0QixPQUFPLEdBQUdBLE9BQU87RUFDdkJzQixLQUFLLENBQUNNLElBQUksR0FBRyxjQUFjO0VBQzNCTixLQUFLLENBQUM2RixLQUFLLEdBQUdBLEtBQUs7RUFDbkIsSUFBSSxDQUFDakYsUUFBUSxHQUFHLElBQUk7RUFDcEIsSUFBSSxDQUFDQyxhQUFhLEdBQUdiLEtBQUs7RUFDMUIsSUFBSSxDQUFDbUQsS0FBSyxDQUFDLENBQUM7RUFDWixJQUFJLENBQUN2QixRQUFRLENBQUM1QixLQUFLLENBQUM7QUFDdEIsQ0FBQztBQUVEcEMsV0FBVyxDQUFDQyxTQUFTLENBQUNpSSxZQUFZLEdBQUcsWUFBWTtFQUMvQyxNQUFNM0UsSUFBSSxHQUFHLElBQUk7O0VBRWpCO0VBQ0EsSUFBSSxJQUFJLENBQUN2QyxRQUFRLElBQUksQ0FBQyxJQUFJLENBQUNiLE1BQU0sRUFBRTtJQUNqQyxJQUFJLENBQUNBLE1BQU0sR0FBR2dJLFVBQVUsQ0FBQyxNQUFNO01BQzdCNUUsSUFBSSxDQUFDd0UsYUFBYSxDQUFDLGFBQWEsRUFBRXhFLElBQUksQ0FBQ3ZDLFFBQVEsRUFBRSxPQUFPLENBQUM7SUFDM0QsQ0FBQyxFQUFFLElBQUksQ0FBQ0EsUUFBUSxDQUFDO0VBQ25COztFQUVBO0VBQ0EsSUFBSSxJQUFJLENBQUNDLGdCQUFnQixJQUFJLENBQUMsSUFBSSxDQUFDYixxQkFBcUIsRUFBRTtJQUN4RCxJQUFJLENBQUNBLHFCQUFxQixHQUFHK0gsVUFBVSxDQUFDLE1BQU07TUFDNUM1RSxJQUFJLENBQUN3RSxhQUFhLENBQ2hCLHNCQUFzQixFQUN0QnhFLElBQUksQ0FBQ3RDLGdCQUFnQixFQUNyQixXQUNGLENBQUM7SUFDSCxDQUFDLEVBQUUsSUFBSSxDQUFDQSxnQkFBZ0IsQ0FBQztFQUMzQjtBQUNGLENBQUMiLCJpZ25vcmVMaXN0IjpbXX0=
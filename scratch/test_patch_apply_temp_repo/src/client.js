/**
 * Root reference for iframes.
 */

let root;
if (typeof window !== 'undefined') {
  // Browser window
  root = window;
} else if (typeof self === 'undefined') {
  // Other environments
  console.warn(
    'Using browser-only version of superagent in non-browser environment'
  );
  root = this;
} else {
  // Web Worker
  root = self;
}

const Emitter = require('component-emitter');
const safeStringify = require('fast-safe-stringify');
const qs = require('qs');
const RequestBase = require('./request-base');
const { isObject, mixin, hasOwn } = require('./utils');
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

const trim = ''.trim ? (s) => s.trim() : (s) => s.replace(/(^\s*|\s*$)/g, '');

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
      if (hasOwn(value, subkey))
        pushEncodedKeyValuePair(pairs, `${key}[${subkey}]`, value[subkey]);
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
      object[decodeURIComponent(pair.slice(0, pos))] = decodeURIComponent(
        pair.slice(pos + 1)
      );
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
  'application/x-www-form-urlencoded': (obj) => {
    return qs.stringify(obj, { indices: false, strictNullHandling: true });
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
  this.text =
    (this.req.method !== 'HEAD' &&
      (this.xhr.responseType === '' || this.xhr.responseType === 'text')) ||
    typeof this.xhr.responseType === 'undefined'
      ? this.xhr.responseText
      : null;
  this.statusText = this.req.xhr.statusText;
  let { status } = this.xhr;
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

  if (this.req._forcedArrayBufferForSize) {
    const isBuffer = typeof Buffer !== 'undefined' && Buffer.isBuffer(this.xhr.response);
    const isArrayBuffer = typeof ArrayBuffer !== 'undefined' && this.xhr.response instanceof ArrayBuffer;
    const isView = typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(this.xhr.response);

    if (isBuffer || isArrayBuffer || isView) {
      let charset = 'utf-8';
      const match = this.header['content-type'] ? /charset\s*=\s*['"]?([^;'"]+)['"]?/i.exec(this.header['content-type']) : null;
      if (match) charset = match[1].trim().toLowerCase();

      let text = '';
      const TextDecoderClass = typeof TextDecoder !== 'undefined'
        ? TextDecoder
        : (function () {
            try {
              return require('util').TextDecoder;
            } catch (_) {
              return null;
            }
          })();

      if (TextDecoderClass) {
        try {
          text = new TextDecoderClass(charset, { fatal: false }).decode(this.xhr.response);
        } catch (e) {
          text = new TextDecoderClass('utf-8').decode(this.xhr.response);
        }
      } else {
        const bytes = new Uint8Array(isBuffer || isView ? this.xhr.response.buffer : this.xhr.response);
        for (let i = 0; i < bytes.length; i++) {
          text += String.fromCharCode(bytes[i]);
        }
        try {
          text = decodeURIComponent(escape(text));
        } catch (e) {
          // Ignore
        }
      }
      this.text = text;
      try {
        Object.defineProperty(this.xhr, 'responseText', {
          get() { return text; },
          configurable: true
        });
        if (this.req._responseType === 'json') {
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch (_) {
            parsed = null;
          }
          Object.defineProperty(this.xhr, 'response', {
            get() { return parsed; },
            configurable: true
          });
        } else if (this.req._responseType === 'document') {
          let parsedDoc = null;
          try {
            if (typeof DOMParser !== 'undefined') {
              const ct = this.header['content-type'] || '';
              const docType = ct.includes('html') ? 'text/html' : 'application/xml';
              parsedDoc = new DOMParser().parseFromString(text, docType);
            }
          } catch (_) {
            parsedDoc = null;
          }
          Object.defineProperty(this.xhr, 'response', {
            get() { return parsedDoc; },
            configurable: true
          });
        } else if (this.req._responseType === 'text' || !this.req._responseType) {
          Object.defineProperty(this.xhr, 'response', {
            get() { return text; },
            configurable: true
          });
        }
        const requestedType = this.req._responseType || '';
        Object.defineProperty(this.xhr, 'responseType', {
          get() { return requestedType; },
          configurable: true
        });
      } catch (_) {
        // Ignore
      }
    } else {
      this.text = this.xhr.responseText !== undefined ? this.xhr.responseText : (typeof this.xhr.response === 'string' ? this.xhr.response : null);
    }
  } else {
    this.text =
      (this.req.method !== 'HEAD' &&
        (this.xhr.responseType === '' || this.xhr.responseType === 'text')) ||
      typeof this.xhr.responseType === 'undefined'
        ? this.xhr.responseText
        : null;
  }

  if (this.req._responseType === 'json' || this.req._responseType === 'document') {
    this.body = this.xhr.response;
  } else if (this.text === null && (request_._responseType || (this.xhr.responseType && this.xhr.responseType !== 'text'))) {
    this.body = this.xhr.response;
  } else {
    this.body =
      this.req.method === 'HEAD'
        ? null
        : this._parseBody(this.text ? this.text : this.xhr.response);
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

  return parse && string_ && (string_.length > 0 || string_ instanceof Object)
    ? parse(string_)
    : null;
};

/**
 * Return an `Error` representative of this response.
 *
 * @return {Error}
 * @api public
 */

Response.prototype.toError = function () {
  const { req } = this;
  const { method } = req;
  const { url } = req;

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


/**
 * Calculate UTF-8 byte length for string data in the browser.
 *
 * @param {String} val
 * @return {Number} byte length
 * @api private
 */
function getUtf8ByteLength(val) {
  if (val == null) return 0;
  const str = typeof val === 'string' ? val : String(val);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length;
  }
  try {
    return unescape(encodeURIComponent(str)).length;
  } catch (_) {
    return str.length;
  }
}

/**
 * Generate a high-entropy random multipart boundary string.
 * Uses crypto.getRandomValues if available, falling back to Math.random.
 *
 * @return {String}
 * @api private
 */
function generateMultipartBoundary() {
  let rand = '';
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++) {
      rand += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    }
  } else {
    for (let i = 0; i < 4; i++) {
      rand += Math.floor((1 + Math.random()) * 0x100000000).toString(16).substring(1);
    }
  }
  return '----superagentboundary' + rand.toLowerCase();
}

/**
 * Cross-realm-safe brand check for Blob or File instances.
 *
 * @param {Mixed} val
 * @return {Boolean}
 * @api private
 */
function isBlobOrFile(val) {
  if (!val || typeof val !== 'object') return false;
  if (typeof Blob !== 'undefined' && val instanceof Blob) return true;
  if (typeof File !== 'undefined' && val instanceof File) return true;
  const tag = Object.prototype.toString.call(val);
  return (
    tag === '[object Blob]' ||
    tag === '[object File]' ||
    (typeof val.size === 'number' && typeof val.slice === 'function')
  );
}

/**
 * Serialize a browser FormData instance into an exact Blob to determine its
 * byte length and transmit the exact matching multipart boundary over the wire.
 * Uses a unique high-entropy boundary per serialized payload to prevent collision
 * or deterministic body corruption.
 *
 * Returns the Blob, or undefined when enumeration fails.
 *
 * @param {FormData} fd
 * @return {Blob|undefined}
 * @api private
 */
function buildFormDataBlob(fd, req) {
  const BOUNDARY = generateMultipartBoundary();
  const CRLF = '\r\n';
  const parts = [];

  const escapeHeaderParam = (s) =>
    String(s)
      .replace(/\r/g, '%0D')
      .replace(/\n/g, '%0A')
      .replace(/"/g, '%22');
  const normalizeLineEndings = (s) => String(s).replace(/(?:\r\n|\r|\n)/g, CRLF);

  try {
    let entries;
    if (fd && typeof fd.entries === 'function') {
      entries = [];
      const iter = fd.entries();
      let curr = iter.next();
      while (!curr.done) {
        entries.push(curr.value);
        curr = iter.next();
      }
    } else if (fd && typeof fd.forEach === 'function') {
      entries = [];
      fd.forEach((value, name) => entries.push([name, value]));
    } else if (fd && Array.isArray(fd._entries)) {
      entries = fd._entries.slice();
    } else if (fd && Array.isArray(fd._parts)) {
      entries = fd._parts.slice();
    } else if (fd && Array.isArray(fd._fields)) {
      entries = fd._fields.slice();
    } else if (req && Array.isArray(req._formFields) && req._formFields.length > 0) {
      entries = req._formFields.slice();
    } else {
      return undefined;
    }

    for (const [name, value] of entries) {
      parts.push('--' + BOUNDARY + CRLF);
      const eName = escapeHeaderParam(name);
      if (isBlobOrFile(value)) {
        const fileName = escapeHeaderParam(value.name || 'blob');
        const mimeType = (value.type || 'application/octet-stream');
        parts.push(
          'Content-Disposition: form-data; name="' + eName + '"; filename="' + fileName + '"' + CRLF +
          'Content-Type: ' + mimeType + CRLF + CRLF
        );
        parts.push(value); // Retain original Blob/File directly (cross-realm safe, zero allocation)
        parts.push(CRLF);
      } else {
        parts.push('Content-Disposition: form-data; name="' + eName + '"' + CRLF + CRLF);
        parts.push(normalizeLineEndings(value == null ? '' : String(value)));
        parts.push(CRLF);
      }
    }
    parts.push('--' + BOUNDARY + '--' + CRLF);

    const contentType = 'multipart/form-data; boundary=' + BOUNDARY;
    if (typeof Blob !== 'undefined') {
      try {
        const blob = new Blob(parts, { type: contentType });
        blob.contentType = contentType;
        return blob;
      } catch (_) {
        // ignore
      }
    }

    const BlobBuilder =
      (typeof window !== 'undefined' && (window.BlobBuilder || window.WebKitBlobBuilder || window.MozBlobBuilder || window.MSBlobBuilder)) ||
      (typeof global !== 'undefined' && (global.BlobBuilder || global.WebKitBlobBuilder || global.MozBlobBuilder || global.MSBlobBuilder));
    if (BlobBuilder) {
      try {
        const bb = new BlobBuilder();
        for (let i = 0; i < parts.length; i++) {
          bb.append(parts[i]);
        }
        const blob = bb.getBlob(contentType);
        if (blob) {
          blob.contentType = contentType;
          return blob;
        }
      } catch (_) {
        // ignore
      }
    }
    return undefined;
  } catch (_) {
    // Ignore enumeration error and return undefined
    return undefined;
  }
}

/**
 * Compute the multipart framing byte size of a FormData instance without requiring Blob.
 * Used when Blob construction is unavailable or fails, ensuring preflight maxRequestSize
 * enforcement before xhr.send() transmits an oversized payload.
 *
 * @param {FormData|Object} fd
 * @param {Request} [req]
 * @return {Number}
 * @api private
 */
function computeFormDataSize(fd, req) {
  const BOUNDARY = generateMultipartBoundary();
  const CRLF = '\r\n';

  const escapeHeaderParam = (s) =>
    String(s)
      .replace(/\r/g, '%0D')
      .replace(/\n/g, '%0A')
      .replace(/"/g, '%22');
  const normalizeLineEndings = (s) => String(s).replace(/(?:\r\n|\r|\n)/g, CRLF);

  let entries = [];
  try {
    if (fd && typeof fd.entries === 'function') {
      const iter = fd.entries();
      let curr = iter.next();
      while (!curr.done) {
        entries.push(curr.value);
        curr = iter.next();
      }
    } else if (fd && typeof fd.forEach === 'function') {
      fd.forEach((value, name) => entries.push([name, value]));
    } else if (fd && Array.isArray(fd._entries)) {
      entries = fd._entries.slice();
    } else if (fd && Array.isArray(fd._parts)) {
      entries = fd._parts.slice();
    } else if (fd && Array.isArray(fd._fields)) {
      entries = fd._fields.slice();
    }
  } catch (_) {
    // ignore
  }

  if (entries.length === 0 && req && Array.isArray(req._formFields) && req._formFields.length > 0) {
    entries = req._formFields.slice();
  }

  if (entries.length === 0) {
    const isKnownEnumerable = (
      (fd && (typeof fd.entries === 'function' || typeof fd.forEach === 'function')) ||
      (req && req._formData === fd)
    );
    if (!isKnownEnumerable) {
      // Externally supplied native FormData without inspection APIs:
      // Size cannot be verified before sending. Fail safely when a request limit is configured.
      if (req && req._maxRequestSize !== undefined) {
        return req._maxRequestSize + 1;
      }
      return undefined;
    }
  }

  const boundaryLineBytes = 2 + BOUNDARY.length + 2; // '--' + BOUNDARY + '\r\n'
  const closingBoundaryBytes = 2 + BOUNDARY.length + 4; // '--' + BOUNDARY + '--\r\n'
  let totalBytes = 0;

  for (const [name, value] of entries) {
    totalBytes += boundaryLineBytes;
    const eName = escapeHeaderParam(name);
    if (isBlobOrFile(value)) {
      const fileName = escapeHeaderParam(value.name || 'blob');
      const mimeType = value.type || 'application/octet-stream';
      const headerStr =
        'Content-Disposition: form-data; name="' +
        eName +
        '"; filename="' +
        fileName +
        '"' +
        CRLF +
        'Content-Type: ' +
        mimeType +
        CRLF +
        CRLF;
      totalBytes += getUtf8ByteLength(headerStr);
      let valueSize = 0;
      if (typeof value.size === 'number') {
        valueSize = value.size;
      } else if (typeof value.byteLength === 'number') {
        valueSize = value.byteLength;
      } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
        valueSize = value.length;
      } else if (typeof value === 'string') {
        valueSize = getUtf8ByteLength(value);
      }
      totalBytes += valueSize;
      totalBytes += 2; // CRLF after value
    } else {
      const headerStr =
        'Content-Disposition: form-data; name="' + eName + '"' + CRLF + CRLF;
      totalBytes += getUtf8ByteLength(headerStr);
      const normalizedStr = normalizeLineEndings(
        value == null ? '' : String(value)
      );
      totalBytes += getUtf8ByteLength(normalizedStr);
      totalBytes += 2; // CRLF after value
    }
  }

  totalBytes += closingBoundaryBytes;
  return totalBytes;
}

/**
 * Compute the byte size of an outgoing request payload in the browser.
 * Strictly used for outgoing request bodies - never for incoming responses.
 *
 * @param {Mixed} data
 * @param {Request} [req]
 * @return {Number|undefined}
 * @api private
 */
function getRequestBodySize(data, req) {
  const targetData = data !== undefined ? data : (req && req._formData);
  if (targetData == null) return 0;

  if (typeof targetData === 'string') {
    return getUtf8ByteLength(targetData);
  }
  if (targetData instanceof ArrayBuffer) return targetData.byteLength;
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(targetData)) {
    return targetData.byteLength;
  }
  if (isBlobOrFile(targetData)) {
    return targetData.size;
  }
  if (
    (typeof URLSearchParams !== 'undefined' && targetData instanceof URLSearchParams) ||
    (targetData && typeof targetData === 'object' && (
      (typeof Symbol !== 'undefined' && Symbol.toStringTag && targetData[Symbol.toStringTag] === 'URLSearchParams') ||
      (targetData.constructor && targetData.constructor.name === 'URLSearchParams')
    ))
  ) {
    return getUtf8ByteLength(targetData.toString());
  }
  if (typeof Document !== 'undefined' && targetData instanceof Document) {
    return getUtf8ByteLength(new XMLSerializer().serializeToString(targetData));
  }
  if (typeof targetData === 'object' && typeof targetData.byteLength === 'number') {
    return targetData.byteLength;
  }
  if (typeof targetData === 'object' && typeof targetData.size === 'number') {
    return targetData.size;
  }

  // Unified FormData detection: handles both external .send(formData) and internal .field()/.attach()
  if (
    (typeof FormData !== 'undefined' && targetData instanceof FormData) ||
    (targetData && typeof targetData === 'object' && (
      Object.prototype.toString.call(targetData) === '[object FormData]' ||
      (typeof Symbol !== 'undefined' && Symbol.toStringTag && targetData[Symbol.toStringTag] === 'FormData') ||
      (targetData.constructor && targetData.constructor.name === 'FormData') ||
      typeof targetData.append === 'function'
    ))
  ) {
    let blob;
    try {
      blob = buildFormDataBlob(targetData, req);
    } catch (_) {
      // ignore
    }
    if (blob && typeof blob.size === 'number') {
      return blob.size;
    }
    // Fallback: Compute multipart framing byte size without requiring Blob
    return computeFormDataSize(targetData, req);
  }

  return undefined;
}

/**
 * Compute the intrinsic byte size of a decoded binary response body in the browser.
 * For binary types (ArrayBuffer, Blob, typed arrays), this derives
 * the exact in-memory decoded byte count so terminal responses are always checked.
 *
 * @param {Mixed} data
 * @return {Number|undefined}
 * @api private
 */
function getResponseIntrinsicByteLength(data) {
  if (data == null) return undefined;
  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) return data.byteLength;
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(data)) {
    return data.byteLength;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
    return data.length;
  }
  if (isBlobOrFile(data)) {
    return data.size;
  }
  if (typeof Document !== 'undefined' && data instanceof Document) {
    try {
      return getUtf8ByteLength(new XMLSerializer().serializeToString(data));
    } catch (_) {
      return undefined;
    }
  }
  if (typeof data === 'object') {
    if (typeof data.byteLength === 'number') return data.byteLength;
    if (typeof data.size === 'number') return data.size;
    try {
      return getUtf8ByteLength(JSON.stringify(data));
    } catch (_) {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Extract raw response entity byte size from standard documented XHR properties.
 *
 * @param {XMLHttpRequest} [xhr]
 * @return {Number|undefined}
 * @api private
 */
function getRawXhrByteLength(xhr) {
  if (!xhr) return undefined;
  return getResponseIntrinsicByteLength(xhr.response);
}


/**
 * Determine if an XMLHttpRequest is same-origin with the current document/context.
 * Returns false when origin information is unavailable, treating compression
 * exposure as unknown without guessing from URL text.
 *
 * @param {XMLHttpRequest} xhr
 * @param {String} requestUrl
 * @return {Boolean}
 * @api private
 */
function isSameOriginRequest(xhr, requestUrl) {
  try {
    const loc = (typeof window !== 'undefined' && window.location) || (typeof location !== 'undefined' && location);
    if (!loc || !loc.origin || loc.origin === 'null') {
      return false;
    }

    const target = (xhr && xhr.responseURL) ? xhr.responseURL : (requestUrl || '');
    if (!target) {
      return false;
    }

    let targetOrigin;
    if (typeof URL === 'function') {
      targetOrigin = new URL(target, loc.origin).origin;
    } else if (typeof document !== 'undefined' && document.createElement) {
      const a = document.createElement('a');
      a.href = target;
      targetOrigin = a.origin || `${a.protocol}//${a.host}`;
    }

    return targetOrigin === loc.origin;
  } catch (_) {
    return false;
  }
}

/**
 * Determine if a target URL is same-origin with the source URL (or current location).
 * Used for redirect credential sanitization (e.g. 305 redirects).
 *
 * @param {String} targetUrl
 * @param {String} [sourceUrl]
 * @return {Boolean}
 * @api private
 */
function isSameOriginUrl(targetUrl, sourceUrl) {
  try {
    const loc = (typeof window !== 'undefined' && window.location) || (typeof location !== 'undefined' && location);
    let baseOrigin = (loc && loc.origin && loc.origin !== 'null') ? loc.origin : 'http://localhost';

    if (sourceUrl) {
      if (typeof URL === 'function') {
        baseOrigin = new URL(sourceUrl, baseOrigin).origin;
      }
    }

    if (!targetUrl) return false;
    let targetOrigin;
    if (typeof URL === 'function') {
      targetOrigin = new URL(targetUrl, baseOrigin).origin;
    } else if (typeof document !== 'undefined' && document.createElement) {
      const a = document.createElement('a');
      a.href = targetUrl;
      targetOrigin = a.origin || `${a.protocol}//${a.host}`;
    }

    return targetOrigin === baseOrigin;
  } catch (_) {
    return false;
  }
}

/**
 * Calculate byte length of decoded text in ISO-2022-JP stateful encoding (RFC 1468).
 * Switches between ASCII mode, JIS X 0201 Roman mode, and JIS X 0208 mode:
 * - Entering JIS X 0201 Roman mode: ESC ( J (3 bytes)
 *   In Roman mode, Yen U+00A5 (0x5C) and Overline U+203E (0x7E) are 1 byte each.
 * - Entering JIS X 0208 mode: ESC $ B (3 bytes)
 *   Each Japanese character in JIS mode is 2 bytes.
 * - Entering ASCII mode / return to ASCII: ESC ( B (3 bytes)
 *   ASCII characters (<= 0x7F) are 1 byte each in ASCII mode.
 *
 * @param {String} str
 * @return {Number} byte length
 * @api private
 */
function getIso2022JpByteLength(str) {
  const STATE_ASCII = 0;
  const STATE_ROMAN = 1;
  const STATE_JIS = 2;

  let count = 0;
  let state = STATE_ASCII;

  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 0x00a5 || code === 0x203e) {
      if (state !== STATE_ROMAN) {
        count += 3; // ESC ( J to enter JIS X 0201 Roman mode
        state = STATE_ROMAN;
      }
      count += 1;
    } else if (code <= 0x7f) {
      if (state !== STATE_ASCII) {
        count += 3; // ESC ( B to enter ASCII mode
        state = STATE_ASCII;
      }
      count += 1;
    } else {
      if (state !== STATE_JIS) {
        count += 3; // ESC $ B to enter JIS X 0208 mode
        state = STATE_JIS;
      }
      count += 2;
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length && str.charCodeAt(i + 1) >= 0xdc00 && str.charCodeAt(i + 1) <= 0xdfff) {
        i++;
      }
    }
  }

  if (state !== STATE_ASCII) {
    count += 3; // Return to ASCII mode at end of stream (ESC ( B)
  }

  return count;
}

/**
 * Calculate byte length of decoded text in HZ-GB-2312 encoding (RFC 1843).
 * Stateful 7-bit ASCII transport encoding:
 * - ASCII mode: 1 byte per ASCII char; literal tilde is ~~ (2 bytes)
 * - Chinese mode: entered with ~{ (2 bytes), exited with ~} (2 bytes);
 *   each CJK character is 2 bytes
 *
 * @param {String} str
 * @return {Number} byte length
 * @api private
 */
function getHzGb2312ByteLength(str) {
  let count = 0;
  let inChinese = false;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 0x7e) {
      if (inChinese) {
        count += 2; // ~} to exit Chinese mode
        inChinese = false;
      }
      count += 2; // ~~
    } else if (code <= 0x7f) {
      if (inChinese) {
        count += 2; // ~} to exit Chinese mode
        inChinese = false;
      }
      count += 1;
    } else {
      if (!inChinese) {
        count += 2; // ~{ to enter Chinese mode
        inChinese = true;
      }
      count += 2;
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length && str.charCodeAt(i + 1) >= 0xdc00 && str.charCodeAt(i + 1) <= 0xdfff) {
        i++;
      }
    }
  }
  if (inChinese) {
    count += 2; // ~} to close Chinese mode
  }
  return count;
}

const GB18030_TWO_BYTE_RANGES = [
  0xa4, 0xa4, 0xa7, 0xa8, 0xb0, 0xb1, 0xb7, 0xb7, 0xd7, 0xd7,
  0xe0, 0xe1, 0xe8, 0xea, 0xec, 0xed, 0xf2, 0xf3, 0xf7, 0xf7,
  0xf9, 0xfa, 0xfc, 0xfc, 0x101, 0x101, 0x113, 0x113, 0x11b, 0x11b,
  0x12b, 0x12b, 0x144, 0x144, 0x148, 0x148, 0x14d, 0x14d, 0x16b, 0x16b,
  0x1ce, 0x1ce, 0x1d0, 0x1d0, 0x1d2, 0x1d2, 0x1d4, 0x1d4, 0x1d6, 0x1d6,
  0x1d8, 0x1d8, 0x1da, 0x1da, 0x1dc, 0x1dc, 0x1f9, 0x1f9, 0x251, 0x251,
  0x261, 0x261, 0x2c7, 0x2c7, 0x2c9, 0x2cb, 0x2d9, 0x2d9, 0x391, 0x3a1,
  0x3a3, 0x3a9, 0x3b1, 0x3c1, 0x3c3, 0x3c9, 0x401, 0x401, 0x410, 0x44f,
  0x451, 0x451, 0x1e3f, 0x1e3f, 0x2010, 0x2010, 0x2013, 0x2016, 0x2018, 0x2019,
  0x201c, 0x201d, 0x2025, 0x2026, 0x2030, 0x2030, 0x2032, 0x2033, 0x2035, 0x2035,
  0x203b, 0x203b, 0x2103, 0x2103, 0x2105, 0x2105, 0x2109, 0x2109,
  0x2116, 0x2116, 0x2121, 0x2121, 0x2160, 0x216b, 0x2170, 0x2179, 0x2190, 0x2193,
  0x2196, 0x2199, 0x2208, 0x2208, 0x220f, 0x220f, 0x2211, 0x2211, 0x2215, 0x2215,
  0x221a, 0x221a, 0x221d, 0x2220, 0x2223, 0x2223, 0x2225, 0x2225, 0x2227, 0x222b,
  0x222e, 0x222e, 0x2234, 0x2237, 0x223d, 0x223d, 0x2248, 0x2248, 0x224c, 0x224c,
  0x2252, 0x2252, 0x2260, 0x2261, 0x2264, 0x2267, 0x226e, 0x226f, 0x2295, 0x2295,
  0x2299, 0x2299, 0x22a5, 0x22a5, 0x22bf, 0x22bf, 0x2312, 0x2312, 0x2460, 0x2469,
  0x2474, 0x249b, 0x2500, 0x254b, 0x2550, 0x2573, 0x2581, 0x258f, 0x2593, 0x2595,
  0x25a0, 0x25a1, 0x25b2, 0x25b3, 0x25bc, 0x25bd, 0x25c6, 0x25c7, 0x25cb, 0x25cb,
  0x25ce, 0x25cf, 0x25e2, 0x25e5, 0x2605, 0x2606, 0x2609, 0x2609, 0x2640, 0x2640,
  0x2642, 0x2642, 0x2e81, 0x2e81, 0x2e84, 0x2e84, 0x2e88, 0x2e88, 0x2e8b, 0x2e8c,
  0x2e97, 0x2e97, 0x2ea7, 0x2ea7, 0x2eaa, 0x2eaa, 0x2eae, 0x2eae, 0x2eb3, 0x2eb3,
  0x2eb6, 0x2eb7, 0x2ebb, 0x2ebb, 0x2eca, 0x2eca, 0x2ff0, 0x2ffb, 0x3000, 0x3003,
  0x3005, 0x3017, 0x301d, 0x301e, 0x3021, 0x3029, 0x303e, 0x303e, 0x3041, 0x3093,
  0x309b, 0x309e, 0x30a1, 0x30f6, 0x30fc, 0x30fe, 0x3105, 0x3129, 0x3220, 0x3229,
  0x3231, 0x3231, 0x32a3, 0x32a3, 0x338e, 0x338f, 0x339c, 0x339e, 0x33a1, 0x33a1,
  0x33c4, 0x33c4, 0x33ce, 0x33ce, 0x33d1, 0x33d2, 0x33d5, 0x33d5, 0x3447, 0x3447,
  0x3473, 0x3473, 0x359e, 0x359e, 0x360e, 0x360e, 0x361a, 0x361a, 0x3918, 0x3918,
  0x396e, 0x396e, 0x39cf, 0x39d0, 0x39df, 0x39df, 0x3a73, 0x3a73, 0x3b4e, 0x3b4e,
  0x3c6e, 0x3c6e, 0x3ce0, 0x3ce0, 0x4056, 0x4056, 0x415f, 0x415f, 0x4337, 0x4337,
  0x43ac, 0x43ac, 0x43b1, 0x43b1, 0x43dd, 0x43dd, 0x44d6, 0x44d6, 0x464c, 0x464c,
  0x4661, 0x4661, 0x4723, 0x4723, 0x4729, 0x4729, 0x477c, 0x477c, 0x478d, 0x478d,
  0x4947, 0x4947, 0x497a, 0x497a, 0x497d, 0x497d, 0x4982, 0x4983, 0x4985, 0x4986,
  0x499b, 0x499b, 0x499f, 0x499f, 0x49b6, 0x49b7, 0x4c77, 0x4c77, 0x4c9f, 0x4ca3,
  0x4d13, 0x4d19, 0x4dae, 0x4dae, 0x4e00, 0x9fa5, 0xe000, 0xe5e4, 0xe5e6, 0xe76b,
  0xe76d, 0xe7c6, 0xe7c9, 0xe7e6, 0xe7f4, 0xe814, 0xe816, 0xe818, 0xe81e, 0xe81e,
  0xe826, 0xe826, 0xe82b, 0xe82c, 0xe831, 0xe832, 0xe83b, 0xe83b, 0xe843, 0xe843,
  0xe854, 0xe855, 0xe864, 0xe864, 0xf92c, 0xf92c, 0xf979, 0xf979, 0xf995, 0xf995,
  0xf9e7, 0xf9e7, 0xf9f1, 0xf9f1, 0xfa0c, 0xfa0f, 0xfa11, 0xfa11, 0xfa13, 0xfa14,
  0xfa18, 0xfa18, 0xfa1f, 0xfa21, 0xfa23, 0xfa24, 0xfa27, 0xfa29, 0xfe30, 0xfe31,
  0xfe33, 0xfe44, 0xfe49, 0xfe52, 0xfe54, 0xfe57, 0xfe59, 0xfe66, 0xfe68, 0xfe6b,
  0xff01, 0xff5e, 0xffe0, 0xffe5
];

/**
 * Test whether a Unicode BMP code point is within the standard GBK 2-byte repertoire.
 * In GB18030, characters in this set take 2 bytes, whereas all other non-ASCII
 * characters take 4 bytes (e.g. U+0080 is 81 30 81 30 = 4 bytes; U+0400 is 81 30 d1 34 = 4 bytes).
 * Uses binary search over the standards-derived contiguous BMP 2-byte ranges.
 *
 * @param {Number} code
 * @return {Boolean}
 * @api private
 */
function isGb18030TwoByte(code) {
  if (code < 0xa4 || code > 0xffe5) return false;
  let low = 0;
  let high = (GB18030_TWO_BYTE_RANGES.length >> 1) - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const s = GB18030_TWO_BYTE_RANGES[mid * 2];
    const e = GB18030_TWO_BYTE_RANGES[mid * 2 + 1];
    if (code < s) {
      high = mid - 1;
    } else if (code > e) {
      low = mid + 1;
    } else {
      return true;
    }
  }
  return false;
}

/**
 * Calculate decoded byte length for CJK double-byte character encodings
 * (Shift_JIS, GBK, GB18030, Big5, EUC-JP, EUC-KR).
 * Accurately accounts for single-byte extensions and multi-byte sequences per WHATWG Encoding standard:
 * - Shift_JIS: 0x80 -> U+0080 (1 byte), half-width Katakana U+FF61-U+FF9F (1 byte), Yen U+00A5 (1 byte), Overline U+203E (1 byte)
 * - EUC-JP: Yen U+00A5 (1 byte), Overline U+203E (1 byte)
 * - GBK / GB18030: byte 0x80 -> Euro U+20AC (1 byte)
 * - GB18030: characters outside GBK (e.g. U+0080 -> 81 30 81 30) and surrogate pairs are 4 bytes; GBK characters are 2 bytes
 * - Other non-ASCII characters: 2 bytes (DBCS lead+trail pairs)
 *
 * @param {String} str
 * @param {String} charset
 * @return {Number} byte length
 * @api private
 */
function getDbcsByteLength(str, charset) {
  const isSjis = /^(?:shift[-_]?jis|sjis|windows[-_]?31j|cp932|ms[-_]?kanji|x[-_]?sjis|csshiftjis)$/i.test(charset);
  const isGbk = /^(?:gbk|gb[-_]?2312|chinese|cp[-_]?936|windows[-_]?936|x[-_]?gbk|csgb2312.*)$/i.test(charset);
  const isGb18030 = /^(?:gb[-_]?18030|csgb18030)$/i.test(charset);
  const isEucJp = /^(?:euc[-_]?jp|x[-_]?euc[-_]?jp|cseucpkdfmtjapanese)$/i.test(charset);

  let count = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x7f) {
      count += 1;
    } else if (isSjis && (code === 0x0080 || (code >= 0xff61 && code <= 0xff9f) || code === 0x00a5 || code === 0x203e)) {
      count += 1;
    } else if (isEucJp && (code === 0x00a5 || code === 0x203e)) {
      count += 1;
    } else if ((isGbk || isGb18030) && code === 0x20ac) {
      count += 1;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length && str.charCodeAt(i + 1) >= 0xdc00 && str.charCodeAt(i + 1) <= 0xdfff) {
      count += isGb18030 ? 4 : 2;
      i++;
    } else if (isGb18030) {
      count += isGb18030TwoByte(code) ? 2 : 4;
    } else {
      count += 2;
    }
  }
  return count;
}

/**
 * Compute the decoded byte length of text response data in the browser.
 * Respects declared standard web character encodings, binary entities, and BOM bytes:
 * - Direct binary/decompressed entity inspection before text decoding
 * - Explicit BOM retention on XHR
 * - BOM characters in decoded string (U+FEFF)
 * - Single-byte charsets (ISO-8859-*, Windows-125*, Windows-874, TIS-620, KOI8-*, Macintosh, IBM866, US-ASCII, etc.)
 * - UTF-16 / UCS-2 multibyte charsets (2 bytes per code unit + BOM)
 * - UTF-32 / UCS-4 multibyte charsets (4 bytes per code point + BOM)
 * - ISO-2022-JP stateful shift escape sequence encoding
 * - HZ-GB-2312 stateful 7-bit encoding (RFC 1843)
 * - CJK DBCS encodings (Shift_JIS, GBK, GB18030 with 4-byte sequences, Big5, EUC-JP, EUC-KR)
 * - Defaults / UTF-8 fallback
 *
 * @param {String} str
 * @param {String} [contentType]
 * @param {XMLHttpRequest} [xhr]
 * @return {Number}
 * @api private
 */
function getTextDecodedByteLength(str, contentType, xhr) {
  // Check if XHR exposes raw decompressed entity bytes directly before text decoding
  const binaryBytes = getRawXhrByteLength(xhr);

  // If a binary representation was obtained, that is the exact decompressed entity size
  // before text decoding (already preserving BOM bytes and multi-byte sequences).
  if (binaryBytes !== undefined && (typeof str !== 'string' || binaryBytes > 0)) {
    if (typeof str !== 'string') return binaryBytes;
  }

  if (typeof str !== 'string') return binaryBytes;

  const match = contentType ? /charset\s*=\s*['"]?([^;'"]+)['"]?/i.exec(contentType) : null;
  const charset = match ? match[1].trim().replace(/^['"]|['"]$/g, '').toLowerCase() : '';

  let textBytes;

  // UTF-8 explicitly declared or default fallback:
  if (!charset || /^(?:utf[-_]?8|unicode[-_]?1[-_]?1[-_]?utf[-_]?8)$/i.test(charset)) {
    textBytes = getUtf8ByteLength(str);
  } else if (/^(?:iso[-_]?8859.*|windows[-_]?125\d|windows[-_]?874|tis[-_]?620|cp[-_]?125\d|cp[-_]?[48]\d\d|ibm[-_]?866|latin.*|ascii|us[-_]?ascii|ansi.*|koi8.*|macintosh|x[-_]?mac.*|x[-_]?user[-_]?defined|csiso.*|csascii)$/i.test(charset)) {
    // Single-byte charsets: string length equals byte length
    textBytes = str.length;
  } else if (/^(?:utf[-_]?16(?:[-_]?(?:le|be))?|ucs[-_]?2|unicode|csunicode)$/i.test(charset)) {
    // UTF-16 / UCS-2 multibyte charsets: each 16-bit code unit is 2 bytes
    textBytes = str.length * 2;
  } else if (/^(?:utf[-_]?32(?:[-_]?(?:le|be))?|ucs[-_]?4)$/i.test(charset)) {
    // UTF-32 / UCS-4 multibyte charsets: each code point is 4 bytes
    let count = 0;
    for (let i = 0; i < str.length; i++) {
      count += 4;
      const code = str.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length && str.charCodeAt(i + 1) >= 0xdc00 && str.charCodeAt(i + 1) <= 0xdfff) {
        i++; // surrogate pair represents a single 4-byte code point
      }
    }
    textBytes = count;
  } else if (/^(?:iso[-_]?2022[-_]?jp|csiso2022jp)$/i.test(charset)) {
    // ISO-2022-JP stateful shift encoding:
    textBytes = getIso2022JpByteLength(str);
  } else if (/^(?:hz[-_]?gb[-_]?2312|hz[-_]?gb|hz|cshzgb2312)$/i.test(charset)) {
    // HZ-GB-2312 stateful 7-bit encoding (RFC 1843):
    textBytes = getHzGb2312ByteLength(str);
  } else if (/^(?:shift[-_]?jis|sjis|windows[-_]?31j|cp932|ms[-_]?kanji|x[-_]?sjis|csshiftjis|gbk|gb[-_]?2312|gb[-_]?18030|csgb18030|chinese|cp[-_]?936|windows[-_]?936|x[-_]?gbk|csgb2312.*|euc[-_]?jp|x[-_]?euc[-_]?jp|cseucpkdfmtjapanese|big5.*|cp950|windows[-_]?950|cn[-_]?big5|euc[-_]?kr|cp949|windows[-_]?949|uhc|korean|ks[-_]?c[-_]?5601.*)$/i.test(charset)) {
    // CJK double-byte encodings (Shift_JIS, GBK, GB18030, Big5, EUC-JP, EUC-KR):
    textBytes = getDbcsByteLength(str, charset);
  } else {
    // Fallback: UTF-8 encoding
    textBytes = getUtf8ByteLength(str);
  }

  return binaryBytes !== undefined ? Math.max(textBytes, binaryBytes) : textBytes;
}

function Request(method, url) {
  const self = this;
  this._query = this._query || [];
  this.method = method;
  this.url = url;
  this.header = {}; // preserves header name case
  this._header = {}; // coerces header names to lowercase
  this.on('end', () => {
    if (self.hasSizeError()) return;

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
        error.rawResponse =
          typeof self.xhr.responseType === 'undefined'
            ? self.xhr.responseText
            : self.xhr.response;
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
        new_error = new Error(
          res.statusText || res.text || 'Unsuccessful HTTP response'
        );
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

  const encoder = options.encoder
    ? options.encoder
    : (string) => {
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

    let val = file;
    if (typeof Blob !== 'undefined' && !(val instanceof Blob)) {
      if (typeof Buffer !== 'undefined' && Buffer.isBuffer(val)) {
        val = new Blob([val]);
      } else if (val instanceof ArrayBuffer || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(val))) {
        val = new Blob([val]);
      }
    }

    if (!this._formFields) this._formFields = [];
    this._formFields.push([field, val]);

    this._getFormData().append(field, val, options || file.name);
  }

  return this;
};

Request.prototype._getFormData = function () {
  if (!this._formData) {
    const FormDataConstructor =
      (root && root.FormData) ||
      (typeof FormData !== 'undefined' ? FormData : undefined) ||
      (typeof global !== 'undefined' ? global.FormData : undefined);
    this._formData = new FormDataConstructor();
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

  if (this.called) return;
  this.called = true;

  const fn = this._callback;
  this.clearTimeout();

  if (error) {
    if (this.hasSizeError() || error.code === 'ETOOLARGE') {
      // Size errors must never trigger automatic retries; retries count is always 0.
      error.retries = 0;
    } else if (this._maxRetries) {
      error.retries = this._retries - 1;
    }
    this.emit('error', error);
  }

  if (typeof fn === 'function') {
    fn(error, res);
  }
};

/**
 * Invoke callback with x-domain error.
 *
 * @api private
 */

/**
 * Abort the request and invoke callback with size limit error.
 * Sets _sizeError, aborts the XHR, and fires callback exactly once.
 * Called by both request and response size enforcement paths.
 *
 * @param {String} type 'request' or 'response'
 * @return {Error} size error
 * @api private
 */
Request.prototype._abortWithSizeError = function (type) {
  if (this.hasSizeError()) return this._sizeError;

  const error = new Error(`Maximum ${type} size reached`);
  error.code = 'ETOOLARGE';
  error.retries = 0;
  this._sizeError = error;

  this.abort();
  if (!this.called) {
    this.callback(error, type === 'response' ? null : undefined);
  }
  return error;
};

Request.prototype.crossDomainError = function () {
  const error = new Error(
    'Request has been terminated\nPossible causes: the network is offline, Origin is not allowed by Access-Control-Allow-Origin, the page is being unloaded, etc.'
  );
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
  throw new Error(
    'Streaming is not supported in browser version of superagent'
  );
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
  return (
    object &&
    typeof object === 'object' &&
    !Array.isArray(object) &&
    (Object.prototype.toString.call(object) !== '[object Object]' || typeof object.append === 'function')
  );
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
    console.warn(
      'Warning: .end() was called twice. This is not supported in superagent'
    );
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
      self._timeoutError(
        'Upload timeout of ',
        self._uploadTimeout,
        'ETIMEDOUT'
      );
    }, this._uploadTimeout);
  }
};

// eslint-disable-next-line complexity
Request.prototype._end = function () {
  if (this._aborted)
    return this.callback(
      this._sizeError ||
        new Error('The request has been aborted even before .end() was called')
    );

  const self = this;
  this.xhr = request.getXHR();
  const { xhr } = this;
  let data = this._formDataBlob || this._formData || this._data;

  this._setTimeouts();

  // state change
  xhr.addEventListener('readystatechange', () => {
    const { readyState } = xhr;
    if (readyState >= 2 && self._responseTimeoutTimer) {
      clearTimeout(self._responseTimeoutTimer);
    }

    if (readyState !== 4) {
      return;
    }

    if (self._maxResponseSize !== undefined && !self.hasSizeError()) {
      let status = 0;
      try {
        status = xhr.status;
      } catch (err) {
        status = 0;
      }

      // Normalize IE/legacy XHR 1223 status to 204 No Content
      if (status === 1223) {
        status = 204;
      }

      const isBodyless = self.method === 'HEAD' || status === 204 || status === 304;

      // Measure the terminal decoded response body at readyState 4.
      let finalBytes;
      if (!isBodyless) {
        let raw;
        try {
          if (xhr.response !== undefined && xhr.response !== null) {
            raw = xhr.response;
          }
        } catch (_) {
          // Ignore error accessing xhr.response
        }
        if (raw === undefined || raw === null) {
          try {
            raw = xhr.responseText;
          } catch (_) {
            raw = null;
          }
        }

        // Wire-side byte counts (from progress events or Content-Length).
        let wireBytes = self._responseBytesReceived;
        if (typeof wireBytes !== 'number') {
          try {
            const clHeader = xhr.getResponseHeader('Content-Length');
            if (clHeader) {
              const parsed = parseInt(clHeader, 10);
              if (!isNaN(parsed)) wireBytes = parsed;
            }
          } catch (_ignoreHeaderError) {
            wireBytes = undefined;
          }
        }

        let ctHeader = '';
        try {
          ctHeader = xhr.getResponseHeader('Content-Type') || '';
        } catch (_) {
          // Ignore error reading Content-Type header
        }

        let isCompressed = false;
        let isEncodingEstablished = false;
        let ce = '';
        try {
          ce = xhr.getResponseHeader('Content-Encoding') || '';
          if (ce) {
            isEncodingEstablished = true;
            // Treat any non-identity Content-Encoding as compressed:
            // identity is the only codec that guarantees wire == decoded.
            // All other values (gzip, deflate, br, zstd, etc.) indicate
            // the XHR body has been decompressed by the browser.
            const isIdentity = ce.trim().toLowerCase() === 'identity';
            isCompressed = !isIdentity;
          }
        } catch (_) {
          // Ignore error reading Content-Encoding header
        }

        // For same-origin responses, all response headers are exposed by XHR.
        // A missing Content-Encoding header on an exposed same-origin response is known absent
        // and denotes identity (uncompressed).
        const isSameOrigin = isSameOriginRequest(xhr, self.url);
        const isCompressedOrUnexposed = isCompressed || (!isSameOrigin && !ce);
        const isKnownIdentity = (isEncodingEstablished && !isCompressed) || (isSameOrigin && !ce);

        // Check if xhr exposes raw decompressed entity bytes before text decoding
        const rawEntityBytes = getRawXhrByteLength(xhr);

        // Measure decoded bytes:
        let decodedBytes;
        if (typeof raw === 'string') {
          decodedBytes = getTextDecodedByteLength(raw, ctHeader, xhr);
        } else if (raw && typeof raw === 'object' && !(raw instanceof ArrayBuffer) && !isBlobOrFile(raw)) {
          // If raw is an object (e.g. parsed JSON) or Document, compute its serialized byte length
          try {
            if (typeof Document !== 'undefined' && raw instanceof Document) {
              decodedBytes = getTextDecodedByteLength(new XMLSerializer().serializeToString(raw), ctHeader, xhr);
            } else if (typeof raw.toString === 'function' && raw.toString() !== '[object Object]') {
              decodedBytes = getTextDecodedByteLength(raw.toString(), ctHeader, xhr);
            } else {
              decodedBytes = getTextDecodedByteLength(JSON.stringify(raw), ctHeader, xhr);
            }
          } catch (_) {
            decodedBytes = undefined;
          }
        } else {
          decodedBytes = getResponseIntrinsicByteLength(raw);
        }

        if (rawEntityBytes !== undefined) {
          decodedBytes = typeof decodedBytes === 'number' ? Math.max(decodedBytes, rawEntityBytes) : rawEntityBytes;
        }

        if (isKnownIdentity) {
          // For confirmed uncompressed responses, use the actual transfer/body byte count
          // (or encode according to the declared charset if wireBytes is unavailable).
          if (typeof wireBytes === 'number') {
            finalBytes = wireBytes;
          } else if (typeof decodedBytes === 'number') {
            finalBytes = decodedBytes;
          }
        } else if (isCompressedOrUnexposed) {
          // Genuinely compressed or unexposed-compression cases (e.g. CORS where Content-Encoding
          // is unexposed): evaluate the decoded payload size, not the wire transfer size.
          if (typeof decodedBytes === 'number') {
            finalBytes = decodedBytes;
          } else if (typeof wireBytes === 'number' && wireBytes > self._maxResponseSize) {
            finalBytes = wireBytes;
          } else {
            // When decoded size cannot be established and response is compressed,
            // we must NOT accept wireBytes <= maxResponseSize because wireBytes is compressed!
            // Fail safely:
            finalBytes = (self._maxResponseSize || 0) + 1;
          }
        } else {
          finalBytes = typeof decodedBytes === 'number' ? decodedBytes : wireBytes;
        }
      }
      if (typeof finalBytes === 'number' && finalBytes > self._maxResponseSize) {
        self._abortWithSizeError('response');
        return;
      }
    }

    // In IE9, reads to any property (e.g. status) off of an aborted XHR will
    // result in the error "Could not complete the operation due to error c00c023f"
    let status;
    try {
      status = xhr.status;
    } catch (err) {
      status = 0;
    }

    // HTTP 305 Use Proxy: Browser Fetch/XHR does not follow 305 automatically.
    // For method-preserving 305 redirect, follow Location, create next XHR and replay body.
    if (status === 305) {
      let loc = '';
      try {
        loc = xhr.getResponseHeader('Location');
      } catch (_) {
        // ignore error reading Location header
      }
      const maxRedirects = self._maxRedirects === undefined ? 5 : self._maxRedirects;
      if (loc && (self._redirects || 0) < maxRedirects) {
        self._redirects = (self._redirects || 0) + 1;
        self._redirectList = self._redirectList || [];
        self._redirectList.push(self.url);

        let targetUrl = loc;
        try {
          if (typeof URL !== 'undefined') {
            targetUrl = new URL(loc, self.url).href;
          } else if (typeof root !== 'undefined' && root.document && root.document.createElement) {
            const a = root.document.createElement('a');
            a.href = loc;
            targetUrl = a.href;
          }
        } catch (_) {
          targetUrl = loc;
        }

        const isSameOrigin = isSameOriginUrl(targetUrl, self.url);
        if (!isSameOrigin) {
          if (self.header) {
            for (const key of Object.keys(self.header)) {
              const lk = key.toLowerCase();
              if (lk === 'authorization' || lk === 'cookie') {
                delete self.header[key];
              }
            }
          }
          if (self._header) {
            for (const key of Object.keys(self._header)) {
              const lk = key.toLowerCase();
              if (lk === 'authorization' || lk === 'cookie') {
                delete self._header[key];
              }
            }
          }
        }

        self.url = targetUrl;
        if (self._responseTimeoutTimer) clearTimeout(self._responseTimeoutTimer);
        if (self._uploadTimeoutTimer) clearTimeout(self._uploadTimeoutTimer);

        self._responseBytesReceived = undefined;
        return self._end();
      }
    }

    if (!status) {
      if (self.timedout || self._aborted || self.hasSizeError()) return;
      return self.crossDomainError();
    }

    if (self.hasSizeError()) return;
    self.emit('end');
  });

  // progress
  const handleProgress = (direction, e) => {
    if (e.total > 0) {
      e.percent = (e.loaded / e.total) * 100;

      if (e.percent === 100) {
        clearTimeout(self._uploadTimeoutTimer);
      }
    }

    e.direction = direction;
    self.emit('progress', e);

    if (direction === 'upload' && self._maxRequestSize !== undefined && typeof e.loaded === 'number' && e.loaded > self._maxRequestSize) {
      self._abortWithSizeError('request');
      return;
    }

    if (direction === 'download' && typeof e.loaded === 'number' && self._maxResponseSize !== undefined) {
      // Track raw bytes received; this is the primary response size counter.
      self._responseBytesReceived = e.loaded;

      let isCompressed = false;
      let isEncodingEstablished = false;
      let ce = '';
      try {
        ce = xhr.getResponseHeader('Content-Encoding') || '';
        if (ce) {
          isEncodingEstablished = true;
          const isIdentity = ce.trim().toLowerCase() === 'identity';
          isCompressed = !isIdentity;
        }
      } catch (_) {
        // Ignore error reading Content-Encoding header
      }

      const isSameOrigin = isSameOriginRequest(xhr, self.url);
      const isKnownIdentity = (isEncodingEstablished && !isCompressed) || (isSameOrigin && !ce);

      if (isKnownIdentity) {
        // For confirmed uncompressed responses, e.loaded represents the actual
        // transfer/body byte count. Abort if wire bytes exceed limit.
        if (e.loaded > self._maxResponseSize) {
          self._abortWithSizeError('response');
        }
        return;
      }

      // For compressed responses or ambiguous unexposed-compression cases (CORS):
      // Wire transfer size cannot be assumed to reflect decoded payload size.
      // If a decoded representation is available, evaluate its decoded size.
      let ctHeader = '';
      try {
        ctHeader = xhr.getResponseHeader('Content-Type') || '';
      } catch (_) {
        // Ignore error reading Content-Type header
      }

      let currentDecoded;
      try {
        const currentRaw = (xhr.response !== undefined && xhr.response !== null) ? xhr.response : xhr.responseText;
        if (currentRaw !== undefined && currentRaw !== null) {
          if (typeof currentRaw === 'string') {
            currentDecoded = getTextDecodedByteLength(currentRaw, ctHeader, xhr);
          } else {
            currentDecoded = getResponseIntrinsicByteLength(currentRaw);
          }
        }
      } catch (_) {
        // Ignore error accessing current response
      }

      // If a readable decoded representation is available:
      // Abort immediately if decoded size exceeds limit; do not abort if within limit.
      if (typeof currentDecoded === 'number') {
        if (currentDecoded > self._maxResponseSize) {
          self._abortWithSizeError('response');
        }
        return;
      }

      // If at readyState 4, defer to terminal readyState 4 handler
      if (xhr.readyState === 4) {
        return;
      }

      // If decoded representation is not yet readable (e.g. binary responseType
      // where XHR response is null until readyState 4), defer evaluation to readyState 4.
    }
  };

  try {
    if (this.hasListeners('progress') || this._maxResponseSize !== undefined) {
      xhr.addEventListener('progress', handleProgress.bind(null, 'download'));
    }
    if (xhr.upload && (this.hasListeners('progress') || this._maxRequestSize !== undefined)) {
      xhr.upload.addEventListener(
        'progress',
        handleProgress.bind(null, 'upload')
      );
    }
  } catch (err) {
    // Accessing xhr.upload fails in IE from a web worker, so just pretend it doesn't exist.
    // Reported here:
    // https://connect.microsoft.com/IE/feedback/details/837245/xmlhttprequest-upload-throws-invalid-argument-when-used-from-web-worker-context
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
  // When either size limit is configured and the body is a FormData, serialize it
  // to an exact Blob with a matching boundary header so the transmitted body matches
  // the measured size. If oversized, abort immediately before sending.
  // Cache the resulting Blob on this._formDataBlob so retries retain the body.
  const needsFormDataSerialization = (this._maxRequestSize !== undefined) || (this._maxResponseSize !== undefined) || (this._maxRetries > 0) || (this._maxRedirects > 0) || Boolean(this._formDataBlob);
  if (needsFormDataSerialization && this.method !== 'GET' && this.method !== 'HEAD') {
    if (this._formDataBlob) {
      data = this._formDataBlob;
      const contentType = this._formDataBlob.contentType || this._formDataBlob.type;
      for (const key of Object.keys(this.header)) {
        if (key.toLowerCase() === 'content-type') {
          delete this.header[key];
        }
      }
      this.header['content-type'] = contentType;
      this._header['content-type'] = contentType;
    } else {
      const rawPayload = data !== undefined ? data : this._formData;
      if (
        (typeof FormData !== 'undefined' && rawPayload instanceof FormData) ||
        (rawPayload && typeof rawPayload === 'object' && (
          Object.prototype.toString.call(rawPayload) === '[object FormData]' ||
          (typeof Symbol !== 'undefined' && Symbol.toStringTag && rawPayload[Symbol.toStringTag] === 'FormData') ||
          (rawPayload.constructor && rawPayload.constructor.name === 'FormData') ||
          typeof rawPayload.append === 'function'
        ))
      ) {
        let formDataBlob;
        try {
          formDataBlob = buildFormDataBlob(rawPayload, this);
        } catch (_) {
          // ignore
        }
        if (formDataBlob) {
          if (this._maxRequestSize !== undefined && formDataBlob.size > this._maxRequestSize) {
            this._abortWithSizeError('request');
            return;
          }
          this._formDataBlob = formDataBlob;
          data = formDataBlob;
          const contentType = formDataBlob.contentType || formDataBlob.type;
          for (const key of Object.keys(this.header)) {
            if (key.toLowerCase() === 'content-type') {
              delete this.header[key];
            }
          }
          this.header['content-type'] = contentType;
          this._header['content-type'] = contentType;
        } else if (this._maxRequestSize !== undefined) {
          const computedSize = computeFormDataSize(rawPayload, this);
          if (computedSize !== undefined && computedSize > this._maxRequestSize) {
            this._abortWithSizeError('request');
            return;
          }
        }
      }
    }
  }

  if (
    !this._formData &&
    !this._formDataBlob &&
    this.method !== 'GET' &&
    this.method !== 'HEAD' &&
    typeof data !== 'string' &&
    !this._isHost(data)
  ) {
    // serialize stuff
    const contentType = this._header['content-type'];
    let serialize =
      this._serializer ||
      request.serialize[contentType ? contentType.split(';')[0] : ''];
    if (!serialize && isJSON(contentType)) {
      serialize = request.serialize['application/json'];
    }

    if (serialize) data = serialize(data);
  }

  // set header fields
  for (const field in this.header) {
    if (this.header[field] === null) continue;

    if (hasOwn(this.header, field))
      xhr.setRequestHeader(field, this.header[field]);
  }

  if (this._responseType) {
    xhr.responseType = this._responseType;
  }

  // send stuff
  this.emit('request', this);

  // Check effective responseType AFTER 'request' event:
  // If the user's 'request' listener explicitly set a binary responseType (e.g. 'arraybuffer' or 'blob'),
  // we must NOT force text decoding in Response constructor!
  const effectiveType = (xhr.responseType || this._responseType || '').toLowerCase();
  const isBinaryType = effectiveType === 'arraybuffer' || effectiveType === 'blob';
  if (this._maxResponseSize !== undefined && !isBinaryType) {
    try {
      xhr.responseType = 'arraybuffer';
      this._forcedArrayBufferForSize = true;
    } catch (_) {
      if (this._responseType) {
        xhr.responseType = this._responseType;
      }
    }
  }

  // Enforce maxRequestSize on browser requests before sending.
  // XMLHttpRequest normalizes GET and HEAD bodies to null and transmits no body.
  if (this._maxRequestSize !== undefined && this.method !== 'GET' && this.method !== 'HEAD') {
    const payload = data !== undefined ? data : this._formData;
    const byteLength = getRequestBodySize(payload, this);
    if (byteLength !== undefined && byteLength > this._maxRequestSize) {
      this._abortWithSizeError('request');
      return;
    }
  }

  // IE11 xhr.send(undefined) sends 'undefined' string as POST payload (instead of nothing)
  // We need null here if data is undefined, and XMLHttpRequest ignores bodies on GET/HEAD
  if (this.method === 'GET' || this.method === 'HEAD') {
    data = null;
  }
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

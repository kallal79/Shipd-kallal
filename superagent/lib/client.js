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

/**
 * Safely define an accessor property on an object without throwing if non-configurable.
 *
 * @param {Object} obj
 * @param {String} prop
 * @param {Function} getter
 * @api private
 */
function safeDefineProperty(obj, prop, getter) {
  if (!obj) return;
  try {
    Object.defineProperty(obj, prop, {
      get: getter,
      configurable: true
    });
  } catch (_) {
    // Ignore if property is non-configurable on host object
  }
}
function Response(request_) {
  this.req = request_;
  this.xhr = this.req.xhr;
  // responseText is accessible only if responseType is '' or 'text' and on older browsers
  this.text = !this.req._forcedArrayBufferForSize && (this.req.method !== 'HEAD' && (this.xhr.responseType === '' || this.xhr.responseType === 'text') || typeof this.xhr.responseType === 'undefined') ? this.xhr.responseText : null;
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
  if (this.req._forcedArrayBufferForSize) {
    const requestedType = this.req._responseType || '';
    safeDefineProperty(this.xhr, 'responseType', () => requestedType);
    const isBuffer = typeof Buffer !== 'undefined' && Buffer.isBuffer(this.xhr.response);
    const isArrayBuffer = typeof ArrayBuffer !== 'undefined' && this.xhr.response instanceof ArrayBuffer;
    const isView = typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(this.xhr.response);
    if (isBuffer || isArrayBuffer || isView) {
      let charset = 'utf-8';
      const match = this.header['content-type'] ? /charset\s*=\s*['"]?([^;'"]+)['"]?/i.exec(this.header['content-type']) : null;
      if (match) charset = match[1].trim().toLowerCase();
      let text = '';
      const TextDecoderClass = typeof TextDecoder !== 'undefined' ? TextDecoder : function () {
        try {
          return require('util').TextDecoder;
        } catch (_) {
          return null;
        }
      }();
      if (TextDecoderClass) {
        try {
          text = new TextDecoderClass(charset, {
            fatal: false
          }).decode(this.xhr.response);
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
      let reconstructedResponse = text;
      if (this.req._responseType === 'json') {
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch (_) {
          parsed = null;
        }
        this.body = parsed;
        this.text = null;
        reconstructedResponse = parsed;
      } else if (this.req._responseType === 'document') {
        let parsedDoc = null;
        try {
          if (typeof DOMParser !== 'undefined') {
            const ct = this.header['content-type'] || '';
            const docType = ct.includes('html') ? 'text/html' : ct.includes('svg') ? 'image/svg+xml' : 'application/xml';
            parsedDoc = new DOMParser().parseFromString(text, docType);
          }
        } catch (_) {
          parsedDoc = null;
        }
        this.body = parsedDoc;
        this.text = null;
        reconstructedResponse = parsedDoc;
      } else if (this.req._responseType === 'text') {
        this.text = text;
        this.body = text;
        reconstructedResponse = text;
      } else if (!this.req._responseType) {
        this.text = text;
        this.body = this._parseBody(text);
        reconstructedResponse = text;
      }

      // Safely emulate XHR properties for callers inspecting the underlying XHR directly
      safeDefineProperty(this.xhr, 'responseText', () => text);
      safeDefineProperty(this.xhr, 'response', () => reconstructedResponse);
    } else {
      let fallbackText = null;
      try {
        if (typeof this.xhr.responseText === 'string') fallbackText = this.xhr.responseText;
      } catch (_) {
        // Ignore InvalidStateError on native binary XHR
      }
      if (fallbackText === null && typeof this.xhr.response === 'string') {
        fallbackText = this.xhr.response;
      }
      this.text = fallbackText;
    }
  }
  if (this.body !== undefined) {
    // Already reconstructed under size limits
  } else if (this.text === null && this.req._responseType) {
    this.body = this.xhr.response;
  } else {
    this.body = this.req.method === 'HEAD' ? null : this._parseBody(typeof this.text === 'string' ? this.text : this.xhr.response);
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
  return tag === '[object Blob]' || tag === '[object File]' || typeof val.size === 'number' && typeof val.slice === 'function';
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
  const escapeHeaderParam = s => String(s).replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/"/g, '%22');
  const normalizeLineEndings = s => String(s).replace(/(?:\r\n|\r|\n)/g, CRLF);
  try {
    let entries;
    if (req && Array.isArray(req._formFields) && req._formFields.length > 0) {
      entries = req._formFields.slice();
    } else if (fd && typeof fd.entries === 'function') {
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
    } else {
      return undefined;
    }
    for (let i = 0; i < entries.length; i++) {
      const item = entries[i];
      const name = item[0];
      const value = item[1];
      let customFilename = item[2];
      if (!customFilename && req && Array.isArray(req._formFields) && req._formFields[i]) {
        customFilename = req._formFields[i][2];
      }
      parts.push('--' + BOUNDARY + CRLF);
      const eName = escapeHeaderParam(name);
      if (isBlobOrFile(value)) {
        const fileOverride = typeof customFilename === 'string' ? customFilename : customFilename && customFilename.filename ? customFilename.filename : null;
        const customContentType = customFilename && (customFilename.contentType || customFilename.type);
        const fileName = escapeHeaderParam(fileOverride || value.name || 'blob');
        const mimeType = customContentType || value.type || 'application/octet-stream';
        parts.push('Content-Disposition: form-data; name="' + eName + '"; filename="' + fileName + '"' + CRLF + 'Content-Type: ' + mimeType + CRLF + CRLF);
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
        const blob = new Blob(parts, {
          type: contentType
        });
        blob.contentType = contentType;
        return blob;
      } catch (_) {
        // ignore
      }
    }
    const BlobBuilder = typeof window !== 'undefined' && (window.BlobBuilder || window.WebKitBlobBuilder || window.MozBlobBuilder || window.MSBlobBuilder) || typeof global !== 'undefined' && (global.BlobBuilder || global.WebKitBlobBuilder || global.MozBlobBuilder || global.MSBlobBuilder);
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
  const escapeHeaderParam = s => String(s).replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/"/g, '%22');
  const normalizeLineEndings = s => String(s).replace(/(?:\r\n|\r|\n)/g, CRLF);
  let entries = [];
  if (req && Array.isArray(req._formFields) && req._formFields.length > 0) {
    entries = req._formFields.slice();
  } else {
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
  }
  if (entries.length === 0) {
    const isKnownEnumerable = fd && (typeof fd.entries === 'function' || typeof fd.forEach === 'function') || req && req._formData === fd;
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
  for (let i = 0; i < entries.length; i++) {
    const item = entries[i];
    const name = item[0];
    const value = item[1];
    let customFilename = item[2];
    if (!customFilename && req && Array.isArray(req._formFields) && req._formFields[i]) {
      customFilename = req._formFields[i][2];
    }
    totalBytes += boundaryLineBytes;
    const eName = escapeHeaderParam(name);
    if (isBlobOrFile(value)) {
      const fileOverride = typeof customFilename === 'string' ? customFilename : customFilename && customFilename.filename ? customFilename.filename : null;
      const customContentType = customFilename && (customFilename.contentType || customFilename.type);
      const fileName = escapeHeaderParam(fileOverride || value.name || 'blob');
      const mimeType = customContentType || value.type || 'application/octet-stream';
      const headerStr = 'Content-Disposition: form-data; name="' + eName + '"; filename="' + fileName + '"' + CRLF + 'Content-Type: ' + mimeType + CRLF + CRLF;
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
      const headerStr = 'Content-Disposition: form-data; name="' + eName + '"' + CRLF + CRLF;
      totalBytes += getUtf8ByteLength(headerStr);
      const normalizedStr = normalizeLineEndings(value == null ? '' : String(value));
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
  const targetData = data !== undefined ? data : req && req._formData;
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
  if (typeof URLSearchParams !== 'undefined' && targetData instanceof URLSearchParams || targetData && typeof targetData === 'object' && (typeof Symbol !== 'undefined' && Symbol.toStringTag && targetData[Symbol.toStringTag] === 'URLSearchParams' || targetData.constructor && targetData.constructor.name === 'URLSearchParams')) {
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
  if (typeof FormData !== 'undefined' && targetData instanceof FormData || targetData && typeof targetData === 'object' && (Object.prototype.toString.call(targetData) === '[object FormData]' || typeof Symbol !== 'undefined' && Symbol.toStringTag && targetData[Symbol.toStringTag] === 'FormData' || targetData.constructor && (targetData.constructor.name === 'FormData' || targetData.constructor.name === 'MockFormData'))) {
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
  if (typeof data === 'object') {
    if (typeof data.byteLength === 'number') return data.byteLength;
    if (typeof data.size === 'number') return data.size;
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
    const loc = typeof window !== 'undefined' && window.location || typeof location !== 'undefined' && location;
    if (!loc || !loc.origin || loc.origin === 'null') {
      return false;
    }
    const target = xhr && xhr.responseURL ? xhr.responseURL : requestUrl || '';
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
    const loc = typeof window !== 'undefined' && window.location || typeof location !== 'undefined' && location;
    let baseOrigin = loc && loc.origin && loc.origin !== 'null' ? loc.origin : 'http://localhost';
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
const GB18030_TWO_BYTE_RANGES = [0xa4, 0xa4, 0xa7, 0xa8, 0xb0, 0xb1, 0xb7, 0xb7, 0xd7, 0xd7, 0xe0, 0xe1, 0xe8, 0xea, 0xec, 0xed, 0xf2, 0xf3, 0xf7, 0xf7, 0xf9, 0xfa, 0xfc, 0xfc, 0x101, 0x101, 0x113, 0x113, 0x11b, 0x11b, 0x12b, 0x12b, 0x144, 0x144, 0x148, 0x148, 0x14d, 0x14d, 0x16b, 0x16b, 0x1ce, 0x1ce, 0x1d0, 0x1d0, 0x1d2, 0x1d2, 0x1d4, 0x1d4, 0x1d6, 0x1d6, 0x1d8, 0x1d8, 0x1da, 0x1da, 0x1dc, 0x1dc, 0x1f9, 0x1f9, 0x251, 0x251, 0x261, 0x261, 0x2c7, 0x2c7, 0x2c9, 0x2cb, 0x2d9, 0x2d9, 0x391, 0x3a1, 0x3a3, 0x3a9, 0x3b1, 0x3c1, 0x3c3, 0x3c9, 0x401, 0x401, 0x410, 0x44f, 0x451, 0x451, 0x1e3f, 0x1e3f, 0x2010, 0x2010, 0x2013, 0x2016, 0x2018, 0x2019, 0x201c, 0x201d, 0x2025, 0x2026, 0x2030, 0x2030, 0x2032, 0x2033, 0x2035, 0x2035, 0x203b, 0x203b, 0x2103, 0x2103, 0x2105, 0x2105, 0x2109, 0x2109, 0x2116, 0x2116, 0x2121, 0x2121, 0x2160, 0x216b, 0x2170, 0x2179, 0x2190, 0x2193, 0x2196, 0x2199, 0x2208, 0x2208, 0x220f, 0x220f, 0x2211, 0x2211, 0x2215, 0x2215, 0x221a, 0x221a, 0x221d, 0x2220, 0x2223, 0x2223, 0x2225, 0x2225, 0x2227, 0x222b, 0x222e, 0x222e, 0x2234, 0x2237, 0x223d, 0x223d, 0x2248, 0x2248, 0x224c, 0x224c, 0x2252, 0x2252, 0x2260, 0x2261, 0x2264, 0x2267, 0x226e, 0x226f, 0x2295, 0x2295, 0x2299, 0x2299, 0x22a5, 0x22a5, 0x22bf, 0x22bf, 0x2312, 0x2312, 0x2460, 0x2469, 0x2474, 0x249b, 0x2500, 0x254b, 0x2550, 0x2573, 0x2581, 0x258f, 0x2593, 0x2595, 0x25a0, 0x25a1, 0x25b2, 0x25b3, 0x25bc, 0x25bd, 0x25c6, 0x25c7, 0x25cb, 0x25cb, 0x25ce, 0x25cf, 0x25e2, 0x25e5, 0x2605, 0x2606, 0x2609, 0x2609, 0x2640, 0x2640, 0x2642, 0x2642, 0x2e81, 0x2e81, 0x2e84, 0x2e84, 0x2e88, 0x2e88, 0x2e8b, 0x2e8c, 0x2e97, 0x2e97, 0x2ea7, 0x2ea7, 0x2eaa, 0x2eaa, 0x2eae, 0x2eae, 0x2eb3, 0x2eb3, 0x2eb6, 0x2eb7, 0x2ebb, 0x2ebb, 0x2eca, 0x2eca, 0x2ff0, 0x2ffb, 0x3000, 0x3003, 0x3005, 0x3017, 0x301d, 0x301e, 0x3021, 0x3029, 0x303e, 0x303e, 0x3041, 0x3093, 0x309b, 0x309e, 0x30a1, 0x30f6, 0x30fc, 0x30fe, 0x3105, 0x3129, 0x3220, 0x3229, 0x3231, 0x3231, 0x32a3, 0x32a3, 0x338e, 0x338f, 0x339c, 0x339e, 0x33a1, 0x33a1, 0x33c4, 0x33c4, 0x33ce, 0x33ce, 0x33d1, 0x33d2, 0x33d5, 0x33d5, 0x3447, 0x3447, 0x3473, 0x3473, 0x359e, 0x359e, 0x360e, 0x360e, 0x361a, 0x361a, 0x3918, 0x3918, 0x396e, 0x396e, 0x39cf, 0x39d0, 0x39df, 0x39df, 0x3a73, 0x3a73, 0x3b4e, 0x3b4e, 0x3c6e, 0x3c6e, 0x3ce0, 0x3ce0, 0x4056, 0x4056, 0x415f, 0x415f, 0x4337, 0x4337, 0x43ac, 0x43ac, 0x43b1, 0x43b1, 0x43dd, 0x43dd, 0x44d6, 0x44d6, 0x464c, 0x464c, 0x4661, 0x4661, 0x4723, 0x4723, 0x4729, 0x4729, 0x477c, 0x477c, 0x478d, 0x478d, 0x4947, 0x4947, 0x497a, 0x497a, 0x497d, 0x497d, 0x4982, 0x4983, 0x4985, 0x4986, 0x499b, 0x499b, 0x499f, 0x499f, 0x49b6, 0x49b7, 0x4c77, 0x4c77, 0x4c9f, 0x4ca3, 0x4d13, 0x4d19, 0x4dae, 0x4dae, 0x4e00, 0x9fa5, 0xe000, 0xe5e4, 0xe5e6, 0xe76b, 0xe76d, 0xe7c6, 0xe7c9, 0xe7e6, 0xe7f4, 0xe814, 0xe816, 0xe818, 0xe81e, 0xe81e, 0xe826, 0xe826, 0xe82b, 0xe82c, 0xe831, 0xe832, 0xe83b, 0xe83b, 0xe843, 0xe843, 0xe854, 0xe855, 0xe864, 0xe864, 0xf92c, 0xf92c, 0xf979, 0xf979, 0xf995, 0xf995, 0xf9e7, 0xf9e7, 0xf9f1, 0xf9f1, 0xfa0c, 0xfa0f, 0xfa11, 0xfa11, 0xfa13, 0xfa14, 0xfa18, 0xfa18, 0xfa1f, 0xfa21, 0xfa23, 0xfa24, 0xfa27, 0xfa29, 0xfe30, 0xfe31, 0xfe33, 0xfe44, 0xfe49, 0xfe52, 0xfe54, 0xfe57, 0xfe59, 0xfe66, 0xfe68, 0xfe6b, 0xff01, 0xff5e, 0xffe0, 0xffe5];

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
    const mid = low + high >> 1;
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
    } else if (isSjis && (code === 0x0080 || code >= 0xff61 && code <= 0xff9f || code === 0x00a5 || code === 0x203e)) {
      count += 1;
    } else if (isEucJp && (code === 0x00a5 || code === 0x203e)) {
      count += 1;
    } else if (isGbk && code === 0x20ac) {
      count += 1;
    } else if (isGb18030 && code === 0x20ac) {
      count += 2;
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
    let val = file;
    if (typeof Blob !== 'undefined' && !(val instanceof Blob)) {
      if (typeof Buffer !== 'undefined' && Buffer.isBuffer(val)) {
        val = new Blob([val]);
      } else if (val instanceof ArrayBuffer || typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(val)) {
        val = new Blob([val]);
      }
    }
    const filename = typeof options === 'string' ? options : options && options.filename ? options.filename : file && file.name;
    if (!this._formFields) this._formFields = [];
    this._formFields.push([field, val, options || filename]);
    const appendName = filename || file && file.name;
    if (appendName) {
      this._getFormData().append(field, val, appendName);
    } else {
      this._getFormData().append(field, val);
    }
  }
  return this;
};
Request.prototype._getFormData = function () {
  if (!this._formData) {
    const FormDataConstructor = root && root.FormData || (typeof FormData !== 'undefined' ? FormData : undefined) || (typeof global !== 'undefined' ? global.FormData : undefined);
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
  if (this._aborted) return this.callback(this._sizeError || new Error('The request has been aborted even before .end() was called'));
  const self = this;
  this.xhr = request.getXHR();
  const {
    xhr
  } = this;
  let data = this._formDataBlob || this._formData || this._data;
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
        const isCompressedOrUnexposed = isCompressed || !isSameOrigin && !ce;
        const isKnownIdentity = isEncodingEstablished && !isCompressed || isSameOrigin && !ce;

        // Check if xhr exposes raw decompressed entity bytes before text decoding
        const rawEntityBytes = getRawXhrByteLength(xhr);

        // Measure decoded bytes:
        let decodedBytes;
        if (typeof raw === 'string') {
          decodedBytes = getTextDecodedByteLength(raw, ctHeader, xhr);
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
        } else if (isCompressed) {
          // Genuinely compressed response: evaluate decoded bytes directly.
          // If exact decoded binary bytes cannot be determined (e.g. parsed object),
          // fail conservatively with ETOOLARGE!
          if (typeof decodedBytes === 'number') {
            finalBytes = decodedBytes;
          } else if (typeof wireBytes === 'number' && wireBytes > self._maxResponseSize) {
            finalBytes = wireBytes;
          } else {
            finalBytes = (self._maxResponseSize || 0) + 1;
          }
        } else if (isCompressedOrUnexposed) {
          // Unexposed-compression cases (e.g. CORS where Content-Encoding is unexposed):
          if (typeof decodedBytes === 'number') {
            finalBytes = decodedBytes;
          } else if (typeof wireBytes === 'number' && wireBytes > self._maxResponseSize) {
            finalBytes = wireBytes;
          } else if (wireBytes !== undefined) {
            finalBytes = wireBytes;
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
          delete self.username;
          delete self.password;
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
      e.percent = e.loaded / e.total * 100;
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
      const isKnownIdentity = isEncodingEstablished && !isCompressed || isSameOrigin && !ce;
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
        let currentRaw = xhr.response !== undefined && xhr.response !== null ? xhr.response : null;
        if (currentRaw === null) {
          try {
            currentRaw = xhr.responseText;
          } catch (_) {
            currentRaw = null;
          }
        }
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
      xhr.upload.addEventListener('progress', handleProgress.bind(null, 'upload'));
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
  const canRedirect = this._maxRedirects === undefined || this._maxRedirects > 0;
  const canRetry = Boolean(this._maxRetries && this._maxRetries > 0);
  const needsFormDataSerialization = this._maxRequestSize !== undefined || this._maxResponseSize !== undefined || canRetry || canRedirect || Boolean(this._formDataBlob);
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
      if (typeof FormData !== 'undefined' && rawPayload instanceof FormData || rawPayload && typeof rawPayload === 'object' && (Object.prototype.toString.call(rawPayload) === '[object FormData]' || typeof Symbol !== 'undefined' && Symbol.toStringTag && rawPayload[Symbol.toStringTag] === 'FormData' || rawPayload.constructor && (rawPayload.constructor.name === 'FormData' || rawPayload.constructor.name === 'MockFormData'))) {
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
  if (!this._formData && !this._formDataBlob && this.method !== 'GET' && this.method !== 'HEAD' && typeof data !== 'string' && !this._isHost(data)) {
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
    try {
      xhr.responseType = this._responseType;
    } catch (_) {
      // Ignore
    }
  }

  // Record pre-event state to detect if a 'request' listener overrides responseType
  const preEventXhrType = typeof xhr.responseType === 'string' ? xhr.responseType.toLowerCase() : '';
  const preEventReqType = (this._responseType || '').toLowerCase();

  // send stuff
  this.emit('request', this);

  // Check effective responseType AFTER 'request' event:
  // Track any explicit responseType override set via request.responseType()
  // or assigned directly on xhr.responseType (e.g. by a 'request' event listener),
  // including explicitly clearing it to '' (the default/text response type).
  const postEventXhrType = typeof xhr.responseType === 'string' ? xhr.responseType.toLowerCase() : '';
  const postEventReqType = (this._responseType || '').toLowerCase();
  let requestedResponseType = postEventReqType;
  if (postEventXhrType !== preEventXhrType) {
    requestedResponseType = postEventXhrType;
  } else if (postEventReqType !== preEventReqType) {
    requestedResponseType = postEventReqType;
  }
  this._responseType = requestedResponseType;
  if (this._maxResponseSize !== undefined) {
    if (requestedResponseType === 'blob') {
      try {
        xhr.responseType = 'blob';
      } catch (_) {
        // Ignore
      }
      this._forcedArrayBufferForSize = false;
    } else if (requestedResponseType === 'arraybuffer') {
      try {
        xhr.responseType = 'arraybuffer';
      } catch (_) {
        // Ignore
      }
      this._forcedArrayBufferForSize = false;
    } else {
      // For text, json, document, or default (''), configure underlying XHR as 'arraybuffer'
      // to capture and measure the exact decompressed binary byte representation before parsing.
      try {
        xhr.responseType = 'arraybuffer';
        this._forcedArrayBufferForSize = true;
      } catch (_) {
        this._forcedArrayBufferForSize = false;
        if (requestedResponseType) {
          try {
            xhr.responseType = requestedResponseType;
          } catch (_) {
            // Ignore
          }
        }
      }
    }
  } else if (requestedResponseType) {
    try {
      xhr.responseType = requestedResponseType;
    } catch (_) {
      // Ignore
    }
    this._forcedArrayBufferForSize = false;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJyb290Iiwid2luZG93Iiwic2VsZiIsImNvbnNvbGUiLCJ3YXJuIiwiRW1pdHRlciIsInJlcXVpcmUiLCJzYWZlU3RyaW5naWZ5IiwicXMiLCJSZXF1ZXN0QmFzZSIsImlzT2JqZWN0IiwibWl4aW4iLCJoYXNPd24iLCJSZXNwb25zZUJhc2UiLCJBZ2VudCIsIm5vb3AiLCJtb2R1bGUiLCJleHBvcnRzIiwibWV0aG9kIiwidXJsIiwiUmVxdWVzdCIsImVuZCIsImFyZ3VtZW50cyIsImxlbmd0aCIsInJlcXVlc3QiLCJnZXRYSFIiLCJYTUxIdHRwUmVxdWVzdCIsIkVycm9yIiwidHJpbSIsInMiLCJyZXBsYWNlIiwic2VyaWFsaXplIiwib2JqZWN0IiwicGFpcnMiLCJrZXkiLCJwdXNoRW5jb2RlZEtleVZhbHVlUGFpciIsImpvaW4iLCJ2YWx1ZSIsInVuZGVmaW5lZCIsInB1c2giLCJlbmNvZGVVUkkiLCJBcnJheSIsImlzQXJyYXkiLCJ2Iiwic3Via2V5IiwiZW5jb2RlVVJJQ29tcG9uZW50Iiwic2VyaWFsaXplT2JqZWN0IiwicGFyc2VTdHJpbmciLCJzdHJpbmdfIiwic3BsaXQiLCJwYWlyIiwicG9zIiwiaSIsImxlbmd0aF8iLCJpbmRleE9mIiwiZGVjb2RlVVJJQ29tcG9uZW50Iiwic2xpY2UiLCJ0eXBlcyIsImh0bWwiLCJqc29uIiwieG1sIiwidXJsZW5jb2RlZCIsImZvcm0iLCJvYmoiLCJzdHJpbmdpZnkiLCJpbmRpY2VzIiwic3RyaWN0TnVsbEhhbmRsaW5nIiwicGFyc2UiLCJKU09OIiwicGFyc2VIZWFkZXIiLCJsaW5lcyIsImZpZWxkcyIsImluZGV4IiwibGluZSIsImZpZWxkIiwidG9Mb3dlckNhc2UiLCJpc0pTT04iLCJtaW1lIiwidGVzdCIsInNhZmVEZWZpbmVQcm9wZXJ0eSIsInByb3AiLCJnZXR0ZXIiLCJPYmplY3QiLCJkZWZpbmVQcm9wZXJ0eSIsImdldCIsImNvbmZpZ3VyYWJsZSIsIl8iLCJSZXNwb25zZSIsInJlcXVlc3RfIiwicmVxIiwieGhyIiwidGV4dCIsIl9mb3JjZWRBcnJheUJ1ZmZlckZvclNpemUiLCJyZXNwb25zZVR5cGUiLCJyZXNwb25zZVRleHQiLCJzdGF0dXNUZXh0Iiwic3RhdHVzIiwiX3NldFN0YXR1c1Byb3BlcnRpZXMiLCJoZWFkZXJzIiwiZ2V0QWxsUmVzcG9uc2VIZWFkZXJzIiwiaGVhZGVyIiwiZ2V0UmVzcG9uc2VIZWFkZXIiLCJfc2V0SGVhZGVyUHJvcGVydGllcyIsInJlcXVlc3RlZFR5cGUiLCJfcmVzcG9uc2VUeXBlIiwiaXNCdWZmZXIiLCJCdWZmZXIiLCJyZXNwb25zZSIsImlzQXJyYXlCdWZmZXIiLCJBcnJheUJ1ZmZlciIsImlzVmlldyIsImNoYXJzZXQiLCJtYXRjaCIsImV4ZWMiLCJUZXh0RGVjb2RlckNsYXNzIiwiVGV4dERlY29kZXIiLCJmYXRhbCIsImRlY29kZSIsImUiLCJieXRlcyIsIlVpbnQ4QXJyYXkiLCJidWZmZXIiLCJTdHJpbmciLCJmcm9tQ2hhckNvZGUiLCJlc2NhcGUiLCJyZWNvbnN0cnVjdGVkUmVzcG9uc2UiLCJwYXJzZWQiLCJib2R5IiwicGFyc2VkRG9jIiwiRE9NUGFyc2VyIiwiY3QiLCJkb2NUeXBlIiwiaW5jbHVkZXMiLCJwYXJzZUZyb21TdHJpbmciLCJfcGFyc2VCb2R5IiwiZmFsbGJhY2tUZXh0IiwicHJvdG90eXBlIiwidHlwZSIsIl9wYXJzZXIiLCJ0b0Vycm9yIiwibWVzc2FnZSIsImVycm9yIiwiZ2V0VXRmOEJ5dGVMZW5ndGgiLCJ2YWwiLCJzdHIiLCJUZXh0RW5jb2RlciIsImVuY29kZSIsInVuZXNjYXBlIiwiZ2VuZXJhdGVNdWx0aXBhcnRCb3VuZGFyeSIsInJhbmQiLCJjcnlwdG8iLCJnZXRSYW5kb21WYWx1ZXMiLCJ0b1N0cmluZyIsIk1hdGgiLCJmbG9vciIsInJhbmRvbSIsInN1YnN0cmluZyIsImlzQmxvYk9yRmlsZSIsIkJsb2IiLCJGaWxlIiwidGFnIiwiY2FsbCIsInNpemUiLCJidWlsZEZvcm1EYXRhQmxvYiIsImZkIiwiQk9VTkRBUlkiLCJDUkxGIiwicGFydHMiLCJlc2NhcGVIZWFkZXJQYXJhbSIsIm5vcm1hbGl6ZUxpbmVFbmRpbmdzIiwiZW50cmllcyIsIl9mb3JtRmllbGRzIiwiaXRlciIsImN1cnIiLCJuZXh0IiwiZG9uZSIsImZvckVhY2giLCJuYW1lIiwiX2VudHJpZXMiLCJfcGFydHMiLCJfZmllbGRzIiwiaXRlbSIsImN1c3RvbUZpbGVuYW1lIiwiZU5hbWUiLCJmaWxlT3ZlcnJpZGUiLCJmaWxlbmFtZSIsImN1c3RvbUNvbnRlbnRUeXBlIiwiY29udGVudFR5cGUiLCJmaWxlTmFtZSIsIm1pbWVUeXBlIiwiYmxvYiIsIkJsb2JCdWlsZGVyIiwiV2ViS2l0QmxvYkJ1aWxkZXIiLCJNb3pCbG9iQnVpbGRlciIsIk1TQmxvYkJ1aWxkZXIiLCJnbG9iYWwiLCJiYiIsImFwcGVuZCIsImdldEJsb2IiLCJjb21wdXRlRm9ybURhdGFTaXplIiwiaXNLbm93bkVudW1lcmFibGUiLCJfZm9ybURhdGEiLCJfbWF4UmVxdWVzdFNpemUiLCJib3VuZGFyeUxpbmVCeXRlcyIsImNsb3NpbmdCb3VuZGFyeUJ5dGVzIiwidG90YWxCeXRlcyIsImhlYWRlclN0ciIsInZhbHVlU2l6ZSIsImJ5dGVMZW5ndGgiLCJub3JtYWxpemVkU3RyIiwiZ2V0UmVxdWVzdEJvZHlTaXplIiwiZGF0YSIsInRhcmdldERhdGEiLCJVUkxTZWFyY2hQYXJhbXMiLCJTeW1ib2wiLCJ0b1N0cmluZ1RhZyIsImNvbnN0cnVjdG9yIiwiRG9jdW1lbnQiLCJYTUxTZXJpYWxpemVyIiwic2VyaWFsaXplVG9TdHJpbmciLCJGb3JtRGF0YSIsImdldFJlc3BvbnNlSW50cmluc2ljQnl0ZUxlbmd0aCIsImdldFJhd1hockJ5dGVMZW5ndGgiLCJpc1NhbWVPcmlnaW5SZXF1ZXN0IiwicmVxdWVzdFVybCIsImxvYyIsImxvY2F0aW9uIiwib3JpZ2luIiwidGFyZ2V0IiwicmVzcG9uc2VVUkwiLCJ0YXJnZXRPcmlnaW4iLCJVUkwiLCJkb2N1bWVudCIsImNyZWF0ZUVsZW1lbnQiLCJhIiwiaHJlZiIsInByb3RvY29sIiwiaG9zdCIsImlzU2FtZU9yaWdpblVybCIsInRhcmdldFVybCIsInNvdXJjZVVybCIsImJhc2VPcmlnaW4iLCJnZXRJc28yMDIySnBCeXRlTGVuZ3RoIiwiU1RBVEVfQVNDSUkiLCJTVEFURV9ST01BTiIsIlNUQVRFX0pJUyIsImNvdW50Iiwic3RhdGUiLCJjb2RlIiwiY2hhckNvZGVBdCIsImdldEh6R2IyMzEyQnl0ZUxlbmd0aCIsImluQ2hpbmVzZSIsIkdCMTgwMzBfVFdPX0JZVEVfUkFOR0VTIiwiaXNHYjE4MDMwVHdvQnl0ZSIsImxvdyIsImhpZ2giLCJtaWQiLCJnZXREYmNzQnl0ZUxlbmd0aCIsImlzU2ppcyIsImlzR2JrIiwiaXNHYjE4MDMwIiwiaXNFdWNKcCIsImdldFRleHREZWNvZGVkQnl0ZUxlbmd0aCIsImJpbmFyeUJ5dGVzIiwidGV4dEJ5dGVzIiwibWF4IiwiX3F1ZXJ5IiwiX2hlYWRlciIsIm9uIiwiaGFzU2l6ZUVycm9yIiwicmVzIiwiZXJyIiwib3JpZ2luYWwiLCJyYXdSZXNwb25zZSIsInN0YXR1c0NvZGUiLCJjYWxsYmFjayIsImVtaXQiLCJuZXdfZXJyb3IiLCJfaXNSZXNwb25zZU9LIiwic2V0IiwiYWNjZXB0IiwiYXV0aCIsInVzZXIiLCJwYXNzIiwib3B0aW9ucyIsImJ0b2EiLCJlbmNvZGVyIiwic3RyaW5nIiwiX2F1dGgiLCJxdWVyeSIsImF0dGFjaCIsImZpbGUiLCJfZGF0YSIsImFwcGVuZE5hbWUiLCJfZ2V0Rm9ybURhdGEiLCJGb3JtRGF0YUNvbnN0cnVjdG9yIiwiX3Nob3VsZFJldHJ5IiwiX3JldHJ5IiwiY2FsbGVkIiwiZm4iLCJfY2FsbGJhY2siLCJjbGVhclRpbWVvdXQiLCJyZXRyaWVzIiwiX21heFJldHJpZXMiLCJfcmV0cmllcyIsIl9hYm9ydFdpdGhTaXplRXJyb3IiLCJfc2l6ZUVycm9yIiwiYWJvcnQiLCJjcm9zc0RvbWFpbkVycm9yIiwiY3Jvc3NEb21haW4iLCJhZ2VudCIsImNhIiwid3JpdGUiLCJwaXBlIiwiX2lzSG9zdCIsIl9lbmRDYWxsZWQiLCJfZmluYWxpemVRdWVyeVN0cmluZyIsIl9lbmQiLCJfc2V0VXBsb2FkVGltZW91dCIsIl91cGxvYWRUaW1lb3V0IiwiX3VwbG9hZFRpbWVvdXRUaW1lciIsInNldFRpbWVvdXQiLCJfdGltZW91dEVycm9yIiwiX2Fib3J0ZWQiLCJfZm9ybURhdGFCbG9iIiwiX3NldFRpbWVvdXRzIiwiYWRkRXZlbnRMaXN0ZW5lciIsInJlYWR5U3RhdGUiLCJfcmVzcG9uc2VUaW1lb3V0VGltZXIiLCJfbWF4UmVzcG9uc2VTaXplIiwiaXNCb2R5bGVzcyIsImZpbmFsQnl0ZXMiLCJyYXciLCJ3aXJlQnl0ZXMiLCJfcmVzcG9uc2VCeXRlc1JlY2VpdmVkIiwiY2xIZWFkZXIiLCJwYXJzZUludCIsImlzTmFOIiwiX2lnbm9yZUhlYWRlckVycm9yIiwiY3RIZWFkZXIiLCJpc0NvbXByZXNzZWQiLCJpc0VuY29kaW5nRXN0YWJsaXNoZWQiLCJjZSIsImlzSWRlbnRpdHkiLCJpc1NhbWVPcmlnaW4iLCJpc0NvbXByZXNzZWRPclVuZXhwb3NlZCIsImlzS25vd25JZGVudGl0eSIsInJhd0VudGl0eUJ5dGVzIiwiZGVjb2RlZEJ5dGVzIiwibWF4UmVkaXJlY3RzIiwiX21heFJlZGlyZWN0cyIsIl9yZWRpcmVjdHMiLCJfcmVkaXJlY3RMaXN0IiwidXNlcm5hbWUiLCJwYXNzd29yZCIsImtleXMiLCJsayIsInRpbWVkb3V0IiwiaGFuZGxlUHJvZ3Jlc3MiLCJkaXJlY3Rpb24iLCJ0b3RhbCIsInBlcmNlbnQiLCJsb2FkZWQiLCJjdXJyZW50RGVjb2RlZCIsImN1cnJlbnRSYXciLCJoYXNMaXN0ZW5lcnMiLCJiaW5kIiwidXBsb2FkIiwib3BlbiIsIl93aXRoQ3JlZGVudGlhbHMiLCJ3aXRoQ3JlZGVudGlhbHMiLCJjYW5SZWRpcmVjdCIsImNhblJldHJ5IiwiQm9vbGVhbiIsIm5lZWRzRm9ybURhdGFTZXJpYWxpemF0aW9uIiwicmF3UGF5bG9hZCIsImZvcm1EYXRhQmxvYiIsImNvbXB1dGVkU2l6ZSIsIl9zZXJpYWxpemVyIiwic2V0UmVxdWVzdEhlYWRlciIsInByZUV2ZW50WGhyVHlwZSIsInByZUV2ZW50UmVxVHlwZSIsInBvc3RFdmVudFhoclR5cGUiLCJwb3N0RXZlbnRSZXFUeXBlIiwicmVxdWVzdGVkUmVzcG9uc2VUeXBlIiwicGF5bG9hZCIsInNlbmQiLCJfc2V0RGVmYXVsdHMiLCJkZWwiLCJkZWxldGUiLCJoZWFkIiwicGF0Y2giLCJwb3N0IiwicHV0Il0sInNvdXJjZXMiOlsiLi4vc3JjL2NsaWVudC5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFJvb3QgcmVmZXJlbmNlIGZvciBpZnJhbWVzLlxuICovXG5cbmxldCByb290O1xuaWYgKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnKSB7XG4gIC8vIEJyb3dzZXIgd2luZG93XG4gIHJvb3QgPSB3aW5kb3c7XG59IGVsc2UgaWYgKHR5cGVvZiBzZWxmID09PSAndW5kZWZpbmVkJykge1xuICAvLyBPdGhlciBlbnZpcm9ubWVudHNcbiAgY29uc29sZS53YXJuKFxuICAgICdVc2luZyBicm93c2VyLW9ubHkgdmVyc2lvbiBvZiBzdXBlcmFnZW50IGluIG5vbi1icm93c2VyIGVudmlyb25tZW50J1xuICApO1xuICByb290ID0gdGhpcztcbn0gZWxzZSB7XG4gIC8vIFdlYiBXb3JrZXJcbiAgcm9vdCA9IHNlbGY7XG59XG5cbmNvbnN0IEVtaXR0ZXIgPSByZXF1aXJlKCdjb21wb25lbnQtZW1pdHRlcicpO1xuY29uc3Qgc2FmZVN0cmluZ2lmeSA9IHJlcXVpcmUoJ2Zhc3Qtc2FmZS1zdHJpbmdpZnknKTtcbmNvbnN0IHFzID0gcmVxdWlyZSgncXMnKTtcbmNvbnN0IFJlcXVlc3RCYXNlID0gcmVxdWlyZSgnLi9yZXF1ZXN0LWJhc2UnKTtcbmNvbnN0IHsgaXNPYmplY3QsIG1peGluLCBoYXNPd24gfSA9IHJlcXVpcmUoJy4vdXRpbHMnKTtcbmNvbnN0IFJlc3BvbnNlQmFzZSA9IHJlcXVpcmUoJy4vcmVzcG9uc2UtYmFzZScpO1xuY29uc3QgQWdlbnQgPSByZXF1aXJlKCcuL2FnZW50LWJhc2UnKTtcblxuLyoqXG4gKiBOb29wLlxuICovXG5cbmZ1bmN0aW9uIG5vb3AoKSB7fVxuXG4vKipcbiAqIEV4cG9zZSBgcmVxdWVzdGAuXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAobWV0aG9kLCB1cmwpIHtcbiAgLy8gY2FsbGJhY2tcbiAgaWYgKHR5cGVvZiB1cmwgPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gbmV3IGV4cG9ydHMuUmVxdWVzdCgnR0VUJywgbWV0aG9kKS5lbmQodXJsKTtcbiAgfVxuXG4gIC8vIHVybCBmaXJzdFxuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSkge1xuICAgIHJldHVybiBuZXcgZXhwb3J0cy5SZXF1ZXN0KCdHRVQnLCBtZXRob2QpO1xuICB9XG5cbiAgcmV0dXJuIG5ldyBleHBvcnRzLlJlcXVlc3QobWV0aG9kLCB1cmwpO1xufTtcblxuZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzO1xuXG5jb25zdCByZXF1ZXN0ID0gZXhwb3J0cztcblxuZXhwb3J0cy5SZXF1ZXN0ID0gUmVxdWVzdDtcblxuLyoqXG4gKiBEZXRlcm1pbmUgWEhSLlxuICovXG5cbnJlcXVlc3QuZ2V0WEhSID0gKCkgPT4ge1xuICBpZiAocm9vdC5YTUxIdHRwUmVxdWVzdCkge1xuICAgIHJldHVybiBuZXcgcm9vdC5YTUxIdHRwUmVxdWVzdCgpO1xuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKCdCcm93c2VyLW9ubHkgdmVyc2lvbiBvZiBzdXBlcmFnZW50IGNvdWxkIG5vdCBmaW5kIFhIUicpO1xufTtcblxuLyoqXG4gKiBSZW1vdmVzIGxlYWRpbmcgYW5kIHRyYWlsaW5nIHdoaXRlc3BhY2UsIGFkZGVkIHRvIHN1cHBvcnQgSUUuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHNcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmNvbnN0IHRyaW0gPSAnJy50cmltID8gKHMpID0+IHMudHJpbSgpIDogKHMpID0+IHMucmVwbGFjZSgvKF5cXHMqfFxccyokKS9nLCAnJyk7XG5cbi8qKlxuICogU2VyaWFsaXplIHRoZSBnaXZlbiBgb2JqYC5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBzZXJpYWxpemUob2JqZWN0KSB7XG4gIGlmICghaXNPYmplY3Qob2JqZWN0KSkgcmV0dXJuIG9iamVjdDtcbiAgY29uc3QgcGFpcnMgPSBbXTtcbiAgZm9yIChjb25zdCBrZXkgaW4gb2JqZWN0KSB7XG4gICAgaWYgKGhhc093bihvYmplY3QsIGtleSkpIHB1c2hFbmNvZGVkS2V5VmFsdWVQYWlyKHBhaXJzLCBrZXksIG9iamVjdFtrZXldKTtcbiAgfVxuXG4gIHJldHVybiBwYWlycy5qb2luKCcmJyk7XG59XG5cbi8qKlxuICogSGVscHMgJ3NlcmlhbGl6ZScgd2l0aCBzZXJpYWxpemluZyBhcnJheXMuXG4gKiBNdXRhdGVzIHRoZSBwYWlycyBhcnJheS5cbiAqXG4gKiBAcGFyYW0ge0FycmF5fSBwYWlyc1xuICogQHBhcmFtIHtTdHJpbmd9IGtleVxuICogQHBhcmFtIHtNaXhlZH0gdmFsXG4gKi9cblxuZnVuY3Rpb24gcHVzaEVuY29kZWRLZXlWYWx1ZVBhaXIocGFpcnMsIGtleSwgdmFsdWUpIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybjtcbiAgaWYgKHZhbHVlID09PSBudWxsKSB7XG4gICAgcGFpcnMucHVzaChlbmNvZGVVUkkoa2V5KSk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgZm9yIChjb25zdCB2IG9mIHZhbHVlKSB7XG4gICAgICBwdXNoRW5jb2RlZEtleVZhbHVlUGFpcihwYWlycywga2V5LCB2KTtcbiAgICB9XG4gIH0gZWxzZSBpZiAoaXNPYmplY3QodmFsdWUpKSB7XG4gICAgZm9yIChjb25zdCBzdWJrZXkgaW4gdmFsdWUpIHtcbiAgICAgIGlmIChoYXNPd24odmFsdWUsIHN1YmtleSkpXG4gICAgICAgIHB1c2hFbmNvZGVkS2V5VmFsdWVQYWlyKHBhaXJzLCBgJHtrZXl9WyR7c3Via2V5fV1gLCB2YWx1ZVtzdWJrZXldKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgcGFpcnMucHVzaChlbmNvZGVVUkkoa2V5KSArICc9JyArIGVuY29kZVVSSUNvbXBvbmVudCh2YWx1ZSkpO1xuICB9XG59XG5cbi8qKlxuICogRXhwb3NlIHNlcmlhbGl6YXRpb24gbWV0aG9kLlxuICovXG5cbnJlcXVlc3Quc2VyaWFsaXplT2JqZWN0ID0gc2VyaWFsaXplO1xuXG4vKipcbiAqIFBhcnNlIHRoZSBnaXZlbiB4LXd3dy1mb3JtLXVybGVuY29kZWQgYHN0cmAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHN0clxuICogQHJldHVybiB7T2JqZWN0fVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gcGFyc2VTdHJpbmcoc3RyaW5nXykge1xuICBjb25zdCBvYmplY3QgPSB7fTtcbiAgY29uc3QgcGFpcnMgPSBzdHJpbmdfLnNwbGl0KCcmJyk7XG4gIGxldCBwYWlyO1xuICBsZXQgcG9zO1xuXG4gIGZvciAobGV0IGkgPSAwLCBsZW5ndGhfID0gcGFpcnMubGVuZ3RoOyBpIDwgbGVuZ3RoXzsgKytpKSB7XG4gICAgcGFpciA9IHBhaXJzW2ldO1xuICAgIHBvcyA9IHBhaXIuaW5kZXhPZignPScpO1xuICAgIGlmIChwb3MgPT09IC0xKSB7XG4gICAgICBvYmplY3RbZGVjb2RlVVJJQ29tcG9uZW50KHBhaXIpXSA9ICcnO1xuICAgIH0gZWxzZSB7XG4gICAgICBvYmplY3RbZGVjb2RlVVJJQ29tcG9uZW50KHBhaXIuc2xpY2UoMCwgcG9zKSldID0gZGVjb2RlVVJJQ29tcG9uZW50KFxuICAgICAgICBwYWlyLnNsaWNlKHBvcyArIDEpXG4gICAgICApO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBvYmplY3Q7XG59XG5cbi8qKlxuICogRXhwb3NlIHBhcnNlci5cbiAqL1xuXG5yZXF1ZXN0LnBhcnNlU3RyaW5nID0gcGFyc2VTdHJpbmc7XG5cbi8qKlxuICogRGVmYXVsdCBNSU1FIHR5cGUgbWFwLlxuICpcbiAqICAgICBzdXBlcmFnZW50LnR5cGVzLnhtbCA9ICdhcHBsaWNhdGlvbi94bWwnO1xuICpcbiAqL1xuXG5yZXF1ZXN0LnR5cGVzID0ge1xuICBodG1sOiAndGV4dC9odG1sJyxcbiAganNvbjogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICB4bWw6ICd0ZXh0L3htbCcsXG4gIHVybGVuY29kZWQ6ICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnLFxuICBmb3JtOiAnYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJyxcbiAgJ2Zvcm0tZGF0YSc6ICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnXG59O1xuXG4vKipcbiAqIERlZmF1bHQgc2VyaWFsaXphdGlvbiBtYXAuXG4gKlxuICogICAgIHN1cGVyYWdlbnQuc2VyaWFsaXplWydhcHBsaWNhdGlvbi94bWwnXSA9IGZ1bmN0aW9uKG9iail7XG4gKiAgICAgICByZXR1cm4gJ2dlbmVyYXRlZCB4bWwgaGVyZSc7XG4gKiAgICAgfTtcbiAqXG4gKi9cblxucmVxdWVzdC5zZXJpYWxpemUgPSB7XG4gICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnOiAob2JqKSA9PiB7XG4gICAgcmV0dXJuIHFzLnN0cmluZ2lmeShvYmosIHsgaW5kaWNlczogZmFsc2UsIHN0cmljdE51bGxIYW5kbGluZzogdHJ1ZSB9KTtcbiAgfSxcbiAgJ2FwcGxpY2F0aW9uL2pzb24nOiBzYWZlU3RyaW5naWZ5XG59O1xuXG4vKipcbiAqIERlZmF1bHQgcGFyc2Vycy5cbiAqXG4gKiAgICAgc3VwZXJhZ2VudC5wYXJzZVsnYXBwbGljYXRpb24veG1sJ10gPSBmdW5jdGlvbihzdHIpe1xuICogICAgICAgcmV0dXJuIHsgb2JqZWN0IHBhcnNlZCBmcm9tIHN0ciB9O1xuICogICAgIH07XG4gKlxuICovXG5cbnJlcXVlc3QucGFyc2UgPSB7XG4gICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnOiBwYXJzZVN0cmluZyxcbiAgJ2FwcGxpY2F0aW9uL2pzb24nOiBKU09OLnBhcnNlXG59O1xuXG4vKipcbiAqIFBhcnNlIHRoZSBnaXZlbiBoZWFkZXIgYHN0cmAgaW50b1xuICogYW4gb2JqZWN0IGNvbnRhaW5pbmcgdGhlIG1hcHBlZCBmaWVsZHMuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHN0clxuICogQHJldHVybiB7T2JqZWN0fVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gcGFyc2VIZWFkZXIoc3RyaW5nXykge1xuICBjb25zdCBsaW5lcyA9IHN0cmluZ18uc3BsaXQoL1xccj9cXG4vKTtcbiAgY29uc3QgZmllbGRzID0ge307XG4gIGxldCBpbmRleDtcbiAgbGV0IGxpbmU7XG4gIGxldCBmaWVsZDtcbiAgbGV0IHZhbHVlO1xuXG4gIGZvciAobGV0IGkgPSAwLCBsZW5ndGhfID0gbGluZXMubGVuZ3RoOyBpIDwgbGVuZ3RoXzsgKytpKSB7XG4gICAgbGluZSA9IGxpbmVzW2ldO1xuICAgIGluZGV4ID0gbGluZS5pbmRleE9mKCc6Jyk7XG4gICAgaWYgKGluZGV4ID09PSAtMSkge1xuICAgICAgLy8gY291bGQgYmUgZW1wdHkgbGluZSwganVzdCBza2lwIGl0XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBmaWVsZCA9IGxpbmUuc2xpY2UoMCwgaW5kZXgpLnRvTG93ZXJDYXNlKCk7XG4gICAgdmFsdWUgPSB0cmltKGxpbmUuc2xpY2UoaW5kZXggKyAxKSk7XG4gICAgZmllbGRzW2ZpZWxkXSA9IHZhbHVlO1xuICB9XG5cbiAgcmV0dXJuIGZpZWxkcztcbn1cblxuLyoqXG4gKiBDaGVjayBpZiBgbWltZWAgaXMganNvbiBvciBoYXMgK2pzb24gc3RydWN0dXJlZCBzeW50YXggc3VmZml4LlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBtaW1lXG4gKiBAcmV0dXJuIHtCb29sZWFufVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gaXNKU09OKG1pbWUpIHtcbiAgLy8gc2hvdWxkIG1hdGNoIC9qc29uIG9yICtqc29uXG4gIC8vIGJ1dCBub3QgL2pzb24tc2VxXG4gIHJldHVybiAvWy8rXWpzb24oJHxbXi1cXHddKS9pLnRlc3QobWltZSk7XG59XG5cbi8qKlxuICogSW5pdGlhbGl6ZSBhIG5ldyBgUmVzcG9uc2VgIHdpdGggdGhlIGdpdmVuIGB4aHJgLlxuICpcbiAqICAtIHNldCBmbGFncyAoLm9rLCAuZXJyb3IsIGV0YylcbiAqICAtIHBhcnNlIGhlYWRlclxuICpcbiAqIEV4YW1wbGVzOlxuICpcbiAqICBBbGlhc2luZyBgc3VwZXJhZ2VudGAgYXMgYHJlcXVlc3RgIGlzIG5pY2U6XG4gKlxuICogICAgICByZXF1ZXN0ID0gc3VwZXJhZ2VudDtcbiAqXG4gKiAgV2UgY2FuIHVzZSB0aGUgcHJvbWlzZS1saWtlIEFQSSwgb3IgcGFzcyBjYWxsYmFja3M6XG4gKlxuICogICAgICByZXF1ZXN0LmdldCgnLycpLmVuZChmdW5jdGlvbihyZXMpe30pO1xuICogICAgICByZXF1ZXN0LmdldCgnLycsIGZ1bmN0aW9uKHJlcyl7fSk7XG4gKlxuICogIFNlbmRpbmcgZGF0YSBjYW4gYmUgY2hhaW5lZDpcbiAqXG4gKiAgICAgIHJlcXVlc3RcbiAqICAgICAgICAucG9zdCgnL3VzZXInKVxuICogICAgICAgIC5zZW5kKHsgbmFtZTogJ3RqJyB9KVxuICogICAgICAgIC5lbmQoZnVuY3Rpb24ocmVzKXt9KTtcbiAqXG4gKiAgT3IgcGFzc2VkIHRvIGAuc2VuZCgpYDpcbiAqXG4gKiAgICAgIHJlcXVlc3RcbiAqICAgICAgICAucG9zdCgnL3VzZXInKVxuICogICAgICAgIC5zZW5kKHsgbmFtZTogJ3RqJyB9LCBmdW5jdGlvbihyZXMpe30pO1xuICpcbiAqICBPciBwYXNzZWQgdG8gYC5wb3N0KClgOlxuICpcbiAqICAgICAgcmVxdWVzdFxuICogICAgICAgIC5wb3N0KCcvdXNlcicsIHsgbmFtZTogJ3RqJyB9KVxuICogICAgICAgIC5lbmQoZnVuY3Rpb24ocmVzKXt9KTtcbiAqXG4gKiBPciBmdXJ0aGVyIHJlZHVjZWQgdG8gYSBzaW5nbGUgY2FsbCBmb3Igc2ltcGxlIGNhc2VzOlxuICpcbiAqICAgICAgcmVxdWVzdFxuICogICAgICAgIC5wb3N0KCcvdXNlcicsIHsgbmFtZTogJ3RqJyB9LCBmdW5jdGlvbihyZXMpe30pO1xuICpcbiAqIEBwYXJhbSB7WE1MSFRUUFJlcXVlc3R9IHhoclxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnNcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbi8qKlxuICogU2FmZWx5IGRlZmluZSBhbiBhY2Nlc3NvciBwcm9wZXJ0eSBvbiBhbiBvYmplY3Qgd2l0aG91dCB0aHJvd2luZyBpZiBub24tY29uZmlndXJhYmxlLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmpcbiAqIEBwYXJhbSB7U3RyaW5nfSBwcm9wXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBnZXR0ZXJcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5mdW5jdGlvbiBzYWZlRGVmaW5lUHJvcGVydHkob2JqLCBwcm9wLCBnZXR0ZXIpIHtcbiAgaWYgKCFvYmopIHJldHVybjtcbiAgdHJ5IHtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBwcm9wLCB7XG4gICAgICBnZXQ6IGdldHRlcixcbiAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICAgIH0pO1xuICB9IGNhdGNoIChfKSB7XG4gICAgLy8gSWdub3JlIGlmIHByb3BlcnR5IGlzIG5vbi1jb25maWd1cmFibGUgb24gaG9zdCBvYmplY3RcbiAgfVxufVxuXG5mdW5jdGlvbiBSZXNwb25zZShyZXF1ZXN0Xykge1xuICB0aGlzLnJlcSA9IHJlcXVlc3RfO1xuICB0aGlzLnhociA9IHRoaXMucmVxLnhocjtcbiAgLy8gcmVzcG9uc2VUZXh0IGlzIGFjY2Vzc2libGUgb25seSBpZiByZXNwb25zZVR5cGUgaXMgJycgb3IgJ3RleHQnIGFuZCBvbiBvbGRlciBicm93c2Vyc1xuICB0aGlzLnRleHQgPVxuICAgICF0aGlzLnJlcS5fZm9yY2VkQXJyYXlCdWZmZXJGb3JTaXplICYmXG4gICAgKCh0aGlzLnJlcS5tZXRob2QgIT09ICdIRUFEJyAmJlxuICAgICAgKHRoaXMueGhyLnJlc3BvbnNlVHlwZSA9PT0gJycgfHwgdGhpcy54aHIucmVzcG9uc2VUeXBlID09PSAndGV4dCcpKSB8fFxuICAgICAgdHlwZW9mIHRoaXMueGhyLnJlc3BvbnNlVHlwZSA9PT0gJ3VuZGVmaW5lZCcpXG4gICAgICA/IHRoaXMueGhyLnJlc3BvbnNlVGV4dFxuICAgICAgOiBudWxsO1xuICB0aGlzLnN0YXR1c1RleHQgPSB0aGlzLnJlcS54aHIuc3RhdHVzVGV4dDtcbiAgbGV0IHsgc3RhdHVzIH0gPSB0aGlzLnhocjtcbiAgLy8gaGFuZGxlIElFOSBidWc6IGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9xdWVzdGlvbnMvMTAwNDY5NzIvbXNpZS1yZXR1cm5zLXN0YXR1cy1jb2RlLW9mLTEyMjMtZm9yLWFqYXgtcmVxdWVzdFxuICBpZiAoc3RhdHVzID09PSAxMjIzKSB7XG4gICAgc3RhdHVzID0gMjA0O1xuICB9XG5cbiAgdGhpcy5fc2V0U3RhdHVzUHJvcGVydGllcyhzdGF0dXMpO1xuICB0aGlzLmhlYWRlcnMgPSBwYXJzZUhlYWRlcih0aGlzLnhoci5nZXRBbGxSZXNwb25zZUhlYWRlcnMoKSk7XG4gIHRoaXMuaGVhZGVyID0gdGhpcy5oZWFkZXJzO1xuICAvLyBnZXRBbGxSZXNwb25zZUhlYWRlcnMgc29tZXRpbWVzIGZhbHNlbHkgcmV0dXJucyBcIlwiIGZvciBDT1JTIHJlcXVlc3RzLCBidXRcbiAgLy8gZ2V0UmVzcG9uc2VIZWFkZXIgc3RpbGwgd29ya3MuIHNvIHdlIGdldCBjb250ZW50LXR5cGUgZXZlbiBpZiBnZXR0aW5nXG4gIC8vIG90aGVyIGhlYWRlcnMgZmFpbHMuXG4gIHRoaXMuaGVhZGVyWydjb250ZW50LXR5cGUnXSA9IHRoaXMueGhyLmdldFJlc3BvbnNlSGVhZGVyKCdjb250ZW50LXR5cGUnKTtcbiAgdGhpcy5fc2V0SGVhZGVyUHJvcGVydGllcyh0aGlzLmhlYWRlcik7XG5cbiAgaWYgKHRoaXMucmVxLl9mb3JjZWRBcnJheUJ1ZmZlckZvclNpemUpIHtcbiAgICBjb25zdCByZXF1ZXN0ZWRUeXBlID0gdGhpcy5yZXEuX3Jlc3BvbnNlVHlwZSB8fCAnJztcbiAgICBzYWZlRGVmaW5lUHJvcGVydHkodGhpcy54aHIsICdyZXNwb25zZVR5cGUnLCAoKSA9PiByZXF1ZXN0ZWRUeXBlKTtcblxuICAgIGNvbnN0IGlzQnVmZmVyID0gdHlwZW9mIEJ1ZmZlciAhPT0gJ3VuZGVmaW5lZCcgJiYgQnVmZmVyLmlzQnVmZmVyKHRoaXMueGhyLnJlc3BvbnNlKTtcbiAgICBjb25zdCBpc0FycmF5QnVmZmVyID0gdHlwZW9mIEFycmF5QnVmZmVyICE9PSAndW5kZWZpbmVkJyAmJiB0aGlzLnhoci5yZXNwb25zZSBpbnN0YW5jZW9mIEFycmF5QnVmZmVyO1xuICAgIGNvbnN0IGlzVmlldyA9IHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXlCdWZmZXIuaXNWaWV3KHRoaXMueGhyLnJlc3BvbnNlKTtcblxuICAgIGlmIChpc0J1ZmZlciB8fCBpc0FycmF5QnVmZmVyIHx8IGlzVmlldykge1xuICAgICAgbGV0IGNoYXJzZXQgPSAndXRmLTgnO1xuICAgICAgY29uc3QgbWF0Y2ggPSB0aGlzLmhlYWRlclsnY29udGVudC10eXBlJ10gPyAvY2hhcnNldFxccyo9XFxzKlsnXCJdPyhbXjsnXCJdKylbJ1wiXT8vaS5leGVjKHRoaXMuaGVhZGVyWydjb250ZW50LXR5cGUnXSkgOiBudWxsO1xuICAgICAgaWYgKG1hdGNoKSBjaGFyc2V0ID0gbWF0Y2hbMV0udHJpbSgpLnRvTG93ZXJDYXNlKCk7XG5cbiAgICAgIGxldCB0ZXh0ID0gJyc7XG4gICAgICBjb25zdCBUZXh0RGVjb2RlckNsYXNzID0gdHlwZW9mIFRleHREZWNvZGVyICE9PSAndW5kZWZpbmVkJ1xuICAgICAgICA/IFRleHREZWNvZGVyXG4gICAgICAgIDogKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIHJldHVybiByZXF1aXJlKCd1dGlsJykuVGV4dERlY29kZXI7XG4gICAgICAgICAgICB9IGNhdGNoIChfKSB7XG4gICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pKCk7XG5cbiAgICAgIGlmIChUZXh0RGVjb2RlckNsYXNzKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgdGV4dCA9IG5ldyBUZXh0RGVjb2RlckNsYXNzKGNoYXJzZXQsIHsgZmF0YWw6IGZhbHNlIH0pLmRlY29kZSh0aGlzLnhoci5yZXNwb25zZSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICB0ZXh0ID0gbmV3IFRleHREZWNvZGVyQ2xhc3MoJ3V0Zi04JykuZGVjb2RlKHRoaXMueGhyLnJlc3BvbnNlKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgYnl0ZXMgPSBuZXcgVWludDhBcnJheShpc0J1ZmZlciB8fCBpc1ZpZXcgPyB0aGlzLnhoci5yZXNwb25zZS5idWZmZXIgOiB0aGlzLnhoci5yZXNwb25zZSk7XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICB0ZXh0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnl0ZXNbaV0pO1xuICAgICAgICB9XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgdGV4dCA9IGRlY29kZVVSSUNvbXBvbmVudChlc2NhcGUodGV4dCkpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgLy8gSWdub3JlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHRoaXMudGV4dCA9IHRleHQ7XG4gICAgICBsZXQgcmVjb25zdHJ1Y3RlZFJlc3BvbnNlID0gdGV4dDtcbiAgICAgIGlmICh0aGlzLnJlcS5fcmVzcG9uc2VUeXBlID09PSAnanNvbicpIHtcbiAgICAgICAgbGV0IHBhcnNlZCA9IG51bGw7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcGFyc2VkID0gSlNPTi5wYXJzZSh0ZXh0KTtcbiAgICAgICAgfSBjYXRjaCAoXykge1xuICAgICAgICAgIHBhcnNlZCA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5ib2R5ID0gcGFyc2VkO1xuICAgICAgICB0aGlzLnRleHQgPSBudWxsO1xuICAgICAgICByZWNvbnN0cnVjdGVkUmVzcG9uc2UgPSBwYXJzZWQ7XG4gICAgICB9IGVsc2UgaWYgKHRoaXMucmVxLl9yZXNwb25zZVR5cGUgPT09ICdkb2N1bWVudCcpIHtcbiAgICAgICAgbGV0IHBhcnNlZERvYyA9IG51bGw7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgaWYgKHR5cGVvZiBET01QYXJzZXIgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgICBjb25zdCBjdCA9IHRoaXMuaGVhZGVyWydjb250ZW50LXR5cGUnXSB8fCAnJztcbiAgICAgICAgICAgIGNvbnN0IGRvY1R5cGUgPSBjdC5pbmNsdWRlcygnaHRtbCcpID8gJ3RleHQvaHRtbCcgOiAoY3QuaW5jbHVkZXMoJ3N2ZycpID8gJ2ltYWdlL3N2Zyt4bWwnIDogJ2FwcGxpY2F0aW9uL3htbCcpO1xuICAgICAgICAgICAgcGFyc2VkRG9jID0gbmV3IERPTVBhcnNlcigpLnBhcnNlRnJvbVN0cmluZyh0ZXh0LCBkb2NUeXBlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKF8pIHtcbiAgICAgICAgICBwYXJzZWREb2MgPSBudWxsO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuYm9keSA9IHBhcnNlZERvYztcbiAgICAgICAgdGhpcy50ZXh0ID0gbnVsbDtcbiAgICAgICAgcmVjb25zdHJ1Y3RlZFJlc3BvbnNlID0gcGFyc2VkRG9jO1xuICAgICAgfSBlbHNlIGlmICh0aGlzLnJlcS5fcmVzcG9uc2VUeXBlID09PSAndGV4dCcpIHtcbiAgICAgICAgdGhpcy50ZXh0ID0gdGV4dDtcbiAgICAgICAgdGhpcy5ib2R5ID0gdGV4dDtcbiAgICAgICAgcmVjb25zdHJ1Y3RlZFJlc3BvbnNlID0gdGV4dDtcbiAgICAgIH0gZWxzZSBpZiAoIXRoaXMucmVxLl9yZXNwb25zZVR5cGUpIHtcbiAgICAgICAgdGhpcy50ZXh0ID0gdGV4dDtcbiAgICAgICAgdGhpcy5ib2R5ID0gdGhpcy5fcGFyc2VCb2R5KHRleHQpO1xuICAgICAgICByZWNvbnN0cnVjdGVkUmVzcG9uc2UgPSB0ZXh0O1xuICAgICAgfVxuXG4gICAgICAvLyBTYWZlbHkgZW11bGF0ZSBYSFIgcHJvcGVydGllcyBmb3IgY2FsbGVycyBpbnNwZWN0aW5nIHRoZSB1bmRlcmx5aW5nIFhIUiBkaXJlY3RseVxuICAgICAgc2FmZURlZmluZVByb3BlcnR5KHRoaXMueGhyLCAncmVzcG9uc2VUZXh0JywgKCkgPT4gdGV4dCk7XG4gICAgICBzYWZlRGVmaW5lUHJvcGVydHkodGhpcy54aHIsICdyZXNwb25zZScsICgpID0+IHJlY29uc3RydWN0ZWRSZXNwb25zZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxldCBmYWxsYmFja1RleHQgPSBudWxsO1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLnhoci5yZXNwb25zZVRleHQgPT09ICdzdHJpbmcnKSBmYWxsYmFja1RleHQgPSB0aGlzLnhoci5yZXNwb25zZVRleHQ7XG4gICAgICB9IGNhdGNoIChfKSB7XG4gICAgICAgIC8vIElnbm9yZSBJbnZhbGlkU3RhdGVFcnJvciBvbiBuYXRpdmUgYmluYXJ5IFhIUlxuICAgICAgfVxuICAgICAgaWYgKGZhbGxiYWNrVGV4dCA9PT0gbnVsbCAmJiB0eXBlb2YgdGhpcy54aHIucmVzcG9uc2UgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIGZhbGxiYWNrVGV4dCA9IHRoaXMueGhyLnJlc3BvbnNlO1xuICAgICAgfVxuICAgICAgdGhpcy50ZXh0ID0gZmFsbGJhY2tUZXh0O1xuICAgIH1cbiAgfVxuXG4gIGlmICh0aGlzLmJvZHkgIT09IHVuZGVmaW5lZCkge1xuICAgIC8vIEFscmVhZHkgcmVjb25zdHJ1Y3RlZCB1bmRlciBzaXplIGxpbWl0c1xuICB9IGVsc2UgaWYgKHRoaXMudGV4dCA9PT0gbnVsbCAmJiB0aGlzLnJlcS5fcmVzcG9uc2VUeXBlKSB7XG4gICAgdGhpcy5ib2R5ID0gdGhpcy54aHIucmVzcG9uc2U7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5ib2R5ID1cbiAgICAgIHRoaXMucmVxLm1ldGhvZCA9PT0gJ0hFQUQnXG4gICAgICAgID8gbnVsbFxuICAgICAgICA6IHRoaXMuX3BhcnNlQm9keSh0eXBlb2YgdGhpcy50ZXh0ID09PSAnc3RyaW5nJyA/IHRoaXMudGV4dCA6IHRoaXMueGhyLnJlc3BvbnNlKTtcbiAgfVxufVxuXG5taXhpbihSZXNwb25zZS5wcm90b3R5cGUsIFJlc3BvbnNlQmFzZS5wcm90b3R5cGUpO1xuXG4vKipcbiAqIFBhcnNlIHRoZSBnaXZlbiBib2R5IGBzdHJgLlxuICpcbiAqIFVzZWQgZm9yIGF1dG8tcGFyc2luZyBvZiBib2RpZXMuIFBhcnNlcnNcbiAqIGFyZSBkZWZpbmVkIG9uIHRoZSBgc3VwZXJhZ2VudC5wYXJzZWAgb2JqZWN0LlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBzdHJcbiAqIEByZXR1cm4ge01peGVkfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuUmVzcG9uc2UucHJvdG90eXBlLl9wYXJzZUJvZHkgPSBmdW5jdGlvbiAoc3RyaW5nXykge1xuICBsZXQgcGFyc2UgPSByZXF1ZXN0LnBhcnNlW3RoaXMudHlwZV07XG4gIGlmICh0aGlzLnJlcS5fcGFyc2VyKSB7XG4gICAgcmV0dXJuIHRoaXMucmVxLl9wYXJzZXIodGhpcywgc3RyaW5nXyk7XG4gIH1cblxuICBpZiAoIXBhcnNlICYmIGlzSlNPTih0aGlzLnR5cGUpKSB7XG4gICAgcGFyc2UgPSByZXF1ZXN0LnBhcnNlWydhcHBsaWNhdGlvbi9qc29uJ107XG4gIH1cblxuICByZXR1cm4gcGFyc2UgJiYgc3RyaW5nXyAmJiAoc3RyaW5nXy5sZW5ndGggPiAwIHx8IHN0cmluZ18gaW5zdGFuY2VvZiBPYmplY3QpXG4gICAgPyBwYXJzZShzdHJpbmdfKVxuICAgIDogbnVsbDtcbn07XG5cbi8qKlxuICogUmV0dXJuIGFuIGBFcnJvcmAgcmVwcmVzZW50YXRpdmUgb2YgdGhpcyByZXNwb25zZS5cbiAqXG4gKiBAcmV0dXJuIHtFcnJvcn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVzcG9uc2UucHJvdG90eXBlLnRvRXJyb3IgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IHsgcmVxIH0gPSB0aGlzO1xuICBjb25zdCB7IG1ldGhvZCB9ID0gcmVxO1xuICBjb25zdCB7IHVybCB9ID0gcmVxO1xuXG4gIGNvbnN0IG1lc3NhZ2UgPSBgY2Fubm90ICR7bWV0aG9kfSAke3VybH0gKCR7dGhpcy5zdGF0dXN9KWA7XG4gIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKG1lc3NhZ2UpO1xuICBlcnJvci5zdGF0dXMgPSB0aGlzLnN0YXR1cztcbiAgZXJyb3IubWV0aG9kID0gbWV0aG9kO1xuICBlcnJvci51cmwgPSB1cmw7XG5cbiAgcmV0dXJuIGVycm9yO1xufTtcblxuLyoqXG4gKiBFeHBvc2UgYFJlc3BvbnNlYC5cbiAqL1xuXG5yZXF1ZXN0LlJlc3BvbnNlID0gUmVzcG9uc2U7XG5cbi8qKlxuICogSW5pdGlhbGl6ZSBhIG5ldyBgUmVxdWVzdGAgd2l0aCB0aGUgZ2l2ZW4gYG1ldGhvZGAgYW5kIGB1cmxgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBtZXRob2RcbiAqIEBwYXJhbSB7U3RyaW5nfSB1cmxcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuXG4vKipcbiAqIENhbGN1bGF0ZSBVVEYtOCBieXRlIGxlbmd0aCBmb3Igc3RyaW5nIGRhdGEgaW4gdGhlIGJyb3dzZXIuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHZhbFxuICogQHJldHVybiB7TnVtYmVyfSBieXRlIGxlbmd0aFxuICogQGFwaSBwcml2YXRlXG4gKi9cbmZ1bmN0aW9uIGdldFV0ZjhCeXRlTGVuZ3RoKHZhbCkge1xuICBpZiAodmFsID09IG51bGwpIHJldHVybiAwO1xuICBjb25zdCBzdHIgPSB0eXBlb2YgdmFsID09PSAnc3RyaW5nJyA/IHZhbCA6IFN0cmluZyh2YWwpO1xuICBpZiAodHlwZW9mIFRleHRFbmNvZGVyICE9PSAndW5kZWZpbmVkJykge1xuICAgIHJldHVybiBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoc3RyKS5sZW5ndGg7XG4gIH1cbiAgdHJ5IHtcbiAgICByZXR1cm4gdW5lc2NhcGUoZW5jb2RlVVJJQ29tcG9uZW50KHN0cikpLmxlbmd0aDtcbiAgfSBjYXRjaCAoXykge1xuICAgIHJldHVybiBzdHIubGVuZ3RoO1xuICB9XG59XG5cbi8qKlxuICogR2VuZXJhdGUgYSBoaWdoLWVudHJvcHkgcmFuZG9tIG11bHRpcGFydCBib3VuZGFyeSBzdHJpbmcuXG4gKiBVc2VzIGNyeXB0by5nZXRSYW5kb21WYWx1ZXMgaWYgYXZhaWxhYmxlLCBmYWxsaW5nIGJhY2sgdG8gTWF0aC5yYW5kb20uXG4gKlxuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwcml2YXRlXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlTXVsdGlwYXJ0Qm91bmRhcnkoKSB7XG4gIGxldCByYW5kID0gJyc7XG4gIGlmICh0eXBlb2YgY3J5cHRvICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2YgY3J5cHRvLmdldFJhbmRvbVZhbHVlcyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoMTYpO1xuICAgIGNyeXB0by5nZXRSYW5kb21WYWx1ZXMoYnl0ZXMpO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIHJhbmQgKz0gKGJ5dGVzW2ldIDwgMTYgPyAnMCcgOiAnJykgKyBieXRlc1tpXS50b1N0cmluZygxNik7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgNDsgaSsrKSB7XG4gICAgICByYW5kICs9IE1hdGguZmxvb3IoKDEgKyBNYXRoLnJhbmRvbSgpKSAqIDB4MTAwMDAwMDAwKS50b1N0cmluZygxNikuc3Vic3RyaW5nKDEpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gJy0tLS1zdXBlcmFnZW50Ym91bmRhcnknICsgcmFuZC50b0xvd2VyQ2FzZSgpO1xufVxuXG4vKipcbiAqIENyb3NzLXJlYWxtLXNhZmUgYnJhbmQgY2hlY2sgZm9yIEJsb2Igb3IgRmlsZSBpbnN0YW5jZXMuXG4gKlxuICogQHBhcmFtIHtNaXhlZH0gdmFsXG4gKiBAcmV0dXJuIHtCb29sZWFufVxuICogQGFwaSBwcml2YXRlXG4gKi9cbmZ1bmN0aW9uIGlzQmxvYk9yRmlsZSh2YWwpIHtcbiAgaWYgKCF2YWwgfHwgdHlwZW9mIHZhbCAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiBCbG9iICE9PSAndW5kZWZpbmVkJyAmJiB2YWwgaW5zdGFuY2VvZiBCbG9iKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKHR5cGVvZiBGaWxlICE9PSAndW5kZWZpbmVkJyAmJiB2YWwgaW5zdGFuY2VvZiBGaWxlKSByZXR1cm4gdHJ1ZTtcbiAgY29uc3QgdGFnID0gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHZhbCk7XG4gIHJldHVybiAoXG4gICAgdGFnID09PSAnW29iamVjdCBCbG9iXScgfHxcbiAgICB0YWcgPT09ICdbb2JqZWN0IEZpbGVdJyB8fFxuICAgICh0eXBlb2YgdmFsLnNpemUgPT09ICdudW1iZXInICYmIHR5cGVvZiB2YWwuc2xpY2UgPT09ICdmdW5jdGlvbicpXG4gICk7XG59XG5cbi8qKlxuICogU2VyaWFsaXplIGEgYnJvd3NlciBGb3JtRGF0YSBpbnN0YW5jZSBpbnRvIGFuIGV4YWN0IEJsb2IgdG8gZGV0ZXJtaW5lIGl0c1xuICogYnl0ZSBsZW5ndGggYW5kIHRyYW5zbWl0IHRoZSBleGFjdCBtYXRjaGluZyBtdWx0aXBhcnQgYm91bmRhcnkgb3ZlciB0aGUgd2lyZS5cbiAqIFVzZXMgYSB1bmlxdWUgaGlnaC1lbnRyb3B5IGJvdW5kYXJ5IHBlciBzZXJpYWxpemVkIHBheWxvYWQgdG8gcHJldmVudCBjb2xsaXNpb25cbiAqIG9yIGRldGVybWluaXN0aWMgYm9keSBjb3JydXB0aW9uLlxuICpcbiAqIFJldHVybnMgdGhlIEJsb2IsIG9yIHVuZGVmaW5lZCB3aGVuIGVudW1lcmF0aW9uIGZhaWxzLlxuICpcbiAqIEBwYXJhbSB7Rm9ybURhdGF9IGZkXG4gKiBAcmV0dXJuIHtCbG9ifHVuZGVmaW5lZH1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5mdW5jdGlvbiBidWlsZEZvcm1EYXRhQmxvYihmZCwgcmVxKSB7XG4gIGNvbnN0IEJPVU5EQVJZID0gZ2VuZXJhdGVNdWx0aXBhcnRCb3VuZGFyeSgpO1xuICBjb25zdCBDUkxGID0gJ1xcclxcbic7XG4gIGNvbnN0IHBhcnRzID0gW107XG5cbiAgY29uc3QgZXNjYXBlSGVhZGVyUGFyYW0gPSAocykgPT5cbiAgICBTdHJpbmcocylcbiAgICAgIC5yZXBsYWNlKC9cXHIvZywgJyUwRCcpXG4gICAgICAucmVwbGFjZSgvXFxuL2csICclMEEnKVxuICAgICAgLnJlcGxhY2UoL1wiL2csICclMjInKTtcbiAgY29uc3Qgbm9ybWFsaXplTGluZUVuZGluZ3MgPSAocykgPT4gU3RyaW5nKHMpLnJlcGxhY2UoLyg/OlxcclxcbnxcXHJ8XFxuKS9nLCBDUkxGKTtcblxuICB0cnkge1xuICAgIGxldCBlbnRyaWVzO1xuICAgIGlmIChyZXEgJiYgQXJyYXkuaXNBcnJheShyZXEuX2Zvcm1GaWVsZHMpICYmIHJlcS5fZm9ybUZpZWxkcy5sZW5ndGggPiAwKSB7XG4gICAgICBlbnRyaWVzID0gcmVxLl9mb3JtRmllbGRzLnNsaWNlKCk7XG4gICAgfSBlbHNlIGlmIChmZCAmJiB0eXBlb2YgZmQuZW50cmllcyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgZW50cmllcyA9IFtdO1xuICAgICAgY29uc3QgaXRlciA9IGZkLmVudHJpZXMoKTtcbiAgICAgIGxldCBjdXJyID0gaXRlci5uZXh0KCk7XG4gICAgICB3aGlsZSAoIWN1cnIuZG9uZSkge1xuICAgICAgICBlbnRyaWVzLnB1c2goY3Vyci52YWx1ZSk7XG4gICAgICAgIGN1cnIgPSBpdGVyLm5leHQoKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGZkICYmIHR5cGVvZiBmZC5mb3JFYWNoID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBlbnRyaWVzID0gW107XG4gICAgICBmZC5mb3JFYWNoKCh2YWx1ZSwgbmFtZSkgPT4gZW50cmllcy5wdXNoKFtuYW1lLCB2YWx1ZV0pKTtcbiAgICB9IGVsc2UgaWYgKGZkICYmIEFycmF5LmlzQXJyYXkoZmQuX2VudHJpZXMpKSB7XG4gICAgICBlbnRyaWVzID0gZmQuX2VudHJpZXMuc2xpY2UoKTtcbiAgICB9IGVsc2UgaWYgKGZkICYmIEFycmF5LmlzQXJyYXkoZmQuX3BhcnRzKSkge1xuICAgICAgZW50cmllcyA9IGZkLl9wYXJ0cy5zbGljZSgpO1xuICAgIH0gZWxzZSBpZiAoZmQgJiYgQXJyYXkuaXNBcnJheShmZC5fZmllbGRzKSkge1xuICAgICAgZW50cmllcyA9IGZkLl9maWVsZHMuc2xpY2UoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGVudHJpZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IGl0ZW0gPSBlbnRyaWVzW2ldO1xuICAgICAgY29uc3QgbmFtZSA9IGl0ZW1bMF07XG4gICAgICBjb25zdCB2YWx1ZSA9IGl0ZW1bMV07XG4gICAgICBsZXQgY3VzdG9tRmlsZW5hbWUgPSBpdGVtWzJdO1xuICAgICAgaWYgKCFjdXN0b21GaWxlbmFtZSAmJiByZXEgJiYgQXJyYXkuaXNBcnJheShyZXEuX2Zvcm1GaWVsZHMpICYmIHJlcS5fZm9ybUZpZWxkc1tpXSkge1xuICAgICAgICBjdXN0b21GaWxlbmFtZSA9IHJlcS5fZm9ybUZpZWxkc1tpXVsyXTtcbiAgICAgIH1cbiAgICAgIHBhcnRzLnB1c2goJy0tJyArIEJPVU5EQVJZICsgQ1JMRik7XG4gICAgICBjb25zdCBlTmFtZSA9IGVzY2FwZUhlYWRlclBhcmFtKG5hbWUpO1xuICAgICAgaWYgKGlzQmxvYk9yRmlsZSh2YWx1ZSkpIHtcbiAgICAgICAgY29uc3QgZmlsZU92ZXJyaWRlID0gdHlwZW9mIGN1c3RvbUZpbGVuYW1lID09PSAnc3RyaW5nJ1xuICAgICAgICAgID8gY3VzdG9tRmlsZW5hbWVcbiAgICAgICAgICA6IChjdXN0b21GaWxlbmFtZSAmJiBjdXN0b21GaWxlbmFtZS5maWxlbmFtZSA/IGN1c3RvbUZpbGVuYW1lLmZpbGVuYW1lIDogbnVsbCk7XG4gICAgICAgIGNvbnN0IGN1c3RvbUNvbnRlbnRUeXBlID0gY3VzdG9tRmlsZW5hbWUgJiYgKGN1c3RvbUZpbGVuYW1lLmNvbnRlbnRUeXBlIHx8IGN1c3RvbUZpbGVuYW1lLnR5cGUpO1xuICAgICAgICBjb25zdCBmaWxlTmFtZSA9IGVzY2FwZUhlYWRlclBhcmFtKGZpbGVPdmVycmlkZSB8fCB2YWx1ZS5uYW1lIHx8ICdibG9iJyk7XG4gICAgICAgIGNvbnN0IG1pbWVUeXBlID0gY3VzdG9tQ29udGVudFR5cGUgfHwgdmFsdWUudHlwZSB8fCAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJztcbiAgICAgICAgcGFydHMucHVzaChcbiAgICAgICAgICAnQ29udGVudC1EaXNwb3NpdGlvbjogZm9ybS1kYXRhOyBuYW1lPVwiJyArIGVOYW1lICsgJ1wiOyBmaWxlbmFtZT1cIicgKyBmaWxlTmFtZSArICdcIicgKyBDUkxGICtcbiAgICAgICAgICAnQ29udGVudC1UeXBlOiAnICsgbWltZVR5cGUgKyBDUkxGICsgQ1JMRlxuICAgICAgICApO1xuICAgICAgICBwYXJ0cy5wdXNoKHZhbHVlKTsgLy8gUmV0YWluIG9yaWdpbmFsIEJsb2IvRmlsZSBkaXJlY3RseSAoY3Jvc3MtcmVhbG0gc2FmZSwgemVybyBhbGxvY2F0aW9uKVxuICAgICAgICBwYXJ0cy5wdXNoKENSTEYpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcGFydHMucHVzaCgnQ29udGVudC1EaXNwb3NpdGlvbjogZm9ybS1kYXRhOyBuYW1lPVwiJyArIGVOYW1lICsgJ1wiJyArIENSTEYgKyBDUkxGKTtcbiAgICAgICAgcGFydHMucHVzaChub3JtYWxpemVMaW5lRW5kaW5ncyh2YWx1ZSA9PSBudWxsID8gJycgOiBTdHJpbmcodmFsdWUpKSk7XG4gICAgICAgIHBhcnRzLnB1c2goQ1JMRik7XG4gICAgICB9XG4gICAgfVxuICAgIHBhcnRzLnB1c2goJy0tJyArIEJPVU5EQVJZICsgJy0tJyArIENSTEYpO1xuXG4gICAgY29uc3QgY29udGVudFR5cGUgPSAnbXVsdGlwYXJ0L2Zvcm0tZGF0YTsgYm91bmRhcnk9JyArIEJPVU5EQVJZO1xuICAgIGlmICh0eXBlb2YgQmxvYiAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihwYXJ0cywgeyB0eXBlOiBjb250ZW50VHlwZSB9KTtcbiAgICAgICAgYmxvYi5jb250ZW50VHlwZSA9IGNvbnRlbnRUeXBlO1xuICAgICAgICByZXR1cm4gYmxvYjtcbiAgICAgIH0gY2F0Y2ggKF8pIHtcbiAgICAgICAgLy8gaWdub3JlXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgQmxvYkJ1aWxkZXIgPVxuICAgICAgKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmICh3aW5kb3cuQmxvYkJ1aWxkZXIgfHwgd2luZG93LldlYktpdEJsb2JCdWlsZGVyIHx8IHdpbmRvdy5Nb3pCbG9iQnVpbGRlciB8fCB3aW5kb3cuTVNCbG9iQnVpbGRlcikpIHx8XG4gICAgICAodHlwZW9mIGdsb2JhbCAhPT0gJ3VuZGVmaW5lZCcgJiYgKGdsb2JhbC5CbG9iQnVpbGRlciB8fCBnbG9iYWwuV2ViS2l0QmxvYkJ1aWxkZXIgfHwgZ2xvYmFsLk1vekJsb2JCdWlsZGVyIHx8IGdsb2JhbC5NU0Jsb2JCdWlsZGVyKSk7XG4gICAgaWYgKEJsb2JCdWlsZGVyKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBiYiA9IG5ldyBCbG9iQnVpbGRlcigpO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgYmIuYXBwZW5kKHBhcnRzW2ldKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBibG9iID0gYmIuZ2V0QmxvYihjb250ZW50VHlwZSk7XG4gICAgICAgIGlmIChibG9iKSB7XG4gICAgICAgICAgYmxvYi5jb250ZW50VHlwZSA9IGNvbnRlbnRUeXBlO1xuICAgICAgICAgIHJldHVybiBibG9iO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChfKSB7XG4gICAgICAgIC8vIGlnbm9yZVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9IGNhdGNoIChfKSB7XG4gICAgLy8gSWdub3JlIGVudW1lcmF0aW9uIGVycm9yIGFuZCByZXR1cm4gdW5kZWZpbmVkXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxufVxuXG4vKipcbiAqIENvbXB1dGUgdGhlIG11bHRpcGFydCBmcmFtaW5nIGJ5dGUgc2l6ZSBvZiBhIEZvcm1EYXRhIGluc3RhbmNlIHdpdGhvdXQgcmVxdWlyaW5nIEJsb2IuXG4gKiBVc2VkIHdoZW4gQmxvYiBjb25zdHJ1Y3Rpb24gaXMgdW5hdmFpbGFibGUgb3IgZmFpbHMsIGVuc3VyaW5nIHByZWZsaWdodCBtYXhSZXF1ZXN0U2l6ZVxuICogZW5mb3JjZW1lbnQgYmVmb3JlIHhoci5zZW5kKCkgdHJhbnNtaXRzIGFuIG92ZXJzaXplZCBwYXlsb2FkLlxuICpcbiAqIEBwYXJhbSB7Rm9ybURhdGF8T2JqZWN0fSBmZFxuICogQHBhcmFtIHtSZXF1ZXN0fSBbcmVxXVxuICogQHJldHVybiB7TnVtYmVyfVxuICogQGFwaSBwcml2YXRlXG4gKi9cbmZ1bmN0aW9uIGNvbXB1dGVGb3JtRGF0YVNpemUoZmQsIHJlcSkge1xuICBjb25zdCBCT1VOREFSWSA9IGdlbmVyYXRlTXVsdGlwYXJ0Qm91bmRhcnkoKTtcbiAgY29uc3QgQ1JMRiA9ICdcXHJcXG4nO1xuXG4gIGNvbnN0IGVzY2FwZUhlYWRlclBhcmFtID0gKHMpID0+XG4gICAgU3RyaW5nKHMpXG4gICAgICAucmVwbGFjZSgvXFxyL2csICclMEQnKVxuICAgICAgLnJlcGxhY2UoL1xcbi9nLCAnJTBBJylcbiAgICAgIC5yZXBsYWNlKC9cIi9nLCAnJTIyJyk7XG4gIGNvbnN0IG5vcm1hbGl6ZUxpbmVFbmRpbmdzID0gKHMpID0+IFN0cmluZyhzKS5yZXBsYWNlKC8oPzpcXHJcXG58XFxyfFxcbikvZywgQ1JMRik7XG5cbiAgbGV0IGVudHJpZXMgPSBbXTtcbiAgaWYgKHJlcSAmJiBBcnJheS5pc0FycmF5KHJlcS5fZm9ybUZpZWxkcykgJiYgcmVxLl9mb3JtRmllbGRzLmxlbmd0aCA+IDApIHtcbiAgICBlbnRyaWVzID0gcmVxLl9mb3JtRmllbGRzLnNsaWNlKCk7XG4gIH0gZWxzZSB7XG4gICAgdHJ5IHtcbiAgICAgIGlmIChmZCAmJiB0eXBlb2YgZmQuZW50cmllcyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBjb25zdCBpdGVyID0gZmQuZW50cmllcygpO1xuICAgICAgICBsZXQgY3VyciA9IGl0ZXIubmV4dCgpO1xuICAgICAgICB3aGlsZSAoIWN1cnIuZG9uZSkge1xuICAgICAgICAgIGVudHJpZXMucHVzaChjdXJyLnZhbHVlKTtcbiAgICAgICAgICBjdXJyID0gaXRlci5uZXh0KCk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoZmQgJiYgdHlwZW9mIGZkLmZvckVhY2ggPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgZmQuZm9yRWFjaCgodmFsdWUsIG5hbWUpID0+IGVudHJpZXMucHVzaChbbmFtZSwgdmFsdWVdKSk7XG4gICAgICB9IGVsc2UgaWYgKGZkICYmIEFycmF5LmlzQXJyYXkoZmQuX2VudHJpZXMpKSB7XG4gICAgICAgIGVudHJpZXMgPSBmZC5fZW50cmllcy5zbGljZSgpO1xuICAgICAgfSBlbHNlIGlmIChmZCAmJiBBcnJheS5pc0FycmF5KGZkLl9wYXJ0cykpIHtcbiAgICAgICAgZW50cmllcyA9IGZkLl9wYXJ0cy5zbGljZSgpO1xuICAgICAgfSBlbHNlIGlmIChmZCAmJiBBcnJheS5pc0FycmF5KGZkLl9maWVsZHMpKSB7XG4gICAgICAgIGVudHJpZXMgPSBmZC5fZmllbGRzLnNsaWNlKCk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoXykge1xuICAgICAgLy8gaWdub3JlXG4gICAgfVxuICB9XG5cbiAgaWYgKGVudHJpZXMubGVuZ3RoID09PSAwKSB7XG4gICAgY29uc3QgaXNLbm93bkVudW1lcmFibGUgPSAoXG4gICAgICAoZmQgJiYgKHR5cGVvZiBmZC5lbnRyaWVzID09PSAnZnVuY3Rpb24nIHx8IHR5cGVvZiBmZC5mb3JFYWNoID09PSAnZnVuY3Rpb24nKSkgfHxcbiAgICAgIChyZXEgJiYgcmVxLl9mb3JtRGF0YSA9PT0gZmQpXG4gICAgKTtcbiAgICBpZiAoIWlzS25vd25FbnVtZXJhYmxlKSB7XG4gICAgICAvLyBFeHRlcm5hbGx5IHN1cHBsaWVkIG5hdGl2ZSBGb3JtRGF0YSB3aXRob3V0IGluc3BlY3Rpb24gQVBJczpcbiAgICAgIC8vIFNpemUgY2Fubm90IGJlIHZlcmlmaWVkIGJlZm9yZSBzZW5kaW5nLiBGYWlsIHNhZmVseSB3aGVuIGEgcmVxdWVzdCBsaW1pdCBpcyBjb25maWd1cmVkLlxuICAgICAgaWYgKHJlcSAmJiByZXEuX21heFJlcXVlc3RTaXplICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIHJlcS5fbWF4UmVxdWVzdFNpemUgKyAxO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gIH1cblxuICBjb25zdCBib3VuZGFyeUxpbmVCeXRlcyA9IDIgKyBCT1VOREFSWS5sZW5ndGggKyAyOyAvLyAnLS0nICsgQk9VTkRBUlkgKyAnXFxyXFxuJ1xuICBjb25zdCBjbG9zaW5nQm91bmRhcnlCeXRlcyA9IDIgKyBCT1VOREFSWS5sZW5ndGggKyA0OyAvLyAnLS0nICsgQk9VTkRBUlkgKyAnLS1cXHJcXG4nXG4gIGxldCB0b3RhbEJ5dGVzID0gMDtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IGVudHJpZXMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBpdGVtID0gZW50cmllc1tpXTtcbiAgICBjb25zdCBuYW1lID0gaXRlbVswXTtcbiAgICBjb25zdCB2YWx1ZSA9IGl0ZW1bMV07XG4gICAgbGV0IGN1c3RvbUZpbGVuYW1lID0gaXRlbVsyXTtcbiAgICBpZiAoIWN1c3RvbUZpbGVuYW1lICYmIHJlcSAmJiBBcnJheS5pc0FycmF5KHJlcS5fZm9ybUZpZWxkcykgJiYgcmVxLl9mb3JtRmllbGRzW2ldKSB7XG4gICAgICBjdXN0b21GaWxlbmFtZSA9IHJlcS5fZm9ybUZpZWxkc1tpXVsyXTtcbiAgICB9XG4gICAgdG90YWxCeXRlcyArPSBib3VuZGFyeUxpbmVCeXRlcztcbiAgICBjb25zdCBlTmFtZSA9IGVzY2FwZUhlYWRlclBhcmFtKG5hbWUpO1xuICAgIGlmIChpc0Jsb2JPckZpbGUodmFsdWUpKSB7XG4gICAgICBjb25zdCBmaWxlT3ZlcnJpZGUgPSB0eXBlb2YgY3VzdG9tRmlsZW5hbWUgPT09ICdzdHJpbmcnXG4gICAgICAgID8gY3VzdG9tRmlsZW5hbWVcbiAgICAgICAgOiAoY3VzdG9tRmlsZW5hbWUgJiYgY3VzdG9tRmlsZW5hbWUuZmlsZW5hbWUgPyBjdXN0b21GaWxlbmFtZS5maWxlbmFtZSA6IG51bGwpO1xuICAgICAgY29uc3QgY3VzdG9tQ29udGVudFR5cGUgPSBjdXN0b21GaWxlbmFtZSAmJiAoY3VzdG9tRmlsZW5hbWUuY29udGVudFR5cGUgfHwgY3VzdG9tRmlsZW5hbWUudHlwZSk7XG4gICAgICBjb25zdCBmaWxlTmFtZSA9IGVzY2FwZUhlYWRlclBhcmFtKGZpbGVPdmVycmlkZSB8fCB2YWx1ZS5uYW1lIHx8ICdibG9iJyk7XG4gICAgICBjb25zdCBtaW1lVHlwZSA9IGN1c3RvbUNvbnRlbnRUeXBlIHx8IHZhbHVlLnR5cGUgfHwgJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbSc7XG4gICAgICBjb25zdCBoZWFkZXJTdHIgPVxuICAgICAgICAnQ29udGVudC1EaXNwb3NpdGlvbjogZm9ybS1kYXRhOyBuYW1lPVwiJyArXG4gICAgICAgIGVOYW1lICtcbiAgICAgICAgJ1wiOyBmaWxlbmFtZT1cIicgK1xuICAgICAgICBmaWxlTmFtZSArXG4gICAgICAgICdcIicgK1xuICAgICAgICBDUkxGICtcbiAgICAgICAgJ0NvbnRlbnQtVHlwZTogJyArXG4gICAgICAgIG1pbWVUeXBlICtcbiAgICAgICAgQ1JMRiArXG4gICAgICAgIENSTEY7XG4gICAgICB0b3RhbEJ5dGVzICs9IGdldFV0ZjhCeXRlTGVuZ3RoKGhlYWRlclN0cik7XG4gICAgICBsZXQgdmFsdWVTaXplID0gMDtcbiAgICAgIGlmICh0eXBlb2YgdmFsdWUuc2l6ZSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgdmFsdWVTaXplID0gdmFsdWUuc2l6ZTtcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHZhbHVlLmJ5dGVMZW5ndGggPT09ICdudW1iZXInKSB7XG4gICAgICAgIHZhbHVlU2l6ZSA9IHZhbHVlLmJ5dGVMZW5ndGg7XG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiBCdWZmZXIgIT09ICd1bmRlZmluZWQnICYmIEJ1ZmZlci5pc0J1ZmZlcih2YWx1ZSkpIHtcbiAgICAgICAgdmFsdWVTaXplID0gdmFsdWUubGVuZ3RoO1xuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHZhbHVlU2l6ZSA9IGdldFV0ZjhCeXRlTGVuZ3RoKHZhbHVlKTtcbiAgICAgIH1cbiAgICAgIHRvdGFsQnl0ZXMgKz0gdmFsdWVTaXplO1xuICAgICAgdG90YWxCeXRlcyArPSAyOyAvLyBDUkxGIGFmdGVyIHZhbHVlXG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGhlYWRlclN0ciA9XG4gICAgICAgICdDb250ZW50LURpc3Bvc2l0aW9uOiBmb3JtLWRhdGE7IG5hbWU9XCInICsgZU5hbWUgKyAnXCInICsgQ1JMRiArIENSTEY7XG4gICAgICB0b3RhbEJ5dGVzICs9IGdldFV0ZjhCeXRlTGVuZ3RoKGhlYWRlclN0cik7XG4gICAgICBjb25zdCBub3JtYWxpemVkU3RyID0gbm9ybWFsaXplTGluZUVuZGluZ3MoXG4gICAgICAgIHZhbHVlID09IG51bGwgPyAnJyA6IFN0cmluZyh2YWx1ZSlcbiAgICAgICk7XG4gICAgICB0b3RhbEJ5dGVzICs9IGdldFV0ZjhCeXRlTGVuZ3RoKG5vcm1hbGl6ZWRTdHIpO1xuICAgICAgdG90YWxCeXRlcyArPSAyOyAvLyBDUkxGIGFmdGVyIHZhbHVlXG4gICAgfVxuICB9XG5cbiAgdG90YWxCeXRlcyArPSBjbG9zaW5nQm91bmRhcnlCeXRlcztcbiAgcmV0dXJuIHRvdGFsQnl0ZXM7XG59XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgYnl0ZSBzaXplIG9mIGFuIG91dGdvaW5nIHJlcXVlc3QgcGF5bG9hZCBpbiB0aGUgYnJvd3Nlci5cbiAqIFN0cmljdGx5IHVzZWQgZm9yIG91dGdvaW5nIHJlcXVlc3QgYm9kaWVzIC0gbmV2ZXIgZm9yIGluY29taW5nIHJlc3BvbnNlcy5cbiAqXG4gKiBAcGFyYW0ge01peGVkfSBkYXRhXG4gKiBAcGFyYW0ge1JlcXVlc3R9IFtyZXFdXG4gKiBAcmV0dXJuIHtOdW1iZXJ8dW5kZWZpbmVkfVxuICogQGFwaSBwcml2YXRlXG4gKi9cbmZ1bmN0aW9uIGdldFJlcXVlc3RCb2R5U2l6ZShkYXRhLCByZXEpIHtcbiAgY29uc3QgdGFyZ2V0RGF0YSA9IGRhdGEgIT09IHVuZGVmaW5lZCA/IGRhdGEgOiAocmVxICYmIHJlcS5fZm9ybURhdGEpO1xuICBpZiAodGFyZ2V0RGF0YSA9PSBudWxsKSByZXR1cm4gMDtcblxuICBpZiAodHlwZW9mIHRhcmdldERhdGEgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIGdldFV0ZjhCeXRlTGVuZ3RoKHRhcmdldERhdGEpO1xuICB9XG4gIGlmICh0YXJnZXREYXRhIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHJldHVybiB0YXJnZXREYXRhLmJ5dGVMZW5ndGg7XG4gIGlmICh0eXBlb2YgQXJyYXlCdWZmZXIgIT09ICd1bmRlZmluZWQnICYmIEFycmF5QnVmZmVyLmlzVmlldyAmJiBBcnJheUJ1ZmZlci5pc1ZpZXcodGFyZ2V0RGF0YSkpIHtcbiAgICByZXR1cm4gdGFyZ2V0RGF0YS5ieXRlTGVuZ3RoO1xuICB9XG4gIGlmIChpc0Jsb2JPckZpbGUodGFyZ2V0RGF0YSkpIHtcbiAgICByZXR1cm4gdGFyZ2V0RGF0YS5zaXplO1xuICB9XG4gIGlmIChcbiAgICAodHlwZW9mIFVSTFNlYXJjaFBhcmFtcyAhPT0gJ3VuZGVmaW5lZCcgJiYgdGFyZ2V0RGF0YSBpbnN0YW5jZW9mIFVSTFNlYXJjaFBhcmFtcykgfHxcbiAgICAodGFyZ2V0RGF0YSAmJiB0eXBlb2YgdGFyZ2V0RGF0YSA9PT0gJ29iamVjdCcgJiYgKFxuICAgICAgKHR5cGVvZiBTeW1ib2wgIT09ICd1bmRlZmluZWQnICYmIFN5bWJvbC50b1N0cmluZ1RhZyAmJiB0YXJnZXREYXRhW1N5bWJvbC50b1N0cmluZ1RhZ10gPT09ICdVUkxTZWFyY2hQYXJhbXMnKSB8fFxuICAgICAgKHRhcmdldERhdGEuY29uc3RydWN0b3IgJiYgdGFyZ2V0RGF0YS5jb25zdHJ1Y3Rvci5uYW1lID09PSAnVVJMU2VhcmNoUGFyYW1zJylcbiAgICApKVxuICApIHtcbiAgICByZXR1cm4gZ2V0VXRmOEJ5dGVMZW5ndGgodGFyZ2V0RGF0YS50b1N0cmluZygpKTtcbiAgfVxuICBpZiAodHlwZW9mIERvY3VtZW50ICE9PSAndW5kZWZpbmVkJyAmJiB0YXJnZXREYXRhIGluc3RhbmNlb2YgRG9jdW1lbnQpIHtcbiAgICByZXR1cm4gZ2V0VXRmOEJ5dGVMZW5ndGgobmV3IFhNTFNlcmlhbGl6ZXIoKS5zZXJpYWxpemVUb1N0cmluZyh0YXJnZXREYXRhKSk7XG4gIH1cbiAgaWYgKHR5cGVvZiB0YXJnZXREYXRhID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgdGFyZ2V0RGF0YS5ieXRlTGVuZ3RoID09PSAnbnVtYmVyJykge1xuICAgIHJldHVybiB0YXJnZXREYXRhLmJ5dGVMZW5ndGg7XG4gIH1cbiAgaWYgKHR5cGVvZiB0YXJnZXREYXRhID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgdGFyZ2V0RGF0YS5zaXplID09PSAnbnVtYmVyJykge1xuICAgIHJldHVybiB0YXJnZXREYXRhLnNpemU7XG4gIH1cblxuICAvLyBVbmlmaWVkIEZvcm1EYXRhIGRldGVjdGlvbjogaGFuZGxlcyBib3RoIGV4dGVybmFsIC5zZW5kKGZvcm1EYXRhKSBhbmQgaW50ZXJuYWwgLmZpZWxkKCkvLmF0dGFjaCgpXG4gIGlmIChcbiAgICAodHlwZW9mIEZvcm1EYXRhICE9PSAndW5kZWZpbmVkJyAmJiB0YXJnZXREYXRhIGluc3RhbmNlb2YgRm9ybURhdGEpIHx8XG4gICAgKHRhcmdldERhdGEgJiYgdHlwZW9mIHRhcmdldERhdGEgPT09ICdvYmplY3QnICYmIChcbiAgICAgIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh0YXJnZXREYXRhKSA9PT0gJ1tvYmplY3QgRm9ybURhdGFdJyB8fFxuICAgICAgKHR5cGVvZiBTeW1ib2wgIT09ICd1bmRlZmluZWQnICYmIFN5bWJvbC50b1N0cmluZ1RhZyAmJiB0YXJnZXREYXRhW1N5bWJvbC50b1N0cmluZ1RhZ10gPT09ICdGb3JtRGF0YScpIHx8XG4gICAgICAodGFyZ2V0RGF0YS5jb25zdHJ1Y3RvciAmJiAodGFyZ2V0RGF0YS5jb25zdHJ1Y3Rvci5uYW1lID09PSAnRm9ybURhdGEnIHx8IHRhcmdldERhdGEuY29uc3RydWN0b3IubmFtZSA9PT0gJ01vY2tGb3JtRGF0YScpKVxuICAgICkpXG4gICkge1xuICAgIGxldCBibG9iO1xuICAgIHRyeSB7XG4gICAgICBibG9iID0gYnVpbGRGb3JtRGF0YUJsb2IodGFyZ2V0RGF0YSwgcmVxKTtcbiAgICB9IGNhdGNoIChfKSB7XG4gICAgICAvLyBpZ25vcmVcbiAgICB9XG4gICAgaWYgKGJsb2IgJiYgdHlwZW9mIGJsb2Iuc2l6ZSA9PT0gJ251bWJlcicpIHtcbiAgICAgIHJldHVybiBibG9iLnNpemU7XG4gICAgfVxuICAgIC8vIEZhbGxiYWNrOiBDb21wdXRlIG11bHRpcGFydCBmcmFtaW5nIGJ5dGUgc2l6ZSB3aXRob3V0IHJlcXVpcmluZyBCbG9iXG4gICAgcmV0dXJuIGNvbXB1dGVGb3JtRGF0YVNpemUodGFyZ2V0RGF0YSwgcmVxKTtcbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgaW50cmluc2ljIGJ5dGUgc2l6ZSBvZiBhIGRlY29kZWQgYmluYXJ5IHJlc3BvbnNlIGJvZHkgaW4gdGhlIGJyb3dzZXIuXG4gKiBGb3IgYmluYXJ5IHR5cGVzIChBcnJheUJ1ZmZlciwgQmxvYiwgdHlwZWQgYXJyYXlzKSwgdGhpcyBkZXJpdmVzXG4gKiB0aGUgZXhhY3QgaW4tbWVtb3J5IGRlY29kZWQgYnl0ZSBjb3VudCBzbyB0ZXJtaW5hbCByZXNwb25zZXMgYXJlIGFsd2F5cyBjaGVja2VkLlxuICpcbiAqIEBwYXJhbSB7TWl4ZWR9IGRhdGFcbiAqIEByZXR1cm4ge051bWJlcnx1bmRlZmluZWR9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gZ2V0UmVzcG9uc2VJbnRyaW5zaWNCeXRlTGVuZ3RoKGRhdGEpIHtcbiAgaWYgKGRhdGEgPT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gJ3VuZGVmaW5lZCcgJiYgZGF0YSBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSByZXR1cm4gZGF0YS5ieXRlTGVuZ3RoO1xuICBpZiAodHlwZW9mIEFycmF5QnVmZmVyICE9PSAndW5kZWZpbmVkJyAmJiBBcnJheUJ1ZmZlci5pc1ZpZXcgJiYgQXJyYXlCdWZmZXIuaXNWaWV3KGRhdGEpKSB7XG4gICAgcmV0dXJuIGRhdGEuYnl0ZUxlbmd0aDtcbiAgfVxuICBpZiAodHlwZW9mIEJ1ZmZlciAhPT0gJ3VuZGVmaW5lZCcgJiYgQnVmZmVyLmlzQnVmZmVyKGRhdGEpKSB7XG4gICAgcmV0dXJuIGRhdGEubGVuZ3RoO1xuICB9XG4gIGlmIChpc0Jsb2JPckZpbGUoZGF0YSkpIHtcbiAgICByZXR1cm4gZGF0YS5zaXplO1xuICB9XG4gIGlmICh0eXBlb2YgZGF0YSA9PT0gJ29iamVjdCcpIHtcbiAgICBpZiAodHlwZW9mIGRhdGEuYnl0ZUxlbmd0aCA9PT0gJ251bWJlcicpIHJldHVybiBkYXRhLmJ5dGVMZW5ndGg7XG4gICAgaWYgKHR5cGVvZiBkYXRhLnNpemUgPT09ICdudW1iZXInKSByZXR1cm4gZGF0YS5zaXplO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogRXh0cmFjdCByYXcgcmVzcG9uc2UgZW50aXR5IGJ5dGUgc2l6ZSBmcm9tIHN0YW5kYXJkIGRvY3VtZW50ZWQgWEhSIHByb3BlcnRpZXMuXG4gKlxuICogQHBhcmFtIHtYTUxIdHRwUmVxdWVzdH0gW3hocl1cbiAqIEByZXR1cm4ge051bWJlcnx1bmRlZmluZWR9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gZ2V0UmF3WGhyQnl0ZUxlbmd0aCh4aHIpIHtcbiAgaWYgKCF4aHIpIHJldHVybiB1bmRlZmluZWQ7XG4gIHJldHVybiBnZXRSZXNwb25zZUludHJpbnNpY0J5dGVMZW5ndGgoeGhyLnJlc3BvbnNlKTtcbn1cblxuXG4vKipcbiAqIERldGVybWluZSBpZiBhbiBYTUxIdHRwUmVxdWVzdCBpcyBzYW1lLW9yaWdpbiB3aXRoIHRoZSBjdXJyZW50IGRvY3VtZW50L2NvbnRleHQuXG4gKiBSZXR1cm5zIGZhbHNlIHdoZW4gb3JpZ2luIGluZm9ybWF0aW9uIGlzIHVuYXZhaWxhYmxlLCB0cmVhdGluZyBjb21wcmVzc2lvblxuICogZXhwb3N1cmUgYXMgdW5rbm93biB3aXRob3V0IGd1ZXNzaW5nIGZyb20gVVJMIHRleHQuXG4gKlxuICogQHBhcmFtIHtYTUxIdHRwUmVxdWVzdH0geGhyXG4gKiBAcGFyYW0ge1N0cmluZ30gcmVxdWVzdFVybFxuICogQHJldHVybiB7Qm9vbGVhbn1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5mdW5jdGlvbiBpc1NhbWVPcmlnaW5SZXF1ZXN0KHhociwgcmVxdWVzdFVybCkge1xuICB0cnkge1xuICAgIGNvbnN0IGxvYyA9ICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB3aW5kb3cubG9jYXRpb24pIHx8ICh0eXBlb2YgbG9jYXRpb24gIT09ICd1bmRlZmluZWQnICYmIGxvY2F0aW9uKTtcbiAgICBpZiAoIWxvYyB8fCAhbG9jLm9yaWdpbiB8fCBsb2Mub3JpZ2luID09PSAnbnVsbCcpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBjb25zdCB0YXJnZXQgPSAoeGhyICYmIHhoci5yZXNwb25zZVVSTCkgPyB4aHIucmVzcG9uc2VVUkwgOiAocmVxdWVzdFVybCB8fCAnJyk7XG4gICAgaWYgKCF0YXJnZXQpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBsZXQgdGFyZ2V0T3JpZ2luO1xuICAgIGlmICh0eXBlb2YgVVJMID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0YXJnZXRPcmlnaW4gPSBuZXcgVVJMKHRhcmdldCwgbG9jLm9yaWdpbikub3JpZ2luO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGRvY3VtZW50ICE9PSAndW5kZWZpbmVkJyAmJiBkb2N1bWVudC5jcmVhdGVFbGVtZW50KSB7XG4gICAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgICAgYS5ocmVmID0gdGFyZ2V0O1xuICAgICAgdGFyZ2V0T3JpZ2luID0gYS5vcmlnaW4gfHwgYCR7YS5wcm90b2NvbH0vLyR7YS5ob3N0fWA7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRhcmdldE9yaWdpbiA9PT0gbG9jLm9yaWdpbjtcbiAgfSBjYXRjaCAoXykge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIERldGVybWluZSBpZiBhIHRhcmdldCBVUkwgaXMgc2FtZS1vcmlnaW4gd2l0aCB0aGUgc291cmNlIFVSTCAob3IgY3VycmVudCBsb2NhdGlvbikuXG4gKiBVc2VkIGZvciByZWRpcmVjdCBjcmVkZW50aWFsIHNhbml0aXphdGlvbiAoZS5nLiAzMDUgcmVkaXJlY3RzKS5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gdGFyZ2V0VXJsXG4gKiBAcGFyYW0ge1N0cmluZ30gW3NvdXJjZVVybF1cbiAqIEByZXR1cm4ge0Jvb2xlYW59XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gaXNTYW1lT3JpZ2luVXJsKHRhcmdldFVybCwgc291cmNlVXJsKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgbG9jID0gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHdpbmRvdy5sb2NhdGlvbikgfHwgKHR5cGVvZiBsb2NhdGlvbiAhPT0gJ3VuZGVmaW5lZCcgJiYgbG9jYXRpb24pO1xuICAgIGxldCBiYXNlT3JpZ2luID0gKGxvYyAmJiBsb2Mub3JpZ2luICYmIGxvYy5vcmlnaW4gIT09ICdudWxsJykgPyBsb2Mub3JpZ2luIDogJ2h0dHA6Ly9sb2NhbGhvc3QnO1xuXG4gICAgaWYgKHNvdXJjZVVybCkge1xuICAgICAgaWYgKHR5cGVvZiBVUkwgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgYmFzZU9yaWdpbiA9IG5ldyBVUkwoc291cmNlVXJsLCBiYXNlT3JpZ2luKS5vcmlnaW47XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCF0YXJnZXRVcmwpIHJldHVybiBmYWxzZTtcbiAgICBsZXQgdGFyZ2V0T3JpZ2luO1xuICAgIGlmICh0eXBlb2YgVVJMID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0YXJnZXRPcmlnaW4gPSBuZXcgVVJMKHRhcmdldFVybCwgYmFzZU9yaWdpbikub3JpZ2luO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGRvY3VtZW50ICE9PSAndW5kZWZpbmVkJyAmJiBkb2N1bWVudC5jcmVhdGVFbGVtZW50KSB7XG4gICAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgICAgYS5ocmVmID0gdGFyZ2V0VXJsO1xuICAgICAgdGFyZ2V0T3JpZ2luID0gYS5vcmlnaW4gfHwgYCR7YS5wcm90b2NvbH0vLyR7YS5ob3N0fWA7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRhcmdldE9yaWdpbiA9PT0gYmFzZU9yaWdpbjtcbiAgfSBjYXRjaCAoXykge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIENhbGN1bGF0ZSBieXRlIGxlbmd0aCBvZiBkZWNvZGVkIHRleHQgaW4gSVNPLTIwMjItSlAgc3RhdGVmdWwgZW5jb2RpbmcgKFJGQyAxNDY4KS5cbiAqIFN3aXRjaGVzIGJldHdlZW4gQVNDSUkgbW9kZSwgSklTIFggMDIwMSBSb21hbiBtb2RlLCBhbmQgSklTIFggMDIwOCBtb2RlOlxuICogLSBFbnRlcmluZyBKSVMgWCAwMjAxIFJvbWFuIG1vZGU6IEVTQyAoIEogKDMgYnl0ZXMpXG4gKiAgIEluIFJvbWFuIG1vZGUsIFllbiBVKzAwQTUgKDB4NUMpIGFuZCBPdmVybGluZSBVKzIwM0UgKDB4N0UpIGFyZSAxIGJ5dGUgZWFjaC5cbiAqIC0gRW50ZXJpbmcgSklTIFggMDIwOCBtb2RlOiBFU0MgJCBCICgzIGJ5dGVzKVxuICogICBFYWNoIEphcGFuZXNlIGNoYXJhY3RlciBpbiBKSVMgbW9kZSBpcyAyIGJ5dGVzLlxuICogLSBFbnRlcmluZyBBU0NJSSBtb2RlIC8gcmV0dXJuIHRvIEFTQ0lJOiBFU0MgKCBCICgzIGJ5dGVzKVxuICogICBBU0NJSSBjaGFyYWN0ZXJzICg8PSAweDdGKSBhcmUgMSBieXRlIGVhY2ggaW4gQVNDSUkgbW9kZS5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXG4gKiBAcmV0dXJuIHtOdW1iZXJ9IGJ5dGUgbGVuZ3RoXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gZ2V0SXNvMjAyMkpwQnl0ZUxlbmd0aChzdHIpIHtcbiAgY29uc3QgU1RBVEVfQVNDSUkgPSAwO1xuICBjb25zdCBTVEFURV9ST01BTiA9IDE7XG4gIGNvbnN0IFNUQVRFX0pJUyA9IDI7XG5cbiAgbGV0IGNvdW50ID0gMDtcbiAgbGV0IHN0YXRlID0gU1RBVEVfQVNDSUk7XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjb2RlID0gc3RyLmNoYXJDb2RlQXQoaSk7XG4gICAgaWYgKGNvZGUgPT09IDB4MDBhNSB8fCBjb2RlID09PSAweDIwM2UpIHtcbiAgICAgIGlmIChzdGF0ZSAhPT0gU1RBVEVfUk9NQU4pIHtcbiAgICAgICAgY291bnQgKz0gMzsgLy8gRVNDICggSiB0byBlbnRlciBKSVMgWCAwMjAxIFJvbWFuIG1vZGVcbiAgICAgICAgc3RhdGUgPSBTVEFURV9ST01BTjtcbiAgICAgIH1cbiAgICAgIGNvdW50ICs9IDE7XG4gICAgfSBlbHNlIGlmIChjb2RlIDw9IDB4N2YpIHtcbiAgICAgIGlmIChzdGF0ZSAhPT0gU1RBVEVfQVNDSUkpIHtcbiAgICAgICAgY291bnQgKz0gMzsgLy8gRVNDICggQiB0byBlbnRlciBBU0NJSSBtb2RlXG4gICAgICAgIHN0YXRlID0gU1RBVEVfQVNDSUk7XG4gICAgICB9XG4gICAgICBjb3VudCArPSAxO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoc3RhdGUgIT09IFNUQVRFX0pJUykge1xuICAgICAgICBjb3VudCArPSAzOyAvLyBFU0MgJCBCIHRvIGVudGVyIEpJUyBYIDAyMDggbW9kZVxuICAgICAgICBzdGF0ZSA9IFNUQVRFX0pJUztcbiAgICAgIH1cbiAgICAgIGNvdW50ICs9IDI7XG4gICAgICBpZiAoY29kZSA+PSAweGQ4MDAgJiYgY29kZSA8PSAweGRiZmYgJiYgaSArIDEgPCBzdHIubGVuZ3RoICYmIHN0ci5jaGFyQ29kZUF0KGkgKyAxKSA+PSAweGRjMDAgJiYgc3RyLmNoYXJDb2RlQXQoaSArIDEpIDw9IDB4ZGZmZikge1xuICAgICAgICBpKys7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaWYgKHN0YXRlICE9PSBTVEFURV9BU0NJSSkge1xuICAgIGNvdW50ICs9IDM7IC8vIFJldHVybiB0byBBU0NJSSBtb2RlIGF0IGVuZCBvZiBzdHJlYW0gKEVTQyAoIEIpXG4gIH1cblxuICByZXR1cm4gY291bnQ7XG59XG5cbi8qKlxuICogQ2FsY3VsYXRlIGJ5dGUgbGVuZ3RoIG9mIGRlY29kZWQgdGV4dCBpbiBIWi1HQi0yMzEyIGVuY29kaW5nIChSRkMgMTg0MykuXG4gKiBTdGF0ZWZ1bCA3LWJpdCBBU0NJSSB0cmFuc3BvcnQgZW5jb2Rpbmc6XG4gKiAtIEFTQ0lJIG1vZGU6IDEgYnl0ZSBwZXIgQVNDSUkgY2hhcjsgbGl0ZXJhbCB0aWxkZSBpcyB+fiAoMiBieXRlcylcbiAqIC0gQ2hpbmVzZSBtb2RlOiBlbnRlcmVkIHdpdGggfnsgKDIgYnl0ZXMpLCBleGl0ZWQgd2l0aCB+fSAoMiBieXRlcyk7XG4gKiAgIGVhY2ggQ0pLIGNoYXJhY3RlciBpcyAyIGJ5dGVzXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHN0clxuICogQHJldHVybiB7TnVtYmVyfSBieXRlIGxlbmd0aFxuICogQGFwaSBwcml2YXRlXG4gKi9cbmZ1bmN0aW9uIGdldEh6R2IyMzEyQnl0ZUxlbmd0aChzdHIpIHtcbiAgbGV0IGNvdW50ID0gMDtcbiAgbGV0IGluQ2hpbmVzZSA9IGZhbHNlO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGNvZGUgPSBzdHIuY2hhckNvZGVBdChpKTtcbiAgICBpZiAoY29kZSA9PT0gMHg3ZSkge1xuICAgICAgaWYgKGluQ2hpbmVzZSkge1xuICAgICAgICBjb3VudCArPSAyOyAvLyB+fSB0byBleGl0IENoaW5lc2UgbW9kZVxuICAgICAgICBpbkNoaW5lc2UgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGNvdW50ICs9IDI7IC8vIH5+XG4gICAgfSBlbHNlIGlmIChjb2RlIDw9IDB4N2YpIHtcbiAgICAgIGlmIChpbkNoaW5lc2UpIHtcbiAgICAgICAgY291bnQgKz0gMjsgLy8gfn0gdG8gZXhpdCBDaGluZXNlIG1vZGVcbiAgICAgICAgaW5DaGluZXNlID0gZmFsc2U7XG4gICAgICB9XG4gICAgICBjb3VudCArPSAxO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIWluQ2hpbmVzZSkge1xuICAgICAgICBjb3VudCArPSAyOyAvLyB+eyB0byBlbnRlciBDaGluZXNlIG1vZGVcbiAgICAgICAgaW5DaGluZXNlID0gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIGNvdW50ICs9IDI7XG4gICAgICBpZiAoY29kZSA+PSAweGQ4MDAgJiYgY29kZSA8PSAweGRiZmYgJiYgaSArIDEgPCBzdHIubGVuZ3RoICYmIHN0ci5jaGFyQ29kZUF0KGkgKyAxKSA+PSAweGRjMDAgJiYgc3RyLmNoYXJDb2RlQXQoaSArIDEpIDw9IDB4ZGZmZikge1xuICAgICAgICBpKys7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIGlmIChpbkNoaW5lc2UpIHtcbiAgICBjb3VudCArPSAyOyAvLyB+fSB0byBjbG9zZSBDaGluZXNlIG1vZGVcbiAgfVxuICByZXR1cm4gY291bnQ7XG59XG5cbmNvbnN0IEdCMTgwMzBfVFdPX0JZVEVfUkFOR0VTID0gW1xuICAweGE0LCAweGE0LCAweGE3LCAweGE4LCAweGIwLCAweGIxLCAweGI3LCAweGI3LCAweGQ3LCAweGQ3LFxuICAweGUwLCAweGUxLCAweGU4LCAweGVhLCAweGVjLCAweGVkLCAweGYyLCAweGYzLCAweGY3LCAweGY3LFxuICAweGY5LCAweGZhLCAweGZjLCAweGZjLCAweDEwMSwgMHgxMDEsIDB4MTEzLCAweDExMywgMHgxMWIsIDB4MTFiLFxuICAweDEyYiwgMHgxMmIsIDB4MTQ0LCAweDE0NCwgMHgxNDgsIDB4MTQ4LCAweDE0ZCwgMHgxNGQsIDB4MTZiLCAweDE2YixcbiAgMHgxY2UsIDB4MWNlLCAweDFkMCwgMHgxZDAsIDB4MWQyLCAweDFkMiwgMHgxZDQsIDB4MWQ0LCAweDFkNiwgMHgxZDYsXG4gIDB4MWQ4LCAweDFkOCwgMHgxZGEsIDB4MWRhLCAweDFkYywgMHgxZGMsIDB4MWY5LCAweDFmOSwgMHgyNTEsIDB4MjUxLFxuICAweDI2MSwgMHgyNjEsIDB4MmM3LCAweDJjNywgMHgyYzksIDB4MmNiLCAweDJkOSwgMHgyZDksIDB4MzkxLCAweDNhMSxcbiAgMHgzYTMsIDB4M2E5LCAweDNiMSwgMHgzYzEsIDB4M2MzLCAweDNjOSwgMHg0MDEsIDB4NDAxLCAweDQxMCwgMHg0NGYsXG4gIDB4NDUxLCAweDQ1MSwgMHgxZTNmLCAweDFlM2YsIDB4MjAxMCwgMHgyMDEwLCAweDIwMTMsIDB4MjAxNiwgMHgyMDE4LCAweDIwMTksXG4gIDB4MjAxYywgMHgyMDFkLCAweDIwMjUsIDB4MjAyNiwgMHgyMDMwLCAweDIwMzAsIDB4MjAzMiwgMHgyMDMzLCAweDIwMzUsIDB4MjAzNSxcbiAgMHgyMDNiLCAweDIwM2IsIDB4MjEwMywgMHgyMTAzLCAweDIxMDUsIDB4MjEwNSwgMHgyMTA5LCAweDIxMDksXG4gIDB4MjExNiwgMHgyMTE2LCAweDIxMjEsIDB4MjEyMSwgMHgyMTYwLCAweDIxNmIsIDB4MjE3MCwgMHgyMTc5LCAweDIxOTAsIDB4MjE5MyxcbiAgMHgyMTk2LCAweDIxOTksIDB4MjIwOCwgMHgyMjA4LCAweDIyMGYsIDB4MjIwZiwgMHgyMjExLCAweDIyMTEsIDB4MjIxNSwgMHgyMjE1LFxuICAweDIyMWEsIDB4MjIxYSwgMHgyMjFkLCAweDIyMjAsIDB4MjIyMywgMHgyMjIzLCAweDIyMjUsIDB4MjIyNSwgMHgyMjI3LCAweDIyMmIsXG4gIDB4MjIyZSwgMHgyMjJlLCAweDIyMzQsIDB4MjIzNywgMHgyMjNkLCAweDIyM2QsIDB4MjI0OCwgMHgyMjQ4LCAweDIyNGMsIDB4MjI0YyxcbiAgMHgyMjUyLCAweDIyNTIsIDB4MjI2MCwgMHgyMjYxLCAweDIyNjQsIDB4MjI2NywgMHgyMjZlLCAweDIyNmYsIDB4MjI5NSwgMHgyMjk1LFxuICAweDIyOTksIDB4MjI5OSwgMHgyMmE1LCAweDIyYTUsIDB4MjJiZiwgMHgyMmJmLCAweDIzMTIsIDB4MjMxMiwgMHgyNDYwLCAweDI0NjksXG4gIDB4MjQ3NCwgMHgyNDliLCAweDI1MDAsIDB4MjU0YiwgMHgyNTUwLCAweDI1NzMsIDB4MjU4MSwgMHgyNThmLCAweDI1OTMsIDB4MjU5NSxcbiAgMHgyNWEwLCAweDI1YTEsIDB4MjViMiwgMHgyNWIzLCAweDI1YmMsIDB4MjViZCwgMHgyNWM2LCAweDI1YzcsIDB4MjVjYiwgMHgyNWNiLFxuICAweDI1Y2UsIDB4MjVjZiwgMHgyNWUyLCAweDI1ZTUsIDB4MjYwNSwgMHgyNjA2LCAweDI2MDksIDB4MjYwOSwgMHgyNjQwLCAweDI2NDAsXG4gIDB4MjY0MiwgMHgyNjQyLCAweDJlODEsIDB4MmU4MSwgMHgyZTg0LCAweDJlODQsIDB4MmU4OCwgMHgyZTg4LCAweDJlOGIsIDB4MmU4YyxcbiAgMHgyZTk3LCAweDJlOTcsIDB4MmVhNywgMHgyZWE3LCAweDJlYWEsIDB4MmVhYSwgMHgyZWFlLCAweDJlYWUsIDB4MmViMywgMHgyZWIzLFxuICAweDJlYjYsIDB4MmViNywgMHgyZWJiLCAweDJlYmIsIDB4MmVjYSwgMHgyZWNhLCAweDJmZjAsIDB4MmZmYiwgMHgzMDAwLCAweDMwMDMsXG4gIDB4MzAwNSwgMHgzMDE3LCAweDMwMWQsIDB4MzAxZSwgMHgzMDIxLCAweDMwMjksIDB4MzAzZSwgMHgzMDNlLCAweDMwNDEsIDB4MzA5MyxcbiAgMHgzMDliLCAweDMwOWUsIDB4MzBhMSwgMHgzMGY2LCAweDMwZmMsIDB4MzBmZSwgMHgzMTA1LCAweDMxMjksIDB4MzIyMCwgMHgzMjI5LFxuICAweDMyMzEsIDB4MzIzMSwgMHgzMmEzLCAweDMyYTMsIDB4MzM4ZSwgMHgzMzhmLCAweDMzOWMsIDB4MzM5ZSwgMHgzM2ExLCAweDMzYTEsXG4gIDB4MzNjNCwgMHgzM2M0LCAweDMzY2UsIDB4MzNjZSwgMHgzM2QxLCAweDMzZDIsIDB4MzNkNSwgMHgzM2Q1LCAweDM0NDcsIDB4MzQ0NyxcbiAgMHgzNDczLCAweDM0NzMsIDB4MzU5ZSwgMHgzNTllLCAweDM2MGUsIDB4MzYwZSwgMHgzNjFhLCAweDM2MWEsIDB4MzkxOCwgMHgzOTE4LFxuICAweDM5NmUsIDB4Mzk2ZSwgMHgzOWNmLCAweDM5ZDAsIDB4MzlkZiwgMHgzOWRmLCAweDNhNzMsIDB4M2E3MywgMHgzYjRlLCAweDNiNGUsXG4gIDB4M2M2ZSwgMHgzYzZlLCAweDNjZTAsIDB4M2NlMCwgMHg0MDU2LCAweDQwNTYsIDB4NDE1ZiwgMHg0MTVmLCAweDQzMzcsIDB4NDMzNyxcbiAgMHg0M2FjLCAweDQzYWMsIDB4NDNiMSwgMHg0M2IxLCAweDQzZGQsIDB4NDNkZCwgMHg0NGQ2LCAweDQ0ZDYsIDB4NDY0YywgMHg0NjRjLFxuICAweDQ2NjEsIDB4NDY2MSwgMHg0NzIzLCAweDQ3MjMsIDB4NDcyOSwgMHg0NzI5LCAweDQ3N2MsIDB4NDc3YywgMHg0NzhkLCAweDQ3OGQsXG4gIDB4NDk0NywgMHg0OTQ3LCAweDQ5N2EsIDB4NDk3YSwgMHg0OTdkLCAweDQ5N2QsIDB4NDk4MiwgMHg0OTgzLCAweDQ5ODUsIDB4NDk4NixcbiAgMHg0OTliLCAweDQ5OWIsIDB4NDk5ZiwgMHg0OTlmLCAweDQ5YjYsIDB4NDliNywgMHg0Yzc3LCAweDRjNzcsIDB4NGM5ZiwgMHg0Y2EzLFxuICAweDRkMTMsIDB4NGQxOSwgMHg0ZGFlLCAweDRkYWUsIDB4NGUwMCwgMHg5ZmE1LCAweGUwMDAsIDB4ZTVlNCwgMHhlNWU2LCAweGU3NmIsXG4gIDB4ZTc2ZCwgMHhlN2M2LCAweGU3YzksIDB4ZTdlNiwgMHhlN2Y0LCAweGU4MTQsIDB4ZTgxNiwgMHhlODE4LCAweGU4MWUsIDB4ZTgxZSxcbiAgMHhlODI2LCAweGU4MjYsIDB4ZTgyYiwgMHhlODJjLCAweGU4MzEsIDB4ZTgzMiwgMHhlODNiLCAweGU4M2IsIDB4ZTg0MywgMHhlODQzLFxuICAweGU4NTQsIDB4ZTg1NSwgMHhlODY0LCAweGU4NjQsIDB4ZjkyYywgMHhmOTJjLCAweGY5NzksIDB4Zjk3OSwgMHhmOTk1LCAweGY5OTUsXG4gIDB4ZjllNywgMHhmOWU3LCAweGY5ZjEsIDB4ZjlmMSwgMHhmYTBjLCAweGZhMGYsIDB4ZmExMSwgMHhmYTExLCAweGZhMTMsIDB4ZmExNCxcbiAgMHhmYTE4LCAweGZhMTgsIDB4ZmExZiwgMHhmYTIxLCAweGZhMjMsIDB4ZmEyNCwgMHhmYTI3LCAweGZhMjksIDB4ZmUzMCwgMHhmZTMxLFxuICAweGZlMzMsIDB4ZmU0NCwgMHhmZTQ5LCAweGZlNTIsIDB4ZmU1NCwgMHhmZTU3LCAweGZlNTksIDB4ZmU2NiwgMHhmZTY4LCAweGZlNmIsXG4gIDB4ZmYwMSwgMHhmZjVlLCAweGZmZTAsIDB4ZmZlNVxuXTtcblxuLyoqXG4gKiBUZXN0IHdoZXRoZXIgYSBVbmljb2RlIEJNUCBjb2RlIHBvaW50IGlzIHdpdGhpbiB0aGUgc3RhbmRhcmQgR0JLIDItYnl0ZSByZXBlcnRvaXJlLlxuICogSW4gR0IxODAzMCwgY2hhcmFjdGVycyBpbiB0aGlzIHNldCB0YWtlIDIgYnl0ZXMsIHdoZXJlYXMgYWxsIG90aGVyIG5vbi1BU0NJSVxuICogY2hhcmFjdGVycyB0YWtlIDQgYnl0ZXMgKGUuZy4gVSswMDgwIGlzIDgxIDMwIDgxIDMwID0gNCBieXRlczsgVSswNDAwIGlzIDgxIDMwIGQxIDM0ID0gNCBieXRlcykuXG4gKiBVc2VzIGJpbmFyeSBzZWFyY2ggb3ZlciB0aGUgc3RhbmRhcmRzLWRlcml2ZWQgY29udGlndW91cyBCTVAgMi1ieXRlIHJhbmdlcy5cbiAqXG4gKiBAcGFyYW0ge051bWJlcn0gY29kZVxuICogQHJldHVybiB7Qm9vbGVhbn1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5mdW5jdGlvbiBpc0diMTgwMzBUd29CeXRlKGNvZGUpIHtcbiAgaWYgKGNvZGUgPCAweGE0IHx8IGNvZGUgPiAweGZmZTUpIHJldHVybiBmYWxzZTtcbiAgbGV0IGxvdyA9IDA7XG4gIGxldCBoaWdoID0gKEdCMTgwMzBfVFdPX0JZVEVfUkFOR0VTLmxlbmd0aCA+PiAxKSAtIDE7XG4gIHdoaWxlIChsb3cgPD0gaGlnaCkge1xuICAgIGNvbnN0IG1pZCA9IChsb3cgKyBoaWdoKSA+PiAxO1xuICAgIGNvbnN0IHMgPSBHQjE4MDMwX1RXT19CWVRFX1JBTkdFU1ttaWQgKiAyXTtcbiAgICBjb25zdCBlID0gR0IxODAzMF9UV09fQllURV9SQU5HRVNbbWlkICogMiArIDFdO1xuICAgIGlmIChjb2RlIDwgcykge1xuICAgICAgaGlnaCA9IG1pZCAtIDE7XG4gICAgfSBlbHNlIGlmIChjb2RlID4gZSkge1xuICAgICAgbG93ID0gbWlkICsgMTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBDYWxjdWxhdGUgZGVjb2RlZCBieXRlIGxlbmd0aCBmb3IgQ0pLIGRvdWJsZS1ieXRlIGNoYXJhY3RlciBlbmNvZGluZ3NcbiAqIChTaGlmdF9KSVMsIEdCSywgR0IxODAzMCwgQmlnNSwgRVVDLUpQLCBFVUMtS1IpLlxuICogQWNjdXJhdGVseSBhY2NvdW50cyBmb3Igc2luZ2xlLWJ5dGUgZXh0ZW5zaW9ucyBhbmQgbXVsdGktYnl0ZSBzZXF1ZW5jZXMgcGVyIFdIQVRXRyBFbmNvZGluZyBzdGFuZGFyZDpcbiAqIC0gU2hpZnRfSklTOiAweDgwIC0+IFUrMDA4MCAoMSBieXRlKSwgaGFsZi13aWR0aCBLYXRha2FuYSBVK0ZGNjEtVStGRjlGICgxIGJ5dGUpLCBZZW4gVSswMEE1ICgxIGJ5dGUpLCBPdmVybGluZSBVKzIwM0UgKDEgYnl0ZSlcbiAqIC0gRVVDLUpQOiBZZW4gVSswMEE1ICgxIGJ5dGUpLCBPdmVybGluZSBVKzIwM0UgKDEgYnl0ZSlcbiAqIC0gR0JLIC8gR0IxODAzMDogYnl0ZSAweDgwIC0+IEV1cm8gVSsyMEFDICgxIGJ5dGUpXG4gKiAtIEdCMTgwMzA6IGNoYXJhY3RlcnMgb3V0c2lkZSBHQksgKGUuZy4gVSswMDgwIC0+IDgxIDMwIDgxIDMwKSBhbmQgc3Vycm9nYXRlIHBhaXJzIGFyZSA0IGJ5dGVzOyBHQksgY2hhcmFjdGVycyBhcmUgMiBieXRlc1xuICogLSBPdGhlciBub24tQVNDSUkgY2hhcmFjdGVyczogMiBieXRlcyAoREJDUyBsZWFkK3RyYWlsIHBhaXJzKVxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBzdHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBjaGFyc2V0XG4gKiBAcmV0dXJuIHtOdW1iZXJ9IGJ5dGUgbGVuZ3RoXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gZ2V0RGJjc0J5dGVMZW5ndGgoc3RyLCBjaGFyc2V0KSB7XG4gIGNvbnN0IGlzU2ppcyA9IC9eKD86c2hpZnRbLV9dP2ppc3xzamlzfHdpbmRvd3NbLV9dPzMxanxjcDkzMnxtc1stX10/a2Fuaml8eFstX10/c2ppc3xjc3NoaWZ0amlzKSQvaS50ZXN0KGNoYXJzZXQpO1xuICBjb25zdCBpc0diayA9IC9eKD86Z2JrfGdiWy1fXT8yMzEyfGNoaW5lc2V8Y3BbLV9dPzkzNnx3aW5kb3dzWy1fXT85MzZ8eFstX10/Z2JrfGNzZ2IyMzEyLiopJC9pLnRlc3QoY2hhcnNldCk7XG4gIGNvbnN0IGlzR2IxODAzMCA9IC9eKD86Z2JbLV9dPzE4MDMwfGNzZ2IxODAzMCkkL2kudGVzdChjaGFyc2V0KTtcbiAgY29uc3QgaXNFdWNKcCA9IC9eKD86ZXVjWy1fXT9qcHx4Wy1fXT9ldWNbLV9dP2pwfGNzZXVjcGtkZm10amFwYW5lc2UpJC9pLnRlc3QoY2hhcnNldCk7XG5cbiAgbGV0IGNvdW50ID0gMDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjb2RlID0gc3RyLmNoYXJDb2RlQXQoaSk7XG4gICAgaWYgKGNvZGUgPD0gMHg3Zikge1xuICAgICAgY291bnQgKz0gMTtcbiAgICB9IGVsc2UgaWYgKGlzU2ppcyAmJiAoY29kZSA9PT0gMHgwMDgwIHx8IChjb2RlID49IDB4ZmY2MSAmJiBjb2RlIDw9IDB4ZmY5ZikgfHwgY29kZSA9PT0gMHgwMGE1IHx8IGNvZGUgPT09IDB4MjAzZSkpIHtcbiAgICAgIGNvdW50ICs9IDE7XG4gICAgfSBlbHNlIGlmIChpc0V1Y0pwICYmIChjb2RlID09PSAweDAwYTUgfHwgY29kZSA9PT0gMHgyMDNlKSkge1xuICAgICAgY291bnQgKz0gMTtcbiAgICB9IGVsc2UgaWYgKGlzR2JrICYmIGNvZGUgPT09IDB4MjBhYykge1xuICAgICAgY291bnQgKz0gMTtcbiAgICB9IGVsc2UgaWYgKGlzR2IxODAzMCAmJiBjb2RlID09PSAweDIwYWMpIHtcbiAgICAgIGNvdW50ICs9IDI7XG4gICAgfSBlbHNlIGlmIChjb2RlID49IDB4ZDgwMCAmJiBjb2RlIDw9IDB4ZGJmZiAmJiBpICsgMSA8IHN0ci5sZW5ndGggJiYgc3RyLmNoYXJDb2RlQXQoaSArIDEpID49IDB4ZGMwMCAmJiBzdHIuY2hhckNvZGVBdChpICsgMSkgPD0gMHhkZmZmKSB7XG4gICAgICBjb3VudCArPSBpc0diMTgwMzAgPyA0IDogMjtcbiAgICAgIGkrKztcbiAgICB9IGVsc2UgaWYgKGlzR2IxODAzMCkge1xuICAgICAgY291bnQgKz0gaXNHYjE4MDMwVHdvQnl0ZShjb2RlKSA/IDIgOiA0O1xuICAgIH0gZWxzZSB7XG4gICAgICBjb3VudCArPSAyO1xuICAgIH1cbiAgfVxuICByZXR1cm4gY291bnQ7XG59XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgZGVjb2RlZCBieXRlIGxlbmd0aCBvZiB0ZXh0IHJlc3BvbnNlIGRhdGEgaW4gdGhlIGJyb3dzZXIuXG4gKiBSZXNwZWN0cyBkZWNsYXJlZCBzdGFuZGFyZCB3ZWIgY2hhcmFjdGVyIGVuY29kaW5ncywgYmluYXJ5IGVudGl0aWVzLCBhbmQgQk9NIGJ5dGVzOlxuICogLSBEaXJlY3QgYmluYXJ5L2RlY29tcHJlc3NlZCBlbnRpdHkgaW5zcGVjdGlvbiBiZWZvcmUgdGV4dCBkZWNvZGluZ1xuICogLSBFeHBsaWNpdCBCT00gcmV0ZW50aW9uIG9uIFhIUlxuICogLSBCT00gY2hhcmFjdGVycyBpbiBkZWNvZGVkIHN0cmluZyAoVStGRUZGKVxuICogLSBTaW5nbGUtYnl0ZSBjaGFyc2V0cyAoSVNPLTg4NTktKiwgV2luZG93cy0xMjUqLCBXaW5kb3dzLTg3NCwgVElTLTYyMCwgS09JOC0qLCBNYWNpbnRvc2gsIElCTTg2NiwgVVMtQVNDSUksIGV0Yy4pXG4gKiAtIFVURi0xNiAvIFVDUy0yIG11bHRpYnl0ZSBjaGFyc2V0cyAoMiBieXRlcyBwZXIgY29kZSB1bml0ICsgQk9NKVxuICogLSBVVEYtMzIgLyBVQ1MtNCBtdWx0aWJ5dGUgY2hhcnNldHMgKDQgYnl0ZXMgcGVyIGNvZGUgcG9pbnQgKyBCT00pXG4gKiAtIElTTy0yMDIyLUpQIHN0YXRlZnVsIHNoaWZ0IGVzY2FwZSBzZXF1ZW5jZSBlbmNvZGluZ1xuICogLSBIWi1HQi0yMzEyIHN0YXRlZnVsIDctYml0IGVuY29kaW5nIChSRkMgMTg0MylcbiAqIC0gQ0pLIERCQ1MgZW5jb2RpbmdzIChTaGlmdF9KSVMsIEdCSywgR0IxODAzMCB3aXRoIDQtYnl0ZSBzZXF1ZW5jZXMsIEJpZzUsIEVVQy1KUCwgRVVDLUtSKVxuICogLSBEZWZhdWx0cyAvIFVURi04IGZhbGxiYWNrXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHN0clxuICogQHBhcmFtIHtTdHJpbmd9IFtjb250ZW50VHlwZV1cbiAqIEBwYXJhbSB7WE1MSHR0cFJlcXVlc3R9IFt4aHJdXG4gKiBAcmV0dXJuIHtOdW1iZXJ9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gZ2V0VGV4dERlY29kZWRCeXRlTGVuZ3RoKHN0ciwgY29udGVudFR5cGUsIHhocikge1xuICAvLyBDaGVjayBpZiBYSFIgZXhwb3NlcyByYXcgZGVjb21wcmVzc2VkIGVudGl0eSBieXRlcyBkaXJlY3RseSBiZWZvcmUgdGV4dCBkZWNvZGluZ1xuICBjb25zdCBiaW5hcnlCeXRlcyA9IGdldFJhd1hockJ5dGVMZW5ndGgoeGhyKTtcblxuICAvLyBJZiBhIGJpbmFyeSByZXByZXNlbnRhdGlvbiB3YXMgb2J0YWluZWQsIHRoYXQgaXMgdGhlIGV4YWN0IGRlY29tcHJlc3NlZCBlbnRpdHkgc2l6ZVxuICAvLyBiZWZvcmUgdGV4dCBkZWNvZGluZyAoYWxyZWFkeSBwcmVzZXJ2aW5nIEJPTSBieXRlcyBhbmQgbXVsdGktYnl0ZSBzZXF1ZW5jZXMpLlxuICBpZiAoYmluYXJ5Qnl0ZXMgIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIHN0ciAhPT0gJ3N0cmluZycgfHwgYmluYXJ5Qnl0ZXMgPiAwKSkge1xuICAgIGlmICh0eXBlb2Ygc3RyICE9PSAnc3RyaW5nJykgcmV0dXJuIGJpbmFyeUJ5dGVzO1xuICB9XG5cbiAgaWYgKHR5cGVvZiBzdHIgIT09ICdzdHJpbmcnKSByZXR1cm4gYmluYXJ5Qnl0ZXM7XG5cbiAgY29uc3QgbWF0Y2ggPSBjb250ZW50VHlwZSA/IC9jaGFyc2V0XFxzKj1cXHMqWydcIl0/KFteOydcIl0rKVsnXCJdPy9pLmV4ZWMoY29udGVudFR5cGUpIDogbnVsbDtcbiAgY29uc3QgY2hhcnNldCA9IG1hdGNoID8gbWF0Y2hbMV0udHJpbSgpLnJlcGxhY2UoL15bJ1wiXXxbJ1wiXSQvZywgJycpLnRvTG93ZXJDYXNlKCkgOiAnJztcblxuICBsZXQgdGV4dEJ5dGVzO1xuXG4gIC8vIFVURi04IGV4cGxpY2l0bHkgZGVjbGFyZWQgb3IgZGVmYXVsdCBmYWxsYmFjazpcbiAgaWYgKCFjaGFyc2V0IHx8IC9eKD86dXRmWy1fXT84fHVuaWNvZGVbLV9dPzFbLV9dPzFbLV9dP3V0ZlstX10/OCkkL2kudGVzdChjaGFyc2V0KSkge1xuICAgIHRleHRCeXRlcyA9IGdldFV0ZjhCeXRlTGVuZ3RoKHN0cik7XG4gIH0gZWxzZSBpZiAoL14oPzppc29bLV9dPzg4NTkuKnx3aW5kb3dzWy1fXT8xMjVcXGR8d2luZG93c1stX10/ODc0fHRpc1stX10/NjIwfGNwWy1fXT8xMjVcXGR8Y3BbLV9dP1s0OF1cXGRcXGR8aWJtWy1fXT84NjZ8bGF0aW4uKnxhc2NpaXx1c1stX10/YXNjaWl8YW5zaS4qfGtvaTguKnxtYWNpbnRvc2h8eFstX10/bWFjLip8eFstX10/dXNlclstX10/ZGVmaW5lZHxjc2lzby4qfGNzYXNjaWkpJC9pLnRlc3QoY2hhcnNldCkpIHtcbiAgICAvLyBTaW5nbGUtYnl0ZSBjaGFyc2V0czogc3RyaW5nIGxlbmd0aCBlcXVhbHMgYnl0ZSBsZW5ndGhcbiAgICB0ZXh0Qnl0ZXMgPSBzdHIubGVuZ3RoO1xuICB9IGVsc2UgaWYgKC9eKD86dXRmWy1fXT8xNig/OlstX10/KD86bGV8YmUpKT98dWNzWy1fXT8yfHVuaWNvZGV8Y3N1bmljb2RlKSQvaS50ZXN0KGNoYXJzZXQpKSB7XG4gICAgLy8gVVRGLTE2IC8gVUNTLTIgbXVsdGlieXRlIGNoYXJzZXRzOiBlYWNoIDE2LWJpdCBjb2RlIHVuaXQgaXMgMiBieXRlc1xuICAgIHRleHRCeXRlcyA9IHN0ci5sZW5ndGggKiAyO1xuICB9IGVsc2UgaWYgKC9eKD86dXRmWy1fXT8zMig/OlstX10/KD86bGV8YmUpKT98dWNzWy1fXT80KSQvaS50ZXN0KGNoYXJzZXQpKSB7XG4gICAgLy8gVVRGLTMyIC8gVUNTLTQgbXVsdGlieXRlIGNoYXJzZXRzOiBlYWNoIGNvZGUgcG9pbnQgaXMgNCBieXRlc1xuICAgIGxldCBjb3VudCA9IDA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvdW50ICs9IDQ7XG4gICAgICBjb25zdCBjb2RlID0gc3RyLmNoYXJDb2RlQXQoaSk7XG4gICAgICBpZiAoY29kZSA+PSAweGQ4MDAgJiYgY29kZSA8PSAweGRiZmYgJiYgaSArIDEgPCBzdHIubGVuZ3RoICYmIHN0ci5jaGFyQ29kZUF0KGkgKyAxKSA+PSAweGRjMDAgJiYgc3RyLmNoYXJDb2RlQXQoaSArIDEpIDw9IDB4ZGZmZikge1xuICAgICAgICBpKys7IC8vIHN1cnJvZ2F0ZSBwYWlyIHJlcHJlc2VudHMgYSBzaW5nbGUgNC1ieXRlIGNvZGUgcG9pbnRcbiAgICAgIH1cbiAgICB9XG4gICAgdGV4dEJ5dGVzID0gY291bnQ7XG4gIH0gZWxzZSBpZiAoL14oPzppc29bLV9dPzIwMjJbLV9dP2pwfGNzaXNvMjAyMmpwKSQvaS50ZXN0KGNoYXJzZXQpKSB7XG4gICAgLy8gSVNPLTIwMjItSlAgc3RhdGVmdWwgc2hpZnQgZW5jb2Rpbmc6XG4gICAgdGV4dEJ5dGVzID0gZ2V0SXNvMjAyMkpwQnl0ZUxlbmd0aChzdHIpO1xuICB9IGVsc2UgaWYgKC9eKD86aHpbLV9dP2diWy1fXT8yMzEyfGh6Wy1fXT9nYnxoenxjc2h6Z2IyMzEyKSQvaS50ZXN0KGNoYXJzZXQpKSB7XG4gICAgLy8gSFotR0ItMjMxMiBzdGF0ZWZ1bCA3LWJpdCBlbmNvZGluZyAoUkZDIDE4NDMpOlxuICAgIHRleHRCeXRlcyA9IGdldEh6R2IyMzEyQnl0ZUxlbmd0aChzdHIpO1xuICB9IGVsc2UgaWYgKC9eKD86c2hpZnRbLV9dP2ppc3xzamlzfHdpbmRvd3NbLV9dPzMxanxjcDkzMnxtc1stX10/a2Fuaml8eFstX10/c2ppc3xjc3NoaWZ0amlzfGdia3xnYlstX10/MjMxMnxnYlstX10/MTgwMzB8Y3NnYjE4MDMwfGNoaW5lc2V8Y3BbLV9dPzkzNnx3aW5kb3dzWy1fXT85MzZ8eFstX10/Z2JrfGNzZ2IyMzEyLip8ZXVjWy1fXT9qcHx4Wy1fXT9ldWNbLV9dP2pwfGNzZXVjcGtkZm10amFwYW5lc2V8YmlnNS4qfGNwOTUwfHdpbmRvd3NbLV9dPzk1MHxjblstX10/YmlnNXxldWNbLV9dP2tyfGNwOTQ5fHdpbmRvd3NbLV9dPzk0OXx1aGN8a29yZWFufGtzWy1fXT9jWy1fXT81NjAxLiopJC9pLnRlc3QoY2hhcnNldCkpIHtcbiAgICAvLyBDSksgZG91YmxlLWJ5dGUgZW5jb2RpbmdzIChTaGlmdF9KSVMsIEdCSywgR0IxODAzMCwgQmlnNSwgRVVDLUpQLCBFVUMtS1IpOlxuICAgIHRleHRCeXRlcyA9IGdldERiY3NCeXRlTGVuZ3RoKHN0ciwgY2hhcnNldCk7XG4gIH0gZWxzZSB7XG4gICAgLy8gRmFsbGJhY2s6IFVURi04IGVuY29kaW5nXG4gICAgdGV4dEJ5dGVzID0gZ2V0VXRmOEJ5dGVMZW5ndGgoc3RyKTtcbiAgfVxuXG4gIHJldHVybiBiaW5hcnlCeXRlcyAhPT0gdW5kZWZpbmVkID8gTWF0aC5tYXgodGV4dEJ5dGVzLCBiaW5hcnlCeXRlcykgOiB0ZXh0Qnl0ZXM7XG59XG5cbmZ1bmN0aW9uIFJlcXVlc3QobWV0aG9kLCB1cmwpIHtcbiAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gIHRoaXMuX3F1ZXJ5ID0gdGhpcy5fcXVlcnkgfHwgW107XG4gIHRoaXMubWV0aG9kID0gbWV0aG9kO1xuICB0aGlzLnVybCA9IHVybDtcbiAgdGhpcy5oZWFkZXIgPSB7fTsgLy8gcHJlc2VydmVzIGhlYWRlciBuYW1lIGNhc2VcbiAgdGhpcy5faGVhZGVyID0ge307IC8vIGNvZXJjZXMgaGVhZGVyIG5hbWVzIHRvIGxvd2VyY2FzZVxuICB0aGlzLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgaWYgKHNlbGYuaGFzU2l6ZUVycm9yKCkpIHJldHVybjtcblxuICAgIGxldCBlcnJvciA9IG51bGw7XG4gICAgbGV0IHJlcyA9IG51bGw7XG5cbiAgICB0cnkge1xuICAgICAgcmVzID0gbmV3IFJlc3BvbnNlKHNlbGYpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgZXJyb3IgPSBuZXcgRXJyb3IoJ1BhcnNlciBpcyB1bmFibGUgdG8gcGFyc2UgdGhlIHJlc3BvbnNlJyk7XG4gICAgICBlcnJvci5wYXJzZSA9IHRydWU7XG4gICAgICBlcnJvci5vcmlnaW5hbCA9IGVycjtcbiAgICAgIC8vIGlzc3VlICM2NzU6IHJldHVybiB0aGUgcmF3IHJlc3BvbnNlIGlmIHRoZSByZXNwb25zZSBwYXJzaW5nIGZhaWxzXG4gICAgICBpZiAoc2VsZi54aHIpIHtcbiAgICAgICAgLy8gaWU5IGRvZXNuJ3QgaGF2ZSAncmVzcG9uc2UnIHByb3BlcnR5XG4gICAgICAgIGVycm9yLnJhd1Jlc3BvbnNlID1cbiAgICAgICAgICB0eXBlb2Ygc2VsZi54aHIucmVzcG9uc2VUeXBlID09PSAndW5kZWZpbmVkJ1xuICAgICAgICAgICAgPyBzZWxmLnhoci5yZXNwb25zZVRleHRcbiAgICAgICAgICAgIDogc2VsZi54aHIucmVzcG9uc2U7XG4gICAgICAgIC8vIGlzc3VlICM4NzY6IHJldHVybiB0aGUgaHR0cCBzdGF0dXMgY29kZSBpZiB0aGUgcmVzcG9uc2UgcGFyc2luZyBmYWlsc1xuICAgICAgICBlcnJvci5zdGF0dXMgPSBzZWxmLnhoci5zdGF0dXMgPyBzZWxmLnhoci5zdGF0dXMgOiBudWxsO1xuICAgICAgICBlcnJvci5zdGF0dXNDb2RlID0gZXJyb3Iuc3RhdHVzOyAvLyBiYWNrd2FyZHMtY29tcGF0IG9ubHlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGVycm9yLnJhd1Jlc3BvbnNlID0gbnVsbDtcbiAgICAgICAgZXJyb3Iuc3RhdHVzID0gbnVsbDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHNlbGYuY2FsbGJhY2soZXJyb3IpO1xuICAgIH1cblxuICAgIHNlbGYuZW1pdCgncmVzcG9uc2UnLCByZXMpO1xuXG4gICAgbGV0IG5ld19lcnJvcjtcbiAgICB0cnkge1xuICAgICAgaWYgKCFzZWxmLl9pc1Jlc3BvbnNlT0socmVzKSkge1xuICAgICAgICBuZXdfZXJyb3IgPSBuZXcgRXJyb3IoXG4gICAgICAgICAgcmVzLnN0YXR1c1RleHQgfHwgcmVzLnRleHQgfHwgJ1Vuc3VjY2Vzc2Z1bCBIVFRQIHJlc3BvbnNlJ1xuICAgICAgICApO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgbmV3X2Vycm9yID0gZXJyOyAvLyBvaygpIGNhbGxiYWNrIGNhbiB0aHJvd1xuICAgIH1cblxuICAgIC8vICMxMDAwIGRvbid0IGNhdGNoIGVycm9ycyBmcm9tIHRoZSBjYWxsYmFjayB0byBhdm9pZCBkb3VibGUgY2FsbGluZyBpdFxuICAgIGlmIChuZXdfZXJyb3IpIHtcbiAgICAgIG5ld19lcnJvci5vcmlnaW5hbCA9IGVycm9yO1xuICAgICAgbmV3X2Vycm9yLnJlc3BvbnNlID0gcmVzO1xuICAgICAgbmV3X2Vycm9yLnN0YXR1cyA9IG5ld19lcnJvci5zdGF0dXMgfHwgcmVzLnN0YXR1cztcbiAgICAgIHNlbGYuY2FsbGJhY2sobmV3X2Vycm9yLCByZXMpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzZWxmLmNhbGxiYWNrKG51bGwsIHJlcyk7XG4gICAgfVxuICB9KTtcbn1cblxuLyoqXG4gKiBNaXhpbiBgRW1pdHRlcmAgYW5kIGBSZXF1ZXN0QmFzZWAuXG4gKi9cblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5ldy1jYXBcbkVtaXR0ZXIoUmVxdWVzdC5wcm90b3R5cGUpO1xuXG5taXhpbihSZXF1ZXN0LnByb3RvdHlwZSwgUmVxdWVzdEJhc2UucHJvdG90eXBlKTtcblxuLyoqXG4gKiBTZXQgQ29udGVudC1UeXBlIHRvIGB0eXBlYCwgbWFwcGluZyB2YWx1ZXMgZnJvbSBgcmVxdWVzdC50eXBlc2AuXG4gKlxuICogRXhhbXBsZXM6XG4gKlxuICogICAgICBzdXBlcmFnZW50LnR5cGVzLnhtbCA9ICdhcHBsaWNhdGlvbi94bWwnO1xuICpcbiAqICAgICAgcmVxdWVzdC5wb3N0KCcvJylcbiAqICAgICAgICAudHlwZSgneG1sJylcbiAqICAgICAgICAuc2VuZCh4bWxzdHJpbmcpXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XG4gKlxuICogICAgICByZXF1ZXN0LnBvc3QoJy8nKVxuICogICAgICAgIC50eXBlKCdhcHBsaWNhdGlvbi94bWwnKVxuICogICAgICAgIC5zZW5kKHhtbHN0cmluZylcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gdHlwZVxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3QucHJvdG90eXBlLnR5cGUgPSBmdW5jdGlvbiAodHlwZSkge1xuICB0aGlzLnNldCgnQ29udGVudC1UeXBlJywgcmVxdWVzdC50eXBlc1t0eXBlXSB8fCB0eXBlKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIFNldCBBY2NlcHQgdG8gYHR5cGVgLCBtYXBwaW5nIHZhbHVlcyBmcm9tIGByZXF1ZXN0LnR5cGVzYC5cbiAqXG4gKiBFeGFtcGxlczpcbiAqXG4gKiAgICAgIHN1cGVyYWdlbnQudHlwZXMuanNvbiA9ICdhcHBsaWNhdGlvbi9qc29uJztcbiAqXG4gKiAgICAgIHJlcXVlc3QuZ2V0KCcvYWdlbnQnKVxuICogICAgICAgIC5hY2NlcHQoJ2pzb24nKVxuICogICAgICAgIC5lbmQoY2FsbGJhY2spO1xuICpcbiAqICAgICAgcmVxdWVzdC5nZXQoJy9hZ2VudCcpXG4gKiAgICAgICAgLmFjY2VwdCgnYXBwbGljYXRpb24vanNvbicpXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGFjY2VwdFxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3QucHJvdG90eXBlLmFjY2VwdCA9IGZ1bmN0aW9uICh0eXBlKSB7XG4gIHRoaXMuc2V0KCdBY2NlcHQnLCByZXF1ZXN0LnR5cGVzW3R5cGVdIHx8IHR5cGUpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogU2V0IEF1dGhvcml6YXRpb24gZmllbGQgdmFsdWUgd2l0aCBgdXNlcmAgYW5kIGBwYXNzYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gdXNlclxuICogQHBhcmFtIHtTdHJpbmd9IFtwYXNzXSBvcHRpb25hbCBpbiBjYXNlIG9mIHVzaW5nICdiZWFyZXInIGFzIHR5cGVcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIHdpdGggJ3R5cGUnIHByb3BlcnR5ICdhdXRvJywgJ2Jhc2ljJyBvciAnYmVhcmVyJyAoZGVmYXVsdCAnYmFzaWMnKVxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3QucHJvdG90eXBlLmF1dGggPSBmdW5jdGlvbiAodXNlciwgcGFzcywgb3B0aW9ucykge1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSkgcGFzcyA9ICcnO1xuICBpZiAodHlwZW9mIHBhc3MgPT09ICdvYmplY3QnICYmIHBhc3MgIT09IG51bGwpIHtcbiAgICAvLyBwYXNzIGlzIG9wdGlvbmFsIGFuZCBjYW4gYmUgcmVwbGFjZWQgd2l0aCBvcHRpb25zXG4gICAgb3B0aW9ucyA9IHBhc3M7XG4gICAgcGFzcyA9ICcnO1xuICB9XG5cbiAgaWYgKCFvcHRpb25zKSB7XG4gICAgb3B0aW9ucyA9IHtcbiAgICAgIHR5cGU6IHR5cGVvZiBidG9hID09PSAnZnVuY3Rpb24nID8gJ2Jhc2ljJyA6ICdhdXRvJ1xuICAgIH07XG4gIH1cblxuICBjb25zdCBlbmNvZGVyID0gb3B0aW9ucy5lbmNvZGVyXG4gICAgPyBvcHRpb25zLmVuY29kZXJcbiAgICA6IChzdHJpbmcpID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiBidG9hID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgcmV0dXJuIGJ0b2Eoc3RyaW5nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IHVzZSBiYXNpYyBhdXRoLCBidG9hIGlzIG5vdCBhIGZ1bmN0aW9uJyk7XG4gICAgICB9O1xuXG4gIHJldHVybiB0aGlzLl9hdXRoKHVzZXIsIHBhc3MsIG9wdGlvbnMsIGVuY29kZXIpO1xufTtcblxuLyoqXG4gKiBBZGQgcXVlcnktc3RyaW5nIGB2YWxgLlxuICpcbiAqIEV4YW1wbGVzOlxuICpcbiAqICAgcmVxdWVzdC5nZXQoJy9zaG9lcycpXG4gKiAgICAgLnF1ZXJ5KCdzaXplPTEwJylcbiAqICAgICAucXVlcnkoeyBjb2xvcjogJ2JsdWUnIH0pXG4gKlxuICogQHBhcmFtIHtPYmplY3R8U3RyaW5nfSB2YWxcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5xdWVyeSA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJykgdmFsdWUgPSBzZXJpYWxpemUodmFsdWUpO1xuICBpZiAodmFsdWUpIHRoaXMuX3F1ZXJ5LnB1c2godmFsdWUpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogUXVldWUgdGhlIGdpdmVuIGBmaWxlYCBhcyBhbiBhdHRhY2htZW50IHRvIHRoZSBzcGVjaWZpZWQgYGZpZWxkYCxcbiAqIHdpdGggb3B0aW9uYWwgYG9wdGlvbnNgIChvciBmaWxlbmFtZSkuXG4gKlxuICogYGBgIGpzXG4gKiByZXF1ZXN0LnBvc3QoJy91cGxvYWQnKVxuICogICAuYXR0YWNoKCdjb250ZW50JywgbmV3IEJsb2IoWyc8YSBpZD1cImFcIj48YiBpZD1cImJcIj5oZXkhPC9iPjwvYT4nXSwgeyB0eXBlOiBcInRleHQvaHRtbFwifSkpXG4gKiAgIC5lbmQoY2FsbGJhY2spO1xuICogYGBgXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGZpZWxkXG4gKiBAcGFyYW0ge0Jsb2J8RmlsZX0gZmlsZVxuICogQHBhcmFtIHtTdHJpbmd8T2JqZWN0fSBvcHRpb25zXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUuYXR0YWNoID0gZnVuY3Rpb24gKGZpZWxkLCBmaWxlLCBvcHRpb25zKSB7XG4gIGlmIChmaWxlKSB7XG4gICAgaWYgKHRoaXMuX2RhdGEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN1cGVyYWdlbnQgY2FuJ3QgbWl4IC5zZW5kKCkgYW5kIC5hdHRhY2goKVwiKTtcbiAgICB9XG5cbiAgICBsZXQgdmFsID0gZmlsZTtcbiAgICBpZiAodHlwZW9mIEJsb2IgIT09ICd1bmRlZmluZWQnICYmICEodmFsIGluc3RhbmNlb2YgQmxvYikpIHtcbiAgICAgIGlmICh0eXBlb2YgQnVmZmVyICE9PSAndW5kZWZpbmVkJyAmJiBCdWZmZXIuaXNCdWZmZXIodmFsKSkge1xuICAgICAgICB2YWwgPSBuZXcgQmxvYihbdmFsXSk7XG4gICAgICB9IGVsc2UgaWYgKHZhbCBpbnN0YW5jZW9mIEFycmF5QnVmZmVyIHx8ICh0eXBlb2YgQXJyYXlCdWZmZXIgIT09ICd1bmRlZmluZWQnICYmIEFycmF5QnVmZmVyLmlzVmlldyAmJiBBcnJheUJ1ZmZlci5pc1ZpZXcodmFsKSkpIHtcbiAgICAgICAgdmFsID0gbmV3IEJsb2IoW3ZhbF0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGZpbGVuYW1lID0gdHlwZW9mIG9wdGlvbnMgPT09ICdzdHJpbmcnXG4gICAgICA/IG9wdGlvbnNcbiAgICAgIDogKG9wdGlvbnMgJiYgb3B0aW9ucy5maWxlbmFtZSA/IG9wdGlvbnMuZmlsZW5hbWUgOiAoZmlsZSAmJiBmaWxlLm5hbWUpKTtcblxuICAgIGlmICghdGhpcy5fZm9ybUZpZWxkcykgdGhpcy5fZm9ybUZpZWxkcyA9IFtdO1xuICAgIHRoaXMuX2Zvcm1GaWVsZHMucHVzaChbZmllbGQsIHZhbCwgb3B0aW9ucyB8fCBmaWxlbmFtZV0pO1xuICAgIGNvbnN0IGFwcGVuZE5hbWUgPSBmaWxlbmFtZSB8fCAoZmlsZSAmJiBmaWxlLm5hbWUpO1xuICAgIGlmIChhcHBlbmROYW1lKSB7XG4gICAgICB0aGlzLl9nZXRGb3JtRGF0YSgpLmFwcGVuZChmaWVsZCwgdmFsLCBhcHBlbmROYW1lKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fZ2V0Rm9ybURhdGEoKS5hcHBlbmQoZmllbGQsIHZhbCk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5fZ2V0Rm9ybURhdGEgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICghdGhpcy5fZm9ybURhdGEpIHtcbiAgICBjb25zdCBGb3JtRGF0YUNvbnN0cnVjdG9yID1cbiAgICAgIChyb290ICYmIHJvb3QuRm9ybURhdGEpIHx8XG4gICAgICAodHlwZW9mIEZvcm1EYXRhICE9PSAndW5kZWZpbmVkJyA/IEZvcm1EYXRhIDogdW5kZWZpbmVkKSB8fFxuICAgICAgKHR5cGVvZiBnbG9iYWwgIT09ICd1bmRlZmluZWQnID8gZ2xvYmFsLkZvcm1EYXRhIDogdW5kZWZpbmVkKTtcbiAgICB0aGlzLl9mb3JtRGF0YSA9IG5ldyBGb3JtRGF0YUNvbnN0cnVjdG9yKCk7XG4gIH1cblxuICByZXR1cm4gdGhpcy5fZm9ybURhdGE7XG59O1xuXG4vKipcbiAqIEludm9rZSB0aGUgY2FsbGJhY2sgd2l0aCBgZXJyYCBhbmQgYHJlc2BcbiAqIGFuZCBoYW5kbGUgYXJpdHkgY2hlY2suXG4gKlxuICogQHBhcmFtIHtFcnJvcn0gZXJyXG4gKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXNcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblJlcXVlc3QucHJvdG90eXBlLmNhbGxiYWNrID0gZnVuY3Rpb24gKGVycm9yLCByZXMpIHtcbiAgaWYgKHRoaXMuX3Nob3VsZFJldHJ5KGVycm9yLCByZXMpKSB7XG4gICAgcmV0dXJuIHRoaXMuX3JldHJ5KCk7XG4gIH1cblxuICBpZiAodGhpcy5jYWxsZWQpIHJldHVybjtcbiAgdGhpcy5jYWxsZWQgPSB0cnVlO1xuXG4gIGNvbnN0IGZuID0gdGhpcy5fY2FsbGJhY2s7XG4gIHRoaXMuY2xlYXJUaW1lb3V0KCk7XG5cbiAgaWYgKGVycm9yKSB7XG4gICAgaWYgKHRoaXMuaGFzU2l6ZUVycm9yKCkgfHwgZXJyb3IuY29kZSA9PT0gJ0VUT09MQVJHRScpIHtcbiAgICAgIC8vIFNpemUgZXJyb3JzIG11c3QgbmV2ZXIgdHJpZ2dlciBhdXRvbWF0aWMgcmV0cmllczsgcmV0cmllcyBjb3VudCBpcyBhbHdheXMgMC5cbiAgICAgIGVycm9yLnJldHJpZXMgPSAwO1xuICAgIH0gZWxzZSBpZiAodGhpcy5fbWF4UmV0cmllcykge1xuICAgICAgZXJyb3IucmV0cmllcyA9IHRoaXMuX3JldHJpZXMgLSAxO1xuICAgIH1cbiAgICB0aGlzLmVtaXQoJ2Vycm9yJywgZXJyb3IpO1xuICB9XG5cbiAgaWYgKHR5cGVvZiBmbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGZuKGVycm9yLCByZXMpO1xuICB9XG59O1xuXG4vKipcbiAqIEludm9rZSBjYWxsYmFjayB3aXRoIHgtZG9tYWluIGVycm9yLlxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbi8qKlxuICogQWJvcnQgdGhlIHJlcXVlc3QgYW5kIGludm9rZSBjYWxsYmFjayB3aXRoIHNpemUgbGltaXQgZXJyb3IuXG4gKiBTZXRzIF9zaXplRXJyb3IsIGFib3J0cyB0aGUgWEhSLCBhbmQgZmlyZXMgY2FsbGJhY2sgZXhhY3RseSBvbmNlLlxuICogQ2FsbGVkIGJ5IGJvdGggcmVxdWVzdCBhbmQgcmVzcG9uc2Ugc2l6ZSBlbmZvcmNlbWVudCBwYXRocy5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gdHlwZSAncmVxdWVzdCcgb3IgJ3Jlc3BvbnNlJ1xuICogQHJldHVybiB7RXJyb3J9IHNpemUgZXJyb3JcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5SZXF1ZXN0LnByb3RvdHlwZS5fYWJvcnRXaXRoU2l6ZUVycm9yID0gZnVuY3Rpb24gKHR5cGUpIHtcbiAgaWYgKHRoaXMuaGFzU2l6ZUVycm9yKCkpIHJldHVybiB0aGlzLl9zaXplRXJyb3I7XG5cbiAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoYE1heGltdW0gJHt0eXBlfSBzaXplIHJlYWNoZWRgKTtcbiAgZXJyb3IuY29kZSA9ICdFVE9PTEFSR0UnO1xuICBlcnJvci5yZXRyaWVzID0gMDtcbiAgdGhpcy5fc2l6ZUVycm9yID0gZXJyb3I7XG5cbiAgdGhpcy5hYm9ydCgpO1xuICBpZiAoIXRoaXMuY2FsbGVkKSB7XG4gICAgdGhpcy5jYWxsYmFjayhlcnJvciwgdHlwZSA9PT0gJ3Jlc3BvbnNlJyA/IG51bGwgOiB1bmRlZmluZWQpO1xuICB9XG4gIHJldHVybiBlcnJvcjtcbn07XG5cblJlcXVlc3QucHJvdG90eXBlLmNyb3NzRG9tYWluRXJyb3IgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKFxuICAgICdSZXF1ZXN0IGhhcyBiZWVuIHRlcm1pbmF0ZWRcXG5Qb3NzaWJsZSBjYXVzZXM6IHRoZSBuZXR3b3JrIGlzIG9mZmxpbmUsIE9yaWdpbiBpcyBub3QgYWxsb3dlZCBieSBBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4sIHRoZSBwYWdlIGlzIGJlaW5nIHVubG9hZGVkLCBldGMuJ1xuICApO1xuICBlcnJvci5jcm9zc0RvbWFpbiA9IHRydWU7XG5cbiAgZXJyb3Iuc3RhdHVzID0gdGhpcy5zdGF0dXM7XG4gIGVycm9yLm1ldGhvZCA9IHRoaXMubWV0aG9kO1xuICBlcnJvci51cmwgPSB0aGlzLnVybDtcblxuICB0aGlzLmNhbGxiYWNrKGVycm9yKTtcbn07XG5cbi8vIFRoaXMgb25seSB3YXJucywgYmVjYXVzZSB0aGUgcmVxdWVzdCBpcyBzdGlsbCBsaWtlbHkgdG8gd29ya1xuUmVxdWVzdC5wcm90b3R5cGUuYWdlbnQgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnNvbGUud2FybignVGhpcyBpcyBub3Qgc3VwcG9ydGVkIGluIGJyb3dzZXIgdmVyc2lvbiBvZiBzdXBlcmFnZW50Jyk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuUmVxdWVzdC5wcm90b3R5cGUuY2EgPSBSZXF1ZXN0LnByb3RvdHlwZS5hZ2VudDtcblJlcXVlc3QucHJvdG90eXBlLmJ1ZmZlciA9IFJlcXVlc3QucHJvdG90eXBlLmNhO1xuXG4vLyBUaGlzIHRocm93cywgYmVjYXVzZSBpdCBjYW4ndCBzZW5kL3JlY2VpdmUgZGF0YSBhcyBleHBlY3RlZFxuUmVxdWVzdC5wcm90b3R5cGUud3JpdGUgPSAoKSA9PiB7XG4gIHRocm93IG5ldyBFcnJvcihcbiAgICAnU3RyZWFtaW5nIGlzIG5vdCBzdXBwb3J0ZWQgaW4gYnJvd3NlciB2ZXJzaW9uIG9mIHN1cGVyYWdlbnQnXG4gICk7XG59O1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5waXBlID0gUmVxdWVzdC5wcm90b3R5cGUud3JpdGU7XG5cbi8qKlxuICogQ2hlY2sgaWYgYG9iamAgaXMgYSBob3N0IG9iamVjdCxcbiAqIHdlIGRvbid0IHdhbnQgdG8gc2VyaWFsaXplIHRoZXNlIDopXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9iaiBob3N0IG9iamVjdFxuICogQHJldHVybiB7Qm9vbGVhbn0gaXMgYSBob3N0IG9iamVjdFxuICogQGFwaSBwcml2YXRlXG4gKi9cblJlcXVlc3QucHJvdG90eXBlLl9pc0hvc3QgPSBmdW5jdGlvbiAob2JqZWN0KSB7XG4gIC8vIE5hdGl2ZSBvYmplY3RzIHN0cmluZ2lmeSB0byBbb2JqZWN0IEZpbGVdLCBbb2JqZWN0IEJsb2JdLCBbb2JqZWN0IEZvcm1EYXRhXSwgZXRjLlxuICByZXR1cm4gKFxuICAgIG9iamVjdCAmJlxuICAgIHR5cGVvZiBvYmplY3QgPT09ICdvYmplY3QnICYmXG4gICAgIUFycmF5LmlzQXJyYXkob2JqZWN0KSAmJlxuICAgIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvYmplY3QpICE9PSAnW29iamVjdCBPYmplY3RdJ1xuICApO1xufTtcblxuLyoqXG4gKiBJbml0aWF0ZSByZXF1ZXN0LCBpbnZva2luZyBjYWxsYmFjayBgZm4ocmVzKWBcbiAqIHdpdGggYW4gaW5zdGFuY2VvZiBgUmVzcG9uc2VgLlxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUuZW5kID0gZnVuY3Rpb24gKGZuKSB7XG4gIGlmICh0aGlzLl9lbmRDYWxsZWQpIHtcbiAgICBjb25zb2xlLndhcm4oXG4gICAgICAnV2FybmluZzogLmVuZCgpIHdhcyBjYWxsZWQgdHdpY2UuIFRoaXMgaXMgbm90IHN1cHBvcnRlZCBpbiBzdXBlcmFnZW50J1xuICAgICk7XG4gIH1cblxuICB0aGlzLl9lbmRDYWxsZWQgPSB0cnVlO1xuXG4gIC8vIHN0b3JlIGNhbGxiYWNrXG4gIHRoaXMuX2NhbGxiYWNrID0gZm4gfHwgbm9vcDtcblxuICAvLyBxdWVyeXN0cmluZ1xuICB0aGlzLl9maW5hbGl6ZVF1ZXJ5U3RyaW5nKCk7XG5cbiAgdGhpcy5fZW5kKCk7XG59O1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5fc2V0VXBsb2FkVGltZW91dCA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3Qgc2VsZiA9IHRoaXM7XG5cbiAgLy8gdXBsb2FkIHRpbWVvdXQgaXQncyB3b2tycyBvbmx5IGlmIGRlYWRsaW5lIHRpbWVvdXQgaXMgb2ZmXG4gIGlmICh0aGlzLl91cGxvYWRUaW1lb3V0ICYmICF0aGlzLl91cGxvYWRUaW1lb3V0VGltZXIpIHtcbiAgICB0aGlzLl91cGxvYWRUaW1lb3V0VGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHNlbGYuX3RpbWVvdXRFcnJvcihcbiAgICAgICAgJ1VwbG9hZCB0aW1lb3V0IG9mICcsXG4gICAgICAgIHNlbGYuX3VwbG9hZFRpbWVvdXQsXG4gICAgICAgICdFVElNRURPVVQnXG4gICAgICApO1xuICAgIH0sIHRoaXMuX3VwbG9hZFRpbWVvdXQpO1xuICB9XG59O1xuXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgY29tcGxleGl0eVxuUmVxdWVzdC5wcm90b3R5cGUuX2VuZCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHRoaXMuX2Fib3J0ZWQpXG4gICAgcmV0dXJuIHRoaXMuY2FsbGJhY2soXG4gICAgICB0aGlzLl9zaXplRXJyb3IgfHxcbiAgICAgICAgbmV3IEVycm9yKCdUaGUgcmVxdWVzdCBoYXMgYmVlbiBhYm9ydGVkIGV2ZW4gYmVmb3JlIC5lbmQoKSB3YXMgY2FsbGVkJylcbiAgICApO1xuXG4gIGNvbnN0IHNlbGYgPSB0aGlzO1xuICB0aGlzLnhociA9IHJlcXVlc3QuZ2V0WEhSKCk7XG4gIGNvbnN0IHsgeGhyIH0gPSB0aGlzO1xuICBsZXQgZGF0YSA9IHRoaXMuX2Zvcm1EYXRhQmxvYiB8fCB0aGlzLl9mb3JtRGF0YSB8fCB0aGlzLl9kYXRhO1xuXG4gIHRoaXMuX3NldFRpbWVvdXRzKCk7XG5cbiAgLy8gc3RhdGUgY2hhbmdlXG4gIHhoci5hZGRFdmVudExpc3RlbmVyKCdyZWFkeXN0YXRlY2hhbmdlJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgcmVhZHlTdGF0ZSB9ID0geGhyO1xuICAgIGlmIChyZWFkeVN0YXRlID49IDIgJiYgc2VsZi5fcmVzcG9uc2VUaW1lb3V0VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dChzZWxmLl9yZXNwb25zZVRpbWVvdXRUaW1lcik7XG4gICAgfVxuXG4gICAgaWYgKHJlYWR5U3RhdGUgIT09IDQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoc2VsZi5fbWF4UmVzcG9uc2VTaXplICE9PSB1bmRlZmluZWQgJiYgIXNlbGYuaGFzU2l6ZUVycm9yKCkpIHtcbiAgICAgIGxldCBzdGF0dXMgPSAwO1xuICAgICAgdHJ5IHtcbiAgICAgICAgc3RhdHVzID0geGhyLnN0YXR1cztcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBzdGF0dXMgPSAwO1xuICAgICAgfVxuXG4gICAgICAvLyBOb3JtYWxpemUgSUUvbGVnYWN5IFhIUiAxMjIzIHN0YXR1cyB0byAyMDQgTm8gQ29udGVudFxuICAgICAgaWYgKHN0YXR1cyA9PT0gMTIyMykge1xuICAgICAgICBzdGF0dXMgPSAyMDQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGlzQm9keWxlc3MgPSBzZWxmLm1ldGhvZCA9PT0gJ0hFQUQnIHx8IHN0YXR1cyA9PT0gMjA0IHx8IHN0YXR1cyA9PT0gMzA0O1xuXG4gICAgICAvLyBNZWFzdXJlIHRoZSB0ZXJtaW5hbCBkZWNvZGVkIHJlc3BvbnNlIGJvZHkgYXQgcmVhZHlTdGF0ZSA0LlxuICAgICAgbGV0IGZpbmFsQnl0ZXM7XG4gICAgICBpZiAoIWlzQm9keWxlc3MpIHtcbiAgICAgICAgbGV0IHJhdztcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBpZiAoeGhyLnJlc3BvbnNlICE9PSB1bmRlZmluZWQgJiYgeGhyLnJlc3BvbnNlICE9PSBudWxsKSB7XG4gICAgICAgICAgICByYXcgPSB4aHIucmVzcG9uc2U7XG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChfKSB7XG4gICAgICAgICAgLy8gSWdub3JlIGVycm9yIGFjY2Vzc2luZyB4aHIucmVzcG9uc2VcbiAgICAgICAgfVxuICAgICAgICBpZiAocmF3ID09PSB1bmRlZmluZWQgfHwgcmF3ID09PSBudWxsKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHJhdyA9IHhoci5yZXNwb25zZVRleHQ7XG4gICAgICAgICAgfSBjYXRjaCAoXykge1xuICAgICAgICAgICAgcmF3ID0gbnVsbDtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBXaXJlLXNpZGUgYnl0ZSBjb3VudHMgKGZyb20gcHJvZ3Jlc3MgZXZlbnRzIG9yIENvbnRlbnQtTGVuZ3RoKS5cbiAgICAgICAgbGV0IHdpcmVCeXRlcyA9IHNlbGYuX3Jlc3BvbnNlQnl0ZXNSZWNlaXZlZDtcbiAgICAgICAgaWYgKHR5cGVvZiB3aXJlQnl0ZXMgIT09ICdudW1iZXInKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGNsSGVhZGVyID0geGhyLmdldFJlc3BvbnNlSGVhZGVyKCdDb250ZW50LUxlbmd0aCcpO1xuICAgICAgICAgICAgaWYgKGNsSGVhZGVyKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlSW50KGNsSGVhZGVyLCAxMCk7XG4gICAgICAgICAgICAgIGlmICghaXNOYU4ocGFyc2VkKSkgd2lyZUJ5dGVzID0gcGFyc2VkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gY2F0Y2ggKF9pZ25vcmVIZWFkZXJFcnJvcikge1xuICAgICAgICAgICAgd2lyZUJ5dGVzID0gdW5kZWZpbmVkO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBjdEhlYWRlciA9ICcnO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGN0SGVhZGVyID0geGhyLmdldFJlc3BvbnNlSGVhZGVyKCdDb250ZW50LVR5cGUnKSB8fCAnJztcbiAgICAgICAgfSBjYXRjaCAoXykge1xuICAgICAgICAgIC8vIElnbm9yZSBlcnJvciByZWFkaW5nIENvbnRlbnQtVHlwZSBoZWFkZXJcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBpc0NvbXByZXNzZWQgPSBmYWxzZTtcbiAgICAgICAgbGV0IGlzRW5jb2RpbmdFc3RhYmxpc2hlZCA9IGZhbHNlO1xuICAgICAgICBsZXQgY2UgPSAnJztcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjZSA9IHhoci5nZXRSZXNwb25zZUhlYWRlcignQ29udGVudC1FbmNvZGluZycpIHx8ICcnO1xuICAgICAgICAgIGlmIChjZSkge1xuICAgICAgICAgICAgaXNFbmNvZGluZ0VzdGFibGlzaGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIC8vIFRyZWF0IGFueSBub24taWRlbnRpdHkgQ29udGVudC1FbmNvZGluZyBhcyBjb21wcmVzc2VkOlxuICAgICAgICAgICAgLy8gaWRlbnRpdHkgaXMgdGhlIG9ubHkgY29kZWMgdGhhdCBndWFyYW50ZWVzIHdpcmUgPT0gZGVjb2RlZC5cbiAgICAgICAgICAgIC8vIEFsbCBvdGhlciB2YWx1ZXMgKGd6aXAsIGRlZmxhdGUsIGJyLCB6c3RkLCBldGMuKSBpbmRpY2F0ZVxuICAgICAgICAgICAgLy8gdGhlIFhIUiBib2R5IGhhcyBiZWVuIGRlY29tcHJlc3NlZCBieSB0aGUgYnJvd3Nlci5cbiAgICAgICAgICAgIGNvbnN0IGlzSWRlbnRpdHkgPSBjZS50cmltKCkudG9Mb3dlckNhc2UoKSA9PT0gJ2lkZW50aXR5JztcbiAgICAgICAgICAgIGlzQ29tcHJlc3NlZCA9ICFpc0lkZW50aXR5O1xuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoXykge1xuICAgICAgICAgIC8vIElnbm9yZSBlcnJvciByZWFkaW5nIENvbnRlbnQtRW5jb2RpbmcgaGVhZGVyXG4gICAgICAgIH1cblxuICAgICAgICAvLyBGb3Igc2FtZS1vcmlnaW4gcmVzcG9uc2VzLCBhbGwgcmVzcG9uc2UgaGVhZGVycyBhcmUgZXhwb3NlZCBieSBYSFIuXG4gICAgICAgIC8vIEEgbWlzc2luZyBDb250ZW50LUVuY29kaW5nIGhlYWRlciBvbiBhbiBleHBvc2VkIHNhbWUtb3JpZ2luIHJlc3BvbnNlIGlzIGtub3duIGFic2VudFxuICAgICAgICAvLyBhbmQgZGVub3RlcyBpZGVudGl0eSAodW5jb21wcmVzc2VkKS5cbiAgICAgICAgY29uc3QgaXNTYW1lT3JpZ2luID0gaXNTYW1lT3JpZ2luUmVxdWVzdCh4aHIsIHNlbGYudXJsKTtcbiAgICAgICAgY29uc3QgaXNDb21wcmVzc2VkT3JVbmV4cG9zZWQgPSBpc0NvbXByZXNzZWQgfHwgKCFpc1NhbWVPcmlnaW4gJiYgIWNlKTtcbiAgICAgICAgY29uc3QgaXNLbm93bklkZW50aXR5ID0gKGlzRW5jb2RpbmdFc3RhYmxpc2hlZCAmJiAhaXNDb21wcmVzc2VkKSB8fCAoaXNTYW1lT3JpZ2luICYmICFjZSk7XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgeGhyIGV4cG9zZXMgcmF3IGRlY29tcHJlc3NlZCBlbnRpdHkgYnl0ZXMgYmVmb3JlIHRleHQgZGVjb2RpbmdcbiAgICAgICAgY29uc3QgcmF3RW50aXR5Qnl0ZXMgPSBnZXRSYXdYaHJCeXRlTGVuZ3RoKHhocik7XG5cbiAgICAgICAgLy8gTWVhc3VyZSBkZWNvZGVkIGJ5dGVzOlxuICAgICAgICBsZXQgZGVjb2RlZEJ5dGVzO1xuICAgICAgICBpZiAodHlwZW9mIHJhdyA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICBkZWNvZGVkQnl0ZXMgPSBnZXRUZXh0RGVjb2RlZEJ5dGVMZW5ndGgocmF3LCBjdEhlYWRlciwgeGhyKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBkZWNvZGVkQnl0ZXMgPSBnZXRSZXNwb25zZUludHJpbnNpY0J5dGVMZW5ndGgocmF3KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChyYXdFbnRpdHlCeXRlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgZGVjb2RlZEJ5dGVzID0gdHlwZW9mIGRlY29kZWRCeXRlcyA9PT0gJ251bWJlcicgPyBNYXRoLm1heChkZWNvZGVkQnl0ZXMsIHJhd0VudGl0eUJ5dGVzKSA6IHJhd0VudGl0eUJ5dGVzO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGlzS25vd25JZGVudGl0eSkge1xuICAgICAgICAgIC8vIEZvciBjb25maXJtZWQgdW5jb21wcmVzc2VkIHJlc3BvbnNlcywgdXNlIHRoZSBhY3R1YWwgdHJhbnNmZXIvYm9keSBieXRlIGNvdW50XG4gICAgICAgICAgLy8gKG9yIGVuY29kZSBhY2NvcmRpbmcgdG8gdGhlIGRlY2xhcmVkIGNoYXJzZXQgaWYgd2lyZUJ5dGVzIGlzIHVuYXZhaWxhYmxlKS5cbiAgICAgICAgICBpZiAodHlwZW9mIHdpcmVCeXRlcyA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgIGZpbmFsQnl0ZXMgPSB3aXJlQnl0ZXM7XG4gICAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgZGVjb2RlZEJ5dGVzID09PSAnbnVtYmVyJykge1xuICAgICAgICAgICAgZmluYWxCeXRlcyA9IGRlY29kZWRCeXRlcztcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoaXNDb21wcmVzc2VkKSB7XG4gICAgICAgICAgLy8gR2VudWluZWx5IGNvbXByZXNzZWQgcmVzcG9uc2U6IGV2YWx1YXRlIGRlY29kZWQgYnl0ZXMgZGlyZWN0bHkuXG4gICAgICAgICAgLy8gSWYgZXhhY3QgZGVjb2RlZCBiaW5hcnkgYnl0ZXMgY2Fubm90IGJlIGRldGVybWluZWQgKGUuZy4gcGFyc2VkIG9iamVjdCksXG4gICAgICAgICAgLy8gZmFpbCBjb25zZXJ2YXRpdmVseSB3aXRoIEVUT09MQVJHRSFcbiAgICAgICAgICBpZiAodHlwZW9mIGRlY29kZWRCeXRlcyA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgIGZpbmFsQnl0ZXMgPSBkZWNvZGVkQnl0ZXM7XG4gICAgICAgICAgfSBlbHNlIGlmICh0eXBlb2Ygd2lyZUJ5dGVzID09PSAnbnVtYmVyJyAmJiB3aXJlQnl0ZXMgPiBzZWxmLl9tYXhSZXNwb25zZVNpemUpIHtcbiAgICAgICAgICAgIGZpbmFsQnl0ZXMgPSB3aXJlQnl0ZXM7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGZpbmFsQnl0ZXMgPSAoc2VsZi5fbWF4UmVzcG9uc2VTaXplIHx8IDApICsgMTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoaXNDb21wcmVzc2VkT3JVbmV4cG9zZWQpIHtcbiAgICAgICAgICAvLyBVbmV4cG9zZWQtY29tcHJlc3Npb24gY2FzZXMgKGUuZy4gQ09SUyB3aGVyZSBDb250ZW50LUVuY29kaW5nIGlzIHVuZXhwb3NlZCk6XG4gICAgICAgICAgaWYgKHR5cGVvZiBkZWNvZGVkQnl0ZXMgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgICBmaW5hbEJ5dGVzID0gZGVjb2RlZEJ5dGVzO1xuICAgICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHdpcmVCeXRlcyA9PT0gJ251bWJlcicgJiYgd2lyZUJ5dGVzID4gc2VsZi5fbWF4UmVzcG9uc2VTaXplKSB7XG4gICAgICAgICAgICBmaW5hbEJ5dGVzID0gd2lyZUJ5dGVzO1xuICAgICAgICAgIH0gZWxzZSBpZiAod2lyZUJ5dGVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGZpbmFsQnl0ZXMgPSB3aXJlQnl0ZXM7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZpbmFsQnl0ZXMgPSB0eXBlb2YgZGVjb2RlZEJ5dGVzID09PSAnbnVtYmVyJyA/IGRlY29kZWRCeXRlcyA6IHdpcmVCeXRlcztcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKHR5cGVvZiBmaW5hbEJ5dGVzID09PSAnbnVtYmVyJyAmJiBmaW5hbEJ5dGVzID4gc2VsZi5fbWF4UmVzcG9uc2VTaXplKSB7XG4gICAgICAgIHNlbGYuX2Fib3J0V2l0aFNpemVFcnJvcigncmVzcG9uc2UnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEluIElFOSwgcmVhZHMgdG8gYW55IHByb3BlcnR5IChlLmcuIHN0YXR1cykgb2ZmIG9mIGFuIGFib3J0ZWQgWEhSIHdpbGxcbiAgICAvLyByZXN1bHQgaW4gdGhlIGVycm9yIFwiQ291bGQgbm90IGNvbXBsZXRlIHRoZSBvcGVyYXRpb24gZHVlIHRvIGVycm9yIGMwMGMwMjNmXCJcbiAgICBsZXQgc3RhdHVzO1xuICAgIHRyeSB7XG4gICAgICBzdGF0dXMgPSB4aHIuc3RhdHVzO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgc3RhdHVzID0gMDtcbiAgICB9XG5cbiAgICAvLyBIVFRQIDMwNSBVc2UgUHJveHk6IEJyb3dzZXIgRmV0Y2gvWEhSIGRvZXMgbm90IGZvbGxvdyAzMDUgYXV0b21hdGljYWxseS5cbiAgICAvLyBGb3IgbWV0aG9kLXByZXNlcnZpbmcgMzA1IHJlZGlyZWN0LCBmb2xsb3cgTG9jYXRpb24sIGNyZWF0ZSBuZXh0IFhIUiBhbmQgcmVwbGF5IGJvZHkuXG4gICAgaWYgKHN0YXR1cyA9PT0gMzA1KSB7XG4gICAgICBsZXQgbG9jID0gJyc7XG4gICAgICB0cnkge1xuICAgICAgICBsb2MgPSB4aHIuZ2V0UmVzcG9uc2VIZWFkZXIoJ0xvY2F0aW9uJyk7XG4gICAgICB9IGNhdGNoIChfKSB7XG4gICAgICAgIC8vIGlnbm9yZSBlcnJvciByZWFkaW5nIExvY2F0aW9uIGhlYWRlclxuICAgICAgfVxuICAgICAgY29uc3QgbWF4UmVkaXJlY3RzID0gc2VsZi5fbWF4UmVkaXJlY3RzID09PSB1bmRlZmluZWQgPyA1IDogc2VsZi5fbWF4UmVkaXJlY3RzO1xuICAgICAgaWYgKGxvYyAmJiAoc2VsZi5fcmVkaXJlY3RzIHx8IDApIDwgbWF4UmVkaXJlY3RzKSB7XG4gICAgICAgIHNlbGYuX3JlZGlyZWN0cyA9IChzZWxmLl9yZWRpcmVjdHMgfHwgMCkgKyAxO1xuICAgICAgICBzZWxmLl9yZWRpcmVjdExpc3QgPSBzZWxmLl9yZWRpcmVjdExpc3QgfHwgW107XG4gICAgICAgIHNlbGYuX3JlZGlyZWN0TGlzdC5wdXNoKHNlbGYudXJsKTtcblxuICAgICAgICBsZXQgdGFyZ2V0VXJsID0gbG9jO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGlmICh0eXBlb2YgVVJMICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgICAgdGFyZ2V0VXJsID0gbmV3IFVSTChsb2MsIHNlbGYudXJsKS5ocmVmO1xuICAgICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHJvb3QgIT09ICd1bmRlZmluZWQnICYmIHJvb3QuZG9jdW1lbnQgJiYgcm9vdC5kb2N1bWVudC5jcmVhdGVFbGVtZW50KSB7XG4gICAgICAgICAgICBjb25zdCBhID0gcm9vdC5kb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gICAgICAgICAgICBhLmhyZWYgPSBsb2M7XG4gICAgICAgICAgICB0YXJnZXRVcmwgPSBhLmhyZWY7XG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChfKSB7XG4gICAgICAgICAgdGFyZ2V0VXJsID0gbG9jO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaXNTYW1lT3JpZ2luID0gaXNTYW1lT3JpZ2luVXJsKHRhcmdldFVybCwgc2VsZi51cmwpO1xuICAgICAgICBpZiAoIWlzU2FtZU9yaWdpbikge1xuICAgICAgICAgIGRlbGV0ZSBzZWxmLnVzZXJuYW1lO1xuICAgICAgICAgIGRlbGV0ZSBzZWxmLnBhc3N3b3JkO1xuICAgICAgICAgIGlmIChzZWxmLmhlYWRlcikge1xuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoc2VsZi5oZWFkZXIpKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGxrID0ga2V5LnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgICAgIGlmIChsayA9PT0gJ2F1dGhvcml6YXRpb24nIHx8IGxrID09PSAnY29va2llJykge1xuICAgICAgICAgICAgICAgIGRlbGV0ZSBzZWxmLmhlYWRlcltrZXldO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChzZWxmLl9oZWFkZXIpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHNlbGYuX2hlYWRlcikpIHtcbiAgICAgICAgICAgICAgY29uc3QgbGsgPSBrZXkudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICAgICAgaWYgKGxrID09PSAnYXV0aG9yaXphdGlvbicgfHwgbGsgPT09ICdjb29raWUnKSB7XG4gICAgICAgICAgICAgICAgZGVsZXRlIHNlbGYuX2hlYWRlcltrZXldO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgc2VsZi51cmwgPSB0YXJnZXRVcmw7XG4gICAgICAgIGlmIChzZWxmLl9yZXNwb25zZVRpbWVvdXRUaW1lcikgY2xlYXJUaW1lb3V0KHNlbGYuX3Jlc3BvbnNlVGltZW91dFRpbWVyKTtcbiAgICAgICAgaWYgKHNlbGYuX3VwbG9hZFRpbWVvdXRUaW1lcikgY2xlYXJUaW1lb3V0KHNlbGYuX3VwbG9hZFRpbWVvdXRUaW1lcik7XG5cbiAgICAgICAgc2VsZi5fcmVzcG9uc2VCeXRlc1JlY2VpdmVkID0gdW5kZWZpbmVkO1xuICAgICAgICByZXR1cm4gc2VsZi5fZW5kKCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFzdGF0dXMpIHtcbiAgICAgIGlmIChzZWxmLnRpbWVkb3V0IHx8IHNlbGYuX2Fib3J0ZWQgfHwgc2VsZi5oYXNTaXplRXJyb3IoKSkgcmV0dXJuO1xuICAgICAgcmV0dXJuIHNlbGYuY3Jvc3NEb21haW5FcnJvcigpO1xuICAgIH1cblxuICAgIGlmIChzZWxmLmhhc1NpemVFcnJvcigpKSByZXR1cm47XG4gICAgc2VsZi5lbWl0KCdlbmQnKTtcbiAgfSk7XG5cbiAgLy8gcHJvZ3Jlc3NcbiAgY29uc3QgaGFuZGxlUHJvZ3Jlc3MgPSAoZGlyZWN0aW9uLCBlKSA9PiB7XG4gICAgaWYgKGUudG90YWwgPiAwKSB7XG4gICAgICBlLnBlcmNlbnQgPSAoZS5sb2FkZWQgLyBlLnRvdGFsKSAqIDEwMDtcblxuICAgICAgaWYgKGUucGVyY2VudCA9PT0gMTAwKSB7XG4gICAgICAgIGNsZWFyVGltZW91dChzZWxmLl91cGxvYWRUaW1lb3V0VGltZXIpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGUuZGlyZWN0aW9uID0gZGlyZWN0aW9uO1xuICAgIHNlbGYuZW1pdCgncHJvZ3Jlc3MnLCBlKTtcblxuICAgIGlmIChkaXJlY3Rpb24gPT09ICd1cGxvYWQnICYmIHNlbGYuX21heFJlcXVlc3RTaXplICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGUubG9hZGVkID09PSAnbnVtYmVyJyAmJiBlLmxvYWRlZCA+IHNlbGYuX21heFJlcXVlc3RTaXplKSB7XG4gICAgICBzZWxmLl9hYm9ydFdpdGhTaXplRXJyb3IoJ3JlcXVlc3QnKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoZGlyZWN0aW9uID09PSAnZG93bmxvYWQnICYmIHR5cGVvZiBlLmxvYWRlZCA9PT0gJ251bWJlcicgJiYgc2VsZi5fbWF4UmVzcG9uc2VTaXplICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIC8vIFRyYWNrIHJhdyBieXRlcyByZWNlaXZlZDsgdGhpcyBpcyB0aGUgcHJpbWFyeSByZXNwb25zZSBzaXplIGNvdW50ZXIuXG4gICAgICBzZWxmLl9yZXNwb25zZUJ5dGVzUmVjZWl2ZWQgPSBlLmxvYWRlZDtcblxuICAgICAgbGV0IGlzQ29tcHJlc3NlZCA9IGZhbHNlO1xuICAgICAgbGV0IGlzRW5jb2RpbmdFc3RhYmxpc2hlZCA9IGZhbHNlO1xuICAgICAgbGV0IGNlID0gJyc7XG4gICAgICB0cnkge1xuICAgICAgICBjZSA9IHhoci5nZXRSZXNwb25zZUhlYWRlcignQ29udGVudC1FbmNvZGluZycpIHx8ICcnO1xuICAgICAgICBpZiAoY2UpIHtcbiAgICAgICAgICBpc0VuY29kaW5nRXN0YWJsaXNoZWQgPSB0cnVlO1xuICAgICAgICAgIGNvbnN0IGlzSWRlbnRpdHkgPSBjZS50cmltKCkudG9Mb3dlckNhc2UoKSA9PT0gJ2lkZW50aXR5JztcbiAgICAgICAgICBpc0NvbXByZXNzZWQgPSAhaXNJZGVudGl0eTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoXykge1xuICAgICAgICAvLyBJZ25vcmUgZXJyb3IgcmVhZGluZyBDb250ZW50LUVuY29kaW5nIGhlYWRlclxuICAgICAgfVxuXG4gICAgICBjb25zdCBpc1NhbWVPcmlnaW4gPSBpc1NhbWVPcmlnaW5SZXF1ZXN0KHhociwgc2VsZi51cmwpO1xuICAgICAgY29uc3QgaXNLbm93bklkZW50aXR5ID0gKGlzRW5jb2RpbmdFc3RhYmxpc2hlZCAmJiAhaXNDb21wcmVzc2VkKSB8fCAoaXNTYW1lT3JpZ2luICYmICFjZSk7XG5cbiAgICAgIGlmIChpc0tub3duSWRlbnRpdHkpIHtcbiAgICAgICAgLy8gRm9yIGNvbmZpcm1lZCB1bmNvbXByZXNzZWQgcmVzcG9uc2VzLCBlLmxvYWRlZCByZXByZXNlbnRzIHRoZSBhY3R1YWxcbiAgICAgICAgLy8gdHJhbnNmZXIvYm9keSBieXRlIGNvdW50LiBBYm9ydCBpZiB3aXJlIGJ5dGVzIGV4Y2VlZCBsaW1pdC5cbiAgICAgICAgaWYgKGUubG9hZGVkID4gc2VsZi5fbWF4UmVzcG9uc2VTaXplKSB7XG4gICAgICAgICAgc2VsZi5fYWJvcnRXaXRoU2l6ZUVycm9yKCdyZXNwb25zZScpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgLy8gRm9yIGNvbXByZXNzZWQgcmVzcG9uc2VzIG9yIGFtYmlndW91cyB1bmV4cG9zZWQtY29tcHJlc3Npb24gY2FzZXMgKENPUlMpOlxuICAgICAgLy8gV2lyZSB0cmFuc2ZlciBzaXplIGNhbm5vdCBiZSBhc3N1bWVkIHRvIHJlZmxlY3QgZGVjb2RlZCBwYXlsb2FkIHNpemUuXG4gICAgICAvLyBJZiBhIGRlY29kZWQgcmVwcmVzZW50YXRpb24gaXMgYXZhaWxhYmxlLCBldmFsdWF0ZSBpdHMgZGVjb2RlZCBzaXplLlxuICAgICAgbGV0IGN0SGVhZGVyID0gJyc7XG4gICAgICB0cnkge1xuICAgICAgICBjdEhlYWRlciA9IHhoci5nZXRSZXNwb25zZUhlYWRlcignQ29udGVudC1UeXBlJykgfHwgJyc7XG4gICAgICB9IGNhdGNoIChfKSB7XG4gICAgICAgIC8vIElnbm9yZSBlcnJvciByZWFkaW5nIENvbnRlbnQtVHlwZSBoZWFkZXJcbiAgICAgIH1cblxuICAgICAgbGV0IGN1cnJlbnREZWNvZGVkO1xuICAgICAgdHJ5IHtcbiAgICAgICAgbGV0IGN1cnJlbnRSYXcgPSAoeGhyLnJlc3BvbnNlICE9PSB1bmRlZmluZWQgJiYgeGhyLnJlc3BvbnNlICE9PSBudWxsKSA/IHhoci5yZXNwb25zZSA6IG51bGw7XG4gICAgICAgIGlmIChjdXJyZW50UmF3ID09PSBudWxsKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGN1cnJlbnRSYXcgPSB4aHIucmVzcG9uc2VUZXh0O1xuICAgICAgICAgIH0gY2F0Y2ggKF8pIHtcbiAgICAgICAgICAgIGN1cnJlbnRSYXcgPSBudWxsO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAoY3VycmVudFJhdyAhPT0gdW5kZWZpbmVkICYmIGN1cnJlbnRSYXcgIT09IG51bGwpIHtcbiAgICAgICAgICBpZiAodHlwZW9mIGN1cnJlbnRSYXcgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICBjdXJyZW50RGVjb2RlZCA9IGdldFRleHREZWNvZGVkQnl0ZUxlbmd0aChjdXJyZW50UmF3LCBjdEhlYWRlciwgeGhyKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY3VycmVudERlY29kZWQgPSBnZXRSZXNwb25zZUludHJpbnNpY0J5dGVMZW5ndGgoY3VycmVudFJhdyk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChfKSB7XG4gICAgICAgIC8vIElnbm9yZSBlcnJvciBhY2Nlc3NpbmcgY3VycmVudCByZXNwb25zZVxuICAgICAgfVxuXG4gICAgICAvLyBJZiBhIHJlYWRhYmxlIGRlY29kZWQgcmVwcmVzZW50YXRpb24gaXMgYXZhaWxhYmxlOlxuICAgICAgLy8gQWJvcnQgaW1tZWRpYXRlbHkgaWYgZGVjb2RlZCBzaXplIGV4Y2VlZHMgbGltaXQ7IGRvIG5vdCBhYm9ydCBpZiB3aXRoaW4gbGltaXQuXG4gICAgICBpZiAodHlwZW9mIGN1cnJlbnREZWNvZGVkID09PSAnbnVtYmVyJykge1xuICAgICAgICBpZiAoY3VycmVudERlY29kZWQgPiBzZWxmLl9tYXhSZXNwb25zZVNpemUpIHtcbiAgICAgICAgICBzZWxmLl9hYm9ydFdpdGhTaXplRXJyb3IoJ3Jlc3BvbnNlJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICAvLyBJZiBhdCByZWFkeVN0YXRlIDQsIGRlZmVyIHRvIHRlcm1pbmFsIHJlYWR5U3RhdGUgNCBoYW5kbGVyXG4gICAgICBpZiAoeGhyLnJlYWR5U3RhdGUgPT09IDQpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICAvLyBJZiBkZWNvZGVkIHJlcHJlc2VudGF0aW9uIGlzIG5vdCB5ZXQgcmVhZGFibGUgKGUuZy4gYmluYXJ5IHJlc3BvbnNlVHlwZVxuICAgICAgLy8gd2hlcmUgWEhSIHJlc3BvbnNlIGlzIG51bGwgdW50aWwgcmVhZHlTdGF0ZSA0KSwgZGVmZXIgZXZhbHVhdGlvbiB0byByZWFkeVN0YXRlIDQuXG4gICAgfVxuICB9O1xuXG4gIHRyeSB7XG4gICAgaWYgKHRoaXMuaGFzTGlzdGVuZXJzKCdwcm9ncmVzcycpIHx8IHRoaXMuX21heFJlc3BvbnNlU2l6ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB4aHIuYWRkRXZlbnRMaXN0ZW5lcigncHJvZ3Jlc3MnLCBoYW5kbGVQcm9ncmVzcy5iaW5kKG51bGwsICdkb3dubG9hZCcpKTtcbiAgICB9XG4gICAgaWYgKHhoci51cGxvYWQgJiYgKHRoaXMuaGFzTGlzdGVuZXJzKCdwcm9ncmVzcycpIHx8IHRoaXMuX21heFJlcXVlc3RTaXplICE9PSB1bmRlZmluZWQpKSB7XG4gICAgICB4aHIudXBsb2FkLmFkZEV2ZW50TGlzdGVuZXIoXG4gICAgICAgICdwcm9ncmVzcycsXG4gICAgICAgIGhhbmRsZVByb2dyZXNzLmJpbmQobnVsbCwgJ3VwbG9hZCcpXG4gICAgICApO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgLy8gQWNjZXNzaW5nIHhoci51cGxvYWQgZmFpbHMgaW4gSUUgZnJvbSBhIHdlYiB3b3JrZXIsIHNvIGp1c3QgcHJldGVuZCBpdCBkb2Vzbid0IGV4aXN0LlxuICAgIC8vIFJlcG9ydGVkIGhlcmU6XG4gICAgLy8gaHR0cHM6Ly9jb25uZWN0Lm1pY3Jvc29mdC5jb20vSUUvZmVlZGJhY2svZGV0YWlscy84MzcyNDUveG1saHR0cHJlcXVlc3QtdXBsb2FkLXRocm93cy1pbnZhbGlkLWFyZ3VtZW50LXdoZW4tdXNlZC1mcm9tLXdlYi13b3JrZXItY29udGV4dFxuICB9XG5cbiAgaWYgKHhoci51cGxvYWQpIHtcbiAgICB0aGlzLl9zZXRVcGxvYWRUaW1lb3V0KCk7XG4gIH1cblxuICAvLyBpbml0aWF0ZSByZXF1ZXN0XG4gIHRyeSB7XG4gICAgaWYgKHRoaXMudXNlcm5hbWUgJiYgdGhpcy5wYXNzd29yZCkge1xuICAgICAgeGhyLm9wZW4odGhpcy5tZXRob2QsIHRoaXMudXJsLCB0cnVlLCB0aGlzLnVzZXJuYW1lLCB0aGlzLnBhc3N3b3JkKTtcbiAgICB9IGVsc2Uge1xuICAgICAgeGhyLm9wZW4odGhpcy5tZXRob2QsIHRoaXMudXJsLCB0cnVlKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIC8vIHNlZSAjMTE0OVxuICAgIHJldHVybiB0aGlzLmNhbGxiYWNrKGVycik7XG4gIH1cblxuICAvLyBDT1JTXG4gIGlmICh0aGlzLl93aXRoQ3JlZGVudGlhbHMpIHhoci53aXRoQ3JlZGVudGlhbHMgPSB0cnVlO1xuXG4gIC8vIGJvZHlcbiAgLy8gV2hlbiBlaXRoZXIgc2l6ZSBsaW1pdCBpcyBjb25maWd1cmVkIGFuZCB0aGUgYm9keSBpcyBhIEZvcm1EYXRhLCBzZXJpYWxpemUgaXRcbiAgLy8gdG8gYW4gZXhhY3QgQmxvYiB3aXRoIGEgbWF0Y2hpbmcgYm91bmRhcnkgaGVhZGVyIHNvIHRoZSB0cmFuc21pdHRlZCBib2R5IG1hdGNoZXNcbiAgLy8gdGhlIG1lYXN1cmVkIHNpemUuIElmIG92ZXJzaXplZCwgYWJvcnQgaW1tZWRpYXRlbHkgYmVmb3JlIHNlbmRpbmcuXG4gIGNvbnN0IGNhblJlZGlyZWN0ID0gdGhpcy5fbWF4UmVkaXJlY3RzID09PSB1bmRlZmluZWQgfHwgdGhpcy5fbWF4UmVkaXJlY3RzID4gMDtcbiAgY29uc3QgY2FuUmV0cnkgPSBCb29sZWFuKHRoaXMuX21heFJldHJpZXMgJiYgdGhpcy5fbWF4UmV0cmllcyA+IDApO1xuICBjb25zdCBuZWVkc0Zvcm1EYXRhU2VyaWFsaXphdGlvbiA9ICh0aGlzLl9tYXhSZXF1ZXN0U2l6ZSAhPT0gdW5kZWZpbmVkKSB8fCAodGhpcy5fbWF4UmVzcG9uc2VTaXplICE9PSB1bmRlZmluZWQpIHx8IGNhblJldHJ5IHx8IGNhblJlZGlyZWN0IHx8IEJvb2xlYW4odGhpcy5fZm9ybURhdGFCbG9iKTtcbiAgaWYgKG5lZWRzRm9ybURhdGFTZXJpYWxpemF0aW9uICYmIHRoaXMubWV0aG9kICE9PSAnR0VUJyAmJiB0aGlzLm1ldGhvZCAhPT0gJ0hFQUQnKSB7XG4gICAgaWYgKHRoaXMuX2Zvcm1EYXRhQmxvYikge1xuICAgICAgZGF0YSA9IHRoaXMuX2Zvcm1EYXRhQmxvYjtcbiAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gdGhpcy5fZm9ybURhdGFCbG9iLmNvbnRlbnRUeXBlIHx8IHRoaXMuX2Zvcm1EYXRhQmxvYi50eXBlO1xuICAgICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXModGhpcy5oZWFkZXIpKSB7XG4gICAgICAgIGlmIChrZXkudG9Mb3dlckNhc2UoKSA9PT0gJ2NvbnRlbnQtdHlwZScpIHtcbiAgICAgICAgICBkZWxldGUgdGhpcy5oZWFkZXJba2V5XTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5oZWFkZXJbJ2NvbnRlbnQtdHlwZSddID0gY29udGVudFR5cGU7XG4gICAgICB0aGlzLl9oZWFkZXJbJ2NvbnRlbnQtdHlwZSddID0gY29udGVudFR5cGU7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHJhd1BheWxvYWQgPSBkYXRhICE9PSB1bmRlZmluZWQgPyBkYXRhIDogdGhpcy5fZm9ybURhdGE7XG4gICAgICBpZiAoXG4gICAgICAgICh0eXBlb2YgRm9ybURhdGEgIT09ICd1bmRlZmluZWQnICYmIHJhd1BheWxvYWQgaW5zdGFuY2VvZiBGb3JtRGF0YSkgfHxcbiAgICAgICAgKHJhd1BheWxvYWQgJiYgdHlwZW9mIHJhd1BheWxvYWQgPT09ICdvYmplY3QnICYmIChcbiAgICAgICAgICBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwocmF3UGF5bG9hZCkgPT09ICdbb2JqZWN0IEZvcm1EYXRhXScgfHxcbiAgICAgICAgICAodHlwZW9mIFN5bWJvbCAhPT0gJ3VuZGVmaW5lZCcgJiYgU3ltYm9sLnRvU3RyaW5nVGFnICYmIHJhd1BheWxvYWRbU3ltYm9sLnRvU3RyaW5nVGFnXSA9PT0gJ0Zvcm1EYXRhJykgfHxcbiAgICAgICAgICAocmF3UGF5bG9hZC5jb25zdHJ1Y3RvciAmJiAocmF3UGF5bG9hZC5jb25zdHJ1Y3Rvci5uYW1lID09PSAnRm9ybURhdGEnIHx8IHJhd1BheWxvYWQuY29uc3RydWN0b3IubmFtZSA9PT0gJ01vY2tGb3JtRGF0YScpKVxuICAgICAgICApKVxuICAgICAgKSB7XG4gICAgICAgIGxldCBmb3JtRGF0YUJsb2I7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgZm9ybURhdGFCbG9iID0gYnVpbGRGb3JtRGF0YUJsb2IocmF3UGF5bG9hZCwgdGhpcyk7XG4gICAgICAgIH0gY2F0Y2ggKF8pIHtcbiAgICAgICAgICAvLyBpZ25vcmVcbiAgICAgICAgfVxuICAgICAgICBpZiAoZm9ybURhdGFCbG9iKSB7XG4gICAgICAgICAgaWYgKHRoaXMuX21heFJlcXVlc3RTaXplICE9PSB1bmRlZmluZWQgJiYgZm9ybURhdGFCbG9iLnNpemUgPiB0aGlzLl9tYXhSZXF1ZXN0U2l6ZSkge1xuICAgICAgICAgICAgdGhpcy5fYWJvcnRXaXRoU2l6ZUVycm9yKCdyZXF1ZXN0Jyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuX2Zvcm1EYXRhQmxvYiA9IGZvcm1EYXRhQmxvYjtcbiAgICAgICAgICBkYXRhID0gZm9ybURhdGFCbG9iO1xuICAgICAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gZm9ybURhdGFCbG9iLmNvbnRlbnRUeXBlIHx8IGZvcm1EYXRhQmxvYi50eXBlO1xuICAgICAgICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHRoaXMuaGVhZGVyKSkge1xuICAgICAgICAgICAgaWYgKGtleS50b0xvd2VyQ2FzZSgpID09PSAnY29udGVudC10eXBlJykge1xuICAgICAgICAgICAgICBkZWxldGUgdGhpcy5oZWFkZXJba2V5XTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5oZWFkZXJbJ2NvbnRlbnQtdHlwZSddID0gY29udGVudFR5cGU7XG4gICAgICAgICAgdGhpcy5faGVhZGVyWydjb250ZW50LXR5cGUnXSA9IGNvbnRlbnRUeXBlO1xuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuX21heFJlcXVlc3RTaXplICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBjb25zdCBjb21wdXRlZFNpemUgPSBjb21wdXRlRm9ybURhdGFTaXplKHJhd1BheWxvYWQsIHRoaXMpO1xuICAgICAgICAgIGlmIChjb21wdXRlZFNpemUgIT09IHVuZGVmaW5lZCAmJiBjb21wdXRlZFNpemUgPiB0aGlzLl9tYXhSZXF1ZXN0U2l6ZSkge1xuICAgICAgICAgICAgdGhpcy5fYWJvcnRXaXRoU2l6ZUVycm9yKCdyZXF1ZXN0Jyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaWYgKFxuICAgICF0aGlzLl9mb3JtRGF0YSAmJlxuICAgICF0aGlzLl9mb3JtRGF0YUJsb2IgJiZcbiAgICB0aGlzLm1ldGhvZCAhPT0gJ0dFVCcgJiZcbiAgICB0aGlzLm1ldGhvZCAhPT0gJ0hFQUQnICYmXG4gICAgdHlwZW9mIGRhdGEgIT09ICdzdHJpbmcnICYmXG4gICAgIXRoaXMuX2lzSG9zdChkYXRhKVxuICApIHtcbiAgICAvLyBzZXJpYWxpemUgc3R1ZmZcbiAgICBjb25zdCBjb250ZW50VHlwZSA9IHRoaXMuX2hlYWRlclsnY29udGVudC10eXBlJ107XG4gICAgbGV0IHNlcmlhbGl6ZSA9XG4gICAgICB0aGlzLl9zZXJpYWxpemVyIHx8XG4gICAgICByZXF1ZXN0LnNlcmlhbGl6ZVtjb250ZW50VHlwZSA/IGNvbnRlbnRUeXBlLnNwbGl0KCc7JylbMF0gOiAnJ107XG4gICAgaWYgKCFzZXJpYWxpemUgJiYgaXNKU09OKGNvbnRlbnRUeXBlKSkge1xuICAgICAgc2VyaWFsaXplID0gcmVxdWVzdC5zZXJpYWxpemVbJ2FwcGxpY2F0aW9uL2pzb24nXTtcbiAgICB9XG5cbiAgICBpZiAoc2VyaWFsaXplKSBkYXRhID0gc2VyaWFsaXplKGRhdGEpO1xuICB9XG5cbiAgLy8gc2V0IGhlYWRlciBmaWVsZHNcbiAgZm9yIChjb25zdCBmaWVsZCBpbiB0aGlzLmhlYWRlcikge1xuICAgIGlmICh0aGlzLmhlYWRlcltmaWVsZF0gPT09IG51bGwpIGNvbnRpbnVlO1xuXG4gICAgaWYgKGhhc093bih0aGlzLmhlYWRlciwgZmllbGQpKVxuICAgICAgeGhyLnNldFJlcXVlc3RIZWFkZXIoZmllbGQsIHRoaXMuaGVhZGVyW2ZpZWxkXSk7XG4gIH1cblxuICBpZiAodGhpcy5fcmVzcG9uc2VUeXBlKSB7XG4gICAgdHJ5IHtcbiAgICAgIHhoci5yZXNwb25zZVR5cGUgPSB0aGlzLl9yZXNwb25zZVR5cGU7XG4gICAgfSBjYXRjaCAoXykge1xuICAgICAgLy8gSWdub3JlXG4gICAgfVxuICB9XG5cbiAgLy8gUmVjb3JkIHByZS1ldmVudCBzdGF0ZSB0byBkZXRlY3QgaWYgYSAncmVxdWVzdCcgbGlzdGVuZXIgb3ZlcnJpZGVzIHJlc3BvbnNlVHlwZVxuICBjb25zdCBwcmVFdmVudFhoclR5cGUgPSB0eXBlb2YgeGhyLnJlc3BvbnNlVHlwZSA9PT0gJ3N0cmluZycgPyB4aHIucmVzcG9uc2VUeXBlLnRvTG93ZXJDYXNlKCkgOiAnJztcbiAgY29uc3QgcHJlRXZlbnRSZXFUeXBlID0gKHRoaXMuX3Jlc3BvbnNlVHlwZSB8fCAnJykudG9Mb3dlckNhc2UoKTtcblxuICAvLyBzZW5kIHN0dWZmXG4gIHRoaXMuZW1pdCgncmVxdWVzdCcsIHRoaXMpO1xuXG4gIC8vIENoZWNrIGVmZmVjdGl2ZSByZXNwb25zZVR5cGUgQUZURVIgJ3JlcXVlc3QnIGV2ZW50OlxuICAvLyBUcmFjayBhbnkgZXhwbGljaXQgcmVzcG9uc2VUeXBlIG92ZXJyaWRlIHNldCB2aWEgcmVxdWVzdC5yZXNwb25zZVR5cGUoKVxuICAvLyBvciBhc3NpZ25lZCBkaXJlY3RseSBvbiB4aHIucmVzcG9uc2VUeXBlIChlLmcuIGJ5IGEgJ3JlcXVlc3QnIGV2ZW50IGxpc3RlbmVyKSxcbiAgLy8gaW5jbHVkaW5nIGV4cGxpY2l0bHkgY2xlYXJpbmcgaXQgdG8gJycgKHRoZSBkZWZhdWx0L3RleHQgcmVzcG9uc2UgdHlwZSkuXG4gIGNvbnN0IHBvc3RFdmVudFhoclR5cGUgPSB0eXBlb2YgeGhyLnJlc3BvbnNlVHlwZSA9PT0gJ3N0cmluZycgPyB4aHIucmVzcG9uc2VUeXBlLnRvTG93ZXJDYXNlKCkgOiAnJztcbiAgY29uc3QgcG9zdEV2ZW50UmVxVHlwZSA9ICh0aGlzLl9yZXNwb25zZVR5cGUgfHwgJycpLnRvTG93ZXJDYXNlKCk7XG5cbiAgbGV0IHJlcXVlc3RlZFJlc3BvbnNlVHlwZSA9IHBvc3RFdmVudFJlcVR5cGU7XG4gIGlmIChwb3N0RXZlbnRYaHJUeXBlICE9PSBwcmVFdmVudFhoclR5cGUpIHtcbiAgICByZXF1ZXN0ZWRSZXNwb25zZVR5cGUgPSBwb3N0RXZlbnRYaHJUeXBlO1xuICB9IGVsc2UgaWYgKHBvc3RFdmVudFJlcVR5cGUgIT09IHByZUV2ZW50UmVxVHlwZSkge1xuICAgIHJlcXVlc3RlZFJlc3BvbnNlVHlwZSA9IHBvc3RFdmVudFJlcVR5cGU7XG4gIH1cblxuICB0aGlzLl9yZXNwb25zZVR5cGUgPSByZXF1ZXN0ZWRSZXNwb25zZVR5cGU7XG5cbiAgaWYgKHRoaXMuX21heFJlc3BvbnNlU2l6ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKHJlcXVlc3RlZFJlc3BvbnNlVHlwZSA9PT0gJ2Jsb2InKSB7XG4gICAgICB0cnkge1xuICAgICAgICB4aHIucmVzcG9uc2VUeXBlID0gJ2Jsb2InO1xuICAgICAgfSBjYXRjaCAoXykge1xuICAgICAgICAvLyBJZ25vcmVcbiAgICAgIH1cbiAgICAgIHRoaXMuX2ZvcmNlZEFycmF5QnVmZmVyRm9yU2l6ZSA9IGZhbHNlO1xuICAgIH0gZWxzZSBpZiAocmVxdWVzdGVkUmVzcG9uc2VUeXBlID09PSAnYXJyYXlidWZmZXInKSB7XG4gICAgICB0cnkge1xuICAgICAgICB4aHIucmVzcG9uc2VUeXBlID0gJ2FycmF5YnVmZmVyJztcbiAgICAgIH0gY2F0Y2ggKF8pIHtcbiAgICAgICAgLy8gSWdub3JlXG4gICAgICB9XG4gICAgICB0aGlzLl9mb3JjZWRBcnJheUJ1ZmZlckZvclNpemUgPSBmYWxzZTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRm9yIHRleHQsIGpzb24sIGRvY3VtZW50LCBvciBkZWZhdWx0ICgnJyksIGNvbmZpZ3VyZSB1bmRlcmx5aW5nIFhIUiBhcyAnYXJyYXlidWZmZXInXG4gICAgICAvLyB0byBjYXB0dXJlIGFuZCBtZWFzdXJlIHRoZSBleGFjdCBkZWNvbXByZXNzZWQgYmluYXJ5IGJ5dGUgcmVwcmVzZW50YXRpb24gYmVmb3JlIHBhcnNpbmcuXG4gICAgICB0cnkge1xuICAgICAgICB4aHIucmVzcG9uc2VUeXBlID0gJ2FycmF5YnVmZmVyJztcbiAgICAgICAgdGhpcy5fZm9yY2VkQXJyYXlCdWZmZXJGb3JTaXplID0gdHJ1ZTtcbiAgICAgIH0gY2F0Y2ggKF8pIHtcbiAgICAgICAgdGhpcy5fZm9yY2VkQXJyYXlCdWZmZXJGb3JTaXplID0gZmFsc2U7XG4gICAgICAgIGlmIChyZXF1ZXN0ZWRSZXNwb25zZVR5cGUpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgeGhyLnJlc3BvbnNlVHlwZSA9IHJlcXVlc3RlZFJlc3BvbnNlVHlwZTtcbiAgICAgICAgICB9IGNhdGNoIChfKSB7XG4gICAgICAgICAgICAvLyBJZ25vcmVcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH0gZWxzZSBpZiAocmVxdWVzdGVkUmVzcG9uc2VUeXBlKSB7XG4gICAgdHJ5IHtcbiAgICAgIHhoci5yZXNwb25zZVR5cGUgPSByZXF1ZXN0ZWRSZXNwb25zZVR5cGU7XG4gICAgfSBjYXRjaCAoXykge1xuICAgICAgLy8gSWdub3JlXG4gICAgfVxuICAgIHRoaXMuX2ZvcmNlZEFycmF5QnVmZmVyRm9yU2l6ZSA9IGZhbHNlO1xuICB9XG5cbiAgLy8gRW5mb3JjZSBtYXhSZXF1ZXN0U2l6ZSBvbiBicm93c2VyIHJlcXVlc3RzIGJlZm9yZSBzZW5kaW5nLlxuICAvLyBYTUxIdHRwUmVxdWVzdCBub3JtYWxpemVzIEdFVCBhbmQgSEVBRCBib2RpZXMgdG8gbnVsbCBhbmQgdHJhbnNtaXRzIG5vIGJvZHkuXG4gIGlmICh0aGlzLl9tYXhSZXF1ZXN0U2l6ZSAhPT0gdW5kZWZpbmVkICYmIHRoaXMubWV0aG9kICE9PSAnR0VUJyAmJiB0aGlzLm1ldGhvZCAhPT0gJ0hFQUQnKSB7XG4gICAgY29uc3QgcGF5bG9hZCA9IGRhdGEgIT09IHVuZGVmaW5lZCA/IGRhdGEgOiB0aGlzLl9mb3JtRGF0YTtcbiAgICBjb25zdCBieXRlTGVuZ3RoID0gZ2V0UmVxdWVzdEJvZHlTaXplKHBheWxvYWQsIHRoaXMpO1xuICAgIGlmIChieXRlTGVuZ3RoICE9PSB1bmRlZmluZWQgJiYgYnl0ZUxlbmd0aCA+IHRoaXMuX21heFJlcXVlc3RTaXplKSB7XG4gICAgICB0aGlzLl9hYm9ydFdpdGhTaXplRXJyb3IoJ3JlcXVlc3QnKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gIH1cblxuICAvLyBJRTExIHhoci5zZW5kKHVuZGVmaW5lZCkgc2VuZHMgJ3VuZGVmaW5lZCcgc3RyaW5nIGFzIFBPU1QgcGF5bG9hZCAoaW5zdGVhZCBvZiBub3RoaW5nKVxuICAvLyBXZSBuZWVkIG51bGwgaGVyZSBpZiBkYXRhIGlzIHVuZGVmaW5lZCwgYW5kIFhNTEh0dHBSZXF1ZXN0IGlnbm9yZXMgYm9kaWVzIG9uIEdFVC9IRUFEXG4gIGlmICh0aGlzLm1ldGhvZCA9PT0gJ0dFVCcgfHwgdGhpcy5tZXRob2QgPT09ICdIRUFEJykge1xuICAgIGRhdGEgPSBudWxsO1xuICB9XG4gIHhoci5zZW5kKHR5cGVvZiBkYXRhID09PSAndW5kZWZpbmVkJyA/IG51bGwgOiBkYXRhKTtcbn07XG5cbnJlcXVlc3QuYWdlbnQgPSAoKSA9PiBuZXcgQWdlbnQoKTtcblxuZm9yIChjb25zdCBtZXRob2Qgb2YgWydHRVQnLCAnUE9TVCcsICdPUFRJT05TJywgJ1BBVENIJywgJ1BVVCcsICdERUxFVEUnXSkge1xuICBBZ2VudC5wcm90b3R5cGVbbWV0aG9kLnRvTG93ZXJDYXNlKCldID0gZnVuY3Rpb24gKHVybCwgZm4pIHtcbiAgICBjb25zdCByZXF1ZXN0XyA9IG5ldyByZXF1ZXN0LlJlcXVlc3QobWV0aG9kLCB1cmwpO1xuICAgIHRoaXMuX3NldERlZmF1bHRzKHJlcXVlc3RfKTtcbiAgICBpZiAoZm4pIHtcbiAgICAgIHJlcXVlc3RfLmVuZChmbik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlcXVlc3RfO1xuICB9O1xufVxuXG5BZ2VudC5wcm90b3R5cGUuZGVsID0gQWdlbnQucHJvdG90eXBlLmRlbGV0ZTtcblxuLyoqXG4gKiBHRVQgYHVybGAgd2l0aCBvcHRpb25hbCBjYWxsYmFjayBgZm4ocmVzKWAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHVybFxuICogQHBhcmFtIHtNaXhlZHxGdW5jdGlvbn0gW2RhdGFdIG9yIGZuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbZm5dXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5yZXF1ZXN0LmdldCA9ICh1cmwsIGRhdGEsIGZuKSA9PiB7XG4gIGNvbnN0IHJlcXVlc3RfID0gcmVxdWVzdCgnR0VUJywgdXJsKTtcbiAgaWYgKHR5cGVvZiBkYXRhID09PSAnZnVuY3Rpb24nKSB7XG4gICAgZm4gPSBkYXRhO1xuICAgIGRhdGEgPSBudWxsO1xuICB9XG5cbiAgaWYgKGRhdGEpIHJlcXVlc3RfLnF1ZXJ5KGRhdGEpO1xuICBpZiAoZm4pIHJlcXVlc3RfLmVuZChmbik7XG4gIHJldHVybiByZXF1ZXN0Xztcbn07XG5cbi8qKlxuICogSEVBRCBgdXJsYCB3aXRoIG9wdGlvbmFsIGNhbGxiYWNrIGBmbihyZXMpYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXG4gKiBAcGFyYW0ge01peGVkfEZ1bmN0aW9ufSBbZGF0YV0gb3IgZm5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IFtmbl1cbiAqIEByZXR1cm4ge1JlcXVlc3R9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbnJlcXVlc3QuaGVhZCA9ICh1cmwsIGRhdGEsIGZuKSA9PiB7XG4gIGNvbnN0IHJlcXVlc3RfID0gcmVxdWVzdCgnSEVBRCcsIHVybCk7XG4gIGlmICh0eXBlb2YgZGF0YSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGZuID0gZGF0YTtcbiAgICBkYXRhID0gbnVsbDtcbiAgfVxuXG4gIGlmIChkYXRhKSByZXF1ZXN0Xy5xdWVyeShkYXRhKTtcbiAgaWYgKGZuKSByZXF1ZXN0Xy5lbmQoZm4pO1xuICByZXR1cm4gcmVxdWVzdF87XG59O1xuXG4vKipcbiAqIE9QVElPTlMgcXVlcnkgdG8gYHVybGAgd2l0aCBvcHRpb25hbCBjYWxsYmFjayBgZm4ocmVzKWAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHVybFxuICogQHBhcmFtIHtNaXhlZHxGdW5jdGlvbn0gW2RhdGFdIG9yIGZuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbZm5dXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5yZXF1ZXN0Lm9wdGlvbnMgPSAodXJsLCBkYXRhLCBmbikgPT4ge1xuICBjb25zdCByZXF1ZXN0XyA9IHJlcXVlc3QoJ09QVElPTlMnLCB1cmwpO1xuICBpZiAodHlwZW9mIGRhdGEgPT09ICdmdW5jdGlvbicpIHtcbiAgICBmbiA9IGRhdGE7XG4gICAgZGF0YSA9IG51bGw7XG4gIH1cblxuICBpZiAoZGF0YSkgcmVxdWVzdF8uc2VuZChkYXRhKTtcbiAgaWYgKGZuKSByZXF1ZXN0Xy5lbmQoZm4pO1xuICByZXR1cm4gcmVxdWVzdF87XG59O1xuXG4vKipcbiAqIERFTEVURSBgdXJsYCB3aXRoIG9wdGlvbmFsIGBkYXRhYCBhbmQgY2FsbGJhY2sgYGZuKHJlcylgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSB1cmxcbiAqIEBwYXJhbSB7TWl4ZWR9IFtkYXRhXVxuICogQHBhcmFtIHtGdW5jdGlvbn0gW2ZuXVxuICogQHJldHVybiB7UmVxdWVzdH1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gZGVsKHVybCwgZGF0YSwgZm4pIHtcbiAgY29uc3QgcmVxdWVzdF8gPSByZXF1ZXN0KCdERUxFVEUnLCB1cmwpO1xuICBpZiAodHlwZW9mIGRhdGEgPT09ICdmdW5jdGlvbicpIHtcbiAgICBmbiA9IGRhdGE7XG4gICAgZGF0YSA9IG51bGw7XG4gIH1cblxuICBpZiAoZGF0YSkgcmVxdWVzdF8uc2VuZChkYXRhKTtcbiAgaWYgKGZuKSByZXF1ZXN0Xy5lbmQoZm4pO1xuICByZXR1cm4gcmVxdWVzdF87XG59XG5cbnJlcXVlc3QuZGVsID0gZGVsO1xucmVxdWVzdC5kZWxldGUgPSBkZWw7XG5cbi8qKlxuICogUEFUQ0ggYHVybGAgd2l0aCBvcHRpb25hbCBgZGF0YWAgYW5kIGNhbGxiYWNrIGBmbihyZXMpYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXG4gKiBAcGFyYW0ge01peGVkfSBbZGF0YV1cbiAqIEBwYXJhbSB7RnVuY3Rpb259IFtmbl1cbiAqIEByZXR1cm4ge1JlcXVlc3R9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbnJlcXVlc3QucGF0Y2ggPSAodXJsLCBkYXRhLCBmbikgPT4ge1xuICBjb25zdCByZXF1ZXN0XyA9IHJlcXVlc3QoJ1BBVENIJywgdXJsKTtcbiAgaWYgKHR5cGVvZiBkYXRhID09PSAnZnVuY3Rpb24nKSB7XG4gICAgZm4gPSBkYXRhO1xuICAgIGRhdGEgPSBudWxsO1xuICB9XG5cbiAgaWYgKGRhdGEpIHJlcXVlc3RfLnNlbmQoZGF0YSk7XG4gIGlmIChmbikgcmVxdWVzdF8uZW5kKGZuKTtcbiAgcmV0dXJuIHJlcXVlc3RfO1xufTtcblxuLyoqXG4gKiBQT1NUIGB1cmxgIHdpdGggb3B0aW9uYWwgYGRhdGFgIGFuZCBjYWxsYmFjayBgZm4ocmVzKWAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHVybFxuICogQHBhcmFtIHtNaXhlZH0gW2RhdGFdXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbZm5dXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5yZXF1ZXN0LnBvc3QgPSAodXJsLCBkYXRhLCBmbikgPT4ge1xuICBjb25zdCByZXF1ZXN0XyA9IHJlcXVlc3QoJ1BPU1QnLCB1cmwpO1xuICBpZiAodHlwZW9mIGRhdGEgPT09ICdmdW5jdGlvbicpIHtcbiAgICBmbiA9IGRhdGE7XG4gICAgZGF0YSA9IG51bGw7XG4gIH1cblxuICBpZiAoZGF0YSkgcmVxdWVzdF8uc2VuZChkYXRhKTtcbiAgaWYgKGZuKSByZXF1ZXN0Xy5lbmQoZm4pO1xuICByZXR1cm4gcmVxdWVzdF87XG59O1xuXG4vKipcbiAqIFBVVCBgdXJsYCB3aXRoIG9wdGlvbmFsIGBkYXRhYCBhbmQgY2FsbGJhY2sgYGZuKHJlcylgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSB1cmxcbiAqIEBwYXJhbSB7TWl4ZWR8RnVuY3Rpb259IFtkYXRhXSBvciBmblxuICogQHBhcmFtIHtGdW5jdGlvbn0gW2ZuXVxuICogQHJldHVybiB7UmVxdWVzdH1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxucmVxdWVzdC5wdXQgPSAodXJsLCBkYXRhLCBmbikgPT4ge1xuICBjb25zdCByZXF1ZXN0XyA9IHJlcXVlc3QoJ1BVVCcsIHVybCk7XG4gIGlmICh0eXBlb2YgZGF0YSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGZuID0gZGF0YTtcbiAgICBkYXRhID0gbnVsbDtcbiAgfVxuXG4gIGlmIChkYXRhKSByZXF1ZXN0Xy5zZW5kKGRhdGEpO1xuICBpZiAoZm4pIHJlcXVlc3RfLmVuZChmbik7XG4gIHJldHVybiByZXF1ZXN0Xztcbn07XG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtB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LEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUNwRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQ3BFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFDcEUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUNwRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQ3BFLEtBQUssRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFDNUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUM5RSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUM5RCxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQzlFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFDOUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUM5RSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQzlFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFDOUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUM5RSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQzlFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFDOUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUM5RSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQzlFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFDOUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUM5RSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQzlFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFDOUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUM5RSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQzlFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFDOUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUM5RSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQzlFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFDOUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUM5RSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQzlFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFDOUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUM5RSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQzlFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFDOUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUM5RSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQzlFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFB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
(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.superagent = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
(function (global){(function (){
'use strict';

var possibleNames = require('possible-typed-array-names');
var g = typeof globalThis === 'undefined' ? global : globalThis;
module.exports = function availableTypedArrays() {
  var out = [];
  for (var i = 0; i < possibleNames.length; i++) {
    if (typeof g[possibleNames[i]] === 'function') {
      out[out.length] = possibleNames[i];
    }
  }
  return out;
};

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"possible-typed-array-names":56}],2:[function(require,module,exports){
'use strict';

exports.byteLength = byteLength;
exports.toByteArray = toByteArray;
exports.fromByteArray = fromByteArray;
var lookup = [];
var revLookup = [];
var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array;
var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
for (var i = 0, len = code.length; i < len; ++i) {
  lookup[i] = code[i];
  revLookup[code.charCodeAt(i)] = i;
}
revLookup['-'.charCodeAt(0)] = 62;
revLookup['_'.charCodeAt(0)] = 63;
function getLens(b64) {
  var len = b64.length;
  if (len % 4 > 0) {
    throw new Error('Invalid string. Length must be a multiple of 4');
  }
  var validLen = b64.indexOf('=');
  if (validLen === -1) validLen = len;
  var placeHoldersLen = validLen === len ? 0 : 4 - validLen % 4;
  return [validLen, placeHoldersLen];
}
function byteLength(b64) {
  var lens = getLens(b64);
  var validLen = lens[0];
  var placeHoldersLen = lens[1];
  return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
}
function _byteLength(b64, validLen, placeHoldersLen) {
  return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
}
function toByteArray(b64) {
  var tmp;
  var lens = getLens(b64);
  var validLen = lens[0];
  var placeHoldersLen = lens[1];
  var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen));
  var curByte = 0;
  var len = placeHoldersLen > 0 ? validLen - 4 : validLen;
  var i;
  for (i = 0; i < len; i += 4) {
    tmp = revLookup[b64.charCodeAt(i)] << 18 | revLookup[b64.charCodeAt(i + 1)] << 12 | revLookup[b64.charCodeAt(i + 2)] << 6 | revLookup[b64.charCodeAt(i + 3)];
    arr[curByte++] = tmp >> 16 & 0xFF;
    arr[curByte++] = tmp >> 8 & 0xFF;
    arr[curByte++] = tmp & 0xFF;
  }
  if (placeHoldersLen === 2) {
    tmp = revLookup[b64.charCodeAt(i)] << 2 | revLookup[b64.charCodeAt(i + 1)] >> 4;
    arr[curByte++] = tmp & 0xFF;
  }
  if (placeHoldersLen === 1) {
    tmp = revLookup[b64.charCodeAt(i)] << 10 | revLookup[b64.charCodeAt(i + 1)] << 4 | revLookup[b64.charCodeAt(i + 2)] >> 2;
    arr[curByte++] = tmp >> 8 & 0xFF;
    arr[curByte++] = tmp & 0xFF;
  }
  return arr;
}
function tripletToBase64(num) {
  return lookup[num >> 18 & 0x3F] + lookup[num >> 12 & 0x3F] + lookup[num >> 6 & 0x3F] + lookup[num & 0x3F];
}
function encodeChunk(uint8, start, end) {
  var tmp;
  var output = [];
  for (var i = start; i < end; i += 3) {
    tmp = (uint8[i] << 16 & 0xFF0000) + (uint8[i + 1] << 8 & 0xFF00) + (uint8[i + 2] & 0xFF);
    output.push(tripletToBase64(tmp));
  }
  return output.join('');
}
function fromByteArray(uint8) {
  var tmp;
  var len = uint8.length;
  var extraBytes = len % 3;
  var parts = [];
  var maxChunkLength = 16383;
  for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
    parts.push(encodeChunk(uint8, i, i + maxChunkLength > len2 ? len2 : i + maxChunkLength));
  }
  if (extraBytes === 1) {
    tmp = uint8[len - 1];
    parts.push(lookup[tmp >> 2] + lookup[tmp << 4 & 0x3F] + '==');
  } else if (extraBytes === 2) {
    tmp = (uint8[len - 2] << 8) + uint8[len - 1];
    parts.push(lookup[tmp >> 10] + lookup[tmp >> 4 & 0x3F] + lookup[tmp << 2 & 0x3F] + '=');
  }
  return parts.join('');
}

},{}],3:[function(require,module,exports){

},{}],4:[function(require,module,exports){
(function (Buffer){(function (){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <https://feross.org>
 * @license  MIT
 */'use strict';

var base64 = require('base64-js');
var ieee754 = require('ieee754');
exports.Buffer = Buffer;
exports.SlowBuffer = SlowBuffer;
exports.INSPECT_MAX_BYTES = 50;
var K_MAX_LENGTH = 0x7fffffff;
exports.kMaxLength = K_MAX_LENGTH;
Buffer.TYPED_ARRAY_SUPPORT = typedArraySupport();
if (!Buffer.TYPED_ARRAY_SUPPORT && typeof console !== 'undefined' && typeof console.error === 'function') {
  console.error('This browser lacks typed array (Uint8Array) support which is required by ' + '`buffer` v5.x. Use `buffer` v4.x if you require old browser support.');
}
function typedArraySupport() {
  try {
    var arr = new Uint8Array(1);
    arr.__proto__ = {
      __proto__: Uint8Array.prototype,
      foo: function () {
        return 42;
      }
    };
    return arr.foo() === 42;
  } catch (e) {
    return false;
  }
}
Object.defineProperty(Buffer.prototype, 'parent', {
  enumerable: true,
  get: function () {
    if (!Buffer.isBuffer(this)) return undefined;
    return this.buffer;
  }
});
Object.defineProperty(Buffer.prototype, 'offset', {
  enumerable: true,
  get: function () {
    if (!Buffer.isBuffer(this)) return undefined;
    return this.byteOffset;
  }
});
function createBuffer(length) {
  if (length > K_MAX_LENGTH) {
    throw new RangeError('The value "' + length + '" is invalid for option "size"');
  }
  var buf = new Uint8Array(length);
  buf.__proto__ = Buffer.prototype;
  return buf;
}
function Buffer(arg, encodingOrOffset, length) {
  if (typeof arg === 'number') {
    if (typeof encodingOrOffset === 'string') {
      throw new TypeError('The "string" argument must be of type string. Received type number');
    }
    return allocUnsafe(arg);
  }
  return from(arg, encodingOrOffset, length);
}
if (typeof Symbol !== 'undefined' && Symbol.species != null && Buffer[Symbol.species] === Buffer) {
  Object.defineProperty(Buffer, Symbol.species, {
    value: null,
    configurable: true,
    enumerable: false,
    writable: false
  });
}
Buffer.poolSize = 8192;
function from(value, encodingOrOffset, length) {
  if (typeof value === 'string') {
    return fromString(value, encodingOrOffset);
  }
  if (ArrayBuffer.isView(value)) {
    return fromArrayLike(value);
  }
  if (value == null) {
    throw TypeError('The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' + 'or Array-like Object. Received type ' + typeof value);
  }
  if (isInstance(value, ArrayBuffer) || value && isInstance(value.buffer, ArrayBuffer)) {
    return fromArrayBuffer(value, encodingOrOffset, length);
  }
  if (typeof value === 'number') {
    throw new TypeError('The "value" argument must not be of type number. Received type number');
  }
  var valueOf = value.valueOf && value.valueOf();
  if (valueOf != null && valueOf !== value) {
    return Buffer.from(valueOf, encodingOrOffset, length);
  }
  var b = fromObject(value);
  if (b) return b;
  if (typeof Symbol !== 'undefined' && Symbol.toPrimitive != null && typeof value[Symbol.toPrimitive] === 'function') {
    return Buffer.from(value[Symbol.toPrimitive]('string'), encodingOrOffset, length);
  }
  throw new TypeError('The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' + 'or Array-like Object. Received type ' + typeof value);
}
Buffer.from = function (value, encodingOrOffset, length) {
  return from(value, encodingOrOffset, length);
};
Buffer.prototype.__proto__ = Uint8Array.prototype;
Buffer.__proto__ = Uint8Array;
function assertSize(size) {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be of type number');
  } else if (size < 0) {
    throw new RangeError('The value "' + size + '" is invalid for option "size"');
  }
}
function alloc(size, fill, encoding) {
  assertSize(size);
  if (size <= 0) {
    return createBuffer(size);
  }
  if (fill !== undefined) {
    return typeof encoding === 'string' ? createBuffer(size).fill(fill, encoding) : createBuffer(size).fill(fill);
  }
  return createBuffer(size);
}
Buffer.alloc = function (size, fill, encoding) {
  return alloc(size, fill, encoding);
};
function allocUnsafe(size) {
  assertSize(size);
  return createBuffer(size < 0 ? 0 : checked(size) | 0);
}
Buffer.allocUnsafe = function (size) {
  return allocUnsafe(size);
};
Buffer.allocUnsafeSlow = function (size) {
  return allocUnsafe(size);
};
function fromString(string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') {
    encoding = 'utf8';
  }
  if (!Buffer.isEncoding(encoding)) {
    throw new TypeError('Unknown encoding: ' + encoding);
  }
  var length = byteLength(string, encoding) | 0;
  var buf = createBuffer(length);
  var actual = buf.write(string, encoding);
  if (actual !== length) {
    buf = buf.slice(0, actual);
  }
  return buf;
}
function fromArrayLike(array) {
  var length = array.length < 0 ? 0 : checked(array.length) | 0;
  var buf = createBuffer(length);
  for (var i = 0; i < length; i += 1) {
    buf[i] = array[i] & 255;
  }
  return buf;
}
function fromArrayBuffer(array, byteOffset, length) {
  if (byteOffset < 0 || array.byteLength < byteOffset) {
    throw new RangeError('"offset" is outside of buffer bounds');
  }
  if (array.byteLength < byteOffset + (length || 0)) {
    throw new RangeError('"length" is outside of buffer bounds');
  }
  var buf;
  if (byteOffset === undefined && length === undefined) {
    buf = new Uint8Array(array);
  } else if (length === undefined) {
    buf = new Uint8Array(array, byteOffset);
  } else {
    buf = new Uint8Array(array, byteOffset, length);
  }
  buf.__proto__ = Buffer.prototype;
  return buf;
}
function fromObject(obj) {
  if (Buffer.isBuffer(obj)) {
    var len = checked(obj.length) | 0;
    var buf = createBuffer(len);
    if (buf.length === 0) {
      return buf;
    }
    obj.copy(buf, 0, 0, len);
    return buf;
  }
  if (obj.length !== undefined) {
    if (typeof obj.length !== 'number' || numberIsNaN(obj.length)) {
      return createBuffer(0);
    }
    return fromArrayLike(obj);
  }
  if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
    return fromArrayLike(obj.data);
  }
}
function checked(length) {
  if (length >= K_MAX_LENGTH) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' + 'size: 0x' + K_MAX_LENGTH.toString(16) + ' bytes');
  }
  return length | 0;
}
function SlowBuffer(length) {
  if (+length != length) {
    length = 0;
  }
  return Buffer.alloc(+length);
}
Buffer.isBuffer = function isBuffer(b) {
  return b != null && b._isBuffer === true && b !== Buffer.prototype;
};
Buffer.compare = function compare(a, b) {
  if (isInstance(a, Uint8Array)) a = Buffer.from(a, a.offset, a.byteLength);
  if (isInstance(b, Uint8Array)) b = Buffer.from(b, b.offset, b.byteLength);
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array');
  }
  if (a === b) return 0;
  var x = a.length;
  var y = b.length;
  for (var i = 0, len = Math.min(x, y); i < len; ++i) {
    if (a[i] !== b[i]) {
      x = a[i];
      y = b[i];
      break;
    }
  }
  if (x < y) return -1;
  if (y < x) return 1;
  return 0;
};
Buffer.isEncoding = function isEncoding(encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'latin1':
    case 'binary':
    case 'base64':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true;
    default:
      return false;
  }
};
Buffer.concat = function concat(list, length) {
  if (!Array.isArray(list)) {
    throw new TypeError('"list" argument must be an Array of Buffers');
  }
  if (list.length === 0) {
    return Buffer.alloc(0);
  }
  var i;
  if (length === undefined) {
    length = 0;
    for (i = 0; i < list.length; ++i) {
      length += list[i].length;
    }
  }
  var buffer = Buffer.allocUnsafe(length);
  var pos = 0;
  for (i = 0; i < list.length; ++i) {
    var buf = list[i];
    if (isInstance(buf, Uint8Array)) {
      buf = Buffer.from(buf);
    }
    if (!Buffer.isBuffer(buf)) {
      throw new TypeError('"list" argument must be an Array of Buffers');
    }
    buf.copy(buffer, pos);
    pos += buf.length;
  }
  return buffer;
};
function byteLength(string, encoding) {
  if (Buffer.isBuffer(string)) {
    return string.length;
  }
  if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
    return string.byteLength;
  }
  if (typeof string !== 'string') {
    throw new TypeError('The "string" argument must be one of type string, Buffer, or ArrayBuffer. ' + 'Received type ' + typeof string);
  }
  var len = string.length;
  var mustMatch = arguments.length > 2 && arguments[2] === true;
  if (!mustMatch && len === 0) return 0;
  var loweredCase = false;
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'latin1':
      case 'binary':
        return len;
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length;
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2;
      case 'hex':
        return len >>> 1;
      case 'base64':
        return base64ToBytes(string).length;
      default:
        if (loweredCase) {
          return mustMatch ? -1 : utf8ToBytes(string).length;
        }
        encoding = ('' + encoding).toLowerCase();
        loweredCase = true;
    }
  }
}
Buffer.byteLength = byteLength;
function slowToString(encoding, start, end) {
  var loweredCase = false;
  if (start === undefined || start < 0) {
    start = 0;
  }
  if (start > this.length) {
    return '';
  }
  if (end === undefined || end > this.length) {
    end = this.length;
  }
  if (end <= 0) {
    return '';
  }
  end >>>= 0;
  start >>>= 0;
  if (end <= start) {
    return '';
  }
  if (!encoding) encoding = 'utf8';
  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end);
      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end);
      case 'ascii':
        return asciiSlice(this, start, end);
      case 'latin1':
      case 'binary':
        return latin1Slice(this, start, end);
      case 'base64':
        return base64Slice(this, start, end);
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end);
      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding);
        encoding = (encoding + '').toLowerCase();
        loweredCase = true;
    }
  }
}
Buffer.prototype._isBuffer = true;
function swap(b, n, m) {
  var i = b[n];
  b[n] = b[m];
  b[m] = i;
}
Buffer.prototype.swap16 = function swap16() {
  var len = this.length;
  if (len % 2 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 16-bits');
  }
  for (var i = 0; i < len; i += 2) {
    swap(this, i, i + 1);
  }
  return this;
};
Buffer.prototype.swap32 = function swap32() {
  var len = this.length;
  if (len % 4 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 32-bits');
  }
  for (var i = 0; i < len; i += 4) {
    swap(this, i, i + 3);
    swap(this, i + 1, i + 2);
  }
  return this;
};
Buffer.prototype.swap64 = function swap64() {
  var len = this.length;
  if (len % 8 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 64-bits');
  }
  for (var i = 0; i < len; i += 8) {
    swap(this, i, i + 7);
    swap(this, i + 1, i + 6);
    swap(this, i + 2, i + 5);
    swap(this, i + 3, i + 4);
  }
  return this;
};
Buffer.prototype.toString = function toString() {
  var length = this.length;
  if (length === 0) return '';
  if (arguments.length === 0) return utf8Slice(this, 0, length);
  return slowToString.apply(this, arguments);
};
Buffer.prototype.toLocaleString = Buffer.prototype.toString;
Buffer.prototype.equals = function equals(b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer');
  if (this === b) return true;
  return Buffer.compare(this, b) === 0;
};
Buffer.prototype.inspect = function inspect() {
  var str = '';
  var max = exports.INSPECT_MAX_BYTES;
  str = this.toString('hex', 0, max).replace(/(.{2})/g, '$1 ').trim();
  if (this.length > max) str += ' ... ';
  return '<Buffer ' + str + '>';
};
Buffer.prototype.compare = function compare(target, start, end, thisStart, thisEnd) {
  if (isInstance(target, Uint8Array)) {
    target = Buffer.from(target, target.offset, target.byteLength);
  }
  if (!Buffer.isBuffer(target)) {
    throw new TypeError('The "target" argument must be one of type Buffer or Uint8Array. ' + 'Received type ' + typeof target);
  }
  if (start === undefined) {
    start = 0;
  }
  if (end === undefined) {
    end = target ? target.length : 0;
  }
  if (thisStart === undefined) {
    thisStart = 0;
  }
  if (thisEnd === undefined) {
    thisEnd = this.length;
  }
  if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
    throw new RangeError('out of range index');
  }
  if (thisStart >= thisEnd && start >= end) {
    return 0;
  }
  if (thisStart >= thisEnd) {
    return -1;
  }
  if (start >= end) {
    return 1;
  }
  start >>>= 0;
  end >>>= 0;
  thisStart >>>= 0;
  thisEnd >>>= 0;
  if (this === target) return 0;
  var x = thisEnd - thisStart;
  var y = end - start;
  var len = Math.min(x, y);
  var thisCopy = this.slice(thisStart, thisEnd);
  var targetCopy = target.slice(start, end);
  for (var i = 0; i < len; ++i) {
    if (thisCopy[i] !== targetCopy[i]) {
      x = thisCopy[i];
      y = targetCopy[i];
      break;
    }
  }
  if (x < y) return -1;
  if (y < x) return 1;
  return 0;
};
function bidirectionalIndexOf(buffer, val, byteOffset, encoding, dir) {
  if (buffer.length === 0) return -1;
  if (typeof byteOffset === 'string') {
    encoding = byteOffset;
    byteOffset = 0;
  } else if (byteOffset > 0x7fffffff) {
    byteOffset = 0x7fffffff;
  } else if (byteOffset < -0x80000000) {
    byteOffset = -0x80000000;
  }
  byteOffset = +byteOffset;
  if (numberIsNaN(byteOffset)) {
    byteOffset = dir ? 0 : buffer.length - 1;
  }
  if (byteOffset < 0) byteOffset = buffer.length + byteOffset;
  if (byteOffset >= buffer.length) {
    if (dir) return -1;else byteOffset = buffer.length - 1;
  } else if (byteOffset < 0) {
    if (dir) byteOffset = 0;else return -1;
  }
  if (typeof val === 'string') {
    val = Buffer.from(val, encoding);
  }
  if (Buffer.isBuffer(val)) {
    if (val.length === 0) {
      return -1;
    }
    return arrayIndexOf(buffer, val, byteOffset, encoding, dir);
  } else if (typeof val === 'number') {
    val = val & 0xFF;
    if (typeof Uint8Array.prototype.indexOf === 'function') {
      if (dir) {
        return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset);
      } else {
        return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset);
      }
    }
    return arrayIndexOf(buffer, [val], byteOffset, encoding, dir);
  }
  throw new TypeError('val must be string, number or Buffer');
}
function arrayIndexOf(arr, val, byteOffset, encoding, dir) {
  var indexSize = 1;
  var arrLength = arr.length;
  var valLength = val.length;
  if (encoding !== undefined) {
    encoding = String(encoding).toLowerCase();
    if (encoding === 'ucs2' || encoding === 'ucs-2' || encoding === 'utf16le' || encoding === 'utf-16le') {
      if (arr.length < 2 || val.length < 2) {
        return -1;
      }
      indexSize = 2;
      arrLength /= 2;
      valLength /= 2;
      byteOffset /= 2;
    }
  }
  function read(buf, i) {
    if (indexSize === 1) {
      return buf[i];
    } else {
      return buf.readUInt16BE(i * indexSize);
    }
  }
  var i;
  if (dir) {
    var foundIndex = -1;
    for (i = byteOffset; i < arrLength; i++) {
      if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
        if (foundIndex === -1) foundIndex = i;
        if (i - foundIndex + 1 === valLength) return foundIndex * indexSize;
      } else {
        if (foundIndex !== -1) i -= i - foundIndex;
        foundIndex = -1;
      }
    }
  } else {
    if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength;
    for (i = byteOffset; i >= 0; i--) {
      var found = true;
      for (var j = 0; j < valLength; j++) {
        if (read(arr, i + j) !== read(val, j)) {
          found = false;
          break;
        }
      }
      if (found) return i;
    }
  }
  return -1;
}
Buffer.prototype.includes = function includes(val, byteOffset, encoding) {
  return this.indexOf(val, byteOffset, encoding) !== -1;
};
Buffer.prototype.indexOf = function indexOf(val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, true);
};
Buffer.prototype.lastIndexOf = function lastIndexOf(val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, false);
};
function hexWrite(buf, string, offset, length) {
  offset = Number(offset) || 0;
  var remaining = buf.length - offset;
  if (!length) {
    length = remaining;
  } else {
    length = Number(length);
    if (length > remaining) {
      length = remaining;
    }
  }
  var strLen = string.length;
  if (length > strLen / 2) {
    length = strLen / 2;
  }
  for (var i = 0; i < length; ++i) {
    var parsed = parseInt(string.substr(i * 2, 2), 16);
    if (numberIsNaN(parsed)) return i;
    buf[offset + i] = parsed;
  }
  return i;
}
function utf8Write(buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length);
}
function asciiWrite(buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length);
}
function latin1Write(buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length);
}
function base64Write(buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length);
}
function ucs2Write(buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length);
}
Buffer.prototype.write = function write(string, offset, length, encoding) {
  if (offset === undefined) {
    encoding = 'utf8';
    length = this.length;
    offset = 0;
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset;
    length = this.length;
    offset = 0;
  } else if (isFinite(offset)) {
    offset = offset >>> 0;
    if (isFinite(length)) {
      length = length >>> 0;
      if (encoding === undefined) encoding = 'utf8';
    } else {
      encoding = length;
      length = undefined;
    }
  } else {
    throw new Error('Buffer.write(string, encoding, offset[, length]) is no longer supported');
  }
  var remaining = this.length - offset;
  if (length === undefined || length > remaining) length = remaining;
  if (string.length > 0 && (length < 0 || offset < 0) || offset > this.length) {
    throw new RangeError('Attempt to write outside buffer bounds');
  }
  if (!encoding) encoding = 'utf8';
  var loweredCase = false;
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length);
      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length);
      case 'ascii':
        return asciiWrite(this, string, offset, length);
      case 'latin1':
      case 'binary':
        return latin1Write(this, string, offset, length);
      case 'base64':
        return base64Write(this, string, offset, length);
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length);
      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding);
        encoding = ('' + encoding).toLowerCase();
        loweredCase = true;
    }
  }
};
Buffer.prototype.toJSON = function toJSON() {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  };
};
function base64Slice(buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf);
  } else {
    return base64.fromByteArray(buf.slice(start, end));
  }
}
function utf8Slice(buf, start, end) {
  end = Math.min(buf.length, end);
  var res = [];
  var i = start;
  while (i < end) {
    var firstByte = buf[i];
    var codePoint = null;
    var bytesPerSequence = firstByte > 0xEF ? 4 : firstByte > 0xDF ? 3 : firstByte > 0xBF ? 2 : 1;
    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint;
      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte;
          }
          break;
        case 2:
          secondByte = buf[i + 1];
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | secondByte & 0x3F;
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint;
            }
          }
          break;
        case 3:
          secondByte = buf[i + 1];
          thirdByte = buf[i + 2];
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | thirdByte & 0x3F;
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint;
            }
          }
          break;
        case 4:
          secondByte = buf[i + 1];
          thirdByte = buf[i + 2];
          fourthByte = buf[i + 3];
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | fourthByte & 0x3F;
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint;
            }
          }
      }
    }
    if (codePoint === null) {
      codePoint = 0xFFFD;
      bytesPerSequence = 1;
    } else if (codePoint > 0xFFFF) {
      codePoint -= 0x10000;
      res.push(codePoint >>> 10 & 0x3FF | 0xD800);
      codePoint = 0xDC00 | codePoint & 0x3FF;
    }
    res.push(codePoint);
    i += bytesPerSequence;
  }
  return decodeCodePointsArray(res);
}
var MAX_ARGUMENTS_LENGTH = 0x1000;
function decodeCodePointsArray(codePoints) {
  var len = codePoints.length;
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints);
  }
  var res = '';
  var i = 0;
  while (i < len) {
    res += String.fromCharCode.apply(String, codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH));
  }
  return res;
}
function asciiSlice(buf, start, end) {
  var ret = '';
  end = Math.min(buf.length, end);
  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i] & 0x7F);
  }
  return ret;
}
function latin1Slice(buf, start, end) {
  var ret = '';
  end = Math.min(buf.length, end);
  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i]);
  }
  return ret;
}
function hexSlice(buf, start, end) {
  var len = buf.length;
  if (!start || start < 0) start = 0;
  if (!end || end < 0 || end > len) end = len;
  var out = '';
  for (var i = start; i < end; ++i) {
    out += toHex(buf[i]);
  }
  return out;
}
function utf16leSlice(buf, start, end) {
  var bytes = buf.slice(start, end);
  var res = '';
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
  }
  return res;
}
Buffer.prototype.slice = function slice(start, end) {
  var len = this.length;
  start = ~~start;
  end = end === undefined ? len : ~~end;
  if (start < 0) {
    start += len;
    if (start < 0) start = 0;
  } else if (start > len) {
    start = len;
  }
  if (end < 0) {
    end += len;
    if (end < 0) end = 0;
  } else if (end > len) {
    end = len;
  }
  if (end < start) end = start;
  var newBuf = this.subarray(start, end);
  newBuf.__proto__ = Buffer.prototype;
  return newBuf;
};
function checkOffset(offset, ext, length) {
  if (offset % 1 !== 0 || offset < 0) throw new RangeError('offset is not uint');
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length');
}
Buffer.prototype.readUIntLE = function readUIntLE(offset, byteLength, noAssert) {
  offset = offset >>> 0;
  byteLength = byteLength >>> 0;
  if (!noAssert) checkOffset(offset, byteLength, this.length);
  var val = this[offset];
  var mul = 1;
  var i = 0;
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul;
  }
  return val;
};
Buffer.prototype.readUIntBE = function readUIntBE(offset, byteLength, noAssert) {
  offset = offset >>> 0;
  byteLength = byteLength >>> 0;
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length);
  }
  var val = this[offset + --byteLength];
  var mul = 1;
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul;
  }
  return val;
};
Buffer.prototype.readUInt8 = function readUInt8(offset, noAssert) {
  offset = offset >>> 0;
  if (!noAssert) checkOffset(offset, 1, this.length);
  return this[offset];
};
Buffer.prototype.readUInt16LE = function readUInt16LE(offset, noAssert) {
  offset = offset >>> 0;
  if (!noAssert) checkOffset(offset, 2, this.length);
  return this[offset] | this[offset + 1] << 8;
};
Buffer.prototype.readUInt16BE = function readUInt16BE(offset, noAssert) {
  offset = offset >>> 0;
  if (!noAssert) checkOffset(offset, 2, this.length);
  return this[offset] << 8 | this[offset + 1];
};
Buffer.prototype.readUInt32LE = function readUInt32LE(offset, noAssert) {
  offset = offset >>> 0;
  if (!noAssert) checkOffset(offset, 4, this.length);
  return (this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16) + this[offset + 3] * 0x1000000;
};
Buffer.prototype.readUInt32BE = function readUInt32BE(offset, noAssert) {
  offset = offset >>> 0;
  if (!noAssert) checkOffset(offset, 4, this.length);
  return this[offset] * 0x1000000 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]);
};
Buffer.prototype.readIntLE = function readIntLE(offset, byteLength, noAssert) {
  offset = offset >>> 0;
  byteLength = byteLength >>> 0;
  if (!noAssert) checkOffset(offset, byteLength, this.length);
  var val = this[offset];
  var mul = 1;
  var i = 0;
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul;
  }
  mul *= 0x80;
  if (val >= mul) val -= Math.pow(2, 8 * byteLength);
  return val;
};
Buffer.prototype.readIntBE = function readIntBE(offset, byteLength, noAssert) {
  offset = offset >>> 0;
  byteLength = byteLength >>> 0;
  if (!noAssert) checkOffset(offset, byteLength, this.length);
  var i = byteLength;
  var mul = 1;
  var val = this[offset + --i];
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul;
  }
  mul *= 0x80;
  if (val >= mul) val -= Math.pow(2, 8 * byteLength);
  return val;
};
Buffer.prototype.readInt8 = function readInt8(offset, noAssert) {
  offset = offset >>> 0;
  if (!noAssert) checkOffset(offset, 1, this.length);
  if (!(this[offset] & 0x80)) return this[offset];
  return (0xff - this[offset] + 1) * -1;
};
Buffer.prototype.readInt16LE = function readInt16LE(offset, noAssert) {
  offset = offset >>> 0;
  if (!noAssert) checkOffset(offset, 2, this.length);
  var val = this[offset] | this[offset + 1] << 8;
  return val & 0x8000 ? val | 0xFFFF0000 : val;
};
Buffer.prototype.readInt16BE = function readInt16BE(offset, noAssert) {
  offset = offset >>> 0;
  if (!noAssert) checkOffset(offset, 2, this.length);
  var val = this[offset + 1] | this[offset] << 8;
  return val & 0x8000 ? val | 0xFFFF0000 : val;
};
Buffer.prototype.readInt32LE = function readInt32LE(offset, noAssert) {
  offset = offset >>> 0;
  if (!noAssert) checkOffset(offset, 4, this.length);
  return this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16 | this[offset + 3] << 24;
};
Buffer.prototype.readInt32BE = function readInt32BE(offset, noAssert) {
  offset = offset >>> 0;
  if (!noAssert) checkOffset(offset, 4, this.length);
  return this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3];
};
Buffer.prototype.readFloatLE = function readFloatLE(offset, noAssert) {
  offset = offset >>> 0;
  if (!noAssert) checkOffset(offset, 4, this.length);
  return ieee754.read(this, offset, true, 23, 4);
};
Buffer.prototype.readFloatBE = function readFloatBE(offset, noAssert) {
  offset = offset >>> 0;
  if (!noAssert) checkOffset(offset, 4, this.length);
  return ieee754.read(this, offset, false, 23, 4);
};
Buffer.prototype.readDoubleLE = function readDoubleLE(offset, noAssert) {
  offset = offset >>> 0;
  if (!noAssert) checkOffset(offset, 8, this.length);
  return ieee754.read(this, offset, true, 52, 8);
};
Buffer.prototype.readDoubleBE = function readDoubleBE(offset, noAssert) {
  offset = offset >>> 0;
  if (!noAssert) checkOffset(offset, 8, this.length);
  return ieee754.read(this, offset, false, 52, 8);
};
function checkInt(buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance');
  if (value > max || value < min) throw new RangeError('"value" argument is out of bounds');
  if (offset + ext > buf.length) throw new RangeError('Index out of range');
}
Buffer.prototype.writeUIntLE = function writeUIntLE(value, offset, byteLength, noAssert) {
  value = +value;
  offset = offset >>> 0;
  byteLength = byteLength >>> 0;
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1;
    checkInt(this, value, offset, byteLength, maxBytes, 0);
  }
  var mul = 1;
  var i = 0;
  this[offset] = value & 0xFF;
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = value / mul & 0xFF;
  }
  return offset + byteLength;
};
Buffer.prototype.writeUIntBE = function writeUIntBE(value, offset, byteLength, noAssert) {
  value = +value;
  offset = offset >>> 0;
  byteLength = byteLength >>> 0;
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1;
    checkInt(this, value, offset, byteLength, maxBytes, 0);
  }
  var i = byteLength - 1;
  var mul = 1;
  this[offset + i] = value & 0xFF;
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = value / mul & 0xFF;
  }
  return offset + byteLength;
};
Buffer.prototype.writeUInt8 = function writeUInt8(value, offset, noAssert) {
  value = +value;
  offset = offset >>> 0;
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0);
  this[offset] = value & 0xff;
  return offset + 1;
};
Buffer.prototype.writeUInt16LE = function writeUInt16LE(value, offset, noAssert) {
  value = +value;
  offset = offset >>> 0;
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0);
  this[offset] = value & 0xff;
  this[offset + 1] = value >>> 8;
  return offset + 2;
};
Buffer.prototype.writeUInt16BE = function writeUInt16BE(value, offset, noAssert) {
  value = +value;
  offset = offset >>> 0;
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0);
  this[offset] = value >>> 8;
  this[offset + 1] = value & 0xff;
  return offset + 2;
};
Buffer.prototype.writeUInt32LE = function writeUInt32LE(value, offset, noAssert) {
  value = +value;
  offset = offset >>> 0;
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0);
  this[offset + 3] = value >>> 24;
  this[offset + 2] = value >>> 16;
  this[offset + 1] = value >>> 8;
  this[offset] = value & 0xff;
  return offset + 4;
};
Buffer.prototype.writeUInt32BE = function writeUInt32BE(value, offset, noAssert) {
  value = +value;
  offset = offset >>> 0;
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0);
  this[offset] = value >>> 24;
  this[offset + 1] = value >>> 16;
  this[offset + 2] = value >>> 8;
  this[offset + 3] = value & 0xff;
  return offset + 4;
};
Buffer.prototype.writeIntLE = function writeIntLE(value, offset, byteLength, noAssert) {
  value = +value;
  offset = offset >>> 0;
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1);
    checkInt(this, value, offset, byteLength, limit - 1, -limit);
  }
  var i = 0;
  var mul = 1;
  var sub = 0;
  this[offset] = value & 0xFF;
  while (++i < byteLength && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
      sub = 1;
    }
    this[offset + i] = (value / mul >> 0) - sub & 0xFF;
  }
  return offset + byteLength;
};
Buffer.prototype.writeIntBE = function writeIntBE(value, offset, byteLength, noAssert) {
  value = +value;
  offset = offset >>> 0;
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1);
    checkInt(this, value, offset, byteLength, limit - 1, -limit);
  }
  var i = byteLength - 1;
  var mul = 1;
  var sub = 0;
  this[offset + i] = value & 0xFF;
  while (--i >= 0 && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
      sub = 1;
    }
    this[offset + i] = (value / mul >> 0) - sub & 0xFF;
  }
  return offset + byteLength;
};
Buffer.prototype.writeInt8 = function writeInt8(value, offset, noAssert) {
  value = +value;
  offset = offset >>> 0;
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80);
  if (value < 0) value = 0xff + value + 1;
  this[offset] = value & 0xff;
  return offset + 1;
};
Buffer.prototype.writeInt16LE = function writeInt16LE(value, offset, noAssert) {
  value = +value;
  offset = offset >>> 0;
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000);
  this[offset] = value & 0xff;
  this[offset + 1] = value >>> 8;
  return offset + 2;
};
Buffer.prototype.writeInt16BE = function writeInt16BE(value, offset, noAssert) {
  value = +value;
  offset = offset >>> 0;
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000);
  this[offset] = value >>> 8;
  this[offset + 1] = value & 0xff;
  return offset + 2;
};
Buffer.prototype.writeInt32LE = function writeInt32LE(value, offset, noAssert) {
  value = +value;
  offset = offset >>> 0;
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000);
  this[offset] = value & 0xff;
  this[offset + 1] = value >>> 8;
  this[offset + 2] = value >>> 16;
  this[offset + 3] = value >>> 24;
  return offset + 4;
};
Buffer.prototype.writeInt32BE = function writeInt32BE(value, offset, noAssert) {
  value = +value;
  offset = offset >>> 0;
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000);
  if (value < 0) value = 0xffffffff + value + 1;
  this[offset] = value >>> 24;
  this[offset + 1] = value >>> 16;
  this[offset + 2] = value >>> 8;
  this[offset + 3] = value & 0xff;
  return offset + 4;
};
function checkIEEE754(buf, value, offset, ext, max, min) {
  if (offset + ext > buf.length) throw new RangeError('Index out of range');
  if (offset < 0) throw new RangeError('Index out of range');
}
function writeFloat(buf, value, offset, littleEndian, noAssert) {
  value = +value;
  offset = offset >>> 0;
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38);
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4);
  return offset + 4;
}
Buffer.prototype.writeFloatLE = function writeFloatLE(value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert);
};
Buffer.prototype.writeFloatBE = function writeFloatBE(value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert);
};
function writeDouble(buf, value, offset, littleEndian, noAssert) {
  value = +value;
  offset = offset >>> 0;
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308);
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8);
  return offset + 8;
}
Buffer.prototype.writeDoubleLE = function writeDoubleLE(value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert);
};
Buffer.prototype.writeDoubleBE = function writeDoubleBE(value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert);
};
Buffer.prototype.copy = function copy(target, targetStart, start, end) {
  if (!Buffer.isBuffer(target)) throw new TypeError('argument should be a Buffer');
  if (!start) start = 0;
  if (!end && end !== 0) end = this.length;
  if (targetStart >= target.length) targetStart = target.length;
  if (!targetStart) targetStart = 0;
  if (end > 0 && end < start) end = start;
  if (end === start) return 0;
  if (target.length === 0 || this.length === 0) return 0;
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds');
  }
  if (start < 0 || start >= this.length) throw new RangeError('Index out of range');
  if (end < 0) throw new RangeError('sourceEnd out of bounds');
  if (end > this.length) end = this.length;
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start;
  }
  var len = end - start;
  if (this === target && typeof Uint8Array.prototype.copyWithin === 'function') {
    this.copyWithin(targetStart, start, end);
  } else if (this === target && start < targetStart && targetStart < end) {
    for (var i = len - 1; i >= 0; --i) {
      target[i + targetStart] = this[i + start];
    }
  } else {
    Uint8Array.prototype.set.call(target, this.subarray(start, end), targetStart);
  }
  return len;
};
Buffer.prototype.fill = function fill(val, start, end, encoding) {
  if (typeof val === 'string') {
    if (typeof start === 'string') {
      encoding = start;
      start = 0;
      end = this.length;
    } else if (typeof end === 'string') {
      encoding = end;
      end = this.length;
    }
    if (encoding !== undefined && typeof encoding !== 'string') {
      throw new TypeError('encoding must be a string');
    }
    if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
      throw new TypeError('Unknown encoding: ' + encoding);
    }
    if (val.length === 1) {
      var code = val.charCodeAt(0);
      if (encoding === 'utf8' && code < 128 || encoding === 'latin1') {
        val = code;
      }
    }
  } else if (typeof val === 'number') {
    val = val & 255;
  }
  if (start < 0 || this.length < start || this.length < end) {
    throw new RangeError('Out of range index');
  }
  if (end <= start) {
    return this;
  }
  start = start >>> 0;
  end = end === undefined ? this.length : end >>> 0;
  if (!val) val = 0;
  var i;
  if (typeof val === 'number') {
    for (i = start; i < end; ++i) {
      this[i] = val;
    }
  } else {
    var bytes = Buffer.isBuffer(val) ? val : Buffer.from(val, encoding);
    var len = bytes.length;
    if (len === 0) {
      throw new TypeError('The value "' + val + '" is invalid for argument "value"');
    }
    for (i = 0; i < end - start; ++i) {
      this[i + start] = bytes[i % len];
    }
  }
  return this;
};
var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g;
function base64clean(str) {
  str = str.split('=')[0];
  str = str.trim().replace(INVALID_BASE64_RE, '');
  if (str.length < 2) return '';
  while (str.length % 4 !== 0) {
    str = str + '=';
  }
  return str;
}
function toHex(n) {
  if (n < 16) return '0' + n.toString(16);
  return n.toString(16);
}
function utf8ToBytes(string, units) {
  units = units || Infinity;
  var codePoint;
  var length = string.length;
  var leadSurrogate = null;
  var bytes = [];
  for (var i = 0; i < length; ++i) {
    codePoint = string.charCodeAt(i);
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      if (!leadSurrogate) {
        if (codePoint > 0xDBFF) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
          continue;
        } else if (i + 1 === length) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
          continue;
        }
        leadSurrogate = codePoint;
        continue;
      }
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
        leadSurrogate = codePoint;
        continue;
      }
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000;
    } else if (leadSurrogate) {
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
    }
    leadSurrogate = null;
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break;
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break;
      bytes.push(codePoint >> 0x6 | 0xC0, codePoint & 0x3F | 0x80);
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break;
      bytes.push(codePoint >> 0xC | 0xE0, codePoint >> 0x6 & 0x3F | 0x80, codePoint & 0x3F | 0x80);
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break;
      bytes.push(codePoint >> 0x12 | 0xF0, codePoint >> 0xC & 0x3F | 0x80, codePoint >> 0x6 & 0x3F | 0x80, codePoint & 0x3F | 0x80);
    } else {
      throw new Error('Invalid code point');
    }
  }
  return bytes;
}
function asciiToBytes(str) {
  var byteArray = [];
  for (var i = 0; i < str.length; ++i) {
    byteArray.push(str.charCodeAt(i) & 0xFF);
  }
  return byteArray;
}
function utf16leToBytes(str, units) {
  var c, hi, lo;
  var byteArray = [];
  for (var i = 0; i < str.length; ++i) {
    if ((units -= 2) < 0) break;
    c = str.charCodeAt(i);
    hi = c >> 8;
    lo = c % 256;
    byteArray.push(lo);
    byteArray.push(hi);
  }
  return byteArray;
}
function base64ToBytes(str) {
  return base64.toByteArray(base64clean(str));
}
function blitBuffer(src, dst, offset, length) {
  for (var i = 0; i < length; ++i) {
    if (i + offset >= dst.length || i >= src.length) break;
    dst[i + offset] = src[i];
  }
  return i;
}
function isInstance(obj, type) {
  return obj instanceof type || obj != null && obj.constructor != null && obj.constructor.name != null && obj.constructor.name === type.name;
}
function numberIsNaN(obj) {
  return obj !== obj;
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"base64-js":2,"buffer":4,"ieee754":40}],5:[function(require,module,exports){
'use strict';

var bind = require('function-bind');
var $apply = require('./functionApply');
var $call = require('./functionCall');
var $reflectApply = require('./reflectApply');
module.exports = $reflectApply || bind.call($call, $apply);

},{"./functionApply":7,"./functionCall":8,"./reflectApply":10,"function-bind":28}],6:[function(require,module,exports){
'use strict';

var bind = require('function-bind');
var $apply = require('./functionApply');
var actualApply = require('./actualApply');
module.exports = function applyBind() {
  return actualApply(bind, $apply, arguments);
};

},{"./actualApply":5,"./functionApply":7,"function-bind":28}],7:[function(require,module,exports){
'use strict';
module.exports = Function.prototype.apply;

},{}],8:[function(require,module,exports){
'use strict';
module.exports = Function.prototype.call;

},{}],9:[function(require,module,exports){
'use strict';

var bind = require('function-bind');
var $TypeError = require('es-errors/type');
var $call = require('./functionCall');
var $actualApply = require('./actualApply');
module.exports = function callBindBasic(args) {
  if (args.length < 1 || typeof args[0] !== 'function') {
    throw new $TypeError('a function is required');
  }
  return $actualApply(bind, $call, args);
};

},{"./actualApply":5,"./functionCall":8,"es-errors/type":22,"function-bind":28}],10:[function(require,module,exports){
'use strict';
module.exports = typeof Reflect !== 'undefined' && Reflect && Reflect.apply;

},{}],11:[function(require,module,exports){
'use strict';

var setFunctionLength = require('set-function-length');
var $defineProperty = require('es-define-property');
var callBindBasic = require('call-bind-apply-helpers');
var applyBind = require('call-bind-apply-helpers/applyBind');
module.exports = function callBind(originalFunction) {
  var func = callBindBasic(arguments);
  var adjustedLength = originalFunction.length - (arguments.length - 1);
  return setFunctionLength(func, 1 + (adjustedLength > 0 ? adjustedLength : 0), true);
};
if ($defineProperty) {
  $defineProperty(module.exports, 'apply', {
    value: applyBind
  });
} else {
  module.exports.apply = applyBind;
}

},{"call-bind-apply-helpers":9,"call-bind-apply-helpers/applyBind":6,"es-define-property":16,"set-function-length":64}],12:[function(require,module,exports){
'use strict';

var GetIntrinsic = require('get-intrinsic');
var callBindBasic = require('call-bind-apply-helpers');
var $indexOf = callBindBasic([GetIntrinsic('%String.prototype.indexOf%')]);
module.exports = function callBoundIntrinsic(name, allowMissing) {
  var intrinsic = GetIntrinsic(name, !!allowMissing);
  if (typeof intrinsic === 'function' && $indexOf(name, '.prototype.') > -1) {
    return callBindBasic([intrinsic]);
  }
  return intrinsic;
};

},{"call-bind-apply-helpers":9,"get-intrinsic":29}],13:[function(require,module,exports){
if (typeof module !== 'undefined') {
  module.exports = Emitter;
}
function Emitter(obj) {
  if (obj) return mixin(obj);
}
;
function mixin(obj) {
  for (var key in Emitter.prototype) {
    obj[key] = Emitter.prototype[key];
  }
  return obj;
}
Emitter.prototype.on = Emitter.prototype.addEventListener = function (event, fn) {
  this._callbacks = this._callbacks || {};
  (this._callbacks['$' + event] = this._callbacks['$' + event] || []).push(fn);
  return this;
};
Emitter.prototype.once = function (event, fn) {
  function on() {
    this.off(event, on);
    fn.apply(this, arguments);
  }
  on.fn = fn;
  this.on(event, on);
  return this;
};
Emitter.prototype.off = Emitter.prototype.removeListener = Emitter.prototype.removeAllListeners = Emitter.prototype.removeEventListener = function (event, fn) {
  this._callbacks = this._callbacks || {};
  if (0 == arguments.length) {
    this._callbacks = {};
    return this;
  }
  var callbacks = this._callbacks['$' + event];
  if (!callbacks) return this;
  if (1 == arguments.length) {
    delete this._callbacks['$' + event];
    return this;
  }
  var cb;
  for (var i = 0; i < callbacks.length; i++) {
    cb = callbacks[i];
    if (cb === fn || cb.fn === fn) {
      callbacks.splice(i, 1);
      break;
    }
  }
  if (callbacks.length === 0) {
    delete this._callbacks['$' + event];
  }
  return this;
};
Emitter.prototype.emit = function (event) {
  this._callbacks = this._callbacks || {};
  var args = new Array(arguments.length - 1),
    callbacks = this._callbacks['$' + event];
  for (var i = 1; i < arguments.length; i++) {
    args[i - 1] = arguments[i];
  }
  if (callbacks) {
    callbacks = callbacks.slice(0);
    for (var i = 0, len = callbacks.length; i < len; ++i) {
      callbacks[i].apply(this, args);
    }
  }
  return this;
};
Emitter.prototype.listeners = function (event) {
  this._callbacks = this._callbacks || {};
  return this._callbacks['$' + event] || [];
};
Emitter.prototype.hasListeners = function (event) {
  return !!this.listeners(event).length;
};

},{}],14:[function(require,module,exports){
'use strict';

var $defineProperty = require('es-define-property');
var $SyntaxError = require('es-errors/syntax');
var $TypeError = require('es-errors/type');
var gopd = require('gopd');
module.exports = function defineDataProperty(obj, property, value) {
  if (!obj || typeof obj !== 'object' && typeof obj !== 'function') {
    throw new $TypeError('`obj` must be an object or a function`');
  }
  if (typeof property !== 'string' && typeof property !== 'symbol') {
    throw new $TypeError('`property` must be a string or a symbol`');
  }
  if (arguments.length > 3 && typeof arguments[3] !== 'boolean' && arguments[3] !== null) {
    throw new $TypeError('`nonEnumerable`, if provided, must be a boolean or null');
  }
  if (arguments.length > 4 && typeof arguments[4] !== 'boolean' && arguments[4] !== null) {
    throw new $TypeError('`nonWritable`, if provided, must be a boolean or null');
  }
  if (arguments.length > 5 && typeof arguments[5] !== 'boolean' && arguments[5] !== null) {
    throw new $TypeError('`nonConfigurable`, if provided, must be a boolean or null');
  }
  if (arguments.length > 6 && typeof arguments[6] !== 'boolean') {
    throw new $TypeError('`loose`, if provided, must be a boolean');
  }
  var nonEnumerable = arguments.length > 3 ? arguments[3] : null;
  var nonWritable = arguments.length > 4 ? arguments[4] : null;
  var nonConfigurable = arguments.length > 5 ? arguments[5] : null;
  var loose = arguments.length > 6 ? arguments[6] : false;
  var desc = !!gopd && gopd(obj, property);
  if ($defineProperty) {
    $defineProperty(obj, property, {
      configurable: nonConfigurable === null && desc ? desc.configurable : !nonConfigurable,
      enumerable: nonEnumerable === null && desc ? desc.enumerable : !nonEnumerable,
      value: value,
      writable: nonWritable === null && desc ? desc.writable : !nonWritable
    });
  } else if (loose || !nonEnumerable && !nonWritable && !nonConfigurable) {
    obj[property] = value;
  } else {
    throw new $SyntaxError('This environment does not support defining a property as non-configurable, non-writable, or non-enumerable.');
  }
};

},{"es-define-property":16,"es-errors/syntax":21,"es-errors/type":22,"gopd":34}],15:[function(require,module,exports){
'use strict';

var callBind = require('call-bind-apply-helpers');
var gOPD = require('gopd');
var hasProtoAccessor;
try {
  hasProtoAccessor = [].__proto__ === Array.prototype;
} catch (e) {
  if (!e || typeof e !== 'object' || !('code' in e) || e.code !== 'ERR_PROTO_ACCESS') {
    throw e;
  }
}
var desc = !!hasProtoAccessor && gOPD && gOPD(Object.prototype, '__proto__');
var $Object = Object;
var $getPrototypeOf = $Object.getPrototypeOf;
module.exports = desc && typeof desc.get === 'function' ? callBind([desc.get]) : typeof $getPrototypeOf === 'function' ? function getDunder(value) {
  return $getPrototypeOf(value == null ? value : $Object(value));
} : false;

},{"call-bind-apply-helpers":9,"gopd":34}],16:[function(require,module,exports){
'use strict';
var $defineProperty = Object.defineProperty || false;
if ($defineProperty) {
  try {
    $defineProperty({}, 'a', {
      value: 1
    });
  } catch (e) {
    $defineProperty = false;
  }
}
module.exports = $defineProperty;

},{}],17:[function(require,module,exports){
'use strict';
module.exports = EvalError;

},{}],18:[function(require,module,exports){
'use strict';
module.exports = Error;

},{}],19:[function(require,module,exports){
'use strict';
module.exports = RangeError;

},{}],20:[function(require,module,exports){
'use strict';
module.exports = ReferenceError;

},{}],21:[function(require,module,exports){
'use strict';
module.exports = SyntaxError;

},{}],22:[function(require,module,exports){
'use strict';
module.exports = TypeError;

},{}],23:[function(require,module,exports){
'use strict';
module.exports = URIError;

},{}],24:[function(require,module,exports){
'use strict';
module.exports = Object;

},{}],25:[function(require,module,exports){
module.exports = stringify;
stringify.default = stringify;
stringify.stable = deterministicStringify;
stringify.stableStringify = deterministicStringify;
var LIMIT_REPLACE_NODE = '[...]';
var CIRCULAR_REPLACE_NODE = '[Circular]';
var arr = [];
var replacerStack = [];
function defaultOptions() {
  return {
    depthLimit: Number.MAX_SAFE_INTEGER,
    edgesLimit: Number.MAX_SAFE_INTEGER
  };
}
function stringify(obj, replacer, spacer, options) {
  if (typeof options === 'undefined') {
    options = defaultOptions();
  }
  decirc(obj, '', 0, [], undefined, 0, options);
  var res;
  try {
    if (replacerStack.length === 0) {
      res = JSON.stringify(obj, replacer, spacer);
    } else {
      res = JSON.stringify(obj, replaceGetterValues(replacer), spacer);
    }
  } catch (_) {
    return JSON.stringify('[unable to serialize, circular reference is too complex to analyze]');
  } finally {
    while (arr.length !== 0) {
      var part = arr.pop();
      if (part.length === 4) {
        Object.defineProperty(part[0], part[1], part[3]);
      } else {
        part[0][part[1]] = part[2];
      }
    }
  }
  return res;
}
function setReplace(replace, val, k, parent) {
  var propertyDescriptor = Object.getOwnPropertyDescriptor(parent, k);
  if (propertyDescriptor.get !== undefined) {
    if (propertyDescriptor.configurable) {
      Object.defineProperty(parent, k, {
        value: replace
      });
      arr.push([parent, k, val, propertyDescriptor]);
    } else {
      replacerStack.push([val, k, replace]);
    }
  } else {
    parent[k] = replace;
    arr.push([parent, k, val]);
  }
}
function decirc(val, k, edgeIndex, stack, parent, depth, options) {
  depth += 1;
  var i;
  if (typeof val === 'object' && val !== null) {
    for (i = 0; i < stack.length; i++) {
      if (stack[i] === val) {
        setReplace(CIRCULAR_REPLACE_NODE, val, k, parent);
        return;
      }
    }
    if (typeof options.depthLimit !== 'undefined' && depth > options.depthLimit) {
      setReplace(LIMIT_REPLACE_NODE, val, k, parent);
      return;
    }
    if (typeof options.edgesLimit !== 'undefined' && edgeIndex + 1 > options.edgesLimit) {
      setReplace(LIMIT_REPLACE_NODE, val, k, parent);
      return;
    }
    stack.push(val);
    if (Array.isArray(val)) {
      for (i = 0; i < val.length; i++) {
        decirc(val[i], i, i, stack, val, depth, options);
      }
    } else {
      var keys = Object.keys(val);
      for (i = 0; i < keys.length; i++) {
        var key = keys[i];
        decirc(val[key], key, i, stack, val, depth, options);
      }
    }
    stack.pop();
  }
}
function compareFunction(a, b) {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}
function deterministicStringify(obj, replacer, spacer, options) {
  if (typeof options === 'undefined') {
    options = defaultOptions();
  }
  var tmp = deterministicDecirc(obj, '', 0, [], undefined, 0, options) || obj;
  var res;
  try {
    if (replacerStack.length === 0) {
      res = JSON.stringify(tmp, replacer, spacer);
    } else {
      res = JSON.stringify(tmp, replaceGetterValues(replacer), spacer);
    }
  } catch (_) {
    return JSON.stringify('[unable to serialize, circular reference is too complex to analyze]');
  } finally {
    while (arr.length !== 0) {
      var part = arr.pop();
      if (part.length === 4) {
        Object.defineProperty(part[0], part[1], part[3]);
      } else {
        part[0][part[1]] = part[2];
      }
    }
  }
  return res;
}
function deterministicDecirc(val, k, edgeIndex, stack, parent, depth, options) {
  depth += 1;
  var i;
  if (typeof val === 'object' && val !== null) {
    for (i = 0; i < stack.length; i++) {
      if (stack[i] === val) {
        setReplace(CIRCULAR_REPLACE_NODE, val, k, parent);
        return;
      }
    }
    try {
      if (typeof val.toJSON === 'function') {
        return;
      }
    } catch (_) {
      return;
    }
    if (typeof options.depthLimit !== 'undefined' && depth > options.depthLimit) {
      setReplace(LIMIT_REPLACE_NODE, val, k, parent);
      return;
    }
    if (typeof options.edgesLimit !== 'undefined' && edgeIndex + 1 > options.edgesLimit) {
      setReplace(LIMIT_REPLACE_NODE, val, k, parent);
      return;
    }
    stack.push(val);
    if (Array.isArray(val)) {
      for (i = 0; i < val.length; i++) {
        deterministicDecirc(val[i], i, i, stack, val, depth, options);
      }
    } else {
      var tmp = {};
      var keys = Object.keys(val).sort(compareFunction);
      for (i = 0; i < keys.length; i++) {
        var key = keys[i];
        deterministicDecirc(val[key], key, i, stack, val, depth, options);
        tmp[key] = val[key];
      }
      if (typeof parent !== 'undefined') {
        arr.push([parent, k, val]);
        parent[k] = tmp;
      } else {
        return tmp;
      }
    }
    stack.pop();
  }
}
function replaceGetterValues(replacer) {
  replacer = typeof replacer !== 'undefined' ? replacer : function (k, v) {
    return v;
  };
  return function (key, val) {
    if (replacerStack.length > 0) {
      for (var i = 0; i < replacerStack.length; i++) {
        var part = replacerStack[i];
        if (part[1] === key && part[0] === val) {
          val = part[2];
          replacerStack.splice(i, 1);
          break;
        }
      }
    }
    return replacer.call(this, key, val);
  };
}

},{}],26:[function(require,module,exports){
'use strict';

var isCallable = require('is-callable');
var toStr = Object.prototype.toString;
var hasOwnProperty = Object.prototype.hasOwnProperty;
var forEachArray = function forEachArray(array, iterator, receiver) {
  for (var i = 0, len = array.length; i < len; i++) {
    if (hasOwnProperty.call(array, i)) {
      if (receiver == null) {
        iterator(array[i], i, array);
      } else {
        iterator.call(receiver, array[i], i, array);
      }
    }
  }
};
var forEachString = function forEachString(string, iterator, receiver) {
  for (var i = 0, len = string.length; i < len; i++) {
    if (receiver == null) {
      iterator(string.charAt(i), i, string);
    } else {
      iterator.call(receiver, string.charAt(i), i, string);
    }
  }
};
var forEachObject = function forEachObject(object, iterator, receiver) {
  for (var k in object) {
    if (hasOwnProperty.call(object, k)) {
      if (receiver == null) {
        iterator(object[k], k, object);
      } else {
        iterator.call(receiver, object[k], k, object);
      }
    }
  }
};
function isArray(x) {
  return toStr.call(x) === '[object Array]';
}
module.exports = function forEach(list, iterator, thisArg) {
  if (!isCallable(iterator)) {
    throw new TypeError('iterator must be a function');
  }
  var receiver;
  if (arguments.length >= 3) {
    receiver = thisArg;
  }
  if (isArray(list)) {
    forEachArray(list, iterator, receiver);
  } else if (typeof list === 'string') {
    forEachString(list, iterator, receiver);
  } else {
    forEachObject(list, iterator, receiver);
  }
};

},{"is-callable":43}],27:[function(require,module,exports){
'use strict';
var ERROR_MESSAGE = 'Function.prototype.bind called on incompatible ';
var toStr = Object.prototype.toString;
var max = Math.max;
var funcType = '[object Function]';
var concatty = function concatty(a, b) {
  var arr = [];
  for (var i = 0; i < a.length; i += 1) {
    arr[i] = a[i];
  }
  for (var j = 0; j < b.length; j += 1) {
    arr[j + a.length] = b[j];
  }
  return arr;
};
var slicy = function slicy(arrLike, offset) {
  var arr = [];
  for (var i = offset || 0, j = 0; i < arrLike.length; i += 1, j += 1) {
    arr[j] = arrLike[i];
  }
  return arr;
};
var joiny = function (arr, joiner) {
  var str = '';
  for (var i = 0; i < arr.length; i += 1) {
    str += arr[i];
    if (i + 1 < arr.length) {
      str += joiner;
    }
  }
  return str;
};
module.exports = function bind(that) {
  var target = this;
  if (typeof target !== 'function' || toStr.apply(target) !== funcType) {
    throw new TypeError(ERROR_MESSAGE + target);
  }
  var args = slicy(arguments, 1);
  var bound;
  var binder = function () {
    if (this instanceof bound) {
      var result = target.apply(this, concatty(args, arguments));
      if (Object(result) === result) {
        return result;
      }
      return this;
    }
    return target.apply(that, concatty(args, arguments));
  };
  var boundLength = max(0, target.length - args.length);
  var boundArgs = [];
  for (var i = 0; i < boundLength; i++) {
    boundArgs[i] = '$' + i;
  }
  bound = Function('binder', 'return function (' + joiny(boundArgs, ',') + '){ return binder.apply(this,arguments); }')(binder);
  if (target.prototype) {
    var Empty = function Empty() {};
    Empty.prototype = target.prototype;
    bound.prototype = new Empty();
    Empty.prototype = null;
  }
  return bound;
};

},{}],28:[function(require,module,exports){
'use strict';

var implementation = require('./implementation');
module.exports = Function.prototype.bind || implementation;

},{"./implementation":27}],29:[function(require,module,exports){
'use strict';

var undefined;
var $Object = require('es-object-atoms');
var $Error = require('es-errors');
var $EvalError = require('es-errors/eval');
var $RangeError = require('es-errors/range');
var $ReferenceError = require('es-errors/ref');
var $SyntaxError = require('es-errors/syntax');
var $TypeError = require('es-errors/type');
var $URIError = require('es-errors/uri');
var abs = require('math-intrinsics/abs');
var floor = require('math-intrinsics/floor');
var max = require('math-intrinsics/max');
var min = require('math-intrinsics/min');
var pow = require('math-intrinsics/pow');
var round = require('math-intrinsics/round');
var sign = require('math-intrinsics/sign');
var $Function = Function;
var getEvalledConstructor = function (expressionSyntax) {
  try {
    return $Function('"use strict"; return (' + expressionSyntax + ').constructor;')();
  } catch (e) {}
};
var $gOPD = require('gopd');
var $defineProperty = require('es-define-property');
var throwTypeError = function () {
  throw new $TypeError();
};
var ThrowTypeError = $gOPD ? function () {
  try {
    arguments.callee;
    return throwTypeError;
  } catch (calleeThrows) {
    try {
      return $gOPD(arguments, 'callee').get;
    } catch (gOPDthrows) {
      return throwTypeError;
    }
  }
}() : throwTypeError;
var hasSymbols = require('has-symbols')();
var getProto = require('get-proto');
var $ObjectGPO = require('get-proto/Object.getPrototypeOf');
var $ReflectGPO = require('get-proto/Reflect.getPrototypeOf');
var $apply = require('call-bind-apply-helpers/functionApply');
var $call = require('call-bind-apply-helpers/functionCall');
var needsEval = {};
var TypedArray = typeof Uint8Array === 'undefined' || !getProto ? undefined : getProto(Uint8Array);
var INTRINSICS = {
  __proto__: null,
  '%AggregateError%': typeof AggregateError === 'undefined' ? undefined : AggregateError,
  '%Array%': Array,
  '%ArrayBuffer%': typeof ArrayBuffer === 'undefined' ? undefined : ArrayBuffer,
  '%ArrayIteratorPrototype%': hasSymbols && getProto ? getProto([][Symbol.iterator]()) : undefined,
  '%AsyncFromSyncIteratorPrototype%': undefined,
  '%AsyncFunction%': needsEval,
  '%AsyncGenerator%': needsEval,
  '%AsyncGeneratorFunction%': needsEval,
  '%AsyncIteratorPrototype%': needsEval,
  '%Atomics%': typeof Atomics === 'undefined' ? undefined : Atomics,
  '%BigInt%': typeof BigInt === 'undefined' ? undefined : BigInt,
  '%BigInt64Array%': typeof BigInt64Array === 'undefined' ? undefined : BigInt64Array,
  '%BigUint64Array%': typeof BigUint64Array === 'undefined' ? undefined : BigUint64Array,
  '%Boolean%': Boolean,
  '%DataView%': typeof DataView === 'undefined' ? undefined : DataView,
  '%Date%': Date,
  '%decodeURI%': decodeURI,
  '%decodeURIComponent%': decodeURIComponent,
  '%encodeURI%': encodeURI,
  '%encodeURIComponent%': encodeURIComponent,
  '%Error%': $Error,
  '%eval%': eval,
  '%EvalError%': $EvalError,
  '%Float16Array%': typeof Float16Array === 'undefined' ? undefined : Float16Array,
  '%Float32Array%': typeof Float32Array === 'undefined' ? undefined : Float32Array,
  '%Float64Array%': typeof Float64Array === 'undefined' ? undefined : Float64Array,
  '%FinalizationRegistry%': typeof FinalizationRegistry === 'undefined' ? undefined : FinalizationRegistry,
  '%Function%': $Function,
  '%GeneratorFunction%': needsEval,
  '%Int8Array%': typeof Int8Array === 'undefined' ? undefined : Int8Array,
  '%Int16Array%': typeof Int16Array === 'undefined' ? undefined : Int16Array,
  '%Int32Array%': typeof Int32Array === 'undefined' ? undefined : Int32Array,
  '%isFinite%': isFinite,
  '%isNaN%': isNaN,
  '%IteratorPrototype%': hasSymbols && getProto ? getProto(getProto([][Symbol.iterator]())) : undefined,
  '%JSON%': typeof JSON === 'object' ? JSON : undefined,
  '%Map%': typeof Map === 'undefined' ? undefined : Map,
  '%MapIteratorPrototype%': typeof Map === 'undefined' || !hasSymbols || !getProto ? undefined : getProto(new Map()[Symbol.iterator]()),
  '%Math%': Math,
  '%Number%': Number,
  '%Object%': $Object,
  '%Object.getOwnPropertyDescriptor%': $gOPD,
  '%parseFloat%': parseFloat,
  '%parseInt%': parseInt,
  '%Promise%': typeof Promise === 'undefined' ? undefined : Promise,
  '%Proxy%': typeof Proxy === 'undefined' ? undefined : Proxy,
  '%RangeError%': $RangeError,
  '%ReferenceError%': $ReferenceError,
  '%Reflect%': typeof Reflect === 'undefined' ? undefined : Reflect,
  '%RegExp%': RegExp,
  '%Set%': typeof Set === 'undefined' ? undefined : Set,
  '%SetIteratorPrototype%': typeof Set === 'undefined' || !hasSymbols || !getProto ? undefined : getProto(new Set()[Symbol.iterator]()),
  '%SharedArrayBuffer%': typeof SharedArrayBuffer === 'undefined' ? undefined : SharedArrayBuffer,
  '%String%': String,
  '%StringIteratorPrototype%': hasSymbols && getProto ? getProto(''[Symbol.iterator]()) : undefined,
  '%Symbol%': hasSymbols ? Symbol : undefined,
  '%SyntaxError%': $SyntaxError,
  '%ThrowTypeError%': ThrowTypeError,
  '%TypedArray%': TypedArray,
  '%TypeError%': $TypeError,
  '%Uint8Array%': typeof Uint8Array === 'undefined' ? undefined : Uint8Array,
  '%Uint8ClampedArray%': typeof Uint8ClampedArray === 'undefined' ? undefined : Uint8ClampedArray,
  '%Uint16Array%': typeof Uint16Array === 'undefined' ? undefined : Uint16Array,
  '%Uint32Array%': typeof Uint32Array === 'undefined' ? undefined : Uint32Array,
  '%URIError%': $URIError,
  '%WeakMap%': typeof WeakMap === 'undefined' ? undefined : WeakMap,
  '%WeakRef%': typeof WeakRef === 'undefined' ? undefined : WeakRef,
  '%WeakSet%': typeof WeakSet === 'undefined' ? undefined : WeakSet,
  '%Function.prototype.call%': $call,
  '%Function.prototype.apply%': $apply,
  '%Object.defineProperty%': $defineProperty,
  '%Object.getPrototypeOf%': $ObjectGPO,
  '%Math.abs%': abs,
  '%Math.floor%': floor,
  '%Math.max%': max,
  '%Math.min%': min,
  '%Math.pow%': pow,
  '%Math.round%': round,
  '%Math.sign%': sign,
  '%Reflect.getPrototypeOf%': $ReflectGPO
};
if (getProto) {
  try {
    null.error;
  } catch (e) {
    var errorProto = getProto(getProto(e));
    INTRINSICS['%Error.prototype%'] = errorProto;
  }
}
var doEval = function doEval(name) {
  var value;
  if (name === '%AsyncFunction%') {
    value = getEvalledConstructor('async function () {}');
  } else if (name === '%GeneratorFunction%') {
    value = getEvalledConstructor('function* () {}');
  } else if (name === '%AsyncGeneratorFunction%') {
    value = getEvalledConstructor('async function* () {}');
  } else if (name === '%AsyncGenerator%') {
    var fn = doEval('%AsyncGeneratorFunction%');
    if (fn) {
      value = fn.prototype;
    }
  } else if (name === '%AsyncIteratorPrototype%') {
    var gen = doEval('%AsyncGenerator%');
    if (gen && getProto) {
      value = getProto(gen.prototype);
    }
  }
  INTRINSICS[name] = value;
  return value;
};
var LEGACY_ALIASES = {
  __proto__: null,
  '%ArrayBufferPrototype%': ['ArrayBuffer', 'prototype'],
  '%ArrayPrototype%': ['Array', 'prototype'],
  '%ArrayProto_entries%': ['Array', 'prototype', 'entries'],
  '%ArrayProto_forEach%': ['Array', 'prototype', 'forEach'],
  '%ArrayProto_keys%': ['Array', 'prototype', 'keys'],
  '%ArrayProto_values%': ['Array', 'prototype', 'values'],
  '%AsyncFunctionPrototype%': ['AsyncFunction', 'prototype'],
  '%AsyncGenerator%': ['AsyncGeneratorFunction', 'prototype'],
  '%AsyncGeneratorPrototype%': ['AsyncGeneratorFunction', 'prototype', 'prototype'],
  '%BooleanPrototype%': ['Boolean', 'prototype'],
  '%DataViewPrototype%': ['DataView', 'prototype'],
  '%DatePrototype%': ['Date', 'prototype'],
  '%ErrorPrototype%': ['Error', 'prototype'],
  '%EvalErrorPrototype%': ['EvalError', 'prototype'],
  '%Float32ArrayPrototype%': ['Float32Array', 'prototype'],
  '%Float64ArrayPrototype%': ['Float64Array', 'prototype'],
  '%FunctionPrototype%': ['Function', 'prototype'],
  '%Generator%': ['GeneratorFunction', 'prototype'],
  '%GeneratorPrototype%': ['GeneratorFunction', 'prototype', 'prototype'],
  '%Int8ArrayPrototype%': ['Int8Array', 'prototype'],
  '%Int16ArrayPrototype%': ['Int16Array', 'prototype'],
  '%Int32ArrayPrototype%': ['Int32Array', 'prototype'],
  '%JSONParse%': ['JSON', 'parse'],
  '%JSONStringify%': ['JSON', 'stringify'],
  '%MapPrototype%': ['Map', 'prototype'],
  '%NumberPrototype%': ['Number', 'prototype'],
  '%ObjectPrototype%': ['Object', 'prototype'],
  '%ObjProto_toString%': ['Object', 'prototype', 'toString'],
  '%ObjProto_valueOf%': ['Object', 'prototype', 'valueOf'],
  '%PromisePrototype%': ['Promise', 'prototype'],
  '%PromiseProto_then%': ['Promise', 'prototype', 'then'],
  '%Promise_all%': ['Promise', 'all'],
  '%Promise_reject%': ['Promise', 'reject'],
  '%Promise_resolve%': ['Promise', 'resolve'],
  '%RangeErrorPrototype%': ['RangeError', 'prototype'],
  '%ReferenceErrorPrototype%': ['ReferenceError', 'prototype'],
  '%RegExpPrototype%': ['RegExp', 'prototype'],
  '%SetPrototype%': ['Set', 'prototype'],
  '%SharedArrayBufferPrototype%': ['SharedArrayBuffer', 'prototype'],
  '%StringPrototype%': ['String', 'prototype'],
  '%SymbolPrototype%': ['Symbol', 'prototype'],
  '%SyntaxErrorPrototype%': ['SyntaxError', 'prototype'],
  '%TypedArrayPrototype%': ['TypedArray', 'prototype'],
  '%TypeErrorPrototype%': ['TypeError', 'prototype'],
  '%Uint8ArrayPrototype%': ['Uint8Array', 'prototype'],
  '%Uint8ClampedArrayPrototype%': ['Uint8ClampedArray', 'prototype'],
  '%Uint16ArrayPrototype%': ['Uint16Array', 'prototype'],
  '%Uint32ArrayPrototype%': ['Uint32Array', 'prototype'],
  '%URIErrorPrototype%': ['URIError', 'prototype'],
  '%WeakMapPrototype%': ['WeakMap', 'prototype'],
  '%WeakSetPrototype%': ['WeakSet', 'prototype']
};
var bind = require('function-bind');
var hasOwn = require('hasown');
var $concat = bind.call($call, Array.prototype.concat);
var $spliceApply = bind.call($apply, Array.prototype.splice);
var $replace = bind.call($call, String.prototype.replace);
var $strSlice = bind.call($call, String.prototype.slice);
var $exec = bind.call($call, RegExp.prototype.exec);
var rePropName = /[^%.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|%$))/g;
var reEscapeChar = /\\(\\)?/g;
var stringToPath = function stringToPath(string) {
  var first = $strSlice(string, 0, 1);
  var last = $strSlice(string, -1);
  if (first === '%' && last !== '%') {
    throw new $SyntaxError('invalid intrinsic syntax, expected closing `%`');
  } else if (last === '%' && first !== '%') {
    throw new $SyntaxError('invalid intrinsic syntax, expected opening `%`');
  }
  var result = [];
  $replace(string, rePropName, function (match, number, quote, subString) {
    result[result.length] = quote ? $replace(subString, reEscapeChar, '$1') : number || match;
  });
  return result;
};
var getBaseIntrinsic = function getBaseIntrinsic(name, allowMissing) {
  var intrinsicName = name;
  var alias;
  if (hasOwn(LEGACY_ALIASES, intrinsicName)) {
    alias = LEGACY_ALIASES[intrinsicName];
    intrinsicName = '%' + alias[0] + '%';
  }
  if (hasOwn(INTRINSICS, intrinsicName)) {
    var value = INTRINSICS[intrinsicName];
    if (value === needsEval) {
      value = doEval(intrinsicName);
    }
    if (typeof value === 'undefined' && !allowMissing) {
      throw new $TypeError('intrinsic ' + name + ' exists, but is not available. Please file an issue!');
    }
    return {
      alias: alias,
      name: intrinsicName,
      value: value
    };
  }
  throw new $SyntaxError('intrinsic ' + name + ' does not exist!');
};
module.exports = function GetIntrinsic(name, allowMissing) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new $TypeError('intrinsic name must be a non-empty string');
  }
  if (arguments.length > 1 && typeof allowMissing !== 'boolean') {
    throw new $TypeError('"allowMissing" argument must be a boolean');
  }
  if ($exec(/^%?[^%]*%?$/, name) === null) {
    throw new $SyntaxError('`%` may not be present anywhere but at the beginning and end of the intrinsic name');
  }
  var parts = stringToPath(name);
  var intrinsicBaseName = parts.length > 0 ? parts[0] : '';
  var intrinsic = getBaseIntrinsic('%' + intrinsicBaseName + '%', allowMissing);
  var intrinsicRealName = intrinsic.name;
  var value = intrinsic.value;
  var skipFurtherCaching = false;
  var alias = intrinsic.alias;
  if (alias) {
    intrinsicBaseName = alias[0];
    $spliceApply(parts, $concat([0, 1], alias));
  }
  for (var i = 1, isOwn = true; i < parts.length; i += 1) {
    var part = parts[i];
    var first = $strSlice(part, 0, 1);
    var last = $strSlice(part, -1);
    if ((first === '"' || first === "'" || first === '`' || last === '"' || last === "'" || last === '`') && first !== last) {
      throw new $SyntaxError('property names with quotes must have matching quotes');
    }
    if (part === 'constructor' || !isOwn) {
      skipFurtherCaching = true;
    }
    intrinsicBaseName += '.' + part;
    intrinsicRealName = '%' + intrinsicBaseName + '%';
    if (hasOwn(INTRINSICS, intrinsicRealName)) {
      value = INTRINSICS[intrinsicRealName];
    } else if (value != null) {
      if (!(part in value)) {
        if (!allowMissing) {
          throw new $TypeError('base intrinsic for ' + name + ' exists, but the property is not available.');
        }
        return void undefined;
      }
      if ($gOPD && i + 1 >= parts.length) {
        var desc = $gOPD(value, part);
        isOwn = !!desc;
        if (isOwn && 'get' in desc && !('originalValue' in desc.get)) {
          value = desc.get;
        } else {
          value = value[part];
        }
      } else {
        isOwn = hasOwn(value, part);
        value = value[part];
      }
      if (isOwn && !skipFurtherCaching) {
        INTRINSICS[intrinsicRealName] = value;
      }
    }
  }
  return value;
};

},{"call-bind-apply-helpers/functionApply":7,"call-bind-apply-helpers/functionCall":8,"es-define-property":16,"es-errors":18,"es-errors/eval":17,"es-errors/range":19,"es-errors/ref":20,"es-errors/syntax":21,"es-errors/type":22,"es-errors/uri":23,"es-object-atoms":24,"function-bind":28,"get-proto":32,"get-proto/Object.getPrototypeOf":30,"get-proto/Reflect.getPrototypeOf":31,"gopd":34,"has-symbols":36,"hasown":39,"math-intrinsics/abs":47,"math-intrinsics/floor":48,"math-intrinsics/max":50,"math-intrinsics/min":51,"math-intrinsics/pow":52,"math-intrinsics/round":53,"math-intrinsics/sign":54}],30:[function(require,module,exports){
'use strict';

var $Object = require('es-object-atoms');
module.exports = $Object.getPrototypeOf || null;

},{"es-object-atoms":24}],31:[function(require,module,exports){
'use strict';
module.exports = typeof Reflect !== 'undefined' && Reflect.getPrototypeOf || null;

},{}],32:[function(require,module,exports){
'use strict';

var reflectGetProto = require('./Reflect.getPrototypeOf');
var originalGetProto = require('./Object.getPrototypeOf');
var getDunderProto = require('dunder-proto/get');
module.exports = reflectGetProto ? function getProto(O) {
  return reflectGetProto(O);
} : originalGetProto ? function getProto(O) {
  if (!O || typeof O !== 'object' && typeof O !== 'function') {
    throw new TypeError('getProto: not an object');
  }
  return originalGetProto(O);
} : getDunderProto ? function getProto(O) {
  return getDunderProto(O);
} : null;

},{"./Object.getPrototypeOf":30,"./Reflect.getPrototypeOf":31,"dunder-proto/get":15}],33:[function(require,module,exports){
'use strict';
module.exports = Object.getOwnPropertyDescriptor;

},{}],34:[function(require,module,exports){
'use strict';
var $gOPD = require('./gOPD');
if ($gOPD) {
  try {
    $gOPD([], 'length');
  } catch (e) {
    $gOPD = null;
  }
}
module.exports = $gOPD;

},{"./gOPD":33}],35:[function(require,module,exports){
'use strict';

var $defineProperty = require('es-define-property');
var hasPropertyDescriptors = function hasPropertyDescriptors() {
  return !!$defineProperty;
};
hasPropertyDescriptors.hasArrayLengthDefineBug = function hasArrayLengthDefineBug() {
  if (!$defineProperty) {
    return null;
  }
  try {
    return $defineProperty([], 'length', {
      value: 1
    }).length !== 1;
  } catch (e) {
    return true;
  }
};
module.exports = hasPropertyDescriptors;

},{"es-define-property":16}],36:[function(require,module,exports){
'use strict';

var origSymbol = typeof Symbol !== 'undefined' && Symbol;
var hasSymbolSham = require('./shams');
module.exports = function hasNativeSymbols() {
  if (typeof origSymbol !== 'function') {
    return false;
  }
  if (typeof Symbol !== 'function') {
    return false;
  }
  if (typeof origSymbol('foo') !== 'symbol') {
    return false;
  }
  if (typeof Symbol('bar') !== 'symbol') {
    return false;
  }
  return hasSymbolSham();
};

},{"./shams":37}],37:[function(require,module,exports){
'use strict';
module.exports = function hasSymbols() {
  if (typeof Symbol !== 'function' || typeof Object.getOwnPropertySymbols !== 'function') {
    return false;
  }
  if (typeof Symbol.iterator === 'symbol') {
    return true;
  }
  var obj = {};
  var sym = Symbol('test');
  var symObj = Object(sym);
  if (typeof sym === 'string') {
    return false;
  }
  if (Object.prototype.toString.call(sym) !== '[object Symbol]') {
    return false;
  }
  if (Object.prototype.toString.call(symObj) !== '[object Symbol]') {
    return false;
  }
  var symVal = 42;
  obj[sym] = symVal;
  for (var _ in obj) {
    return false;
  }
  if (typeof Object.keys === 'function' && Object.keys(obj).length !== 0) {
    return false;
  }
  if (typeof Object.getOwnPropertyNames === 'function' && Object.getOwnPropertyNames(obj).length !== 0) {
    return false;
  }
  var syms = Object.getOwnPropertySymbols(obj);
  if (syms.length !== 1 || syms[0] !== sym) {
    return false;
  }
  if (!Object.prototype.propertyIsEnumerable.call(obj, sym)) {
    return false;
  }
  if (typeof Object.getOwnPropertyDescriptor === 'function') {
    var descriptor = Object.getOwnPropertyDescriptor(obj, sym);
    if (descriptor.value !== symVal || descriptor.enumerable !== true) {
      return false;
    }
  }
  return true;
};

},{}],38:[function(require,module,exports){
'use strict';

var hasSymbols = require('has-symbols/shams');
module.exports = function hasToStringTagShams() {
  return hasSymbols() && !!Symbol.toStringTag;
};

},{"has-symbols/shams":37}],39:[function(require,module,exports){
'use strict';

var call = Function.prototype.call;
var $hasOwn = Object.prototype.hasOwnProperty;
var bind = require('function-bind');
module.exports = bind.call(call, $hasOwn);

},{"function-bind":28}],40:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m;
  var eLen = nBytes * 8 - mLen - 1;
  var eMax = (1 << eLen) - 1;
  var eBias = eMax >> 1;
  var nBits = -7;
  var i = isLE ? nBytes - 1 : 0;
  var d = isLE ? -1 : 1;
  var s = buffer[offset + i];
  i += d;
  e = s & (1 << -nBits) - 1;
  s >>= -nBits;
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}
  m = e & (1 << -nBits) - 1;
  e >>= -nBits;
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}
  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : (s ? -1 : 1) * Infinity;
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};
exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c;
  var eLen = nBytes * 8 - mLen - 1;
  var eMax = (1 << eLen) - 1;
  var eBias = eMax >> 1;
  var rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
  var i = isLE ? 0 : nBytes - 1;
  var d = isLE ? 1 : -1;
  var s = value < 0 || value === 0 && 1 / value < 0 ? 1 : 0;
  value = Math.abs(value);
  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }
    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }
  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}
  e = e << mLen | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}
  buffer[offset + i - d] |= s * 128;
};

},{}],41:[function(require,module,exports){
if (typeof Object.create === 'function') {
  module.exports = function inherits(ctor, superCtor) {
    if (superCtor) {
      ctor.super_ = superCtor;
      ctor.prototype = Object.create(superCtor.prototype, {
        constructor: {
          value: ctor,
          enumerable: false,
          writable: true,
          configurable: true
        }
      });
    }
  };
} else {
  module.exports = function inherits(ctor, superCtor) {
    if (superCtor) {
      ctor.super_ = superCtor;
      var TempCtor = function () {};
      TempCtor.prototype = superCtor.prototype;
      ctor.prototype = new TempCtor();
      ctor.prototype.constructor = ctor;
    }
  };
}

},{}],42:[function(require,module,exports){
'use strict';

var hasToStringTag = require('has-tostringtag/shams')();
var callBound = require('call-bound');
var $toString = callBound('Object.prototype.toString');
var isStandardArguments = function isArguments(value) {
  if (hasToStringTag && value && typeof value === 'object' && Symbol.toStringTag in value) {
    return false;
  }
  return $toString(value) === '[object Arguments]';
};
var isLegacyArguments = function isArguments(value) {
  if (isStandardArguments(value)) {
    return true;
  }
  return value !== null && typeof value === 'object' && 'length' in value && typeof value.length === 'number' && value.length >= 0 && $toString(value) !== '[object Array]' && 'callee' in value && $toString(value.callee) === '[object Function]';
};
var supportsStandardArguments = function () {
  return isStandardArguments(arguments);
}();
isStandardArguments.isLegacyArguments = isLegacyArguments;
module.exports = supportsStandardArguments ? isStandardArguments : isLegacyArguments;

},{"call-bound":12,"has-tostringtag/shams":38}],43:[function(require,module,exports){
'use strict';

var fnToStr = Function.prototype.toString;
var reflectApply = typeof Reflect === 'object' && Reflect !== null && Reflect.apply;
var badArrayLike;
var isCallableMarker;
if (typeof reflectApply === 'function' && typeof Object.defineProperty === 'function') {
  try {
    badArrayLike = Object.defineProperty({}, 'length', {
      get: function () {
        throw isCallableMarker;
      }
    });
    isCallableMarker = {};
    reflectApply(function () {
      throw 42;
    }, null, badArrayLike);
  } catch (_) {
    if (_ !== isCallableMarker) {
      reflectApply = null;
    }
  }
} else {
  reflectApply = null;
}
var constructorRegex = /^\s*class\b/;
var isES6ClassFn = function isES6ClassFunction(value) {
  try {
    var fnStr = fnToStr.call(value);
    return constructorRegex.test(fnStr);
  } catch (e) {
    return false;
  }
};
var tryFunctionObject = function tryFunctionToStr(value) {
  try {
    if (isES6ClassFn(value)) {
      return false;
    }
    fnToStr.call(value);
    return true;
  } catch (e) {
    return false;
  }
};
var toStr = Object.prototype.toString;
var objectClass = '[object Object]';
var fnClass = '[object Function]';
var genClass = '[object GeneratorFunction]';
var ddaClass = '[object HTMLAllCollection]';
var ddaClass2 = '[object HTML document.all class]';
var ddaClass3 = '[object HTMLCollection]';
var hasToStringTag = typeof Symbol === 'function' && !!Symbol.toStringTag;
var isIE68 = !(0 in [,]);
var isDDA = function isDocumentDotAll() {
  return false;
};
if (typeof document === 'object') {
  var all = document.all;
  if (toStr.call(all) === toStr.call(document.all)) {
    isDDA = function isDocumentDotAll(value) {
      if ((isIE68 || !value) && (typeof value === 'undefined' || typeof value === 'object')) {
        try {
          var str = toStr.call(value);
          return (str === ddaClass || str === ddaClass2 || str === ddaClass3 || str === objectClass) && value('') == null;
        } catch (e) {}
      }
      return false;
    };
  }
}
module.exports = reflectApply ? function isCallable(value) {
  if (isDDA(value)) {
    return true;
  }
  if (!value) {
    return false;
  }
  if (typeof value !== 'function' && typeof value !== 'object') {
    return false;
  }
  try {
    reflectApply(value, null, badArrayLike);
  } catch (e) {
    if (e !== isCallableMarker) {
      return false;
    }
  }
  return !isES6ClassFn(value) && tryFunctionObject(value);
} : function isCallable(value) {
  if (isDDA(value)) {
    return true;
  }
  if (!value) {
    return false;
  }
  if (typeof value !== 'function' && typeof value !== 'object') {
    return false;
  }
  if (hasToStringTag) {
    return tryFunctionObject(value);
  }
  if (isES6ClassFn(value)) {
    return false;
  }
  var strClass = toStr.call(value);
  if (strClass !== fnClass && strClass !== genClass && !/^\[object HTML/.test(strClass)) {
    return false;
  }
  return tryFunctionObject(value);
};

},{}],44:[function(require,module,exports){
'use strict';

var callBound = require('call-bound');
var safeRegexTest = require('safe-regex-test');
var isFnRegex = safeRegexTest(/^\s*(?:function)?\*/);
var hasToStringTag = require('has-tostringtag/shams')();
var getProto = require('get-proto');
var toStr = callBound('Object.prototype.toString');
var fnToStr = callBound('Function.prototype.toString');
var getGeneratorFunc = function () {
  if (!hasToStringTag) {
    return false;
  }
  try {
    return Function('return function*() {}')();
  } catch (e) {}
};
var GeneratorFunction;
module.exports = function isGeneratorFunction(fn) {
  if (typeof fn !== 'function') {
    return false;
  }
  if (isFnRegex(fnToStr(fn))) {
    return true;
  }
  if (!hasToStringTag) {
    var str = toStr(fn);
    return str === '[object GeneratorFunction]';
  }
  if (!getProto) {
    return false;
  }
  if (typeof GeneratorFunction === 'undefined') {
    var generatorFunc = getGeneratorFunc();
    GeneratorFunction = generatorFunc ? (getProto(generatorFunc)) : false;
  }
  return getProto(fn) === GeneratorFunction;
};

},{"call-bound":12,"get-proto":32,"has-tostringtag/shams":38,"safe-regex-test":63}],45:[function(require,module,exports){
'use strict';

var callBound = require('call-bound');
var hasToStringTag = require('has-tostringtag/shams')();
var hasOwn = require('hasown');
var gOPD = require('gopd');
var fn;
if (hasToStringTag) {
  var $exec = callBound('RegExp.prototype.exec');
  var isRegexMarker = {};
  var throwRegexMarker = function () {
    throw isRegexMarker;
  };
  var badStringifier = {
    toString: throwRegexMarker,
    valueOf: throwRegexMarker
  };
  if (typeof Symbol.toPrimitive === 'symbol') {
    badStringifier[Symbol.toPrimitive] = throwRegexMarker;
  }
  fn = function isRegex(value) {
    if (!value || typeof value !== 'object') {
      return false;
    }
    var descriptor = gOPD(value, 'lastIndex');
    var hasLastIndexDataProperty = descriptor && hasOwn(descriptor, 'value');
    if (!hasLastIndexDataProperty) {
      return false;
    }
    try {
      $exec(value, badStringifier);
    } catch (e) {
      return e === isRegexMarker;
    }
  };
} else {
  var $toString = callBound('Object.prototype.toString');
  var regexClass = '[object RegExp]';
  fn = function isRegex(value) {
    if (!value || typeof value !== 'object' && typeof value !== 'function') {
      return false;
    }
    return $toString(value) === regexClass;
  };
}
module.exports = fn;

},{"call-bound":12,"gopd":34,"has-tostringtag/shams":38,"hasown":39}],46:[function(require,module,exports){
'use strict';

var whichTypedArray = require('which-typed-array');
module.exports = function isTypedArray(value) {
  return !!whichTypedArray(value);
};

},{"which-typed-array":72}],47:[function(require,module,exports){
'use strict';
module.exports = Math.abs;

},{}],48:[function(require,module,exports){
'use strict';
module.exports = Math.floor;

},{}],49:[function(require,module,exports){
'use strict';
module.exports = Number.isNaN || function isNaN(a) {
  return a !== a;
};

},{}],50:[function(require,module,exports){
'use strict';
module.exports = Math.max;

},{}],51:[function(require,module,exports){
'use strict';
module.exports = Math.min;

},{}],52:[function(require,module,exports){
'use strict';
module.exports = Math.pow;

},{}],53:[function(require,module,exports){
'use strict';
module.exports = Math.round;

},{}],54:[function(require,module,exports){
'use strict';

var $isNaN = require('./isNaN');
module.exports = function sign(number) {
  if ($isNaN(number) || number === 0) {
    return number;
  }
  return number < 0 ? -1 : +1;
};

},{"./isNaN":49}],55:[function(require,module,exports){
(function (global){(function (){
var hasMap = typeof Map === 'function' && Map.prototype;
var mapSizeDescriptor = Object.getOwnPropertyDescriptor && hasMap ? Object.getOwnPropertyDescriptor(Map.prototype, 'size') : null;
var mapSize = hasMap && mapSizeDescriptor && typeof mapSizeDescriptor.get === 'function' ? mapSizeDescriptor.get : null;
var mapForEach = hasMap && Map.prototype.forEach;
var hasSet = typeof Set === 'function' && Set.prototype;
var setSizeDescriptor = Object.getOwnPropertyDescriptor && hasSet ? Object.getOwnPropertyDescriptor(Set.prototype, 'size') : null;
var setSize = hasSet && setSizeDescriptor && typeof setSizeDescriptor.get === 'function' ? setSizeDescriptor.get : null;
var setForEach = hasSet && Set.prototype.forEach;
var hasWeakMap = typeof WeakMap === 'function' && WeakMap.prototype;
var weakMapHas = hasWeakMap ? WeakMap.prototype.has : null;
var hasWeakSet = typeof WeakSet === 'function' && WeakSet.prototype;
var weakSetHas = hasWeakSet ? WeakSet.prototype.has : null;
var hasWeakRef = typeof WeakRef === 'function' && WeakRef.prototype;
var weakRefDeref = hasWeakRef ? WeakRef.prototype.deref : null;
var booleanValueOf = Boolean.prototype.valueOf;
var objectToString = Object.prototype.toString;
var functionToString = Function.prototype.toString;
var $match = String.prototype.match;
var $slice = String.prototype.slice;
var $replace = String.prototype.replace;
var $toUpperCase = String.prototype.toUpperCase;
var $toLowerCase = String.prototype.toLowerCase;
var $test = RegExp.prototype.test;
var $concat = Array.prototype.concat;
var $join = Array.prototype.join;
var $arrSlice = Array.prototype.slice;
var $floor = Math.floor;
var bigIntValueOf = typeof BigInt === 'function' ? BigInt.prototype.valueOf : null;
var gOPS = Object.getOwnPropertySymbols;
var symToString = typeof Symbol === 'function' && typeof Symbol.iterator === 'symbol' ? Symbol.prototype.toString : null;
var hasShammedSymbols = typeof Symbol === 'function' && typeof Symbol.iterator === 'object';
var toStringTag = typeof Symbol === 'function' && Symbol.toStringTag && (typeof Symbol.toStringTag === hasShammedSymbols ? 'object' : 'symbol') ? Symbol.toStringTag : null;
var isEnumerable = Object.prototype.propertyIsEnumerable;
var gPO = (typeof Reflect === 'function' ? Reflect.getPrototypeOf : Object.getPrototypeOf) || ([].__proto__ === Array.prototype ? function (O) {
  return O.__proto__;
} : null);
function addNumericSeparator(num, str) {
  if (num === Infinity || num === -Infinity || num !== num || num && num > -1000 && num < 1000 || $test.call(/e/, str)) {
    return str;
  }
  var sepRegex = /[0-9](?=(?:[0-9]{3})+(?![0-9]))/g;
  if (typeof num === 'number') {
    var int = num < 0 ? -$floor(-num) : $floor(num);
    if (int !== num) {
      var intStr = String(int);
      var dec = $slice.call(str, intStr.length + 1);
      return $replace.call(intStr, sepRegex, '$&_') + '.' + $replace.call($replace.call(dec, /([0-9]{3})/g, '$&_'), /_$/, '');
    }
  }
  return $replace.call(str, sepRegex, '$&_');
}
var utilInspect = require('./util.inspect');
var inspectCustom = utilInspect.custom;
var inspectSymbol = isSymbol(inspectCustom) ? inspectCustom : null;
var quotes = {
  __proto__: null,
  'double': '"',
  single: "'"
};
var quoteREs = {
  __proto__: null,
  'double': /(["\\])/g,
  single: /(['\\])/g
};
module.exports = function inspect_(obj, options, depth, seen) {
  var opts = options || {};
  if (has(opts, 'quoteStyle') && !has(quotes, opts.quoteStyle)) {
    throw new TypeError('option "quoteStyle" must be "single" or "double"');
  }
  if (has(opts, 'maxStringLength') && (typeof opts.maxStringLength === 'number' ? opts.maxStringLength < 0 && opts.maxStringLength !== Infinity : opts.maxStringLength !== null)) {
    throw new TypeError('option "maxStringLength", if provided, must be a positive integer, Infinity, or `null`');
  }
  var customInspect = has(opts, 'customInspect') ? opts.customInspect : true;
  if (typeof customInspect !== 'boolean' && customInspect !== 'symbol') {
    throw new TypeError('option "customInspect", if provided, must be `true`, `false`, or `\'symbol\'`');
  }
  if (has(opts, 'indent') && opts.indent !== null && opts.indent !== '\t' && !(parseInt(opts.indent, 10) === opts.indent && opts.indent > 0)) {
    throw new TypeError('option "indent" must be "\\t", an integer > 0, or `null`');
  }
  if (has(opts, 'numericSeparator') && typeof opts.numericSeparator !== 'boolean') {
    throw new TypeError('option "numericSeparator", if provided, must be `true` or `false`');
  }
  var numericSeparator = opts.numericSeparator;
  if (typeof obj === 'undefined') {
    return 'undefined';
  }
  if (obj === null) {
    return 'null';
  }
  if (typeof obj === 'boolean') {
    return obj ? 'true' : 'false';
  }
  if (typeof obj === 'string') {
    return inspectString(obj, opts);
  }
  if (typeof obj === 'number') {
    if (obj === 0) {
      return Infinity / obj > 0 ? '0' : '-0';
    }
    var str = String(obj);
    return numericSeparator ? addNumericSeparator(obj, str) : str;
  }
  if (typeof obj === 'bigint') {
    var bigIntStr = String(obj) + 'n';
    return numericSeparator ? addNumericSeparator(obj, bigIntStr) : bigIntStr;
  }
  var maxDepth = typeof opts.depth === 'undefined' ? 5 : opts.depth;
  if (typeof depth === 'undefined') {
    depth = 0;
  }
  if (depth >= maxDepth && maxDepth > 0 && typeof obj === 'object') {
    return isArray(obj) ? '[Array]' : '[Object]';
  }
  var indent = getIndent(opts, depth);
  if (typeof seen === 'undefined') {
    seen = [];
  } else if (indexOf(seen, obj) >= 0) {
    return '[Circular]';
  }
  function inspect(value, from, noIndent) {
    if (from) {
      seen = $arrSlice.call(seen);
      seen.push(from);
    }
    if (noIndent) {
      var newOpts = {
        depth: opts.depth
      };
      if (has(opts, 'quoteStyle')) {
        newOpts.quoteStyle = opts.quoteStyle;
      }
      return inspect_(value, newOpts, depth + 1, seen);
    }
    return inspect_(value, opts, depth + 1, seen);
  }
  if (typeof obj === 'function' && !isRegExp(obj)) {
    var name = nameOf(obj);
    var keys = arrObjKeys(obj, inspect);
    return '[Function' + (name ? ': ' + name : ' (anonymous)') + ']' + (keys.length > 0 ? ' { ' + $join.call(keys, ', ') + ' }' : '');
  }
  if (isSymbol(obj)) {
    var symString = hasShammedSymbols ? $replace.call(String(obj), /^(Symbol\(.*\))_[^)]*$/, '$1') : symToString.call(obj);
    return typeof obj === 'object' && !hasShammedSymbols ? markBoxed(symString) : symString;
  }
  if (isElement(obj)) {
    var s = '<' + $toLowerCase.call(String(obj.nodeName));
    var attrs = obj.attributes || [];
    for (var i = 0; i < attrs.length; i++) {
      s += ' ' + attrs[i].name + '=' + wrapQuotes(quote(attrs[i].value), 'double', opts);
    }
    s += '>';
    if (obj.childNodes && obj.childNodes.length) {
      s += '...';
    }
    s += '</' + $toLowerCase.call(String(obj.nodeName)) + '>';
    return s;
  }
  if (isArray(obj)) {
    if (obj.length === 0) {
      return '[]';
    }
    var xs = arrObjKeys(obj, inspect);
    if (indent && !singleLineValues(xs)) {
      return '[' + indentedJoin(xs, indent) + ']';
    }
    return '[ ' + $join.call(xs, ', ') + ' ]';
  }
  if (isError(obj)) {
    var parts = arrObjKeys(obj, inspect);
    if (!('cause' in Error.prototype) && 'cause' in obj && !isEnumerable.call(obj, 'cause')) {
      return '{ [' + String(obj) + '] ' + $join.call($concat.call('[cause]: ' + inspect(obj.cause), parts), ', ') + ' }';
    }
    if (parts.length === 0) {
      return '[' + String(obj) + ']';
    }
    return '{ [' + String(obj) + '] ' + $join.call(parts, ', ') + ' }';
  }
  if (typeof obj === 'object' && customInspect) {
    if (inspectSymbol && typeof obj[inspectSymbol] === 'function' && utilInspect) {
      return utilInspect(obj, {
        depth: maxDepth - depth
      });
    } else if (customInspect !== 'symbol' && typeof obj.inspect === 'function') {
      return obj.inspect();
    }
  }
  if (isMap(obj)) {
    var mapParts = [];
    if (mapForEach) {
      mapForEach.call(obj, function (value, key) {
        mapParts.push(inspect(key, obj, true) + ' => ' + inspect(value, obj));
      });
    }
    return collectionOf('Map', mapSize.call(obj), mapParts, indent);
  }
  if (isSet(obj)) {
    var setParts = [];
    if (setForEach) {
      setForEach.call(obj, function (value) {
        setParts.push(inspect(value, obj));
      });
    }
    return collectionOf('Set', setSize.call(obj), setParts, indent);
  }
  if (isWeakMap(obj)) {
    return weakCollectionOf('WeakMap');
  }
  if (isWeakSet(obj)) {
    return weakCollectionOf('WeakSet');
  }
  if (isWeakRef(obj)) {
    return weakCollectionOf('WeakRef');
  }
  if (isNumber(obj)) {
    return markBoxed(inspect(Number(obj)));
  }
  if (isBigInt(obj)) {
    return markBoxed(inspect(bigIntValueOf.call(obj)));
  }
  if (isBoolean(obj)) {
    return markBoxed(booleanValueOf.call(obj));
  }
  if (isString(obj)) {
    return markBoxed(inspect(String(obj)));
  }
  if (typeof window !== 'undefined' && obj === window) {
    return '{ [object Window] }';
  }
  if (typeof globalThis !== 'undefined' && obj === globalThis || typeof global !== 'undefined' && obj === global) {
    return '{ [object globalThis] }';
  }
  if (!isDate(obj) && !isRegExp(obj)) {
    var ys = arrObjKeys(obj, inspect);
    var isPlainObject = gPO ? gPO(obj) === Object.prototype : obj instanceof Object || obj.constructor === Object;
    var protoTag = obj instanceof Object ? '' : 'null prototype';
    var stringTag = !isPlainObject && toStringTag && Object(obj) === obj && toStringTag in obj ? $slice.call(toStr(obj), 8, -1) : protoTag ? 'Object' : '';
    var constructorTag = isPlainObject || typeof obj.constructor !== 'function' ? '' : obj.constructor.name ? obj.constructor.name + ' ' : '';
    var tag = constructorTag + (stringTag || protoTag ? '[' + $join.call($concat.call([], stringTag || [], protoTag || []), ': ') + '] ' : '');
    if (ys.length === 0) {
      return tag + '{}';
    }
    if (indent) {
      return tag + '{' + indentedJoin(ys, indent) + '}';
    }
    return tag + '{ ' + $join.call(ys, ', ') + ' }';
  }
  return String(obj);
};
function wrapQuotes(s, defaultStyle, opts) {
  var style = opts.quoteStyle || defaultStyle;
  var quoteChar = quotes[style];
  return quoteChar + s + quoteChar;
}
function quote(s) {
  return $replace.call(String(s), /"/g, '&quot;');
}
function canTrustToString(obj) {
  return !toStringTag || !(typeof obj === 'object' && (toStringTag in obj || typeof obj[toStringTag] !== 'undefined'));
}
function isArray(obj) {
  return toStr(obj) === '[object Array]' && canTrustToString(obj);
}
function isDate(obj) {
  return toStr(obj) === '[object Date]' && canTrustToString(obj);
}
function isRegExp(obj) {
  return toStr(obj) === '[object RegExp]' && canTrustToString(obj);
}
function isError(obj) {
  return toStr(obj) === '[object Error]' && canTrustToString(obj);
}
function isString(obj) {
  return toStr(obj) === '[object String]' && canTrustToString(obj);
}
function isNumber(obj) {
  return toStr(obj) === '[object Number]' && canTrustToString(obj);
}
function isBoolean(obj) {
  return toStr(obj) === '[object Boolean]' && canTrustToString(obj);
}
function isSymbol(obj) {
  if (hasShammedSymbols) {
    return obj && typeof obj === 'object' && obj instanceof Symbol;
  }
  if (typeof obj === 'symbol') {
    return true;
  }
  if (!obj || typeof obj !== 'object' || !symToString) {
    return false;
  }
  try {
    symToString.call(obj);
    return true;
  } catch (e) {}
  return false;
}
function isBigInt(obj) {
  if (!obj || typeof obj !== 'object' || !bigIntValueOf) {
    return false;
  }
  try {
    bigIntValueOf.call(obj);
    return true;
  } catch (e) {}
  return false;
}
var hasOwn = Object.prototype.hasOwnProperty || function (key) {
  return key in this;
};
function has(obj, key) {
  return hasOwn.call(obj, key);
}
function toStr(obj) {
  return objectToString.call(obj);
}
function nameOf(f) {
  if (f.name) {
    return f.name;
  }
  var m = $match.call(functionToString.call(f), /^function\s*([\w$]+)/);
  if (m) {
    return m[1];
  }
  return null;
}
function indexOf(xs, x) {
  if (xs.indexOf) {
    return xs.indexOf(x);
  }
  for (var i = 0, l = xs.length; i < l; i++) {
    if (xs[i] === x) {
      return i;
    }
  }
  return -1;
}
function isMap(x) {
  if (!mapSize || !x || typeof x !== 'object') {
    return false;
  }
  try {
    mapSize.call(x);
    try {
      setSize.call(x);
    } catch (s) {
      return true;
    }
    return x instanceof Map;
  } catch (e) {}
  return false;
}
function isWeakMap(x) {
  if (!weakMapHas || !x || typeof x !== 'object') {
    return false;
  }
  try {
    weakMapHas.call(x, weakMapHas);
    try {
      weakSetHas.call(x, weakSetHas);
    } catch (s) {
      return true;
    }
    return x instanceof WeakMap;
  } catch (e) {}
  return false;
}
function isWeakRef(x) {
  if (!weakRefDeref || !x || typeof x !== 'object') {
    return false;
  }
  try {
    weakRefDeref.call(x);
    return true;
  } catch (e) {}
  return false;
}
function isSet(x) {
  if (!setSize || !x || typeof x !== 'object') {
    return false;
  }
  try {
    setSize.call(x);
    try {
      mapSize.call(x);
    } catch (m) {
      return true;
    }
    return x instanceof Set;
  } catch (e) {}
  return false;
}
function isWeakSet(x) {
  if (!weakSetHas || !x || typeof x !== 'object') {
    return false;
  }
  try {
    weakSetHas.call(x, weakSetHas);
    try {
      weakMapHas.call(x, weakMapHas);
    } catch (s) {
      return true;
    }
    return x instanceof WeakSet;
  } catch (e) {}
  return false;
}
function isElement(x) {
  if (!x || typeof x !== 'object') {
    return false;
  }
  if (typeof HTMLElement !== 'undefined' && x instanceof HTMLElement) {
    return true;
  }
  return typeof x.nodeName === 'string' && typeof x.getAttribute === 'function';
}
function inspectString(str, opts) {
  if (str.length > opts.maxStringLength) {
    var remaining = str.length - opts.maxStringLength;
    var trailer = '... ' + remaining + ' more character' + (remaining > 1 ? 's' : '');
    return inspectString($slice.call(str, 0, opts.maxStringLength), opts) + trailer;
  }
  var quoteRE = quoteREs[opts.quoteStyle || 'single'];
  quoteRE.lastIndex = 0;
  var s = $replace.call($replace.call(str, quoteRE, '\\$1'), /[\x00-\x1f]/g, lowbyte);
  return wrapQuotes(s, 'single', opts);
}
function lowbyte(c) {
  var n = c.charCodeAt(0);
  var x = {
    8: 'b',
    9: 't',
    10: 'n',
    12: 'f',
    13: 'r'
  }[n];
  if (x) {
    return '\\' + x;
  }
  return '\\x' + (n < 0x10 ? '0' : '') + $toUpperCase.call(n.toString(16));
}
function markBoxed(str) {
  return 'Object(' + str + ')';
}
function weakCollectionOf(type) {
  return type + ' { ? }';
}
function collectionOf(type, size, entries, indent) {
  var joinedEntries = indent ? indentedJoin(entries, indent) : $join.call(entries, ', ');
  return type + ' (' + size + ') {' + joinedEntries + '}';
}
function singleLineValues(xs) {
  for (var i = 0; i < xs.length; i++) {
    if (indexOf(xs[i], '\n') >= 0) {
      return false;
    }
  }
  return true;
}
function getIndent(opts, depth) {
  var baseIndent;
  if (opts.indent === '\t') {
    baseIndent = '\t';
  } else if (typeof opts.indent === 'number' && opts.indent > 0) {
    baseIndent = $join.call(Array(opts.indent + 1), ' ');
  } else {
    return null;
  }
  return {
    base: baseIndent,
    prev: $join.call(Array(depth + 1), baseIndent)
  };
}
function indentedJoin(xs, indent) {
  if (xs.length === 0) {
    return '';
  }
  var lineJoiner = '\n' + indent.prev + indent.base;
  return lineJoiner + $join.call(xs, ',' + lineJoiner) + '\n' + indent.prev;
}
function arrObjKeys(obj, inspect) {
  var isArr = isArray(obj);
  var xs = [];
  if (isArr) {
    xs.length = obj.length;
    for (var i = 0; i < obj.length; i++) {
      xs[i] = has(obj, i) ? inspect(obj[i], obj) : '';
    }
  }
  var syms = typeof gOPS === 'function' ? gOPS(obj) : [];
  var symMap;
  if (hasShammedSymbols) {
    symMap = {};
    for (var k = 0; k < syms.length; k++) {
      symMap['$' + syms[k]] = syms[k];
    }
  }
  for (var key in obj) {
    if (!has(obj, key)) {
      continue;
    }
    if (isArr && String(Number(key)) === key && key < obj.length) {
      continue;
    }
    if (hasShammedSymbols && symMap['$' + key] instanceof Symbol) {
      continue;
    } else if ($test.call(/[^\w$]/, key)) {
      xs.push(inspect(key, obj) + ': ' + inspect(obj[key], obj));
    } else {
      xs.push(key + ': ' + inspect(obj[key], obj));
    }
  }
  if (typeof gOPS === 'function') {
    for (var j = 0; j < syms.length; j++) {
      if (isEnumerable.call(obj, syms[j])) {
        xs.push('[' + inspect(syms[j]) + ']: ' + inspect(obj[syms[j]], obj));
      }
    }
  }
  return xs;
}

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./util.inspect":3}],56:[function(require,module,exports){
'use strict';
module.exports = ['Float16Array', 'Float32Array', 'Float64Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'BigInt64Array', 'BigUint64Array'];

},{}],57:[function(require,module,exports){
var process = module.exports = {};
var cachedSetTimeout;
var cachedClearTimeout;
function defaultSetTimout() {
  throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout() {
  throw new Error('clearTimeout has not been defined');
}
(function () {
  try {
    if (typeof setTimeout === 'function') {
      cachedSetTimeout = setTimeout;
    } else {
      cachedSetTimeout = defaultSetTimout;
    }
  } catch (e) {
    cachedSetTimeout = defaultSetTimout;
  }
  try {
    if (typeof clearTimeout === 'function') {
      cachedClearTimeout = clearTimeout;
    } else {
      cachedClearTimeout = defaultClearTimeout;
    }
  } catch (e) {
    cachedClearTimeout = defaultClearTimeout;
  }
})();
function runTimeout(fun) {
  if (cachedSetTimeout === setTimeout) {
    return setTimeout(fun, 0);
  }
  if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
    cachedSetTimeout = setTimeout;
    return setTimeout(fun, 0);
  }
  try {
    return cachedSetTimeout(fun, 0);
  } catch (e) {
    try {
      return cachedSetTimeout.call(null, fun, 0);
    } catch (e) {
      return cachedSetTimeout.call(this, fun, 0);
    }
  }
}
function runClearTimeout(marker) {
  if (cachedClearTimeout === clearTimeout) {
    return clearTimeout(marker);
  }
  if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
    cachedClearTimeout = clearTimeout;
    return clearTimeout(marker);
  }
  try {
    return cachedClearTimeout(marker);
  } catch (e) {
    try {
      return cachedClearTimeout.call(null, marker);
    } catch (e) {
      return cachedClearTimeout.call(this, marker);
    }
  }
}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;
function cleanUpNextTick() {
  if (!draining || !currentQueue) {
    return;
  }
  draining = false;
  if (currentQueue.length) {
    queue = currentQueue.concat(queue);
  } else {
    queueIndex = -1;
  }
  if (queue.length) {
    drainQueue();
  }
}
function drainQueue() {
  if (draining) {
    return;
  }
  var timeout = runTimeout(cleanUpNextTick);
  draining = true;
  var len = queue.length;
  while (len) {
    currentQueue = queue;
    queue = [];
    while (++queueIndex < len) {
      if (currentQueue) {
        currentQueue[queueIndex].run();
      }
    }
    queueIndex = -1;
    len = queue.length;
  }
  currentQueue = null;
  draining = false;
  runClearTimeout(timeout);
}
process.nextTick = function (fun) {
  var args = new Array(arguments.length - 1);
  if (arguments.length > 1) {
    for (var i = 1; i < arguments.length; i++) {
      args[i - 1] = arguments[i];
    }
  }
  queue.push(new Item(fun, args));
  if (queue.length === 1 && !draining) {
    runTimeout(drainQueue);
  }
};
function Item(fun, array) {
  this.fun = fun;
  this.array = array;
}
Item.prototype.run = function () {
  this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = '';
process.versions = {};
function noop() {}
process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;
process.listeners = function (name) {
  return [];
};
process.binding = function (name) {
  throw new Error('process.binding is not supported');
};
process.cwd = function () {
  return '/';
};
process.chdir = function (dir) {
  throw new Error('process.chdir is not supported');
};
process.umask = function () {
  return 0;
};

},{}],58:[function(require,module,exports){
'use strict';

var replace = String.prototype.replace;
var percentTwenties = /%20/g;
var Format = {
  RFC1738: 'RFC1738',
  RFC3986: 'RFC3986'
};
module.exports = {
  'default': Format.RFC3986,
  formatters: {
    RFC1738: function (value) {
      return replace.call(value, percentTwenties, '+');
    },
    RFC3986: function (value) {
      return String(value);
    }
  },
  RFC1738: Format.RFC1738,
  RFC3986: Format.RFC3986
};

},{}],59:[function(require,module,exports){
'use strict';

var stringify = require('./stringify');
var parse = require('./parse');
var formats = require('./formats');
module.exports = {
  formats: formats,
  parse: parse,
  stringify: stringify
};

},{"./formats":58,"./parse":60,"./stringify":61}],60:[function(require,module,exports){
'use strict';

var utils = require('./utils');
var has = Object.prototype.hasOwnProperty;
var isArray = Array.isArray;
var defaults = {
  allowDots: false,
  allowEmptyArrays: false,
  allowPrototypes: false,
  allowSparse: false,
  arrayLimit: 20,
  charset: 'utf-8',
  charsetSentinel: false,
  comma: false,
  decodeDotInKeys: false,
  decoder: utils.decode,
  delimiter: '&',
  depth: 5,
  duplicates: 'combine',
  ignoreQueryPrefix: false,
  interpretNumericEntities: false,
  parameterLimit: 1000,
  parseArrays: true,
  plainObjects: false,
  strictDepth: false,
  strictNullHandling: false,
  throwOnLimitExceeded: false
};
var interpretNumericEntities = function (str) {
  return str.replace(/&#(\d+);/g, function ($0, numberStr) {
    return String.fromCharCode(parseInt(numberStr, 10));
  });
};
var parseArrayValue = function (val, options, currentArrayLength) {
  if (val && typeof val === 'string' && options.comma && val.indexOf(',') > -1) {
    return val.split(',');
  }
  if (options.throwOnLimitExceeded && currentArrayLength >= options.arrayLimit) {
    throw new RangeError('Array limit exceeded. Only ' + options.arrayLimit + ' element' + (options.arrayLimit === 1 ? '' : 's') + ' allowed in an array.');
  }
  return val;
};
var isoSentinel = 'utf8=%26%2310003%3B';
var charsetSentinel = 'utf8=%E2%9C%93';
var parseValues = function parseQueryStringValues(str, options) {
  var obj = {
    __proto__: null
  };
  var cleanStr = options.ignoreQueryPrefix ? str.replace(/^\?/, '') : str;
  cleanStr = cleanStr.replace(/%5B/gi, '[').replace(/%5D/gi, ']');
  var limit = options.parameterLimit === Infinity ? undefined : options.parameterLimit;
  var parts = cleanStr.split(options.delimiter, options.throwOnLimitExceeded ? limit + 1 : limit);
  if (options.throwOnLimitExceeded && parts.length > limit) {
    throw new RangeError('Parameter limit exceeded. Only ' + limit + ' parameter' + (limit === 1 ? '' : 's') + ' allowed.');
  }
  var skipIndex = -1;
  var i;
  var charset = options.charset;
  if (options.charsetSentinel) {
    for (i = 0; i < parts.length; ++i) {
      if (parts[i].indexOf('utf8=') === 0) {
        if (parts[i] === charsetSentinel) {
          charset = 'utf-8';
        } else if (parts[i] === isoSentinel) {
          charset = 'iso-8859-1';
        }
        skipIndex = i;
        i = parts.length;
      }
    }
  }
  for (i = 0; i < parts.length; ++i) {
    if (i === skipIndex) {
      continue;
    }
    var part = parts[i];
    var bracketEqualsPos = part.indexOf(']=');
    var pos = bracketEqualsPos === -1 ? part.indexOf('=') : bracketEqualsPos + 1;
    var key;
    var val;
    if (pos === -1) {
      key = options.decoder(part, defaults.decoder, charset, 'key');
      val = options.strictNullHandling ? null : '';
    } else {
      key = options.decoder(part.slice(0, pos), defaults.decoder, charset, 'key');
      val = utils.maybeMap(parseArrayValue(part.slice(pos + 1), options, isArray(obj[key]) ? obj[key].length : 0), function (encodedVal) {
        return options.decoder(encodedVal, defaults.decoder, charset, 'value');
      });
    }
    if (val && options.interpretNumericEntities && charset === 'iso-8859-1') {
      val = interpretNumericEntities(String(val));
    }
    if (part.indexOf('[]=') > -1) {
      val = isArray(val) ? [val] : val;
    }
    var existing = has.call(obj, key);
    if (existing && options.duplicates === 'combine') {
      obj[key] = utils.combine(obj[key], val);
    } else if (!existing || options.duplicates === 'last') {
      obj[key] = val;
    }
  }
  return obj;
};
var parseObject = function (chain, val, options, valuesParsed) {
  var currentArrayLength = 0;
  if (chain.length > 0 && chain[chain.length - 1] === '[]') {
    var parentKey = chain.slice(0, -1).join('');
    currentArrayLength = Array.isArray(val) && val[parentKey] ? val[parentKey].length : 0;
  }
  var leaf = valuesParsed ? val : parseArrayValue(val, options, currentArrayLength);
  for (var i = chain.length - 1; i >= 0; --i) {
    var obj;
    var root = chain[i];
    if (root === '[]' && options.parseArrays) {
      obj = options.allowEmptyArrays && (leaf === '' || options.strictNullHandling && leaf === null) ? [] : utils.combine([], leaf);
    } else {
      obj = options.plainObjects ? {
        __proto__: null
      } : {};
      var cleanRoot = root.charAt(0) === '[' && root.charAt(root.length - 1) === ']' ? root.slice(1, -1) : root;
      var decodedRoot = options.decodeDotInKeys ? cleanRoot.replace(/%2E/g, '.') : cleanRoot;
      var index = parseInt(decodedRoot, 10);
      if (!options.parseArrays && decodedRoot === '') {
        obj = {
          0: leaf
        };
      } else if (!isNaN(index) && root !== decodedRoot && String(index) === decodedRoot && index >= 0 && options.parseArrays && index <= options.arrayLimit) {
        obj = [];
        obj[index] = leaf;
      } else if (decodedRoot !== '__proto__') {
        obj[decodedRoot] = leaf;
      }
    }
    leaf = obj;
  }
  return leaf;
};
var parseKeys = function parseQueryStringKeys(givenKey, val, options, valuesParsed) {
  if (!givenKey) {
    return;
  }
  var key = options.allowDots ? givenKey.replace(/\.([^.[]+)/g, '[$1]') : givenKey;
  var brackets = /(\[[^[\]]*])/;
  var child = /(\[[^[\]]*])/g;
  var segment = options.depth > 0 && brackets.exec(key);
  var parent = segment ? key.slice(0, segment.index) : key;
  var keys = [];
  if (parent) {
    if (!options.plainObjects && has.call(Object.prototype, parent)) {
      if (!options.allowPrototypes) {
        return;
      }
    }
    keys.push(parent);
  }
  var i = 0;
  while (options.depth > 0 && (segment = child.exec(key)) !== null && i < options.depth) {
    i += 1;
    if (!options.plainObjects && has.call(Object.prototype, segment[1].slice(1, -1))) {
      if (!options.allowPrototypes) {
        return;
      }
    }
    keys.push(segment[1]);
  }
  if (segment) {
    if (options.strictDepth === true) {
      throw new RangeError('Input depth exceeded depth option of ' + options.depth + ' and strictDepth is true');
    }
    keys.push('[' + key.slice(segment.index) + ']');
  }
  return parseObject(keys, val, options, valuesParsed);
};
var normalizeParseOptions = function normalizeParseOptions(opts) {
  if (!opts) {
    return defaults;
  }
  if (typeof opts.allowEmptyArrays !== 'undefined' && typeof opts.allowEmptyArrays !== 'boolean') {
    throw new TypeError('`allowEmptyArrays` option can only be `true` or `false`, when provided');
  }
  if (typeof opts.decodeDotInKeys !== 'undefined' && typeof opts.decodeDotInKeys !== 'boolean') {
    throw new TypeError('`decodeDotInKeys` option can only be `true` or `false`, when provided');
  }
  if (opts.decoder !== null && typeof opts.decoder !== 'undefined' && typeof opts.decoder !== 'function') {
    throw new TypeError('Decoder has to be a function.');
  }
  if (typeof opts.charset !== 'undefined' && opts.charset !== 'utf-8' && opts.charset !== 'iso-8859-1') {
    throw new TypeError('The charset option must be either utf-8, iso-8859-1, or undefined');
  }
  if (typeof opts.throwOnLimitExceeded !== 'undefined' && typeof opts.throwOnLimitExceeded !== 'boolean') {
    throw new TypeError('`throwOnLimitExceeded` option must be a boolean');
  }
  var charset = typeof opts.charset === 'undefined' ? defaults.charset : opts.charset;
  var duplicates = typeof opts.duplicates === 'undefined' ? defaults.duplicates : opts.duplicates;
  if (duplicates !== 'combine' && duplicates !== 'first' && duplicates !== 'last') {
    throw new TypeError('The duplicates option must be either combine, first, or last');
  }
  var allowDots = typeof opts.allowDots === 'undefined' ? opts.decodeDotInKeys === true ? true : defaults.allowDots : !!opts.allowDots;
  return {
    allowDots: allowDots,
    allowEmptyArrays: typeof opts.allowEmptyArrays === 'boolean' ? !!opts.allowEmptyArrays : defaults.allowEmptyArrays,
    allowPrototypes: typeof opts.allowPrototypes === 'boolean' ? opts.allowPrototypes : defaults.allowPrototypes,
    allowSparse: typeof opts.allowSparse === 'boolean' ? opts.allowSparse : defaults.allowSparse,
    arrayLimit: typeof opts.arrayLimit === 'number' ? opts.arrayLimit : defaults.arrayLimit,
    charset: charset,
    charsetSentinel: typeof opts.charsetSentinel === 'boolean' ? opts.charsetSentinel : defaults.charsetSentinel,
    comma: typeof opts.comma === 'boolean' ? opts.comma : defaults.comma,
    decodeDotInKeys: typeof opts.decodeDotInKeys === 'boolean' ? opts.decodeDotInKeys : defaults.decodeDotInKeys,
    decoder: typeof opts.decoder === 'function' ? opts.decoder : defaults.decoder,
    delimiter: typeof opts.delimiter === 'string' || utils.isRegExp(opts.delimiter) ? opts.delimiter : defaults.delimiter,
    depth: typeof opts.depth === 'number' || opts.depth === false ? +opts.depth : defaults.depth,
    duplicates: duplicates,
    ignoreQueryPrefix: opts.ignoreQueryPrefix === true,
    interpretNumericEntities: typeof opts.interpretNumericEntities === 'boolean' ? opts.interpretNumericEntities : defaults.interpretNumericEntities,
    parameterLimit: typeof opts.parameterLimit === 'number' ? opts.parameterLimit : defaults.parameterLimit,
    parseArrays: opts.parseArrays !== false,
    plainObjects: typeof opts.plainObjects === 'boolean' ? opts.plainObjects : defaults.plainObjects,
    strictDepth: typeof opts.strictDepth === 'boolean' ? !!opts.strictDepth : defaults.strictDepth,
    strictNullHandling: typeof opts.strictNullHandling === 'boolean' ? opts.strictNullHandling : defaults.strictNullHandling,
    throwOnLimitExceeded: typeof opts.throwOnLimitExceeded === 'boolean' ? opts.throwOnLimitExceeded : false
  };
};
module.exports = function (str, opts) {
  var options = normalizeParseOptions(opts);
  if (str === '' || str === null || typeof str === 'undefined') {
    return options.plainObjects ? {
      __proto__: null
    } : {};
  }
  var tempObj = typeof str === 'string' ? parseValues(str, options) : str;
  var obj = options.plainObjects ? {
    __proto__: null
  } : {};
  var keys = Object.keys(tempObj);
  for (var i = 0; i < keys.length; ++i) {
    var key = keys[i];
    var newObj = parseKeys(key, tempObj[key], options, typeof str === 'string');
    obj = utils.merge(obj, newObj, options);
  }
  if (options.allowSparse === true) {
    return obj;
  }
  return utils.compact(obj);
};

},{"./utils":62}],61:[function(require,module,exports){
'use strict';

var getSideChannel = require('side-channel');
var utils = require('./utils');
var formats = require('./formats');
var has = Object.prototype.hasOwnProperty;
var arrayPrefixGenerators = {
  brackets: function brackets(prefix) {
    return prefix + '[]';
  },
  comma: 'comma',
  indices: function indices(prefix, key) {
    return prefix + '[' + key + ']';
  },
  repeat: function repeat(prefix) {
    return prefix;
  }
};
var isArray = Array.isArray;
var push = Array.prototype.push;
var pushToArray = function (arr, valueOrArray) {
  push.apply(arr, isArray(valueOrArray) ? valueOrArray : [valueOrArray]);
};
var toISO = Date.prototype.toISOString;
var defaultFormat = formats['default'];
var defaults = {
  addQueryPrefix: false,
  allowDots: false,
  allowEmptyArrays: false,
  arrayFormat: 'indices',
  charset: 'utf-8',
  charsetSentinel: false,
  commaRoundTrip: false,
  delimiter: '&',
  encode: true,
  encodeDotInKeys: false,
  encoder: utils.encode,
  encodeValuesOnly: false,
  filter: void undefined,
  format: defaultFormat,
  formatter: formats.formatters[defaultFormat],
  indices: false,
  serializeDate: function serializeDate(date) {
    return toISO.call(date);
  },
  skipNulls: false,
  strictNullHandling: false
};
var isNonNullishPrimitive = function isNonNullishPrimitive(v) {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'symbol' || typeof v === 'bigint';
};
var sentinel = {};
var stringify = function stringify(object, prefix, generateArrayPrefix, commaRoundTrip, allowEmptyArrays, strictNullHandling, skipNulls, encodeDotInKeys, encoder, filter, sort, allowDots, serializeDate, format, formatter, encodeValuesOnly, charset, sideChannel) {
  var obj = object;
  var tmpSc = sideChannel;
  var step = 0;
  var findFlag = false;
  while ((tmpSc = tmpSc.get(sentinel)) !== void undefined && !findFlag) {
    var pos = tmpSc.get(object);
    step += 1;
    if (typeof pos !== 'undefined') {
      if (pos === step) {
        throw new RangeError('Cyclic object value');
      } else {
        findFlag = true;
      }
    }
    if (typeof tmpSc.get(sentinel) === 'undefined') {
      step = 0;
    }
  }
  if (typeof filter === 'function') {
    obj = filter(prefix, obj);
  } else if (obj instanceof Date) {
    obj = serializeDate(obj);
  } else if (generateArrayPrefix === 'comma' && isArray(obj)) {
    obj = utils.maybeMap(obj, function (value) {
      if (value instanceof Date) {
        return serializeDate(value);
      }
      return value;
    });
  }
  if (obj === null) {
    if (strictNullHandling) {
      return encoder && !encodeValuesOnly ? encoder(prefix, defaults.encoder, charset, 'key', format) : prefix;
    }
    obj = '';
  }
  if (isNonNullishPrimitive(obj) || utils.isBuffer(obj)) {
    if (encoder) {
      var keyValue = encodeValuesOnly ? prefix : encoder(prefix, defaults.encoder, charset, 'key', format);
      return [formatter(keyValue) + '=' + formatter(encoder(obj, defaults.encoder, charset, 'value', format))];
    }
    return [formatter(prefix) + '=' + formatter(String(obj))];
  }
  var values = [];
  if (typeof obj === 'undefined') {
    return values;
  }
  var objKeys;
  if (generateArrayPrefix === 'comma' && isArray(obj)) {
    if (encodeValuesOnly && encoder) {
      obj = utils.maybeMap(obj, encoder);
    }
    objKeys = [{
      value: obj.length > 0 ? obj.join(',') || null : void undefined
    }];
  } else if (isArray(filter)) {
    objKeys = filter;
  } else {
    var keys = Object.keys(obj);
    objKeys = sort ? keys.sort(sort) : keys;
  }
  var encodedPrefix = encodeDotInKeys ? String(prefix).replace(/\./g, '%2E') : String(prefix);
  var adjustedPrefix = commaRoundTrip && isArray(obj) && obj.length === 1 ? encodedPrefix + '[]' : encodedPrefix;
  if (allowEmptyArrays && isArray(obj) && obj.length === 0) {
    return adjustedPrefix + '[]';
  }
  for (var j = 0; j < objKeys.length; ++j) {
    var key = objKeys[j];
    var value = typeof key === 'object' && key && typeof key.value !== 'undefined' ? key.value : obj[key];
    if (skipNulls && value === null) {
      continue;
    }
    var encodedKey = allowDots && encodeDotInKeys ? String(key).replace(/\./g, '%2E') : String(key);
    var keyPrefix = isArray(obj) ? typeof generateArrayPrefix === 'function' ? generateArrayPrefix(adjustedPrefix, encodedKey) : adjustedPrefix : adjustedPrefix + (allowDots ? '.' + encodedKey : '[' + encodedKey + ']');
    sideChannel.set(object, step);
    var valueSideChannel = getSideChannel();
    valueSideChannel.set(sentinel, sideChannel);
    pushToArray(values, stringify(value, keyPrefix, generateArrayPrefix, commaRoundTrip, allowEmptyArrays, strictNullHandling, skipNulls, encodeDotInKeys, generateArrayPrefix === 'comma' && encodeValuesOnly && isArray(obj) ? null : encoder, filter, sort, allowDots, serializeDate, format, formatter, encodeValuesOnly, charset, valueSideChannel));
  }
  return values;
};
var normalizeStringifyOptions = function normalizeStringifyOptions(opts) {
  if (!opts) {
    return defaults;
  }
  if (typeof opts.allowEmptyArrays !== 'undefined' && typeof opts.allowEmptyArrays !== 'boolean') {
    throw new TypeError('`allowEmptyArrays` option can only be `true` or `false`, when provided');
  }
  if (typeof opts.encodeDotInKeys !== 'undefined' && typeof opts.encodeDotInKeys !== 'boolean') {
    throw new TypeError('`encodeDotInKeys` option can only be `true` or `false`, when provided');
  }
  if (opts.encoder !== null && typeof opts.encoder !== 'undefined' && typeof opts.encoder !== 'function') {
    throw new TypeError('Encoder has to be a function.');
  }
  var charset = opts.charset || defaults.charset;
  if (typeof opts.charset !== 'undefined' && opts.charset !== 'utf-8' && opts.charset !== 'iso-8859-1') {
    throw new TypeError('The charset option must be either utf-8, iso-8859-1, or undefined');
  }
  var format = formats['default'];
  if (typeof opts.format !== 'undefined') {
    if (!has.call(formats.formatters, opts.format)) {
      throw new TypeError('Unknown format option provided.');
    }
    format = opts.format;
  }
  var formatter = formats.formatters[format];
  var filter = defaults.filter;
  if (typeof opts.filter === 'function' || isArray(opts.filter)) {
    filter = opts.filter;
  }
  var arrayFormat;
  if (opts.arrayFormat in arrayPrefixGenerators) {
    arrayFormat = opts.arrayFormat;
  } else if ('indices' in opts) {
    arrayFormat = opts.indices ? 'indices' : 'repeat';
  } else {
    arrayFormat = defaults.arrayFormat;
  }
  if ('commaRoundTrip' in opts && typeof opts.commaRoundTrip !== 'boolean') {
    throw new TypeError('`commaRoundTrip` must be a boolean, or absent');
  }
  var allowDots = typeof opts.allowDots === 'undefined' ? opts.encodeDotInKeys === true ? true : defaults.allowDots : !!opts.allowDots;
  return {
    addQueryPrefix: typeof opts.addQueryPrefix === 'boolean' ? opts.addQueryPrefix : defaults.addQueryPrefix,
    allowDots: allowDots,
    allowEmptyArrays: typeof opts.allowEmptyArrays === 'boolean' ? !!opts.allowEmptyArrays : defaults.allowEmptyArrays,
    arrayFormat: arrayFormat,
    charset: charset,
    charsetSentinel: typeof opts.charsetSentinel === 'boolean' ? opts.charsetSentinel : defaults.charsetSentinel,
    commaRoundTrip: !!opts.commaRoundTrip,
    delimiter: typeof opts.delimiter === 'undefined' ? defaults.delimiter : opts.delimiter,
    encode: typeof opts.encode === 'boolean' ? opts.encode : defaults.encode,
    encodeDotInKeys: typeof opts.encodeDotInKeys === 'boolean' ? opts.encodeDotInKeys : defaults.encodeDotInKeys,
    encoder: typeof opts.encoder === 'function' ? opts.encoder : defaults.encoder,
    encodeValuesOnly: typeof opts.encodeValuesOnly === 'boolean' ? opts.encodeValuesOnly : defaults.encodeValuesOnly,
    filter: filter,
    format: format,
    formatter: formatter,
    serializeDate: typeof opts.serializeDate === 'function' ? opts.serializeDate : defaults.serializeDate,
    skipNulls: typeof opts.skipNulls === 'boolean' ? opts.skipNulls : defaults.skipNulls,
    sort: typeof opts.sort === 'function' ? opts.sort : null,
    strictNullHandling: typeof opts.strictNullHandling === 'boolean' ? opts.strictNullHandling : defaults.strictNullHandling
  };
};
module.exports = function (object, opts) {
  var obj = object;
  var options = normalizeStringifyOptions(opts);
  var objKeys;
  var filter;
  if (typeof options.filter === 'function') {
    filter = options.filter;
    obj = filter('', obj);
  } else if (isArray(options.filter)) {
    filter = options.filter;
    objKeys = filter;
  }
  var keys = [];
  if (typeof obj !== 'object' || obj === null) {
    return '';
  }
  var generateArrayPrefix = arrayPrefixGenerators[options.arrayFormat];
  var commaRoundTrip = generateArrayPrefix === 'comma' && options.commaRoundTrip;
  if (!objKeys) {
    objKeys = Object.keys(obj);
  }
  if (options.sort) {
    objKeys.sort(options.sort);
  }
  var sideChannel = getSideChannel();
  for (var i = 0; i < objKeys.length; ++i) {
    var key = objKeys[i];
    var value = obj[key];
    if (options.skipNulls && value === null) {
      continue;
    }
    pushToArray(keys, stringify(value, key, generateArrayPrefix, commaRoundTrip, options.allowEmptyArrays, options.strictNullHandling, options.skipNulls, options.encodeDotInKeys, options.encode ? options.encoder : null, options.filter, options.sort, options.allowDots, options.serializeDate, options.format, options.formatter, options.encodeValuesOnly, options.charset, sideChannel));
  }
  var joined = keys.join(options.delimiter);
  var prefix = options.addQueryPrefix === true ? '?' : '';
  if (options.charsetSentinel) {
    if (options.charset === 'iso-8859-1') {
      prefix += 'utf8=%26%2310003%3B&';
    } else {
      prefix += 'utf8=%E2%9C%93&';
    }
  }
  return joined.length > 0 ? prefix + joined : '';
};

},{"./formats":58,"./utils":62,"side-channel":68}],62:[function(require,module,exports){
'use strict';

var formats = require('./formats');
var has = Object.prototype.hasOwnProperty;
var isArray = Array.isArray;
var hexTable = function () {
  var array = [];
  for (var i = 0; i < 256; ++i) {
    array.push('%' + ((i < 16 ? '0' : '') + i.toString(16)).toUpperCase());
  }
  return array;
}();
var compactQueue = function compactQueue(queue) {
  while (queue.length > 1) {
    var item = queue.pop();
    var obj = item.obj[item.prop];
    if (isArray(obj)) {
      var compacted = [];
      for (var j = 0; j < obj.length; ++j) {
        if (typeof obj[j] !== 'undefined') {
          compacted.push(obj[j]);
        }
      }
      item.obj[item.prop] = compacted;
    }
  }
};
var arrayToObject = function arrayToObject(source, options) {
  var obj = options && options.plainObjects ? {
    __proto__: null
  } : {};
  for (var i = 0; i < source.length; ++i) {
    if (typeof source[i] !== 'undefined') {
      obj[i] = source[i];
    }
  }
  return obj;
};
var merge = function merge(target, source, options) {
  if (!source) {
    return target;
  }
  if (typeof source !== 'object' && typeof source !== 'function') {
    if (isArray(target)) {
      target.push(source);
    } else if (target && typeof target === 'object') {
      if (options && (options.plainObjects || options.allowPrototypes) || !has.call(Object.prototype, source)) {
        target[source] = true;
      }
    } else {
      return [target, source];
    }
    return target;
  }
  if (!target || typeof target !== 'object') {
    return [target].concat(source);
  }
  var mergeTarget = target;
  if (isArray(target) && !isArray(source)) {
    mergeTarget = arrayToObject(target, options);
  }
  if (isArray(target) && isArray(source)) {
    source.forEach(function (item, i) {
      if (has.call(target, i)) {
        var targetItem = target[i];
        if (targetItem && typeof targetItem === 'object' && item && typeof item === 'object') {
          target[i] = merge(targetItem, item, options);
        } else {
          target.push(item);
        }
      } else {
        target[i] = item;
      }
    });
    return target;
  }
  return Object.keys(source).reduce(function (acc, key) {
    var value = source[key];
    if (has.call(acc, key)) {
      acc[key] = merge(acc[key], value, options);
    } else {
      acc[key] = value;
    }
    return acc;
  }, mergeTarget);
};
var assign = function assignSingleSource(target, source) {
  return Object.keys(source).reduce(function (acc, key) {
    acc[key] = source[key];
    return acc;
  }, target);
};
var decode = function (str, defaultDecoder, charset) {
  var strWithoutPlus = str.replace(/\+/g, ' ');
  if (charset === 'iso-8859-1') {
    return strWithoutPlus.replace(/%[0-9a-f]{2}/gi, unescape);
  }
  try {
    return decodeURIComponent(strWithoutPlus);
  } catch (e) {
    return strWithoutPlus;
  }
};
var limit = 1024;
var encode = function encode(str, defaultEncoder, charset, kind, format) {
  if (str.length === 0) {
    return str;
  }
  var string = str;
  if (typeof str === 'symbol') {
    string = Symbol.prototype.toString.call(str);
  } else if (typeof str !== 'string') {
    string = String(str);
  }
  if (charset === 'iso-8859-1') {
    return escape(string).replace(/%u[0-9a-f]{4}/gi, function ($0) {
      return '%26%23' + parseInt($0.slice(2), 16) + '%3B';
    });
  }
  var out = '';
  for (var j = 0; j < string.length; j += limit) {
    var segment = string.length >= limit ? string.slice(j, j + limit) : string;
    var arr = [];
    for (var i = 0; i < segment.length; ++i) {
      var c = segment.charCodeAt(i);
      if (c === 0x2D || c === 0x2E || c === 0x5F || c === 0x7E || c >= 0x30 && c <= 0x39 || c >= 0x41 && c <= 0x5A || c >= 0x61 && c <= 0x7A || format === formats.RFC1738 && (c === 0x28 || c === 0x29)) {
        arr[arr.length] = segment.charAt(i);
        continue;
      }
      if (c < 0x80) {
        arr[arr.length] = hexTable[c];
        continue;
      }
      if (c < 0x800) {
        arr[arr.length] = hexTable[0xC0 | c >> 6] + hexTable[0x80 | c & 0x3F];
        continue;
      }
      if (c < 0xD800 || c >= 0xE000) {
        arr[arr.length] = hexTable[0xE0 | c >> 12] + hexTable[0x80 | c >> 6 & 0x3F] + hexTable[0x80 | c & 0x3F];
        continue;
      }
      i += 1;
      c = 0x10000 + ((c & 0x3FF) << 10 | segment.charCodeAt(i) & 0x3FF);
      arr[arr.length] = hexTable[0xF0 | c >> 18] + hexTable[0x80 | c >> 12 & 0x3F] + hexTable[0x80 | c >> 6 & 0x3F] + hexTable[0x80 | c & 0x3F];
    }
    out += arr.join('');
  }
  return out;
};
var compact = function compact(value) {
  var queue = [{
    obj: {
      o: value
    },
    prop: 'o'
  }];
  var refs = [];
  for (var i = 0; i < queue.length; ++i) {
    var item = queue[i];
    var obj = item.obj[item.prop];
    var keys = Object.keys(obj);
    for (var j = 0; j < keys.length; ++j) {
      var key = keys[j];
      var val = obj[key];
      if (typeof val === 'object' && val !== null && refs.indexOf(val) === -1) {
        queue.push({
          obj: obj,
          prop: key
        });
        refs.push(val);
      }
    }
  }
  compactQueue(queue);
  return value;
};
var isRegExp = function isRegExp(obj) {
  return Object.prototype.toString.call(obj) === '[object RegExp]';
};
var isBuffer = function isBuffer(obj) {
  if (!obj || typeof obj !== 'object') {
    return false;
  }
  return !!(obj.constructor && obj.constructor.isBuffer && obj.constructor.isBuffer(obj));
};
var combine = function combine(a, b) {
  return [].concat(a, b);
};
var maybeMap = function maybeMap(val, fn) {
  if (isArray(val)) {
    var mapped = [];
    for (var i = 0; i < val.length; i += 1) {
      mapped.push(fn(val[i]));
    }
    return mapped;
  }
  return fn(val);
};
module.exports = {
  arrayToObject: arrayToObject,
  assign: assign,
  combine: combine,
  compact: compact,
  decode: decode,
  encode: encode,
  isBuffer: isBuffer,
  isRegExp: isRegExp,
  maybeMap: maybeMap,
  merge: merge
};

},{"./formats":58}],63:[function(require,module,exports){
'use strict';

var callBound = require('call-bound');
var isRegex = require('is-regex');
var $exec = callBound('RegExp.prototype.exec');
var $TypeError = require('es-errors/type');
module.exports = function regexTester(regex) {
  if (!isRegex(regex)) {
    throw new $TypeError('`regex` must be a RegExp');
  }
  return function test(s) {
    return $exec(regex, s) !== null;
  };
};

},{"call-bound":12,"es-errors/type":22,"is-regex":45}],64:[function(require,module,exports){
'use strict';

var GetIntrinsic = require('get-intrinsic');
var define = require('define-data-property');
var hasDescriptors = require('has-property-descriptors')();
var gOPD = require('gopd');
var $TypeError = require('es-errors/type');
var $floor = GetIntrinsic('%Math.floor%');
module.exports = function setFunctionLength(fn, length) {
  if (typeof fn !== 'function') {
    throw new $TypeError('`fn` is not a function');
  }
  if (typeof length !== 'number' || length < 0 || length > 0xFFFFFFFF || $floor(length) !== length) {
    throw new $TypeError('`length` must be a positive 32-bit integer');
  }
  var loose = arguments.length > 2 && !!arguments[2];
  var functionLengthIsConfigurable = true;
  var functionLengthIsWritable = true;
  if ('length' in fn && gOPD) {
    var desc = gOPD(fn, 'length');
    if (desc && !desc.configurable) {
      functionLengthIsConfigurable = false;
    }
    if (desc && !desc.writable) {
      functionLengthIsWritable = false;
    }
  }
  if (functionLengthIsConfigurable || functionLengthIsWritable || !loose) {
    if (hasDescriptors) {
      define(fn, 'length', length, true, true);
    } else {
      define(fn, 'length', length);
    }
  }
  return fn;
};

},{"define-data-property":14,"es-errors/type":22,"get-intrinsic":29,"gopd":34,"has-property-descriptors":35}],65:[function(require,module,exports){
'use strict';

var inspect = require('object-inspect');
var $TypeError = require('es-errors/type');
var listGetNode = function (list, key, isDelete) {
  var prev = list;
  var curr;
  for (; (curr = prev.next) != null; prev = curr) {
    if (curr.key === key) {
      prev.next = curr.next;
      if (!isDelete) {
        curr.next = list.next;
        list.next = curr;
      }
      return curr;
    }
  }
};
var listGet = function (objects, key) {
  if (!objects) {
    return void undefined;
  }
  var node = listGetNode(objects, key);
  return node && node.value;
};
var listSet = function (objects, key, value) {
  var node = listGetNode(objects, key);
  if (node) {
    node.value = value;
  } else {
    objects.next = {
      key: key,
      next: objects.next,
      value: value
    };
  }
};
var listHas = function (objects, key) {
  if (!objects) {
    return false;
  }
  return !!listGetNode(objects, key);
};
var listDelete = function (objects, key) {
  if (objects) {
    return listGetNode(objects, key, true);
  }
};
module.exports = function getSideChannelList() {
  var $o;
  var channel = {
    assert: function (key) {
      if (!channel.has(key)) {
        throw new $TypeError('Side channel does not contain ' + inspect(key));
      }
    },
    'delete': function (key) {
      var root = $o && $o.next;
      var deletedNode = listDelete($o, key);
      if (deletedNode && root && root === deletedNode) {
        $o = void undefined;
      }
      return !!deletedNode;
    },
    get: function (key) {
      return listGet($o, key);
    },
    has: function (key) {
      return listHas($o, key);
    },
    set: function (key, value) {
      if (!$o) {
        $o = {
          next: void undefined
        };
      }
      listSet($o, key, value);
    }
  };
  return channel;
};

},{"es-errors/type":22,"object-inspect":55}],66:[function(require,module,exports){
'use strict';

var GetIntrinsic = require('get-intrinsic');
var callBound = require('call-bound');
var inspect = require('object-inspect');
var $TypeError = require('es-errors/type');
var $Map = GetIntrinsic('%Map%', true);
var $mapGet = callBound('Map.prototype.get', true);
var $mapSet = callBound('Map.prototype.set', true);
var $mapHas = callBound('Map.prototype.has', true);
var $mapDelete = callBound('Map.prototype.delete', true);
var $mapSize = callBound('Map.prototype.size', true);
module.exports = !!$Map && function getSideChannelMap() {
  var $m;
  var channel = {
    assert: function (key) {
      if (!channel.has(key)) {
        throw new $TypeError('Side channel does not contain ' + inspect(key));
      }
    },
    'delete': function (key) {
      if ($m) {
        var result = $mapDelete($m, key);
        if ($mapSize($m) === 0) {
          $m = void undefined;
        }
        return result;
      }
      return false;
    },
    get: function (key) {
      if ($m) {
        return $mapGet($m, key);
      }
    },
    has: function (key) {
      if ($m) {
        return $mapHas($m, key);
      }
      return false;
    },
    set: function (key, value) {
      if (!$m) {
        $m = new $Map();
      }
      $mapSet($m, key, value);
    }
  };
  return channel;
};

},{"call-bound":12,"es-errors/type":22,"get-intrinsic":29,"object-inspect":55}],67:[function(require,module,exports){
'use strict';

var GetIntrinsic = require('get-intrinsic');
var callBound = require('call-bound');
var inspect = require('object-inspect');
var getSideChannelMap = require('side-channel-map');
var $TypeError = require('es-errors/type');
var $WeakMap = GetIntrinsic('%WeakMap%', true);
var $weakMapGet = callBound('WeakMap.prototype.get', true);
var $weakMapSet = callBound('WeakMap.prototype.set', true);
var $weakMapHas = callBound('WeakMap.prototype.has', true);
var $weakMapDelete = callBound('WeakMap.prototype.delete', true);
module.exports = $WeakMap ? function getSideChannelWeakMap() {
  var $wm;
  var $m;
  var channel = {
    assert: function (key) {
      if (!channel.has(key)) {
        throw new $TypeError('Side channel does not contain ' + inspect(key));
      }
    },
    'delete': function (key) {
      if ($WeakMap && key && (typeof key === 'object' || typeof key === 'function')) {
        if ($wm) {
          return $weakMapDelete($wm, key);
        }
      } else if (getSideChannelMap) {
        if ($m) {
          return $m['delete'](key);
        }
      }
      return false;
    },
    get: function (key) {
      if ($WeakMap && key && (typeof key === 'object' || typeof key === 'function')) {
        if ($wm) {
          return $weakMapGet($wm, key);
        }
      }
      return $m && $m.get(key);
    },
    has: function (key) {
      if ($WeakMap && key && (typeof key === 'object' || typeof key === 'function')) {
        if ($wm) {
          return $weakMapHas($wm, key);
        }
      }
      return !!$m && $m.has(key);
    },
    set: function (key, value) {
      if ($WeakMap && key && (typeof key === 'object' || typeof key === 'function')) {
        if (!$wm) {
          $wm = new $WeakMap();
        }
        $weakMapSet($wm, key, value);
      } else if (getSideChannelMap) {
        if (!$m) {
          $m = getSideChannelMap();
        }
        $m.set(key, value);
      }
    }
  };
  return channel;
} : getSideChannelMap;

},{"call-bound":12,"es-errors/type":22,"get-intrinsic":29,"object-inspect":55,"side-channel-map":66}],68:[function(require,module,exports){
'use strict';

var $TypeError = require('es-errors/type');
var inspect = require('object-inspect');
var getSideChannelList = require('side-channel-list');
var getSideChannelMap = require('side-channel-map');
var getSideChannelWeakMap = require('side-channel-weakmap');
var makeChannel = getSideChannelWeakMap || getSideChannelMap || getSideChannelList;
module.exports = function getSideChannel() {
  var $channelData;
  var channel = {
    assert: function (key) {
      if (!channel.has(key)) {
        throw new $TypeError('Side channel does not contain ' + inspect(key));
      }
    },
    'delete': function (key) {
      return !!$channelData && $channelData['delete'](key);
    },
    get: function (key) {
      return $channelData && $channelData.get(key);
    },
    has: function (key) {
      return !!$channelData && $channelData.has(key);
    },
    set: function (key, value) {
      if (!$channelData) {
        $channelData = makeChannel();
      }
      $channelData.set(key, value);
    }
  };
  return channel;
};

},{"es-errors/type":22,"object-inspect":55,"side-channel-list":65,"side-channel-map":66,"side-channel-weakmap":67}],69:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object' && typeof arg.copy === 'function' && typeof arg.fill === 'function' && typeof arg.readUInt8 === 'function';
};

},{}],70:[function(require,module,exports){
'use strict';

var isArgumentsObject = require('is-arguments');
var isGeneratorFunction = require('is-generator-function');
var whichTypedArray = require('which-typed-array');
var isTypedArray = require('is-typed-array');
function uncurryThis(f) {
  return f.call.bind(f);
}
var BigIntSupported = typeof BigInt !== 'undefined';
var SymbolSupported = typeof Symbol !== 'undefined';
var ObjectToString = uncurryThis(Object.prototype.toString);
var numberValue = uncurryThis(Number.prototype.valueOf);
var stringValue = uncurryThis(String.prototype.valueOf);
var booleanValue = uncurryThis(Boolean.prototype.valueOf);
if (BigIntSupported) {
  var bigIntValue = uncurryThis(BigInt.prototype.valueOf);
}
if (SymbolSupported) {
  var symbolValue = uncurryThis(Symbol.prototype.valueOf);
}
function checkBoxedPrimitive(value, prototypeValueOf) {
  if (typeof value !== 'object') {
    return false;
  }
  try {
    prototypeValueOf(value);
    return true;
  } catch (e) {
    return false;
  }
}
exports.isArgumentsObject = isArgumentsObject;
exports.isGeneratorFunction = isGeneratorFunction;
exports.isTypedArray = isTypedArray;
function isPromise(input) {
  return typeof Promise !== 'undefined' && input instanceof Promise || input !== null && typeof input === 'object' && typeof input.then === 'function' && typeof input.catch === 'function';
}
exports.isPromise = isPromise;
function isArrayBufferView(value) {
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView) {
    return ArrayBuffer.isView(value);
  }
  return isTypedArray(value) || isDataView(value);
}
exports.isArrayBufferView = isArrayBufferView;
function isUint8Array(value) {
  return whichTypedArray(value) === 'Uint8Array';
}
exports.isUint8Array = isUint8Array;
function isUint8ClampedArray(value) {
  return whichTypedArray(value) === 'Uint8ClampedArray';
}
exports.isUint8ClampedArray = isUint8ClampedArray;
function isUint16Array(value) {
  return whichTypedArray(value) === 'Uint16Array';
}
exports.isUint16Array = isUint16Array;
function isUint32Array(value) {
  return whichTypedArray(value) === 'Uint32Array';
}
exports.isUint32Array = isUint32Array;
function isInt8Array(value) {
  return whichTypedArray(value) === 'Int8Array';
}
exports.isInt8Array = isInt8Array;
function isInt16Array(value) {
  return whichTypedArray(value) === 'Int16Array';
}
exports.isInt16Array = isInt16Array;
function isInt32Array(value) {
  return whichTypedArray(value) === 'Int32Array';
}
exports.isInt32Array = isInt32Array;
function isFloat32Array(value) {
  return whichTypedArray(value) === 'Float32Array';
}
exports.isFloat32Array = isFloat32Array;
function isFloat64Array(value) {
  return whichTypedArray(value) === 'Float64Array';
}
exports.isFloat64Array = isFloat64Array;
function isBigInt64Array(value) {
  return whichTypedArray(value) === 'BigInt64Array';
}
exports.isBigInt64Array = isBigInt64Array;
function isBigUint64Array(value) {
  return whichTypedArray(value) === 'BigUint64Array';
}
exports.isBigUint64Array = isBigUint64Array;
function isMapToString(value) {
  return ObjectToString(value) === '[object Map]';
}
isMapToString.working = typeof Map !== 'undefined' && isMapToString(new Map());
function isMap(value) {
  if (typeof Map === 'undefined') {
    return false;
  }
  return isMapToString.working ? isMapToString(value) : value instanceof Map;
}
exports.isMap = isMap;
function isSetToString(value) {
  return ObjectToString(value) === '[object Set]';
}
isSetToString.working = typeof Set !== 'undefined' && isSetToString(new Set());
function isSet(value) {
  if (typeof Set === 'undefined') {
    return false;
  }
  return isSetToString.working ? isSetToString(value) : value instanceof Set;
}
exports.isSet = isSet;
function isWeakMapToString(value) {
  return ObjectToString(value) === '[object WeakMap]';
}
isWeakMapToString.working = typeof WeakMap !== 'undefined' && isWeakMapToString(new WeakMap());
function isWeakMap(value) {
  if (typeof WeakMap === 'undefined') {
    return false;
  }
  return isWeakMapToString.working ? isWeakMapToString(value) : value instanceof WeakMap;
}
exports.isWeakMap = isWeakMap;
function isWeakSetToString(value) {
  return ObjectToString(value) === '[object WeakSet]';
}
isWeakSetToString.working = typeof WeakSet !== 'undefined' && isWeakSetToString(new WeakSet());
function isWeakSet(value) {
  return isWeakSetToString(value);
}
exports.isWeakSet = isWeakSet;
function isArrayBufferToString(value) {
  return ObjectToString(value) === '[object ArrayBuffer]';
}
isArrayBufferToString.working = typeof ArrayBuffer !== 'undefined' && isArrayBufferToString(new ArrayBuffer());
function isArrayBuffer(value) {
  if (typeof ArrayBuffer === 'undefined') {
    return false;
  }
  return isArrayBufferToString.working ? isArrayBufferToString(value) : value instanceof ArrayBuffer;
}
exports.isArrayBuffer = isArrayBuffer;
function isDataViewToString(value) {
  return ObjectToString(value) === '[object DataView]';
}
isDataViewToString.working = typeof ArrayBuffer !== 'undefined' && typeof DataView !== 'undefined' && isDataViewToString(new DataView(new ArrayBuffer(1), 0, 1));
function isDataView(value) {
  if (typeof DataView === 'undefined') {
    return false;
  }
  return isDataViewToString.working ? isDataViewToString(value) : value instanceof DataView;
}
exports.isDataView = isDataView;
var SharedArrayBufferCopy = typeof SharedArrayBuffer !== 'undefined' ? SharedArrayBuffer : undefined;
function isSharedArrayBufferToString(value) {
  return ObjectToString(value) === '[object SharedArrayBuffer]';
}
function isSharedArrayBuffer(value) {
  if (typeof SharedArrayBufferCopy === 'undefined') {
    return false;
  }
  if (typeof isSharedArrayBufferToString.working === 'undefined') {
    isSharedArrayBufferToString.working = isSharedArrayBufferToString(new SharedArrayBufferCopy());
  }
  return isSharedArrayBufferToString.working ? isSharedArrayBufferToString(value) : value instanceof SharedArrayBufferCopy;
}
exports.isSharedArrayBuffer = isSharedArrayBuffer;
function isAsyncFunction(value) {
  return ObjectToString(value) === '[object AsyncFunction]';
}
exports.isAsyncFunction = isAsyncFunction;
function isMapIterator(value) {
  return ObjectToString(value) === '[object Map Iterator]';
}
exports.isMapIterator = isMapIterator;
function isSetIterator(value) {
  return ObjectToString(value) === '[object Set Iterator]';
}
exports.isSetIterator = isSetIterator;
function isGeneratorObject(value) {
  return ObjectToString(value) === '[object Generator]';
}
exports.isGeneratorObject = isGeneratorObject;
function isWebAssemblyCompiledModule(value) {
  return ObjectToString(value) === '[object WebAssembly.Module]';
}
exports.isWebAssemblyCompiledModule = isWebAssemblyCompiledModule;
function isNumberObject(value) {
  return checkBoxedPrimitive(value, numberValue);
}
exports.isNumberObject = isNumberObject;
function isStringObject(value) {
  return checkBoxedPrimitive(value, stringValue);
}
exports.isStringObject = isStringObject;
function isBooleanObject(value) {
  return checkBoxedPrimitive(value, booleanValue);
}
exports.isBooleanObject = isBooleanObject;
function isBigIntObject(value) {
  return BigIntSupported && checkBoxedPrimitive(value, bigIntValue);
}
exports.isBigIntObject = isBigIntObject;
function isSymbolObject(value) {
  return SymbolSupported && checkBoxedPrimitive(value, symbolValue);
}
exports.isSymbolObject = isSymbolObject;
function isBoxedPrimitive(value) {
  return isNumberObject(value) || isStringObject(value) || isBooleanObject(value) || isBigIntObject(value) || isSymbolObject(value);
}
exports.isBoxedPrimitive = isBoxedPrimitive;
function isAnyArrayBuffer(value) {
  return typeof Uint8Array !== 'undefined' && (isArrayBuffer(value) || isSharedArrayBuffer(value));
}
exports.isAnyArrayBuffer = isAnyArrayBuffer;
['isProxy', 'isExternal', 'isModuleNamespaceObject'].forEach(function (method) {
  Object.defineProperty(exports, method, {
    enumerable: false,
    value: function () {
      throw new Error(method + ' is not supported in userland');
    }
  });
});

},{"is-arguments":42,"is-generator-function":44,"is-typed-array":46,"which-typed-array":72}],71:[function(require,module,exports){
(function (process){(function (){
var getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors || function getOwnPropertyDescriptors(obj) {
  var keys = Object.keys(obj);
  var descriptors = {};
  for (var i = 0; i < keys.length; i++) {
    descriptors[keys[i]] = Object.getOwnPropertyDescriptor(obj, keys[i]);
  }
  return descriptors;
};
var formatRegExp = /%[sdj%]/g;
exports.format = function (f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }
  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function (x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s':
        return String(args[i++]);
      case '%d':
        return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};
exports.deprecate = function (fn, msg) {
  if (typeof process !== 'undefined' && process.noDeprecation === true) {
    return fn;
  }
  if (typeof process === 'undefined') {
    return function () {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }
  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }
  return deprecated;
};
var debugs = {};
var debugEnvRegex = /^$/;
if (process.env.NODE_DEBUG) {
  var debugEnv = process.env.NODE_DEBUG;
  debugEnv = debugEnv.replace(/[|\\{}()[\]^$+?.]/g, '\\$&').replace(/\*/g, '.*').replace(/,/g, '$|^').toUpperCase();
  debugEnvRegex = new RegExp('^' + debugEnv + '$', 'i');
}
exports.debuglog = function (set) {
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (debugEnvRegex.test(set)) {
      var pid = process.pid;
      debugs[set] = function () {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function () {};
    }
  }
  return debugs[set];
};
function inspect(obj, opts) {
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    ctx.showHidden = opts;
  } else if (opts) {
    exports._extend(ctx, opts);
  }
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;
inspect.colors = {
  'bold': [1, 22],
  'italic': [3, 23],
  'underline': [4, 24],
  'inverse': [7, 27],
  'white': [37, 39],
  'grey': [90, 39],
  'black': [30, 39],
  'blue': [34, 39],
  'cyan': [36, 39],
  'green': [32, 39],
  'magenta': [35, 39],
  'red': [31, 39],
  'yellow': [33, 39]
};
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  'regexp': 'red'
};
function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];
  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str + '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}
function stylizeNoColor(str, styleType) {
  return str;
}
function arrayToHash(array) {
  var hash = {};
  array.forEach(function (val, idx) {
    hash[val] = true;
  });
  return hash;
}
function formatValue(ctx, value, recurseTimes) {
  if (ctx.customInspect && value && isFunction(value.inspect) && value.inspect !== exports.inspect && !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);
  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }
  if (isError(value) && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }
  var base = '',
    array = false,
    braces = ['{', '}'];
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }
  if (isError(value)) {
    base = ' ' + formatError(value);
  }
  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }
  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }
  ctx.seen.push(value);
  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function (key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }
  ctx.seen.pop();
  return reduceToSingleString(output, base, braces);
}
function formatPrimitive(ctx, value) {
  if (isUndefined(value)) return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '').replace(/'/g, "\\'").replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value)) return ctx.stylize('' + value, 'number');
  if (isBoolean(value)) return ctx.stylize('' + value, 'boolean');
  if (isNull(value)) return ctx.stylize('null', 'null');
}
function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}
function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys, String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function (key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys, key, true));
    }
  });
  return output;
}
function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || {
    value: value[key]
  };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function (line) {
            return '  ' + line;
          }).join('\n').slice(2);
        } else {
          str = '\n' + str.split('\n').map(function (line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.slice(1, -1);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'").replace(/\\"/g, '"').replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }
  return name + ': ' + str;
}
function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function (prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);
  if (length > 60) {
    return braces[0] + (base === '' ? '' : base + '\n ') + ' ' + output.join(',\n  ') + ' ' + braces[1];
  }
  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}
exports.types = require('./support/types');
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;
function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;
function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;
function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;
function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;
function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;
function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;
function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;
function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;
exports.types.isRegExp = isRegExp;
function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;
function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;
exports.types.isDate = isDate;
function isError(e) {
  return isObject(e) && (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;
exports.types.isNativeError = isError;
function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;
function isPrimitive(arg) {
  return arg === null || typeof arg === 'boolean' || typeof arg === 'number' || typeof arg === 'string' || typeof arg === 'symbol' || typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;
exports.isBuffer = require('./support/isBuffer');
function objectToString(o) {
  return Object.prototype.toString.call(o);
}
function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}
var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}
exports.log = function () {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};
exports.inherits = require('inherits');
exports._extend = function (origin, add) {
  if (!add || !isObject(add)) return origin;
  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};
function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}
var kCustomPromisifiedSymbol = typeof Symbol !== 'undefined' ? Symbol('util.promisify.custom') : undefined;
exports.promisify = function promisify(original) {
  if (typeof original !== 'function') throw new TypeError('The "original" argument must be of type Function');
  if (kCustomPromisifiedSymbol && original[kCustomPromisifiedSymbol]) {
    var fn = original[kCustomPromisifiedSymbol];
    if (typeof fn !== 'function') {
      throw new TypeError('The "util.promisify.custom" argument must be of type Function');
    }
    Object.defineProperty(fn, kCustomPromisifiedSymbol, {
      value: fn,
      enumerable: false,
      writable: false,
      configurable: true
    });
    return fn;
  }
  function fn() {
    var promiseResolve, promiseReject;
    var promise = new Promise(function (resolve, reject) {
      promiseResolve = resolve;
      promiseReject = reject;
    });
    var args = [];
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    args.push(function (err, value) {
      if (err) {
        promiseReject(err);
      } else {
        promiseResolve(value);
      }
    });
    try {
      original.apply(this, args);
    } catch (err) {
      promiseReject(err);
    }
    return promise;
  }
  Object.setPrototypeOf(fn, Object.getPrototypeOf(original));
  if (kCustomPromisifiedSymbol) Object.defineProperty(fn, kCustomPromisifiedSymbol, {
    value: fn,
    enumerable: false,
    writable: false,
    configurable: true
  });
  return Object.defineProperties(fn, getOwnPropertyDescriptors(original));
};
exports.promisify.custom = kCustomPromisifiedSymbol;
function callbackifyOnRejected(reason, cb) {
  if (!reason) {
    var newReason = new Error('Promise was rejected with a falsy value');
    newReason.reason = reason;
    reason = newReason;
  }
  return cb(reason);
}
function callbackify(original) {
  if (typeof original !== 'function') {
    throw new TypeError('The "original" argument must be of type Function');
  }
  function callbackified() {
    var args = [];
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    var maybeCb = args.pop();
    if (typeof maybeCb !== 'function') {
      throw new TypeError('The last argument must be of type Function');
    }
    var self = this;
    var cb = function () {
      return maybeCb.apply(self, arguments);
    };
    original.apply(this, args).then(function (ret) {
      process.nextTick(cb.bind(null, null, ret));
    }, function (rej) {
      process.nextTick(callbackifyOnRejected.bind(null, rej, cb));
    });
  }
  Object.setPrototypeOf(callbackified, Object.getPrototypeOf(original));
  Object.defineProperties(callbackified, getOwnPropertyDescriptors(original));
  return callbackified;
}
exports.callbackify = callbackify;

}).call(this)}).call(this,require('_process'))
},{"./support/isBuffer":69,"./support/types":70,"_process":57,"inherits":41}],72:[function(require,module,exports){
(function (global){(function (){
'use strict';

var forEach = require('for-each');
var availableTypedArrays = require('available-typed-arrays');
var callBind = require('call-bind');
var callBound = require('call-bound');
var gOPD = require('gopd');
var getProto = require('get-proto');
var $toString = callBound('Object.prototype.toString');
var hasToStringTag = require('has-tostringtag/shams')();
var g = typeof globalThis === 'undefined' ? global : globalThis;
var typedArrays = availableTypedArrays();
var $slice = callBound('String.prototype.slice');
var $indexOf = callBound('Array.prototype.indexOf', true) || function indexOf(array, value) {
  for (var i = 0; i < array.length; i += 1) {
    if (array[i] === value) {
      return i;
    }
  }
  return -1;
};
var cache = {
  __proto__: null
};
if (hasToStringTag && gOPD && getProto) {
  forEach(typedArrays, function (typedArray) {
    var arr = new g[typedArray]();
    if (Symbol.toStringTag in arr && getProto) {
      var proto = getProto(arr);
      var descriptor = gOPD(proto, Symbol.toStringTag);
      if (!descriptor && proto) {
        var superProto = getProto(proto);
        descriptor = gOPD(superProto, Symbol.toStringTag);
      }
      cache['$' + typedArray] = callBind(descriptor.get);
    }
  });
} else {
  forEach(typedArrays, function (typedArray) {
    var arr = new g[typedArray]();
    var fn = arr.slice || arr.set;
    if (fn) {
      cache[('$' + typedArray)] = callBind(fn);
    }
  });
}
var tryTypedArrays = function tryAllTypedArrays(value) {
  var found = false;
  forEach(cache, function (getter, typedArray) {
    if (!found) {
      try {
        if ('$' + getter(value) === typedArray) {
          found = $slice(typedArray, 1);
        }
      } catch (e) {}
    }
  });
  return found;
};
var trySlices = function tryAllSlices(value) {
  var found = false;
  forEach(cache, function (getter, name) {
    if (!found) {
      try {
        getter(value);
        found = $slice(name, 1);
      } catch (e) {}
    }
  });
  return found;
};
module.exports = function whichTypedArray(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (!hasToStringTag) {
    var tag = $slice($toString(value), 8, -1);
    if ($indexOf(typedArrays, tag) > -1) {
      return tag;
    }
    if (tag !== 'Object') {
      return false;
    }
    return trySlices(value);
  }
  if (!gOPD) {
    return null;
  }
  return tryTypedArrays(value);
};

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"available-typed-arrays":1,"call-bind":11,"call-bound":12,"for-each":26,"get-proto":32,"gopd":34,"has-tostringtag/shams":38}],73:[function(require,module,exports){
const defaults = ['use', 'on', 'once', 'set', 'query', 'type', 'accept', 'auth', 'withCredentials', 'sortQuery', 'retry', 'ok', 'redirects', 'timeout', 'buffer', 'serialize', 'parse', 'ca', 'key', 'pfx', 'cert', 'disableTLSCerts'];
class Agent {
  constructor() {
    this._defaults = [];
  }
  _setDefaults(request) {
    for (const def of this._defaults) {
      request[def.fn](...def.args);
    }
  }
}
for (const fn of defaults) {
  Agent.prototype[fn] = function (...args) {
    this._defaults.push({
      fn,
      args
    });
    return this;
  };
}
module.exports = Agent;

},{}],74:[function(require,module,exports){
(function (global,Buffer){(function (){
let root;
if (typeof window !== 'undefined') {
  root = window;
} else if (typeof self === 'undefined') {
  console.warn('Using browser-only version of superagent in non-browser environment');
  root = this;
} else {
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
function noop() {}
module.exports = function (method, url) {
  if (typeof url === 'function') {
    return new exports.Request('GET', method).end(url);
  }
  if (arguments.length === 1) {
    return new exports.Request('GET', method);
  }
  return new exports.Request(method, url);
};
exports = module.exports;
const request = exports;
exports.Request = Request;
request.getXHR = () => {
  if (root.XMLHttpRequest) {
    return new root.XMLHttpRequest();
  }
  throw new Error('Browser-only version of superagent could not find XHR');
};
const trim = ''.trim ? s => s.trim() : s => s.replace(/(^\s*|\s*$)/g, '');
function serialize(object) {
  if (!isObject(object)) return object;
  const pairs = [];
  for (const key in object) {
    if (hasOwn(object, key)) pushEncodedKeyValuePair(pairs, key, object[key]);
  }
  return pairs.join('&');
}
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
request.serializeObject = serialize;
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
request.parseString = parseString;
request.types = {
  html: 'text/html',
  json: 'application/json',
  xml: 'text/xml',
  urlencoded: 'application/x-www-form-urlencoded',
  form: 'application/x-www-form-urlencoded',
  'form-data': 'application/x-www-form-urlencoded'
};
request.serialize = {
  'application/x-www-form-urlencoded': obj => {
    return qs.stringify(obj, {
      indices: false,
      strictNullHandling: true
    });
  },
  'application/json': safeStringify
};
request.parse = {
  'application/x-www-form-urlencoded': parseString,
  'application/json': JSON.parse
};
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
      continue;
    }
    field = line.slice(0, index).toLowerCase();
    value = trim(line.slice(index + 1));
    fields[field] = value;
  }
  return fields;
}
function isJSON(mime) {
  return /[/+]json($|[^-\w])/i.test(mime);
}
function safeDefineProperty(obj, prop, getter) {
  if (!obj) return;
  try {
    Object.defineProperty(obj, prop, {
      get: getter,
      configurable: true
    });
  } catch (_) {}
}
function Response(request_) {
  this.req = request_;
  this.xhr = this.req.xhr;
  this.text = !this.req._forcedArrayBufferForSize && (this.req.method !== 'HEAD' && (this.xhr.responseType === '' || this.xhr.responseType === 'text') || typeof this.xhr.responseType === 'undefined') ? this.xhr.responseText : null;
  this.statusText = this.req.xhr.statusText;
  let {
    status
  } = this.xhr;
  if (status === 1223) {
    status = 204;
  }
  this._setStatusProperties(status);
  this.headers = parseHeader(this.xhr.getAllResponseHeaders());
  this.header = this.headers;
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
        } catch (e) {}
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
      safeDefineProperty(this.xhr, 'responseText', () => text);
      safeDefineProperty(this.xhr, 'response', () => reconstructedResponse);
    } else {
      let fallbackText = null;
      try {
        if (typeof this.xhr.responseText === 'string') fallbackText = this.xhr.responseText;
      } catch (_) {}
      if (fallbackText === null && typeof this.xhr.response === 'string') {
        fallbackText = this.xhr.response;
      }
      this.text = fallbackText;
    }
  }
  if (this.body !== undefined) {} else if (this.text === null && this.req._responseType) {
    this.body = this.xhr.response;
  } else {
    this.body = this.req.method === 'HEAD' ? null : this._parseBody(typeof this.text === 'string' ? this.text : this.xhr.response);
  }
}
mixin(Response.prototype, ResponseBase.prototype);
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
request.Response = Response;
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
function isBlobOrFile(val) {
  if (!val || typeof val !== 'object') return false;
  if (typeof Blob !== 'undefined' && val instanceof Blob) return true;
  if (typeof File !== 'undefined' && val instanceof File) return true;
  const tag = Object.prototype.toString.call(val);
  return tag === '[object Blob]' || tag === '[object File]' || typeof val.size === 'number' && typeof val.slice === 'function';
}
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
        parts.push(value);
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
      } catch (_) {}
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
      } catch (_) {}
    }
    return undefined;
  } catch (_) {
    return undefined;
  }
}
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
    } catch (_) {}
  }
  if (entries.length === 0) {
    const isKnownEnumerable = fd && (typeof fd.entries === 'function' || typeof fd.forEach === 'function') || req && req._formData === fd;
    if (!isKnownEnumerable) {
      if (req && req._maxRequestSize !== undefined) {
        return req._maxRequestSize + 1;
      }
      return undefined;
    }
  }
  const boundaryLineBytes = 2 + BOUNDARY.length + 2;
  const closingBoundaryBytes = 2 + BOUNDARY.length + 4;
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
      totalBytes += 2;
    } else {
      const headerStr = 'Content-Disposition: form-data; name="' + eName + '"' + CRLF + CRLF;
      totalBytes += getUtf8ByteLength(headerStr);
      const normalizedStr = normalizeLineEndings(value == null ? '' : String(value));
      totalBytes += getUtf8ByteLength(normalizedStr);
      totalBytes += 2;
    }
  }
  totalBytes += closingBoundaryBytes;
  return totalBytes;
}
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
  if (typeof FormData !== 'undefined' && targetData instanceof FormData || targetData && typeof targetData === 'object' && (Object.prototype.toString.call(targetData) === '[object FormData]' || typeof Symbol !== 'undefined' && Symbol.toStringTag && targetData[Symbol.toStringTag] === 'FormData' || targetData.constructor && (targetData.constructor.name === 'FormData' || targetData.constructor.name === 'MockFormData'))) {
    let blob;
    try {
      blob = buildFormDataBlob(targetData, req);
    } catch (_) {}
    if (blob && typeof blob.size === 'number') {
      return blob.size;
    }
    return computeFormDataSize(targetData, req);
  }
  return undefined;
}
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
function getRawXhrByteLength(xhr) {
  if (!xhr) return undefined;
  return getResponseIntrinsicByteLength(xhr.response);
}
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
        count += 3;
        state = STATE_ROMAN;
      }
      count += 1;
    } else if (code <= 0x7f) {
      if (state !== STATE_ASCII) {
        count += 3;
        state = STATE_ASCII;
      }
      count += 1;
    } else {
      if (state !== STATE_JIS) {
        count += 3;
        state = STATE_JIS;
      }
      count += 2;
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length && str.charCodeAt(i + 1) >= 0xdc00 && str.charCodeAt(i + 1) <= 0xdfff) {
        i++;
      }
    }
  }
  if (state !== STATE_ASCII) {
    count += 3;
  }
  return count;
}
function getHzGb2312ByteLength(str) {
  let count = 0;
  let inChinese = false;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 0x7e) {
      if (inChinese) {
        count += 2;
        inChinese = false;
      }
      count += 2;
    } else if (code <= 0x7f) {
      if (inChinese) {
        count += 2;
        inChinese = false;
      }
      count += 1;
    } else {
      if (!inChinese) {
        count += 2;
        inChinese = true;
      }
      count += 2;
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length && str.charCodeAt(i + 1) >= 0xdc00 && str.charCodeAt(i + 1) <= 0xdfff) {
        i++;
      }
    }
  }
  if (inChinese) {
    count += 2;
  }
  return count;
}
const GB18030_TWO_BYTE_RANGES = [0xa4, 0xa4, 0xa7, 0xa8, 0xb0, 0xb1, 0xb7, 0xb7, 0xd7, 0xd7, 0xe0, 0xe1, 0xe8, 0xea, 0xec, 0xed, 0xf2, 0xf3, 0xf7, 0xf7, 0xf9, 0xfa, 0xfc, 0xfc, 0x101, 0x101, 0x113, 0x113, 0x11b, 0x11b, 0x12b, 0x12b, 0x144, 0x144, 0x148, 0x148, 0x14d, 0x14d, 0x16b, 0x16b, 0x1ce, 0x1ce, 0x1d0, 0x1d0, 0x1d2, 0x1d2, 0x1d4, 0x1d4, 0x1d6, 0x1d6, 0x1d8, 0x1d8, 0x1da, 0x1da, 0x1dc, 0x1dc, 0x1f9, 0x1f9, 0x251, 0x251, 0x261, 0x261, 0x2c7, 0x2c7, 0x2c9, 0x2cb, 0x2d9, 0x2d9, 0x391, 0x3a1, 0x3a3, 0x3a9, 0x3b1, 0x3c1, 0x3c3, 0x3c9, 0x401, 0x401, 0x410, 0x44f, 0x451, 0x451, 0x1e3f, 0x1e3f, 0x2010, 0x2010, 0x2013, 0x2016, 0x2018, 0x2019, 0x201c, 0x201d, 0x2025, 0x2026, 0x2030, 0x2030, 0x2032, 0x2033, 0x2035, 0x2035, 0x203b, 0x203b, 0x2103, 0x2103, 0x2105, 0x2105, 0x2109, 0x2109, 0x2116, 0x2116, 0x2121, 0x2121, 0x2160, 0x216b, 0x2170, 0x2179, 0x2190, 0x2193, 0x2196, 0x2199, 0x2208, 0x2208, 0x220f, 0x220f, 0x2211, 0x2211, 0x2215, 0x2215, 0x221a, 0x221a, 0x221d, 0x2220, 0x2223, 0x2223, 0x2225, 0x2225, 0x2227, 0x222b, 0x222e, 0x222e, 0x2234, 0x2237, 0x223d, 0x223d, 0x2248, 0x2248, 0x224c, 0x224c, 0x2252, 0x2252, 0x2260, 0x2261, 0x2264, 0x2267, 0x226e, 0x226f, 0x2295, 0x2295, 0x2299, 0x2299, 0x22a5, 0x22a5, 0x22bf, 0x22bf, 0x2312, 0x2312, 0x2460, 0x2469, 0x2474, 0x249b, 0x2500, 0x254b, 0x2550, 0x2573, 0x2581, 0x258f, 0x2593, 0x2595, 0x25a0, 0x25a1, 0x25b2, 0x25b3, 0x25bc, 0x25bd, 0x25c6, 0x25c7, 0x25cb, 0x25cb, 0x25ce, 0x25cf, 0x25e2, 0x25e5, 0x2605, 0x2606, 0x2609, 0x2609, 0x2640, 0x2640, 0x2642, 0x2642, 0x2e81, 0x2e81, 0x2e84, 0x2e84, 0x2e88, 0x2e88, 0x2e8b, 0x2e8c, 0x2e97, 0x2e97, 0x2ea7, 0x2ea7, 0x2eaa, 0x2eaa, 0x2eae, 0x2eae, 0x2eb3, 0x2eb3, 0x2eb6, 0x2eb7, 0x2ebb, 0x2ebb, 0x2eca, 0x2eca, 0x2ff0, 0x2ffb, 0x3000, 0x3003, 0x3005, 0x3017, 0x301d, 0x301e, 0x3021, 0x3029, 0x303e, 0x303e, 0x3041, 0x3093, 0x309b, 0x309e, 0x30a1, 0x30f6, 0x30fc, 0x30fe, 0x3105, 0x3129, 0x3220, 0x3229, 0x3231, 0x3231, 0x32a3, 0x32a3, 0x338e, 0x338f, 0x339c, 0x339e, 0x33a1, 0x33a1, 0x33c4, 0x33c4, 0x33ce, 0x33ce, 0x33d1, 0x33d2, 0x33d5, 0x33d5, 0x3447, 0x3447, 0x3473, 0x3473, 0x359e, 0x359e, 0x360e, 0x360e, 0x361a, 0x361a, 0x3918, 0x3918, 0x396e, 0x396e, 0x39cf, 0x39d0, 0x39df, 0x39df, 0x3a73, 0x3a73, 0x3b4e, 0x3b4e, 0x3c6e, 0x3c6e, 0x3ce0, 0x3ce0, 0x4056, 0x4056, 0x415f, 0x415f, 0x4337, 0x4337, 0x43ac, 0x43ac, 0x43b1, 0x43b1, 0x43dd, 0x43dd, 0x44d6, 0x44d6, 0x464c, 0x464c, 0x4661, 0x4661, 0x4723, 0x4723, 0x4729, 0x4729, 0x477c, 0x477c, 0x478d, 0x478d, 0x4947, 0x4947, 0x497a, 0x497a, 0x497d, 0x497d, 0x4982, 0x4983, 0x4985, 0x4986, 0x499b, 0x499b, 0x499f, 0x499f, 0x49b6, 0x49b7, 0x4c77, 0x4c77, 0x4c9f, 0x4ca3, 0x4d13, 0x4d19, 0x4dae, 0x4dae, 0x4e00, 0x9fa5, 0xe000, 0xe5e4, 0xe5e6, 0xe76b, 0xe76d, 0xe7c6, 0xe7c9, 0xe7e6, 0xe7f4, 0xe814, 0xe816, 0xe818, 0xe81e, 0xe81e, 0xe826, 0xe826, 0xe82b, 0xe82c, 0xe831, 0xe832, 0xe83b, 0xe83b, 0xe843, 0xe843, 0xe854, 0xe855, 0xe864, 0xe864, 0xf92c, 0xf92c, 0xf979, 0xf979, 0xf995, 0xf995, 0xf9e7, 0xf9e7, 0xf9f1, 0xf9f1, 0xfa0c, 0xfa0f, 0xfa11, 0xfa11, 0xfa13, 0xfa14, 0xfa18, 0xfa18, 0xfa1f, 0xfa21, 0xfa23, 0xfa24, 0xfa27, 0xfa29, 0xfe30, 0xfe31, 0xfe33, 0xfe44, 0xfe49, 0xfe52, 0xfe54, 0xfe57, 0xfe59, 0xfe66, 0xfe68, 0xfe6b, 0xff01, 0xff5e, 0xffe0, 0xffe5];
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
function getTextDecodedByteLength(str, contentType, xhr) {
  const binaryBytes = getRawXhrByteLength(xhr);
  if (binaryBytes !== undefined && (typeof str !== 'string' || binaryBytes > 0)) {
    if (typeof str !== 'string') return binaryBytes;
  }
  if (typeof str !== 'string') return binaryBytes;
  const match = contentType ? /charset\s*=\s*['"]?([^;'"]+)['"]?/i.exec(contentType) : null;
  const charset = match ? match[1].trim().replace(/^['"]|['"]$/g, '').toLowerCase() : '';
  let textBytes;
  if (!charset || /^(?:utf[-_]?8|unicode[-_]?1[-_]?1[-_]?utf[-_]?8)$/i.test(charset)) {
    textBytes = getUtf8ByteLength(str);
  } else if (/^(?:iso[-_]?8859.*|windows[-_]?125\d|windows[-_]?874|tis[-_]?620|cp[-_]?125\d|cp[-_]?[48]\d\d|ibm[-_]?866|latin.*|ascii|us[-_]?ascii|ansi.*|koi8.*|macintosh|x[-_]?mac.*|x[-_]?user[-_]?defined|csiso.*|csascii)$/i.test(charset)) {
    textBytes = str.length;
  } else if (/^(?:utf[-_]?16(?:[-_]?(?:le|be))?|ucs[-_]?2|unicode|csunicode)$/i.test(charset)) {
    textBytes = str.length * 2;
  } else if (/^(?:utf[-_]?32(?:[-_]?(?:le|be))?|ucs[-_]?4)$/i.test(charset)) {
    let count = 0;
    for (let i = 0; i < str.length; i++) {
      count += 4;
      const code = str.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length && str.charCodeAt(i + 1) >= 0xdc00 && str.charCodeAt(i + 1) <= 0xdfff) {
        i++;
      }
    }
    textBytes = count;
  } else if (/^(?:iso[-_]?2022[-_]?jp|csiso2022jp)$/i.test(charset)) {
    textBytes = getIso2022JpByteLength(str);
  } else if (/^(?:hz[-_]?gb[-_]?2312|hz[-_]?gb|hz|cshzgb2312)$/i.test(charset)) {
    textBytes = getHzGb2312ByteLength(str);
  } else if (/^(?:shift[-_]?jis|sjis|windows[-_]?31j|cp932|ms[-_]?kanji|x[-_]?sjis|csshiftjis|gbk|gb[-_]?2312|gb[-_]?18030|csgb18030|chinese|cp[-_]?936|windows[-_]?936|x[-_]?gbk|csgb2312.*|euc[-_]?jp|x[-_]?euc[-_]?jp|cseucpkdfmtjapanese|big5.*|cp950|windows[-_]?950|cn[-_]?big5|euc[-_]?kr|cp949|windows[-_]?949|uhc|korean|ks[-_]?c[-_]?5601.*)$/i.test(charset)) {
    textBytes = getDbcsByteLength(str, charset);
  } else {
    textBytes = getUtf8ByteLength(str);
  }
  return binaryBytes !== undefined ? Math.max(textBytes, binaryBytes) : textBytes;
}
function Request(method, url) {
  const self = this;
  this._query = this._query || [];
  this.method = method;
  this.url = url;
  this.header = {};
  this._header = {};
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
      if (self.xhr) {
        error.rawResponse = typeof self.xhr.responseType === 'undefined' ? self.xhr.responseText : self.xhr.response;
        error.status = self.xhr.status ? self.xhr.status : null;
        error.statusCode = error.status;
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
      new_error = err;
    }
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
Emitter(Request.prototype);
mixin(Request.prototype, RequestBase.prototype);
Request.prototype.type = function (type) {
  this.set('Content-Type', request.types[type] || type);
  return this;
};
Request.prototype.accept = function (type) {
  this.set('Accept', request.types[type] || type);
  return this;
};
Request.prototype.auth = function (user, pass, options) {
  if (arguments.length === 1) pass = '';
  if (typeof pass === 'object' && pass !== null) {
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
Request.prototype.query = function (value) {
  if (typeof value !== 'string') value = serialize(value);
  if (value) this._query.push(value);
  return this;
};
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
Request.prototype.agent = function () {
  console.warn('This is not supported in browser version of superagent');
  return this;
};
Request.prototype.ca = Request.prototype.agent;
Request.prototype.buffer = Request.prototype.ca;
Request.prototype.write = () => {
  throw new Error('Streaming is not supported in browser version of superagent');
};
Request.prototype.pipe = Request.prototype.write;
Request.prototype._isHost = function (object) {
  return object && typeof object === 'object' && !Array.isArray(object) && Object.prototype.toString.call(object) !== '[object Object]';
};
Request.prototype.end = function (fn) {
  if (this._endCalled) {
    console.warn('Warning: .end() was called twice. This is not supported in superagent');
  }
  this._endCalled = true;
  this._callback = fn || noop;
  this._finalizeQueryString();
  this._end();
};
Request.prototype._setUploadTimeout = function () {
  const self = this;
  if (this._uploadTimeout && !this._uploadTimeoutTimer) {
    this._uploadTimeoutTimer = setTimeout(() => {
      self._timeoutError('Upload timeout of ', self._uploadTimeout, 'ETIMEDOUT');
    }, this._uploadTimeout);
  }
};
Request.prototype._end = function () {
  if (this._aborted) return this.callback(this._sizeError || new Error('The request has been aborted even before .end() was called'));
  const self = this;
  this.xhr = request.getXHR();
  const {
    xhr
  } = this;
  let data = this._formDataBlob || this._formData || this._data;
  this._setTimeouts();
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
      if (status === 1223) {
        status = 204;
      }
      const isBodyless = self.method === 'HEAD' || status === 204 || status === 304;
      let finalBytes;
      if (!isBodyless) {
        let raw;
        try {
          if (xhr.response !== undefined && xhr.response !== null) {
            raw = xhr.response;
          }
        } catch (_) {}
        if (raw === undefined || raw === null) {
          try {
            raw = xhr.responseText;
          } catch (_) {
            raw = null;
          }
        }
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
        } catch (_) {}
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
        } catch (_) {}
        const isSameOrigin = isSameOriginRequest(xhr, self.url);
        const isCompressedOrUnexposed = isCompressed || !isSameOrigin && !ce;
        const isKnownIdentity = isEncodingEstablished && !isCompressed || isSameOrigin && !ce;
        const rawEntityBytes = getRawXhrByteLength(xhr);
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
          if (typeof wireBytes === 'number') {
            finalBytes = wireBytes;
          } else if (typeof decodedBytes === 'number') {
            finalBytes = decodedBytes;
          }
        } else if (isCompressed) {
          if (typeof decodedBytes === 'number') {
            finalBytes = decodedBytes;
          } else if (typeof wireBytes === 'number' && wireBytes > self._maxResponseSize) {
            finalBytes = wireBytes;
          } else {
            finalBytes = (self._maxResponseSize || 0) + 1;
          }
        } else if (isCompressedOrUnexposed) {
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
    let status;
    try {
      status = xhr.status;
    } catch (err) {
      status = 0;
    }
    if (status === 305) {
      let loc = '';
      try {
        loc = xhr.getResponseHeader('Location');
      } catch (_) {}
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
      } catch (_) {}
      const isSameOrigin = isSameOriginRequest(xhr, self.url);
      const isKnownIdentity = isEncodingEstablished && !isCompressed || isSameOrigin && !ce;
      if (isKnownIdentity) {
        if (e.loaded > self._maxResponseSize) {
          self._abortWithSizeError('response');
        }
        return;
      }
      let ctHeader = '';
      try {
        ctHeader = xhr.getResponseHeader('Content-Type') || '';
      } catch (_) {}
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
      } catch (_) {}
      if (typeof currentDecoded === 'number') {
        if (currentDecoded > self._maxResponseSize) {
          self._abortWithSizeError('response');
        }
        return;
      }
      if (xhr.readyState === 4) {
        return;
      }
    }
  };
  try {
    if (this.hasListeners('progress') || this._maxResponseSize !== undefined) {
      xhr.addEventListener('progress', handleProgress.bind(null, 'download'));
    }
    if (xhr.upload && (this.hasListeners('progress') || this._maxRequestSize !== undefined)) {
      xhr.upload.addEventListener('progress', handleProgress.bind(null, 'upload'));
    }
  } catch (err) {}
  if (xhr.upload) {
    this._setUploadTimeout();
  }
  try {
    if (this.username && this.password) {
      xhr.open(this.method, this.url, true, this.username, this.password);
    } else {
      xhr.open(this.method, this.url, true);
    }
  } catch (err) {
    return this.callback(err);
  }
  if (this._withCredentials) xhr.withCredentials = true;
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
        } catch (_) {}
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
    const contentType = this._header['content-type'];
    let serialize = this._serializer || request.serialize[contentType ? contentType.split(';')[0] : ''];
    if (!serialize && isJSON(contentType)) {
      serialize = request.serialize['application/json'];
    }
    if (serialize) data = serialize(data);
  }
  for (const field in this.header) {
    if (this.header[field] === null) continue;
    if (hasOwn(this.header, field)) xhr.setRequestHeader(field, this.header[field]);
  }
  if (this._responseType) {
    try {
      xhr.responseType = this._responseType;
    } catch (_) {}
  }
  const preEventXhrType = typeof xhr.responseType === 'string' ? xhr.responseType.toLowerCase() : '';
  const preEventReqType = (this._responseType || '').toLowerCase();
  this.emit('request', this);
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
      } catch (_) {}
      this._forcedArrayBufferForSize = false;
    } else if (requestedResponseType === 'arraybuffer') {
      try {
        xhr.responseType = 'arraybuffer';
      } catch (_) {}
      this._forcedArrayBufferForSize = false;
    } else {
      try {
        xhr.responseType = 'arraybuffer';
        this._forcedArrayBufferForSize = true;
      } catch (_) {
        this._forcedArrayBufferForSize = false;
        if (requestedResponseType) {
          try {
            xhr.responseType = requestedResponseType;
          } catch (_) {}
        }
      }
    }
  } else if (requestedResponseType) {
    try {
      xhr.responseType = requestedResponseType;
    } catch (_) {}
    this._forcedArrayBufferForSize = false;
  }
  if (this._maxRequestSize !== undefined && this.method !== 'GET' && this.method !== 'HEAD') {
    const payload = data !== undefined ? data : this._formData;
    const byteLength = getRequestBodySize(payload, this);
    if (byteLength !== undefined && byteLength > this._maxRequestSize) {
      this._abortWithSizeError('request');
      return;
    }
  }
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

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer)
},{"./agent-base":73,"./request-base":75,"./response-base":76,"./utils":77,"buffer":4,"component-emitter":13,"fast-safe-stringify":25,"qs":59,"util":71}],75:[function(require,module,exports){
const {
  isObject,
  hasOwn
} = require('./utils');
module.exports = RequestBase;
function RequestBase() {}
RequestBase.prototype.clearTimeout = function () {
  clearTimeout(this._timer);
  clearTimeout(this._responseTimeoutTimer);
  clearTimeout(this._uploadTimeoutTimer);
  delete this._timer;
  delete this._responseTimeoutTimer;
  delete this._uploadTimeoutTimer;
  return this;
};
RequestBase.prototype.parse = function (fn) {
  this._parser = fn;
  return this;
};
RequestBase.prototype.responseType = function (value) {
  this._responseType = value;
  return this;
};
RequestBase.prototype.serialize = function (fn) {
  this._serializer = fn;
  return this;
};
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
RequestBase.prototype.retry = function (count, fn) {
  if (arguments.length === 0 || count === true) count = 1;
  if (count <= 0) count = 0;
  this._maxRetries = count;
  this._retries = 0;
  this._retryCallback = fn;
  return this;
};
const ERROR_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'EADDRINUSE', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'ENETUNREACH', 'EAI_AGAIN']);
const STATUS_CODES = new Set([408, 413, 429, 500, 502, 503, 504, 521, 522, 524]);
RequestBase.prototype._shouldRetry = function (error, res) {
  if (this.called) {
    return false;
  }
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
    } catch (err) {
      console.error(err);
    }
  }
  if (res && res.status && STATUS_CODES.has(res.status)) return true;
  if (error) {
    if (error.code && ERROR_CODES.has(error.code)) return true;
    if (error.timeout && error.code === 'ECONNABORTED') return true;
    if (error.crossDomain) return true;
  }
  return false;
};
RequestBase.prototype._retry = function () {
  if (this.called) {
    return false;
  }
  if (this._formDataSpoolPromise && !this._formDataTmpPath) {
    this._formDataSpoolPromise.then(() => {
      this._retry();
    }).catch(() => {});
    return true;
  }
  this.called = false;
  this.clearTimeout();
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
  this._uploadComplete = false;
  this._resEnded = false;
  this._pendingUnbufferedResponse = null;
  this._pendingBufferedResponse = null;
  return this._end();
};
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
RequestBase.prototype.get = function (field) {
  return this._header[field.toLowerCase()];
};
RequestBase.prototype.getHeader = RequestBase.prototype.get;
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
RequestBase.prototype.unset = function (field) {
  delete this._header[field.toLowerCase()];
  delete this.header[field];
  return this;
};
RequestBase.prototype.field = function (name, value, options) {
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
  if (value === null || undefined === value) {
    throw new Error('.field(name, val) val can not be empty');
  }
  if (typeof value === 'boolean') {
    value = String(value);
  }
  if (!this._formFields) this._formFields = [];
  this._formFields.push([name, value, options]);
  if (options) this._getFormData().append(name, value, options);else this._getFormData().append(name, value);
  return this;
};
RequestBase.prototype.abort = function () {
  if (this._aborted) {
    return this;
  }
  this._aborted = true;
  if (typeof this._cleanupSpoolFile === 'function') {
    this._cleanupSpoolFile();
  }
  if (this.xhr) this.xhr.abort();
  if (this.req) {
    this.req.abort();
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
      this.set('Authorization', `Bearer ${user}`);
      break;
    default:
      break;
  }
  return this;
};
RequestBase.prototype.withCredentials = function (on) {
  if (on === undefined) on = true;
  this._withCredentials = on;
  return this;
};
RequestBase.prototype.redirects = function (n) {
  this._maxRedirects = n;
  return this;
};
RequestBase.prototype.maxResponseSize = function (n) {
  if (typeof n !== 'number') {
    throw new TypeError('Invalid argument');
  }
  this._maxResponseSize = n;
  return this;
};
RequestBase.prototype.maxRequestSize = function (n) {
  if (typeof n !== 'number') {
    throw new TypeError('Invalid argument');
  }
  this._maxRequestSize = n;
  return this;
};
RequestBase.prototype.hasSizeError = function () {
  return Boolean(this._sizeError);
};
RequestBase.prototype.toJSON = function () {
  return {
    method: this.method,
    url: this.url,
    data: this._data,
    headers: this._header
  };
};
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
  if (isObject_ && isObject(this._data)) {
    for (const key in data) {
      if (typeof data[key] == 'bigint' && !data[key].toJSON) throw new Error('Cannot serialize BigInt value to json');
      if (hasOwn(data, key)) this._data[key] = data[key];
    }
  } else if (typeof data === 'bigint') throw new Error("Cannot send value of type BigInt");else if (typeof data === 'string') {
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
  if (!type) this.type('json');
  return this;
};
RequestBase.prototype.sortQuery = function (sort) {
  this._sort = typeof sort === 'undefined' ? true : sort;
  return this;
};
RequestBase.prototype._finalizeQueryString = function () {
  const query = this._query.join('&');
  if (query) {
    this.url += (this.url.includes('?') ? '&' : '?') + query;
  }
  this._query.length = 0;
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
RequestBase.prototype._appendQueryString = () => {
  console.warn('Unsupported');
};
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
  if (this._timeout && !this._timer) {
    this._timer = setTimeout(() => {
      self._timeoutError('Timeout of ', self._timeout, 'ETIME');
    }, this._timeout);
  }
  if (this._responseTimeout && !this._responseTimeoutTimer) {
    this._responseTimeoutTimer = setTimeout(() => {
      self._timeoutError('Response timeout of ', self._responseTimeout, 'ETIMEDOUT');
    }, this._responseTimeout);
  }
};

},{"./utils":77}],76:[function(require,module,exports){
const utils = require('./utils');
module.exports = ResponseBase;
function ResponseBase() {}
ResponseBase.prototype.get = function (field) {
  return this.header[field.toLowerCase()];
};
ResponseBase.prototype._setHeaderProperties = function (header) {
  const ct = header['content-type'] || '';
  this.type = utils.type(ct);
  const parameters = utils.params(ct);
  for (const key in parameters) {
    if (Object.prototype.hasOwnProperty.call(parameters, key)) this[key] = parameters[key];
  }
  this.links = {};
  try {
    if (header.link) {
      this.links = utils.parseLinks(header.link);
    }
  } catch (err) {}
};
ResponseBase.prototype._setStatusProperties = function (status) {
  const type = Math.trunc(status / 100);
  this.statusCode = status;
  this.status = this.statusCode;
  this.statusType = type;
  this.info = type === 1;
  this.ok = type === 2;
  this.redirect = type === 3;
  this.clientError = type === 4;
  this.serverError = type === 5;
  this.error = type === 4 || type === 5 ? this.toError() : false;
  this.created = status === 201;
  this.accepted = status === 202;
  this.noContent = status === 204;
  this.badRequest = status === 400;
  this.unauthorized = status === 401;
  this.notAcceptable = status === 406;
  this.forbidden = status === 403;
  this.notFound = status === 404;
  this.unprocessableEntity = status === 422;
};

},{"./utils":77}],77:[function(require,module,exports){
exports.type = string_ => string_.split(/ *; */).shift();
exports.params = value => {
  const object = {};
  for (const string_ of value.split(/ *; */)) {
    const parts = string_.split(/ *= */);
    const key = parts.shift();
    const value = parts.shift();
    if (key && value) object[key] = value;
  }
  return object;
};
exports.parseLinks = value => {
  const object = {};
  for (const string_ of value.split(/ *, */)) {
    const parts = string_.split(/ *; */);
    const url = parts[0].slice(1, -1);
    const rel = parts[1].split(/ *= */)[1].slice(1, -1);
    object[rel] = url;
  }
  return object;
};
exports.cleanHeader = (header, changesOrigin) => {
  delete header['content-type'];
  delete header['content-length'];
  delete header['transfer-encoding'];
  delete header.host;
  if (changesOrigin) {
    delete header.authorization;
    delete header.cookie;
  }
  return header;
};
exports.normalizeHostname = hostname => {
  const [, normalized] = hostname.match(/^\[([^\]]+)\]$/) || [];
  return normalized || hostname;
};
exports.isObject = object => {
  return object !== null && typeof object === 'object';
};
exports.hasOwn = Object.hasOwn || function (object, property) {
  if (object == null) {
    throw new TypeError('Cannot convert undefined or null to object');
  }
  return Object.prototype.hasOwnProperty.call(new Object(object), property);
};
exports.mixin = (target, source) => {
  for (const key in source) {
    if (exports.hasOwn(source, key)) {
      target[key] = source[key];
    }
  }
};
exports.isGzipOrDeflateEncoding = res => {
  return new RegExp(/^\s*(?:deflate|gzip)\s*$/).test(res.headers['content-encoding']);
};
exports.isBrotliEncoding = res => {
  return new RegExp(/^\s*(?:br)\s*$/).test(res.headers['content-encoding']);
};

},{}]},{},[74])(74)
});

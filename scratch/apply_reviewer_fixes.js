const fs = require('fs');

// --- 1. Edit src/client.js ---
let client = fs.readFileSync('superagent/src/client.js', 'utf8');

// Replace getTextDecodedByteLength definition
const oldFnStart = "function getTextDecodedByteLength(str, contentType, isCompressed) {";
const oldFnEnd = "  return fallbackBytes;\n}";

const newFn = `function getTextDecodedByteLength(str, contentType) {
  if (typeof str !== 'string') return undefined;
  if (!contentType) {
    return getUtf8ByteLength(str);
  }

  const match = /charset\\s*=\\s*['"]?([^;'"]+)['"]?/i.exec(contentType);
  if (!match) {
    return getUtf8ByteLength(str);
  }

  const charset = match[1].trim().replace(/^['"]|['"]$/g, '').toLowerCase();

  // UTF-8 explicitly declared:
  if (/^(?:utf[-_]?8)$/i.test(charset)) {
    return getUtf8ByteLength(str);
  }

  // Single-byte charsets: string length equals byte length
  if (/^(?:iso[-_]?8859.*|windows[-_]?125\\d|windows[-_]?874|cp[-_]?125\\d|cp[-_]?[48]\\d\\d|ibm[-_]?866|latin.*|ascii|us[-_]?ascii|koi8.*|macintosh|x[-_]?user[-_]?defined)$/i.test(charset)) {
    return str.length;
  }

  // UTF-16 / UCS-2 multibyte charsets: each 16-bit code unit is 2 bytes
  if (/^(?:utf[-_]?16(?:[-_]?(?:le|be))?|ucs[-_]?2|unicode)$/i.test(charset)) {
    return str.length * 2;
  }

  // UTF-32 / UCS-4 multibyte charsets: each code point is 4 bytes
  if (/^(?:utf[-_]?32(?:[-_]?(?:le|be))?|ucs[-_]?4)$/i.test(charset)) {
    let count = 0;
    for (let i = 0; i < str.length; i++) {
      count += 4;
      const code = str.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length && str.charCodeAt(i + 1) >= 0xdc00 && str.charCodeAt(i + 1) <= 0xdfff) {
        i++; // surrogate pair represents a single 4-byte code point
      }
    }
    return count;
  }

  // ISO-2022-JP stateful shift encoding:
  if (/^(?:iso[-_]?2022[-_]?jp|csiso2022jp)$/i.test(charset)) {
    return getIso2022JpByteLength(str);
  }

  // Shift_JIS / Windows-31J / CP932 / SJIS / MS_Kanji:
  if (/^(?:shift[-_]?jis|sjis|windows[-_]?31j|cp932|ms[-_]?kanji|x[-_]?sjis|csshiftjis)$/i.test(charset)) {
    return getCjkDbcsByteLength(str, { halfWidthKatakana: true });
  }

  // GB18030:
  if (/^(?:gb18030)$/i.test(charset)) {
    return getCjkDbcsByteLength(str, { astral4Bytes: true });
  }

  // Standard CJK DBCS encodings (EUC-JP, GBK, GB2312, Big5, EUC-KR):
  if (/^(?:euc[-_]?jp|x[-_]?euc[-_]?jp|cseucpkdfmtjapanese|gbk|gb2312|chinese|cp936|windows[-_]?936|x[-_]?gbk|csgb2312.*|hz[-_]?gb.*|big5.*|cp950|windows[-_]?950|cn[-_]?big5|euc[-_]?kr|cp949|windows[-_]?949|uhc|korean|ks[-_]?c[-_]?5601.*)$/i.test(charset)) {
    return getCjkDbcsByteLength(str);
  }

  // Fallback: UTF-8 encoding
  return getUtf8ByteLength(str);
}`;

const startIdx = client.indexOf(oldFnStart);
if (startIdx !== -1) {
  const endIdx = client.indexOf(oldFnEnd, startIdx);
  if (endIdx !== -1) {
    client = client.slice(0, startIdx) + newFn + client.slice(endIdx + oldFnEnd.length);
    console.log('Replaced getTextDecodedByteLength definition.');
  } else {
    console.error('Could not find oldFnEnd!');
  }
} else {
  console.log('getTextDecodedByteLength already updated.');
}

// Replace callers in client.js
client = client.replace('getTextDecodedByteLength(raw, ctHeader, isCompressedOrUnexposed);', 'getTextDecodedByteLength(raw, ctHeader);');
client = client.replace('getTextDecodedByteLength(currentRaw, ctHeader, isCompressed || (!isSameOrigin && !ce));', 'getTextDecodedByteLength(currentRaw, ctHeader);');

// Replace FormData serialization condition
client = client.replace(
  'const hasSizeLimit = this._maxRequestSize !== undefined || this._maxResponseSize !== undefined;',
  'const needsFormDataSerialization = (this._maxRequestSize !== undefined) || (this._maxRetries > 0);'
);
client = client.replace('if (hasSizeLimit && this.method !==', 'if (needsFormDataSerialization && this.method !==');

fs.writeFileSync('superagent/src/client.js', client, 'utf8');
console.log('src/client.js updated successfully.');

// --- 2. Edit src/node/index.js ---
let nodeIndex = fs.readFileSync('superagent/src/node/index.js', 'utf8');

const isReplayableHelper = `/**
 * Check if a Node FormData instance is composed exclusively of in-memory replayable parts
 * (strings, Buffers) rather than arbitrary non-repeatable Stream objects.
 *
 * @param {FormData} formData
 * @return {Boolean}
 * @api private
 */
function isReplayableFormData(formData) {
  if (!formData || !Array.isArray(formData._streams)) return false;
  for (let i = 0; i < formData._streams.length; i++) {
    const part = formData._streams[i];
    if (part && typeof part === 'object' && typeof part.pipe === 'function' && !Buffer.isBuffer(part)) {
      return false; // Non-repeatable stream object (e.g. fs.createReadStream)
    }
  }
  return true;
}

/**
 * Serialize a Node FormData instance into a Buffer, enforcing bounds during streaming.
 * When maxRequestSize is defined, it caps the allocation and triggers ETOOLARGE if exceeded.
 * When maxRequestSize is undefined (response-only limit), it applies a default memory replay spool
 * cap (2 MB) so that response limits never create an unbounded in-memory heap allocation.
 *
 * @param {FormData} formData
 * @param {Number} [maxRequestSize]
 * @param {Function} callback (err, buffer)
 * @api private
 */
function serializeFormData(formData, maxRequestSize, callback) {
  const DEFAULT_REPLAY_SPOOL_CAP = 2 * 1024 * 1024; // 2 MB bounded replay spool
  const limit = maxRequestSize !== undefined ? maxRequestSize : DEFAULT_REPLAY_SPOOL_CAP;
  const chunks = [];
  let totalLength = 0;
  let hasError = false;

  const onData = (chunk) => {
    if (hasError) return;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalLength += buf.length;
    if (totalLength > limit) {
      hasError = true;
      formData.removeListener('data', onData);
      formData.removeListener('end', onEnd);
      formData.removeListener('error', onError);
      if (typeof formData.destroy === 'function') {
        formData.destroy();
      } else if (typeof formData.resume === 'function') {
        formData.resume();
      }
      if (maxRequestSize !== undefined) {
        const err = new Error('Maximum request size reached');
        err.code = 'ETOOLARGE';
        err.retries = 0;
        return callback(err);
      }
      const err = new Error('Multipart payload exceeds replay spool memory limit');
      err.code = 'EMEMORYLIMIT';
      return callback(err);
    }
    chunks.push(buf);
  };

  const onEnd = () => {
    if (hasError) return;
    callback(null, Buffer.concat(chunks));
  };

  const onError = (err) => {
    if (hasError) return;
    hasError = true;
    callback(err);
  };

  formData.on('data', onData);
  formData.once('end', onEnd);
  formData.once('error', onError);
  formData.resume();
}`;

const oldSerializeStart = "function serializeFormData(formData, maxRequestSize, callback) {";
const oldSerializeEnd = "  formData.resume();\n}";

if (!nodeIndex.includes('isReplayableFormData')) {
  const sIdx = nodeIndex.indexOf(oldSerializeStart);
  if (sIdx !== -1) {
    const eIdx = nodeIndex.indexOf(oldSerializeEnd, sIdx);
    if (eIdx !== -1) {
      // Find comment before oldSerializeStart
      const commentIdx = nodeIndex.lastIndexOf('/**', sIdx);
      nodeIndex = nodeIndex.slice(0, commentIdx) + isReplayableHelper + nodeIndex.slice(eIdx + oldSerializeEnd.length);
      console.log('Replaced serializeFormData with bounded version.');
    }
  }
} else {
  console.log('isReplayableFormData already present in node/index.js.');
}

const oldReplayCheck = `    const hasSizeLimit = this._maxRequestSize !== undefined || this._maxResponseSize !== undefined;
    const needsMultipartReplay = hasSizeLimit && (this._maxRetries > 0);`;

const newReplayCheck = `    const isReplayable = isReplayableFormData(formData);
    const needsMultipartReplay = (this._maxRetries > 0) && (
      (this._maxRequestSize !== undefined) ||
      (this._maxResponseSize !== undefined && isReplayable)
    );`;

if (nodeIndex.includes(oldReplayCheck)) {
  nodeIndex = nodeIndex.replace(oldReplayCheck, newReplayCheck);
  console.log('Updated needsMultipartReplay check.');
} else {
  console.log('needsMultipartReplay already updated.');
}

fs.writeFileSync('superagent/src/node/index.js', nodeIndex, 'utf8');
console.log('src/node/index.js updated successfully.');

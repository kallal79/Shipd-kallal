const fs = require('fs');
const cp = require('child_process');
const path = require('path');

const ROOT_DIR = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const CLEAN_REPO = path.join(ROOT_DIR, 'JAGAN_superagent_clean');

// 1. Reset repo to base
cp.execSync('git reset --hard v10.2.3 && git clean -fd', { cwd: CLEAN_REPO, stdio: 'ignore' });

// 2. Apply clean_solution_src_only.patch
const cleanPatch = path.join(ROOT_DIR, 'clean_solution_src_only.patch');
if (fs.existsSync(cleanPatch)) {
  cp.execSync(`git apply --ignore-whitespace "${cleanPatch}"`, { cwd: CLEAN_REPO, stdio: 'ignore' });
  console.log('Applied clean_solution_src_only.patch');
}

// 3. Apply client.js fixes (getRequestBodySize and upfront check)
const clientPath = path.join(CLEAN_REPO, 'src', 'client.js');
let clientCode = fs.readFileSync(clientPath, 'utf8').replace(/\r\n/g, '\n');

const getRequestBodySizeCode = `
function getRequestBodySize(data) {
  if (data == null) return 0;
  if (typeof data === 'string') {
    return typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(data).length
      : unescape(encodeURIComponent(data)).length;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(data)) {
    return data.length;
  }
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(data)) {
    return data.byteLength;
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return data.size;
  }
  if (
    (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) ||
    (data && typeof data === 'object' && (data[Symbol.toStringTag] === 'URLSearchParams' || (data.constructor && data.constructor.name === 'URLSearchParams')))
  ) {
    const str = data.toString();
    return typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(str).length
      : unescape(encodeURIComponent(str)).length;
  }
  if (typeof Document !== 'undefined' && data instanceof Document) {
    const str = new XMLSerializer().serializeToString(data);
    return typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(str).length
      : unescape(encodeURIComponent(str)).length;
  }
  if (typeof FormData !== 'undefined' && data instanceof FormData) {
    return undefined;
  }
  if (data && typeof data === 'object') {
    const str = JSON.stringify(data);
    return typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(str).length
      : unescape(encodeURIComponent(str)).length;
  }
  return undefined;
}
`;

if (!clientCode.includes('function getRequestBodySize')) {
  clientCode = clientCode.replace('function noop() {}', 'function noop() {}\n' + getRequestBodySizeCode);
}

// Add client _abortWithSizeError and size checking
const clientEndCheck = `
    this.emit('request', this);

    if (this._maxRequestSize !== undefined) {
      const byteLength = getRequestBodySize(data);
      if (byteLength !== undefined && byteLength > this._maxRequestSize) {
        this._abortWithSizeError('request');
        return;
      }
    }
`;
if (!clientCode.includes('getRequestBodySize(data)')) {
  clientCode = clientCode.replace("this.emit('request', this);", clientEndCheck.trim());
}

fs.writeFileSync(clientPath, clientCode, 'utf8');

// 4. Update request-base.js (hasSizeError, _abortWithSizeError, _shouldRetry)
const reqBasePath = path.join(CLEAN_REPO, 'src', 'request-base.js');
let reqBaseCode = fs.readFileSync(reqBasePath, 'utf8').replace(/\r\n/g, '\n');

const reqBaseMethods = `
/**
 * Abort the request because it exceeded its size limit.
 * 
 * @param {String} type 'request' or 'response'
 * @return {Error} size error
 * @api private
 */
RequestBase.prototype._abortWithSizeError = function (type) {
  if (this.hasSizeError()) return this._sizeError;

  const error = new Error(\`Maximum \${type} size reached\`);
  error.code = 'ETOOLARGE';
  this._sizeError = error;
  this.abort();
  this.callback(error, type === 'response' ? null : undefined);
  return error;
};
`;

if (!reqBaseCode.includes('RequestBase.prototype._abortWithSizeError')) {
  reqBaseCode = reqBaseCode.replace('RequestBase.prototype.hasSizeError = function () {', reqBaseMethods + '\nRequestBase.prototype.hasSizeError = function () {');
}

// Add retry suppression
const retryFix = `
RequestBase.prototype._shouldRetry = function (error, res) {
  if (this.hasSizeError() || (error && error.code === 'ETOOLARGE')) {
    return false;
  }
`;
if (!reqBaseCode.includes('if (this.hasSizeError() || (error && error.code === \'ETOOLARGE\'))')) {
  reqBaseCode = reqBaseCode.replace('RequestBase.prototype._shouldRetry = function (error, res) {', retryFix.trim());
}

fs.writeFileSync(reqBasePath, reqBaseCode, 'utf8');

// 5. Update src/node/index.js (T13 write after end guard and unbuffered chunked response check)
const nodeIndexPath = path.join(CLEAN_REPO, 'src', 'node', 'index.js');
let nodeIndexCode = fs.readFileSync(nodeIndexPath, 'utf8').replace(/\r\n/g, '\n');

// Guard write() against writing to ended request
const writeGuard = `
Request.prototype.write = function (data, encoding) {
  const length = Buffer.isBuffer(data)
    ? data.length
    : Buffer.byteLength(data, encoding);
  this._requestBytesSent = (this._requestBytesSent || 0) + length;
  if (!this._checkRequestSize(this._requestBytesSent)) {
    return false;
  }

  const request_ = this.request();
  if (!this._streamRequest) {
    this._streamRequest = true;
  }

  if (request_ && (request_.writableEnded || request_.finished || request_.destroyed)) {
    return false;
  }

  try {
    return request_.write(data, encoding);
  } catch (err) {
    return false;
  }
};
`;

nodeIndexCode = nodeIndexCode.replace(/Request\.prototype\.write = function \([\s\S]*?return request_\.write\(data, encoding\);\n\};/, writeGuard.trim());

// Unbuffered response handling with maxResponseSize
const unbufferedFix = `
    // unbuffered (when no response size limit is set, complete immediately at headers)
    if (!buffer && this._maxResponseSize === undefined) {
      debug('unbuffered %s %s', this.method, this.url);
      this.callback(null, this._emitResponse());
      return;
    }
`;
nodeIndexCode = nodeIndexCode.replace(/\/\/ unbuffered\n    if \(!buffer\) \{[\s\S]*?return;\n    \}/, unbufferedFix.trim());

fs.writeFileSync(nodeIndexPath, nodeIndexCode, 'utf8');

// 6. Generate FINAL_solution.patch
const diff = cp.execSync('git diff v10.2.3 src', { cwd: CLEAN_REPO, encoding: 'utf8' }).replace(/\r\n/g, '\n');
fs.writeFileSync(path.join(ROOT_DIR, 'FINAL_solution.patch'), diff, 'utf8');
console.log('FINAL_solution.patch freshly generated! Length:', diff.length);

// 7. Ensure test/node/hidden_verify.js and FINAL_test.patch are synchronized
const testPatch = cp.execSync(`git diff v10.2.3 test/node/hidden_verify.js test/node/basic.js test.sh`, { cwd: CLEAN_REPO, encoding: 'utf8' }).replace(/\r\n/g, '\n');
if (testPatch && testPatch.length > 500) {
  fs.writeFileSync(path.join(ROOT_DIR, 'FINAL_test.patch'), testPatch, 'utf8');
  console.log('FINAL_test.patch freshly generated! Length:', testPatch.length);
}

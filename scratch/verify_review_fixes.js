const fs = require('fs');
const vm = require('vm');

// Test 1: Verify browser decoded text calculation for 1-byte gzip response
const clientCode = fs.readFileSync('superagent/src/client.js', 'utf8');
const sandbox = {
  TextEncoder: global.TextEncoder,
  unescape: global.unescape,
  encodeURIComponent: global.encodeURIComponent,
  module: { exports: {} },
  require: () => ({})
};
vm.createContext(sandbox);

// Extract helper functions from client.js
const helpers = clientCode.slice(
  clientCode.indexOf('function getUtf8ByteLength'),
  clientCode.indexOf('function Request(')
);
vm.runInContext(helpers, sandbox);

const measured1 = sandbox.getTextDecodedByteLength('a', 'text/plain; charset=utf-8');
console.log('=== TEST 1: Browser gzip entity "a" (no BOM) with maxResponseSize(1) ===');
console.log('  Measured bytes:          ', measured1);
console.log('  With maxResponseSize(1): ', measured1 <= 1 ? 'PASS (<= 1)' : 'FAIL (> 1)');
console.log('  Does NOT falsely abort:  ', measured1 <= 1);

// Test 1b: Verify actual BOM character IS counted
const measuredBOM = sandbox.getTextDecodedByteLength('\uFEFFa', 'text/plain; charset=utf-8');
console.log('\n=== TEST 1b: Browser UTF-8 with BOM "\\uFEFFa" ===');
console.log('  Measured bytes:          ', measuredBOM);
console.log('  With maxResponseSize(1): ', measuredBOM > 1 ? 'PASS (correctly aborts)' : 'FAIL');

// Test 2: Node serializeFormData and isReplayableFormData
const nodeCode = fs.readFileSync('superagent/src/node/index.js', 'utf8');
const isReplayableStart = nodeCode.indexOf('function isReplayableFormData');
const isReplayableCode = nodeCode.slice(isReplayableStart, nodeCode.indexOf('function serializeFormData'));
sandbox.Buffer = Buffer;
vm.runInContext(isReplayableCode, sandbox);

// Mock a stream upload
const streamMock = {
  _streams: [
    '--boundary\r\n',
    { pipe: () => {} } // readable stream (e.g. fs.createReadStream)
  ]
};
const inMemoryMock = {
  _streams: [
    '--boundary\r\n',
    Buffer.from('key=val')
  ]
};

console.log('\n=== TEST 2: Node multipart replay streaming vs in-memory ===');
console.log('  Stream upload isReplayable:    ', sandbox.isReplayableFormData(streamMock), '(must be false)');
console.log('  In-memory upload isReplayable: ', sandbox.isReplayableFormData(inMemoryMock), '(must be true)');

// Verify serializeFormData default spool cap
const serializeStart = nodeCode.indexOf('function serializeFormData');
const serializeCode = nodeCode.slice(serializeStart, serializeStart + 2000);
console.log('  Default 2MB spool cap enforced:', serializeCode.includes('DEFAULT_REPLAY_SPOOL_CAP = 2 * 1024 * 1024'));
console.log('  EMEMORYLIMIT error code defined:', serializeCode.includes("err.code = 'EMEMORYLIMIT'"));

const fs = require('fs');
const path = require('path');

const srcNode = fs.readFileSync('superagent/src/node/index.js', 'utf8');
const srcClient = fs.readFileSync('superagent/src/client.js', 'utf8');
const srcReqBase = fs.readFileSync('superagent/src/request-base.js', 'utf8');
const srcUnzip = fs.readFileSync('superagent/src/node/unzip.js', 'utf8');

console.log('=== VERIFYING ISSUE 1: Node multipart replay on retry ===');
console.log('src/node/index.js has serializeFormData:', srcNode.includes('function serializeFormData('));
console.log('src/node/index.js has _formDataSerialized:', srcNode.includes('this._formDataSerialized'));
console.log('src/node/index.js replays headers:', srcNode.includes('this._formDataHeaders'));

console.log('\n=== VERIFYING ISSUE 2: Piped response oversized Content-Length precheck ===');
console.log('src/node/index.js _pipeContinue has precheck:', srcNode.includes('hasNonEmptyResponseContent(res) && !this._shouldDecompress(res)'));
console.log('src/node/index.js _pipeContinue checks Content-Length before data:', srcNode.includes('this._abortWithSizeError(\'response\')'));

console.log('\n=== VERIFYING ISSUE 3: Unexposed compressed browser responses deferred ===');
console.log('src/client.js defers unexposed compression progress:', srcClient.includes('isBinaryResponseType') && srcClient.includes('return; // Defer to terminal check'));

console.log('\n=== VERIFYING ISSUE 4: No malformed duplicate JSDoc comment in src/client.js ===');
console.log('src/client.js has duplicate /** opener:', srcClient.includes('/** Build an exact Blob representation\n/** Generate a high-entropy'));
console.log('src/client.js clean JSDoc for generateMultipartBoundary:', srcClient.includes('/**\n * Generate a high-entropy random multipart boundary string.'));
console.log('src/client.js clean JSDoc for buildFormDataBlob:', srcClient.includes('/**\n * Build an exact Blob representation of a FormData object'));

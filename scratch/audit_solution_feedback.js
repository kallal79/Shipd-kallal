const fs = require('fs');

const sol = fs.readFileSync('c:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_SOLUTION.patch', 'utf8');

console.log('=== CHECK 1: Response.prototype emit override ===');
console.log('Contains Response.prototype.emit:', sol.includes('Response.prototype.emit'));
console.log('Contains Response.prototype.on:', sol.includes('Response.prototype.on'));
console.log('Contains Response.prototype.addListener:', sol.includes('Response.prototype.addListener'));
console.log('Contains _queuedChunks:', sol.includes('_queuedChunks'));
console.log('Contains attachResponseDataHandler:', sol.includes('attachResponseDataHandler'));

console.log('\n=== CHECK 2: Multipart replay in Node ===');
console.log('Contains _maxRequestSize !== undefined && (_maxRetries > 0):', sol.includes('_maxRequestSize !== undefined && (_maxRetries > 0)'));
console.log('Contains this._maxRequestSize !== undefined || this._maxResponseSize !== undefined in node:', sol.includes('this._maxRequestSize !== undefined || this._maxResponseSize !== undefined'));

console.log('\n=== CHECK 3: Multipart replay in Browser ===');
const clientPart = sol.slice(0, sol.indexOf('diff --git a/src/node/'));
console.log('Client hasSizeLimit check:', clientPart.includes('this._maxRequestSize !== undefined || this._maxResponseSize !== undefined'));

console.log('\n=== CHECK 4: Unbuffered end event forwarding ===');
console.log('Contains res.once("end"):', sol.includes('res.once(\'end\''));
console.log('Contains listeners("data").length === 0:', sol.includes('listeners(\'data\').length === 0'));

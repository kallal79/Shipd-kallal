const fs = require('fs');

const desc = `Implement transfer boundary controls across Node.js and browser runtimes with chainable maxRequestSize and maxResponseSize methods and a boolean hasSizeError() state query.

When a transfer exceeds configured thresholds, immediately abort with an Error (code = 'ETOOLARGE') and ensure terminal callback execution occurs exactly once. Size errors must report err.retries as 0. For requests configured with size limits encountering transient non-size errors, serialized multipart payloads must be preserved and replayed across retry attempts and method-preserving redirects. Emitted progress events must expose an explicit direction property ('upload' or 'download').

Node.js:
- Enforce limits across buffered payloads, unbuffered streaming chunks, and intermediate redirects.
- Cumulative write() calls exceeding maxRequestSize must return false.
- Prevent premature aborts on bodyless HTTP statuses (HEAD, 204, 304, 1223) carrying Content-Length headers.

Browsers:
- Preflight byte sizes for strings, Blobs, and native FormData (with boundary overhead) when upload progress is unavailable.
- Measure decoded text sizes for compressed responses honoring BOM markers and character encoding rules even when CORS unexposes Content-Encoding.`;

const words = desc.trim().split(/\s+/);
console.log('Word count:', words.length);
console.log('Target: 100 - 200 words. In range:', words.length >= 100 && words.length <= 200);

fs.writeFileSync('C:/Users/USER/OneDrive/Desktop/JAGAN/problem_description.md', desc + '\n', 'utf8');
fs.writeFileSync('C:/Users/USER/OneDrive/Desktop/JAGAN/prompt.txt', desc + '\n', 'utf8');
fs.writeFileSync('C:/Users/USER/OneDrive/Desktop/JAGAN/prompt.md', desc + '\n', 'utf8');
fs.writeFileSync('C:/Users/USER/OneDrive/Desktop/JAGAN/REFINED_problem_description.md', desc + '\n', 'utf8');
console.log('Updated problem description files.');

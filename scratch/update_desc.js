const fs = require('fs');

const desc = `Fix Superagent's transfer lifecycle and streaming double-callback vulnerabilities by implementing transfer boundary controls with chainable maxRequestSize and maxResponseSize methods and a boolean hasSizeError() query.

When a transfer exceeds configured thresholds, immediately abort with an Error (code = 'ETOOLARGE') and ensure terminal callback execution occurs exactly once. Size errors must never trigger automatic retries (err.retries is 0). For requests configured with size limits encountering transient non-size errors, serialized multipart payloads must be preserved and replayed across retry attempts. Emitted progress events must expose an explicit direction property ('upload' or 'download').

Node.js:
- Enforce limits across buffered payloads, unbuffered streaming chunks, and intermediate redirects.
- Cumulative write() calls exceeding maxRequestSize must return false and route errors to callbacks.
- Prevent premature aborts on bodyless HTTP statuses (HEAD, 204, 304, 1223) carrying Content-Length headers.

Browsers:
- Preflight byte sizes for strings, Blobs, and native FormData including multipart boundary overhead when upload progress is unavailable.
- Measure decoded text sizes for compressed responses honoring BOM markers (UTF-8, UTF-16) and character encodings (Shift_JIS, GBK, HZ-GB-2312, and ISO-2022-JP escape-state transitions) even when CORS unexposes Content-Encoding.`;

const words = desc.trim().split(/\s+/).length;
console.log('Word count:', words);
console.log('Has em-dash:', desc.includes('—') || desc.includes('–'));
console.log('ASCII only (excluding standard quotes):', !/[^\x00-\x7F]/.test(desc));

fs.writeFileSync('c:/Users/USER/OneDrive/Desktop/JAGAN/problem_description.md', desc.replace(/\r\n/g, '\n'), 'utf8');
fs.writeFileSync('c:/Users/USER/OneDrive/Desktop/JAGAN/REFINED_problem_description.md', desc.replace(/\r\n/g, '\n'), 'utf8');

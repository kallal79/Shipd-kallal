const text = `Fix Superagent's transfer lifecycle and streaming double-callback vulnerabilities by implementing transfer boundary controls with chainable maxRequestSize and maxResponseSize methods and a boolean hasSizeError() query.

When a transfer exceeds configured thresholds, immediately abort with an Error (code = 'ETOOLARGE') and ensure terminal callback execution occurs exactly once. Size errors must never trigger automatic retries (err.retries is 0). For requests configured with size limits encountering transient non-size errors, serialized multipart payloads must be preserved and replayed across retry attempts. Emitted progress events must expose an explicit direction property ('upload' or 'download').

Node.js:
- Enforce limits across buffered payloads, unbuffered streaming chunks, and intermediate redirects.
- Cumulative write() calls exceeding maxRequestSize must return false and route errors to callbacks.
- Prevent premature aborts on bodyless HTTP statuses (HEAD, 204, 304, 1223) carrying Content-Length headers.

Browsers:
- Preflight byte sizes for strings, Blobs, and native FormData (with boundary overhead) when upload progress is unavailable.
- Measure decoded text sizes for compressed responses honoring BOM markers and charset rules (Shift_JIS/GBK 0x80 single bytes, GB18030 4-byte sequences, ISO-2022-JP and HZ-GB-2312 state escapes) even when CORS unexposes Content-Encoding.`;

const words = text.trim().split(/\s+/);
console.log("Word count:", words.length);
console.log("Has em-dash:", text.includes('—') || text.includes('--'));

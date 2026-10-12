const desc = `Implement transfer boundary controls with maxRequestSize and maxResponseSize methods and a hasSizeError() state query. When a transfer exceeds limits, immediately abort with an Error (code = 'ETOOLARGE'). For transfers encountering non-size errors, preserve and replay multipart payloads across retries and method-preserving redirects (305 and 307). On cross-origin redirects, strip Authorization and Cookie headers. Size controls must support HTTP/2 requests. Emitted progress events must expose an explicit direction property ('upload' or 'download').

Node.js:
- Cumulative write() calls exceeding maxRequestSize must return false.
- Prevent premature aborts on bodyless HTTP statuses (HEAD, 204, 304, 1223) carrying Content-Length headers.
- Enforce maxResponseSize against decompressed body size.

Browsers:
- Preflight byte sizes for strings, Blobs, and native FormData (with boundary overhead) when upload progress is unavailable.
- Preserve custom attachment filenames in multipart serialization under size limits.
- Preserve XHR responseType overrides under size enforcement.
- Account for decoded text size under compression, consuming UTF-8 and UTF-16/UTF-16LE BOMs, and applying charset-aware byte-length rules for Shift_JIS, GBK, GB18030, ISO-2022-JP, and HZ-GB-2312.`;

console.log('Words:', desc.trim().split(/\s+/).length);
console.log('Chars:', desc.length);

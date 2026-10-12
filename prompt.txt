Implement transfer boundary controls with maxRequestSize and maxResponseSize methods and a hasSizeError() state query. When a transfer exceeds limits, immediately abort with an Error (code = 'ETOOLARGE') and invoke the callback or reject the Promise exactly once. Size errors must never trigger automatic retries; when a retry policy is configured, err.retries must be 0. For transfers encountering non-size errors, preserve and replay multipart payloads across retries and method-preserving redirects (305 and 307). On cross-origin redirects, strip sensitive Authorization and Cookie headers. Size controls must support HTTP/2 requests (.http2()). Emitted progress events must expose an explicit direction property ('upload' or 'download').

Node.js:
- Cumulative write() calls exceeding maxRequestSize must return false, abort with ETOOLARGE, and emit the error to callbacks and error listeners.
- Prevent premature aborts on bodyless HTTP statuses (HEAD, 204, 304, 1223) carrying representation Content-Length headers.
- Enforce maxResponseSize against decompressed body size (gzip, deflate, brotli) for buffered responses, unbuffered streams, and intermediate redirects.
- In-limit unbuffered responses (.buffer(false)) must stream directly to consumers with a bounded memory footprint without accumulating full payloads in process memory, even for multi-gigabyte limits.
- For unbuffered streams, deliver data chunks and completion (end event) reliably to listeners attached in .end(callback) or on('response', res => ...); unbuffered chunked overflow beyond maxResponseSize must destroy the response stream with ETOOLARGE and invoke the callback/error listener.
- When retrying unbuffered requests after transient non-size errors (5xx), discard late chunks from the initial attempt arriving beyond the 256 KiB replay window to prevent premature or duplicate callback invocations.
- Without maxRequestSize, multipart uploads must stream directly without buffering; with size limits or retries, preserve and replay multipart payloads byte-for-byte.
- Piped responses (.pipe(dest)) must abort with ETOOLARGE if explicit Content-Length headers exceed maxResponseSize before body delivery, or if streamed chunks overflow the limit.

Browsers:
- Preflight byte sizes for strings, Blobs, and native FormData (including boundary framing overhead) before sending when upload progress is absent; serialized multipart bodies must match the Content-Type boundary parameter byte-for-byte.
- Preserve custom attachment filenames in multipart serialization under size limits.
- Preserve custom XHR responseType overrides (such as 'document' or 'arraybuffer') under size enforcement.
- Retain and resend multipart payloads on retries when either maxRequestSize or maxResponseSize is configured.
- Normalize legacy XHR status 1223 to 204 and treat as bodyless before size evaluation.
- For compressed responses (even when CORS hides Content-Encoding), evaluate decompressed payload size according to the WHATWG Encoding Standard:
  - Account for Byte Order Mark (BOM) bytes in decoded payload size when present or declared (3 bytes for UTF-8 EF BB BF, 2 bytes for UTF-16/UTF-16LE FE FF / FF FE, 4 bytes for UTF-32).
  - Shift_JIS: 1 byte for ASCII (0x00-0x7F) and half-width katakana (0xA1-0xDF / U+FF61-U+FF9F); 1-byte exception for U+0080 (0x80); 1 byte for Yen sign U+00A5 and Overline U+203E; 2 bytes for full-width double-byte characters.
  - GBK / GB2312: 1 byte for ASCII (0x00-0x7F); 1-byte exception for Euro sign U+20AC (0x80); 2 bytes for standard DBCS characters.
  - GB18030: Follows WHATWG GB18030: 1 byte for ASCII (0x00-0x7F); 2 bytes for standard GBK BMP character ranges (such as CJK Unified Ideographs U+4E00-U+9FA5, Euro U+20AC, Cyrillic U+0410-U+044F, Greek, punctuation); 4 bytes for characters outside the GBK 2-byte repertoire, specifically including U+0080 (encoded as 81 30 81 30 = 4 bytes), U+0400 (4 bytes), and all astral plane characters (U+10000+ / surrogate pairs).
  - ISO-2022-JP: Account for stateful escape sequences in decoded size: default initial mode is ASCII; transition to JIS X 0208 double-byte requires 3-byte escape ESC $ B (1B 24 42) or ESC $ @ (1B 24 40) plus 2 bytes/char; transition to JIS X 0201 Roman (Yen ¥ U+00A5) requires ESC ( J (1B 28 4A) plus 1 byte/char; transition to ASCII requires ESC ( B (1B 28 42). Example: "a" + "¥" + "あ" = 1 (ASCII) + 3 (ESC ( J) + 1 (¥) + 3 (ESC $ B) + 2 (あ) = 10 bytes.
  - HZ-GB-2312: Account for stateful escape sequences: default initial mode is ASCII; transition to GB2312 mode requires 2-byte escape ~{ (7E 7B) plus 2 bytes/char; transition to ASCII requires ~} (7E 7D); literal ~ escaped as ~~ (2 bytes). Example: "a" + "あ" = 1 (ASCII) + 2 (~{) + 2 (あ) + 2 (~}) = 7 bytes.

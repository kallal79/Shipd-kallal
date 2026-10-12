Resolve Superagent's transfer lifecycle and streaming double-callback vulnerabilities across Node.js and browser runtimes by implementing robust transfer limits with chainable `maxRequestSize` and `maxResponseSize` controls and a strict boolean `hasSizeError()` state query.

When request or response bodies exceed configured thresholds, the request must immediately abort with an Error (`code = 'ETOOLARGE'`), ensuring single terminal callback execution without double-callback defects. Size errors must never trigger retries (`err.retries` is 0). For requests configured with size limits encountering transient non-size errors, serialized multipart payloads must be preserved and replayed across retry attempts. Emitted progress events must expose an explicit `direction` property (`'upload'` or `'download'`).

### Node.js
- Enforce uncompressed and decompressed response limits across buffered bodies, unbuffered chunked streams, and intermediate redirects.
- Cumulative `write()` calls exceeding `maxRequestSize` must return `false` and route errors to callbacks and listeners.
- Prevent false aborts on bodyless HTTP statuses (HEAD, 204, 304, 1223) carrying Content-Length headers.

### Browsers
- Preflight byte lengths for strings, Blobs, and native FormData including multipart boundary overhead when upload progress is absent.
- Measure decoded text sizes for compressed responses honoring charset and BOM bytes, even when CORS unexposes Content-Encoding.

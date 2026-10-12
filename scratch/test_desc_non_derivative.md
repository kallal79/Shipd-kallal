Resolve Superagent's transfer lifecycle and streaming double-callback vulnerabilities across Node.js and browser runtimes by implementing transfer boundary controls with chainable `maxRequestSize` and `maxResponseSize` methods and a strict boolean `hasSizeError()` state query.

When a request or response exceeds configured thresholds, immediately abort with an Error (`code = 'ETOOLARGE'`), guaranteeing terminal callback execution occurs exactly once without triggering double-callback defects. Size errors must never trigger automatic retries (`err.retries` is 0). For requests configured with size limits encountering transient non-size errors, serialized multipart payloads must be preserved and replayed across retry attempts. Emitted progress events must expose an explicit `direction` property (`'upload'` or `'download'`).

### Node.js
- Apply limits across buffered payloads, unbuffered streaming chunk pipelines, and intermediate redirects.
- Cumulative `write()` calls exceeding `maxRequestSize` must return `false` and route errors to callbacks and listeners.
- Prevent premature aborts on bodyless HTTP statuses (HEAD, 204, 304, 1223) carrying Content-Length headers.

### Browsers
- Preflight byte sizes for strings, Blobs, and native FormData including multipart boundary overhead when upload progress is unavailable.
- Measure decoded text sizes for compressed responses honoring charset and BOM bytes even when CORS unexposes Content-Encoding.

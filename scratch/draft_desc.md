Add chainable `maxRequestSize(bytes)` and `maxResponseSize(bytes)` methods to Superagent Request instances, along with a `hasSizeError()` method returning a strict boolean.

When a request or response body exceeds its configured limit, abort immediately with an Error (`code = 'ETOOLARGE'`) and invoke the callback exactly once. Size errors must never trigger automatic retries (`err.retries` is 0). When retrying requests with a configured size limit after transient non-size errors, serialized multipart payloads must be preserved and replayed. Emitted progress events must include a `direction` property (`'upload'` or `'download'`).

### Node.js
- Enforce uncompressed/decompressed response limits on buffered payloads, unbuffered streams, and intermediate redirects.
- When cumulative `write()` calls exceed `maxRequestSize`, return `false` and propagate the error to callbacks and error listeners.
- Without `maxRequestSize`, multipart uploads must stream directly without buffering.
- Responses with bodyless statuses (HEAD, 204, 304, 1223) must not be aborted due to Content-Length headers.

### Browsers
- Enforce byte lengths for strings, Blobs, and FormData (including multipart framing overhead) before sending when upload progress is absent.
- Serialized multipart bodies must match the Content-Type boundary parameter byte-for-byte.
- Evaluate decoded payload size for compressed responses, even if Content-Encoding is unexposed.

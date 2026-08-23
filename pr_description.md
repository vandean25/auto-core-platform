Title: 🔒 Fix Bypass of Auth and CORS via Missing Origin Header

### 🎯 What
This PR addresses a vulnerability where custom or malicious Socket.IO clients could bypass origin validation checks during the initial WebSocket handshake by simply omitting or spoofing the `Origin` header.

### ⚠️ Risk
The `allowRequest` method on the gateway attempted to manually enforce CORS using the `Origin` header. Because standard browsers may omit the header in same-origin scenarios, it also exposed non-malicious connections to arbitrary drops if the logic failed. Additionally, an attacker could write a custom Socket.IO client without an `Origin` header (or with a spoofed one), bypass the check, establish a full WebSocket connection, and only fail authorization after the fact when emitting events or during the async `handleConnection` body. While the token validation eventually prevented unauthorized event access, establishing unauthenticated handshakes violates the "defense in depth" principle and is a security smell.

### 🛡️ Solution
1. **Removed Manual Origin Checks (`allowRequest`)**: Rely on standard library mechanisms `cors: { origin: allowedOrigins }` for CORS enforcement. Standard browsers respect this automatically, while manual validation provided zero value against custom client spoofing.
2. **Introduced Handshake-Level Auth Middleware**: Added the `OnGatewayInit` interface and implemented `afterInit(server)` with an asynchronous token validation middleware via `server.use()`.
3. **Rejection at the Edge**: Connections with missing or invalid tokens are now immediately rejected with a standard `next(new Error('Unauthorized'))` *during the handshake*, entirely preventing the socket from establishing a connection.
4. **Simplified `handleConnection`**: With token validation safely decoupled to the middleware edge, the connection handler purely leverages the pre-populated `socket.data` payload to join correct tenant and user rooms safely.

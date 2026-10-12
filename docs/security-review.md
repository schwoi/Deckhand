# Security review — 2026-10-12

Follow-up: see [the review of the remediation commit](security-review-followup.md) for current finding status and verification. This document records the original assessment.

Reviewed the current working tree, including the uncommitted authentication, environment, and Docker changes. This is a source review with isolated application-level probes, not a penetration test of a deployed instance. Existing project files were not changed.

The API is an administrative interface: its intended powers include writing executable agent configurations, driving tools, accessing conversations, and using provider credentials. Anyone holding the Deckhand token must be treated as a full administrator. Private-network access through the environment proxy is an intended feature, so it is not independently classified as an SSRF vulnerability here.

## Findings

### 1. High: tokenless local API accepts cross-site mutations and arbitrary hosts

**Locations:** `server/index.ts:64–71`, `server/index.ts:84–93`.

With the default unset `DECKHAND_TOKEN`, middleware accepts requests without checking `Origin`, fetch metadata, or the request host. The JSON body helper also accepts JSON sent as `text/plain`. Consequently, a cross-site POST can invoke state-changing endpoints without the normal JSON-content-type CORS preflight. Lack of CORS response headers does not stop the mutation. Endpoints that start or stop the runtime do not even require a JSON body.

In an isolated application probe, a request with an attacker-controlled URL host, `Origin: http://attacker.test`, and `Content-Type: text/plain` successfully created an agent (`201`). Reading the agent list using the arbitrary host returned `200`. Setting a token changed both unauthenticated requests to `401`.

An attacker-controlled page can make blind changes where browser network policy permits access to the local service. The missing host validation also leaves the application without a server-side defense against DNS rebinding, which can expose reads and the full administrative API. Browser local-network protections vary; these probes established server acceptance, not an end-to-end browser exploit.

**Fix:** require authentication for local administration, or implement a deliberate local-access policy with trusted host validation, same-origin checks for mutations, and a session-bound anti-CSRF secret. Reject unexpected body content types. Account explicitly for the Vite development origin and deployments behind a trusted reverse proxy.

### 2. High: network-exposed startup silently permits an unauthenticated control API

**Locations:** `server/index.ts:60–65`, `server/index.ts:375–381`, `Dockerfile:34–42`.

The server accepts `HOST=0.0.0.0` with no token. The Docker image sets this bind address by default, but does not require a token. Starting it with a published port and omitting the token exposes the administrative API to anyone who can reach the port. This permits agent changes and runtime/tool control with the process's privileges and credentials.

The isolated probe confirmed the exported non-loopback bind configuration while unauthenticated API calls succeeded. The supplied Compose file does require `DECKHAND_TOKEN`; this finding concerns direct image use and direct server startup. Documentation alone does not enforce the stated requirement.

**Fix:** refuse non-loopback startup without a token by default. If an authenticating reverse proxy is supported, make tokenless operation behind it an explicit deployment option rather than a silent fallback.

### 3. Medium: remote environment credentials can travel over plaintext HTTP

**Locations:** `server/environments.ts:46–55`, `server/environments.ts:91–103`, `server/index.ts:344–348`.

Environment URL validation accepts HTTP for any destination, and both connection tests and proxied requests attach the stored bearer token. For remote instances, an on-path attacker can capture a reusable administrative token or modify API responses. Using a strong token does not protect an unencrypted connection.

An isolated HTTP listener received the dummy stored bearer token on both environment-test requests. No real credentials were used. Plain HTTP is acceptable only where another explicitly trusted transport supplies the required protection, such as a local encrypted tunnel.

**Fix:** require HTTPS for non-loopback environments carrying credentials, with a deliberate opt-in for protected networks or tunnels. Document HTTPS termination for browser access to network-exposed dashboards as well.

### 4. Medium: sensitive data and executable agent files inherit permissive filesystem modes

**Locations:** `server/paths.ts:12–16`, `server/agents.ts:106–113`, `server/agents.ts:127–137`.

Data directories and agent files are created without explicit private modes. With the review environment's `umask 0002`, fresh data and agent directories were `0775`, and a saved YAML file was `0664`. A typical `0022` umask instead produces world-readable `0755` directories and `0644` files. Imported files may retain their original modes through `rename`.

If parent-directory permissions allow traversal, other local users can read agent configurations, including inline MCP credentials. Under a shared writable group, another user can alter executable agent definitions or replace files in the data directory. Although `environments.json` is correctly created as `0600`, a writable parent directory still permits replacement. This finding is conditional on local account/group access; it is not a remote authentication bypass.

**Fix:** create the private data directory as `0700` and sensitive files as `0600`; handle existing installations and imported files explicitly. Check ownership and avoid following symlinks when reading or replacing security-sensitive files. Keep intentionally shared agent directories an explicit configuration choice.

## Other checks and limits

- `bun audit --json` completed successfully with `{}`: no known dependency advisories were reported for the current lockfile by that audit service.
- A targeted working-tree scan found no matches for common private-key, AWS access-key, Anthropic-key, or GitHub-token patterns. This was not an exhaustive secret scan or a Git-history audit.
- Agent names use a restrictive allowlist. CLI calls use argument arrays rather than shell interpolation. Markdown renders through React and restricts parsed links to HTTP(S); no raw HTML rendering was found in the inspected frontend.
- Token comparison uses `timingSafeEqual`; unauthenticated requests to protected routes were rejected when a token was set. Environment-list responses omit stored token values.
- Probes used temporary directories and a local dummy upstream, which were removed afterward. No Docker Agent runtime, model requests, or real remote environments were invoked.
- Docker Agent internals, container/base-image vulnerabilities, real reverse-proxy configuration, and end-to-end browser exploitation were outside the verified scope. Authentication on the Deckhand API does not independently protect a runtime listener exposed through `DECKHAND_RUNTIME`; retain its loopback default.

Prioritize findings 1 and 2 before exposing an instance or relying on loopback binding as its security boundary.

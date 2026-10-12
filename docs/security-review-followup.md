# Security review follow-up — 2026-10-12

Reviewed commit `af9b8e7052b232b8c2fbf21fbfd927fae6e5bed4`, with a clean working tree at the start. This report supersedes the closure status in `security-review.md`; the earlier report is retained as the original assessment.

**Result: the previous findings are not all closed.** The non-loopback startup guard works for literal network bind addresses, and fresh-file permissions are corrected. There remains one high-severity validation bypass and two medium-severity residual risks.

## Previous finding status

| Previous finding | Status | Verification |
| --- | --- | --- |
| Cross-site requests and DNS rebinding | Partially fixed; high-severity bypass remains | Ordinary attacker hosts/origins return 403, but `127.attacker.test` is accepted for both reads and mutations. |
| Network-exposed tokenless startup | Guard verified, subject to the hostname-validation bypass below | `HOST=0.0.0.0` without a token or insecure override exits with status 1. |
| Plaintext environment credentials | Warning added; transport risk remains | Remote HTTP URLs with tokens are accepted and requests still attach bearer credentials. |
| Permissive filesystem modes | Fixed for fresh directories/files and imported files; not existing installations | New directories/files are 0700/0600; pre-existing 0775 directories and a 0664 YAML remain unchanged after initialization and saving. |

## Open findings

### 1. High: the loopback validator accepts attacker-controlled DNS names

**Location:** `server/net.ts:7`; used by `server/index.ts:69`, `server/index.ts:91`, and `server/index.ts:96`.

`h.startsWith('127.')` accepts any hostname beginning with those characters, rather than requiring a valid IPv4 address in 127.0.0.0/8. Both `127.attacker.test` and `127.0.0.1.attacker.test` return true. An attacker can control equivalent subdomains under a domain they own.

Application-level probes in tokenless mode confirmed:

- `GET /api/agents` with `Host: attacker.test:4800` returns 403, but with `Host: 127.attacker.test:4800` returns 200.
- `PUT /api/agents/rebound`, with host and origin `127.attacker.test:4800` and an application/json body, writes the file and returns 200.
- `POST /api/runtime/stop` to a legitimate loopback host with `Origin: http://127.attacker.test` and content type text/plain returns 200. The ordinary attacker origin returns 403. This endpoint does not require a JSON body.
- With `DECKHAND_TOKEN` configured, the corresponding unauthenticated attacks all return 401.

The malformed allowlist therefore defeats both new browser defenses: cross-site bodyless operations are accepted where browser network policy allows delivery, and DNS rebinding can retain an accepted hostname while resolving it to the local service. The startup guard uses the same helper, so it also misclassifies configured DNS names beginning with `127.`. These are server-side acceptance results; browser-specific DNS rebinding and local-network policy were not exercised end to end.

**Fix:** parse the hostname and require a validated IP literal before classifying its address range. For example, use `node:net` IP validation before accepting IPv4 127/8, and separately allow the exact intended localhost names and IPv6 loopback. Do not infer loopback from an arbitrary DNS-name prefix or a one-time DNS lookup. Add regression cases for attacker subdomains, malformed IPs, ports, and IPv6. Apply the corrected classification consistently to bind, Host, Origin, and environment checks.

### 2. Medium: the HTTP warning does not prevent credential disclosure, and some remote names suppress it

**Locations:** `server/environments.ts:39`, `server/environments.ts:59`, `server/environments.ts:106–109`; `web/src/components/EnvironmentSwitcher.tsx:75`.

The new unencrypted badge informs the operator but does not change transport behavior. Creating a token-bearing environment at `http://remote.example` succeeds. Intercepting the outgoing requests in an isolated probe confirmed that both environment-test requests still carry `Authorization: Bearer dummy-secret` over HTTP. The proxy likewise still uses the stored credentials without requiring encryption. An on-path attacker on an untrusted network can capture a reusable administrative token.

In addition, the faulty loopback helper makes `http://127.attacker.test` return `insecure: false`. The frontend uses a separate prefix regex that also hides its draft warning for `http://localhost.attacker.test`. Thus even the warning mitigation is inconsistent and bypassable by remote hostnames.

**Fix:** require HTTPS for remote credential-bearing environments, with an explicit per-environment opt-in for a protected tunnel or trusted transport. Enforce the rule on tests and proxy requests, including existing stored environments. Correct and share the URL classification logic. If plaintext is intentionally retained as a documented operator choice, classify this finding as an accepted risk rather than a fixed vulnerability.

### 3. Medium: upgrading leaves existing sensitive files and directories exposed

**Locations:** `server/paths.ts:19–24`; `server/agents.ts:111`.

Passing a mode to `mkdirSync` or `writeFile` affects creation, not an already-existing directory/file. The implementation explicitly preserves existing directory modes and never tightens an existing agent file on save.

An upgrade probe created a data directory and agents directory with mode 0775 and an existing YAML with mode 0664. After initialization and saving that YAML, their modes were still 0775, 0775, and 0664. In contrast, fresh directories were 0700, and fresh and imported files were 0600.

Where parent-directory traversal and local group membership permit access, old installations retain the original confidentiality and configuration-tampering risk. This is conditional on local filesystem access, not a remote authentication bypass. A group-writable data directory can permit replacement even of a 0600 credentials file.

**Fix:** provide a migration for application-owned private data, or detect unsafe existing permissions and require a documented repair. Include existing agent files and sensitive runtime data; do not assume re-saving makes files private. Preserve intentionally shared external directories only through an explicit policy. Check ownership and symlinks before applying repairs.

## Verification and additional review

- `bun run typecheck` passed.
- `bun run lint` passed: 56 files checked, no fixes applied.
- `bun audit --json` returned `{}` with successful exit status; no known advisories were reported by that service for the lockfile.
- Application probes covered ordinary and deceptive hosts/origins, token-protected requests, JSON content-type rejection, the legitimate Vite origin, and an encoded traversal name. The traversal name was rejected with 400; legitimate local/development requests succeeded.
- Separate process invocations covered fresh data, upgraded data, token-enabled mode, and refusal of non-loopback tokenless startup.
- Re-examined the runtime supervisor, CLI argument construction, registry imports, filesystem operations, environment forwarding, static serving, frontend rendering/auth storage, and Docker/Vite configuration. No additional independently confirmed high-severity finding was established beyond the bypass above.
- API token holders remain full administrators; the environment proxy's private-network reachability is intentional. The explicit `DECKHAND_INSECURE=1` option intentionally delegates authentication to an upstream proxy and was not treated as an accidental bypass.

All mutation probes used temporary directories. Runtime-stop probes operated on an unstarted temporary runtime object. HTTP credential checks used a mocked fetch and dummy token, with no external requests. No real runtime, model-provider calls, or live remote environments were used. Temporary probe files and data were removed. Only this report and the historical report's follow-up pointer were added to the working tree.

This is source review and targeted application verification, not certification of a deployed installation. Browser exploitation, Docker Agent internals, container image scanning, Git-history secret scanning, and actual reverse-proxy/TLS configuration remain outside the verified scope.

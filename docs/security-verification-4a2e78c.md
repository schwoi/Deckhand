# Security remediation verification — 4a2e78c

Verified commit `4a2e78cb2f874170db126b40999098998fa4ba57` on `environments`, on 2026-10-12. The working tree was clean before verification.

**The three previously demonstrated vulnerabilities are addressed for the default private-directory configuration.** The old attack probes no longer succeed. Two implementation edge cases remain, described below; neither demonstrated a replacement for the previous remote-access bypass.

## Retest results

214 assertions passed across four isolated process runs: default private directories (54), an explicitly shared agents directory (54), token-enabled authentication (54), and a directory-symlink configuration (52). The edge-case outputs were observations, not assertions that those behaviors were correct.

| Area | Verified result |
| --- | --- |
| Loopback classification | Twenty cases covering attacker DNS names, invalid octets, ports, IPv4, IPv6, and dotted IPv4-mapped IPv6 behaved as expected. |
| Host and Origin defenses | Ordinary and `127.*` attacker domains were rejected with 403 in tokenless mode. Rebound agent writes and cross-site runtime-stop requests were rejected. |
| Token mode | Corresponding unauthenticated attack requests returned 401; legitimate authenticated calls succeeded. |
| Local development | Requests from the legitimate Vite origin succeeded; text/plain JSON was rejected with 400. |
| HTTP environment creation | Remote HTTP with a token was rejected; deceptive loopback-looking domains were rejected too. A string value `"true"` did not enable the boolean transport override. |
| HTTP environment updates | HTTPS-to-HTTP changes without opt-in were rejected, as were updates retaining an unsafe legacy URL. |
| Candidate and stored tests | Both were blocked for remote HTTP without opt-in. |
| Existing environment proxy | A registry entry written before module initialization, without `allowInsecure`, was rejected before any fetch. |
| Explicit transport override | Updating the stored entry with `allowInsecure: true` enabled tests and proxying. Explicit opt-in creation and loopback HTTP creation succeeded. |
| Upgrade permissions | Existing owned data/default-agent directories changed from 0775 to 0700; an existing agent, session file, and environment registry changed from 0664 to 0600. |
| Save permissions | Re-saving a default agent reset its deliberately loosened 0664 mode to 0600. New agents were 0600. |
| Shared agents directory | Its 0775 mode and an existing agent's 0664 mode were preserved through initialization and saving, as explicitly intended. |
| File symlinks | A linked file's target retained its original permissions during migration. |
| Network bind guard | A separate tokenless `HOST=0.0.0.0` invocation refused startup with exit status 1. |

The browser form now imports the same URL classifier as the server. Source inspection confirmed the opt-in switch and the validity check that disables Test and Save/Add for insecure URLs without opt-in. The browser UI was not exercised end to end.

## Remaining edge cases

### IPv4-mapped IPv6 URL normalization is not handled

**Location:** `shared/net.ts:13–16`.

The dotted string `::ffff:127.0.0.1` is accepted directly. However, `new URL('http://[::ffff:127.0.0.1]').hostname` produces `[::ffff:7f00:1]`, which the helper rejects. Consequently, `isInsecureUrl('http://[::ffff:127.0.0.1]')` returns true, and a legitimate loopback environment requires the unencrypted override. The Origin check also uses URL parsing.

This is a conservative false rejection, not an authentication bypass. Parse IPv6 address values, including their canonical hexadecimal mapped representation, or narrow the documented supported forms. Add tests through `isInsecureUrl` and Origin handling, rather than only testing raw strings.

### Directory symlinks are traversed during permission migration

**Location:** `server/paths.ts:26–30`.

`tighten` skips chmod on a symlink, but `tightenDir` then calls `readdirSync` on that same path. If the default agents directory is a symlink to an external directory, migration leaves the target directory at 0775 while changing its owned child file from 0664 to 0600. Thus the statement that migration skips symlinks holds for file entries, but not for traversal through a directory symlink.

This can unexpectedly modify files in a linked shared location, while the linked directory itself retains its potentially writable permissions. Before traversing, reject or explicitly handle symlinked directory roots. Clearly define whether such a layout is unsupported, shared, or private. The default non-symlink layout passed the migration tests.

## Checks and scope

- `bun run typecheck`: passed.
- `bun run lint`: passed; 56 files checked, no fixes applied.
- `bun audit --json`: successful, `{}`; no known dependency advisories were reported by that service.
- Probes used temporary directories, dummy credentials, and intercepted outbound fetches. Rejected HTTP operations produced zero outbound calls; requests occurred only after explicit opt-in. No model calls, real runtime launches, or real remote environments were used.
- Runtime-stop requests were against an unstarted temporary runtime object. Temporary scripts, logs, and data were removed.
- Ownership checks were inspected in source; alternate-UID ownership behavior was not exercised. Browser networking policies, live DNS rebinding, container images, and deployed TLS/reverse-proxy configuration were not tested.
- Only review documentation was changed. These results supersede the open-finding status in the earlier follow-up report for the tested configuration; they are not a certification of all deployment variants.

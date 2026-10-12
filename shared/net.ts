// Host classification shared by the server (bind, Host and Origin checks, environment URLs)
// and the web client (live warning in the environment form). Only validated IP literals and
// the exact name "localhost" count as loopback; a DNS name is never trusted by prefix.

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** True when `host` (a hostname, IP literal, or either with a port) can only be this machine. */
export function isLoopback(host: string): boolean {
  let h = host.trim().toLowerCase()
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(h)
  if (bracketed?.[1]) h = bracketed[1]
  else if (/^[^:]+:\d+$/.test(h)) h = h.replace(/:\d+$/, '')
  if (h.startsWith('::ffff:')) {
    // IPv4-mapped. URL parsing canonicalises ::ffff:127.0.0.1 to ::ffff:7f00:1, so accept both.
    h = h.slice('::ffff:'.length)
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h)
    if (hex?.[1] && hex[2]) {
      const [hi, lo] = [Number.parseInt(hex[1], 16), Number.parseInt(hex[2], 16)]
      h = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
    }
  }
  if (h === 'localhost' || h === '::1') return true
  const m = IPV4.exec(h)
  if (!m) return false
  const octets = m.slice(1).map(Number)
  return octets.every((o) => o <= 255) && octets[0] === 127
}

/** Plain http to another machine: a bearer token on it is readable by anyone on the path. */
export function isInsecureUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' && !isLoopback(u.hostname)
  } catch {
    return false
  }
}

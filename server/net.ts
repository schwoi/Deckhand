/** True for hostnames that can only be reached from this machine (with or without a port). */
export function isLoopback(hostOrUrlHost: string): boolean {
  const h = hostOrUrlHost
    .replace(/^\[([^\]]+)\](?::\d+)?$/, '$1') // [::1]:4800 -> ::1
    .replace(/^([^:]+):\d+$/, '$1') // 127.0.0.1:4800 -> 127.0.0.1
    .toLowerCase()
  return h === 'localhost' || h === '::1' || h.startsWith('127.') || h.endsWith('.localhost')
}

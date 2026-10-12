import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { TEMPLATES } from '@shared/templates'

export const DECKHAND_HOME = process.env.DECKHAND_HOME || join(homedir(), '.deckhand')
export const AGENTS_DIR = process.env.DECKHAND_AGENTS || join(DECKHAND_HOME, 'agents')
/** A user-supplied agents dir may be shared on purpose; only the default one is kept private. */
export const AGENTS_DIR_PRIVATE = !process.env.DECKHAND_AGENTS
export const SESSION_DB = join(DECKHAND_HOME, 'session.db')
export const RUNTIME_LISTEN = process.env.DECKHAND_RUNTIME || '127.0.0.1:4801'

/** Agent files can hold inline MCP credentials, and the session db holds conversations. */
export const PRIVATE_DIR = 0o700
export const PRIVATE_FILE = 0o600

/** chmod a path we own; skips symlinks, other users' files, and anything already right. */
export function tighten(path: string, mode: number): void {
  try {
    const st = lstatSync(path)
    if (st.isSymbolicLink() || st.uid !== process.getuid?.()) return
    if ((st.mode & 0o777) !== mode) chmodSync(path, mode)
  } catch {}
}

/** Tighten a directory we created and the files directly inside it. A symlinked root is left
 *  alone entirely: it points somewhere the user manages, so neither it nor its contents are ours. */
function tightenDir(dir: string): void {
  if (lstatSync(dir).isSymbolicLink()) {
    console.warn(`[deckhand] ${dir} is a symlink; leaving its permissions as they are`)
    return
  }
  tighten(dir, PRIVATE_DIR)
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (lstatSync(p).isFile()) tighten(p, PRIVATE_FILE)
  }
}

/**
 * Create directories and seed the agents dir with the templates when it is empty. Existing
 * installations created before modes were set are tightened too: the data dir and its files
 * (session db, environments.json), plus the agents dir when it is the default one.
 */
export function initPaths(): void {
  mkdirSync(DECKHAND_HOME, { recursive: true, mode: PRIVATE_DIR })
  mkdirSync(AGENTS_DIR, { recursive: true, mode: PRIVATE_DIR })
  if (readdirSync(AGENTS_DIR).length === 0) {
    for (const t of TEMPLATES)
      writeFileSync(join(AGENTS_DIR, `${t.id}.yaml`), t.yaml, { mode: PRIVATE_FILE })
  }
  tightenDir(DECKHAND_HOME)
  if (AGENTS_DIR_PRIVATE && existsSync(AGENTS_DIR)) tightenDir(AGENTS_DIR)
}

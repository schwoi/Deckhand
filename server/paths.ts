import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { TEMPLATES } from '@shared/templates'

export const DECKHAND_HOME = process.env.DECKHAND_HOME || join(homedir(), '.deckhand')
export const AGENTS_DIR = process.env.DECKHAND_AGENTS || join(DECKHAND_HOME, 'agents')
export const SESSION_DB = join(DECKHAND_HOME, 'session.db')
export const RUNTIME_LISTEN = process.env.DECKHAND_RUNTIME || '127.0.0.1:4801'

/** Agent files can hold inline MCP credentials, and the session db holds conversations. */
export const PRIVATE_DIR = 0o700
export const PRIVATE_FILE = 0o600

/**
 * Create directories and seed the agents dir with the templates when it is empty. Modes apply
 * on creation only; a pre-existing directory keeps whatever the user set.
 */
export function initPaths(): void {
  mkdirSync(DECKHAND_HOME, { recursive: true, mode: PRIVATE_DIR })
  mkdirSync(AGENTS_DIR, { recursive: true, mode: PRIVATE_DIR })
  if (readdirSync(AGENTS_DIR).length === 0) {
    for (const t of TEMPLATES)
      writeFileSync(join(AGENTS_DIR, `${t.id}.yaml`), t.yaml, { mode: PRIVATE_FILE })
  }
}

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { TEMPLATES } from '@shared/templates'

export const DECKHAND_HOME = process.env.DECKHAND_HOME || join(homedir(), '.deckhand')
export const AGENTS_DIR = process.env.DECKHAND_AGENTS || join(DECKHAND_HOME, 'agents')
export const SESSION_DB = join(DECKHAND_HOME, 'session.db')
export const RUNTIME_LISTEN = process.env.DECKHAND_RUNTIME || '127.0.0.1:4801'

/** Create directories and seed the agents dir with the templates when it is empty. */
export function initPaths(): void {
  mkdirSync(DECKHAND_HOME, { recursive: true })
  mkdirSync(AGENTS_DIR, { recursive: true })
  if (readdirSync(AGENTS_DIR).length === 0) {
    for (const t of TEMPLATES) writeFileSync(join(AGENTS_DIR, `${t.id}.yaml`), t.yaml)
  }
}

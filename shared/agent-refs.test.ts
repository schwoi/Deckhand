import { describe, expect, test } from 'bun:test'
import { parse, stringify } from 'yaml'
import { addRelation, parseAgentRef, removeAgent, removeRelation, renameAgent } from './agent-refs'
import type { AgentFile } from './config'

const yaml = `
version: "16"
x-team-notes: { owner: me }
agents:
  root:
    model: fast
    custom_field: [1, 2]
    sub_agents: [helper, myorg/reviewer:1.0, 42]
    handoffs: [helper]
    force_handoff: helper
    routing:
      allowed_agents: [helper, other]
      default_agent: helper
  helper:
    description: helps
    handoffs: [root]
  other:
    sub_agents: [helper]
`
const load = () => parse(yaml) as AgentFile

describe('renameAgent', () => {
  test('rewrites every local reference including force_handoff and routing', () => {
    const next = renameAgent(load(), 'helper', 'assistant')
    expect(Object.keys(next.agents)).toEqual(['root', 'assistant', 'other'])
    const root = next.agents.root
    expect(root?.sub_agents).toEqual(['assistant', 'myorg/reviewer:1.0', 42] as unknown as string[])
    expect(root?.handoffs).toEqual(['assistant'])
    expect(root?.force_handoff).toBe('assistant')
    expect(root?.routing).toEqual({
      allowed_agents: ['assistant', 'other'],
      default_agent: 'assistant',
    })
    expect(next.agents.other?.sub_agents).toEqual(['assistant'])
  })

  test('preserves unknown keys at every level', () => {
    const out = stringify(renameAgent(load(), 'helper', 'assistant'))
    expect(out).toContain('x-team-notes')
    expect(out).toContain('custom_field')
    expect(parse(out).agents.assistant).toEqual({ description: 'helps', handoffs: ['root'] })
  })

  test('refuses to rename onto an existing agent', () => {
    const config = load()
    expect(renameAgent(config, 'helper', 'other')).toBe(config)
  })

  test('keeps an agent literally named __proto__', () => {
    const config = parse(
      'agents:\n  __proto__: { description: odd }\n  a: {}\n  b: { sub_agents: [a] }\n',
    )
    const renamed = renameAgent(config, 'a', 'c')
    expect(Object.keys(renamed.agents)).toEqual(['__proto__', 'c', 'b'])
    expect(Object.getOwnPropertyDescriptor(renamed.agents, '__proto__')?.value).toEqual({
      description: 'odd',
    })
    expect(Object.keys(removeAgent(config, 'b').agents)).toEqual(['__proto__', 'a'])
  })

  test('is a no-op for unknown agents and leaves untouched agents identical', () => {
    const config = load()
    expect(renameAgent(config, 'nope', 'x')).toBe(config)
    const next = renameAgent(config, 'other', 'third')
    expect(next.agents.helper).toBe(config.agents.helper)
  })
})

describe('removeAgent', () => {
  test('drops the agent and its references, removing emptied fields', () => {
    const next = removeAgent(load(), 'helper')
    expect(Object.keys(next.agents)).toEqual(['root', 'other'])
    const root = next.agents.root
    expect(root?.sub_agents).toEqual(['myorg/reviewer:1.0', 42] as unknown as string[])
    expect(root && 'handoffs' in root).toBe(false)
    expect(root && 'force_handoff' in root).toBe(false)
    expect(root?.routing).toEqual({ allowed_agents: ['other'] })
    expect(root?.custom_field).toEqual([1, 2])
    expect(next.agents.other && 'sub_agents' in next.agents.other).toBe(false)
    expect(next['x-team-notes']).toEqual({ owner: 'me' })
  })
  test('drops routing once its last allowed agent is removed', () => {
    const config = parse(`
agents:
  a:
    routing: { allowed_agents: [b], default_agent: b }
    x-keep: 1
  b: {}
`) as AgentFile
    expect(removeAgent(config, 'b').agents.a).toEqual({ 'x-keep': 1 })
  })
})

describe('add/removeRelation', () => {
  test('adds list entries once and replaces the forced handoff', () => {
    let c = addRelation(load(), 'helper', 'delegation', 'other')
    c = addRelation(c, 'helper', 'delegation', 'other')
    expect(c.agents.helper?.sub_agents).toEqual(['other'])
    c = addRelation(c, 'root', 'force_handoff', 'other')
    expect(c.agents.root?.force_handoff).toBe('other')
    expect(Object.keys(c.agents.helper ?? {})).toEqual(['description', 'handoffs', 'sub_agents'])
  })

  test('removes entries and drops empty fields', () => {
    let c = removeRelation(load(), 'helper', 'handoff', 'root')
    expect(c.agents.helper).toEqual({ description: 'helps' })
    c = removeRelation(c, 'root', 'force_handoff', 'helper')
    expect(c.agents.root && 'force_handoff' in c.agents.root).toBe(false)
    expect(removeRelation(c, 'root', 'force_handoff', 'helper')).toEqual(c)
  })
})

describe('parseAgentRef', () => {
  test('classifies local names, OCI refs, URLs and named references', () => {
    expect(parseAgentRef('helper')).toEqual({ kind: 'local', name: 'helper' })
    expect(parseAgentRef('myorg/review-pr')).toEqual({
      kind: 'external',
      name: 'review-pr',
      reference: 'myorg/review-pr',
    })
    expect(parseAgentRef('docker.io/myorg/agent:1.2')).toMatchObject({ name: 'agent' })
    expect(parseAgentRef('myorg/agent@sha256:abc')).toMatchObject({ name: 'agent' })
    expect(parseAgentRef('reviewer:myorg/review-pr')).toEqual({
      kind: 'external',
      name: 'reviewer',
      reference: 'myorg/review-pr',
    })
    // registry host:port is part of the reference, not an alias (verified against the runtime)
    expect(parseAgentRef('localhost:5000/repo')).toEqual({
      kind: 'external',
      name: 'repo',
      reference: 'localhost:5000/repo',
    })
    expect(parseAgentRef('registry.example.com:5000/team/reviewer:v2')).toEqual({
      kind: 'external',
      name: 'reviewer',
      reference: 'registry.example.com:5000/team/reviewer:v2',
    })
    expect(parseAgentRef('named:localhost:5000/repo')).toMatchObject({
      name: 'repo',
      reference: 'named:localhost:5000/repo',
    })
    expect(parseAgentRef('rev:myorg/review-pr:v1')).toEqual({
      kind: 'external',
      name: 'rev',
      reference: 'myorg/review-pr:v1',
    })
    expect(parseAgentRef('rev:https://example.com/a.yaml')).toMatchObject({
      name: 'rev',
      reference: 'https://example.com/a.yaml',
    })
    expect(parseAgentRef('https://example.com/agents/pirate.yaml')).toEqual({
      kind: 'external',
      name: 'pirate.yaml',
      reference: 'https://example.com/agents/pirate.yaml',
    })
  })
})

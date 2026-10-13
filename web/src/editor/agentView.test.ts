import { describe, expect, test } from 'bun:test'
import { agentFormView } from './agentView'

describe('agentFormView', () => {
  test('hides fields whose shape the form cannot edit, keeping the rest', () => {
    const view = agentFormView({
      model: 'fast',
      sub_agents: 'worker',
      handoffs: ['a', 3],
      force_handoff: 5,
      toolsets: [{ type: 'mcp', args: 'oops' }],
      commands: 'nope',
      max_iterations: '5',
      custom: { kept: true },
    })
    expect([...view.invalid].sort()).toEqual([
      'commands',
      'force_handoff',
      'handoffs',
      'max_iterations',
      'sub_agents',
      'toolsets',
    ])
    expect(view.agent).toEqual({ model: 'fast', custom: { kept: true } })
    expect(view.malformed).toBe(false)
  })

  test('accepts valid shapes, null as an empty agent, and flags non-mappings', () => {
    const ok = agentFormView({
      instruction: ['a', 'b'],
      toolsets: [{ type: 'mcp', ref: 'docker:x', remote: { url: 'u', headers: { a: 'b' } } }],
      commands: [{ name: 'x' }],
      sub_agents: null,
    })
    expect(ok.invalid.size).toBe(0)
    expect(agentFormView(null)).toEqual({ agent: {}, invalid: new Set(), malformed: false })
    expect(agentFormView('text').malformed).toBe(true)
    expect(agentFormView(['x']).malformed).toBe(true)
  })
})

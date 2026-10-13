import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { locateIssue, projectTopology, withIssues } from './topology'

const team = parse(`
agents:
  root:
    description: Coordinator
    model: fast
    toolsets: [{ type: think }, { type: shell }]
    use_toolsets: [shared]
    sub_agents: [coder, reviewer:myorg/review-pr, ghost]
    handoffs: [coder]
  coder:
    sub_agents: [coder]
    handoffs: [root]
    force_handoff: tester
  tester:
    force_handoff: coder
  loner:
    handoffs: [myorg/review-pr]
`)

const codes = (t: ReturnType<typeof projectTopology>) => t.diagnostics.map((d) => d.code)

describe('projectTopology', () => {
  const t = projectTopology(team)

  test('builds local, external and missing nodes', () => {
    expect(t.entry).toBe('root')
    expect(t.nodes.map((n) => n.id)).toEqual([
      'agent:root',
      'agent:coder',
      'agent:tester',
      'agent:loner',
      'external:reviewer:myorg/review-pr',
      'missing:ghost',
      'external:myorg/review-pr',
    ])
    const root = t.nodes[0]
    expect(root).toMatchObject({
      entry: true,
      model: 'fast',
      description: 'Coordinator',
      toolsets: 3,
    })
    expect(t.nodes.find((n) => n.id === 'external:reviewer:myorg/review-pr')).toMatchObject({
      kind: 'external',
      name: 'reviewer',
      reference: 'myorg/review-pr',
      resolution: 'unverified',
    })
  })

  test('keeps delegation and handoff between the same pair distinguishable', () => {
    const pair = t.edges.filter((e) => e.from === 'root' && e.ref === 'coder')
    expect(pair.map((e) => [e.kind, e.path])).toEqual([
      ['delegation', 'agents.root.sub_agents.0'],
      ['handoff', 'agents.root.handoffs.0'],
    ])
    expect(new Set(pair.map((e) => e.id)).size).toBe(2)
  })

  test('represents force_handoff as its own edge kind', () => {
    const forced = t.edges.filter((e) => e.kind === 'force_handoff')
    expect(forced.map((e) => [e.from, e.ref, e.path])).toEqual([
      ['coder', 'tester', 'agents.coder.force_handoff'],
      ['tester', 'coder', 'agents.tester.force_handoff'],
    ])
  })

  test('reports unresolved targets as errors on the referencing field', () => {
    const d = t.diagnostics.find((x) => x.code === 'unresolved-target')
    expect(d).toMatchObject({
      severity: 'error',
      path: 'agents.root.sub_agents.2',
      nodes: ['missing:ghost'],
      edges: ['delegation:root->ghost'],
    })
  })

  test('warns on self-links and cycles, errors on forced handoff loops', () => {
    expect(t.diagnostics.find((d) => d.code === 'self-link')).toMatchObject({
      severity: 'warning',
      path: 'agents.coder.sub_agents.0',
    })
    expect(t.edges.some((e) => e.source === 'agent:coder' && e.target === 'agent:coder')).toBe(true)
    const cycle = t.diagnostics.find((d) => d.code === 'cycle')
    expect(cycle?.severity).toBe('warning')
    expect(cycle?.nodes).toEqual(['agent:root', 'agent:coder', 'agent:tester'])
    const forced = t.diagnostics.find((d) => d.code === 'force-handoff-cycle')
    expect(forced).toMatchObject({ severity: 'error', path: 'agents.coder.force_handoff' })
    expect(forced?.edges).toEqual(['force_handoff:coder->tester', 'force_handoff:tester->coder'])
  })

  test('warns about agents unreachable from the entry point', () => {
    const unreachable = t.diagnostics.filter((d) => d.code === 'unreachable')
    expect(unreachable.map((d) => d.path)).toEqual(['agents.loner'])
    const fromLoner = projectTopology(team, { entry: 'loner' })
    expect(fromLoner.entry).toBe('loner')
    expect(fromLoner.diagnostics.filter((d) => d.code === 'unreachable')).toHaveLength(3)
  })

  test('forced self-handoff is an error, and duplicates are flagged once each', () => {
    const t2 = projectTopology({
      agents: { a: { force_handoff: 'a', sub_agents: ['b', 'b', 'b'] }, b: {} },
    })
    expect(t2.diagnostics.find((d) => d.code === 'self-link')?.severity).toBe('error')
    expect(t2.edges.filter((e) => e.kind === 'delegation')).toHaveLength(1)
    expect(t2.diagnostics.filter((d) => d.code === 'duplicate').map((d) => d.path)).toEqual([
      'agents.a.sub_agents.1',
      'agents.a.sub_agents.2',
    ])
  })

  test('tolerates schema-invalid shapes and defaults the entry to the first agent', () => {
    const t3 = projectTopology({
      agents: { main: { sub_agents: 'oops', handoffs: [1, 'x'] }, other: null },
    })
    expect(t3.entry).toBe('main')
    expect(t3.nodes.map((n) => n.id)).toEqual(['agent:main', 'agent:other', 'missing:x'])
    expect(t3.edges[0]?.path).toBe('agents.main.handoffs.1')
    expect(projectTopology('nonsense').nodes).toEqual([])
    expect(projectTopology({ agents: { toString: {} } }).nodes).toHaveLength(1)
  })
})

describe('runtime load rules', () => {
  test('marks external references that clash with a local agent name', () => {
    const t = projectTopology({ agents: { root: { force_handoff: 'root:myorg/reviewer' } } })
    expect(t.diagnostics.map((d) => [d.code, d.severity, d.path])).toEqual([
      ['name-conflict', 'error', 'agents.root.force_handoff'],
    ])
    expect(t.diagnostics[0]?.nodes).toContain('agent:root')
  })

  test('survives schema-invalid relationship shapes', () => {
    const t = projectTopology({
      agents: {
        a: { sub_agents: 'worker', handoffs: { x: 1 }, force_handoff: 5 },
        b: { force_handoff: '' },
      },
    })
    expect(t.edges).toEqual([])
    expect(t.diagnostics.map((d) => d.code)).toEqual(['unreachable'])
  })
})

describe('validation issues', () => {
  const t = projectTopology(team)

  test('locates issue paths on edges and nodes', () => {
    expect(locateIssue(t, 'agents.root.handoffs.0')).toEqual({
      node: 'agent:root',
      edge: 'handoff:root->coder',
    })
    expect(locateIssue(t, 'agents.coder.force_handoff')).toMatchObject({
      edge: 'force_handoff:coder->tester',
    })
    expect(locateIssue(t, 'agents.tester.instruction')).toEqual({ node: 'agent:tester' })
    expect(locateIssue(t, 'models.fast')).toEqual({})
  })

  test('merges issues without repeating what the projection reports', () => {
    const all = withIssues(t, [
      { path: 'agents.root.sub_agents.2', message: 'unknown agent: ghost' },
      { path: 'agents.tester.force_handoff', message: 'force_handoff cycle' },
      { path: 'agents.loner.model', message: 'unknown model: nope' },
      { path: 'models.fast', message: 'missing provider' },
      { path: '', message: 'document-level' },
    ])
    const extra = all.filter((d) => d.code === 'issue')
    expect(extra).toEqual([
      {
        severity: 'error',
        code: 'issue',
        message: 'unknown model: nope',
        path: 'agents.loner.model',
        nodes: ['agent:loner'],
        edges: [],
      },
    ])
  })
  test('warnings do not hide validation errors at the same path', () => {
    const all = withIssues(t, [{ path: 'agents.loner', message: 'must be object' }])
    expect(all.filter((d) => d.path === 'agents.loner').map((d) => d.code)).toEqual([
      'unreachable',
      'issue',
    ])
  })
})

describe('large fixture', () => {
  const config = parse(readFileSync(new URL('./fixtures/large-team.yaml', import.meta.url), 'utf8'))

  test('has 50 agents and 150 relationships', () => {
    const t = projectTopology(config)
    expect(t.nodes.filter((n) => n.kind === 'agent')).toHaveLength(50)
    expect(t.edges).toHaveLength(150)
    expect(codes(t)).not.toContain('unresolved-target')
    expect(codes(t)).not.toContain('unreachable')
  })
})

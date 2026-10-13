import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { projectTopology } from '@shared/topology'
import { parse } from 'yaml'
import {
  type GraphLayout,
  NODE_H,
  NODE_W,
  edgeGeometry,
  layoutGraph,
  structureKey,
  visualEdges,
} from './topologyLayout'

const fixture = readFileSync(
  new URL('../../../shared/fixtures/large-team.yaml', import.meta.url),
  'utf8',
)

const build = (config: unknown) => {
  const t = projectTopology(config)
  const layout = layoutGraph(t.nodes, t.edges, t.entry ? `agent:${t.entry}` : undefined)
  return { t, layout, geometry: edgeGeometry(visualEdges(t.edges), layout) }
}

describe('layoutGraph', () => {
  test('places the entry point in the first row and its delegates below', () => {
    const { layout } = build({
      agents: { helper: {}, root: { sub_agents: ['helper'], handoffs: ['helper'] } },
    })
    expect(layout.row.get('agent:root')).toBe(0)
    expect(layout.row.get('agent:helper')).toBe(1)
  })

  test('places same-layer partners next to each other', () => {
    const { layout } = build({
      agents: { root: { sub_agents: ['a', 'b', 'c'] }, a: { handoffs: ['c'] }, b: {}, c: {} },
    })
    const x = (id: string) => layout.pos.get(`agent:${id}`)?.x ?? 0
    expect(Math.abs(x('a') - x('c'))).toBe(NODE_W + 48)
  })

  test('is deterministic and ignores nonstructural edits', () => {
    const config = parse(fixture)
    const a = build(config)
    const edited = structuredClone(config)
    edited.agents.agent07.description = 'Changed'
    edited.agents.agent07.model = 'other'
    const b = build(edited)
    expect(structureKey(b.t)).toBe(structureKey(a.t))
    expect([...b.layout.pos]).toEqual([...a.layout.pos])
  })

  test('large fixture: no overlapping nodes, every edge drawn, fast', () => {
    const config = parse(fixture)
    const started = performance.now()
    const runs = 20
    let result = build(config)
    for (let i = 1; i < runs; i++) result = build(config)
    const perRun = (performance.now() - started) / runs
    const { t, layout, geometry } = result

    expect(layout.pos.size).toBe(50)
    expect(geometry.size).toBe(150)
    const rects = [...layout.pos.values()]
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]
        const b = rects[j]
        if (!a || !b) continue
        const overlap = Math.abs(a.x - b.x) < NODE_W && Math.abs(a.y - b.y) < NODE_H
        expect(overlap).toBe(false)
      }
    expect(t.edges.every((e) => geometry.get(e.id)?.d.startsWith('M'))).toBe(true)
    // budget is generous for slow CI; on a laptop this is a few milliseconds
    expect(perRun).toBeLessThan(100)
  })
})

describe('visualEdges', () => {
  test('merges a handoff and a forced handoff to the same target into one forced edge', () => {
    const t = projectTopology({
      agents: {
        coder: { handoffs: ['tester'], force_handoff: 'tester', sub_agents: ['tester'] },
        tester: { handoffs: ['coder'] },
      },
    })
    const drawn = visualEdges(t.edges)
    expect(drawn.map((e) => [e.kind, e.source, e.target, e.members.length])).toEqual([
      ['delegation', 'agent:coder', 'agent:tester', 1],
      ['force_handoff', 'agent:coder', 'agent:tester', 2],
      ['handoff', 'agent:tester', 'agent:coder', 1],
    ])
    expect(drawn[1]?.members.map((m) => m.kind)).toEqual(['force_handoff', 'handoff'])
  })
})

const start = (d: string | undefined) => {
  const m = /^M([\d.-]+),([\d.-]+)/.exec(d ?? '')
  return { x: Number(m?.[1]), y: Number(m?.[2]) }
}
const end = (d: string | undefined) => {
  const m = /([\d.-]+),([\d.-]+)$/.exec(d ?? '')
  return { x: Number(m?.[1]), y: Number(m?.[2]) }
}

describe('edgeGeometry', () => {
  // a hand-made layout keeps these tests independent of the ordering heuristics
  const at = (entries: [string, number, number][]): GraphLayout => ({
    pos: new Map(entries.map(([id, x, row]) => [id, { x, y: row * 200 }])),
    row: new Map(entries.map(([id, , row]) => [id, row])),
    width: 2000,
    height: 600,
  })

  test('spreads ports along the source, ordered by where each target sits', () => {
    const t = projectTopology({
      agents: { root: { sub_agents: ['c', 'a', 'b'], handoffs: ['a'] }, a: {}, b: {}, c: {} },
    })
    const layout = at([
      ['agent:root', 300, 0],
      ['agent:a', 0, 1],
      ['agent:b', 300, 1],
      ['agent:c', 600, 1],
    ])
    const g = edgeGeometry(visualEdges(t.edges), layout)
    const xs = [
      'delegation:root->a',
      'handoff:root->a',
      'delegation:root->b',
      'delegation:root->c',
    ].map((id) => start(g.get(id)?.d))
    expect(xs.every((p) => p.y === NODE_H)).toBe(true)
    // strictly increasing left to right, all within the node
    for (let i = 1; i < xs.length; i++) expect(xs[i]?.x ?? 0).toBeGreaterThan(xs[i - 1]?.x ?? 0)
    expect(xs[0]?.x ?? 0).toBeGreaterThan(300)
    expect(xs.at(-1)?.x ?? 0).toBeLessThan(300 + NODE_W)
  })

  test('keeps a two-way pair on separate, non-crossing lanes', () => {
    const t = projectTopology({ agents: { a: { sub_agents: ['b'] }, b: { handoffs: ['a'] } } })
    const g = edgeGeometry(
      visualEdges(t.edges),
      at([
        ['agent:a', 0, 0],
        ['agent:b', 0, 1],
      ]),
    )
    const down = g.get('delegation:a->b')?.d
    const up = g.get('handoff:b->a')?.d
    // a's bottom: the down edge leaves where the up edge does not arrive, and the order matches below
    expect(start(down).x).not.toBe(end(up).x)
    expect(Math.sign(start(down).x - end(up).x)).toBe(Math.sign(end(down).x - start(up).x))
  })

  test('routes same-row neighbours side to side and others below the row', () => {
    const t = projectTopology({ agents: { a: { sub_agents: ['b', 'c'] }, b: {}, c: {} } })
    const g = edgeGeometry(
      visualEdges(t.edges),
      at([
        ['agent:a', 0, 0],
        ['agent:b', NODE_W + 48, 0],
        ['agent:c', 2 * (NODE_W + 48), 0],
      ]),
    )
    expect(start(g.get('delegation:a->b')?.d)).toEqual({ x: NODE_W, y: NODE_H / 2 })
    const arc = g.get('delegation:a->c')
    expect(start(arc?.d).y).toBe(NODE_H)
    expect(arc?.label.y ?? 0).toBeGreaterThan(NODE_H)
  })
})

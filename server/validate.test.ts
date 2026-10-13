import { describe, expect, test } from 'bun:test'
import { validateYaml } from './validate'

const issues = (yaml: string) => validateYaml(yaml).issues.map((i) => `${i.path}: ${i.message}`)
const agent = 'model: openai/gpt-5-mini'

describe('relationship validation', () => {
  test('an empty force_handoff is unset', () => {
    expect(issues(`agents:\n  root: { ${agent}, force_handoff: "" }\n`)).toEqual([])
  })

  test('uses the shared runtime rules for forced handoffs and name clashes', () => {
    expect(
      issues(
        `agents:\n  root: { ${agent}, force_handoff: "root:myorg/reviewer", sub_agents: [ghost] }\n  a: { ${agent}, force_handoff: b }\n  b: { ${agent}, force_handoff: a }\n`,
      ),
    ).toEqual([
      'agents.root.sub_agents.0: unknown agent: ghost',
      'agents.root.force_handoff: external force_handoff entry root:myorg/reviewer resolves to the name root, which conflicts with a local agent',
      'agents.a.force_handoff: force_handoff cycle: a → b → a',
    ])
  })
})

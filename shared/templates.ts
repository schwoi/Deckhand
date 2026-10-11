import type { TemplateInfo } from './api'

const assistant = `version: 16

metadata:
  description: A friendly general-purpose assistant
  tags: [assistant]

agents:
  root:
    model: openai/gpt-5-mini
    description: A helpful general-purpose assistant
    instruction: |
      You are a knowledgeable assistant. Be accurate and concise.
      Think before answering difficult questions.
    toolsets:
      - type: think
      - type: todo
`

const coder = `version: 16

metadata:
  description: A coding agent with filesystem and shell access
  tags: [coding]

models:
  main:
    provider: anthropic
    model: claude-sonnet-4-5
    max_tokens: 64000

agents:
  root:
    model: main
    description: Senior software engineer
    instruction: |
      You are an expert software engineer working in the user's repository.
      Read before you write. Keep changes minimal and explain what you did.
    add_date: true
    add_environment_info: true
    toolsets:
      - type: filesystem
      - type: shell
      - type: git
      - type: think
      - type: todo

permissions:
  allow:
    - "shell:cmd=ls*"
    - "shell:cmd=git status*"
    - "shell:cmd=git diff*"
  deny:
    - "shell:cmd=rm -rf*"
    - "shell:cmd=sudo*"
`

const team = `version: 16

metadata:
  description: A lead agent that delegates to a researcher and a writer
  tags: [multi-agent]

models:
  main:
    provider: openai
    model: gpt-5
    max_tokens: 32000

agents:
  root:
    model: main
    description: Project lead who coordinates research and writing
    instruction: |
      You lead a small team. Break the task down, delegate research to the
      researcher and drafting to the writer, then assemble the final answer.
    sub_agents: [researcher, writer]
    toolsets:
      - type: think
      - type: todo

  researcher:
    model: main
    description: Finds and summarises relevant information from the web
    instruction: Research thoroughly and report facts with sources.
    toolsets:
      - type: mcp
        ref: docker:duckduckgo
      - type: fetch

  writer:
    model: main
    description: Turns research notes into clear prose
    instruction: Write clearly and concisely for a technical audience.
    toolsets:
      - type: think
`

const mcp = `version: 16

metadata:
  description: An agent wired to a GitHub MCP server
  tags: [mcp, github]

mcps:
  github:
    ref: docker:github-official

agents:
  root:
    model: anthropic/claude-sonnet-4-5
    description: GitHub assistant
    instruction: |
      Help the user with GitHub issues, pull requests and repositories
      using the GitHub tools available to you.
    toolsets:
      - type: mcp
        ref: github
    commands:
      whoami: Who am I on GitHub?
`

const local = `version: 16

metadata:
  description: Runs fully offline on Docker Model Runner
  tags: [local]

agents:
  root:
    model: dmr/ai/qwen3:latest
    description: Local assistant
    instruction: You are a helpful assistant running on a local model.
    toolsets:
      - type: think
`

export const TEMPLATES: TemplateInfo[] = [
  {
    id: 'assistant',
    title: 'Assistant',
    description: 'Single agent, think + todo tools.',
    yaml: assistant,
  },
  {
    id: 'coder',
    title: 'Coding agent',
    description: 'Filesystem, shell, git, with safe permissions.',
    yaml: coder,
  },
  {
    id: 'team',
    title: 'Agent team',
    description: 'A lead that delegates to researcher and writer sub-agents.',
    yaml: team,
  },
  {
    id: 'mcp',
    title: 'MCP-powered',
    description: 'Uses a Docker MCP Catalog server (GitHub).',
    yaml: mcp,
  },
  {
    id: 'local',
    title: 'Local model',
    description: 'Runs on Docker Model Runner, no API key.',
    yaml: local,
  },
]

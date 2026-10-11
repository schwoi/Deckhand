import { Check, Copy } from 'lucide-react'
import { type ReactNode, useState } from 'react'

type Block =
  | { t: 'code'; lang: string; code: string }
  | { t: 'p'; lines: string[] }
  | { t: 'h'; level: number; text: string }
  | { t: 'list'; ordered: boolean; items: string[] }
  | { t: 'quote'; lines: string[] }

const LIST_RE = /^\s*(?:[-*+]|(\d+)[.)])\s+/

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.split('\n')
  let para: string[] = []
  const flush = () => {
    if (para.length === 0) return
    const p = para
    para = []
    const h = p.length === 1 ? /^(#{1,4})\s+(.*)$/.exec(p[0] ?? '') : null
    if (h) blocks.push({ t: 'h', level: h[1]?.length ?? 1, text: h[2] ?? '' })
    else if (p.every((l) => LIST_RE.test(l) || /^\s{2,}\S/.test(l))) {
      const items: string[] = []
      for (const l of p) {
        if (LIST_RE.test(l)) items.push(l.replace(LIST_RE, ''))
        else items[items.length - 1] += ` ${l.trim()}`
      }
      blocks.push({ t: 'list', ordered: /^\s*\d/.test(p[0] ?? ''), items })
    } else if (p.every((l) => l.startsWith('>')))
      blocks.push({ t: 'quote', lines: p.map((l) => l.replace(/^>\s?/, '')) })
    else blocks.push({ t: 'p', lines: p })
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const fence = /^\s*```(\S*)/.exec(line)
    if (fence) {
      flush()
      const code: string[] = []
      i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i] ?? '')) code.push(lines[i++] ?? '')
      blocks.push({ t: 'code', lang: fence[1] ?? '', code: code.join('\n') })
      continue
    }
    if (line.trim() === '') flush()
    else para.push(line)
  }
  flush()
  return blocks
}

const INLINE_RE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\))/g

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(text.slice(last, idx))
    const [whole, code, bold, link, url] = m
    if (code)
      out.push(
        <code key={idx} className="rounded bg-sunken px-1 py-px font-mono text-[0.9em]">
          {code.slice(1, -1)}
        </code>,
      )
    else if (bold)
      out.push(
        <strong key={idx} className="font-semibold">
          {bold.slice(2, -2)}
        </strong>,
      )
    else if (link && url)
      out.push(
        <a
          key={idx}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-accent-text underline underline-offset-2"
        >
          {link.slice(1, link.indexOf(']'))}
        </a>,
      )
    last = idx + whole.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="group relative overflow-hidden rounded-md border bg-sunken">
      <div className="flex items-center justify-between border-b px-3 py-1">
        <span className="font-mono text-2xs text-faint">{lang || 'code'}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(code).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1200)
            })
          }}
          className="flex items-center gap-1 text-2xs text-faint hover:text-fg max-lg:-my-1 max-lg:py-1.5 max-lg:pl-2"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-xs leading-relaxed">{code}</pre>
    </div>
  )
}

/** Minimal markdown: paragraphs, headings, lists, quotes, fenced code, inline code, bold, links. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2.5 text-md leading-relaxed break-words">
      {parseBlocks(text).map((b, i) => {
        const k = i
        switch (b.t) {
          case 'code':
            return <CodeBlock key={k} lang={b.lang} code={b.code} />
          case 'h':
            return (
              <p key={k} className={b.level <= 2 ? 'mt-1 text-lg font-semibold' : 'font-semibold'}>
                {inline(b.text)}
              </p>
            )
          case 'list': {
            const L = b.ordered ? 'ol' : 'ul'
            return (
              <L key={k} className={b.ordered ? 'list-decimal pl-5' : 'list-disc pl-5'}>
                {b.items.map((it, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static content
                  <li key={j} className="pl-0.5">
                    {inline(it)}
                  </li>
                ))}
              </L>
            )
          }
          case 'quote':
            return (
              <blockquote key={k} className="border-l-2 pl-3 text-muted">
                {inline(b.lines.join(' '))}
              </blockquote>
            )
          case 'p':
            return (
              <p key={k}>
                {b.lines.map((l, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static content
                  <span key={j}>
                    {j > 0 && <br />}
                    {inline(l)}
                  </span>
                ))}
              </p>
            )
        }
      })}
    </div>
  )
}

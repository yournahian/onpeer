import { TOOL_LABELS } from '@/agent/tools'

export type TextCall = { name: string; args: Record<string, unknown> }

const NAMES = Object.keys(TOOL_LABELS)
const CALL = new RegExp(`\\b(${NAMES.join('|')})\\s*\\(([^()]*)\\)`, 'g')
const ARG = /([A-Za-z_]\w*)\s*[=:]\s*(?:"([^"]*)"|'([^']*)'|([^,\s)]+))/g

/**
 * Small models sometimes print a tool call as text, e.g. propose_swap(token_in="USDC", amount="5"),
 * instead of using the tool-call channel. Recover those calls and strip them from the visible reply.
 */
export function extractTextCalls(content: string): { calls: TextCall[]; cleaned: string } {
  const calls: TextCall[] = []
  for (const m of content.matchAll(CALL)) {
    const args: Record<string, unknown> = {}
    for (const a of m[2].matchAll(ARG)) args[a[1]] = a[2] ?? a[3] ?? a[4]
    calls.push({ name: m[1], args })
  }
  const cleaned = content
    .replace(CALL, '')
    .replace(/```[a-z]*\s*```/g, '')
    .replace(/`\s*`/g, '')
    .trim()
  return { calls, cleaned }
}

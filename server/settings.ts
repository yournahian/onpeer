/**
 * Assistant settings saved from the admin panel. Kept in a local file on the server (never in the browser,
 * never returned by any endpoint). Environment variables still work; a saved value takes priority over them.
 */
import { existsSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export type ProviderId = 'openrouter' | 'groq' | 'gemini' | 'custom'

export const PROVIDER_IDS: ProviderId[] = ['openrouter', 'groq', 'gemini', 'custom']

export type SavedProvider = { apiKey?: string; model?: string; baseUrl?: string; label?: string }
export type SavedSettings = { active?: ProviderId; providers: Partial<Record<ProviderId, SavedProvider>> }

const FILE = fileURLToPath(new URL('./ai-settings.json', import.meta.url))

export function loadSettings(): SavedSettings {
  try {
    if (!existsSync(FILE)) return { providers: {} }
    const raw = JSON.parse(readFileSync(FILE, 'utf8')) as SavedSettings
    return { active: raw.active, providers: raw.providers ?? {} }
  } catch {
    return { providers: {} }
  }
}

export function saveSettings(next: SavedSettings): void {
  const tmp = `${FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
  renameSync(tmp, FILE)
  try {
    chmodSync(FILE, 0o600)
  } catch {
    /* best effort */
  }
}

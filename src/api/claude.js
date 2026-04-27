const MODEL = 'claude-sonnet-4-20250514'
const API_URL = 'https://api.anthropic.com/v1/messages'
export const KEY_STORAGE = 'claude_api_key'

export function getApiKey() {
  return import.meta.env.VITE_ANTHROPIC_API_KEY || localStorage.getItem(KEY_STORAGE) || ''
}
export function saveApiKey(key) {
  localStorage.setItem(KEY_STORAGE, key.trim())
}

async function callClaude(system, userContent) {
  const key = getApiKey()
  if (!key) { const e = new Error('NO_KEY'); e.code = 'NO_KEY'; throw e }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-allow-browser': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  })

  if (res.status === 401) { const e = new Error('INVALID_KEY'); e.code = 'INVALID_KEY'; throw e }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message || `HTTP ${res.status}`)
  }
  const data = await res.json()
  const text = data.content[0].text.trim()
  // Strip markdown code fences if model wraps response
  const json = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '')
  return JSON.parse(json)
}

const WORD_SYSTEM = `You are an English learning assistant. The user is French and taps on English words while reading. Reply ONLY with a JSON object (no markdown): { "definition_fr": string, "example_en": string, "level": "easy"|"medium"|"hard" }`

const TRANSLATE_SYSTEM = `Translate this English sentence or phrase to French naturally, then explain the meaning in 1 simple French sentence. Reply ONLY with a JSON object (no markdown): { "translation_fr": string, "explanation_fr": string }`

export async function lookupWord(word) {
  return callClaude(WORD_SYSTEM, word)
}

export async function translateText(text) {
  return callClaude(TRANSLATE_SYSTEM, text)
}

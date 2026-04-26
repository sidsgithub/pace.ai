export const config = { runtime: 'edge' }

const EXTRACT_PROMPT =
  'Extract profile fields from this conversation as JSON. ' +
  'Fields: name, city, fitness_level, goal, health_notes, sport_affinity, days_per_week (number). ' +
  'For name: extract exactly what the user said when asked their name — take it literally, even if it looks unusual or like a test value. ' +
  'For fitness_level: infer from context — if they are new to running, never run before, or just starting out use "beginner"; ' +
  'if they run occasionally or have some base use "mid"; if they run regularly or have race experience use "advanced". ' +
  'Do NOT leave fitness_level null if there are any clues in the conversation — make your best inference. ' +
  'Return only valid JSON, no other text. Return null only for fields with zero information.'

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const { messages, prompt: promptOverride } = await req.json()
  const extractPrompt = promptOverride ?? EXTRACT_PROMPT

  // Drop leading assistant messages — Anthropic requires messages to start with 'user'
  const trimmed = messages[0]?.role === 'assistant' ? messages.slice(1) : messages

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      temperature: 0,
      system: [{ type: 'text', text: extractPrompt, cache_control: { type: 'ephemeral' } }],
      messages: trimmed,
    }),
  })

  const data = await upstream.json()
  if (!upstream.ok) {
    console.error('extract upstream error:', upstream.status, JSON.stringify(data))
    return new Response(JSON.stringify({ _error: upstream.status, _detail: data }), { headers: { 'Content-Type': 'application/json' } })
  }
  console.log('cache stats (extract):', {
    cache_creation_input_tokens: data.usage?.cache_creation_input_tokens,
    cache_read_input_tokens: data.usage?.cache_read_input_tokens,
    input_tokens: data.usage?.input_tokens,
  })

  const raw = data.content?.[0]?.text ?? '{}'
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  try {
    const extracted = JSON.parse(text)
    return new Response(JSON.stringify(extracted), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } })
  }
}

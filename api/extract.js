export const config = { runtime: 'edge' }

const EXTRACT_PROMPT =
  'Extract profile fields from this conversation as JSON. ' +
  'PRIORITY fields — extract these above all else: name, goal, fitness_level, days_per_week (number), city. ' +
  'Secondary fields: health_notes, sport_affinity. ' +
  'For name: extract exactly what the user said when asked their name — take it literally. ' +
  'For goal: capture the full running goal including race name, distance, and date if mentioned. ' +
  'For city: extract the city or location the user mentioned — infer from context if not stated directly. ' +
  'For days_per_week: extract the number of days per week the user runs or plans to run. ' +
  'For fitness_level: use "beginner" if new to running or just starting out; "mid" if running occasionally or with some base; "advanced" if running regularly or with race experience. Do NOT leave null if there are any clues. ' +
  'Return only valid JSON, no other text. Return null only for fields with zero information.'

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const { messages, prompt: promptOverride } = await req.json()
  const extractPrompt = promptOverride ?? EXTRACT_PROMPT

  // Wrap the conversation as text in a single user message so Claude extracts rather than continues
  const transcript = messages.map(m => `${m.role === 'assistant' ? 'coach' : 'user'}: ${m.content}`).join('\n\n')

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
      messages: [{ role: 'user', content: transcript }],
    }),
  })

  const data = await upstream.json()
  if (!upstream.ok) {
    console.error('extract upstream error:', upstream.status, JSON.stringify(data))
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } })
  }
  console.log('cache stats (extract):', {
    cache_creation_input_tokens: data.usage?.cache_creation_input_tokens,
    cache_read_input_tokens: data.usage?.cache_read_input_tokens,
    input_tokens: data.usage?.input_tokens,
  })

  const raw = data.content?.[0]?.text ?? '{}'
  // Find the JSON object even if Claude wraps it in prose or code fences
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  const text = jsonMatch ? jsonMatch[0] : '{}'

  try {
    const extracted = JSON.parse(text)
    return new Response(JSON.stringify(extracted), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } })
  }
}

export const config = { runtime: 'edge' }

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const { messages, system: systemOverride, max_tokens: maxTokensOverride } = await req.json()
  const systemPrompt = systemOverride ?? process.env.VITE_COACH_PACE_SYSTEM_PROMPT ?? ''

  // Drop leading assistant messages — Anthropic requires messages to start with 'user'
  const trimmed = messages[0]?.role === 'assistant' ? messages.slice(1) : messages

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokensOverride ?? 1000,
      temperature: 0.7,
      system: systemPrompt,
      messages: trimmed,
      stream: true,
    }),
  })

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  })
}

export const config = { runtime: 'edge' }

function withCachedHistory(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      const msg = messages[i]
      const content = typeof msg.content === 'string'
        ? [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } }]
        : [...msg.content.slice(0, -1), { ...msg.content[msg.content.length - 1], cache_control: { type: 'ephemeral' } }]
      const result = [...messages]
      result[i] = { ...msg, content }
      return result
    }
  }
  return messages
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const { messages, system: systemOverride, max_tokens: maxTokensOverride } = await req.json()
  const systemPrompt = systemOverride ?? process.env.VITE_COACH_PACE_SYSTEM_PROMPT ?? ''

  // Drop leading assistant messages — Anthropic requires messages to start with 'user'
  const trimmed = messages;

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
      max_tokens: maxTokensOverride ?? 1000,
      temperature: 0.7,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: withCachedHistory(trimmed),
      stream: true,
    }),
  })

  // Pass through the SSE stream, intercepting message_start to log cache stats
  const { readable, writable } = new TransformStream({
    transform(chunk, controller) {
      const text = new TextDecoder().decode(chunk)
      for (const line of text.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(line.slice(6))
            if (parsed.type === 'message_start' && parsed.message?.usage) {
              const u = parsed.message.usage
              console.log('cache stats (chat):', {
                cache_creation_input_tokens: u.cache_creation_input_tokens,
                cache_read_input_tokens: u.cache_read_input_tokens,
                input_tokens: u.input_tokens,
              })
            }
          } catch { /* ignore malformed SSE */ }
        }
      }
      controller.enqueue(chunk)
    },
  })

  upstream.body.pipeTo(writable)

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  })
}

export async function streamChat(messages, onChunk) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })

  if (!res.ok) throw new Error(`Chat API error: ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6)
      if (payload === '[DONE]') return

      try {
        const parsed = JSON.parse(payload)
        if (
          parsed.type === 'content_block_delta' &&
          parsed.delta?.type === 'text_delta'
        ) {
          onChunk(parsed.delta.text)
        }
      } catch {
        // ignore malformed SSE lines
      }
    }
  }
}

export async function extractProfile(messages) {
  const res = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
  const text = await res.text()
  console.log('extract raw response (status', res.status, '):', text)
  try { return JSON.parse(text) } catch { return {} }
}

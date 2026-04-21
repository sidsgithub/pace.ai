import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

function buildPrompt(profile) {
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]

  return `You are generating a 7-day running plan for the following user.
Return ONLY a JSON array, no other text, no markdown.
Today's date is ${todayStr} (use this as day 1 — do not guess dates).

User profile:
- Name: ${profile.name ?? 'Unknown'}
- Fitness level: ${profile.fitness_level ?? 'beginner'}
- Goal: ${profile.goal ?? 'general fitness'}
- Available days per week: ${profile.days_per_week ?? 3}
- City: ${profile.city ?? 'Unknown'}
- Sport background: ${profile.sport_affinity ?? 'none'}
- Health notes: ${profile.health_notes ?? 'none'}

Return a JSON array of 7 objects, one per day starting from tomorrow.
Each object:
{
  "session_date": "YYYY-MM-DD",
  "session_type": "easy" | "tempo" | "intervals" | "long" | "rest" | "strength",
  "title": "short title e.g. Easy 3km",
  "description": "2-3 sentences of specific instructions",
  "coach_message": "one warm motivational line from Coach Pace",
  "distance_km": number or null,
  "duration_min": number or null
}

Rules:
- Respect days_per_week — rest on the other days
- Beginner: max 3-4km per run, no intervals in week 1
- Mid: can include one tempo and one longer run
- Advanced: can include intervals, tempo, and a long run
- Never schedule hard sessions on consecutive days
- Always include at least 2 rest days
- If sport_affinity is set, reference it in one coach_message`
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const { profile, userId } = await req.json()

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      temperature: 0.7,
      messages: [{ role: 'user', content: buildPrompt(profile) }],
    }),
  })

  const data = await upstream.json()
  const raw = data.content?.[0]?.text ?? '[]'
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  let sessions
  try {
    sessions = JSON.parse(text)
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to parse plan', raw: text }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const rows = sessions.map((s) => ({ ...s, user_id: userId, status: 'planned' }))

  // Insert server-side using service role key to bypass RLS
  const adminSupabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )
  const { error } = await adminSupabase.from('sessions').insert(rows)
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify(rows), {
    headers: { 'Content-Type': 'application/json' },
  })
}

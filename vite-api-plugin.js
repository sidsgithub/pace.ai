import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

function buildPlanPrompt(profile, adjustmentReason) {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

  const adjustmentNote = adjustmentReason
    ? `\nRecent check-in note: ${adjustmentReason}\nFactor this into the next 7 days — adjust intensity, distance or session type where appropriate.\n`
    : ''

  return `You are generating a 7-day running plan for the following user.
Return ONLY a JSON array, no other text, no markdown.
Today's date is ${todayStr} (use this as day 1 — do not guess dates).
${adjustmentNote}
User profile:
- Name: ${profile.name ?? 'Unknown'}
- Fitness level: ${profile.fitness_level ?? 'beginner'}
- Goal: ${profile.goal ?? 'general fitness'}
- Available days per week: ${profile.days_per_week ?? 3}
- City: ${profile.city ?? 'Unknown'}
- Sport background: ${profile.sport_affinity ?? 'none'}
- Health notes: ${profile.health_notes ?? 'none'}

Return a JSON array of 7 objects, one per day starting from today.
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
- If sport_affinity is set, reference it in one coach_message

INJURY RULES — these override everything else:
- If health_notes contains any mention of pain, ache, soreness or injury: the day immediately after the reported run MUST be a rest day, no exceptions.
- If pain is in the foot, knee or ankle: the following 2 days must be rest or strength only, no running.
- Never schedule a run the day after pain was reported unless health_notes explicitly says the pain resolved.`
}

const EXTRACT_PROMPT =
  'Extract profile fields from this conversation as JSON. ' +
  'Fields: name, city, fitness_level, goal, health_notes, sport_affinity, days_per_week (number). ' +
  'For name: extract exactly what the user said when asked their name — take it literally, even if it looks unusual or like a test value. ' +
  'For fitness_level: infer from context — if they are new to running, never run before, or just starting out use "beginner"; ' +
  'if they run occasionally or have some base use "mid"; if they run regularly or have race experience use "advanced". ' +
  'Do NOT leave fitness_level null if there are any clues in the conversation — make your best inference. ' +
  'Return only valid JSON, no other text. Return null only for fields with zero information.'

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => {
      try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function stripFences(str) {
  return str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
}

export function apiPlugin() {
  return {
    name: 'vite-api-plugin',
    configureServer(server) {
      server.middlewares.use('/api/chat', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        try {
          const { messages, system: systemOverride, max_tokens: maxTokensOverride } = await readBody(req)
          const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

          res.setHeader('Content-Type', 'text/event-stream')
          res.setHeader('Cache-Control', 'no-cache')
          res.setHeader('Connection', 'keep-alive')

          const trimmed = messages[0]?.role === 'assistant' ? messages.slice(1) : messages
          const stream = client.messages.stream({
            model: 'claude-sonnet-4-6',
            max_tokens: maxTokensOverride ?? 1000,
            temperature: 0.7,
            system: systemOverride ?? process.env.VITE_COACH_PACE_SYSTEM_PROMPT ?? '',
            messages: trimmed,
          })

          for await (const event of stream) {
            res.write(`data: ${JSON.stringify(event)}\n\n`)
          }
          res.write('data: [DONE]\n\n')
          res.end()
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: err.message }))
        }
      })

      server.middlewares.use('/api/generate-plan', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        try {
          const { profile, userId, adjustmentReason = null, force = false } = await readBody(req)
          const adminSupabase = createClient(
            process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY,
          )

          // Skip generation if a future planned session already exists (unless forced)
          const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
          if (!force) {
            const { data: existing } = await adminSupabase
              .from('sessions')
              .select('id')
              .eq('user_id', userId)
              .eq('status', 'planned')
              .gte('session_date', today)
              .limit(1)

            if (existing && existing.length > 0) {
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: true, skipped: true, reason: 'plan already exists' }))
              return
            }
          }

          const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

          const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 2000,
            temperature: 0.7,
            messages: [{ role: 'user', content: buildPlanPrompt(profile, adjustmentReason) }],
          })

          const text = stripFences(response.content?.[0]?.text ?? '[]')
          let sessions
          try { sessions = JSON.parse(text) } catch {
            res.statusCode = 500
            res.end(JSON.stringify({ error: 'Failed to parse plan' }))
            return
          }

          const rows = sessions.map((s) => ({ ...s, user_id: userId, status: 'planned' }))
          const { error, data: upserted } = await adminSupabase
            .from('sessions')
            .upsert(rows, { onConflict: 'user_id,session_date', ignoreDuplicates: false })
            .select()
          if (error) throw error

          // Write adjustment_reason to first non-rest session
          if (adjustmentReason && upserted) {
            const firstActive = upserted.find((s) => s.session_type !== 'rest')
            if (firstActive) {
              await adminSupabase
                .from('sessions')
                .update({ adjustment_reason: adjustmentReason })
                .eq('id', firstActive.id)

            }
          }

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(upserted ?? rows))
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: err.message }))
        }
      })

      server.middlewares.use('/api/extract', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        try {
          const { messages, prompt: promptOverride } = await readBody(req)
          const extractPrompt = promptOverride ?? EXTRACT_PROMPT
          const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

          const trimmed = messages[0]?.role === 'assistant' ? messages.slice(1) : messages
          const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 500,
            temperature: 0,
            messages: [...trimmed, { role: 'user', content: extractPrompt }],
          })

          const text = stripFences(response.content?.[0]?.text ?? '{}')
          let extracted = {}
          try { extracted = JSON.parse(text) } catch { /* return empty on parse failure */ }

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(extracted))
        } catch {
          res.statusCode = 500
          res.end('{}')
        }
      })
    },
  }
}

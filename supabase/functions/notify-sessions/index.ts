// Cron function — handles two notification triggers:
//   Trigger A: 7am IST morning reminder for today's planned sessions
//   Trigger B: Missed session nudge for past sessions still 'planned'
//
// Schedule in Supabase dashboard:
//   Trigger A: cron "30 1 * * *"  (01:30 UTC = 07:00 IST)
//   Trigger B: cron "0 2 * * *"   (02:00 UTC = 07:30 IST, catches yesterday's missed)

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_EMAIL = Deno.env.get('VAPID_EMAIL')!

webpush.setVapidDetails(`mailto:${VAPID_EMAIL}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function istDateStr(offsetDays = 0): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() + 330 + offsetDays * 24 * 60) // UTC+5:30
  return d.toISOString().split('T')[0]
}

async function sendPush(userId: string, title: string, body: string) {
  const { data: row } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', userId)
    .single()

  if (!row) return

  try {
    const subscription = JSON.parse(row.subscription)
    await webpush.sendNotification(subscription, JSON.stringify({ title, body }))
  } catch {
    // Silently skip — stale subscriptions will fail here
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const { trigger } = await req.json().catch(() => ({}))
  const today = istDateStr()
  const yesterday = istDateStr(-1)
  const results: string[] = []

  // Trigger A — morning reminder: today's planned sessions, not yet done
  if (!trigger || trigger === 'morning') {
    const { data: sessions } = await supabase
      .from('sessions')
      .select('user_id, title, session_type')
      .eq('session_date', today)
      .eq('status', 'planned')
      .neq('session_type', 'rest')

    for (const s of sessions ?? []) {
      await sendPush(
        s.user_id,
        "Today's run is ready 🏃",
        s.title ? `${s.title} — tap to get started.` : 'Coach Pace has your plan ready.',
      )
      results.push(`morning:${s.user_id}`)
    }
  }

  // Trigger B — missed session nudge: yesterday's planned sessions still 'planned'
  if (!trigger || trigger === 'missed') {
    const { data: missed } = await supabase
      .from('sessions')
      .select('user_id, session_type')
      .eq('session_date', yesterday)
      .eq('status', 'planned')
      .neq('session_type', 'rest')

    for (const s of missed ?? []) {
      await sendPush(
        s.user_id,
        "Missed yesterday's run?",
        "No worries — Coach Pace has adjusted your plan. Check in when you're ready.",
      )
      results.push(`missed:${s.user_id}`)
    }
  }

  return new Response(JSON.stringify({ sent: results.length, results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

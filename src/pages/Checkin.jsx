import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { generateAndSavePlan } from '../lib/generatePlan'

const CHECKIN_SYSTEM =
  'You are Coach Pace doing a brief post-run check-in. ' +
  'Keep it warm and short — maximum 4 exchanges total. ' +
  'Ask only about effort and any pain or discomfort. ' +
  'Never ask more than one question at a time. ' +
  'If the user mentions emotional difficulty, acknowledge it once lightly and move on — do not probe. ' +
  'End with one encouraging closing line.'

const CHECKIN_EXTRACT_PROMPT =
  'Extract post-run signals from this conversation as JSON. ' +
  'Fields: effort_feel ("easy"|"good"|"hard"|"very_hard"|null), ' +
  'pain_flags (string describing any pain or discomfort, or null), ' +
  'energy_level ("high"|"normal"|"low"|null), ' +
  'mood_signal ("positive"|"neutral"|"negative"|null), ' +
  'adjustment_reason (if there is anything that warrants adjusting the next training plan — pain, very high effort, exhaustion — write one short sentence from Coach Pace\'s perspective explaining the adjustment, e.g. "Eased up Thursday based on the knee discomfort you mentioned." Otherwise null). ' +
  'Return only valid JSON, no other text. Return null for any field with zero information.'

const EFFORT_MAP = { easy: 4, good: 6, hard: 8, very_hard: 10 }
const CLOSING_MESSAGE = "You're doing great — see you next session."

async function streamCheckin(messages, onChunk) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      system: CHECKIN_SYSTEM,
      max_tokens: 300,
    }),
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
        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
          onChunk(parsed.delta.text)
        }
      } catch { /* ignore malformed SSE */ }
    }
  }
}

async function extractCheckin(messages) {
  const res = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, prompt: CHECKIN_EXTRACT_PROMPT }),
  })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return {} }
}

export default function Checkin() {
  const [searchParams] = useSearchParams()
  const sessionId = searchParams.get('session_id')
  const navigate = useNavigate()

  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState('effort') // 'effort' | 'pain' | 'done'
  const [signalDraft, setSignalDraft] = useState({})

  const bottomRef = useRef(null)

  // Load session + fire opening message
  useEffect(() => {
    if (!sessionId) { navigate('/home'); return }

    async function init() {
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) { navigate('/onboarding'); return }
      setUser(u)

      const { data: s } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .single()

      if (!s) { navigate('/home'); return }
      setSession(s)

      const opener = {
        role: 'assistant',
        content: `Just finished ${s.title} — nice work. How did it feel overall?`,
      }
      setMessages([opener])
    }

    init()
  }, [sessionId, navigate])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const sendMessage = async () => {
    if (!input.trim() || loading || stage === 'done') return

    const userMsg = { role: 'user', content: input.trim() }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput('')

    setLoading(true)
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

    let fullText = ''
    try {
      await streamCheckin(nextMessages, (chunk) => {
        fullText += chunk
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: fullText }
          return updated
        })
      })
    } finally {
      setLoading(false)
    }

    const withAssistant = [...nextMessages, { role: 'assistant', content: fullText }]

    if (stage === 'pain') {
      // Claude has acknowledged the pain answer — now append closing and finish
      setMessages((prev) => [...prev, { role: 'assistant', content: CLOSING_MESSAGE }])
      setStage('done')
      extractCheckin([...withAssistant, { role: 'assistant', content: CLOSING_MESSAGE }])
        .then((extracted) => {
          if (extracted && typeof extracted === 'object') {
            setSignalDraft((prev) => {
              const merged = { ...prev }
              for (const [k, v] of Object.entries(extracted)) {
                if (v !== null && v !== undefined) merged[k] = v
              }
              return merged
            })
          }
        })
        .catch(() => {})
      return
    }

    // stage === 'effort': advance to pain stage if Coach Pace asked about pain/discomfort
    const lower = fullText.toLowerCase()
    if (lower.includes('pain') || lower.includes('discomfort') || lower.includes('hurt') || lower.includes('ache')) {
      setStage('pain')
    }

    // Silent signal extraction
    extractCheckin(withAssistant)
      .then((extracted) => {
        if (extracted && typeof extracted === 'object') {
          setSignalDraft((prev) => {
            const merged = { ...prev }
            for (const [k, v] of Object.entries(extracted)) {
              if (v !== null && v !== undefined) merged[k] = v
            }
            return merged
          })
        }
      })
      .catch(() => {})
  }

  const goHome = async () => {
    navigate('/home')

    try {
      // Do a final extraction to capture any signals from the last message
      const finalSignals = await extractCheckin(messages).catch(() => ({}))
      const signals = { ...signalDraft, ...Object.fromEntries(
        Object.entries(finalSignals).filter(([, v]) => v !== null && v !== undefined)
      )}

      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
      const effort = EFFORT_MAP[signals.effort_feel] ?? null

      // Upsert run record — prevents duplicate if check-in fires twice
      await supabase.from('runs').upsert({
        user_id: user.id,
        session_id: session.id,
        run_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
        distance_km: session.distance_km ?? null,
        duration_min: session.duration_min ?? null,
        effort: effort,
        pain_flags: signals.pain_flags ?? null,
        notes: lastUserMsg?.content ?? null,
      }, { onConflict: 'user_id,session_id', ignoreDuplicates: false })

      // Update health_notes if pain flagged
      if (signals.pain_flags) {
        await supabase
          .from('users')
          .update({ health_notes: signals.pain_flags, updated_at: new Date().toISOString() })
          .eq('id', user.id)
      }

      // Regenerate plan with updated profile + adjustment reason, force bypass duplicate check
      const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single()
      if (profile) {
        generateAndSavePlan(profile, user.id, {
          adjustmentReason: signals.adjustment_reason ?? null,
          force: true,
        }).catch(() => {})
      }
    } catch {
      // Save failure is silent — user is already on /home
    }
  }

  if (!session) return null

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-36 flex flex-col gap-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-[#3b6d11] text-white rounded-br-sm'
                  : 'bg-gray-100 text-gray-800 rounded-bl-sm'
              }`}
            >
              {msg.content || <span className="opacity-30">● ● ●</span>}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {stage === 'done' && (
        <div className="fixed bottom-[72px] left-0 right-0 flex justify-center px-4 pb-2">
          <button
            onClick={goHome}
            className="bg-[#3b6d11] text-white text-sm font-medium px-6 py-3 rounded-xl shadow-lg"
          >
            Back to home
          </button>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-4 py-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          placeholder="Reply to Coach Pace…"
          disabled={loading || stage === 'done'}
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#3b6d11] transition-colors disabled:opacity-50"
        />
        <button
          onClick={sendMessage}
          disabled={loading || stage === 'done' || !input.trim()}
          className="bg-[#3b6d11] text-white rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-40 transition-opacity"
        >
          Send
        </button>
      </div>
    </div>
  )
}

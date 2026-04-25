import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { streamChat, extractProfile } from '../lib/claude'
import { generateAndSavePlan } from '../lib/generatePlan'
import OTPInput from '../components/OTPInput'

const INITIAL_MESSAGE = {
  role: 'assistant',
  content:
    "Hi! I'm Coach Pace, your personal AI running coach 🏃 I'm here to build a training plan that's just right for you. Let's start — what's your name?",
}

export default function Onboarding() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  // Auth step: 'email' | 'otp'
  const [authStep, setAuthStep] = useState('email')
  const [email, setEmail] = useState('')
  const [otpError, setOtpError] = useState('')
  const [otpLoading, setOtpLoading] = useState(false)
  const [resendCountdown, setResendCountdown] = useState(0)

  const [messages, setMessages] = useState([INITIAL_MESSAGE])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const [profileDraft, setProfileDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const [closingSent, setClosingSent] = useState(false)

  const bottomRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const currentUser = session?.user ?? null
      setUser(currentUser)

      if (currentUser) {
        const { data } = await supabase
          .from('users')
          .select('onboarded')
          .eq('id', currentUser.id)
          .single()
        if (data?.onboarded) {
          navigate('/home')
          return
        }
      }

      setAuthLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [navigate])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Countdown timer for resend
  useEffect(() => {
    if (resendCountdown <= 0) return
    const t = setTimeout(() => setResendCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCountdown])

  const sendCode = async (e) => {
    e?.preventDefault()
    await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
    setAuthStep('otp')
    setResendCountdown(30)
  }

  const resendCode = async () => {
    await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
    setOtpError('')
    setResendCountdown(30)
  }

  const verifyCode = async (token) => {
    setOtpLoading(true)
    setOtpError('')
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
    if (error) setOtpError('Incorrect code — try again')
    setOtpLoading(false)
    // on success, onAuthStateChange handles navigation
  }

  const sendMessage = async () => {
    if (!input.trim() || loading) return

    const userMessage = { role: 'user', content: input.trim() }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInput('')
    setLoading(true)

    setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

    let fullText = ''
    try {
      await streamChat(nextMessages, (chunk) => {
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

    const userTurns = nextMessages.filter((m) => m.role === 'user').length
    if (userTurns < 3) return

    const withAssistant = [...nextMessages, { role: 'assistant', content: fullText }]
    extractProfile(withAssistant)
      .then((extracted) => {
        if (extracted && typeof extracted === 'object') {
          setProfileDraft((prev) => {
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

  const userMessageCount = messages.filter((m) => m.role === 'user').length

  const effectiveProfile = {
    ...profileDraft,
    fitness_level: profileDraft.fitness_level ?? (userMessageCount >= 8 ? 'beginner' : null),
  }

  const profileReady =
    userMessageCount >= 6 &&
    profileDraft.name &&
    profileDraft.fitness_level &&
    profileDraft.goal &&
    profileDraft.days_per_week &&
    (profileDraft.city || profileDraft.sport_affinity || profileDraft.health_notes)

  useEffect(() => {
    if (profileReady && !closingSent) {
      setClosingSent(true)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: "I have everything I need to build your plan. Tap 'Save your plan' when you're ready and I'll set it up for you.",
        },
      ])
    }
  }, [profileReady, closingSent])

  const saveProfile = async () => {
    if (!user) return
    setSaving(true)
    try {
      const { error: profileError } = await supabase.from('users').upsert({
        id: user.id,
        ...effectiveProfile,
        onboarded: true,
        updated_at: new Date().toISOString(),
      })
      if (profileError) throw profileError
      navigate('/home')
      generateAndSavePlan(effectiveProfile, user.id)
    } catch {
      setSaving(false)
    }
  }

  if (authLoading) return null

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Meet Coach Pace</h1>
        <p className="text-sm text-gray-400 mb-8 text-center">
          We'll save your profile after we get to know you
        </p>

        {authStep === 'email' ? (
          <form onSubmit={sendCode} className="w-full max-w-sm flex flex-col gap-3">
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#3b6d11] transition-colors"
            />
            <button
              type="submit"
              className="bg-[#3b6d11] text-white rounded-xl py-3 text-sm font-medium"
            >
              Send code
            </button>
          </form>
        ) : (
          <div className="w-full max-w-sm flex flex-col items-center gap-6">
            <p className="text-sm text-gray-500 text-center">
              We sent a 6-digit code to{' '}
              <button
                onClick={() => { setAuthStep('email'); setOtpError('') }}
                className="font-medium text-gray-800 underline underline-offset-2"
              >
                {email}
              </button>
            </p>

            <OTPInput
              onComplete={verifyCode}
              error={otpError}
              loading={otpLoading}
            />

            <button
              onClick={resendCode}
              disabled={resendCountdown > 0}
              className="text-xs text-gray-400 disabled:opacity-50 transition-opacity"
            >
              {resendCountdown > 0 ? `Resend code in ${resendCountdown}s` : 'Resend code'}
            </button>
          </div>
        )}
      </div>
    )
  }

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

      {profileReady && (
        <div className="fixed bottom-[72px] left-0 right-0 flex justify-center px-4 pb-2">
          <button
            onClick={saveProfile}
            disabled={saving}
            className="bg-[#3b6d11] text-white text-sm font-medium px-6 py-3 rounded-xl shadow-lg disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save your plan →'}
          </button>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-4 py-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          placeholder="Message Coach Pace…"
          disabled={loading || closingSent}
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#3b6d11] transition-colors disabled:opacity-50"
        />
        <button
          onClick={sendMessage}
          disabled={loading || closingSent || !input.trim()}
          className="bg-[#3b6d11] text-white rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-40 transition-opacity"
        >
          Send
        </button>
      </div>
    </div>
  )
}

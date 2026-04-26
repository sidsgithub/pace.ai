import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const MAX_RESENDS = 3

export default function OTPInput({ onComplete, error, loading, email } = {}) {
  const [digits, setDigits] = useState(Array(6).fill(''))
  const refs = useRef([])

  const [countdown, setCountdown] = useState(60)
  const [resendSending, setResendSending] = useState(false)
  const [resendError, setResendError] = useState('')
  const [resendCount, setResendCount] = useState(0)

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  useEffect(() => {
    if (error) {
      setDigits(Array(6).fill(''))
      refs.current[0]?.focus()
    }
  }, [error])

  const handleChange = (i, value) => {
    const char = value.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[i] = char
    setDigits(next)
    if (char && i < 5) refs.current[i + 1]?.focus()
    if (char && i === 5) {
      const token = next.join('')
      if (token.length === 6) onComplete?.(token)
    }
  }

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus()
    }
  }

  const handlePaste = (e) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pasted.length === 6) {
      e.preventDefault()
      setDigits(pasted.split(''))
      refs.current[5]?.focus()
      onComplete?.(pasted)
    }
  }

  const handleResend = async () => {
    if (!email || resendSending || resendCount >= MAX_RESENDS) return
    setResendSending(true)
    setResendError('')
    const { error: resendErr } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    })
    if (resendErr) {
      setResendError('Couldn\'t resend — try again')
      setResendSending(false)
      return
    }
    setResendCount((c) => c + 1)
    setDigits(Array(6).fill(''))
    refs.current[0]?.focus()
    setCountdown(60)
    setResendSending(false)
  }

  const resendExhausted = resendCount >= MAX_RESENDS

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-xs text-gray-400">Enter the 6-digit code</p>
      <div className="flex gap-3" onPaste={handlePaste}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => (refs.current[i] = el)}
            value={d}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            inputMode="numeric"
            maxLength={1}
            disabled={loading}
            className="w-12 h-14 text-center text-2xl font-semibold text-gray-900 border-b-2 border-gray-300 focus:border-[#3b6d11] outline-none transition-colors bg-transparent disabled:opacity-40 caret-transparent"
          />
        ))}
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {resendError && <p className="text-sm text-red-500">{resendError}</p>}
      {resendExhausted ? (
        <p className="text-xs text-gray-400 text-center">
          Too many attempts — go back and request a new code
        </p>
      ) : (
        <button
          onClick={handleResend}
          disabled={countdown > 0 || resendSending}
          className="text-xs text-gray-400 disabled:opacity-50 transition-opacity"
        >
          {resendSending ? 'Sending…' : countdown > 0 ? `Resend code in ${countdown}s` : 'Resend code'}
        </button>
      )}
    </div>
  )
}

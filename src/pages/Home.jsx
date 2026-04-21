import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const TYPE_ABBR = {
  easy: 'E',
  tempo: 'T',
  long: 'L',
  rest: 'R',
  strength: 'S',
  intervals: 'I',
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function toLocalDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function typeAbbr(type) {
  return TYPE_ABBR[type?.toLowerCase()] ?? type?.charAt(0)?.toUpperCase() ?? '·'
}

export default function Home() {
  const [profile, setProfile] = useState(null)
  const [weekSessions, setWeekSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [marking, setMarking] = useState(false)
  const navigate = useNavigate()

  const todayStr = useMemo(() => toLocalDateStr(new Date()), [])

  useEffect(() => {
    async function fetchData() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { navigate('/onboarding'); return }

      const todayDate = new Date()
      const endDate = new Date(todayDate)
      endDate.setDate(todayDate.getDate() + 7)

      const [{ data: profileData }, { data: sessions }] = await Promise.all([
        supabase.from('users').select('*').eq('id', user.id).single(),
        supabase
          .from('sessions')
          .select('*')
          .eq('user_id', user.id)
          .gte('session_date', toLocalDateStr(todayDate))
          .lte('session_date', toLocalDateStr(endDate))
          .order('session_date', { ascending: true }),
      ])

      if (profileData) setProfile(profileData)
      setWeekSessions(sessions ?? [])
      setLoading(false)
    }

    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const todaySession = weekSessions.find((s) => s.session_date === todayStr) ?? null

  const markDone = async () => {
    if (!todaySession || marking) return
    setMarking(true)
    await supabase.from('sessions').update({ status: 'done' }).eq('id', todaySession.id)
    navigate(`/checkin/${todaySession.id}`)
  }

  const formattedDate = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="min-h-screen bg-white px-4 py-8 flex flex-col gap-6 max-w-md mx-auto">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">
          {getGreeting()}{profile?.name ? `, ${profile.name.charAt(0).toUpperCase() + profile.name.slice(1)}` : ''}
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">{formattedDate}</p>
      </div>

      {/* Today's session hero card */}
      <TodayCard
        loading={loading}
        weekSessions={weekSessions}
        todaySession={todaySession}
        marking={marking}
        onMarkDone={markDone}
        onStartRun={() => navigate(`/run/${todaySession?.id}`)}
      />

      {/* Plan strip */}
      {!loading && weekSessions.length > 0 && (
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Your plan</p>
          <div className="flex gap-1.5">
            {weekSessions.map((session, i) => {
              const isToday = session.session_date === todayStr
              const isDone = session.status === 'done'
              const dayLabel = new Date(session.session_date + 'T00:00:00')
                .toLocaleDateString('en-IN', { weekday: 'short' })

              return (
                <div
                  key={i}
                  className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-xs font-medium ${
                    isToday
                      ? 'bg-[#3b6d11] text-white'
                      : isDone
                      ? 'bg-[#3b6d11]/10 text-[#3b6d11]'
                      : 'bg-gray-50 text-gray-400'
                  }`}
                >
                  <span>{dayLabel}</span>
                  <span className="opacity-75">
                    {isDone ? '✓' : typeAbbr(session.session_type)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function TodayCard({ loading, weekSessions, todaySession, marking, onMarkDone, onStartRun }) {
  if (loading) {
    return <div className="rounded-2xl bg-gray-50 h-36 animate-pulse" />
  }

  if (weekSessions.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 p-5 text-center">
        <p className="text-sm text-gray-400">
          Your plan is being built — check back in a moment
        </p>
      </div>
    )
  }

  if (!todaySession) {
    return (
      <div className="rounded-2xl bg-gray-50 p-5">
        <p className="font-medium text-gray-700">Rest day</p>
        <p className="text-sm text-gray-400 mt-1">Recovery is part of the plan.</p>
      </div>
    )
  }

  if (todaySession.status === 'done') {
    return (
      <div className="rounded-2xl bg-[#3b6d11]/10 p-5 flex items-center gap-3">
        <span className="text-[#3b6d11] text-2xl leading-none">✓</span>
        <div>
          <p className="font-medium text-[#3b6d11]">{todaySession.title}</p>
          <p className="text-sm text-[#3b6d11]/60 mt-0.5">Session complete</p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-gray-200 p-5 flex flex-col gap-4">
      <div>
        <p className="font-semibold text-gray-900">{todaySession.title}</p>
        {todaySession.coach_message && (
          <p className="text-sm text-gray-400 mt-1 leading-relaxed">
            {todaySession.coach_message}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={onStartRun}
          className="flex-1 border border-[#3b6d11] text-[#3b6d11] rounded-xl py-2.5 text-sm font-medium"
        >
          Start run
        </button>
        <button
          onClick={onMarkDone}
          disabled={marking}
          className="flex-1 bg-[#3b6d11] text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-60"
        >
          {marking ? 'Saving…' : 'Mark done'}
        </button>
      </div>
    </div>
  )
}

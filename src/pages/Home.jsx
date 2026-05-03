import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import InstallPrompt from '../components/InstallPrompt'
import { requestNotificationPermission, subscribeToPush } from '../lib/notifications'

const TYPE_ABBR = {
  easy: 'E',
  tempo: 'T',
  long: 'L',
  rest: 'R',
  strength: 'S',
  intervals: 'I',
}

const TYPE_LABEL = {
  easy: 'Easy',
  tempo: 'Tempo',
  long: 'Long run',
  rest: 'Rest',
  strength: 'Strength',
  intervals: 'Intervals',
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
  const [planPending, setPlanPending] = useState(false)
  const [marking, setMarking] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(null)
  const [adjustmentBanner, setAdjustmentBanner] = useState(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [planUpdating, setPlanUpdating] = useState(false)
  const [hasRuns, setHasRuns] = useState(false)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const todayStr = useMemo(() => toLocalDateStr(new Date()), [])

  useEffect(() => {
    async function fetchData() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { navigate('/onboarding'); return }

      const todayDate = new Date()
      const endDate = new Date(todayDate)
      endDate.setDate(todayDate.getDate() + 7)

      const [{ data: profileData }, { data: sessions }, { count: runsCount }] = await Promise.all([
        supabase.from('users').select('*').eq('id', user.id).single(),
        supabase
          .from('sessions')
          .select('*')
          .eq('user_id', user.id)
          .gte('session_date', toLocalDateStr(todayDate))
          .lte('session_date', toLocalDateStr(endDate))
          .order('session_date', { ascending: true }),
        supabase.from('runs').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      ])

      if (profileData) setProfile(profileData)
      if (runsCount && runsCount > 0) {
        setHasRuns(true)
        requestNotificationPermission().then((granted) => {
          if (granted) subscribeToPush().catch(() => {})
        }).catch(() => {})
      }
      const s = sessions ?? []
      setWeekSessions(s)
      if (s.length === 0) {
        setPlanPending(true)
      } else {
        setSelectedIdx(0)

        const adjusted = s.find((x) => x.adjustment_reason && x.adjustment_reason.trim() !== '')
        if (adjusted) {
          const key = `banner_dismissed_${adjusted.id}`
          if (!localStorage.getItem(key)) {
            setAdjustmentBanner({ reason: adjusted.adjustment_reason, key })
          }
        }
      }

      if (searchParams.get('plan_updating') === 'true') {
        setPlanUpdating(true)
        navigate('/home', { replace: true })
      }

      setLoading(false)
    }

    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (weekSessions.length > 0) return
    const interval = setInterval(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const todayDate = new Date()
      const endDate = new Date(todayDate)
      endDate.setDate(todayDate.getDate() + 6)
      const { data } = await supabase
        .from('sessions')
        .select('*')
        .eq('user_id', user.id)
        .gte('session_date', toLocalDateStr(todayDate))
        .lte('session_date', toLocalDateStr(endDate))
        .order('session_date', { ascending: true })
      if (data && data.length > 0) {
        setWeekSessions(data)
        setPlanPending(false)
        setSelectedIdx(0)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [weekSessions.length])

  useEffect(() => {
    if (!planUpdating) return
    const cutoff = new Date(Date.now() - 60 * 1000).toISOString()
    const interval = setInterval(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const todayDate = new Date()
      const endDate = new Date(todayDate)
      endDate.setDate(todayDate.getDate() + 7)
      const { data } = await supabase
        .from('sessions')
        .select('*')
        .eq('user_id', user.id)
        .gte('session_date', toLocalDateStr(todayDate))
        .lte('session_date', toLocalDateStr(endDate))
        .order('session_date', { ascending: true })
      if (!data) return
      const updated = data.find(
        (s) => (s.adjustment_reason && s.adjustment_reason.trim() !== '') || s.updated_at > cutoff
      )
      if (updated) {
        setWeekSessions(data)
        setSelectedIdx(0)
        setPlanUpdating(false)
        const adjusted = data.find((s) => s.adjustment_reason && s.adjustment_reason.trim() !== '')
        if (adjusted) {
          const key = `banner_dismissed_${adjusted.id}`
          if (!localStorage.getItem(key)) {
            setAdjustmentBanner({ reason: adjusted.adjustment_reason, key })
            setBannerDismissed(false)
          }
        }
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [planUpdating])

  // Deduplicate by session_date (keep most recently created), then filter today onwards, limit 7
  const stripSessions = useMemo(() => {
    const deduped = weekSessions.reduce((acc, session) => {
      const existing = acc.find((s) => s.session_date === session.session_date)
      if (!existing) {
        acc.push(session)
      } else if (session.created_at > existing.created_at) {
        return acc.map((s) => (s.session_date === session.session_date ? session : s))
      }
      return acc
    }, [])
    return deduped
      .filter((s) => s.session_date >= todayStr)
      .sort((a, b) => a.session_date.localeCompare(b.session_date))
      .slice(0, 7)
  }, [weekSessions, todayStr])

  const todaySession = stripSessions.find((s) => s.session_date === todayStr) ?? null

  const markDone = async () => {
    if (!todaySession || marking) return
    setMarking(true)
    await supabase.from('sessions').update({ status: 'done' }).eq('id', todaySession.id)
    navigate(`/checkin?session_id=${todaySession.id}`)
  }

  const markRestDone = async () => {
    if (!todaySession || marking) return
    setMarking(true)
    await supabase.from('sessions').update({ status: 'done' }).eq('id', todaySession.id)
    setWeekSessions((prev) =>
      prev.map((s) => (s.id === todaySession.id ? { ...s, status: 'done' } : s))
    )
    setMarking(false)
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
        weekSessions={stripSessions}
        todaySession={todaySession}
        marking={marking}
        onMarkDone={markDone}
        onMarkRestDone={markRestDone}
        onStartRun={() => navigate(`/run/${todaySession?.id}`)}
      />

      {/* Adjustment banner */}
      {adjustmentBanner && !bannerDismissed && (
        <div className="flex items-start gap-3 bg-gray-900 border-l-2 border-[#3b6d11] rounded-xl px-4 py-3">
          <p className="flex-1 text-xs text-gray-300 leading-relaxed">
            Coach Pace adjusted your plan — {adjustmentBanner.reason}
          </p>
          <button
            onClick={() => {
              localStorage.setItem(adjustmentBanner.key, '1')
              setBannerDismissed(true)
            }}
            className="text-gray-500 hover:text-gray-300 text-sm leading-none mt-0.5 shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      {/* Plan updating banner */}
      {planUpdating && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50 animate-pulse">
          <div className="w-2 h-2 rounded-full bg-[#3b6d11]/40 shrink-0" />
          <p className="text-xs text-gray-400">Coach Pace is updating your plan…</p>
        </div>
      )}

      {/* Install prompt — shown after first completed session */}
      {hasRuns && <InstallPrompt />}

      {/* Plan strip skeleton */}
      {(loading || planPending) && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Your plan</p>
          <div className="flex gap-1.5">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-xs font-medium bg-gray-800 animate-pulse h-16" />
            ))}
          </div>
          <div className="rounded-2xl bg-gray-50 p-4 flex flex-col gap-2.5">
            <div className="h-4 bg-gray-800 rounded-full w-full animate-pulse" />
            <div className="h-4 bg-gray-800 rounded-full w-3/4 animate-pulse" />
            <div className="h-4 bg-gray-800 rounded-full w-1/2 animate-pulse" />
          </div>
        </div>
      )}

      {/* Plan strip */}
      {!loading && stripSessions.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Your plan</p>
          <div className="flex gap-1.5">
            {stripSessions.map((session, i) => {
              const isToday = session.session_date === todayStr
              const isDone = session.status === 'done'
              const isSelected = selectedIdx === i
              const dayLabel = new Date(session.session_date + 'T00:00:00')
                .toLocaleDateString('en-IN', { weekday: 'short' })

              return (
                <button
                  key={i}
                  onClick={() => setSelectedIdx(isSelected ? null : i)}
                  className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-xs font-medium transition-colors ${
                    isSelected
                      ? 'bg-[#3b6d11] text-white'
                      : isToday
                      ? 'bg-[#3b6d11]/20 text-[#3b6d11]'
                      : isDone
                      ? 'bg-[#3b6d11]/10 text-[#3b6d11]'
                      : 'bg-gray-50 text-gray-400'
                  }`}
                >
                  <span>{dayLabel}</span>
                  <span className="opacity-75">
                    {isDone ? '✓' : typeAbbr(session.session_type)}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Expanded session detail */}
          {selectedIdx !== null && stripSessions[selectedIdx] && (
            <SessionDetail session={stripSessions[selectedIdx]} />
          )}
        </div>
      )}
    </div>
  )
}

function SessionDetail({ session }) {
  const label = TYPE_LABEL[session.session_type?.toLowerCase()] ?? session.session_type
  const meta = [
    session.distance_km != null && `${session.distance_km} km`,
    session.duration_min != null && `${session.duration_min} min`,
  ].filter(Boolean).join(' · ')

  return (
    <div className="rounded-2xl bg-gray-50 p-4 flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium bg-white border border-gray-200 text-gray-500 rounded-full px-2.5 py-0.5">
          {label}
        </span>
        {meta && <span className="text-xs text-gray-400">{meta}</span>}
      </div>
      {session.title && (
        <p className="font-semibold text-gray-900 text-sm">{session.title}</p>
      )}
      {session.description && (
        <p className="text-sm text-gray-600 leading-relaxed">{session.description}</p>
      )}
      {session.coach_message && (
        <p className="text-xs text-[#3b6d11] italic leading-relaxed">{session.coach_message}</p>
      )}
    </div>
  )
}

const LOADING_MESSAGES = [
  "Mapping your plan...",
  "Building your running muscles...",
  "Lacing up your shoes...",
  "Plotting the perfect route...",
  "Warming up the engine...",
  "Getting your weeks in order...",
  "Almost ready to run...",
]

function TodayCard({ loading, weekSessions, todaySession, marking, onMarkDone, onMarkRestDone, onStartRun }) {
  const [msgIdx, setMsgIdx] = useState(0)
  const showingPlaceholder = loading || weekSessions.length === 0

  useEffect(() => {
    if (!showingPlaceholder) return
    const interval = setInterval(() => setMsgIdx((i) => (i + 1) % LOADING_MESSAGES.length), 2500)
    return () => clearInterval(interval)
  }, [showingPlaceholder])

  if (loading || weekSessions.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-2.5">
          <p className="text-xs text-[#3b6d11] italic leading-relaxed">
            {LOADING_MESSAGES[msgIdx]}
          </p>
          <div className="h-3 bg-gray-800 rounded-full w-[90%] animate-pulse" />
        </div>
        <div className="flex gap-2">
          <div className="flex-1 h-10 bg-gray-800 rounded-xl animate-pulse" />
          <div className="flex-1 h-10 bg-gray-800 rounded-xl animate-pulse" />
        </div>
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

  if (todaySession.session_type === 'rest' && todaySession.status !== 'done') {
    return (
      <div className="rounded-2xl bg-gray-50 p-5 flex flex-col gap-3">
        {todaySession.coach_message && (
          <p className="text-sm text-gray-600 leading-relaxed">{todaySession.coach_message}</p>
        )}
        <button
          onClick={onMarkRestDone}
          disabled={marking}
          className="self-start text-xs text-gray-400 underline underline-offset-2 disabled:opacity-40"
        >
          {marking ? 'Saving…' : 'Mark as rest day taken'}
        </button>
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

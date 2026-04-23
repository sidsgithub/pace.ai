import { useState, useEffect, useRef } from 'react'

const DISMISSED_KEY = 'install_prompt_dismissed'

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
}

export default function InstallPrompt() {
  const [show, setShow] = useState(false)
  const [ios, setIos] = useState(false)
  const deferredPrompt = useRef(null)

  useEffect(() => {
    if (localStorage.getItem(DISMISSED_KEY)) return
    if (window.matchMedia('(display-mode: standalone)').matches) return
    if (navigator.standalone) return

    if (isIOS()) {
      setIos(true)
      setShow(true)
      return
    }

    const handler = (e) => {
      e.preventDefault()
      deferredPrompt.current = e
      setShow(true)
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1')
    setShow(false)
  }

  const install = async () => {
    if (ios) { dismiss(); return }
    if (!deferredPrompt.current) return
    deferredPrompt.current.prompt()
    await deferredPrompt.current.userChoice
    deferredPrompt.current = null
    dismiss()
  }

  if (!show) return null

  if (ios) {
    return (
      <div className="rounded-2xl bg-gray-50 p-4 flex flex-col gap-2">
        <p className="text-sm text-gray-600 leading-relaxed">
          Tap the <span className="font-medium text-gray-800">share button</span> below, then{' '}
          <span className="font-medium text-gray-800">'Add to Home Screen'</span> for the full experience.
        </p>
        <div className="flex items-center justify-between">
          <span className="text-[#3b6d11] text-base">↓</span>
          <button
            onClick={dismiss}
            className="text-xs text-gray-400 underline underline-offset-2"
          >
            Maybe later
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-gray-50 p-4 flex flex-col gap-3">
      <p className="text-sm text-gray-600 leading-relaxed">
        Add Coach Pace to your home screen for the full experience — works offline and feels native.
      </p>
      <div className="flex gap-2">
        <button
          onClick={install}
          className="flex-1 bg-[#3b6d11] text-white rounded-xl py-2 text-sm font-medium"
        >
          Add to home screen
        </button>
        <button
          onClick={dismiss}
          className="flex-1 border border-gray-200 text-gray-500 rounded-xl py-2 text-sm"
        >
          Maybe later
        </button>
      </div>
    </div>
  )
}

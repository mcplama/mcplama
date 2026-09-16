/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'

export default function OAuthCallback() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus]   = useState('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    // Opened as a popup from Portal's "Authorize with..." button — the opener
    // is polling token-status and will refresh itself, so this window's only
    // job is to show a brief confirmation and close. Falls back to navigating
    // this same window to /portal when there's no opener (direct link, popup
    // blocked and this loaded in the original tab, etc).
    const isPopup = !!window.opener && window.opener !== window

    const error = params.get('oauth_error'), success = params.get('oauth_success')
    if (error) {
      setStatus('error'); setMessage(decodeURIComponent(error).replace(/\+/g,' '))
      setTimeout(() => { isPopup ? window.close() : navigate('/portal') }, isPopup ? 3000 : 4000)
    } else if (success) {
      setStatus('success'); setMessage(isPopup ? 'Authentication successful! You can close this window.' : 'Authentication successful! Redirecting...')
      setTimeout(() => { isPopup ? window.close() : navigate('/portal') }, isPopup ? 1200 : 2000)
    } else if (isPopup) {
      window.close()
    } else { navigate('/portal') }
  }, [params, navigate])

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="bg-surface border border-border rounded-2xl p-10 max-w-[400px] w-full text-center">
        {status === 'loading' && <>
          <Loader2 size={40} className="text-accent spin mx-auto mb-4" />
          <p className="text-base font-semibold text-t1 mb-2">Completing authentication...</p>
          <p className="text-sm text-t2">Please wait while we set up your connection.</p>
        </>}
        {status === 'success' && <>
          <CheckCircle size={40} className="text-ok mx-auto mb-4" />
          <p className="text-base font-semibold text-t1 mb-2">Connected!</p>
          <p className="text-sm text-t2">{message}</p>
        </>}
        {status === 'error' && <>
          <XCircle size={40} className="text-danger mx-auto mb-4" />
          <p className="text-base font-semibold text-t1 mb-2">Authentication failed</p>
          <p className="text-sm text-t2 mb-4">{message}</p>
          <button onClick={() => navigate('/portal')} className="px-5 py-2 rounded-xl bg-accent text-white text-sm font-semibold">Back to portal</button>
        </>}
      </div>
    </div>
  )
}

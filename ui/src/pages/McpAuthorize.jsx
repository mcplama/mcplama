/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Zap, Eye, EyeOff, AlertCircle, CheckCircle, Loader2, ExternalLink } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl bg-bg border border-border text-t1 text-sm outline-none focus:border-accent transition-colors'
const labelCls = 'block text-[11px] font-semibold text-t3 uppercase tracking-widest mb-1.5'

function FullPageSpinner({ message, sub }) {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="text-center">
        <Loader2 size={40} className="text-accent spin mx-auto mb-4" />
        <p className="text-base font-semibold text-t1 mb-2">{message}</p>
        {sub && <p className="text-sm text-t2">{sub}</p>}
      </div>
    </div>
  )
}

export default function McpAuthorize() {
  const [params] = useSearchParams()
  const { user, loading: authLoading, login } = useAuth()
  const pending = params.get('pending')
  const calledRef = useRef(false)

  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [upstreamInfo, setUpstreamInfo] = useState(null)

  const completeAuth = async () => {
    if (calledRef.current) return
    calledRef.current = true
    setStatus('completing')
    try {
      const backendUrl = import.meta.env.VITE_API_URL || ''

      const resp = await fetch(`${backendUrl}/authorize/complete?pending=${pending}`, { credentials: 'include' })
      const data = await resp.json()

      if (!resp.ok) { setMessage(data.detail || 'Authorization failed.'); setStatus('error'); return }

      if (data.status === 'upstream_oauth_required') {
        let rawUrl = (data.upstream_oauth_url || '').replace(/\/oauth\/(\d+)\/authorize(\?|$)/, '/oauth/$1/mcp-authorize$2')
        const upstreamUrl = new URL(rawUrl)
        setUpstreamInfo({ url: upstreamUrl.toString(), message: data.message })
        setStatus('upstream_oauth')
        setTimeout(() => { window.location.href = upstreamUrl.toString() }, 1200)
        return
      }

      if (data.redirect_url) { setStatus('done'); window.location.href = data.redirect_url; return }
      setMessage('Authorization complete. Return to your MCP client.'); setStatus('done')
    } catch { setMessage('Network error. Please reconnect your MCP client.'); setStatus('error') }
  }

  useEffect(() => {
    if (!authLoading && user && pending && !calledRef.current) completeAuth()
  }, [authLoading, user, pending])

  const submit = async e => {
    e.preventDefault(); setLoading(true); setMessage('')
    try { await login(form.email, form.password) }
    catch (e) { setMessage(e.response?.data?.detail || 'Invalid email or password'); setLoading(false) }
  }

  if (!pending) return <div className="min-h-screen bg-bg flex items-center justify-center"><p className="text-t3">Invalid authorization request.</p></div>
  if (authLoading) return <FullPageSpinner message="Loading…" />
  if (status === 'completing') return <FullPageSpinner message="Completing authorization…" sub="Just a moment." />

  if (status === 'upstream_oauth') return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="text-center max-w-[380px] p-6">
        <div className="w-14 h-14 rounded-2xl bg-warn/10 border border-warn/25 flex items-center justify-center mx-auto mb-5 text-[26px]">🔐</div>
        <p className="text-lg font-bold text-t1 mb-2">One more step</p>
        <p className="text-sm text-t2 mb-6 leading-relaxed">{upstreamInfo?.message || 'This server requires you to authorize with an external service first.'} You'll be redirected automatically.</p>
        <div className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-warn/10 border border-warn/25">
          <Loader2 size={13} className="text-warn spin shrink-0" />
          <span className="text-warn text-xs font-semibold">Redirecting to provider…</span>
        </div>
        {upstreamInfo?.url && <a href={upstreamInfo.url} className="inline-flex items-center gap-1 mt-4 text-t3 text-[11px]"><ExternalLink size={10} /> Click here if not redirected</a>}
      </div>
    </div>
  )

  if (status === 'done') return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="text-center">
        <CheckCircle size={40} className="text-ok mx-auto mb-4" />
        <p className="text-base font-semibold text-t1 mb-2">Authorized!</p>
        <p className="text-sm text-t2">{message || 'Redirecting back to your MCP client…'}</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-[400px]">
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center shrink-0"><Zap size={18} color="white" strokeWidth={2.5} /></div>
          <div><p className="text-base font-bold text-t1">Mcplama</p><p className="text-[11px] text-t3">MCP Gateway</p></div>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-8">
          <h2 className="text-xl font-bold text-t1 mb-2">Authorize MCP client</h2>
          <p className="text-sm text-t2 leading-relaxed mb-6">An MCP client wants to connect to your gateway. Sign in to authorize.</p>

          {message && (
            <div className={`flex items-center gap-2 px-3.5 py-2.5 mb-4 rounded-xl text-sm border ${status === 'error' ? 'bg-danger/10 border-danger/30 text-danger' : 'bg-ok/10 border-ok/30 text-ok'}`}>
              {status === 'error' ? <AlertCircle size={14} /> : <CheckCircle size={14} />} {message}
            </div>
          )}

          {user ? (
            <div>
              <p className="text-sm text-t2 mb-4">Signed in as <strong className="text-t1">{user.email}</strong></p>
              <button onClick={() => { calledRef.current = false; completeAuth() }}
                className="w-full py-2.5 bg-accent text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity">Authorize</button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className={labelCls}>Email</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="admin@company.com" required autoFocus className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Password</label>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" required className={`${inputCls} pr-10`} />
                  <button type="button" onClick={() => setShowPassword(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-t3 hover:text-t2 transition-colors">
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading}
                className="w-full py-2.5 bg-accent text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60">
                {loading ? 'Signing in…' : 'Sign in & authorize'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

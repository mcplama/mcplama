/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { useAuth } from '../hooks/useAuth'

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl bg-bg border border-border text-t1 text-sm outline-none focus:border-accent transition-colors'
const labelCls = 'block text-[11px] font-semibold text-t3 uppercase tracking-widest mb-1.5'

export default function AcceptInvite() {
  const { token } = useParams()
  const navigate  = useNavigate()
  const { setSession } = useAuth()
  const [invite, setInvite]       = useState(null)
  const [form, setForm]           = useState({ name:'', password:'', confirm:'' })
  const [loading, setLoading]     = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState('')

  useEffect(() => {
    api.get(`/auth/invite/${token}`)
      .then(r => setInvite(r.data))
      .catch(() => setError('Invalid or expired invite link'))
      .finally(() => setLoading(false))
  }, [token])

  const submit = async () => {
    if (!form.name.trim()) return setError('Name is required')
    if (form.password.length < 8) return setError('Password must be at least 8 characters')
    if (form.password !== form.confirm) return setError('Passwords do not match')
    setSubmitting(true)
    try {
      const { data } = await api.post(`/auth/invite/${token}/accept`, { token, name:form.name, password:form.password })
      setSession(data.user)
      navigate(data.user.role === 'member' ? '/portal' : '/')
    } catch(e) { setError(e.response?.data?.detail || 'Failed to create account') }
    finally { setSubmitting(false) }
  }

  const set = k => e => setForm(f => ({ ...f, [k]:e.target.value }))

  if (loading) return <div className="min-h-screen bg-bg flex items-center justify-center"><p className="text-t3">Loading...</p></div>

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-[440px]">
        <div className="text-center mb-8">
         <img src="/icons/mcplama-icon-128.png" alt="McpLama" className="w-[48px] h-[48px] mx-auto mb-3" />
          <h1 className="text-[24px] font-bold text-t1">Join Mcplama</h1>
          {invite && <p className="text-sm text-t3 mt-1.5">You've been invited as <strong className="text-accent">{invite.role}</strong></p>}
        </div>

        <div className="bg-surface border border-border rounded-2xl p-8">
          {error && <div className="bg-danger/15 border border-danger/30 rounded-xl px-3.5 py-2.5 mb-5"><p className="text-danger text-sm">{error}</p></div>}

          {invite ? (
            <div className="space-y-4">
              <div><label className={labelCls}>Email</label><input className={`${inputCls} opacity-60`} value={invite.email} disabled /></div>
              <div><label className={labelCls}>Your name</label><input className={inputCls} value={form.name} onChange={set('name')} placeholder="John Doe" autoFocus /></div>
              <div><label className={labelCls}>Password</label><input className={inputCls} type="password" value={form.password} onChange={set('password')} placeholder="Min 8 characters" /></div>
              <div>
                <label className={labelCls}>Confirm password</label>
                <input className={inputCls} type="password" value={form.confirm} onChange={set('confirm')} onKeyDown={e => e.key==='Enter'&&submit()} placeholder="Repeat password" />
              </div>
              <button onClick={submit} disabled={submitting}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-accent hover:opacity-90 transition-opacity disabled:opacity-60 mt-1 shadow-glow">
                {submitting ? 'Creating account...' : 'Create account & join'}
              </button>
            </div>
          ) : (
            <p className="text-danger text-center">This invite link is invalid or has expired.</p>
          )}
        </div>
      </div>
    </div>
  )
}

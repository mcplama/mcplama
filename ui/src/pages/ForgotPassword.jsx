/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Mail, Check } from 'lucide-react'
import api from '../lib/api'

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl bg-bg border border-border text-t1 text-sm outline-none focus:border-accent transition-colors'
const labelCls = 'block text-[11px] font-semibold text-t3 uppercase tracking-widest mb-1.5'

export default function ForgotPassword() {
  const [email, setEmail]     = useState('')
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async e => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch (e) {
      setError(e.response?.data?.detail || 'Something went wrong. Please try again.')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-[400px]">
        <div className="text-center mb-8">
          <img src="/icons/mcplama-icon-128.png" alt="McpLama" className="w-[48px] h-[48px] mx-auto mb-3" />
          <h1 className="text-[24px] font-bold text-t1">Reset your password</h1>
          <p className="text-sm text-t3 mt-1.5">We'll email you a link if the address matches an account.</p>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-8">
          {sent ? (
            <div className="text-center py-2">
              <div className="w-14 h-14 rounded-full mx-auto mb-5 bg-ok/15 border-2 border-ok/40 flex items-center justify-center">
                <Check size={24} className="text-ok" strokeWidth={2.5} />
              </div>
              <p className="text-sm text-t2 leading-relaxed mb-1">If <strong className="text-t1">{email}</strong> has an account, a reset link is on its way.</p>
              <p className="text-xs text-t3 leading-relaxed">The link expires in 1 hour. Check spam if it doesn't show up soon.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && <div className="bg-danger/15 border border-danger/30 rounded-xl px-3.5 py-2.5"><p className="text-danger text-sm">{error}</p></div>}
              <div>
                <label className={labelCls}>Email address</label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-t3" />
                  <input className={`${inputCls} pl-9`} type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="admin@company.com" autoFocus required />
                </div>
              </div>
              <button type="submit" disabled={loading}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-accent hover:opacity-90 transition-opacity disabled:opacity-60 mt-1 shadow-glow">
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}
        </div>

        <Link to="/login" className="flex items-center justify-center gap-1.5 text-xs text-t3 hover:text-t2 mt-6 transition-colors">
          <ArrowLeft size={13} /> Back to sign in
        </Link>
      </div>
    </div>
  )
}

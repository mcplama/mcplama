/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Eye, EyeOff, ArrowLeft } from 'lucide-react'
import api from '../lib/api'

const labelCls = 'block text-[11px] font-semibold text-t3 uppercase tracking-widest mb-1.5'

function PasswordField({ label, value, onChange, placeholder, autoFocus }) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value} onChange={onChange} placeholder={placeholder}
          autoFocus={autoFocus} required
          className="w-full pr-10 px-3.5 py-2.5 rounded-xl bg-bg border border-border text-t1 text-sm outline-none focus:border-accent transition-colors"
        />
        <button type="button" onClick={() => setShow(s => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-t3 hover:text-t2 transition-colors">
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  )
}

export default function ResetPassword() {
  const { token } = useParams()
  const navigate   = useNavigate()
  const [form, setForm]       = useState({ password: '', confirm: '' })
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async e => {
    e.preventDefault()
    if (form.password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (form.password !== form.confirm) { setError('Passwords do not match'); return }
    setError(''); setLoading(true)
    try {
      await api.post('/auth/reset-password', { token, password: form.password })
      navigate('/login', { state: { resetSuccess: true } })
    } catch (e) {
      setError(e.response?.data?.detail || 'This reset link is invalid or has expired.')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-[400px]">
        <div className="text-center mb-8">
          <img src="/icons/mcplama-icon-128.png" alt="McpLama" className="w-[48px] h-[48px] mx-auto mb-3" />
          <h1 className="text-[24px] font-bold text-t1">Choose a new password</h1>
          <p className="text-sm text-t3 mt-1.5">This link can only be used once.</p>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-8">
          <form onSubmit={submit} className="space-y-4">
            {error && <div className="bg-danger/15 border border-danger/30 rounded-xl px-3.5 py-2.5"><p className="text-danger text-sm">{error}</p></div>}
            <PasswordField label="New password" value={form.password} onChange={set('password')} placeholder="Min. 8 characters" autoFocus />
            <PasswordField label="Confirm password" value={form.confirm} onChange={set('confirm')} placeholder="Repeat password" />
            <button type="submit" disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-accent hover:opacity-90 transition-opacity disabled:opacity-60 mt-1 shadow-glow">
              {loading ? 'Resetting…' : 'Reset password'}
            </button>
          </form>
        </div>

        <Link to="/login" className="flex items-center justify-center gap-1.5 text-xs text-t3 hover:text-t2 mt-6 transition-colors">
          <ArrowLeft size={13} /> Back to sign in
        </Link>
      </div>
    </div>
  )
}

/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Zap, ArrowRight, AlertCircle, Shield, Globe, Activity, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

function Field({ label, type = 'text', value, onChange, placeholder, autoFocus }) {
  const [show, setShow] = useState(false)
  const isPassword = type === 'password'
  return (
    <div>
      <label className="block text-[11px] font-semibold text-t3 uppercase tracking-widest mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={isPassword && show ? 'text' : type}
          value={value} onChange={onChange} placeholder={placeholder}
          autoFocus={autoFocus} required
          className={`w-full ${isPassword ? 'pr-10' : ''} px-3.5 py-2.5 bg-bg border border-border2 rounded-xl text-t1 text-sm outline-none focus:border-accent transition-colors`}
        />
        {isPassword && (
          <button type="button" onClick={() => setShow(s => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-t3 hover:text-t2 transition-colors">
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
      </div>
    </div>
  )
}

const FEATURES = [
  { icon: Globe,    title: 'Universal proxy',  desc: 'One endpoint for all your MCP servers.' },
  { icon: Shield,   title: 'Access control',   desc: 'Policies and per-user authentication.' },
  { icon: Activity, title: 'Full audit log',   desc: 'Every tool call tracked and searchable.' },
]

export default function Login() {
  const [form, setForm]     = useState({ email: '', password: '' })
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async e => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const userData = await login(form.email, form.password)
      const role = userData?.role || userData?.user?.role
      navigate(role === 'member' ? '/portal' : '/')
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid email or password')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-bg flex">
      {/* Left panel */}
      <div className="w-[420px] shrink-0 bg-card border-r border-border px-11 py-12 flex flex-col justify-between">
        <div>
          {/* Logo */}
          <div className="flex items-center gap-2.5 mb-14">
            <img src="/icons/mcplama-icon-128.png" alt="McpLama" className="w-[48px] h-[48px]" />
            <div>
              <p className="text-base font-bold text-t1 tracking-tight">Mcplama</p>
              <p className="text-[11px] text-t3">MCP Gateway</p>
            </div>
          </div>

          <h1 className="text-[26px] font-bold text-t1 leading-tight tracking-tight mb-3">
            The self-hosted<br />MCP gateway
          </h1>
          <p className="text-sm text-t3 leading-relaxed mb-11">
            Self-hosted proxy for all your MCP servers. Secure, auditable, and works with Claude, Cursor, and any MCP client.
          </p>

          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex gap-3.5 mb-6">
              <div className="w-[34px] h-[34px] rounded-[9px] shrink-0 bg-accent/10 border border-accent/25 flex items-center justify-center">
                <Icon size={15} className="text-accent" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-t2 mb-0.5">{title}</p>
                <p className="text-xs text-t3">{desc}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-t3 font-mono">Mcplama · community edition · ver 1.1</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-10">
        <div className="w-full max-w-[380px]">
          <h2 className="text-[22px] font-bold text-t1 tracking-tight mb-1.5">Welcome back</h2>
          <p className="text-sm text-t3 mb-8">Sign in to your gateway dashboard</p>

          <form onSubmit={submit} className="flex flex-col gap-4.5 space-y-4">
            <Field label="Email" type="email" value={form.email} onChange={set('email')} placeholder="admin@company.com" autoFocus />
            <div>
              <Field label="Password" type="password" value={form.password} onChange={set('password')} placeholder="••••••••" />
              <Link to="/forgot-password" className="block text-right text-xs text-accent hover:underline mt-1.5">Forgot password?</Link>
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3.5 py-2.5 bg-danger/10 border border-danger/30 rounded-xl text-danger text-sm">
                <AlertCircle size={14} className="shrink-0" /> {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="flex items-center justify-center gap-2 py-3 mt-1 rounded-xl text-sm font-semibold text-white bg-accent hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-glow">
              {loading
                ? <><span className="spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full inline-block" /> Signing in…</>
                : <>Sign in <ArrowRight size={15} /></>}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

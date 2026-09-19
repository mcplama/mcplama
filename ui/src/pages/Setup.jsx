/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, ArrowRight, Check, User, Lock, Server, Activity, Eye, EyeOff, Shield, Mail } from 'lucide-react'
import api from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { useSetup } from '../hooks/useSetup'
import { Toggle } from '../components/ui'

const STEPS = [
  { id: 'welcome', label: 'Welcome', icon: Zap },
  { id: 'account', label: 'Account', icon: User },
  { id: 'gateway', label: 'Gateway', icon: Server },
  { id: 'email',   label: 'Email',   icon: Mail },
  { id: 'done',    label: 'Done',    icon: Check },
]

function Field({ label, type = 'text', value, onChange, placeholder, hint, autoFocus }) {
  const [show, setShow] = useState(false)
  const isPassword = type === 'password'
  return (
    <div>
      <label className="block text-[11px] font-semibold text-t3 uppercase tracking-widest mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={isPassword && show ? 'text' : type}
          value={value} onChange={onChange} placeholder={placeholder}
          autoFocus={autoFocus} required={!hint?.includes('optional')}
          className={`w-full ${isPassword ? 'pr-10' : ''} px-3.5 py-2.5 bg-bg border border-border2 rounded-xl text-t1 text-sm outline-none focus:border-accent transition-colors`}
        />
        {isPassword && (
          <button type="button" onClick={() => setShow(s => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-t3 hover:text-t2 transition-colors">
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
      </div>
      {hint && <p className="text-[11px] text-t3 mt-1.5 leading-relaxed">{hint}</p>}
    </div>
  )
}

function StepIndicator({ current }) {
  return (
    <div className="flex items-center gap-0 mb-10">
      {STEPS.map((step, i) => {
        const done = i < current, active = i === current
        const Icon = step.icon
        return (
          <div key={step.id} className={`flex items-center ${i < STEPS.length - 1 ? 'flex-1' : ''}`}>
            <div className="flex flex-col items-center gap-1.5">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-all border-2 ${
                done   ? 'bg-ok border-ok' :
                active ? 'bg-accent border-accent shadow-glow' :
                         'bg-card2 border-border2'
              }`}>
                {done
                  ? <Check size={14} color="#fff" strokeWidth={2.5} />
                  : <Icon size={14} color={active ? '#fff' : undefined} className={active ? '' : 'text-t3'} strokeWidth={active ? 2.2 : 1.8} />}
              </div>
              <span className={`text-[10px] font-semibold uppercase tracking-widest whitespace-nowrap ${
                active ? 'text-t1' : done ? 'text-ok' : 'text-t3'
              }`}>{step.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 mb-5 transition-colors ${done ? 'bg-ok' : 'bg-border2'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function Setup() {
  const [step, setStep]       = useState(0)
  const [form, setForm]       = useState({
    name:'', email:'', password:'', confirm:'', gateway_name:'Mcplama', app_url:'',
    smtp_enabled:false, smtp_host:'', smtp_port:'587', smtp_username:'', smtp_password:'',
    smtp_from_email:'', smtp_from_name:'', smtp_use_tls:true,
  })
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [termsInfo, setTermsInfo] = useState(null)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const { login, user } = useAuth()
  const { markSetupDone } = useSetup()
  const navigate = useNavigate()

  useEffect(() => {
    if (user) { navigate('/'); return }
    api.get('/auth/setup-status')
      .then(r => {
        if (r.data.setup_done) navigate('/login')
        setTermsInfo({ version: r.data.terms_version, url: r.data.terms_url })
      })
      .catch(() => setError("Could not load setup requirements. Refresh the page and try again."))
      .finally(() => setChecking(false))
  }, [])

  if (checking) return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full" />
    </div>
  )

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const createAccount = async () => {
    if (form.password !== form.confirm) { setError('Passwords do not match'); return false }
    if (form.password.length < 8) { setError('Password must be at least 8 characters'); return false }
    if (form.smtp_enabled && !form.smtp_host) { setError('SMTP host is required, or turn email off to skip it'); return false }
    setError(''); setLoading(true)
    try {
      await api.post('/auth/setup', {
        name:form.name, email:form.email, password:form.password,
        gateway_name:form.gateway_name, app_url:form.app_url||null,
        smtp_enabled: form.smtp_enabled,
        smtp_host: form.smtp_host || null,
        smtp_port: form.smtp_port || 587,
        smtp_username: form.smtp_username || null,
        smtp_password: form.smtp_password || null,
        smtp_from_email: form.smtp_from_email || null,
        smtp_from_name: form.smtp_from_name || null,
        smtp_use_tls: form.smtp_use_tls,
        terms_accepted: termsAccepted,
        terms_version: termsInfo?.version,
      })
      return true
    } catch(e) { setError(e.response?.data?.detail || 'Setup failed'); return false }
    finally { setLoading(false) }
  }

  const next = async () => {
    if (step === 1 && (!form.name || !form.email || !form.password)) { setError('All fields are required'); return }
    if (step === 1 && !termsAccepted) { setError('Please accept the Terms of Use to continue'); return }
    if (step === 3) { const ok = await createAccount(); if (!ok) return }
    setError(''); setStep(s => s + 1)
  }

  const finish = async () => {
    setLoading(true)
    try { markSetupDone(); await login(form.email, form.password); navigate('/') }
    catch { navigate('/login') }
    finally { setLoading(false) }
  }

  const WELCOME_ITEMS = [
    { icon: User,     title: 'Create admin account', desc: 'Set up your administrator credentials' },
    { icon: Server,   title: 'Configure gateway',    desc: 'Name your gateway and set the public URL' },
    { icon: Mail,     title: 'Email (optional)',     desc: 'Enable SMTP for invites, alerts, and admin password reset' },
    { icon: Activity, title: 'Ready to connect',     desc: 'Start adding MCP servers from the catalog' },
  ]

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-[560px]">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-12 justify-center">
            <img src="/icons/mcplama-icon-128.png" alt="McpLama" className="w-[48px] h-[48px]" />
          <div>
            <p className="text-base font-bold text-t1 tracking-tight">Mcplama</p>
            <p className="text-[11px] text-t3">Initial setup</p>
          </div>
        </div>

        <StepIndicator current={step} />

        <div className="bg-card border border-border rounded-2xl p-10">
          {/* Step 0 — Welcome */}
          {step === 0 && (
            <div>
              <h2 className="text-[22px] font-bold text-t1 tracking-tight mb-2.5">Welcome to Mcplama</h2>
              <p className="text-sm text-t3 leading-relaxed mb-8">This wizard will guide you through the initial setup. It takes less than a minute.</p>
              <div className="flex flex-col gap-3 mb-8">
                {WELCOME_ITEMS.map(({ icon: Icon, title, desc }) => (
                  <div key={title} className="flex gap-3.5 p-3.5 bg-card2 rounded-xl border border-border">
                    <div className="w-8 h-8 rounded-lg shrink-0 bg-accent/10 flex items-center justify-center">
                      <Icon size={15} className="text-accent" />
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-t2 mb-0.5">{title}</p>
                      <p className="text-xs text-t3">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 1 — Account */}
          {step === 1 && (
            <div>
              <h2 className="text-[22px] font-bold text-t1 tracking-tight mb-2">Create admin account</h2>
              <p className="text-sm text-t3 mb-7">This will be the owner account with full access to all gateway features.</p>
              <div className="space-y-4">
                <Field label="Full name" value={form.name} onChange={set('name')} placeholder="Alice Chen" autoFocus />
                <Field label="Email address" type="email" value={form.email} onChange={set('email')} placeholder="admin@yourcompany.com" />
                <Field label="Password" type="password" value={form.password} onChange={set('password')} placeholder="Min. 8 characters" hint="Use a strong password — this is the gateway admin account" />
                <Field label="Confirm password" type="password" value={form.confirm} onChange={set('confirm')} placeholder="Repeat password" />
                <div className="flex items-start gap-2.5 pt-1 text-sm text-t2">
                  <input
                    id="terms-accepted"
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={e => setTermsAccepted(e.target.checked)}
                    disabled={!termsInfo?.url}
                    className="mt-0.5 accent-accent"
                  />
                  <div>
                    <label htmlFor="terms-accepted" className="cursor-pointer">I have read and agree to the </label>
                    {termsInfo?.url
                      ? <a href={termsInfo.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">Terms of Use</a>
                      : <span>Terms of Use</span>}
                    {termsInfo?.version ? ` (version ${termsInfo.version})` : ''}.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2 — Gateway */}
          {step === 2 && (
            <div>
              <h2 className="text-[22px] font-bold text-t1 tracking-tight mb-2">Configure gateway</h2>
              <p className="text-sm text-t3 mb-7">Set your gateway name and public URL. This can be changed later in Settings.</p>
              <div className="space-y-4">
                <Field label="Gateway name" value={form.gateway_name} onChange={set('gateway_name')} placeholder="Mcplama" />
                <Field label="Public URL (optional)" value={form.app_url} onChange={set('app_url')} placeholder="https://mcplama-host.invalid"
                 />
              </div>
              <div className="mt-6 p-3.5 bg-accent/[0.06] border border-accent/20 rounded-xl">
                <p className="text-xs text-t3 leading-relaxed">
                  <span className="text-t2 font-semibold">Tip:</span> For local use, keep <code className="text-accent">default</code>. For production, use your public domain with HTTPS.
                </p>
              </div>
            </div>
          )}

          {/* Step 3 — Email (SMTP) */}
          {step === 3 && (
            <div>
              <h2 className="text-[22px] font-bold text-t1 tracking-tight mb-2">Email (SMTP)</h2>
              <p className="text-sm text-t3 mb-7">Optional, but recommended — you can also set this up later in Settings.</p>

              <div className="flex items-center justify-between p-3.5 bg-card2 rounded-xl border border-border mb-5">
                <div className="pr-4">
                  <p className="text-[13px] font-semibold text-t2 mb-0.5">Enable SMTP now</p>
                  <p className="text-xs text-t3">Turn this on to configure an outbound mail server during setup.</p>
                </div>
                <Toggle enabled={form.smtp_enabled} onChange={v => setForm(f => ({ ...f, smtp_enabled: v }))} />
              </div>

              <div className="p-3.5 bg-accent/[0.06] border border-accent/20 rounded-xl mb-6">
                <p className="text-xs text-t3 leading-relaxed">
                  <span className="text-t2 font-semibold">What SMTP is used for:</span> sending team invite emails, alert
                  notifications, and — importantly — <span className="text-t2 font-semibold">resetting the admin password</span> if
                  you ever get locked out. Without SMTP configured, a locked-out admin has no self-service way back in.
                </p>
              </div>

              {form.smtp_enabled && (
                <div className="space-y-4">
                  <div className="grid grid-cols-[1fr,110px] gap-3">
                    <Field label="SMTP host" value={form.smtp_host} onChange={set('smtp_host')} placeholder="smtp.gmail.com" autoFocus />
                    <Field label="Port" value={form.smtp_port} onChange={set('smtp_port')} placeholder="587" />
                  </div>
                  <Field label="Username (optional)" value={form.smtp_username} onChange={set('smtp_username')} placeholder="you@company.com" />
                  <Field label="Password (optional)" type="password" value={form.smtp_password} onChange={set('smtp_password')} placeholder="App password or SMTP password" />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="From email" type="email" value={form.smtp_from_email} onChange={set('smtp_from_email')} placeholder={form.email || 'noreply@company.com'} />
                    <Field label="From name" value={form.smtp_from_name} onChange={set('smtp_from_name')} placeholder={form.gateway_name || 'MCPlama'} />
                  </div>
                  <div className="flex items-center justify-between p-3.5 bg-card2 rounded-xl border border-border">
                    <p className="text-[13px] font-semibold text-t2">Use STARTTLS</p>
                    <Toggle enabled={form.smtp_use_tls} onChange={v => setForm(f => ({ ...f, smtp_use_tls: v }))} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 4 — Done */}
          {step === 4 && (
            <div className="text-center py-2">
              <div className="w-16 h-16 rounded-full mx-auto mb-6 bg-ok/15 border-2 border-ok/40 flex items-center justify-center">
                <Check size={28} className="text-ok" strokeWidth={2.5} />
              </div>
              <h2 className="text-[22px] font-bold text-t1 tracking-tight mb-2.5">You're all set!</h2>
              <p className="text-sm text-t3 leading-relaxed mb-8">Your Mcplama gateway is configured and ready. Start by adding MCP servers from the catalog.</p>
              <div className="flex flex-col gap-2.5 text-left">
                {[
                  '→ Browse the catalog and install your first MCP server',
                  '→ Invite team members from the Users page',
                  form.smtp_enabled
                    ? '→ SMTP is on — invites, alerts, and admin password reset can send email'
                    : '→ Set up SMTP in Settings to enable invites, alerts, and admin password reset',
                ].map(t => <p key={t} className="text-sm text-t2">{t}</p>)}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3.5 py-2.5 bg-danger/10 border border-danger/30 rounded-xl text-danger text-sm mt-5">
              <Shield size={14} className="shrink-0" /> {error}
            </div>
          )}

          {/* Actions */}
          <div className={`flex ${step === 0 ? 'justify-end' : 'justify-between'} mt-9 pt-7 border-t border-border`}>
            {step > 0 && step < 4 && (
              <button onClick={() => { setStep(s => s - 1); setError('') }}
                className="px-5 py-2.5 bg-transparent border border-border2 rounded-xl text-t3 text-sm cursor-pointer hover:text-t2 transition-colors">
                Back
              </button>
            )}
            {step < 4 ? (
              <button onClick={next} disabled={loading}
                className="flex items-center gap-2 px-6 py-2.5 bg-accent text-white rounded-xl text-sm font-semibold shadow-glow hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed">
                {loading
                  ? <><span className="spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full inline-block" /> Working…</>
                  : <>{step === 0 ? 'Get started' : step === 3 ? 'Complete setup' : 'Continue'} <ArrowRight size={15} /></>}
              </button>
            ) : (
              <button onClick={finish} disabled={loading}
                className="flex items-center gap-2 px-7 py-2.5 bg-accent text-white rounded-xl text-sm font-semibold shadow-glow hover:opacity-90 transition-opacity">
                {loading ? 'Signing in…' : 'Go to dashboard'} <ArrowRight size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

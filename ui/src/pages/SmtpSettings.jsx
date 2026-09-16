/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useEffect } from 'react'
import api from '../lib/api'

const inputCls = 'w-full px-3 py-2.5 rounded-xl text-sm bg-card border border-border text-t1 outline-none focus:border-accent transition-colors'
const labelCls = 'block text-[11px] font-semibold text-t3 uppercase tracking-widest mb-1'

const PRESETS = [
  { label:'Gmail',    host:'smtp.gmail.com',     port:587 },
  { label:'Outlook',  host:'smtp.office365.com', port:587 },
  { label:'SendGrid', host:'smtp.sendgrid.net',  port:587 },
  { label:'Mailgun',  host:'smtp.mailgun.org',   port:587 },
]

export function SmtpSettings({ bare = false }) {
  const [config, setConfig]         = useState({ host:'', port:587, username:'', password:'', from_email:'', from_name:'Mcplama', use_tls:true, is_enabled:false })
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [testing, setTesting]       = useState(false)
  const [testEmail, setTestEmail]   = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [saved, setSaved]           = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [isConfigured, setIsConfigured] = useState(false)
  const [isEditing, setIsEditing]   = useState(false)

  useEffect(() => {
    api.get('/smtp').then(r => {
      setConfig(c => ({ ...c, ...r.data, password:'' }))
      setIsConfigured(!!(r.data.host && r.data.is_enabled))
    }).finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true); setSaved(false)
    try {
      await api.post('/smtp', config)
      setSaved(true); setIsConfigured(!!(config.host && config.is_enabled)); setIsEditing(false)
      setTimeout(() => setSaved(false), 3000)
    } catch(e) { alert(e.response?.data?.detail || 'Failed to save') }
    finally { setSaving(false) }
  }

  const test = async () => {
    if (!testEmail) return alert('Enter a test email address')
    setTesting(true); setTestResult(null)
    try { await api.post(`/smtp/test?to=${encodeURIComponent(testEmail)}`); setTestResult({ ok:true, msg:`Test email sent to ${testEmail}` }) }
    catch(e) { setTestResult({ ok:false, msg:e.response?.data?.detail||'Failed to send' }) }
    finally { setTesting(false) }
  }

  const set = k => e => setConfig(c => ({ ...c, [k]: e.target.value }))

  if (loading) return null

  const inner = (
    <div className={bare ? '' : 'rounded-2xl border border-border bg-surface overflow-hidden'}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-t1">SMTP / Email</p>
            {isConfigured && <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-ok/15 text-ok border border-ok/30">✓ Configured</span>}
          </div>
          <p className="text-xs mt-0.5 text-t3">Used for invite emails and alert notifications</p>
        </div>
        <div className="flex items-center gap-3">
          {isConfigured && !isEditing && (
            <button onClick={() => setIsEditing(true)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent/15 text-accent border border-accent/30">Edit</button>
          )}
          {isEditing && (
            <button onClick={() => setIsEditing(false)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-danger/15 text-danger border border-danger/30">Cancel</button>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs text-t3">{config.is_enabled ? 'Enabled' : 'Disabled'}</span>
            <div onClick={() => setConfig(c => ({ ...c, is_enabled:!c.is_enabled }))}
              className={`relative w-10 h-5 rounded-full cursor-pointer transition-colors ${config.is_enabled ? 'bg-accent' : 'bg-border'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${config.is_enabled ? 'left-[22px]' : 'left-0.5'}`} />
            </div>
          </div>
        </div>
      </div>

      {/* View mode */}
      {isConfigured && !isEditing && (
        <div className="px-6 py-2">
          {[
            { label:'Host',     value:`${config.host}:${config.port}` },
            { label:'Username', value:config.username||'—' },
            { label:'From',     value:config.from_email ? `${config.from_name} <${config.from_email}>` : '—' },
            { label:'TLS',      value:config.use_tls ? 'Enabled (STARTTLS)' : 'Disabled' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between py-2.5 border-b border-border">
              <span className="text-xs text-t3">{label}</span>
              <span className="text-xs font-medium text-t1">{value}</span>
            </div>
          ))}
          <div className="py-4 space-y-2">
            <p className="text-xs font-semibold text-t3">Send test email</p>
            <div className="flex gap-2">
              <input className="flex-1 px-3 py-2 rounded-xl text-sm bg-card border border-border text-t1 outline-none focus:border-accent"
                type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="test@example.com" />
              <button onClick={test} disabled={testing}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-card text-t2 border border-border disabled:opacity-60 whitespace-nowrap">
                {testing ? 'Sending...' : 'Send test'}
              </button>
            </div>
            {testResult && (
              <div className={`rounded-xl px-3 py-2 text-xs ${testResult.ok ? 'bg-ok/10 text-ok border border-ok/25' : 'bg-danger/10 text-danger border border-danger/25'}`}>
                {testResult.msg}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit/create form */}
      {(!isConfigured || isEditing) && (
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><label className={labelCls}>SMTP host</label><input className={inputCls} value={config.host||''} onChange={set('host')} placeholder="smtp.gmail.com" /></div>
            <div><label className={labelCls}>Port</label><input className={inputCls} type="number" value={config.port} onChange={e => setConfig(c => ({...c, port:parseInt(e.target.value)}))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Username</label><input className={inputCls} value={config.username||''} onChange={set('username')} placeholder="you@gmail.com" /></div>
            <div>
              <label className={labelCls}>Password</label>
              <div className="relative">
                <input className={`${inputCls} pr-10`} type={showPassword ? 'text' : 'password'} value={config.password||''}
                  onChange={set('password')} placeholder={isEditing ? 'Leave empty to keep current' : 'App password'} />
                <button type="button" onClick={() => setShowPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-t3 hover:text-t2 text-sm">{showPassword ? '🙈' : '👁'}</button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>From email</label><input className={inputCls} value={config.from_email||''} onChange={set('from_email')} placeholder="noreply@yourcompany.com" /></div>
            <div><label className={labelCls}>From name</label><input className={inputCls} value={config.from_name||''} onChange={set('from_name')} placeholder="Mcplama" /></div>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={config.use_tls} onChange={e => setConfig(c => ({...c, use_tls:e.target.checked}))} className="accent-accent" />
            <span className="text-sm text-t2">Use TLS (STARTTLS) — recommended for port 587</span>
          </label>
          <div>
            <p className="text-xs font-semibold text-t3 mb-2">Quick presets</p>
            <div className="flex gap-2 flex-wrap">
              {PRESETS.map(p => (
                <button key={p.label} onClick={() => setConfig(c => ({...c, host:p.host, port:p.port, use_tls:true}))}
                  className="text-xs px-3 py-1.5 rounded-lg bg-card text-t3 border border-border hover:text-t1 hover:border-accent transition-colors">
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <button onClick={save} disabled={saving}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-70 ${saved ? 'bg-ok/20 text-ok border border-ok/40' : 'bg-accent/20 text-accent border border-accent/40'}`}>
            {saving ? 'Saving...' : saved ? '✓ Saved' : isEditing ? 'Update configuration' : 'Save configuration'}
          </button>
        </div>
      )}
    </div>
  )
  return inner
}

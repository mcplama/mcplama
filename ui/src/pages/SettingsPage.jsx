/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useEffect } from 'react'
import { ExternalLink, Clock, Check, Pencil } from 'lucide-react'
import api from '../lib/api'
import { PageHeader } from '../components/ui'
import { Modal, ModalHeader } from '../components/ui/Modal'
import { SmtpSettings } from './SmtpSettings'
import Button from '../components/kit/Button'

const ALL_ZONES = (() => {
  try { return Intl.supportedValuesOf('timeZone') } catch { return ['UTC'] }
})()

const inputCls = 'shadow-theme-xs h-11 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-800 focus:border-brand-300 focus:ring-3 focus:ring-brand-500/10 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30'
const labelCls = 'block text-xs font-medium text-gray-700 dark:text-gray-400 mb-1.5'

function Field({ label, value, mono = false }) {
  return (
    <div>
      <p className="mb-2 text-xs leading-normal text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`text-sm font-medium text-gray-800 dark:text-white/90 ${mono ? 'font-mono text-xs text-brand-500' : ''}`}>
        {value || '—'}
      </p>
    </div>
  )
}

function EditBtn({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-theme-xs hover:bg-gray-50 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200 lg:inline-flex lg:w-auto shrink-0"
    >
      <Pencil size={14} />
      Edit
    </button>
  )
}

function Section({ title, children, action }) {
  return (
    <div className="p-5 border border-gray-200 rounded-2xl dark:border-gray-800 lg:p-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex-1 min-w-0">
          <h4 className="text-lg font-semibold text-gray-800 dark:text-white/90 lg:mb-6">{title}</h4>
          {children}
        </div>
        {action}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const [stats, setStats]   = useState(null)
  const [health, setHealth] = useState(null)

  // Gateway config
  const [gConfig, setGConfig]   = useState({ gateway_name: '', app_url: '', default_token_expiry_days: '', mcp_access_token_lifetime_hours: '' })
  const [gDraft, setGDraft]     = useState(null)
  const [gSaving, setGSaving]   = useState(false)
  const [gSaved, setGSaved]     = useState(false)
  const [gOpen, setGOpen]       = useState(false)

  // SMTP summary (read-only display)
  const [smtp, setSmtp]         = useState(null)
  const [smtpOpen, setSmtpOpen] = useState(false)

  // Time prefs (local)
  const [timePref, setTimePref] = useState(() => {
    try {
      const s = localStorage.getItem('mcplama_time')
      return s ? JSON.parse(s) : { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, timeFormat: '24h', dateFormat: 'YYYY-MM-DD' }
    } catch { return { timezone: 'UTC', timeFormat: '24h', dateFormat: 'YYYY-MM-DD' } }
  })
  const [timeDraft, setTimeDraft]   = useState(null)
  const [timeSaved, setTimeSaved]   = useState(false)
  const [timeOpen, setTimeOpen]     = useState(false)
  const [now, setNow]               = useState(new Date())

  useEffect(() => {
    api.get('/gateway/stats').then(r => setStats(r.data)).catch(() => {})
    fetch('/health').then(r => r.json()).then(setHealth).catch(() => {})
    api.get('/smtp').then(r => setSmtp(r.data)).catch(() => {})
    api.get('/gateway/config').then(r => setGConfig({
      gateway_name: r.data.gateway_name || '',
      app_url: r.data.app_url || '',
      default_token_expiry_days: r.data.default_token_expiry_days ?? '',
      mcp_access_token_lifetime_hours: r.data.mcp_access_token_lifetime_hours ?? '',
    })).catch(() => {})
  }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const openGateway = () => { setGDraft({ ...gConfig }); setGOpen(true) }
  const closeGateway = () => { setGOpen(false); setGDraft(null) }
  const saveGateway = async () => {
    setGSaving(true)
    try {
      await api.post('/gateway/config', {
        ...gDraft,
        default_token_expiry_days: gDraft.default_token_expiry_days === '' ? 0 : Number(gDraft.default_token_expiry_days),
        mcp_access_token_lifetime_hours: gDraft.mcp_access_token_lifetime_hours === '' ? 0 : Number(gDraft.mcp_access_token_lifetime_hours),
      })
      setGConfig({ ...gDraft })
      setGSaved(true); setTimeout(() => setGSaved(false), 3000)
      closeGateway()
    } catch (e) { alert(e.response?.data?.detail || 'Failed to save') }
    finally { setGSaving(false) }
  }

  const openTime = () => { setTimeDraft({ ...timePref }); setTimeOpen(true) }
  const closeTime = () => { setTimeOpen(false); setTimeDraft(null) }
  const saveTime = () => {
    localStorage.setItem('mcplama_time', JSON.stringify(timeDraft))
    setTimePref({ ...timeDraft })
    setTimeSaved(true); setTimeout(() => setTimeSaved(false), 2500)
    closeTime()
  }

  const previewFor = (pref) => {
    const time = now.toLocaleTimeString('en', {
      timeZone: pref.timezone, hour12: pref.timeFormat === '12h',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: pref.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now)
    const get = type => parts.find(p => p.type === type)?.value || '00'
    const [y, m, d] = [get('year'), get('month'), get('day')]
    const date = pref.dateFormat === 'DD/MM/YYYY' ? `${d}/${m}/${y}` : pref.dateFormat === 'MM/DD/YYYY' ? `${m}/${d}/${y}` : `${y}-${m}-${d}`
    return { time, date }
  }

  const preview = previewFor(timePref)

  const healthRows = health ? [
    { label: 'Status',     value: health.status === 'ok' ? 'Operational' : 'Degraded', ok: health.status === 'ok' },
    { label: 'Version',    value: health.version || '—' },
    { label: 'Containers', value: `${health.running_containers || 0} running` },
    { label: 'App',        value: health.app || 'MCPlama' },
  ] : []

  const statsRows = stats ? [
    { label: 'Total servers',      value: stats.total_servers ?? '—' },
    { label: 'Active servers',     value: stats.active_servers ?? '—' },
    { label: 'Tools registered',   value: stats.total_tools ?? '—' },
    { label: 'Active connections', value: stats.active_connections ?? '—' },
    { label: 'Calls today',        value: (stats.calls_today ?? 0).toLocaleString() },
    { label: 'Calls total',        value: (stats.calls_total ?? 0).toLocaleString() },
  ] : []

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Settings" description="Gateway configuration and preferences" />

      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] p-5 lg:p-6">
        <h3 className="mb-6 text-lg font-semibold text-gray-800 dark:text-white/90">Configuration</h3>

        <div className="space-y-6">

          {/* ── Gateway ───────────────────────────────────────── */}
          <Section title="Gateway" action={<EditBtn onClick={openGateway} />}>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-7">
              <Field label="Gateway name" value={gConfig.gateway_name || 'MCPlama'} />
              <Field label="Public URL"   value={gConfig.app_url || 'localhost (default)'} />
              <Field
                label="Default token expiry"
                value={gConfig.default_token_expiry_days ? `${gConfig.default_token_expiry_days} days` : 'Never'}
              />
              <Field
                label="MCP access token lifetime"
                value={gConfig.mcp_access_token_lifetime_hours ? `${gConfig.mcp_access_token_lifetime_hours} hours` : '24 hours (default)'}
              />
            </div>
          </Section>

          {/* ── SMTP ──────────────────────────────────────────── */}
          <Section title="Email / SMTP" action={<EditBtn onClick={() => setSmtpOpen(true)} />}>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-7">
              <Field label="Status" value={
                smtp?.host && smtp?.is_enabled ? '✓ Configured' : smtp?.host ? 'Configured (disabled)' : 'Not configured'
              } />
              <Field label="Host" value={smtp?.host ? `${smtp.host}:${smtp.port ?? 587}` : '—'} />
              <Field label="From" value={smtp?.from_email ? `${smtp.from_name ?? ''} <${smtp.from_email}>`.trim() : '—'} />
            </div>
          </Section>

          {/* ── Time & date ───────────────────────────────────── */}
          <Section title="Time & date" action={<EditBtn onClick={openTime} />}>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-7">
              <Field label="Timezone"    value={timePref.timezone.replace(/_/g, ' ')} />
              <Field label="Time format" value={timePref.timeFormat === '24h' ? '24-hour' : '12-hour'} />
              <Field label="Date format" value={timePref.dateFormat} />
            </div>
            <div className="mt-5 flex items-center gap-3 pt-5 border-t border-gray-100 dark:border-gray-800">
              <div className="w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-500/15 flex items-center justify-center shrink-0">
                <Clock size={16} className="text-brand-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-white/90 tabular-nums">{preview.time}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{preview.date} · {timePref.timezone.replace(/_/g, ' ')}</p>
              </div>
            </div>
          </Section>

          {/* ── System ────────────────────────────────────────── */}
          <Section title="System">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-7">
              {[...healthRows, ...statsRows].map(({ label, value, ok }) => (
                <div key={label}>
                  <p className="mb-2 text-xs leading-normal text-gray-500 dark:text-gray-400">{label}</p>
                  <p className={`text-sm font-medium ${ok === true ? 'text-success-600 dark:text-success-400' : ok === false ? 'text-error-600 dark:text-error-400' : 'text-gray-800 dark:text-white/90'}`}>
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </Section>

          {/* ── API endpoints ─────────────────────────────────── */}
          <Section title="API endpoints">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {[
                { label: 'MCP connect',  url: `${window.location.origin}/connect/{token}` },
                { label: 'REST API',     url: `${window.location.origin}/api/v1` },
                { label: 'OpenAPI docs', url: `${window.location.origin}/docs` },
                { label: 'Health',       url: `${window.location.origin}/health` },
              ].map(({ label, url }) => (
                <div key={label}>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">{label}</p>
                  <div className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-gray-800 group">
                    <code className="text-xs font-mono flex-1 truncate text-gray-600 dark:text-gray-400">{url}</code>
                    <a href={url.replace(/\{[^}]*\}/g, '')} target="_blank" rel="noreferrer"
                      className="opacity-0 group-hover:opacity-100 transition-all text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                      <ExternalLink size={11} />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </Section>

        </div>
      </div>

      {/* ── SMTP modal ─────────────────────────────────────── */}
      {smtpOpen && (
        <Modal closeOnBackdrop={false} onClose={() => { setSmtpOpen(false); api.get('/smtp').then(r => setSmtp(r.data)).catch(() => {}) }} width="max-w-xl">
          <ModalHeader title="Email / SMTP" subtitle="Configure outbound email for invites and alerts" onClose={() => setSmtpOpen(false)} />
          <div className="overflow-y-auto">
            <SmtpSettings bare />
          </div>
        </Modal>
      )}

      {/* ── Gateway edit modal ──────────────────────────────── */}
      {gOpen && gDraft && (
        <Modal onClose={closeGateway} width="max-w-lg">
          <ModalHeader title="Gateway configuration" subtitle="Set the public URL and default token policy" onClose={closeGateway} />
          <div className="p-6 space-y-5 overflow-y-auto">
            <div>
              <label className={labelCls}>Gateway name</label>
              <input className={inputCls} value={gDraft.gateway_name}
                onChange={e => setGDraft(d => ({ ...d, gateway_name: e.target.value }))}
                placeholder="MCPlama" />
            </div>
            <div>
              <label className={labelCls}>Public URL <span className="text-gray-400 font-normal">(optional)</span></label>
              <input className={inputCls} value={gDraft.app_url}
                onChange={e => setGDraft(d => ({ ...d, app_url: e.target.value }))}
                placeholder="https://mcplama-host.invalid" />
              <p className="text-xs mt-1.5 text-gray-500 dark:text-gray-400">
                Leave empty to use <code className="text-brand-500 text-[11px]">localhost</code> defaults.
                Set this if users access MCPlama from other machines.
              </p>
            </div>
            <div>
              <label className={labelCls}>Default token expiry</label>
              <div className="flex items-center gap-2">
                <input className={inputCls} type="number" min="0" placeholder="Never"
                  value={gDraft.default_token_expiry_days}
                  onChange={e => setGDraft(d => ({ ...d, default_token_expiry_days: e.target.value }))}
                  style={{ maxWidth: 120 }} />
                <span className="text-sm text-gray-500 dark:text-gray-400">days</span>
              </div>
              <p className="text-xs mt-1.5 text-gray-500 dark:text-gray-400">
                New tokens expire after this many days. Leave empty for no expiry.
                Admins can override per-connection in the Connections page.
              </p>
            </div>
            <div>
              <label className={labelCls}>MCP access token lifetime</label>
              <div className="flex items-center gap-2">
                <input className={inputCls} type="number" min="0" placeholder="24"
                  value={gDraft.mcp_access_token_lifetime_hours}
                  onChange={e => setGDraft(d => ({ ...d, mcp_access_token_lifetime_hours: e.target.value }))}
                  style={{ maxWidth: 120 }} />
                <span className="text-sm text-gray-500 dark:text-gray-400">hours</span>
              </div>
              <p className="text-xs mt-1.5 text-gray-500 dark:text-gray-400">
                How long an MCP client's login stays valid before it must re-authenticate
                through MCPlama. Leave empty to use the 24-hour default. Only applies when
                the connection itself has no explicit expiry set above.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800 shrink-0">
            <Button variant="outline" size="sm" onClick={closeGateway}>Cancel</Button>
            <Button size="sm" onClick={saveGateway} disabled={gSaving}
              startIcon={gSaved ? <Check size={14} /> : undefined}>
              {gSaving ? 'Saving…' : gSaved ? 'Saved' : 'Save changes'}
            </Button>
          </div>
        </Modal>
      )}

      {/* ── Time & date edit modal ──────────────────────────── */}
      {timeOpen && timeDraft && (
        <Modal onClose={closeTime} width="max-w-lg">
          <ModalHeader title="Time & date" subtitle="Controls how timestamps are displayed across the app" onClose={closeTime} />
          <div className="p-6 space-y-5 overflow-y-auto">
            <div>
              <label className={labelCls}>Timezone</label>
              <select className={inputCls} value={timeDraft.timezone}
                onChange={e => setTimeDraft(d => ({ ...d, timezone: e.target.value }))}>
                {ALL_ZONES.map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Time format</label>
              <div className="flex gap-2 h-11">
                {['24h', '12h'].map(f => (
                  <button key={f} onClick={() => setTimeDraft(d => ({ ...d, timeFormat: f }))}
                    className={`flex-1 rounded-lg border text-sm font-medium transition-colors ${
                      timeDraft.timeFormat === f
                        ? 'bg-brand-500 border-brand-500 text-white'
                        : 'border-gray-300 text-gray-600 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/5'
                    }`}>
                    {f === '24h' ? '24-hour' : '12-hour'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={labelCls}>Date format</label>
              <select className={inputCls} value={timeDraft.dateFormat}
                onChange={e => setTimeDraft(d => ({ ...d, dateFormat: e.target.value }))}>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              </select>
            </div>
            {/* Live preview */}
            <div className="flex items-center gap-3 p-4 rounded-xl bg-gray-50 dark:bg-white/[0.03] border border-gray-100 dark:border-gray-800">
              <div className="w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-500/15 flex items-center justify-center shrink-0">
                <Clock size={16} className="text-brand-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-white/90 tabular-nums">{previewFor(timeDraft).time}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{previewFor(timeDraft).date} · {timeDraft.timezone.replace(/_/g, ' ')}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800 shrink-0">
            <Button variant="outline" size="sm" onClick={closeTime}>Cancel</Button>
            <Button size="sm" onClick={saveTime}
              startIcon={timeSaved ? <Check size={14} /> : undefined}>
              {timeSaved ? 'Saved' : 'Save changes'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

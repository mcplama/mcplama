/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, RefreshCw, BellOff, Mail, AlertCircle, TrendingDown, TrendingUp, Ban, UserPlus, BellRing } from 'lucide-react'
import api from '../lib/api'
import { parseServerTimestamp } from '../lib/formatTime'
import { T } from '../theme'
import { Toggle, Spinner, EmptyState, Btn, FormHelp } from '../components/ui'
import { Table, TableHeader, TableBody, TableRow, TableCell } from '../components/kit/Table'
import Badge from '../components/kit/Badge'
import Button from '../components/kit/Button'

const TYPE_CONFIG = {
  error_rate:       { label: 'Error rate',      icon: TrendingDown, color: T.danger, desc: '% of failed calls'   },
  call_spike:       { label: 'Call spike',       icon: TrendingUp,   color: T.warn,   desc: 'Too many calls'      },
  policy_violation: { label: 'Policy violation', icon: Ban,          color: T.accent, desc: 'Any blocked request' },
  new_user:         { label: 'New user',         icon: UserPlus,     color: T.ok,     desc: 'Someone joined'      },
}

const SEV_COLOR = { danger: T.danger, warn: T.warn, info: T.accent }
const sevKitColor = s => s === 'danger' ? 'error' : s === 'warn' ? 'warning' : 'info'

const inputSt = {
  width: '100%', padding: '8px 12px', borderRadius: 10, fontSize: 13,
  background: T.card, border: `1px solid ${T.border}`, color: T.t1, outline: 'none',
}
const labelSt = {
  display: 'block', fontSize: 11, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.05em', color: T.t3, marginBottom: 4,
}

function TypeButton({ type, active, onClick }) {
  const cfg = TYPE_CONFIG[type]
  const Icon = cfg.icon
  return (
    <button onClick={onClick} style={{
      padding: '10px 8px', borderRadius: 12, cursor: 'pointer', textAlign: 'center',
      background: active ? `${cfg.color}18` : T.card,
      border: `1px solid ${active ? cfg.color : T.border}`,
      boxShadow: active ? `0 0 0 1px ${cfg.color}` : 'none',
      transition: 'all .15s',
    }}>
      <Icon size={18} style={{ color: active ? cfg.color : T.t3, margin: '0 auto 4px' }} />
      <p style={{ fontSize: 11, fontWeight: 600, color: active ? cfg.color : T.t2 }}>{cfg.label}</p>
      <p style={{ fontSize: 10, color: T.t3, marginTop: 2 }}>{cfg.desc}</p>
    </button>
  )
}

const TABS = [
  { id: 'all',     label: 'All' },
  { id: 'enabled', label: 'Enabled' },
  { id: 'firing',  label: 'Firing' },
]

const DEFAULT_FORM = {
  name: '', description: '', severity: 'warn', alert_type: 'error_rate',
  server_id: '', threshold: 10, window_seconds: 3600,
  notify_user_ids: [], notify_by_email: false, cooldown_seconds: 3600,
}

export default function AlertsPage() {
  const [alerts, setAlerts]           = useState([])
  const [servers, setServers]         = useState([])
  const [users, setUsers]             = useState([])
  const [loading, setLoading]         = useState(true)
  const [showForm, setShowForm]       = useState(false)
  const [smtpEnabled, setSmtpEnabled] = useState(false)
  const [tab, setTab]                 = useState('all')
  const [form, setForm]               = useState(DEFAULT_FORM)
  const [editingId, setEditingId]     = useState(null)

  useEffect(() => {
    api.get('/smtp').then(r => setSmtpEnabled(r.data?.is_enabled && !!r.data?.host)).catch(() => {})
  }, [])

  const load = useCallback(() =>
    Promise.all([api.get('/alerts'), api.get('/servers'), api.get('/users').catch(() => ({ data: [] }))])
      .then(([a, s, u]) => { setAlerts(a.data); setServers(s.data); setUsers(u.data) })
      .finally(() => setLoading(false))
  , [])
  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(load, 60000); return () => clearInterval(t) }, [load])

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const buildConfig = () => {
    const cooldown = form.cooldown_seconds || 3600
    if (form.alert_type === 'error_rate')      return { threshold: parseInt(form.threshold), window_seconds: parseInt(form.window_seconds), cooldown_seconds: cooldown }
    if (form.alert_type === 'call_spike')       return { threshold: parseInt(form.threshold), window_seconds: parseInt(form.window_seconds), cooldown_seconds: cooldown }
    if (form.alert_type === 'policy_violation') return { window_seconds: parseInt(form.window_seconds), cooldown_seconds: cooldown }
    if (form.alert_type === 'new_user')         return { threshold: parseInt(form.threshold), window_seconds: parseInt(form.window_seconds), cooldown_seconds: cooldown }
    return {}
  }

  const submit = async () => {
    if (!form.name.trim()) return
    try {
      const payload = {
        name: form.name, description: form.description, severity: form.severity,
        alert_type: form.alert_type,
        server_id: form.server_id ? parseInt(form.server_id) : null,
        config: { ...buildConfig(), notify_by_email: form.notify_by_email },
        notify_user_ids: form.notify_by_email ? form.notify_user_ids.map(id => parseInt(id)) : [],
      }
      if (editingId) await api.patch(`/alerts/${editingId}`, payload)
      else await api.post('/alerts', payload)
      setShowForm(false)
      setForm(DEFAULT_FORM)
      setEditingId(null)
      load()
    } catch (e) { alert(e.response?.data?.detail || 'Failed') }
  }

  const edit = (alert) => {
    const config = alert.config || {}
    setEditingId(alert.id)
    setForm({
      name: alert.name || '',
      description: alert.description || '',
      severity: alert.severity || 'warn',
      alert_type: alert.alert_type || 'error_rate',
      server_id: alert.server_id ? String(alert.server_id) : '',
      threshold: config.threshold ?? DEFAULT_FORM.threshold,
      window_seconds: config.window_seconds ?? DEFAULT_FORM.window_seconds,
      notify_user_ids: (alert.notify_user_ids || []).map(String),
      notify_by_email: !!config.notify_by_email,
      cooldown_seconds: config.cooldown_seconds ?? DEFAULT_FORM.cooldown_seconds,
    })
    setShowForm(true)
  }

  const cancelForm = () => {
    setShowForm(false)
    setForm(DEFAULT_FORM)
    setEditingId(null)
  }

  const toggle   = async (id) => { await api.patch(`/alerts/${id}/toggle`); load() }
  const remove   = async (id) => { if (!confirm('Delete this alert?')) return; await api.delete(`/alerts/${id}`); load() }
  const checkNow = async () => {
    try {
      const { data } = await api.get('/alerts/check')
      load()
      alert(data.firing.length > 0 ? `${data.firing.length} alert(s) firing.` : 'All alerts OK.')
    } catch { alert('Check failed') }
  }

  const firing    = alerts.filter(a => a.status === 'firing' && a.is_enabled)
  const typeColor = TYPE_CONFIG[form.alert_type]?.color || T.accent

  const displayed = tab === 'enabled'
    ? alerts.filter(a => a.is_enabled)
    : tab === 'firing'
    ? alerts.filter(a => a.status === 'firing' && a.is_enabled)
    : alerts

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Firing banner */}
      {firing.length > 0 && (
        <div className="rounded-xl border border-error-200 bg-error-50 px-5 py-4 dark:border-error-500/20 dark:bg-error-500/10">
          <p className="flex items-center gap-2 text-sm font-semibold text-error-600 dark:text-error-400 mb-2">
            <AlertCircle size={14} /> {firing.length} alert{firing.length > 1 ? 's' : ''} firing
          </p>
          {firing.map(a => (
            <div key={a.id} className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
              <span className="font-medium">{a.name}</span>
              <span className="text-gray-400">{a.current_value}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Create form (Policies-style) ── */}
      {showForm && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: '1.25rem' }}
          className="space-y-4 animate-fade-in">

          <div className="flex items-center gap-2">
            <BellRing size={16} style={{ color: T.accent }} />
            <p style={{ fontSize: 14, fontWeight: 600, color: T.t1 }}>{editingId ? 'Edit alert rule' : 'Create alert rule'}</p>
          </div>

          {/* Type selector */}
          <div>
            <label style={labelSt}>Alert type <FormHelp text="Choose the activity that should trigger this alert." /></label>
            <div className="grid grid-cols-4 gap-2">
              {Object.keys(TYPE_CONFIG).map(type => (
                <TypeButton key={type} type={type} active={form.alert_type === type}
                  onClick={() => setForm(f => ({ ...f, alert_type: type }))} />
              ))}
            </div>
          </div>

          {/* Name + severity */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelSt}>Alert name * <FormHelp text="Give the alert a short name that clearly identifies the condition being monitored." /></label>
              <input style={inputSt} value={form.name} onChange={set('name')} placeholder="e.g. High error rate" />
            </div>
            <div>
              <label style={labelSt}>Severity <FormHelp text="Controls how important the alert appears in the dashboard and email notification." /></label>
              <select style={inputSt} value={form.severity} onChange={set('severity')}>
                <option value="info">Info</option>
                <option value="warn">Warning</option>
                <option value="danger">Critical</option>
              </select>
            </div>
          </div>

          {/* Server + cooldown */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelSt}>Apply to server <FormHelp text="Choose one server or leave it set to All servers." /></label>
              <select style={inputSt} value={form.server_id} onChange={set('server_id')}>
                <option value="">All servers</option>
                {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelSt}>Email cooldown <FormHelp text="Minimum time between email notifications for this alert. It does not change how long the alert is firing." /></label>
              <select style={inputSt} value={form.cooldown_seconds} onChange={e => setForm(f => ({ ...f, cooldown_seconds: parseInt(e.target.value) }))}>
                <option value="300">5 minutes</option>
                <option value="1800">30 minutes</option>
                <option value="3600">1 hour</option>
                <option value="86400">24 hours</option>
              </select>
            </div>
          </div>

          {/* Type-specific config */}
          {form.alert_type !== 'policy_violation' && (
            <div style={{ background: `${typeColor}10`, border: `1px solid ${typeColor}30`, borderRadius: 12, padding: '1rem' }}
              className="grid grid-cols-2 gap-3">
              <div>
                <label style={labelSt}>
                  {form.alert_type === 'error_rate' ? 'Error rate threshold (%)' : form.alert_type === 'call_spike' ? 'Call count threshold' : 'User count threshold'}
                  <FormHelp text="The value at which this alert becomes firing." />
                </label>
                <input style={inputSt} type="number" value={form.threshold} onChange={set('threshold')} />
              </div>
              <div>
                <label style={labelSt}>Time window <FormHelp text="How far back MCPlama looks when calculating the alert condition." /></label>
                <select style={inputSt} value={form.window_seconds} onChange={set('window_seconds')}>
                  <option value="300">5 minutes</option>
                  <option value="900">15 minutes</option>
                  <option value="3600">1 hour</option>
                  <option value="86400">24 hours</option>
                </select>
              </div>
            </div>
          )}

          {form.alert_type === 'policy_violation' && (
            <div style={{ background: `${typeColor}10`, border: `1px solid ${typeColor}30`, borderRadius: 12, padding: '1rem' }}>
              <div>
                <label style={labelSt}>Time window <FormHelp text="How far back MCPlama looks for policy violations." /></label>
                <select style={inputSt} value={form.window_seconds} onChange={set('window_seconds')}>
                  <option value="300">5 minutes</option>
                  <option value="900">15 minutes</option>
                  <option value="3600">1 hour</option>
                  <option value="86400">24 hours</option>
                </select>
              </div>
            </div>
          )}

          {/* Email notifications */}
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '1rem' }}
            className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 600, color: T.t1 }}>
                  <Mail size={12} /> Email notifications
                </p>
                <p style={{ fontSize: 10, marginTop: 2, color: T.t3 }}>
                  {smtpEnabled ? 'Send email when this alert fires' : 'SMTP not configured — go to Settings'}
                </p>
              </div>
              <Toggle
                enabled={form.notify_by_email && smtpEnabled}
                onChange={v => smtpEnabled && setForm(f => ({ ...f, notify_by_email: v }))}
                disabled={!smtpEnabled}
              />
            </div>
            {form.notify_by_email && smtpEnabled && (
              <div>
                <label style={{ ...labelSt, marginBottom: 6 }}>
                  Notify users <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: T.t3 }}>— leave empty for all admins</span>
                  <FormHelp text="Select specific recipients, or leave empty to notify all active admins." />
                </label>
                <div style={{ borderRadius: 10, overflow: 'hidden', border: `1px solid ${T.border}` }}>
                  <div style={{ padding: '6px 12px', borderBottom: `1px solid ${T.border}`, fontSize: 11, color: T.t3 }}>
                    {form.notify_user_ids.length === 0 ? 'All admins (default)' : `${form.notify_user_ids.length} selected`}
                  </div>
                  <div style={{ maxHeight: 144, overflowY: 'auto' }}>
                    {users.map(u => {
                      const checked = form.notify_user_ids.includes(String(u.id))
                      return (
                        <label key={u.id} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '8px 12px', cursor: 'pointer',
                          borderBottom: `1px solid ${T.border}`,
                          background: checked ? `${T.accent}10` : 'transparent',
                        }}>
                          <input type="checkbox" checked={checked} style={{ accentColor: T.accent }}
                            onChange={e => {
                              const ids = form.notify_user_ids.filter(id => id !== String(u.id))
                              setForm(f => ({ ...f, notify_user_ids: e.target.checked ? [...ids, String(u.id)] : ids }))
                            }} />
                          <span style={{ fontSize: 12, color: T.t2, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {u.email}
                          </span>
                          <span style={{
                            fontSize: 10, padding: '1px 6px', borderRadius: 99, flexShrink: 0,
                            background: u.role === 'admin' ? `${T.accent}15` : T.card2,
                            color: u.role === 'admin' ? T.accent : T.t3,
                            border: `1px solid ${u.role === 'admin' ? `${T.accent}30` : T.border}`,
                          }}>{u.role}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label style={labelSt}>
              Description <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: T.t3 }}>(optional)</span>
              <FormHelp text="Briefly describe what this alert monitors or when it should fire." />
            </label>
            <input style={inputSt} value={form.description} onChange={set('description')} placeholder="What does this alert do?" />
          </div>

          <div className="flex gap-2 pt-3" style={{ borderTop: `1px solid ${T.border}` }}>
            <Btn variant="primary" size="sm" icon={editingId ? Pencil : Plus} onClick={submit}>{editingId ? 'Save changes' : 'Create alert'}</Btn>
            <Btn variant="secondary" size="sm" onClick={cancelForm}>Cancel</Btn>
          </div>
        </div>
      )}

      {/* ── Main table card ── */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">

        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Alerts</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">Get notified when unusual activity is detected</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="hidden h-11 items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 lg:inline-flex dark:bg-gray-900">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`text-theme-sm h-10 rounded-md px-3 py-2 font-medium hover:text-gray-900 dark:hover:text-white flex items-center gap-1.5 ${
                    tab === t.id
                      ? 'shadow-theme-xs bg-white text-gray-900 dark:bg-gray-800 dark:text-white'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {t.label}
                  {t.id === 'firing' && firing.length > 0 && (
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-error-500 text-white text-[10px] font-bold">
                      {firing.length}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={checkNow} startIcon={<RefreshCw size={14} />}>
              Check now
            </Button>
            <Button variant="primary" size="sm" onClick={() => {
              if (showForm) cancelForm()
              else { setEditingId(null); setForm(DEFAULT_FORM); setShowForm(true) }
            }} startIcon={<Plus size={14} />}>
              New alert rule
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center h-48"><Spinner size={24} /></div>
          ) : displayed.length === 0 ? (
            <div className="py-12"><EmptyState icon={BellOff} title="No alert rules" description="Create alerts to monitor error rates, call spikes, and policy violations." /></div>
          ) : (
            <Table>
              <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                <TableRow>
                  {['Alert', 'Type', 'Severity', 'Server', 'Status', 'Last triggered', ''].map((h, i) => (
                    <TableCell key={i} isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400 whitespace-nowrap">
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                {displayed.map(alert => {
                  const tc = TYPE_CONFIG[alert.alert_type]
                  const isFiring = alert.status === 'firing' && alert.is_enabled
                  return (
                    <TableRow key={alert.id} className="transition hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                      <TableCell className="px-5 py-4">
                        <div>
                          <p className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">{alert.name}</p>
                          {alert.description && <p className="text-theme-xs text-gray-400 mt-0.5">{alert.description}</p>}
                          {alert.current_value && <p className="text-theme-xs text-gray-400 mt-0.5 font-mono">{alert.current_value}</p>}
                        </div>
                      </TableCell>
                      <TableCell className="px-5 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-theme-xs" style={{ color: tc?.color }}>
                          {tc?.icon && <tc.icon size={12} />}
                          {tc?.label}
                        </span>
                      </TableCell>
                      <TableCell className="px-5 py-4 whitespace-nowrap">
                        <Badge size="sm" color={sevKitColor(alert.severity)}>{alert.severity}</Badge>
                      </TableCell>
                      <TableCell className="px-5 py-4 whitespace-nowrap">
                        {alert.server_id
                          ? <Badge size="sm" color="light">{servers.find(s => s.id === alert.server_id)?.name || `#${alert.server_id}`}</Badge>
                          : <span className="text-theme-xs text-gray-400">All servers</span>
                        }
                      </TableCell>
                      <TableCell className="px-5 py-4 whitespace-nowrap">
                        {isFiring
                          ? <Badge size="sm" color="error">Firing</Badge>
                          : alert.is_enabled
                          ? <Badge size="sm" color="success">Active</Badge>
                          : <Badge size="sm" color="light">Disabled</Badge>
                        }
                      </TableCell>
                      <TableCell className="px-5 py-4 whitespace-nowrap text-theme-xs text-gray-500 dark:text-gray-400">
                        {alert.last_triggered_at ? parseServerTimestamp(alert.last_triggered_at).toLocaleString() : '—'}
                        {alert.triggered_count > 0 && <span className="block text-gray-400">{alert.triggered_count}× total</span>}
                      </TableCell>
                      <TableCell className="px-5 py-4 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-3">
                          <Toggle enabled={alert.is_enabled} onChange={() => toggle(alert.id)} />
                          <button onClick={() => edit(alert)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 transition-colors" aria-label={`Edit ${alert.name}`}>
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => remove(alert.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-error-500 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  )
}

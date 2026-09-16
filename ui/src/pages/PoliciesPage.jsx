/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useEffect, useCallback } from 'react'
import { Timer, Ban, CheckCircle2, Clock, Plus, Trash2, Shield, Pencil, Server, Users, ShieldPlus, Webhook } from 'lucide-react'
import api from '../lib/api'
import { T } from '../theme'
import { Toggle, Btn, Spinner, EmptyState, PageHeader, FormHelp } from '../components/ui'

const TYPE_CONFIG = {
  rate_limit:    { label: 'Rate limit',    icon: Timer,        color: T.warn,   desc: 'Max calls per window' },
  tool_block:    { label: 'Block tools',   icon: Ban,          color: T.danger, desc: 'Deny specific tools' },
  tool_allow:    { label: 'Allow tools',   icon: CheckCircle2, color: T.ok,     desc: 'Allowlist only' },
  time_restrict: { label: 'Time restrict', icon: Clock,        color: T.accent, desc: 'Business hours only' },
  webhook:       { label: 'Webhook',       icon: Webhook,      color: T.accent, desc: 'External allow/deny/rewrite' },
}

const DAYS = [
  { id: '0', label: 'Mon' }, { id: '1', label: 'Tue' }, { id: '2', label: 'Wed' },
  { id: '3', label: 'Thu' }, { id: '4', label: 'Fri' }, { id: '5', label: 'Sat' }, { id: '6', label: 'Sun' },
]

function UserMultiSelect({ users, selected, onChange }) {
  const [open, setOpen] = useState(false)

  const toggle = (id) => {
    const sid = String(id)
    const next = selected.includes(sid) ? selected.filter(x => x !== sid) : [...selected, sid]
    onChange(next)
  }

  const label = selected.length === 0
    ? 'All users'
    : selected.length === 1
      ? users.find(u => String(u.id) === selected[0])?.email || '1 user'
      : `${selected.length} users selected`

  return (
    <div style={{ position: 'relative' }}>
      {/* Trigger */}
      <button type="button" onClick={() => setOpen(o => !o)} style={{
        width: '100%', padding: '8px 12px', borderRadius: 10, fontSize: 13,
        background: T.card, border: `1px solid ${open ? T.accent : T.border}`,
        color: selected.length === 0 ? T.t3 : T.t1,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        outline: 'none', textAlign: 'left',
      }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, marginLeft: 6, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }}>
          <path d="M2 4l4 4 4-4" stroke={T.t3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 10, overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        }}>
          {/* All users option */}
          <button type="button" onClick={() => { onChange([]); setOpen(false) }} style={{
            width: '100%', padding: '8px 12px', fontSize: 12, fontWeight: 600,
            background: selected.length === 0 ? `${T.accent}15` : 'transparent',
            color: selected.length === 0 ? T.accent : T.t2,
            border: 'none', borderBottom: `1px solid ${T.border}`,
            cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{
              width: 16, height: 16, borderRadius: 4, flexShrink: 0,
              background: selected.length === 0 ? T.accent : 'transparent',
              border: `1.5px solid ${selected.length === 0 ? T.accent : T.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {selected.length === 0 && (
                <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
              )}
            </div>
            All users <span style={{ fontSize: 10, color: T.t3, marginLeft: 'auto' }}>default</span>
          </button>

          {/* User list */}
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            {users.map(u => {
              const checked = selected.includes(String(u.id))
              return (
                <button type="button" key={u.id} onClick={() => toggle(u.id)} style={{
                  width: '100%', padding: '8px 12px', fontSize: 12,
                  background: checked ? `${T.accent}10` : 'transparent',
                  color: T.t1, border: 'none', borderBottom: `1px solid ${T.border}`,
                  cursor: 'pointer', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
                  onMouseEnter={e => { if (!checked) e.currentTarget.style.background = `${T.t1}05` }}
                  onMouseLeave={e => { if (!checked) e.currentTarget.style.background = 'transparent' }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                    background: checked ? T.accent : 'transparent',
                    border: `1.5px solid ${checked ? T.accent : T.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all .1s',
                  }}>
                    {checked && (
                      <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.t1, fontSize: 12 }}>{u.email}</div>
                  </div>
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 99, flexShrink: 0,
                    background: u.role === 'admin' ? `${T.accent}15` : T.card,
                    color: u.role === 'admin' ? T.accent : T.t3,
                    border: `1px solid ${u.role === 'admin' ? `${T.accent}30` : T.border}`,
                  }}>{u.role}</span>
                </button>
              )
            })}
          </div>

          {/* Footer */}
          {selected.length > 0 && (
            <div style={{ padding: '6px 12px', borderTop: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: T.t3 }}>{selected.length} selected</span>
              <button type="button" onClick={() => onChange([])} style={{ fontSize: 11, color: T.accent, background: 'none', border: 'none', cursor: 'pointer' }}>
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const DEFAULT_FORM = {
  name: '', description: '', policy_type: 'rate_limit',
  server_id: '', user_ids: [], role: '', action: 'block', is_enabled: true,
  calls: 100, window_seconds: 3600, tools: '',
  days: '0,1,2,3,4', start: '09:00', end: '18:00', timezone: 'UTC',
  webhook_url: '', webhook_timeout: 5,
}

const inputSt = {
  width: '100%', padding: '8px 12px', borderRadius: 10, fontSize: 13,
  background: T.card, border: `1px solid ${T.border}`,
  color: T.t1, outline: 'none',
}

const labelSt = {
  display: 'block', fontSize: 11, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.05em',
  color: T.t3, marginBottom: 4,
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

function Badge({ color, icon: Icon, children }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
      background: `${color}18`, color, border: `1px solid ${color}35`,
    }}>
      {Icon && <Icon size={10} />} {children}
    </span>
  )
}

function ScopePill({ icon: Icon, children }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 10, padding: '1px 7px', borderRadius: 99,
      background: T.card, color: T.t3, border: `1px solid ${T.border}`,
    }}>
      {Icon && <Icon size={9} />} {children}
    </span>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ background: T.card, borderRadius: 12, padding: '12px 16px', border: `1px solid ${T.border}` }}>
      <p style={{ fontSize: 11, color: T.t3, marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 500, color: color || T.t1 }}>{value}</p>
    </div>
  )
}

export function Policies() {
  const [policies, setPolicies] = useState([])
  const [servers, setServers] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editPolicy, setEditPolicy] = useState(null)
  const [form, setForm] = useState(DEFAULT_FORM)
  const [serverTools, setServerTools] = useState([])

  const load = useCallback(() =>
    Promise.all([
      api.get('/policies'),
      api.get('/servers'),
      api.get('/users').catch(() => ({ data: [] })),
    ]).then(([p, s, u]) => {
      setPolicies(p.data); setServers(s.data); setUsers(u.data)
    }).finally(() => setLoading(false))
  , [])

  useEffect(() => { load() }, [load])

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const loadServerTools = (serverId) => {
    if (!serverId) { setServerTools([]); return }
    const server = servers.find(s => s.id === parseInt(serverId))
    setServerTools(server?.tools || [])
  }

  const buildConfig = () => {
    if (form.policy_type === 'rate_limit')
      return { calls: parseInt(form.calls), window_seconds: parseInt(form.window_seconds) }
    if (form.policy_type === 'tool_block' || form.policy_type === 'tool_allow')
      return { tools: form.tools.split(',').map(t => t.trim()).filter(Boolean) }
    if (form.policy_type === 'time_restrict')
      return { days: form.days.split(',').map(d => parseInt(d.trim())), start: form.start, end: form.end, timezone: form.timezone }
    if (form.policy_type === 'webhook')
      return { url: form.webhook_url.trim(), timeout_seconds: parseInt(form.webhook_timeout) || 5 }
    return {}
  }

  const submit = async () => {
    if (!form.name.trim()) return alert('Name is required')
    if (!form.server_id) return alert('Please select a server')
    if (form.policy_type === 'webhook' && !form.webhook_url.trim()) return alert('Webhook URL is required')
    const payload = {
      name: form.name, description: form.description || null,
      policy_type: form.policy_type, server_id: parseInt(form.server_id),
      user_id: form.user_ids.length === 1 ? parseInt(form.user_ids[0]) : null,
      user_ids: form.user_ids.map(Number),
      role: form.role || null, action: form.action,
      is_enabled: form.is_enabled, config: buildConfig(),
    }
    try {
      if (editPolicy) await api.patch(`/policies/${editPolicy.id}`, payload)
      else await api.post('/policies', payload)
      setShowForm(false); setEditPolicy(null); setForm(DEFAULT_FORM); load()
    } catch (e) { alert(e.response?.data?.detail || 'Failed to save policy') }
  }

  const toggle = async (id) => { await api.patch(`/policies/${id}/toggle`); load() }
  const remove = async (id) => { if (!confirm('Delete this policy?')) return; await api.delete(`/policies/${id}`); load() }

  const startEdit = (p) => {
    setEditPolicy(p)
    const cfg = p.config || {}
    setForm({
      name: p.name, description: p.description || '',
      policy_type: p.policy_type, server_id: p.server_id || '',
      user_ids: p.user_id ? [String(p.user_id)] : [],
      role: p.role || '', action: p.action, is_enabled: p.is_enabled,
      calls: cfg.calls || 100, window_seconds: cfg.window_seconds || 3600,
      tools: (cfg.tools || []).join(', '),
      days: (cfg.days || [0,1,2,3,4]).join(','),
      start: cfg.start || '09:00', end: cfg.end || '18:00', timezone: cfg.timezone || 'UTC',
      webhook_url: cfg.url || '', webhook_timeout: cfg.timeout_seconds || 5,
    })
    loadServerTools(p.server_id)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const toggleDay = (id) => {
    const days = form.days.split(',').map(d => d.trim()).filter(Boolean)
    const next = days.includes(id) ? days.filter(d => d !== id) : [...days, id]
    setForm(f => ({ ...f, days: next.sort().join(',') }))
  }

  const toggleTool = (tool) => {
    const cur = form.tools.split(',').map(t => t.trim()).filter(Boolean)
    const next = cur.includes(tool) ? cur.filter(t => t !== tool) : [...cur, tool]
    setForm(f => ({ ...f, tools: next.join(', ') }))
  }

  const summarize = (p) => {
    const cfg = p.config || {}
    if (p.policy_type === 'rate_limit') {
      const w = cfg.window_seconds >= 3600 ? `${cfg.window_seconds/3600}h` : `${cfg.window_seconds}s`
      return `${cfg.calls} calls per ${w}`
    }
    if (p.policy_type === 'tool_block') return `Blocks: ${(cfg.tools||[]).join(', ') || '—'}`
    if (p.policy_type === 'tool_allow') return `Allows only: ${(cfg.tools||[]).join(', ') || '—'}`
    if (p.policy_type === 'time_restrict') return `${cfg.start}–${cfg.end} ${cfg.timezone}`
    if (p.policy_type === 'webhook') return cfg.url || '—'
    return ''
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner size={24} /></div>

  const selectedToolList = form.tools.split(',').map(t => t.trim()).filter(Boolean)
  const isBlock = form.policy_type === 'tool_block'
  const typeColor = TYPE_CONFIG[form.policy_type]?.color || T.accent

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Policies"
        description="Control how users access MCP tools — rate limits, tool blocks, and time restrictions"
        action={
          <Btn variant="primary" size="sm" icon={Plus} onClick={() => {
            setForm(DEFAULT_FORM); setEditPolicy(null); setShowForm(s => !s)
          }}>
            New policy
          </Btn>
        }
      />

      {/* ── Form ─────────────────────────────────────────────────────────── */}
      {showForm && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: '1.25rem' }}
          className="space-y-4">
          <div className="flex items-center gap-2">
            <ShieldPlus size={16} style={{ color: T.accent }} />
            <p style={{ fontSize: 14, fontWeight: 600, color: T.t1 }}>
              {editPolicy ? 'Edit policy' : 'Create policy'}
            </p>
          </div>

          {/* Type selector */}
          <div>
            <label style={labelSt}>Policy type <FormHelp text="Choose what this policy should control: rate limits, tools, access times, or a webhook." /></label>
            <div className="grid grid-cols-4 gap-2">
              {Object.keys(TYPE_CONFIG).map(type => (
                <TypeButton key={type} type={type} active={form.policy_type === type}
                  onClick={() => setForm(f => ({ ...f, policy_type: type }))} />
              ))}
            </div>
          </div>

          {/* Name + server */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelSt}>Policy name * <FormHelp text="Give the policy a short, recognizable name, such as Max 100 calls/hour." /></label>
              <input style={inputSt} value={form.name} onChange={set('name')} placeholder="e.g. Max 100 calls/hour" />
            </div>
            <div>
              <label style={labelSt}>Server * <FormHelp text="Select the MCP server to which this policy applies." /></label>
              <select style={inputSt} value={form.server_id} onChange={e => {
                loadServerTools(e.target.value)
                setForm(f => ({ ...f, server_id: e.target.value, tools: '' }))
              }}>
                <option value="" disabled>— Select a server —</option>
                {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          {/* Scope */}
          <div className={`grid ${form.policy_type === 'webhook' ? 'grid-cols-2' : 'grid-cols-3'} gap-3`}>
            <div>
              <label style={labelSt}>Apply to users <FormHelp text="Leave empty to apply this policy to every user, or choose specific users." /></label>
              <UserMultiSelect
                users={users}
                selected={form.user_ids}
                onChange={ids => setForm(f => ({ ...f, user_ids: ids }))}
              />
            </div>
            <div>
              <label style={labelSt}>Apply to role <FormHelp text="Optionally limit the policy to members or admins." /></label>
              <select style={inputSt} value={form.role} onChange={set('role')}>
                <option value="">All roles</option>
                <option value="member">Members only</option>
                <option value="admin">Admins only</option>
              </select>
            </div>
            {form.policy_type !== 'webhook' && (
              <div>
                <label style={labelSt}>Action when violated <FormHelp text="Choose whether to block the request, allow it with a warning, or only record it." /></label>
                <select style={inputSt} value={form.action} onChange={set('action')}>
                  <option value="block">Block — return 403</option>
                  <option value="warn">Warn — allow + log</option>
                  <option value="log">Log only</option>
                </select>
              </div>
            )}
          </div>

          {/* Rate limit */}
          {form.policy_type === 'rate_limit' && (
            <div style={{ background: `${T.warn}10`, border: `1px solid ${T.warn}30`, borderRadius: 12, padding: '1rem' }}
              className="grid grid-cols-2 gap-3">
              <div>
                <label style={labelSt}>Max calls <FormHelp text="Maximum number of calls allowed during the selected time window." /></label>
                <input style={inputSt} type="number" value={form.calls} onChange={set('calls')} />
              </div>
              <div>
                <label style={labelSt}>Time window <FormHelp text="The period over which calls are counted for this rate limit." /></label>
                <select style={inputSt} value={form.window_seconds} onChange={set('window_seconds')}>
                  <option value="60">1 minute</option>
                  <option value="600">10 minutes</option>
                  <option value="3600">1 hour</option>
                  <option value="86400">1 day</option>
                </select>
              </div>
            </div>
          )}

          {/* Tool block / allow */}
          {(form.policy_type === 'tool_block' || form.policy_type === 'tool_allow') && (
            <div style={{
              background: `${typeColor}10`, border: `1px solid ${typeColor}30`,
              borderRadius: 12, padding: '1rem',
            }}>
              <p style={{ fontSize: 12, color: T.t3, marginBottom: 8 }}>
                {isBlock ? 'Select tools to block' : 'Select tools to allow (all others will be blocked)'}
              </p>
              {!form.server_id ? (
                <p style={{ fontSize: 12, color: T.t3, fontStyle: 'italic' }}>Select a server above to see its available tools</p>
              ) : serverTools.length > 0 ? (
                <div className="grid grid-cols-2 gap-1.5" style={{ maxHeight: 160, overflowY: 'auto' }}>
                  {serverTools.map(tool => {
                    const checked = selectedToolList.includes(tool)
                    return (
                      <label key={tool} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
                        fontSize: 12, fontFamily: "'IBM Plex Mono', monospace",
                        background: checked ? `${typeColor}20` : T.card,
                        border: `1px solid ${checked ? typeColor : T.border}`,
                        color: checked ? typeColor : T.t2,
                        transition: 'all .1s',
                      }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleTool(tool)}
                          style={{ accentColor: typeColor }} />
                        {tool}
                      </label>
                    )
                  })}
                </div>
              ) : (
                <>
                  <p style={{ fontSize: 11, color: T.t3, marginBottom: 8 }}>No tools discovered yet — test the server connection first.</p>
                  <input style={inputSt} value={form.tools} onChange={set('tools')} placeholder="tool_name_1, tool_name_2" />
                </>
              )}
              {form.tools && (
                <p style={{ fontSize: 11, color: T.t3, marginTop: 8 }}>Selected: {selectedToolList.join(', ')}</p>
              )}
            </div>
          )}

          {/* Time restrict */}
          {form.policy_type === 'time_restrict' && (
            <div style={{ background: `${T.accent}10`, border: `1px solid ${T.accent}30`, borderRadius: 12, padding: '1rem' }}
              className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label style={labelSt}>Start time <FormHelp text="The local time when requests should start being allowed." /></label>
                  <input style={inputSt} type="time" value={form.start} onChange={set('start')} />
                </div>
                <div>
                  <label style={labelSt}>End time <FormHelp text="The local time after which requests should be restricted." /></label>
                  <input style={inputSt} type="time" value={form.end} onChange={set('end')} />
                </div>
                <div>
                  <label style={labelSt}>Timezone <FormHelp text="Use an IANA timezone such as UTC or America/New_York." /></label>
                  <input style={inputSt} value={form.timezone} onChange={set('timezone')} placeholder="UTC" />
                </div>
              </div>
              <div>
                <label style={{ ...labelSt, marginBottom: 8 }}>Allowed days <FormHelp text="Select the days on which this time restriction applies." /></label>
                <div className="flex gap-1.5 flex-wrap">
                  {DAYS.map(d => {
                    const on = form.days.split(',').map(x => x.trim()).includes(d.id)
                    return (
                      <button key={d.id} type="button" onClick={() => toggleDay(d.id)} style={{
                        padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                        cursor: 'pointer', transition: 'all .1s',
                        background: on ? T.accent : T.card,
                        border: `1px solid ${on ? T.accent : T.border}`,
                        color: on ? T.onAccent : T.t3,
                      }}>
                        {d.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Webhook */}
          {form.policy_type === 'webhook' && (
            <div style={{ background: `${T.accent}10`, border: `1px solid ${T.accent}30`, borderRadius: 12, padding: '1rem' }}
              className="space-y-3">
                <p style={{ fontSize: 12, color: T.t3 }}>
                  Called with <code>{'{server_id, user_id, tool_name, request}'}</code> before the call reaches the
                  server. Must respond <code>{'{allowed, reason?, mutated_request?}'}</code> — anything else,
                  including a timeout or non-2xx, blocks the call.
                </p>
                <p style={{ fontSize: 11, color: T.t3 }}>
                  Need the request and response format?{' '}
                  <a href="https://mcplama.com/docs.html#access-policies" target="_blank" rel="noreferrer" style={{ color: T.accent, textDecoration: 'underline' }}>
                    Visit the webhook documentation ↗
                  </a>
                </p>
              <div>
                <label style={labelSt}>Webhook URL <FormHelp text="HTTPS endpoint that receives the policy request and returns an allow or deny decision." /></label>
                <input style={inputSt} value={form.webhook_url} onChange={set('webhook_url')} placeholder="https://example.com/mcp-policy-hook" />
              </div>
              <div>
                <label style={labelSt}>Timeout (seconds) <FormHelp text="Maximum time to wait for the webhook before treating the request as blocked." /></label>
                <input style={inputSt} type="number" min="1" max="30" value={form.webhook_timeout} onChange={set('webhook_timeout')} />
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <label style={labelSt}>Description <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: T.t3 }}>(optional)</span> <FormHelp text="Briefly describe what this policy protects or limits." /></label>
            <input style={inputSt} value={form.description} onChange={set('description')} placeholder="What does this policy do?" />
          </div>

          <div className="flex gap-2 pt-3" style={{ borderTop: `1px solid ${T.border}` }}>
            <Btn variant="primary" size="sm" icon={editPolicy ? null : Plus} onClick={submit}>
              {editPolicy ? 'Save changes' : 'Create policy'}
            </Btn>
            <Btn variant="secondary" size="sm" onClick={() => { setShowForm(false); setEditPolicy(null) }}>Cancel</Btn>
          </div>
        </div>
      )}

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total policies" value={policies.length} />
        <StatCard label="Active" value={policies.filter(p => p.is_enabled).length} color={T.ok} />
        <StatCard label="Servers covered" value={new Set(policies.map(p => p.server_id).filter(Boolean)).size} />
        <StatCard label="Types in use" value={new Set(policies.map(p => p.policy_type)).size} />
      </div>

      {/* ── Policy list ───────────────────────────────────────────────────── */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, overflow: 'hidden' }}>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: `1px solid ${T.border}` }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: T.t1 }}>Active rules</p>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
            background: T.card, color: T.t3, border: `1px solid ${T.border}`,
          }}>
            {policies.length} rule{policies.length !== 1 ? 's' : ''}
          </span>
        </div>

        {policies.length === 0 ? (
          <EmptyState icon={Shield} title="No policies yet"
            description="Create a policy to control rate limits, block tools, or restrict access by time." />
        ) : (
          <div>
            {policies.map(p => {
              const tc = TYPE_CONFIG[p.policy_type]
              const Icon = tc.icon
              const serverName = servers.find(s => s.id === p.server_id)?.name
              const userName = users.find(u => u.id === p.user_id)?.email

              return (
                <div key={p.id} className="flex items-center gap-3 group transition-colors"
                  style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}` }}
                  onMouseEnter={e => e.currentTarget.style.background = `${T.t1}05`}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>

                  <div style={{ width: 3, height: 36, borderRadius: 2, flexShrink: 0, background: p.is_enabled ? tc.color : T.border }} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.t1 }}>{p.name}</span>
                      <Badge color={tc.color} icon={Icon}>{tc.label}</Badge>
                      {!p.is_enabled && (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: T.card, color: T.t3, border: `1px solid ${T.border}` }}>
                          disabled
                        </span>
                      )}
                      {p.action !== 'block' && (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: `${T.warn}15`, color: T.warn, border: `1px solid ${T.warn}30` }}>
                          {p.action}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span style={{ fontSize: 11, color: T.t3 }}>{summarize(p)}</span>
                      <span style={{ color: T.border, fontSize: 11 }}>·</span>
                      <ScopePill icon={Server}>{serverName || 'All servers'}</ScopePill>
                      <ScopePill icon={Users}>{userName ? `User: ${userName}` : p.role ? `Role: ${p.role}` : 'All users'}</ScopePill>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEdit(p)} style={{
                      width: 28, height: 28, borderRadius: 8,
                      border: `1px solid ${T.border}`, background: 'none',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: T.t3,
                    }}
                      onMouseEnter={e => { e.currentTarget.style.color = T.t1; e.currentTarget.style.borderColor = T.border2 }}
                      onMouseLeave={e => { e.currentTarget.style.color = T.t3; e.currentTarget.style.borderColor = T.border }}>
                      <Pencil size={13} />
                    </button>
                    <Toggle enabled={p.is_enabled} onChange={() => toggle(p.id)} />
                    <button onClick={() => remove(p.id)} style={{
                      width: 28, height: 28, borderRadius: 8,
                      border: `1px solid ${T.border}`, background: 'none',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: T.t3,
                    }}
                      onMouseEnter={e => { e.currentTarget.style.color = T.danger; e.currentTarget.style.borderColor = T.danger; e.currentTarget.style.background = `${T.danger}10` }}
                      onMouseLeave={e => { e.currentTarget.style.color = T.t3; e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = 'none' }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useEffect, useCallback, useRef } from 'react'
import { LogOut, Copy, Check, CheckCircle, Zap, ChevronRight, Terminal, Code2, Bot, Cpu, Puzzle, SquareTerminal, RefreshCw, Lock, Unlock, AlertCircle, ExternalLink, KeyRound, X } from 'lucide-react'
import api from '../lib/api'
import { copyText } from '../lib/clipboard'
import { useAuth } from '../hooks/useAuth'


// ── Client config templates ──────────────────────────────────────────────────
const CLIENTS = [
  {
    id: 'vscode',
    name: 'VS Code',
    icon: <Code2 size={14} />,
    color: '#0180FF',
    description: 'settings.json or .vscode/mcp.json',
    getConfig: (slug, url) => JSON.stringify({ "servers": { [slug]: { "url": url } } }, null, 2),
    // VS Code's documented mcp/install deep link — installs the server without
    // the user having to open settings.json themselves.
    quickInstall: (slug, url) => `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: slug, type: 'http', url }))}`,
    instructions: 'Open Command Palette → "MCP: Add Server" → paste URL, or add to settings.json',
  },
  {
    id: 'claude',
    name: 'Claude Desktop',
    icon: <Bot size={14} />,
    color: '#CC785C',
    description: 'claude_desktop_config.json',
    getConfig: (slug, url) => JSON.stringify({ "mcpServers": { [slug]: { "url": url } } }, null, 2),
    instructions: 'Open Claude → Settings → Developer → Edit Config → paste and save',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    icon: <SquareTerminal size={14} />,
    color: '#D97757',
    description: 'CLI — claude mcp add',
    getConfig: (slug, url) => `claude mcp add --transport http ${slug} ${url}`,
    instructions: 'Run this in your terminal, or use "/mcp" inside Claude Code to add it interactively.',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    icon: <Terminal size={14} />,
    color: '#9B8AFF',
    description: '.cursor/mcp.json',
    getConfig: (slug, url) => JSON.stringify({ "mcpServers": { [slug]: { "url": url } } }, null, 2),
    // Cursor's documented anysphere.cursor-deeplink install scheme.
    quickInstall: (slug, url) => `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(slug)}&config=${btoa(JSON.stringify({ url }))}`,
    instructions: 'Settings → MCP → Add new global MCP server → paste URL',
  },
  {
    id: 'continue',
    name: 'Continue',
    icon: <Cpu size={14} />,
    // Literal hex (matching --ok) rather than var(--ok): used below as
    // `${c.color}20` string concatenation for a translucent tab background,
    // which only produces valid CSS for a literal hex value.
    color: '#32d583',
    description: 'config.json',
    getConfig: (slug, url) => JSON.stringify({ "experimental": { "modelContextProtocolServers": [{ "transport": { "type": "sse", "url": url } }] } }, null, 2),
    instructions: 'Open ~/.continue/config.json → add to modelContextProtocolServers array',
  },
  {
    id: 'cline',
    name: 'Cline / Roo',
    icon: <Puzzle size={14} />,
    // Literal hex (matching --warn) — see note on the Continue entry above.
    color: '#fdb022',
    description: 'VS Code extension settings',
    getConfig: (slug, url) => JSON.stringify({ "mcpServers": { [slug]: { "url": url } } }, null, 2),
    instructions: 'Open Cline extension → MCP Servers → Add Server → paste URL',
  },
]

// ── Pill badge ───────────────────────────────────────────────────────────────
function Badge({ color, bg, border, children }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
      padding: '3px 9px', borderRadius: 20, color, background: bg, border: `1px solid ${border}`,
      letterSpacing: '0.01em', whiteSpace: 'nowrap', flexShrink: 0
    }}>
      {children}
    </span>
  )
}

// ── Server icon emoji map ────────────────────────────────────────────────────
function ServerIcon({ icon, logo_url, size = 36 }) {
  const map = {
    notion: '📝', github: '🐙', slack: '💬', stripe: '💳',
    'hard-drive': '💾', google: '🔍', linear: '🔷', jira: '🟦',
    figma: '🎨', postgres: '🐘', mysql: '🐬', redis: '🔴',
    default: '⚡'
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.28,
      overflow: 'hidden', background: 'rgba(117,146,255,0.1)',
      border: '1px solid rgba(117,146,255,0.2)', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      {logo_url
        ? <img src={logo_url} alt={icon}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ fontSize: size * 0.45 }}>{map[icon] || map.default}</span>
      }
    </div>
  )
}

function ServerTile({ server, connection, requestStatus, onClick }) {
  const state = connection
    ? { label: 'Connected', color: 'var(--ok)', bg: 'rgba(50,213,131,0.10)', border: 'rgba(50,213,131,0.25)' }
    : requestStatus === 'pending'
      ? { label: 'Pending', color: 'var(--warn)', bg: 'rgba(253,176,34,0.10)', border: 'rgba(253,176,34,0.25)' }
      : requestStatus === 'approved' || server.auth_mode === 'shared' || server.auth_mode === 'none'
        ? { label: 'Ready', color: 'var(--accent)', bg: 'rgba(117,146,255,0.12)', border: 'rgba(117,146,255,0.25)' }
        : { label: 'Request access', color: 'var(--t3)', bg: 'rgba(74,74,88,0.15)', border: 'rgba(74,74,88,0.3)' }

  return (
    <button type="button" className="portal-app-tile" onClick={onClick} style={{
      width: '100%', minWidth: 0, minHeight: 176, padding: 20, textAlign: 'left', cursor: 'pointer',
      background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16,
      display: 'flex', flexDirection: 'column', gap: 14,
      transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, minWidth: 0 }}>
        <ServerIcon icon={server.icon} logo_url={server.logo_url} size={44} />
        <Badge color={state.color} bg={state.bg} border={state.border}>{state.label}</Badge>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: 'var(--t1)', fontSize: 15, fontWeight: 750, lineHeight: 1.35, overflowWrap: 'anywhere' }}>
          {server.name}
        </div>
        <div style={{ color: 'var(--t3)', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 4 }}>
          {server.category || 'MCP server'}
        </div>
      </div>
      <div style={{
        color: 'var(--t2)', fontSize: 12, lineHeight: 1.55, overflow: 'hidden', overflowWrap: 'anywhere',
        display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
      }}>
        {server.description || 'Open this app to view details and connection options.'}
      </div>
      <div style={{ marginTop: 'auto', color: 'var(--accent)', fontSize: 12, fontWeight: 700 }}>
        View details <span aria-hidden="true">→</span>
      </div>
    </button>
  )
}


// ── Copy button ──────────────────────────────────────────────────────────────
function CopyButton({ text, label = 'Copy', small = false }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await copyText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Copy failed', err)
    }
  }
  return (
    <button onClick={copy} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: small ? 11 : 12, fontWeight: 600, padding: small ? '4px 10px' : '6px 14px',
      borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s',
      background: copied ? 'rgba(50,213,131,0.10)' : 'rgba(117,146,255,0.12)',
      color: copied ? 'var(--ok)' : 'var(--accent)',
      border: `1px solid ${copied ? 'rgba(50,213,131,0.25)' : 'rgba(117,146,255,0.25)'}`,
    }}>
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copied!' : label}
    </button>
  )
}

// ── Server card ──────────────────────────────────────────────────────────────
// ── Update credentials (shown on connected per_user cards) ───────────────────
function UpdateCredsSection({ serverId, schema, onSaved }) {
  const [open, setOpen] = useState(false)
  const [creds, setCreds] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await api.post(`/servers/${serverId}/credentials`, creds)
      setSaved(true)
      onSaved()
      setTimeout(() => { setSaved(false); setOpen(false); setCreds({}) }, 1800)
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to save credentials')
    } finally { setSaving(false) }
  }

  return (
    <div style={{ borderRadius: 11, border: `1px solid ${'var(--border)'}`, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', padding: '10px 14px', background: 'var(--bg)', border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer'
        }}>
        <span style={{ color: 'var(--t2)', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
          <KeyRound size={12} style={{ color: 'var(--t3)' }} />
          Update credentials
        </span>
        <span style={{ color: 'var(--t3)', fontSize: 11, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
      </button>
      {open && (
        <div style={{
          padding: '14px', borderTop: `1px solid ${'var(--border)'}`, background: 'var(--card)',
          display: 'flex', flexDirection: 'column', gap: 12
        }}>
          {schema.map(field => (
            <div key={field.key}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                <label style={{ color: 'var(--t2)', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  {field.label}
                </label>
                {field.url && (
                  <a href={field.url} target="_blank" rel="noreferrer"
                    style={{
                      color: 'var(--accent)', fontSize: 11, fontWeight: 600, textDecoration: 'none',
                      display: 'flex', alignItems: 'center', gap: 4
                    }}>
                    Get key <ExternalLink size={9} />
                  </a>
                )}
              </div>
              <input
                type={field.type === 'secret' ? 'password' : 'text'}
                value={creds[field.key] || ''}
                onChange={e => setCreds(c => ({ ...c, [field.key]: e.target.value }))}
                placeholder={field.placeholder || `New ${field.label.toLowerCase()}…`}
                style={{
                  width: '100%', padding: '9px 11px', borderRadius: 8, fontSize: 12,
                  background: 'var(--bg)', border: `1px solid ${creds[field.key] ? 'rgba(117,146,255,0.25)' : 'var(--border)'}`,
                  color: 'var(--t1)', outline: 'none', boxSizing: 'border-box',
                  fontFamily: field.type === 'secret' ? 'monospace' : 'inherit'
                }}
                onFocus={e => e.target.style.borderColor = 'rgba(117,146,255,0.25)'}
                onBlur={e => e.target.style.borderColor = creds[field.key] ? 'rgba(117,146,255,0.25)' : 'var(--border)'}
              />
            </div>
          ))}
          <button onClick={save} disabled={saving || schema.some(f => !creds[f.key])}
            style={{
              padding: '9px', borderRadius: 9, fontSize: 12, fontWeight: 700,
              background: saved ? 'rgba(50,213,131,0.10)' : 'rgba(117,146,255,0.12)',
              color: saved ? 'var(--ok)' : 'var(--accent)',
              border: `1px solid ${saved ? 'rgba(50,213,131,0.25)' : 'rgba(117,146,255,0.25)'}`,
              cursor: (saving || schema.some(f => !creds[f.key])) ? 'not-allowed' : 'pointer',
              opacity: (saving || schema.some(f => !creds[f.key])) ? 0.5 : 1,
              transition: 'all 0.15s'
            }}>
            {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Update credentials'}
          </button>
        </div>
      )}
    </div>
  )
}

function ServerCard({ server, connection, onConnect, requestStatus, isRequesting, onRequest, hasOauthToken, onOauthRefresh }) {
  const [creds, setCreds] = useState({})
  const [savingCreds, setSavingCreds] = useState(false)
  const [credsSaved, setCredsSaved] = useState(false)
  const [credsChecked, setCredsChecked] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [activeClient, setActiveClient] = useState('vscode')
  const [expanded, setExpanded] = useState(false)
  const [authorizing, setAuthorizing] = useState(false)

  const schema = server.user_config_schema || []
  const hasConnection = !!connection
  const isPerUser = server.auth_mode === 'per_user'
  const isShared = server.auth_mode === 'shared' || server.auth_mode === 'none'
  const connUrl = connection?.mcp_url
  // Show cred form when per_user + schema exists + creds not yet saved.
  // Shown even when hasConnection so users can update credentials.
  const needsCreds = isPerUser && schema.length > 0 && !credsSaved
  // Gate rendering until status check completes (avoids flash-then-hide)
  const credsReady = isShared || schema.length === 0 || credsChecked

  // Check existing credentials on mount
  useEffect(() => {
    if (isShared || schema.length === 0) { setCredsChecked(true); return }
    api.get(`/servers/${server.id}/credentials/status`)
      .then(r => { if (r.data.has_credentials) setCredsSaved(true) })
      .catch(() => { })
      .finally(() => setCredsChecked(true))
  }, [server.id, isShared, schema.length])

  const saveCreds = async () => {
    setSavingCreds(true)
    try {
      await api.post(`/servers/${server.id}/credentials`, creds)
      setCredsSaved(true)
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to save credentials')
    } finally { setSavingCreds(false) }
  }

  const connect = async () => {
    setConnecting(true)
    try {
      const { data } = await api.post('/connections', { server_id: server.id, label: server.name })
      onConnect(data)
    } catch (e) {
      alert(e.response?.data?.detail || 'Connection failed')
    } finally { setConnecting(false) }
  }

  const test = async () => {
    setTesting(true); setTestResult(null)
    try {
      const { data } = await api.post(`/servers/${server.id}/test`)
      setTestResult({ ok: true, tools: data.tools || [], latency: data.latency_ms })
    } catch (e) {
      setTestResult({ ok: false, error: e.response?.data?.detail || 'Connection failed' })
    } finally { setTesting(false) }
  }

  // ── OAuth authorize: popup + poll ────────────────────────────────────────
  // Previously a plain link that navigated the whole portal tab away; the
  // provider's redirect back to /oauth/callback closed the loop, but it lost
  // the user's page/search state and gave no feedback beyond a full reload.
  // A popup keeps this tab alive so we can poll token-status and update in
  // place once authorization completes.
  const oauthPollRef = useRef(null)
  useEffect(() => () => { if (oauthPollRef.current) clearInterval(oauthPollRef.current) }, [])

  const authorizeUrl = `/api/v1/oauth/${server.id}/${server.runtime === 'remote' ? 'mcp-authorize' : 'authorize'}`

  const startAuthorize = () => {
    const popup = window.open(authorizeUrl, 'mcplama_oauth', 'width=520,height=700')
    if (!popup) {
      // Popup blocked — fall back to the old same-tab behavior.
      window.location.href = authorizeUrl
      return
    }
    setAuthorizing(true)
    const endpoint = server.runtime === 'remote' ? 'mcp-token-status' : 'token-status'
    const startedAt = Date.now()
    oauthPollRef.current = setInterval(async () => {
      let popupClosed = false
      try { popupClosed = popup.closed } catch { /* COOP may block cross-window access */ }
      if (popupClosed || Date.now() - startedAt > 5 * 60 * 1000) {
        clearInterval(oauthPollRef.current); oauthPollRef.current = null
        setAuthorizing(false)
        return
      }
      try {
        const { data } = await api.get(`/oauth/${server.id}/${endpoint}`)
        if (data.has_token) {
          clearInterval(oauthPollRef.current); oauthPollRef.current = null
          setAuthorizing(false)
          try { popup.close() } catch { /* ignore */ }
          onOauthRefresh?.()
        }
      } catch { /* transient — keep polling until timeout */ }
    }, 2000)
  }

  const client = CLIENTS.find(c => c.id === activeClient) || CLIENTS[0]

  // ── Status chip in header
  const statusChip = hasConnection
    ? <Badge color={'var(--ok)'} bg={'rgba(50,213,131,0.10)'} border={'rgba(50,213,131,0.25)'}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ok)', display: 'inline-block' }} />
      Connected
    </Badge>
    : requestStatus === 'pending'
      ? <Badge color={'var(--warn)'} bg={'rgba(253,176,34,0.10)'} border={'rgba(253,176,34,0.25)'}>Pending</Badge>
      : requestStatus === 'approved' || isShared
        ? <Badge color={'var(--accent)'} bg={'rgba(117,146,255,0.12)'} border={'rgba(117,146,255,0.25)'}>Ready</Badge>
        : <Badge color={'var(--t3)'} bg="rgba(74,74,88,0.15)" border="rgba(74,74,88,0.3)">Request access</Badge>

  return (
    <div className="portal-server-card" style={{
      background: 'var(--card)', border: `1px solid ${'var(--border)'}`, borderRadius: 16,
      display: 'flex', flexDirection: 'column', transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.2s',
      overflow: 'hidden', minWidth: 0, height: '100%',
      ...(hasConnection ? { borderColor: 'rgba(50,213,131,0.2)' } : {})
    }}>

      {/* ── Card header ── */}
      <div style={{ padding: '18px 20px 12px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <ServerIcon icon={server.icon} logo_url={server.logo_url} />
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--t1)', fontWeight: 700, fontSize: 15, marginBottom: 5, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{server.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--t3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
                {server.category || 'MCP server'}
              </span>
              <span style={{ color: 'var(--t3)', fontSize: 10 }}>· Available to your team</span>
            </div>
          </div>
        </div>
        {statusChip}
      </div>

      {server.description && (
        <div title={server.description} style={{
          margin: '0 20px 16px', color: 'var(--t2)', fontSize: 12, lineHeight: 1.6,
          overflowWrap: 'anywhere', wordBreak: 'break-word',
        }}>
          {server.description}
        </div>
      )}

      {/* ── Card body ── */}
      <div style={{ padding: 20, borderTop: `1px solid ${'var(--border)'}`, flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── REQUEST GATE ── */}
        {/* Gate applies to ALL servers — access must be approved before connecting */}
        {!connection && requestStatus !== 'approved' ? (
          <div>
            {requestStatus === 'pending' ? (
              <div style={{
                padding: '14px 16px', borderRadius: 12, background: 'rgba(253,176,34,0.10)', border: `1px solid ${'rgba(253,176,34,0.25)'}`,
                display: 'flex', gap: 12, alignItems: 'flex-start'
              }}>
                <AlertCircle size={14} style={{ color: 'var(--warn)', marginTop: 1, flexShrink: 0 }} />
                <div>
                  <div style={{ color: 'var(--warn)', fontSize: 13, fontWeight: 600, marginBottom: 3 }}>Access request pending</div>
                  <div style={{ color: 'var(--t2)', fontSize: 12 }}>An admin will review your request shortly.</div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ color: 'var(--t2)', fontSize: 12, lineHeight: 1.6 }}>
                  You need admin approval to connect this server.
                </div>
                <button onClick={onRequest} disabled={isRequesting}
                  style={{
                    padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                    background: 'rgba(117,146,255,0.12)', color: 'var(--accent)', border: `1px solid ${'rgba(117,146,255,0.25)'}`,
                    cursor: isRequesting ? 'not-allowed' : 'pointer', opacity: isRequesting ? 0.6 : 1,
                    transition: 'all 0.15s'
                  }}>
                  {isRequesting ? 'Sending request…' : 'Request access'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* ── OAUTH REQUIRED ── */}
            {server.remote_auth === 'oauth' && !hasOauthToken && (
              <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(253,176,34,0.10)', border: `1px solid ${'rgba(253,176,34,0.25)'}` }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
                  <Lock size={13} style={{ color: 'var(--warn)', marginTop: 1, flexShrink: 0 }} />
                  <div>
                    <div style={{ color: 'var(--warn)', fontSize: 12, fontWeight: 600, marginBottom: 2 }}>Authorization required</div>
                    <div style={{ color: 'var(--t2)', fontSize: 11, lineHeight: 1.5 }}>
                      Sign in with {server.name} before connecting your AI client.
                    </div>
                  </div>
                </div>
                <button onClick={startAuthorize} disabled={authorizing}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
                    borderRadius: 8, fontSize: 12, fontWeight: 700, textDecoration: 'none',
                    background: 'rgba(253,176,34,0.2)', color: 'var(--warn)', border: `1px solid rgba(253,176,34,0.4)`,
                    cursor: authorizing ? 'not-allowed' : 'pointer', opacity: authorizing ? 0.7 : 1
                  }}>
                  <ExternalLink size={11} />
                  {authorizing ? `Waiting for authorization…` : `Authorize with ${server.name}`}
                </button>
              </div>
            )}

            {server.remote_auth === 'oauth' && hasOauthToken && !hasConnection && (
              <div style={{
                padding: '10px 14px', borderRadius: 10, background: 'rgba(50,213,131,0.10)', border: `1px solid ${'rgba(50,213,131,0.25)'}`,
                display: 'flex', alignItems: 'center', gap: 8
              }}>
                <Unlock size={12} style={{ color: 'var(--ok)' }} />
                <span style={{ color: 'var(--ok)', fontSize: 12, fontWeight: 600 }}>Authorized with {server.name} ✓</span>
              </div>
            )}

            {/* ── PER-USER CREDENTIALS ── */}
            {needsCreds && credsReady && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 1, height: 20, background: 'rgba(117,146,255,0.25)' }} />
                  <span style={{ color: 'var(--t2)', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    Your credentials
                  </span>
                </div>

                {schema.map(field => (
                  <div key={field.key}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <label style={{ color: 'var(--t2)', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                        {field.label}
                      </label>
                      {field.url && (
                        <a href={field.url} target="_blank" rel="noreferrer"
                          style={{
                            color: 'var(--accent)', fontSize: 11, fontWeight: 600, textDecoration: 'none',
                            display: 'flex', alignItems: 'center', gap: 4
                          }}>
                          Get API key <ExternalLink size={9} />
                        </a>
                      )}
                    </div>
                    <input
                      type={field.type === 'secret' ? 'password' : 'text'}
                      value={creds[field.key] || ''}
                      onChange={e => setCreds(c => ({ ...c, [field.key]: e.target.value }))}
                      placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}…`}
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 9, fontSize: 13,
                        background: 'var(--bg)', border: `1px solid ${creds[field.key] ? 'rgba(117,146,255,0.25)' : 'var(--border)'}`,
                        color: 'var(--t1)', outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s',
                        fontFamily: field.type === 'secret' ? 'monospace' : 'inherit'
                      }}
                      onFocus={e => e.target.style.borderColor = 'rgba(117,146,255,0.25)'}
                      onBlur={e => e.target.style.borderColor = creds[field.key] ? 'rgba(117,146,255,0.25)' : 'var(--border)'}
                    />
                    {field.description && (
                      <div style={{ color: 'var(--t3)', fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>{field.description}</div>
                    )}
                  </div>
                ))}

                <button
                  onClick={saveCreds}
                  disabled={savingCreds || schema.some(f => !creds[f.key])}
                  style={{
                    padding: '10px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                    background: schema.some(f => !creds[f.key]) ? 'rgba(117,146,255,0.06)' : 'rgba(117,146,255,0.12)',
                    color: schema.some(f => !creds[f.key]) ? 'var(--t3)' : 'var(--accent)',
                    border: `1px solid ${schema.some(f => !creds[f.key]) ? 'var(--border)' : 'rgba(117,146,255,0.25)'}`,
                    cursor: (savingCreds || schema.some(f => !creds[f.key])) ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s'
                  }}>
                  {savingCreds ? 'Saving…' : 'Save & continue →'}
                </button>
              </div>
            )}

            {/* ── SHARED — just connect ── */}
            {isShared && !hasConnection && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ color: 'var(--t2)', fontSize: 12 }}>
                  Pre-configured by your admin — just connect.
                </div>
                <button onClick={connect} disabled={connecting}
                  style={{
                    padding: '11px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                    background: 'var(--accent-grad)',
                    color: '#fff', border: 'none', cursor: connecting ? 'not-allowed' : 'pointer',
                    opacity: connecting ? 0.7 : 1, transition: 'opacity 0.15s'
                  }}>
                  {connecting ? 'Connecting…' : 'Connect server'}
                </button>
              </div>
            )}

            {/* ── CREDS SAVED — test + connect ── */}
            {credsSaved && !hasConnection && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--ok)', fontSize: 12, fontWeight: 600 }}>
                  <CheckCircle size={13} /> Credentials saved
                </div>
                <button onClick={test} disabled={testing}
                  style={{
                    padding: '9px', borderRadius: 9, fontSize: 12, fontWeight: 600, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', gap: 6, cursor: testing ? 'not-allowed' : 'pointer',
                    background: 'rgba(74,74,88,0.15)', color: 'var(--t2)', border: `1px solid ${'var(--border)'}`, transition: 'all 0.15s'
                  }}>
                  <Zap size={12} /> {testing ? 'Testing…' : 'Test connection'}
                </button>
                {testResult && (
                  <div style={{
                    padding: '10px 12px', borderRadius: 9, fontSize: 12, fontWeight: 500,
                    background: testResult.ok ? 'rgba(50,213,131,0.10)' : 'rgba(249,112,102,0.10)',
                    border: `1px solid ${testResult.ok ? 'rgba(50,213,131,0.25)' : 'rgba(249,112,102,0.2)'}`,
                    color: testResult.ok ? 'var(--ok)' : 'var(--danger)', overflowWrap: 'anywhere'
                  }}>
                    {testResult.ok
                      ? `✓ ${testResult.tools.length} tools · ${testResult.latency}ms`
                      : `✕ ${testResult.error}`}
                  </div>
                )}
                <button onClick={connect} disabled={connecting}
                  style={{
                    padding: '11px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                    background: 'var(--accent-grad)',
                    color: '#fff', border: 'none', cursor: connecting ? 'not-allowed' : 'pointer',
                    opacity: connecting ? 0.7 : 1, transition: 'opacity 0.15s'
                  }}>
                  {connecting ? 'Connecting…' : 'Connect server'}
                </button>
              </div>
            )}

            {/* ── UPDATE CREDENTIALS (per_user servers only, shown when already connected) ── */}
            {isPerUser && schema.length > 0 && hasConnection && (
              <UpdateCredsSection
                serverId={server.id}
                schema={schema}
                onSaved={() => setCredsSaved(true)}
              />
            )}

            {/* ── CONNECTED — show URL + client configs ── */}
            {hasConnection && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* URL row */}
                <div style={{ padding: '12px 14px', borderRadius: 11, background: 'var(--bg)', border: `1px solid ${'var(--border)'}` }}>
                  <div style={{
                    color: 'var(--t3)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                    textTransform: 'uppercase', marginBottom: 6
                  }}>Connection URL</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <code style={{
                      flex: 1, fontSize: 11, color: 'var(--t2)', fontFamily: "'IBM Plex Mono', monospace",
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>
                      {connUrl}
                    </code>
                    <CopyButton text={connUrl} small />
                  </div>
                </div>

                {/* Client selector */}
                <div>
                  <div style={{
                    color: 'var(--t3)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                    textTransform: 'uppercase', marginBottom: 8
                  }}>Add to client</div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
                    {CLIENTS.map(c => (
                      <button key={c.id} onClick={() => setActiveClient(c.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px',
                          borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                          background: activeClient === c.id ? `${c.color}20` : 'transparent',
                          color: activeClient === c.id ? c.color : 'var(--t3)',
                          border: `1px solid ${activeClient === c.id ? `${c.color}40` : 'var(--border)'}`
                        }}>
                        {c.icon} {c.name}
                      </button>
                    ))}
                  </div>

                  {client.quickInstall && (
                    <a href={client.quickInstall(server.slug, connUrl)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        padding: '9px', borderRadius: 10, fontSize: 12, fontWeight: 700, textDecoration: 'none',
                        marginBottom: 8, background: `${client.color}20`, color: client.color,
                        border: `1px solid ${client.color}40`
                      }}>
                      <Zap size={12} /> One-click install in {client.name}
                    </a>
                  )}

                  <div style={{ borderRadius: 11, overflow: 'hidden', border: `1px solid ${'var(--border)'}` }}>
                    <div style={{
                      background: 'var(--bg)', padding: '8px 12px', display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between', borderBottom: `1px solid ${'var(--border)'}`
                    }}>
                      <span style={{ color: 'var(--t3)', fontSize: 10, fontWeight: 600, letterSpacing: '0.05em' }}>
                        {client.quickInstall ? `${client.description} (or copy manually)` : client.description}
                      </span>
                      <CopyButton text={client.getConfig(server.slug, connUrl)} small label="Copy config" />
                    </div>
                    <pre style={{
                      margin: 0, padding: '12px 14px', fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace",
                      color: 'var(--t2)', background: 'rgba(0,0,0,0.3)', lineHeight: 1.6, overflowX: 'auto'
                    }}>
                      {client.getConfig(server.slug, connUrl)}
                    </pre>
                    <div style={{ padding: '9px 12px', background: 'var(--bg)', borderTop: `1px solid ${'var(--border)'}` }}>
                      <div style={{ color: 'var(--t3)', fontSize: 11, lineHeight: 1.5 }}>
                        💡 {client.instructions}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Main portal ──────────────────────────────────────────────────────────────
export default function Portal() {
  const { user, logout } = useAuth()
  const [servers, setServers] = useState([])
  const [connections, setConnections] = useState([])
  const [requestMap, setRequestMap] = useState({})
  const [requesting, setRequesting] = useState(null)
  const [loading, setLoading] = useState(true)
  const [oauthStatus, setOauthStatus] = useState({})
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [removingAll, setRemovingAll] = useState(false)
  const [selectedServerId, setSelectedServerId] = useState(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const PAGE_SIZE = 20

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const [s, c, r] = await Promise.all([
        api.get(`/servers?limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
        api.get('/connections?mine=true'),
        api.get('/requests/mine').catch(() => ({ data: [] })),
      ])
      const srvs = (Array.isArray(s.data) ? s.data : []).filter(sv => sv.is_enabled)
      setServers(srvs)
      setTotal(parseInt(s.headers?.['x-total-count'] || srvs.length))
      setConnections(c.data)
      const map = {}
      r.data.forEach(req => { map[req.server_id] = req.status })
      setRequestMap(map)

      const oauthServers = srvs.filter(sv => sv.remote_auth === 'oauth')
      const oauthMap = {}
      await Promise.all(oauthServers.map(async sv => {
        try {
          const endpoint = sv.runtime === 'remote' ? 'mcp-token-status' : 'token-status'
          const res = await api.get(`/oauth/${sv.id}/${endpoint}`)
          oauthMap[sv.id] = res.data.has_token
        } catch { oauthMap[sv.id] = false }
      }))
      setOauthStatus(oauthMap)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [page, search])

  useEffect(() => { load() }, [load, page, search])

  useEffect(() => {
    if (!selectedServerId) return undefined
    const closeOnEscape = event => {
      if (event.key === 'Escape') setSelectedServerId(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [selectedServerId])

  const getConnection = (serverId) => connections.find(c => c.server_id === serverId && c.is_active)
  const handleConnect = (conn) => setConnections(cs => [...cs.filter(c => c.server_id !== conn.server_id), conn])
  const requestAccess = async (serverId) => {
    setRequesting(serverId)
    try {
      await api.post(`/servers/${serverId}/request`)
      setRequestMap(m => ({ ...m, [serverId]: 'pending' }))
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to send request')
    } finally { setRequesting(null) }
  }

  const removeAllConnections = async () => {
    if (!window.confirm('Remove all active connections? Your MCP clients will disconnect.')) return
    setRemovingAll(true)
    try {
      const active = connections.filter(c => c.is_active)
      await Promise.all(active.map(c => api.delete(`/connections/${c.id}`).catch(() => { })))
      setConnections([])
    } finally { setRemovingAll(false) }
  }

  // Backend handles search+pagination — servers already filtered+paged
  const pagedServers = servers
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const connectedCount = connections.filter(c => c.is_active).length
  const selectedServer = servers.find(server => server.id === selectedServerId)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>

      {/* ── Top nav ── */}
      <nav style={{
        borderBottom: `1px solid ${'var(--border)'}`, background: 'var(--surface)',
        position: 'sticky', top: 0, zIndex: 50, backdropFilter: 'blur(12px)'
      }}>
        <div style={{
          maxWidth: 1160, margin: '0 auto', padding: '0 28px', height: 58,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>

            <img src="/icons/mcplama-icon-128.png" alt="McpLama" className="w-[48px] h-[48px]" />

            <div>
              <span style={{ color: 'var(--t1)', fontWeight: 800, fontSize: 15, letterSpacing: '-0.01em' }}>Mcplama</span>
              <span style={{ color: 'var(--t3)', fontSize: 12, marginLeft: 8 }}>Member Portal</span>
            </div>
            {connectedCount > 0 && (
              <Badge color={'var(--ok)'} bg={'rgba(50,213,131,0.10)'} border={'rgba(50,213,131,0.25)'}>
                {connectedCount} active {connectedCount === 1 ? 'connection' : 'connections'}
              </Badge>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button onClick={() => load(true)} disabled={refreshing}
              style={{
                padding: '6px 12px', borderRadius: 8, background: 'transparent',
                color: refreshing ? 'var(--t3)' : 'var(--t2)', border: `1px solid ${'var(--border)'}`, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600
              }}>
              <RefreshCw size={11} style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }} />
              Refresh
            </button>
            <span style={{ color: 'var(--t3)', fontSize: 13 }}>{user?.email}</span>
            <button onClick={logout}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, color: 'var(--t2)', fontSize: 12,
                fontWeight: 600, background: 'transparent', border: `1px solid ${'var(--border)'}`,
                cursor: 'pointer', padding: '6px 12px', borderRadius: 8, transition: 'all 0.15s'
              }}>
              <LogOut size={12} /> Sign out
            </button>
          </div>
        </div>
      </nav>

      {/* ── Page content ── */}
      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '36px 28px' }}>

        {/* ── Page header ── */}
        <div style={{ marginBottom: 36 }}>
          <h1 style={{
            color: 'var(--t1)', fontSize: 26, fontWeight: 800, margin: '0 0 6px',
            letterSpacing: '-0.02em'
          }}>
            Welcome back, {user?.name?.split(' ')[0] || 'there'} 👋
          </h1>
          <p style={{ color: 'var(--t2)', fontSize: 14, margin: 0, lineHeight: 1.6 }}>
            Connect your MCP servers to VS Code, Claude Desktop, Cursor, and more.
            Each server gets a unique connection URL for each client.
          </p>
        </div>

        {/* ── Search + actions bar ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search servers…"
              style={{
                width: '100%', padding: '9px 12px 9px 36px', borderRadius: 10, fontSize: 13,
                background: 'var(--card)', border: `1px solid ${'var(--border)'}`, color: 'var(--t1)', outline: 'none',
                boxSizing: 'border-box'
              }}
              onFocus={e => e.target.style.borderColor = 'rgba(117,146,255,0.25)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
            <svg style={{
              position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--t3)', pointerEvents: 'none'
            }} width="14" height="14" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
          </div>
          {connectedCount > 0 && (
            <button onClick={removeAllConnections} disabled={removingAll}
              style={{
                padding: '9px 14px', borderRadius: 10, fontSize: 12, fontWeight: 600,
                background: 'rgba(249,112,102,0.10)', color: 'var(--danger)',
                border: `1px solid rgba(249,112,102,0.25)`,
                cursor: removingAll ? 'not-allowed' : 'pointer', opacity: removingAll ? 0.6 : 1,
                whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6
              }}>
              {removingAll ? 'Removing…' : `✕ Remove all (${connectedCount})`}
            </button>
          )}
        </div>

        {/* ── Quick-start hint ── */}
        {!loading && servers.length > 0 && connectedCount === 0 && (
          <div style={{
            marginBottom: 28, padding: '14px 18px', borderRadius: 12,
            background: 'rgba(117,146,255,0.12)', border: `1px solid ${'rgba(117,146,255,0.25)'}`,
            display: 'flex', alignItems: 'center', gap: 12
          }}>
            <ChevronRight size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span style={{ color: 'var(--t2)', fontSize: 13 }}>
              <strong style={{ color: 'var(--t1)' }}>Getting started:</strong> Enter your credentials for a server below, then click{' '}
              <strong style={{ color: 'var(--accent)' }}>"Connect server"</strong> — you'll get a config snippet to paste into your AI client.
            </span>
          </div>
        )}

        {/* ── Server grid ── */}
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: 20, alignItems: 'stretch' }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{
                height: 220, borderRadius: 16, background: 'var(--card)',
                border: `1px solid ${'var(--border)'}`, animation: 'pulse 1.5s ease-in-out infinite',
                opacity: 1 - i * 0.15
              }} />
            ))}
          </div>
        ) : servers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--t3)' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🔌</div>
            <div style={{ fontWeight: 700, color: 'var(--t2)', fontSize: 16, marginBottom: 8 }}>No servers available yet</div>
            <div style={{ fontSize: 13 }}>Ask your admin to configure MCP servers for your team.</div>
          </div>
        ) : pagedServers.length === 0 && search ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--t3)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
            <div style={{ fontWeight: 600, color: 'var(--t2)', marginBottom: 6 }}>No servers match "{search}"</div>
            <button onClick={() => { setSearch(''); setPage(1) }}
              style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}>
              Clear search
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: 20, alignItems: 'stretch' }}>
            {pagedServers.map(server => (
              <ServerTile
                key={server.id}
                server={server}
                connection={getConnection(server.id)}
                requestStatus={requestMap[server.id]}
                onClick={() => setSelectedServerId(server.id)}
              />
            ))}
          </div>
        )}

        {selectedServer && (
          <div
            role="presentation"
            onMouseDown={event => { if (event.target === event.currentTarget) setSelectedServerId(null) }}
            style={{
              position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.52)',
              backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'flex-start',
            }}
          >
            <aside
              role="dialog"
              aria-modal="true"
              aria-label={`${selectedServer.name} details`}
              className="portal-details-panel"
              style={{
                width: 'min(520px, 94vw)', height: '100%', background: 'var(--surface)',
                borderRight: '1px solid var(--border)', boxShadow: '20px 0 50px rgba(0,0,0,0.25)',
                display: 'flex', flexDirection: 'column',
              }}
            >
              <div style={{
                height: 60, padding: '0 18px 0 22px', borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
              }}>
                <div>
                  <div style={{ color: 'var(--t1)', fontSize: 14, fontWeight: 750 }}>MCP app details</div>
                  <div style={{ color: 'var(--t3)', fontSize: 11 }}>Review access and connection options</div>
                </div>
                <button
                  type="button"
                  aria-label="Close details"
                  onClick={() => setSelectedServerId(null)}
                  style={{
                    width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--t2)', background: 'var(--card)', border: '1px solid var(--border)', cursor: 'pointer',
                  }}
                >
                  <X size={16} />
                </button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                <ServerCard
                  server={selectedServer}
                  connection={getConnection(selectedServer.id)}
                  requestStatus={requestMap[selectedServer.id]}
                  isRequesting={requesting === selectedServer.id}
                  onRequest={() => requestAccess(selectedServer.id)}
                  onConnect={handleConnect}
                  hasOauthToken={oauthStatus[selectedServer.id]}
                  onOauthRefresh={() => load(true)}
                />
              </div>
            </aside>
          </div>
        )}

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 8, marginTop: 28
          }}>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              style={{
                padding: '7px 16px', borderRadius: 9, fontSize: 13, fontWeight: 600,
                background: 'var(--card)', color: page === 1 ? 'var(--t3)' : 'var(--t1)',
                border: `1px solid ${'var(--border)'}`,
                cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.4 : 1
              }}>
              ← Prev
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                .reduce((acc, p, i, arr) => {
                  if (i > 0 && p - arr[i - 1] > 1) acc.push('…')
                  acc.push(p)
                  return acc
                }, [])
                .map((p, i) => p === '…' ? (
                  <span key={`ellipsis-${i}`} style={{ color: 'var(--t3)', fontSize: 13, padding: '0 4px' }}>…</span>
                ) : (
                  <button key={p} onClick={() => setPage(p)}
                    style={{
                      width: 34, height: 34, borderRadius: 8, fontSize: 13, fontWeight: 600,
                      cursor: 'pointer', transition: 'all 0.15s',
                      background: page === p ? 'var(--accent)' : 'var(--card)',
                      color: page === p ? '#fff' : 'var(--t2)',
                      border: `1px solid ${page === p ? 'var(--accent)' : 'var(--border)'}`
                    }}>
                    {p}
                  </button>
                ))
              }
            </div>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              style={{
                padding: '7px 16px', borderRadius: 9, fontSize: 13, fontWeight: 600,
                background: 'var(--card)', color: page === totalPages ? 'var(--t3)' : 'var(--t1)',
                border: `1px solid ${'var(--border)'}`,
                cursor: page === totalPages ? 'not-allowed' : 'pointer',
                opacity: page === totalPages ? 0.4 : 1
              }}>
              Next →
            </button>
            <span style={{ color: 'var(--t3)', fontSize: 12, marginLeft: 8 }}>
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
          </div>
        )}


      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:0.5 } 50% { opacity:0.8 } }
        * { box-sizing: border-box; }
        input::placeholder { color: var(--t3); }
        .portal-server-card:hover {
          border-color: rgba(117,146,255,0.28) !important;
          box-shadow: 0 12px 30px rgba(0,0,0,0.14);
          transform: translateY(-1px);
        }
        .portal-app-tile:hover {
          border-color: rgba(117,146,255,0.4) !important;
          box-shadow: 0 12px 28px rgba(0,0,0,0.14);
          transform: translateY(-2px);
        }
        .portal-app-tile:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        @keyframes portalPanelIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }
        .portal-details-panel { animation: portalPanelIn 0.2s ease-out; }
      `}</style>
    </div>
  )
}

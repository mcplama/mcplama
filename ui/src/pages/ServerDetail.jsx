/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, ExternalLink, RefreshCw, Trash2, Link2, Link2Off, KeyRound, XCircle, Zap,
  CheckCircle, Eye, EyeOff, Globe, Edit2
} from 'lucide-react'
import api from '../lib/api'
import { parseServerTimestamp } from '../lib/formatTime'
import { Card, PanelHead, Toggle, Input, CodeBlock, CodeEditor, EmptyState, Tabs, Spinner, Modal, ModalHeader, Btn } from '../components/ui'
import Badge from '../components/kit/Badge'
import Button from '../components/kit/Button'
import Alert from '../components/kit/Alert'
import { Table, TableBody, TableRow, TableCell } from '../components/kit/Table'
import ServerIcon from '../components/ui/ServerIcon'
import { useAuth } from '../hooks/useAuth'
import clsx from 'clsx'


function StatBox({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5 text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-sm font-bold font-mono text-gray-800 dark:text-white/90">{value ?? '—'}</p>
    </div>
  )
}

function StepDot({ num, done = false, disabled = false }) {
  if (done) return (
    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 bg-success-50 border border-success-200 text-success-600 dark:bg-success-500/15 dark:border-success-500/30 dark:text-success-400">
      ✓
    </div>
  )
  if (disabled) return (
    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 bg-gray-100 border border-gray-200 text-gray-400 dark:bg-white/5 dark:border-white/10 dark:text-white/20">
      {num}
    </div>
  )
  return (
    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 bg-brand-50 border border-brand-200 text-brand-500 dark:bg-brand-500/15 dark:border-brand-500/30 dark:text-brand-400">
      {num}
    </div>
  )
}

function OAuthPanel({ server, onRefresh }) {
  const [status, setStatus] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [creds, setCreds] = useState({ client_id: '', client_secret: '' })
  const [showSecret, setShowSecret] = useState(false)
  const [saving, setSaving] = useState(false)
  const [authorizing, setAuthorizing] = useState(false)

  const loadStatus = useCallback(async () => {
    try {
      const r = await api.get(`/servers/${server.id}/auth-status`)
      setStatus(r.data)
    } catch { setStatus({ status: 'error' }) }
  }, [server.id])

  useEffect(() => { loadStatus() }, [loadStatus])

  if (!status || status.status === 'not_required' || status.status === 'not_configured') return null

  const providerName = status.registry?.name || server.name
  const setupSteps = status.registry?.auth?.setup_steps || []

  const authorize = () => {
    const url = `/api/v1/oauth/${server.id}/authorize`
    const popup = window.open(url, 'Mcplama-oauth', 'width=640,height=720,scrollbars=yes')
    setAuthorizing(true)
    const t = setInterval(() => {
      if (popup?.closed) { clearInterval(t); setAuthorizing(false); setTimeout(() => { loadStatus(); onRefresh() }, 800) }
    }, 500)
  }

  const disconnect = async () => {
    if (!confirm('Disconnect OAuth?')) return
    await api.post(`/oauth/${server.id}/disconnect`)
    loadStatus(); onRefresh()
  }

  const saveCreds = async () => {
    if (!creds.client_id || !creds.client_secret) return
    setSaving(true)
    try {
      const existing = server.auth_credentials || {}
      await api.patch(`/servers/${server.id}`, {
        auth_type: 'oauth2',
        auth_credentials: { ...existing, ...creds }
      })
      setShowForm(false); loadStatus(); onRefresh()
    } finally { setSaving(false) }
  }

  const badgeColor = { connected: 'success', expired: 'error', no_credentials: 'warning' }[status.status] || 'light'

  return (
    <div className="space-y-4 pt-5 mt-5 border-t border-gray-100 dark:border-gray-800">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-800 dark:text-white/90">OAuth 2.0 Authorization</p>
        <Badge size="sm" color={badgeColor}
          startIcon={status.status === 'connected'
            ? <span className="inline-block w-1.5 h-1.5 rounded-full bg-success-500" />
            : undefined}>
          {status.status === 'connected' ? 'Connected' :
            status.status === 'expired' ? 'Token expired' :
              status.status === 'no_credentials' ? 'Needs credentials' :
                status.status === 'not_connected' ? 'Not connected' : status.status}
        </Badge>
      </div>

      {setupSteps.length > 0 && (status.status === 'no_credentials' || showForm) && (
        <div className="space-y-2">
          {setupSteps.map((step, i) => (
            <div key={i} className="flex gap-3 rounded-xl p-3.5 border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03]">
              <StepDot num={i + 1} />
              <div>
                <p className="text-sm font-semibold mb-0.5 text-gray-800 dark:text-white/90">{step.title}</p>
                <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  {step.description?.replace('{GATEWAY_URL}', window.location.origin)}
                </p>
                {step.url && (
                  <a href={step.url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs mt-2 text-brand-500 hover:underline">
                    {step.action || 'Open'} <ExternalLink size={10} />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {(status.status === 'no_credentials' || showForm) && (
        <div className="space-y-3 rounded-xl p-4 border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03]">
          <Alert variant="info" title="Redirect URI"
            message={`Set redirect URI to: ${window.location.origin}/api/v1/oauth/callback`} />
          <Input label="Client ID" value={creds.client_id}
            onChange={e => setCreds(c => ({ ...c, client_id: e.target.value }))} placeholder="client_id_..." />
          <Input label="Client Secret" type={showSecret ? 'text' : 'password'} value={creds.client_secret}
            onChange={e => setCreds(c => ({ ...c, client_secret: e.target.value }))} placeholder="client_secret_..."
            suffix={
              <button onClick={() => setShowSecret(s => !s)} className="text-gray-400">
                {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            }
          />
          <div className="flex gap-2 pt-1">
            <Button variant="primary" size="sm" disabled={saving}
              startIcon={saving ? <Spinner size={12} /> : <KeyRound size={14} />}
              onClick={saveCreds}>
              Save credentials
            </Button>
            {!status.needs_credentials && (
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            )}
          </div>
        </div>
      )}

      {status.status === 'not_connected' && !showForm && (
        <div className="space-y-3">
          <Alert variant="info" title="Credentials saved"
            message={`Click 'Authorize' to open the ${providerName} consent screen.`} />
          <div className="flex gap-2">
            <Button variant="primary" size="sm" disabled={authorizing}
              startIcon={authorizing ? <Spinner size={12} /> : <Link2 size={14} />}
              onClick={authorize}>
              Authorize with {providerName}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>Edit credentials</Button>
          </div>
        </div>
      )}

      {status.status === 'connected' && !showForm && (
        <div className="space-y-3">
          <Alert variant="success" title={`Connected to ${providerName}`}
            message={status.connected_at ? `Authorized ${parseServerTimestamp(status.connected_at).toLocaleString()}` : 'Connection active'} />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={authorizing}
              startIcon={authorizing ? <Spinner size={12} /> : <RefreshCw size={14} />}
              onClick={authorize}>
              Re-authorize
            </Button>
            <Button variant="outline" size="sm"
              className="text-error-600 ring-error-300 hover:bg-error-50 dark:text-error-400 dark:ring-error-800 dark:hover:bg-error-500/10"
              startIcon={<Link2Off size={14} />}
              onClick={disconnect}>
              Disconnect
            </Button>
          </div>
        </div>
      )}

      {status.status === 'expired' && !showForm && (
        <div className="space-y-3">
          <Alert variant="error" title="Token expired"
            message="Access token expired. Re-authorize to restore the connection." />
          <Button variant="primary" size="sm" disabled={authorizing}
            startIcon={authorizing ? <Spinner size={12} /> : <Link2 size={14} />}
            onClick={authorize}>
            Re-authorize with {providerName}
          </Button>
        </div>
      )}
    </div>
  )
}

const CLIENT_TABS = [
  { id: 'claude',      label: 'Claude Desktop', logo: 'https://cdn.simpleicons.org/claude' },
  { id: 'claude-code', label: 'Claude Code',    logo: 'https://cdn.simpleicons.org/claude' },
  { id: 'codex',       label: 'Codex',          logo: 'https://cdn.simpleicons.org/openai' },
  { id: 'vscode',      label: 'VS Code',        logo: 'https://cdn.simpleicons.org/visualstudiocode' },
  { id: 'cursor',      label: 'Cursor',         logo: 'https://cdn.simpleicons.org/cursor' },
  { id: 'api',         label: 'API / curl',     icon: Globe },
  { id: 'other',       label: 'Other',          icon: Globe },
]

function usesRunnerImage(server) {
  return server?.runtime === 'npx' || server?.runtime === 'uvx' || (server?.runtime === 'docker' && server?.transport === 'stdio')
}

function isRunnerPullError(message = '') {
  const lower = String(message).toLowerCase()
  return lower.includes('runner image') || lower.includes('runner_image') || lower.includes('mcplama/runner')
}

function RunnerImageWarning({ message }) {
  return (
    <Alert
      variant="warning"
      title="Runner image unavailable"
      message={message || 'NPX, UVX, and stdio-based MCP servers require the MCPlama runner image. MCPlama pulls it automatically, but this host needs registry access. Check Docker login/network access, or set RUNNER_IMAGE to a reachable mirror.'}
    />
  )
}

function ConnectTab({ server, connections, onCreateConnection }) {
  const navigate = useNavigate()
  const [client, setClient] = useState('claude')
  const [creating, setCreating] = useState(false)
  const [creds, setCreds] = useState({})
  const [savingCreds, setSavingCreds] = useState(false)
  const [credsSaved, setCredsSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const schema = server.user_config_schema || []
  const needsCreds = schema.length > 0 && server.auth_mode === 'per_user'
  const isShared = server.auth_mode === 'shared' || server.auth_mode === 'none'
  const isRemoteOAuth = server.runtime === 'remote' && server.remote_auth === 'oauth'

  const mainConn = connections[0]
  const proxyUrl = mainConn ? `${window.location.origin}/connect/${mainConn.token}` : null

  const claudeConfig = proxyUrl ? JSON.stringify({ mcpServers: { [server.slug]: { url: proxyUrl } } }, null, 2) : null
  const claudeCodeConfig = proxyUrl ? JSON.stringify({ mcpServers: { [server.slug]: { type: 'http', url: proxyUrl } } }, null, 2) : null
  const vscodeConfig = proxyUrl ? JSON.stringify({ servers: { [server.slug]: { url: proxyUrl } } }, null, 2) : null
  const claudeCodeCliCmd = proxyUrl ? `claude mcp add --transport http ${server.slug} ${proxyUrl}` : null
  const codexCliCmd = proxyUrl ? `codex mcp add ${server.slug} --url ${proxyUrl}` : null

  const saveCreds = async () => {
    setSavingCreds(true)
    try {
      await api.post(`/servers/${server.id}/credentials`, creds)
      setCredsSaved(true)
      setTestResult(null)
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to save credentials')
    } finally { setSavingCreds(false) }
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const pullTimer = setTimeout(() => {}, 2000)
      const startTimer = setTimeout(() => {}, 15000)
      const initTimer = setTimeout(() => {}, 20000)
      const { data } = await api.post(`/servers/${server.id}/test`)
      clearTimeout(pullTimer); clearTimeout(startTimer); clearTimeout(initTimer)
      setTestResult({
        ok: data.ok,
        status: data.status,
        tools: data.tools || [],
        latency_ms: data.latency_ms,
        oauth_discovery: data.oauth_discovery || null,
      })
    } catch (e) {
      const detail = e.response?.data?.detail
      const isStructured = detail && typeof detail === 'object'
      setTestResult({
        ok: false,
        error: (isStructured ? detail.message : detail) || e.message || 'Connection failed',
        suggested_package: isStructured ? detail.suggested_package : null,
      })
    } finally { setTesting(false) }
  }

  const [applyingPackage, setApplyingPackage] = useState(false)
  const applySuggestedPackage = async (pkg) => {
    setApplyingPackage(true)
    try {
      const current = server.system_packages || []
      if (!current.includes(pkg)) {
        await api.patch(`/servers/${server.id}`, { system_packages: [...current, pkg] })
        server.system_packages = [...current, pkg]
      }
      await testConnection()
    } finally { setApplyingPackage(false) }
  }

  const createConn = async () => {
    setCreating(true)
    try {
      const { data } = await api.post('/connections', { server_id: server.id, label: server.name })
      onCreateConnection(data)
    } finally { setCreating(false) }
  }

  const testPassed = testResult?.ok === true
  const canGenerate = isRemoteOAuth ? true : (isShared ? testPassed : (credsSaved || !needsCreds) && testPassed)
  const testStepNum = needsCreds ? '2' : '1'
  const genStepNum  = needsCreds ? '3' : '2'

  const stepItems = (items) => items.map(({ step, title, content }) => (
    <div key={step} className="flex gap-4">
      <StepDot num={step} />
      <div className="flex-1 min-w-0 space-y-2">
        <p className="text-sm font-semibold text-gray-800 dark:text-white/90">{title}</p>
        {content}
      </div>
    </div>
  ))

  if (mainConn) {
    return (
      <div className="p-6 space-y-5">
        <Alert variant="success" title="Connection token active" message={proxyUrl} />

        <Tabs tabs={CLIENT_TABS} active={client} onChange={setClient} />

        {client === 'claude' && claudeConfig && (
          <div className="space-y-4">
            <Alert variant="info" title="Config file location"
              message="Mac: ~/Library/Application Support/Claude/claude_desktop_config.json · Windows: %APPDATA%\Claude\claude_desktop_config.json" />
            {stepItems([
              { step: '1', title: 'Add to claude_desktop_config.json', content: <CodeEditor value={claudeConfig} /> },
              { step: '2', title: 'Restart Claude Desktop', content: <p className="text-sm text-gray-500 dark:text-gray-400">Fully quit and reopen Claude Desktop. The {server.name} tools will appear in the tools menu.</p> },
            ])}
          </div>
        )}

        {client === 'claude-code' && claudeCodeConfig && (
          <div className="space-y-4">
            <Alert variant="info" title="Claude Code required"
              message="Requires Claude Code CLI. Run 'claude --version' to verify it is installed." />
            {stepItems([
              {
                step: '1', title: 'Add the MCP server (CLI — easiest)',
                content: (
                  <div className="space-y-2">
                    <CodeBlock>{claudeCodeCliCmd}</CodeBlock>
                    <p className="text-xs text-gray-400">Adds the server globally. Use <code className="font-mono">--scope project</code> to add it only for the current project.</p>
                  </div>
                ),
              },
              {
                step: '2', title: 'Verify',
                content: (
                  <div className="space-y-2">
                    <CodeBlock>claude mcp list</CodeBlock>
                    <p className="text-xs text-gray-400">You should see <strong>{server.slug}</strong> in the list.</p>
                  </div>
                ),
              },
              {
                step: '3', title: 'Alternative: edit settings.json manually',
                content: (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-400">Global: <code className="font-mono">~/.claude.json</code> · Project: <code className="font-mono">.claude/settings.json</code></p>
                    <CodeEditor value={claudeCodeConfig} />
                  </div>
                ),
              },
            ])}
          </div>
        )}

        {client === 'codex' && codexCliCmd && (
          <div className="space-y-4">
            <Alert variant="info" title="Codex CLI required"
              message="Requires the Codex CLI. Run 'codex --version' to verify it is installed." />
            {stepItems([
              {
                step: '1', title: 'Add the MCP server',
                content: <CodeBlock>{codexCliCmd}</CodeBlock>,
              },
              {
                step: '2', title: 'Verify',
                content: (
                  <div className="space-y-2">
                    <CodeBlock>codex mcp list</CodeBlock>
                    <p className="text-xs text-gray-400">You should see <strong>{server.slug}</strong> in the list.</p>
                  </div>
                ),
              },
            ])}
          </div>
        )}

        {client === 'vscode' && vscodeConfig && (
          <div className="space-y-4">
            <Alert variant="info" title="VS Code 1.99+ required"
              message="Requires VS Code 1.99+ with the GitHub Copilot extension. MCP servers work in Copilot Agent mode." />
            {stepItems([
              { step: '1', title: 'Create or edit .vscode/mcp.json in your project', content: <CodeEditor value={vscodeConfig} /> },
              {
                step: '2', title: 'Open GitHub Copilot in Agent mode',
                content: (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Press <code className="font-mono text-xs px-1 py-0.5 rounded bg-gray-100 dark:bg-white/5">Ctrl+Shift+I</code> (or <code className="font-mono text-xs px-1 py-0.5 rounded bg-gray-100 dark:bg-white/5">⌘+Shift+I</code> on Mac) to open Copilot Chat in Agent mode. The {server.name} tools will be available automatically.
                  </p>
                ),
              },
              {
                step: '3', title: 'Alternative: add to user settings',
                content: (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-400">Open <strong>Settings (JSON)</strong> and add under the <code className="font-mono">mcp</code> key:</p>
                    <CodeEditor value={JSON.stringify({ mcp: JSON.parse(vscodeConfig) }, null, 2)} />
                  </div>
                ),
              },
            ])}
          </div>
        )}

        {client === 'cursor' && claudeConfig && (
          <div className="space-y-4">
            {stepItems([
              { step: '1', title: 'Open Cursor Settings → MCP', content: <p className="text-sm text-gray-500 dark:text-gray-400">Go to <strong>Cursor Settings → Features → MCP</strong> and click <strong>Add new MCP server</strong>, or edit the config file directly.</p> },
              { step: '2', title: 'Edit ~/.cursor/mcp.json', content: <CodeEditor value={claudeConfig} /> },
              { step: '3', title: 'Reload Cursor', content: <p className="text-sm text-gray-500 dark:text-gray-400">Restart or reload Cursor. The {server.name} tools will appear in Agent mode.</p> },
            ])}
          </div>
        )}

        {client === 'api' && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold mb-2 text-gray-800 dark:text-white/90">Connection URL</p>
              <CodeBlock>{proxyUrl}</CodeBlock>
            </div>
            <div>
              <p className="text-sm font-semibold mb-2 text-gray-800 dark:text-white/90">List tools via HTTP</p>
              <CodeEditor value={`curl -X POST ${proxyUrl} \\\n  -H "Content-Type: application/json" \\\n  -d '{"method":"tools/list","params":{}}'`} />
            </div>
          </div>
        )}

        {client === 'other' && (
          <div className="space-y-3">
            <Alert variant="info" title="Streamable HTTP"
              message="Any MCP client supporting Streamable HTTP can use the URL below." />
            <CodeBlock label="Your proxy URL">{proxyUrl}</CodeBlock>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">

      {/* Step 1 — Credentials (per-user only) */}
      {needsCreds && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <StepDot num="1" done={credsSaved} />
            <p className="text-sm font-semibold text-gray-800 dark:text-white/90">Enter your credentials</p>
          </div>

          {!credsSaved ? (
            <div className="ml-9 space-y-3">
              {schema.map(field => (
                <div key={field.key}>
                  <label className="block text-sm font-medium mb-1.5 text-gray-600 dark:text-gray-400">
                    {field.label}
                    {field.url && (
                      <a href={field.url} target="_blank" rel="noreferrer"
                        className="ml-2 text-xs text-brand-500 hover:underline">
                        Get it here ↗
                      </a>
                    )}
                  </label>
                  <input
                    type={field.type === 'secret' ? 'password' : 'text'}
                    value={creds[field.key] || ''}
                    onChange={e => setCreds(c => ({ ...c, [field.key]: e.target.value }))}
                    placeholder={field.placeholder || ''}
                    className="shadow-theme-xs h-11 w-full rounded-lg border border-gray-300 bg-transparent py-2.5 px-4 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:ring-3 focus:ring-brand-500/10 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                  />
                  {field.description && <p className="text-xs mt-1 text-gray-400">{field.description}</p>}
                </div>
              ))}
              <Button variant="primary" size="sm"
                disabled={savingCreds || schema.some(f => !creds[f.key])}
                startIcon={savingCreds ? <Spinner size={12} /> : <KeyRound size={14} />}
                onClick={saveCreds}>
                Save credentials
              </Button>
            </div>
          ) : (
            <div className="ml-9 space-y-2">
              <Alert variant="success" title="Credentials saved" message="Your credentials have been stored securely." />
              <button onClick={() => { setCredsSaved(false); setTestResult(null) }}
                className="text-xs text-gray-400 hover:underline">
                Change credentials
              </button>
            </div>
          )}
        </div>
      )}

      {needsCreds && <div className="border-t border-gray-100 dark:border-gray-800" />}

      {/* Step 2 — Test connection */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <StepDot num={testStepNum} done={testPassed} />
          <p className="text-sm font-semibold text-gray-800 dark:text-white/90">Test connection</p>
          <span className="text-xs text-gray-400">
            {isRemoteOAuth ? 'Optional for remote servers' : 'Required before generating a token'}
          </span>
        </div>

        <div className="ml-9 space-y-3">
          {needsCreds && !credsSaved ? (
            <p className="text-xs text-gray-400">Save your credentials first to enable testing.</p>
          ) : (
            <Button variant="outline" size="sm" disabled={testing}
              startIcon={testing ? <Spinner size={12} /> : <Zap size={14} />}
              onClick={testConnection}>
              {testResult ? 'Re-test connection' : 'Test connection'}
            </Button>
          )}

          {testResult && (testResult.ok || testResult.status === 'oauth_required') && (
            <div className="rounded-xl p-4 space-y-2 bg-success-50 border border-success-200 dark:bg-success-500/10 dark:border-success-500/25">
              <div className="flex items-center gap-2 text-success-600 dark:text-success-400">
                <CheckCircle size={14} />
                <p className="text-sm font-semibold">
                  {testResult.status === 'oauth_required'
                    ? 'Server reachable — user must authorize before connecting'
                    : isRemoteOAuth
                      ? `Server reachable${testResult.latency_ms ? ` (${testResult.latency_ms}ms)` : ''} — tools load after user authorizes`
                      : `Connected — ${testResult.tools?.length ?? 0} tools discovered${testResult.latency_ms ? ` (${testResult.latency_ms}ms)` : ''}`}
                </p>
              </div>
              {testResult.tools.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {testResult.tools.slice(0, 15).map(t => (
                    <Badge key={t} size="sm" color="light">{t}</Badge>
                  ))}
                  {testResult.tools.length > 15 && (
                    <span className="text-[10px] text-gray-400">+{testResult.tools.length - 15} more</span>
                  )}
                </div>
              )}
            </div>
          )}

          {testResult && !testResult.ok && (
            <div className="rounded-xl p-4 space-y-2 bg-error-50 border border-error-200 dark:bg-error-500/10 dark:border-error-500/25">
              <div className="flex items-center gap-2 text-error-600 dark:text-error-400">
                <XCircle size={14} />
                <p className="text-sm font-semibold">Connection failed</p>
              </div>
              {isRunnerPullError(testResult.error) && (
                <RunnerImageWarning message={testResult.error} />
              )}
              <p className="text-xs font-mono text-error-600 dark:text-error-400">{testResult.error}</p>
              {(testResult.error?.includes('credentials') || testResult.error?.includes('401')) && (
                <p className="text-xs text-gray-400">Double-check your credentials above.</p>
              )}
              {testResult.suggested_package && (
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs text-gray-400">
                    This server may be missing <code className="font-mono text-gray-600 dark:text-gray-300">{testResult.suggested_package}</code>.
                  </p>
                  <Button variant="outline" size="sm" disabled={applyingPackage}
                    startIcon={applyingPackage ? <Spinner size={12} /> : null}
                    onClick={() => applySuggestedPackage(testResult.suggested_package)}>
                    Add to System Packages &amp; retry
                  </Button>
                </div>
              )}
            </div>
          )}

          {testResult?.oauth_discovery && (
            <div className={clsx(
              'rounded-xl p-3 space-y-1.5',
              testResult.oauth_discovery.status === 'ok'
                ? 'bg-success-50 border border-success-200 dark:bg-success-500/10 dark:border-success-500/25'
                : 'bg-error-50 border border-error-200 dark:bg-error-500/10 dark:border-error-500/25'
            )}>
              <p className={clsx('text-xs font-semibold',
                testResult.oauth_discovery.status === 'ok'
                  ? 'text-success-600 dark:text-success-400'
                  : 'text-error-600 dark:text-error-400')}>
                {testResult.oauth_discovery.status === 'ok'
                  ? '🔍 OAuth auto-discovery succeeded'
                  : '⚠️ OAuth auto-discovery failed'}
              </p>
              {testResult.oauth_discovery.status === 'ok' ? (
                <div className="space-y-1">
                  <p className="text-[10px] font-mono text-gray-500">Auth: {testResult.oauth_discovery.auth_endpoint}</p>
                  <p className="text-[10px] font-mono text-gray-500">Token: {testResult.oauth_discovery.token_endpoint}</p>
                  <p className={clsx('text-[10px]', testResult.oauth_discovery.dynamic_registration
                    ? 'text-success-600 dark:text-success-400'
                    : 'text-warning-600 dark:text-orange-400')}>
                    {testResult.oauth_discovery.dynamic_registration
                      ? '✓ Dynamic client registration supported — no credentials needed'
                      : '⚠ No dynamic registration — add Client ID & Secret manually'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[10px] text-gray-500">{testResult.oauth_discovery.message}</p>
                  <Button variant="outline" size="sm"
                    className="text-error-600 ring-error-300 hover:bg-error-50 dark:text-error-400 dark:ring-error-800"
                    onClick={() => navigate(`/servers/${server.id}/edit`)}>
                    Edit server to add credentials
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-gray-100 dark:border-gray-800" />

      {/* Step 3 — Generate token */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <StepDot num={genStepNum} done={false} disabled={!canGenerate} />
          <p className={clsx('text-sm font-semibold', canGenerate ? 'text-gray-800 dark:text-white/90' : 'text-gray-400')}>
            Generate connection token
          </p>
          {!canGenerate && (
            <span className="text-xs text-gray-400">
              {!testPassed ? '← Test connection first' : 'Save credentials first'}
            </span>
          )}
        </div>

        <div className="ml-9">
          {canGenerate ? (
            <div className="space-y-3">
              <Alert variant="info"
                title={isRemoteOAuth ? 'Remote authorization' : `${server.name} will start automatically`}
                message={isRemoteOAuth
                  ? 'After connecting your MCP client, you will be prompted to authorize with the remote server.'
                  : `Mcplama will start the ${server.name} container automatically when your AI client connects.`} />
              <Button variant="primary" size="sm" disabled={creating}
                startIcon={creating ? <Spinner size={12} /> : <Link2 size={14} />}
                onClick={createConn}>
                Generate connection token
              </Button>
            </div>
          ) : (
            <div className="rounded-xl px-4 py-3 text-xs bg-gray-100 dark:bg-white/5 text-gray-400">
              Complete the steps above to unlock token generation.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DeleteServerModal({ server, onClose, onConfirm }) {
  const hasImage = server.runtime === 'docker' && !!(server.docker_image || server.package)
  const [deleteImage, setDeleteImage] = useState(false)
  const [loading, setLoading] = useState(false)

  const confirm = async () => {
    setLoading(true)
    try {
      await onConfirm(hasImage && deleteImage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal onClose={onClose} width="max-w-md">
      <ModalHeader title={`Delete ${server.name}?`} subtitle="This stops its containers and removes the server from Mcplama." onClose={onClose} />
      <div className="p-6 space-y-4">
        {hasImage && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2 text-t3">Cached Docker image</p>
            <div className="space-y-2">
              <button type="button" onClick={() => setDeleteImage(false)}
                className={clsx(
                  'w-full text-left p-3 rounded-xl border transition-all',
                  !deleteImage ? 'bg-accent/10 border-accent ring-1 ring-accent' : 'bg-bg border-border hover:border-border2'
                )}>
                <p className={clsx('text-sm font-semibold', !deleteImage ? 'text-accent' : 'text-t2')}>Keep data</p>
                <p className="text-xs mt-0.5 text-t3">Removes the server, but leaves <span className="font-mono">{server.docker_image || server.package}</span> cached so reinstalling later is instant.</p>
              </button>
              <button type="button" onClick={() => setDeleteImage(true)}
                className={clsx(
                  'w-full text-left p-3 rounded-xl border transition-all',
                  deleteImage ? 'bg-error-500/10 border-error-500 ring-1 ring-error-500' : 'bg-bg border-border hover:border-border2'
                )}>
                <p className={clsx('text-sm font-semibold', deleteImage ? 'text-error-500' : 'text-t2')}>Uninstall completely</p>
                <p className="text-xs mt-0.5 text-t3">Also deletes the cached image to free disk space. Skipped automatically if another server still uses it.</p>
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn variant="danger" loading={loading} onClick={confirm}>Delete</Btn>
      </div>
    </Modal>
  )
}

const PAGE_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'connect',  label: 'Connect' },
  { id: 'tools',    label: 'Tools' },
  { id: 'settings', label: 'Settings' },
]

export default function ServerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [server, setServer] = useState(null)
  const [tab, setTab] = useState('overview')
  const [myConns, setMyConns] = useState([])
  const [loading, setLoading] = useState(true)
  const [showDelete, setShowDelete] = useState(false)

  const load = useCallback(async () => {
    try {
      const [sRes, cRes] = await Promise.all([
        api.get(`/servers/${id}`),
        api.get('/connections?mine=true'),
      ])
      setServer(sRes.data)
      setMyConns(cRes.data.filter(c => c.server_id === parseInt(id)))
    } catch { navigate('/servers') }
    finally { setLoading(false) }
  }, [id, navigate])

  useEffect(() => { load() }, [load])

  const toggle = async (enabled) => {
    await api.patch(`/servers/${id}`, { is_enabled: enabled })
    setServer(s => ({ ...s, is_enabled: enabled }))
  }

  const del = () => setShowDelete(true)

  const confirmDelete = async (deleteImage) => {
    await api.delete(`/servers/${id}`, { params: { delete_image: deleteImage } })
    navigate('/servers')
  }

  if (loading || !server) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-sm text-gray-400">Loading…</div>
    </div>
  )

  return (
    <div className="animate-fade-in max-w-5xl">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => navigate('/servers')}
          className="w-9 h-9 flex items-center justify-center rounded-xl transition-all border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          <ArrowLeft size={17} />
        </button>
        <ServerIcon icon={server.icon} color={server.color} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-0.5">
            <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white/90">{server.name}</h1>
            <Badge size="sm" color={server.is_enabled ? 'success' : 'light'}
              startIcon={server.is_enabled
                ? <span className="inline-block w-1.5 h-1.5 rounded-full bg-success-500" />
                : undefined}>
              {server.is_enabled ? 'Active' : 'Disabled'}
            </Badge>
          </div>
          <p className="text-xs font-mono truncate text-gray-400">{server.url}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Toggle enabled={server.is_enabled} onChange={toggle} />
          <Button variant="outline" size="sm" startIcon={<Edit2 size={14} />}
            onClick={() => navigate(`/servers/${id}/edit`)}>
            Edit
          </Button>
          <Button variant="outline" size="sm"
            className="text-error-600 ring-error-300 hover:bg-error-50 dark:text-error-400 dark:ring-error-800 dark:hover:bg-error-500/10"
            startIcon={<Trash2 size={14} />}
            onClick={del}>
            Delete
          </Button>
        </div>
      </div>

      {server.status === 'error' && usesRunnerImage(server) && (
        <div className="mb-6">
          <RunnerImageWarning />
        </div>
      )}

      <div className="tab-bar mb-6">
        {PAGE_TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`tab-btn${tab === t.id ? ' active' : ''}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className={clsx('grid gap-5', tab === 'connect' ? 'grid-cols-1' : 'grid-cols-3')}>
        <div className={tab === 'connect' ? '' : 'col-span-2'}>

          {tab === 'overview' && (
            <Card>
              <div className="p-6 space-y-5">
                {server.description && (
                  <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">{server.description}</p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <StatBox label="Auth type"   value={server.auth_type} />
                  <StatBox label="Auth mode"   value={server.auth_mode} />
                  <StatBox label="Calls today" value={server.calls_today} />
                  <StatBox label="Avg latency" value={server.avg_latency_ms ? `${server.avg_latency_ms}ms` : null} />
                  <StatBox label="Error rate"  value={`${server.error_rate ?? 0}%`} />
                  <StatBox label="Version"     value={server.version} />
                </div>
                {server.auth_type === 'oauth2' && <OAuthPanel server={server} onRefresh={load} />}
              </div>
            </Card>
          )}

          {tab === 'connect' && (
            <div className="grid grid-cols-3 gap-5">
              <div className="col-span-2">
                <Card>
                  <ConnectTab server={server} connections={myConns}
                    onCreateConnection={c => setMyConns(cs => cs.some(x => x.id === c.id) ? cs : [...cs, c])} />
                </Card>
              </div>
              <div className="space-y-4">
                <Card>
                  <PanelHead title="Server info" />
                  <div className="px-5 py-4 space-y-3">
                    {[['Registry', server.registry_id], ['Version', server.version], ['Category', server.category]].map(([k, v]) => (
                      <div key={k} className="flex justify-between text-sm">
                        <span className="text-gray-400">{k}</span>
                        <span className="font-medium text-gray-600 dark:text-gray-300">{v || '—'}</span>
                      </div>
                    ))}
                  </div>
                </Card>
                <Card>
                  <PanelHead title="My connections" sub={String(myConns.length)} />
                  <div className="px-5 py-4">
                    {myConns.length === 0 ? (
                      <p className="text-xs text-gray-400">No connection tokens yet.</p>
                    ) : myConns.map(c => (
                      <div key={c.id} className="mb-3 last:mb-0 min-w-0">
                        <p className="text-xs font-semibold mb-1 text-gray-600 dark:text-gray-300">{c.label || c.server_name}</p>
                        <p className="text-[10px] font-mono truncate text-gray-400">{`${window.location.origin}/connect/${c.token}`}</p>
                      </div>
                    ))}
                    <Link to="/connections" className="block text-xs mt-3 text-brand-500 hover:underline">
                      Manage all connections →
                    </Link>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {tab === 'tools' && (
            <Card>
              <PanelHead title="Registered tools" sub={`${(server.tools || []).length}`} />
              {(server.tools || []).length === 0 ? (
                <EmptyState title="No tools registered"
                  description="Tools are discovered when you test the connection on the Connect tab." />
              ) : (
                <Table>
                  <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                    {server.tools.map(t => (
                      <TableRow key={t} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition">
                        <TableCell className="px-5 py-3 text-sm font-mono font-medium text-gray-800 dark:text-white/90">
                          {t}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          )}

          {tab === 'settings' && (
            <Card>
              <div className="p-6 space-y-6">
                <div>
                  <p className="text-sm font-semibold mb-4 text-gray-800 dark:text-white/90">Server details</p>
                  <div className="space-y-2">
                    {[
                      ['URL',       server.url],
                      ['Slug',      server.slug],
                      ['Auth type', server.auth_type],
                      ['Auth mode', server.auth_mode],
                      ['Runtime',   server.runtime],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between items-center rounded-xl px-4 py-3 border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03]">
                        <span className="text-xs font-medium text-gray-400">{k}</span>
                        <span className="text-xs font-mono text-gray-600 dark:text-gray-300">{v || '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="pt-5 border-t border-gray-100 dark:border-gray-800">
                  <p className="text-sm font-semibold mb-3 text-error-600">Danger zone</p>
                  <Alert variant="error" title="Destructive action"
                    message="Deleting this server will revoke all connection tokens. This cannot be undone." />
                  <Button variant="outline" size="sm"
                    className="mt-3 text-error-600 ring-error-300 hover:bg-error-50 dark:text-error-400 dark:ring-error-800 dark:hover:bg-error-500/10"
                    startIcon={<Trash2 size={14} />}
                    onClick={del}>
                    Delete server
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>

        {tab !== 'connect' && (
          <div className="space-y-4">
            <Card>
              <PanelHead title="Server info" />
              <div className="px-5 py-4 space-y-3">
                {[
                  ['Registry', server.registry_id],
                  ['Version',  server.version],
                  ['Category', server.category],
                  ['Runtime',  server.runtime],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <span className="text-gray-400">{k}</span>
                    <span className="font-medium text-gray-600 dark:text-gray-300">{v || '—'}</span>
                  </div>
                ))}
                {server.docs_url && (
                  <a href={server.docs_url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs mt-2 text-brand-500 hover:underline">
                    Documentation <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </Card>

            <Card>
              <PanelHead title="My connections" sub={String(myConns.length)} />
              <div className="px-5 py-4">
                {myConns.length === 0 ? (
                  <p className="text-xs text-gray-400">No connection tokens yet. Go to the Connect tab to generate one.</p>
                ) : myConns.map(c => (
                  <div key={c.id} className="mb-3 last:mb-0 min-w-0">
                    <p className="text-xs font-semibold mb-1 text-gray-600 dark:text-gray-300">{c.label || c.server_name}</p>
                    <p className="text-[10px] font-mono truncate text-gray-400">{`${window.location.origin}/connect/${c.token}`}</p>
                  </div>
                ))}
                <Link to="/connections" className="block text-xs mt-3 text-brand-500 hover:underline">
                  Manage all connections →
                </Link>
              </div>
            </Card>
          </div>
        )}
      </div>
      {showDelete && (
        <DeleteServerModal
          server={server}
          onClose={() => setShowDelete(false)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  )
}

/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useEffect, useState } from 'react'
import api from '../lib/api'
import {
  Globe, HardDrive, Zap, Lock, Package as PackageIcon,
  Search, Code2, Database, FolderOpen, CreditCard, Layout,
  Cloud, Wrench, BarChart2, Gamepad2, Grid3x3,
  X, ExternalLink, CheckCircle, Loader2, SearchCheck,
} from 'lucide-react'

const CAT_ICONS = {
  search: Search, dev: Code2, database: Database, storage: FolderOpen,
  finance: CreditCard, productivity: Layout, cloud: Cloud, tools: Wrench,
  monitoring: BarChart2, gaming: Gamepad2, all: Grid3x3,
}

export function CatIcon({ cat, size = 11, ...props }) {
  const Icon = CAT_ICONS[cat] || Wrench
  return <Icon size={size} {...props} />
}

export function catalogRequirementFields(entry) {
  if (entry.user_config_schema?.length) return entry.user_config_schema
  if (typeof entry.requirements !== 'string') return []

  const configured = entry.requirements.match(/Configure:\s*([^.;]+)/i)?.[1]
  if (!configured) return []

  return configured
    .split(',')
    .map(key => key.replace(/[`'".]/g, '').trim())
    .filter(Boolean)
    .map(key => ({
      key,
      label: key,
      type: /(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)/i.test(key) ? 'secret' : 'text',
    }))
}

export function CatalogDetailModal({ entry, onClose, onInstall, onInspect, installing, isInstalled }) {
  const oauthFields = entry.oauth_client?.required ? (entry.oauth_client.fields || []) : []
  const requirementFields = [...catalogRequirementFields(entry), ...oauthFields]
    .filter((field, index, fields) => fields.findIndex(item => item.key === field.key) === index)
  const credentialModes = entry.credential_mode_options || entry.oauth_client?.credential_mode_options || ['shared']
  const preferredMode = entry.oauth_client?.default_credential_mode || entry.auth_mode
  const [credentialMode, setCredentialMode] = useState(credentialModes.includes(preferredMode) ? preferredMode : credentialModes[0])
  const [credentialValues, setCredentialValues] = useState({})
  const [credentialError, setCredentialError] = useState('')
  const [inspection, setInspection] = useState(null)
  const [inspecting, setInspecting] = useState(false)
  const [inspectionError, setInspectionError] = useState('')
  const [gatewayUrl, setGatewayUrl] = useState('')

  useEffect(() => {
    if (entry.remote_auth !== 'oauth' && entry.auth_type !== 'oauth') return
    api.get('/gateway/config/public')
      .then(({ data }) => setGatewayUrl(String(data?.gateway_url || '').replace(/\/+$/, '')))
      .catch(() => setGatewayUrl(window.location.origin))
  }, [entry.id, entry.remote_auth, entry.auth_type])

  useEffect(() => {
    const modes = entry.credential_mode_options || entry.oauth_client?.credential_mode_options || ['shared']
    const preferred = entry.oauth_client?.default_credential_mode || entry.auth_mode
    setCredentialMode(modes.includes(preferred) ? preferred : modes[0])
    setCredentialValues({})
    setCredentialError('')
  }, [entry.id])

  const inspect = async () => {
    setInspecting(true); setInspectionError('')
    try { const { data } = await onInspect(entry); setInspection(data) }
    catch (e) { setInspectionError(e.response?.data?.detail || 'Could not inspect this server') }
    finally { setInspecting(false) }
  }

  const install = () => {
    setCredentialError('')
    const missing = credentialMode === 'shared'
      ? requirementFields.filter(field => field.required !== false && !String(credentialValues[field.key] || '').trim())
      : []
    if (missing.length) {
      setCredentialError(`Enter the required ${missing.map(field => field.label || field.key).join(', ')}.`)
      return
    }
    onInstall(entry, { credentialMode, credentials: credentialValues, credentialFields: requirementFields })
  }

  useEffect(() => {
    const closeOnEscape = event => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[110] flex justify-end bg-black/45 backdrop-blur-[2px]"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${entry.name} catalog details`}
        className="catalog-detail-panel flex h-[100dvh] w-full max-w-[620px] flex-col overflow-hidden border-l border-border bg-surface shadow-2xl sm:w-[min(620px,94vw)]"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-4 border-b border-border p-4 sm:p-6">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 overflow-hidden bg-card2 border border-border">
            {entry.logo_url
              ? <img src={entry.logo_url} alt={entry.name} className="w-10 h-10 object-contain" />
              : <PackageIcon size={26} className="text-accent" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-t1">{entry.name}</h2>
              {entry.official && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-accent/10 text-accent border border-accent/25">
                  ✓ Official
                </span>
              )}
              {entry.verified_by_mcplama && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-accent/10 text-accent border border-accent/25">
                  ✓ Verified by MCPlama
                </span>
              )}
              {entry.installed_by_admin && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-ok/10 text-ok border border-ok/25">
                  Installed by admin
                </span>
              )}
            </div>
            <p className="text-xs mt-0.5 text-t3">
              by <span className="text-t2">{entry.publisher}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-t3 hover:text-t1 transition-colors p-1.5 rounded-lg hover:bg-card2"
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          {requirementFields.length > 0 && (
            <section className="space-y-3 rounded-xl border border-border bg-card2/40 p-4">
              <div>
                <h3 className="text-sm font-semibold text-t1">{entry.remote_auth === 'oauth' ? 'OAuth app credentials' : 'Credentials'}</h3>
                <p className="mt-1 text-xs text-t3">
                  {entry.remote_auth === 'oauth'
                    ? 'This controls where the OAuth app client ID and secret are stored. Each user still authorizes their own account, so the server auth mode remains per user.'
                    : 'Choose who supplies these credentials. Shared credentials are configured now; per-user credentials are requested from each user before they connect.'}
                </p>
              </div>
              {credentialModes.length > 1 && (
                <label className="block text-xs font-medium text-t2">{entry.remote_auth === 'oauth' ? 'OAuth app credential storage' : 'Credential use'}
                  <select value={credentialMode} onChange={event => setCredentialMode(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-t1">
                    {credentialModes.map(mode => <option key={mode} value={mode}>
                      {entry.remote_auth === 'oauth'
                        ? (mode === 'shared' ? 'Shared OAuth app credentials' : 'Each user provides OAuth app credentials')
                        : (mode === 'shared' ? 'Shared for everyone' : 'Each user provides their own')}
                    </option>)}
                  </select>
                </label>
              )}
              {credentialMode === 'shared' && requirementFields.map(field => (
                <label key={field.key} className="block text-xs font-medium text-t2">{field.label || field.key}{field.required !== false ? ' *' : ''}
                  <input type={field.type === 'secret' ? 'password' : 'text'} value={credentialValues[field.key] || ''} onChange={event => setCredentialValues(values => ({ ...values, [field.key]: event.target.value }))} placeholder={field.placeholder || ''} autoComplete="off" className="mt-1 block w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-t1" />
                </label>
              ))}
              {credentialError && <p className="text-xs text-red-500">{credentialError}</p>}
            </section>
          )}
          {(entry.remote_auth === 'oauth' || entry.auth_type === 'oauth') && (
            <section className="rounded-xl border border-accent/30 bg-accent/5 p-4 space-y-2">
              <div>
                <h3 className="text-sm font-semibold text-t1">OAuth redirect URL</h3>
                <p className="mt-1 text-xs leading-relaxed text-t3">Add this exact URL to the authorized redirect URIs for the OAuth client entered above. MCPlama uses the gateway URL below when you connect.</p>
              </div>
              <code className="block break-all rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-t1">
                {gatewayUrl || window.location.origin}/api/v1/oauth/{entry.runtime === 'remote' ? 'mcp-callback' : 'callback'}
              </code>
              <p className="text-[11px] text-t3">Gateway URL: <span className="break-all font-mono text-t2">{gatewayUrl || window.location.origin}</span></p>
            </section>
          )}
          <p className="text-sm leading-relaxed text-t2 break-words">{entry.description || 'No description available.'}</p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl p-3 bg-card2 border border-border">
              <p className="text-[10px] font-semibold uppercase tracking-wide mb-1 text-t3">Runtime · transport</p>
              <p className="text-sm font-mono font-medium text-t1">
                {entry.runtime === 'npx' ? 'NPX'
                  : entry.runtime === 'uvx' ? 'UVX'
                  : entry.runtime === 'docker' ? 'Docker'
                  : 'Remote'} · {(entry.transport || 'unknown').replaceAll('_', ' ')}
              </p>
              {(entry.package || entry.docker_image) && (
                <p className="text-[10px] mt-1 font-mono truncate text-t3">
                  {entry.package || entry.docker_image}
                </p>
              )}
            </div>
            <div className="rounded-xl p-3 bg-card2 border border-border">
              <p className="text-[10px] font-semibold uppercase tracking-wide mb-1 text-t3">Authentication</p>
              <p className="text-sm font-medium capitalize text-t1">{(entry.auth_type || 'none').replaceAll('_', ' ')}</p>
              {entry.remote_auth && entry.remote_auth !== 'none' && (
                <p className="mt-1 text-[10px] text-t3">Remote access: {entry.remote_auth.replaceAll('_', ' ')}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs text-t2">
            <p>Version: <span className="text-t1">{entry.version || 'Not specified'}</span></p>
            <p>Tools listed: <span className="text-t1">{inspection?.tool_count ?? entry.tools?.length ?? 'Unknown'}</span></p>
            <p>Category: <span className="text-t1">{entry.category || 'Other'}</span></p>
            {entry.url && <p className="col-span-2 break-all">Endpoint: <span className="font-mono text-t1">{entry.url}</span></p>}
            {entry.runtime === 'remote' && !entry.url && <p className="col-span-2">Endpoint: <span className="text-t1">Configure after adding this server</span></p>}
          </div>

          {entry.runtime === 'remote' && entry.url && (
            <div className="rounded-xl border border-border bg-card2/40 p-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-t1">Check this live endpoint</h3>
                <p className="mt-1 text-xs leading-relaxed text-t3">Connects to the server now and lists the tools it currently exposes. This check does not add or authorize the server.</p>
              </div>
              <button onClick={inspect} disabled={inspecting} className="inline-flex items-center justify-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/15 disabled:cursor-wait disabled:opacity-60">
                {inspecting ? <Loader2 size={14} className="animate-spin" /> : <SearchCheck size={14} />}
                {inspecting ? 'Checking endpoint…' : 'Check endpoint and list tools'}
              </button>
              {inspectionError && <p className="mt-2 text-xs text-danger">{inspectionError}</p>}
              {inspection?.version_mismatch && <p className="mt-2 text-xs text-warning">Registry version {inspection.registry_version} differs from endpoint version {inspection.server_version}.</p>}
              {inspection && <p className="text-xs font-medium text-t2">Check complete · {inspection.tool_count ?? inspection.tools?.length ?? 0} live tool{(inspection.tool_count ?? inspection.tools?.length ?? 0) === 1 ? '' : 's'} found</p>}
              {inspection?.tools?.length > 0 && <div className="mt-3 space-y-2">
                {inspection.tools.map((tool, i) => <div key={`${tool.name}-${i}`} className="rounded-lg p-3 bg-card2 border border-border">
                  <p className="text-xs font-mono font-semibold text-t1">{tool.name}</p>
                  {tool.description && <p className="mt-1 text-xs text-t2">{tool.description}</p>}
                  {tool.annotations && <p className="mt-1 text-[10px] text-t3">{tool.annotations.readOnlyHint === true ? 'Read only' : tool.annotations.destructiveHint === true ? 'Destructive hint' : tool.annotations.readOnlyHint === false ? 'May write' : 'Capability not declared'}</p>}
                </div>)}
              </div>}
            </div>
          )}

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide mb-2 text-t3">Setup requirements</p>
            <div className="rounded-xl p-3 bg-card2 border border-border">
              <p className="text-xs leading-relaxed text-t2 break-words">
                {entry.requirements || (requirementFields.length > 0
                  ? `Configure: ${requirementFields.map(field => field.key).join(', ')}.`
                  : 'No credentials or additional setup declared by the publisher.')}
              </p>
            </div>

            {requirementFields.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide mt-4 text-t3">
                  Configuration fields ({requirementFields.length})
                </p>
                {requirementFields.map(f => (
                  <div key={f.key} className="flex items-center gap-3 rounded-xl px-3 py-2.5 bg-card2 border border-border">
                    <span className="text-xs font-mono font-semibold shrink-0 text-accent">{f.key}</span>
                    <span className={`text-[10px] ml-auto shrink-0 px-1.5 py-0.5 rounded ${
                      f.type === 'secret'
                        ? 'bg-danger/10 text-danger'
                        : 'bg-ok/10 text-ok'
                    }`}>
                      {f.type === 'secret' ? 'secret' : 'text'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {entry.docs_url && (
            <a href={entry.docs_url} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-accent hover:underline transition-all">
              <ExternalLink size={11} /> View documentation / source
            </a>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-col-reverse items-stretch gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
          <span className="text-xs text-t3">Review the requirements before connecting.</span>
          {isInstalled ? (
            <span className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-xl bg-ok/10 text-ok border border-ok/25">
              <CheckCircle size={14} /> {entry.installed_by_admin ? 'Installed by admin' : 'Installed'}
            </span>
          ) : (
            <button
              onClick={install}
              disabled={installing}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-accent text-white hover:opacity-85 transition-all disabled:opacity-60"
            >
              {installing
                ? <><Loader2 size={13} className="animate-spin" /> Installing...</>
                : <><Zap size={13} /> {entry.runtime === 'remote' ? (entry.url ? 'Connect' : 'Configure') : 'Install'}</>}
            </button>
          )}
        </div>
        <style>{`
          @keyframes catalogPanelIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
          .catalog-detail-panel { animation: catalogPanelIn 0.2s ease-out; }
        `}</style>
      </aside>
    </div>
  )
}

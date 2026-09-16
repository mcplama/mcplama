/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState } from 'react'
import { Globe, HardDrive, Zap, Plus } from 'lucide-react'
import api from '../lib/api'
import { Modal, ModalHeader, Btn, FormHelp } from '../components/ui'

const cls = {
  input: 'w-full px-3 py-2 rounded-xl text-sm bg-bg border border-border text-t1 outline-none focus:border-accent font-mono transition-colors',
  label: 'block text-[11px] font-bold uppercase tracking-widest text-t3 mb-1.5',
}

const RUNTIMES = [
  { id: 'remote', icon: Globe, label: 'Remote URL', hint: 'Proxy to an existing HTTP server' },
  { id: 'docker', icon: HardDrive, label: 'Docker image', hint: 'Run a Docker MCP image' },
  { id: 'npx', icon: Zap, label: 'NPX package', hint: 'Run an npm MCP package' },
  { id: 'uvx', icon: Zap, label: 'UVX package', hint: 'Run a Python MCP package' },
]

const AUTH_TYPES = [
  { id: 'none', label: 'None', desc: 'No auth required' },
  { id: 'bearer', label: 'Bearer token', desc: 'Static API key or token' },
  { id: 'oauth', label: 'OAuth (MCP)', desc: 'Auto-discovered · RFC 9728' },
]

const CRED_MODES = [
  { id: 'shared', label: 'Shared', desc: 'Admin sets credentials once for everyone' },
  { id: 'per_user', label: 'Per user', desc: 'Each user enters their own credentials' },
]

export default function AddServerModal({ onClose, onAdded }) {
  const [runtime, setRuntime] = useState('remote')
  const [form, setForm] = useState({
    name: '', description: '', category: '', logo_url: '',
    url: '', remote_auth: 'none',
    auth_header_name: 'Authorization', auth_header_value: '',
    oauth_client_id: '', oauth_client_secret: '',
    oauth_auth_url: '', oauth_token_url: '', oauth_scopes: '', oauth_pkce: true, oauth_token_auth: 'basic',
    docker_image: '', docker_args: '', container_port: '8000', transport: 'stdio',
    package: '', args: '', system_packages: '',
    cpu_limit: '', memory_limit: '',
    auth_mode: 'shared',
  })
  const [envVars, setEnvVars] = useState([{ key: '', value: '', type: 'secret' }])
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState({})

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  const addEnvVar = () => setEnvVars(v => [...v, { key: '', value: '', type: 'secret' }])
  const removeEnvVar = i => setEnvVars(v => v.filter((_, j) => j !== i))
  const setEnvVar = (i, k, v) => setEnvVars(ev => ev.map((e, j) => j === i ? { ...e, [k]: v } : e))

  const submit = async () => {
    const e = {}
    if (!form.name.trim()) e.name = 'Required'
    if (runtime === 'remote' && !form.url.trim()) e.url = 'Required'
    if (runtime === 'docker' && !form.docker_image.trim()) e.docker_image = 'Required'
    if ((runtime === 'npx' || runtime === 'uvx') && !form.package.trim()) e.package = 'Required'
    if (Object.keys(e).length) { setErrors(e); return }
    setLoading(true)
    try {
      const filled = envVars.filter(v => v.key.trim())
      const user_config_schema = filled.map(v => ({ key: v.key.trim(), label: v.key.trim(), type: v.type, placeholder: '' }))
      const auth_config = Object.fromEntries(filled.filter(v => v.value.trim()).map(v => [v.key.trim(), v.value.trim()]))

      const payload = {
        name: form.name, description: form.description, category: form.category,
        logo_url: form.logo_url.trim() || null,
        runtime, user_config_schema, auth_config, tools: [],
        auth_mode: filled.length > 0 ? form.auth_mode : 'none',
      }

      if (runtime === 'remote') {
        payload.url = form.url
        payload.remote_auth = form.remote_auth
        if (form.remote_auth === 'bearer') {
          payload.auth_header_name = 'Authorization'
          payload.auth_type = 'bearer'
          if (form.auth_mode === 'per_user') {
            payload.auth_mode = 'per_user'
            payload.user_config_schema = [{ key: 'token', label: 'Personal access token', type: 'secret', placeholder: '' }]
          } else {
            payload.auth_mode = 'none'
            payload.auth_header_value = form.auth_header_value
          }
        } else if (form.remote_auth === 'oauth') {
          payload.auth_mode = 'per_user'; payload.auth_type = 'oauth'
          payload.oauth_client_id = form.oauth_client_id
          payload.oauth_client_secret = form.oauth_client_secret
          payload.oauth_auth_url = form.oauth_auth_url
          payload.oauth_token_url = form.oauth_token_url
          payload.oauth_scopes = form.oauth_scopes
          payload.oauth_pkce = form.oauth_pkce
          payload.oauth_token_auth = form.oauth_token_auth
        } else {
          payload.auth_mode = 'none'
        }
      } else if (runtime === 'docker') {
        payload.docker_image = form.docker_image
        payload.docker_args = form.docker_args.split(' ').filter(Boolean)
        payload.container_port = parseInt(form.container_port) || 8000
        payload.transport = form.transport
      } else {
        payload.package = form.package
        payload.args = form.args.split(' ').filter(Boolean)
        payload.system_packages = form.system_packages.split(',').map(s => s.trim()).filter(Boolean)
      }

      if (runtime !== 'remote') {
        payload.cpu_limit = form.cpu_limit.trim() || null
        payload.memory_limit = form.memory_limit.trim() || null
      }

      const { data } = await api.post('/servers', payload)
      onAdded(data.id)
    } catch (err) {
      setErrors({ submit: err.response?.data?.detail || 'Failed to add server' })
    } finally { setLoading(false) }
  }

  const hasEnvVars = envVars.some(v => v.key.trim())

  return (
    <Modal closeOnBackdrop={false} onClose={onClose} width="max-w-2xl">
      <ModalHeader title="Add custom server" subtitle="Connect any MCP server to Mcplama" onClose={onClose} />

      <div className="p-6 space-y-5 overflow-y-auto max-h-[70vh]">

        {/* Runtime selector */}
        <div>
          <label className={cls.label}>Runtime <FormHelp text="Choose how MCPlama should connect to or run this MCP server." /></label>
          <div className="grid grid-cols-4 gap-2">
            {RUNTIMES.map(r => (
              <button key={r.id} onClick={() => !r.soon && setRuntime(r.id)}
                disabled={r.soon}
                className={`relative flex flex-col items-start gap-1.5 p-3 rounded-xl border text-left transition-all ${r.soon
                  ? 'bg-bg border-border opacity-50 cursor-not-allowed'
                  : runtime === r.id
                    ? 'bg-accent/10 border-accent ring-1 ring-accent'
                    : 'bg-bg border-border hover:border-border2'
                  }`}>
                {r.soon && (
                  <span className="absolute top-1.5 right-1.5 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-card2 text-t3">
                    Soon
                  </span>
                )}
                <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${runtime === r.id ? 'bg-accent' : 'bg-card2'}`}>
                  <r.icon size={12} color={runtime === r.id ? '#fff' : 'var(--t3)'} />
                </div>
                <p className={`text-xs font-semibold ${runtime === r.id ? 'text-accent' : 'text-t2'}`}>{r.label}</p>
                <p className="text-[9px] leading-tight text-t3">{r.hint}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Name + Category */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={cls.label}>Server name * <FormHelp text="A recognizable name for this MCP server." /></label>
            <input className={cls.input} value={form.name} onChange={set('name')} placeholder="My MCP server" />
            {errors.name && <p className="text-xs text-danger mt-1">{errors.name}</p>}
          </div>
          <div>
            <label className={cls.label}>Category <FormHelp text="Optional category used to organize this server in the catalog." /></label>
            <input className={cls.input} value={form.category} onChange={set('category')} placeholder="productivity" />
          </div>
        </div>

        {/* Optional catalog icon */}
        <div>
          <label className={cls.label}>MCP icon URL <FormHelp text="Optional public image URL used as this server's catalog icon." /></label>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center overflow-hidden bg-card2 border border-border">
              {form.logo_url.trim()
                ? <img src={form.logo_url.trim()} alt="MCP icon preview" className="w-8 h-8 object-contain" />
                : <Globe size={18} className="text-t3" />}
            </div>
            <input
              className={cls.input}
              type="url"
              value={form.logo_url}
              onChange={set('logo_url')}
              placeholder="https://example.com/mcp-icon.png"
            />
          </div>
          <p className="text-[10px] mt-1.5 text-t3">Shown for this server in the catalog and server pages.</p>
        </div>

        {/* Remote */}
        {runtime === 'remote' && (
          <div className="space-y-3">
            <div>
              <label className={cls.label}>Server URL * <FormHelp text="The HTTP or HTTPS endpoint of the MCP server, including its MCP path if required." /></label>
              <input className={cls.input} value={form.url} onChange={set('url')} placeholder="https://your-mcp-server.com/mcp" />
              {errors.url && <p className="text-xs text-danger mt-1">{errors.url}</p>}
            </div>
            <div>
              <label className={cls.label}>Authentication type <FormHelp text="Choose how the MCP server authenticates requests." /></label>
              <div className="grid grid-cols-3 gap-2">
                {AUTH_TYPES.map(a => (
                  <button key={a.id} onClick={() => setForm(f => ({ ...f, remote_auth: a.id }))}
                    className={`flex flex-col gap-1 p-3 rounded-xl border text-left transition-all ${form.remote_auth === a.id ? 'bg-accent border-accent' : 'bg-bg border-border'
                      }`}>
                    <p className={`text-xs font-semibold ${form.remote_auth === a.id ? 'text-white' : 'text-t1'}`}>{a.label}</p>
                    <p className={`text-[9px] leading-tight ${form.remote_auth === a.id ? 'text-white/70' : 'text-t3'}`}>{a.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            {form.remote_auth === 'bearer' && (
              <div className="space-y-3">
                <div>
                  <label className={cls.label}>Credential mode <FormHelp text="Shared uses one admin-managed credential; per-user lets each member provide their own." /></label>
                  <div className="grid grid-cols-2 gap-2">
                    {[{id:'shared',label:'Shared',desc:'Admin sets one token for everyone'},{id:'per_user',label:'Per user',desc:'Each member enters their own token'}].map(m => (
                      <button key={m.id} onClick={() => setForm(f => ({ ...f, auth_mode: m.id }))}
                        className={`flex flex-col gap-0.5 p-3 rounded-xl border text-left transition-all ${form.auth_mode === m.id ? 'bg-accent border-accent' : 'bg-bg border-border'}`}>
                        <p className={`text-xs font-semibold ${form.auth_mode === m.id ? 'text-white' : 'text-t1'}`}>{m.label}</p>
                        <p className={`text-[10px] ${form.auth_mode === m.id ? 'text-white/70' : 'text-t3'}`}>{m.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
                {form.auth_mode === 'per_user' ? (
                  <p className="text-xs text-t3">Members will be prompted to paste their own token in the portal before they can connect.</p>
                ) : (
                  <div>
                    <label className={cls.label}>Bearer token <FormHelp text="Paste the API token sent to the server as a Bearer authorization header." /></label>
                    <input className={cls.input} type="password" value={form.auth_header_value} onChange={set('auth_header_value')} placeholder="your-api-token-here" />
                    <p className="text-xs mt-1 text-t3">Sent as: <code className="text-accent">Authorization: Bearer your-token</code></p>
                  </div>
                )}
              </div>
            )}
            {form.remote_auth === 'oauth' && (
              <details open={!!form.oauth_client_id}>
                <summary className="text-[11px] font-semibold cursor-pointer text-t3 list-none">▶ Manual credentials (only if auto-discovery fails)</summary>
                <div className="mt-3 space-y-3 pl-3 border-l-2 border-border">
                  <p className="text-[10px] text-t3">Leave blank to use auto-discovery and dynamic registration. Required for providers like GitHub that don't support RFC 8414 metadata or dynamic client registration.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={cls.label}>Client ID <FormHelp text="OAuth client identifier supplied by the MCP server provider." /></label><input className={cls.input} value={form.oauth_client_id} onChange={set('oauth_client_id')} placeholder="optional" /></div>
                    <div><label className={cls.label}>Client Secret <FormHelp text="OAuth client secret supplied by the MCP server provider." /></label><input className={cls.input} type="password" value={form.oauth_client_secret} onChange={set('oauth_client_secret')} placeholder="optional" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={cls.label}>Authorization URL <FormHelp text="OAuth URL where users authorize access." /></label><input className={cls.input} value={form.oauth_auth_url} onChange={set('oauth_auth_url')} placeholder="https://github.com/login/oauth/authorize" /></div>
                    <div><label className={cls.label}>Token URL <FormHelp text="OAuth URL where MCPlama exchanges the authorization code for a token." /></label><input className={cls.input} value={form.oauth_token_url} onChange={set('oauth_token_url')} placeholder="https://github.com/login/oauth/access_token" /></div>
                  </div>
                  <div><label className={cls.label}>Scopes <FormHelp text="Space-separated OAuth permissions requested from the provider." /></label><input className={cls.input} value={form.oauth_scopes} onChange={set('oauth_scopes')} placeholder="repo read:org read:user" /></div>
                  <div>
                    <label className={cls.label}>Token endpoint auth <FormHelp text="How MCPlama sends the OAuth client credentials to the token endpoint." /></label>
                    <select className={cls.input} value={form.oauth_token_auth} onChange={set('oauth_token_auth')}>
                      <option value="basic">HTTP Basic (Notion, Stripe, Dropbox)</option>
                      <option value="body">Client ID/secret in body (GitHub, GitLab, Google, Slack)</option>
                      <option value="none">None — PKCE public client</option>
                    </select>
                  </div>
                </div>
              </details>
            )}
          </div>
        )}

        {/* Docker */}
        {runtime === 'docker' && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className={cls.label}>Docker image * <FormHelp text="Docker image name and tag to run, for example mcp/server:latest." /></label>
                <input className={cls.input} value={form.docker_image} onChange={set('docker_image')} placeholder="e.g. mcp/mcp_name" />
                {errors.docker_image && <p className="text-xs text-danger mt-1">{errors.docker_image}</p>}
              </div>
              <div>
                <label className={cls.label}>Container port <FormHelp text="Port exposed by the MCP server inside the container." /></label>
                <input className={cls.input} value={form.container_port} onChange={set('container_port')} placeholder="8000" />
              </div>
            </div>
            <div>
              <label className={cls.label}>Extra args <FormHelp text="Optional command-line arguments passed to the Docker image." /></label>
              <input className={cls.input} value={form.docker_args} onChange={set('docker_args')} placeholder="--transport http --port 3000" />
            </div>
            <div>
              <label className={cls.label}>Transport <FormHelp text="Choose HTTP when the image exposes an HTTP endpoint, or stdio for standard input/output MCP servers." /></label>
              <div className="grid grid-cols-2 gap-2">
                {[{id:'http',label:'HTTP',desc:'Image exposes an HTTP endpoint'},{id:'stdio',label:'stdio',desc:'Image uses stdio (wrapped by supergateway)'}].map(t => (
                  <button key={t.id} onClick={() => setForm(f => ({ ...f, transport: t.id }))}
                    className={`flex flex-col gap-0.5 p-3 rounded-xl border text-left transition-all ${form.transport === t.id ? 'bg-accent border-accent' : 'bg-bg border-border'}`}>
                    <p className={`text-xs font-semibold ${form.transport === t.id ? 'text-white' : 'text-t1'}`}>{t.label}</p>
                    <p className={`text-[10px] ${form.transport === t.id ? 'text-white/70' : 'text-t3'}`}>{t.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* NPX / UVX */}
        {(runtime === 'npx' || runtime === 'uvx') && (
          <div className="space-y-3">
            <div>
              <label className={cls.label}>{runtime === 'npx' ? 'NPM package' : 'Python package'} * <FormHelp text="The package name MCPlama should install and run." /></label>
              <input className={cls.input} value={form.package} onChange={set('package')} placeholder={runtime === 'npx' ? '@github/mcp-server' : 'mcp-server-name'} />
              {errors.package && <p className="text-xs text-danger mt-1">{errors.package}</p>}
            </div>
            <div>
              <label className={cls.label}>Args (space-separated) <FormHelp text="Optional command-line arguments passed to the package." /></label>
              <input className={cls.input} value={form.args} onChange={set('args')} placeholder="Optional args" />
            </div>
            <div>
              <label className={cls.label}>System packages (optional) <FormHelp text="Comma-separated operating-system packages required by the server, such as git." /></label>
              <input className={cls.input} value={form.system_packages} onChange={set('system_packages')} placeholder="e.g. git" />
              <p className="text-[10px] mt-1 text-t3">Comma-separated apt package names this server needs (e.g. <code className="text-accent">git</code>) — installed automatically before it starts, no Docker image required.</p>
            </div>
          </div>
        )}

        {/* Resource limits */}
        {runtime !== 'remote' && (
          <div className="space-y-2">
            <label className={cls.label}>Resource limits <FormHelp text="Optional limits for this server's container. Values are constrained by the host and broker limits." /></label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-t3 mb-1">CPU limit</label>
                <input className={cls.input} value={form.cpu_limit} onChange={set('cpu_limit')} placeholder="e.g. 1 (blank = default)" />
              </div>
              <div>
                <label className="block text-[10px] text-t3 mb-1">Memory limit</label>
                <input className={cls.input} value={form.memory_limit} onChange={set('memory_limit')} placeholder="e.g. 256m (blank = default)" />
              </div>
            </div>
            <p className="text-[10px] text-t3">Use Docker formats such as <code className="text-accent">1</code> CPU and <code className="text-accent">256m</code> memory. If the server cannot start, edit it and lower these limits.</p>
          </div>
        )}

        {/* Env vars — container runtimes only; remote servers authenticate via
            the auth type / credential mode controls above, not env vars. */}
        {runtime !== 'remote' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className={cls.label}>Credentials / env variables <FormHelp text="Add environment variables required by the MCP server. Leave a value empty when each user should provide it." /></label>
            <button onClick={addEnvVar} className="text-xs px-2 py-1 rounded-lg bg-accent/15 text-accent">+ Add variable</button>
          </div>
          <div className="space-y-2">
            {envVars.map((v, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input className={`${cls.input} flex-1`} value={v.key} onChange={e => setEnvVar(i, 'key', e.target.value)} placeholder="ENV_VAR_NAME" />
                <input className={`${cls.input} flex-[2]`} type={v.type === 'secret' ? 'password' : 'text'} value={v.value} onChange={e => setEnvVar(i, 'value', e.target.value)} placeholder="Value (empty = per-user)" />
                <select value={v.type} onChange={e => setEnvVar(i, 'type', e.target.value)} className="px-2 py-2 rounded-xl text-sm bg-bg border border-border text-t3 outline-none">
                  <option value="secret">Secret</option>
                  <option value="text">Text</option>
                </select>
                {envVars.length > 1 && <button onClick={() => removeEnvVar(i)} className="text-t3 hover:text-danger transition-colors">✕</button>}
              </div>
            ))}
          </div>
          <p className="text-xs mt-1.5 text-t3">Leave value empty if each user should provide their own credentials.</p>
        </div>
        )}

        {/* Credential mode */}
        {runtime !== 'remote' && hasEnvVars && (
          <div>
            <label className={cls.label}>Credential mode <FormHelp text="Shared uses admin-provided values; per-user asks each member for their own values." /></label>
            <div className="grid grid-cols-2 gap-2">
              {CRED_MODES.map(m => (
                <button key={m.id} onClick={() => setForm(f => ({ ...f, auth_mode: m.id }))}
                  className={`flex flex-col gap-0.5 p-3 rounded-xl border text-left transition-all ${form.auth_mode === m.id ? 'bg-accent border-accent' : 'bg-bg border-border'
                    }`}>
                  <p className={`text-xs font-semibold ${form.auth_mode === m.id ? 'text-white' : 'text-t1'}`}>{m.label}</p>
                  <p className={`text-[10px] ${form.auth_mode === m.id ? 'text-white/70' : 'text-t3'}`}>{m.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Description */}
        <div>
          <label className={cls.label}>Description <FormHelp text="Briefly explain what this MCP server provides." /></label>
          <textarea className="w-full px-3 py-2 rounded-xl text-sm bg-bg border border-border text-t1 outline-none focus:border-accent resize-y min-h-[60px] transition-colors"
            value={form.description} onChange={set('description')} placeholder="What does this server provide?" />
        </div>

        {errors.submit && <p className="text-sm text-danger">{errors.submit}</p>}
      </div>

      <div className="flex justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" loading={loading} onClick={submit} icon={Plus}>Add server</Btn>
      </div>
    </Modal>
  )
}



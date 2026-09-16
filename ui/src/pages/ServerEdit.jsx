/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Image as ImageIcon, Save } from 'lucide-react'
import api from '../lib/api'

const inputCls = 'w-full px-3 py-2.5 rounded-xl text-sm bg-bg border border-border text-t1 outline-none focus:border-accent font-mono transition-colors'
const labelCls = 'block text-[11px] font-bold uppercase tracking-widest text-t3 mb-1.5'

const RUNTIMES = [
  { id:'remote', label:'Remote', hint:'Existing HTTP server' },
  { id:'docker', label:'Docker', hint:'Docker image' },
  { id:'npx',    label:'NPX',    hint:'Node package' },
  { id:'uvx',    label:'UVX',    hint:'Python package' },
]

const AUTH_TYPES = [
  { id:'none',   label:'None',         desc:'No auth required' },
  { id:'bearer', label:'Bearer token', desc:'Static API key or token' },
  { id:'oauth',  label:'OAuth (MCP)',  desc:'Auto-discovered · RFC 9728' },
]

export default function ServerEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [errors, setErrors]   = useState({})
  const [runtime, setRuntime] = useState('remote')
  const [envVars, setEnvVars] = useState([{ key:'', value:'', type:'secret', required:true }])
  const [configuredEnvKeys, setConfiguredEnvKeys] = useState(new Set())
  const [hasSecrets, setHasSecrets] = useState({ auth_header_value:false, oauth_client_secret:false })
  // Extra static headers for "remote" servers — values are write-only (the
  // API never returns them), so an existing key with a blank value means
  // "keep whatever is already stored," same as the single auth_header_value
  // field above. Loaded from remote_header_keys (names only).
  const [remoteHeaders, setRemoteHeaders] = useState([])
  const [savedHeaderKeys, setSavedHeaderKeys] = useState(new Set())
  const [form, setForm] = useState({
    name:'', category:'', description:'', logo_url:'', url:'', remote_auth:'none',
    auth_header_name:'', auth_header_value:'',
    oauth_client_id:'', oauth_client_secret:'', oauth_auth_url:'', oauth_token_url:'', oauth_scopes:'', oauth_pkce:false, oauth_token_auth:'basic',
    docker_image:'', container_port:'8000', docker_args:'', package:'', args:'', system_packages:'', auth_mode:'none',
    cpu_limit:'', memory_limit:'', mcp_path:'',
  })

  const set = k => e => setForm(f => ({ ...f, [k]:e.target.value }))

  useEffect(() => {
    api.get(`/servers/${id}`)
      .then(({ data }) => {
        setRuntime(data.runtime||'remote')
        setForm({
          name:data.name||'', category:data.category||'', description:data.description||'',
          logo_url:data.logo_url||'',
          url:data.url||'', remote_auth:data.remote_auth||'none',
          auth_header_name:data.auth_header_name||'', auth_header_value:data.auth_header_value||'',
          oauth_client_id:data.oauth_client_id||'', oauth_client_secret:data.oauth_client_secret||'',
          oauth_auth_url:data.oauth_auth_url||'', oauth_token_url:data.oauth_token_url||'',
          oauth_scopes:data.oauth_scopes||'', oauth_pkce:data.oauth_pkce||false, oauth_token_auth:data.oauth_token_auth||'basic',
          docker_image:data.docker_image||'', container_port:data.container_port||'8000',
          docker_args:(data.docker_args||[]).join(' '), package:data.package||'',
          args:(data.args||[]).join(' '), system_packages:(data.system_packages||[]).join(', '), auth_mode:data.auth_mode||'none',
          cpu_limit:data.cpu_limit||'', memory_limit:data.memory_limit||'', mcp_path:data.mcp_path||'',
        })
        setHasSecrets({ auth_header_value:!!data.has_auth_header_value, oauth_client_secret:!!data.has_oauth_client_secret })
        setConfiguredEnvKeys(new Set(data.configured_user_config_keys || []))
        if (data.user_config_schema?.length>0) {
          setEnvVars(data.user_config_schema.map(s => ({ key:s.key||'', value:'', type:s.type==='secret'?'secret':'text', required:s.required !== false })))
        }
        if (data.remote_header_keys?.length>0) {
          setRemoteHeaders(data.remote_header_keys.map(key => ({ key, value:'' })))
          setSavedHeaderKeys(new Set(data.remote_header_keys))
        }
      })
      .catch(() => navigate('/servers'))
      .finally(() => setLoading(false))
  }, [id, navigate])

  const addEnvVar    = () => setEnvVars(v => [...v, { key:'', value:'', type:'secret', required:true }])
  const removeEnvVar = i => setEnvVars(v => v.filter((_,j) => j!==i))
  const setEnvVar    = (i, f, v) => setEnvVars(ev => ev.map((e,j) => j===i ? {...e,[f]:v} : e))

  const addRemoteHeader    = () => setRemoteHeaders(h => [...h, { key:'', value:'' }])
  const removeRemoteHeader = i => setRemoteHeaders(h => h.filter((_,j) => j!==i))
  const setRemoteHeader    = (i, f, v) => setRemoteHeaders(h => h.map((e,j) => j===i ? {...e,[f]:v} : e))

  const validate = () => {
    const e = {}
    if (!form.name.trim()) e.name='Name is required'
    if (runtime==='remote' && !form.url.trim()) e.url='URL is required'
    if (runtime==='docker' && !form.docker_image.trim()) e.docker_image='Docker image is required'
    if ((runtime==='npx'||runtime==='uvx') && !form.package.trim()) e.package='Package is required'
    setErrors(e); return Object.keys(e).length===0
  }

  const submit = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      const payload = {
        name:form.name.trim(), category:form.category.trim(), description:form.description.trim(),
        logo_url:form.logo_url.trim(), runtime,
      }
      if (runtime==='remote') {
        payload.url=form.url; payload.remote_auth=form.remote_auth
        if (form.remote_auth==='bearer') {
          payload.auth_header_name='Authorization'; payload.auth_type='bearer'
          if (form.auth_mode==='per_user') {
            payload.auth_mode='per_user'
            payload.user_config_schema=[{ key:'token', label:'Personal access token', type:'secret', placeholder:'' }]
          } else {
            payload.auth_mode='none'; payload.auth_header_value=form.auth_header_value
          }
        }
        else if (form.remote_auth==='header') { payload.auth_header_name=form.auth_header_name; payload.auth_header_value=form.auth_header_value; payload.auth_mode='none'; payload.auth_type='header' }
        else if (form.remote_auth==='oauth') { payload.auth_mode='per_user'; payload.auth_type='oauth'; payload.oauth_client_id=form.oauth_client_id; payload.oauth_client_secret=form.oauth_client_secret; payload.oauth_auth_url=form.oauth_auth_url; payload.oauth_token_url=form.oauth_token_url; payload.oauth_scopes=form.oauth_scopes; payload.oauth_pkce=form.oauth_pkce; payload.oauth_token_auth=form.oauth_token_auth }
        else payload.auth_mode='none'
        // Always sent (even empty) so removing every row actually clears them
        // server-side — same convention as docker_args/args below.
        payload.remote_headers = remoteHeaders.filter(h => h.key.trim()).map(h => ({ key:h.key.trim(), value:h.value }))
      }
      if (runtime==='docker') { payload.docker_image=form.docker_image; payload.container_port=parseInt(form.container_port)||8000; payload.docker_args=form.docker_args?form.docker_args.split(' ').filter(Boolean):[]; payload.mcp_path=form.mcp_path.trim()||null }
      if (runtime==='npx'||runtime==='uvx') {
        payload.package=form.package; payload.args=form.args?form.args.split(' ').filter(Boolean):[]
        payload.system_packages = form.system_packages ? form.system_packages.split(',').map(s=>s.trim()).filter(Boolean) : []
      }
      if (runtime==='docker'||runtime==='npx'||runtime==='uvx') {
        payload.cpu_limit = form.cpu_limit.trim() || null
        payload.memory_limit = form.memory_limit.trim() || null
      }
      const validEnvVars = runtime==='remote' ? [] : envVars.filter(v => v.key.trim())
      if (validEnvVars.length>0) {
        // Preserve required:false from catalog schemas. Without this, editing
        // a server turns optional variables into required ones on save.
        payload.user_config_schema = validEnvVars.map(v => ({ key:v.key, label:v.key, type:v.type, placeholder:'', required:v.required !== false }))
        const sharedVars = validEnvVars.filter(v => v.value.trim())
        if (sharedVars.length>0) { payload.auth_config=Object.fromEntries(sharedVars.map(v=>[v.key,v.value])); if (!payload.auth_mode||payload.auth_mode==='none') payload.auth_mode=form.auth_mode||'shared' }
      }
      await api.patch(`/servers/${id}`, payload)
      navigate(`/servers/${id}`)
    } catch(e) { setErrors({ submit:e.response?.data?.detail||'Failed to save changes' }) }
    finally { setSaving(false) }
  }

  const selBtn = (active) => `flex flex-col gap-1 p-3 rounded-xl border text-left transition-all cursor-pointer ${active ? 'bg-accent border-accent' : 'bg-bg border-border'}`
  const selTxt = (active, variant='title') => active ? (variant==='title' ? 'text-xs font-semibold text-white' : 'text-[9px] text-white/70') : (variant==='title' ? 'text-xs font-semibold text-t1' : 'text-[9px] text-t3')

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-sm text-t3">Loading…</p></div>

  return (
    <div className="animate-fade-in max-w-2xl">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => navigate(`/servers/${id}`)} className="w-9 h-9 flex items-center justify-center rounded-xl bg-card2 border border-border text-t3 hover:text-t1 transition-colors">
          <ArrowLeft size={17} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-t1">Edit server</h1>
          <p className="text-xs text-t3">Update server configuration</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card2 space-y-5 p-6">
        {/* Runtime */}
        <div>
          <label className={labelCls}>Runtime</label>
          <div className="grid grid-cols-4 gap-2">
            {RUNTIMES.map(r => (
              <button key={r.id} type="button" onClick={() => setRuntime(r.id)}
                className={`flex flex-col items-start gap-1.5 p-3 rounded-xl border text-left transition-all ${runtime===r.id ? 'bg-accent/15 border-accent ring-1 ring-accent' : 'bg-bg border-border'}`}>
                <p className={`text-xs font-semibold ${runtime===r.id?'text-accent':'text-t2'}`}>{r.label}</p>
                <p className="text-[9px] text-t3 leading-tight">{r.hint}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Name + Category */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Server name *</label>
            <input className="w-full px-3 py-2.5 rounded-xl text-sm bg-bg border border-border text-t1 outline-none focus:border-accent transition-colors" value={form.name} onChange={set('name')} placeholder="My MCP server" />
            {errors.name && <p className="text-xs text-danger mt-1">{errors.name}</p>}
          </div>
          <div>
            <label className={labelCls}>Category</label>
            <input className="w-full px-3 py-2.5 rounded-xl text-sm bg-bg border border-border text-t1 outline-none focus:border-accent transition-colors" value={form.category} onChange={set('category')} placeholder="productivity" />
          </div>
        </div>

        {/* Optional catalog icon */}
        <div>
          <label className={labelCls}>MCP icon URL</label>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center overflow-hidden bg-bg border border-border">
              {form.logo_url.trim()
                ? <img src={form.logo_url.trim()} alt="MCP icon preview" className="w-8 h-8 object-contain" />
                : <ImageIcon size={18} className="text-t3" />}
            </div>
            <input
              className={inputCls}
              type="url"
              value={form.logo_url}
              onChange={set('logo_url')}
              placeholder="https://example.com/mcp-icon.png"
            />
          </div>
          <p className="text-[10px] mt-1.5 text-t3">Clear the URL and save to remove the custom icon.</p>
        </div>

        {/* Remote */}
        {runtime==='remote' && (
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Server URL *</label>
              <input className={inputCls} value={form.url} onChange={set('url')} placeholder="https://your-mcp-server.com/mcp" />
              {errors.url && <p className="text-xs text-danger mt-1">{errors.url}</p>}
            </div>
            <div>
              <label className={labelCls}>Authentication type</label>
              <div className="grid grid-cols-3 gap-2">
                {AUTH_TYPES.map(a => (
                  <button key={a.id} type="button" onClick={() => setForm(f=>({...f,remote_auth:a.id}))} className={selBtn(form.remote_auth===a.id)}>
                    <p className={selTxt(form.remote_auth===a.id,'title')}>{a.label}</p>
                    <p className={selTxt(form.remote_auth===a.id,'desc')}>{a.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            {form.remote_auth==='bearer' && (
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>Credential mode</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[{id:'none',label:'Shared',desc:'Admin sets one token for everyone'},{id:'per_user',label:'Per user',desc:'Each member enters their own token'}].map(m => (
                      <button key={m.id} type="button" onClick={() => setForm(f=>({...f,auth_mode:m.id}))} className={selBtn(form.auth_mode===m.id)}>
                        <p className={selTxt(form.auth_mode===m.id,'title')}>{m.label}</p>
                        <p className={selTxt(form.auth_mode===m.id,'desc')}>{m.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
                {form.auth_mode==='per_user' ? (
                  <p className="text-xs text-t3">Members will be prompted to paste their own token in the portal before they can connect.</p>
                ) : (
                  <div>
                    <label className={labelCls}>Bearer token</label>
                    <input className={inputCls} type="password" value={form.auth_header_value} onChange={set('auth_header_value')} placeholder={hasSecrets.auth_header_value ? '•••••••• (saved — leave blank to keep)' : 'your-api-token-here'} />
                  </div>
                )}
              </div>
            )}
            {form.remote_auth==='oauth' && (
              <details open={!!form.oauth_client_id}>
                <summary className="text-[11px] font-semibold cursor-pointer text-t3 flex items-center gap-1.5 list-none">▶ Manual credentials (only if auto-discovery fails)</summary>
                <div className="mt-3 space-y-3 pl-3 border-l-2 border-border">
                  <p className="text-[10px] text-t3">Leave blank to use auto-discovery and dynamic registration. Required for providers like GitHub that don't support RFC 8414 metadata or dynamic client registration — create an OAuth App with the provider first, then fill in its Client ID/Secret and fixed authorize/token URLs below.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={labelCls}>Client ID</label><input className={inputCls} value={form.oauth_client_id||''} onChange={set('oauth_client_id')} placeholder="optional" /></div>
                    <div><label className={labelCls}>Client Secret</label><input className={inputCls} type="password" value={form.oauth_client_secret||''} onChange={set('oauth_client_secret')} placeholder={hasSecrets.oauth_client_secret ? '•••••••• (saved — leave blank to keep)' : 'optional'} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={labelCls}>Authorization URL</label><input className={inputCls} value={form.oauth_auth_url||''} onChange={set('oauth_auth_url')} placeholder="https://github.com/login/oauth/authorize" /></div>
                    <div><label className={labelCls}>Token URL</label><input className={inputCls} value={form.oauth_token_url||''} onChange={set('oauth_token_url')} placeholder="https://github.com/login/oauth/access_token" /></div>
                  </div>
                  <div><label className={labelCls}>Scopes</label><input className={inputCls} value={form.oauth_scopes||''} onChange={set('oauth_scopes')} placeholder="repo read:org read:user" /></div>
                  <div>
                    <label className={labelCls}>Token endpoint auth</label>
                    <select className={inputCls} value={form.oauth_token_auth||'basic'} onChange={set('oauth_token_auth')}>
                      <option value="basic">HTTP Basic (Notion, Stripe, Dropbox)</option>
                      <option value="body">Client ID/secret in body (GitHub, GitLab, Google, Slack)</option>
                      <option value="none">None — PKCE public client</option>
                    </select>
                  </div>
                </div>
              </details>
            )}

            {/* Extra headers — additive to whatever the auth type above already
                sends; for servers that need more than one custom header. */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={labelCls}>Extra headers <span className="normal-case font-normal text-t3">(optional, sent on every request)</span></label>
                <button onClick={addRemoteHeader} className="text-xs px-2 py-1 rounded-lg bg-accent/20 text-accent">+ Add header</button>
              </div>
              <div className="space-y-2">
                {remoteHeaders.map((h, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input className={`${inputCls} flex-1`} value={h.key} onChange={e=>setRemoteHeader(i,'key',e.target.value)} placeholder="X-Tenant-Id" />
                    <input className={`${inputCls} flex-[2]`} type="password" value={h.value} onChange={e=>setRemoteHeader(i,'value',e.target.value)} placeholder={savedHeaderKeys.has(h.key) ? '•••••••• (saved — leave blank to keep)' : 'value'} />
                    <button onClick={() => removeRemoteHeader(i)} className="text-t3 hover:text-danger transition-colors">✕</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Docker */}
        {runtime==='docker' && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className={labelCls}>Docker image *</label>
                <input className={inputCls} value={form.docker_image} onChange={set('docker_image')} placeholder="e.g. mcp/notion" />
                {errors.docker_image && <p className="text-xs text-danger mt-1">{errors.docker_image}</p>}
              </div>
              <div><label className={labelCls}>Container port</label><input className={inputCls} value={form.container_port} onChange={set('container_port')} placeholder="8000" /></div>
            </div>
            <div><label className={labelCls}>Extra args (space-separated)</label><input className={inputCls} value={form.docker_args} onChange={set('docker_args')} placeholder="--transport http --port 3000" /></div>
            <div>
              <label className={labelCls}>MCP endpoint path <span className="normal-case font-normal text-t3">(optional)</span></label>
              <input className={inputCls} value={form.mcp_path} onChange={set('mcp_path')} placeholder="/mcp (default)" />
            </div>
          </div>
        )}

        {/* NPX/UVX */}
        {(runtime==='npx'||runtime==='uvx') && (
          <div className="space-y-3">
            <div>
              <label className={labelCls}>{runtime==='npx'?'NPM package':'Python package'} *</label>
              <input className={inputCls} value={form.package} onChange={set('package')} placeholder={runtime==='npx'?'@github/mcp-server':'mcp-server-sentry'} />
              {errors.package && <p className="text-xs text-danger mt-1">{errors.package}</p>}
            </div>
            <div><label className={labelCls}>Args (space-separated)</label><input className={inputCls} value={form.args} onChange={set('args')} placeholder="Optional args" /></div>
            <div>
              <label className={labelCls}>System packages <span className="normal-case font-normal text-t3">(optional)</span></label>
              <input className={inputCls} value={form.system_packages} onChange={set('system_packages')} placeholder="e.g. git" />
              <p className="text-xs mt-1 text-t3">Comma-separated apt package names this server needs (e.g. <code className="text-accent">git</code>) — installed automatically before it starts, no Docker image required.</p>
            </div>
          </div>
        )}

        {/* Resource limits — docker/npx/uvx only; clamped server-side to the operator's ceiling */}
        {(runtime==='docker'||runtime==='npx'||runtime==='uvx') && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>CPU limit</label>
              <input className={inputCls} value={form.cpu_limit} onChange={set('cpu_limit')} placeholder="e.g. 1.5 (blank = default)" />
            </div>
            <div>
              <label className={labelCls}>Memory limit</label>
              <input className={inputCls} value={form.memory_limit} onChange={set('memory_limit')} placeholder="e.g. 512m (blank = default)" />
            </div>
          </div>
        )}

        {/* Env vars — container runtimes only; remote servers authenticate via
            the auth type / credential mode controls above, not env vars. */}
        {runtime!=='remote' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls}>Credentials / environment variables</label>
              <button onClick={addEnvVar} className="text-xs px-2 py-1 rounded-lg bg-accent/20 text-accent">+ Add variable</button>
            </div>
            <div className="space-y-2">
              {envVars.map((v, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input className={`${inputCls} flex-1`} value={v.key} onChange={e=>setEnvVar(i,'key',e.target.value)} placeholder="ENV_VAR_NAME" />
                  <input className={`${inputCls} flex-[2]`} type={v.type==='secret'?'password':'text'} value={v.value} onChange={e=>setEnvVar(i,'value',e.target.value)} placeholder={configuredEnvKeys.has(v.key) ? '•••••••• (saved — leave blank to keep)' : 'Value (leave empty for per-user)'} />
                  <select value={v.type} onChange={e=>setEnvVar(i,'type',e.target.value)} className="px-2 py-2.5 rounded-xl text-sm bg-bg border border-border text-t3 outline-none">
                    <option value="secret">Secret</option><option value="text">Text</option>
                  </select>
                  {envVars.length>1 && <button onClick={() => removeEnvVar(i)} className="text-t3 hover:text-danger transition-colors">✕</button>}
                </div>
              ))}
            </div>
            <p className="text-xs mt-1.5 text-t3">
              {configuredEnvKeys.size > 0 && <><span className="text-accent">Already configured values are hidden.</span> Leave them blank to keep the saved values. </>}
              Leave value empty if each user should provide their own credentials.
            </p>
          </div>
        )}

        {/* Auth mode */}
        {runtime!=='remote' && envVars.some(v => v.key.trim()) && (
          <div>
            <label className={labelCls}>Credential mode</label>
            <div className="grid grid-cols-2 gap-2">
              {[{id:'shared',label:'Shared',desc:'Admin sets credentials once for everyone'},{id:'per_user',label:'Per user',desc:'Each user enters their own credentials'}].map(m => (
                <button key={m.id} type="button" onClick={() => setForm(f=>({...f,auth_mode:m.id}))} className={selBtn(form.auth_mode===m.id)}>
                  <p className={selTxt(form.auth_mode===m.id,'title')}>{m.label}</p>
                  <p className={selTxt(form.auth_mode===m.id,'desc')}>{m.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Description */}
        <div>
          <label className={labelCls}>Description</label>
          <textarea className="w-full px-3 py-2.5 rounded-xl text-sm bg-bg border border-border text-t1 outline-none focus:border-accent resize-y min-h-[60px] transition-colors"
            value={form.description} onChange={set('description')} placeholder="What does this server provide?" />
        </div>

        {errors.submit && <p className="text-sm text-danger">{errors.submit}</p>}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button onClick={() => navigate(`/servers/${id}`)} className="px-4 py-2 rounded-xl text-sm font-semibold bg-bg text-t2 border border-border hover:border-border2 transition-colors">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-60">
            <Save size={14} /> {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

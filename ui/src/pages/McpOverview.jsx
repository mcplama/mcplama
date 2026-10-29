/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Cable, Maximize2, Network, RefreshCw, RotateCcw, Search, Server, Shield, UserRound, Wrench, X, ZoomIn, ZoomOut } from 'lucide-react'
import api from '../lib/api'
import { Spinner } from '../components/ui'
import { useTheme } from '../hooks/useTheme'

const nodeW = 184, nodeH = 76, toolW = 204, toolH = 28, groupW = 132, toolPreviewLimit = 4
const widthOf = n => n.type === 'tool' ? toolW : n.type === 'toolGroup' ? groupW : nodeW
const heightOf = n => n.type === 'tool' || n.type === 'toolGroup' ? toolH : nodeH
const makePalettes = dark => ({
  user: { stroke: dark ? '#38bdf8' : '#0284c7', fill: dark ? '#082f49' : '#e0f2fe', icon: UserRound },
  connection: { stroke: dark ? '#a78bfa' : '#7c3aed', fill: dark ? '#2e1065' : '#ede9fe', icon: Cable },
  gateway: { stroke: dark ? '#22d3ee' : '#0891b2', fill: dark ? '#083344' : '#cffafe', icon: Network },
  server: { stroke: dark ? '#34d399' : '#059669', fill: dark ? '#064e3b' : '#d1fae5', icon: Server },
  tool: { stroke: dark ? '#94a3b8' : '#64748b', fill: dark ? '#1e293b' : '#e2e8f0', icon: Wrench },
})
const short = (value, n = 22) => value?.length > n ? `${value.slice(0, n - 1)}…` : value
const validConnection = c => c.is_active && (!c.expires_at || new Date(c.expires_at).getTime() > Date.now())
const recentlyUsed = c => { const age = c.last_used_at ? Date.now() - new Date(c.last_used_at).getTime() : Infinity; return age >= 0 && age <= 30 * 60 * 1000 }

export default function McpOverview() {
  const { theme } = useTheme()
  const dark = theme === 'dark'
  const palettes = useMemo(() => makePalettes(dark), [dark])
  const mapStyle = {
    '--map-bg': dark ? '#070b12' : '#f3f6fa', '--map-panel': dark ? '#0b111c' : '#ffffff',
    '--map-panel-soft': dark ? '#080d16' : '#f8fafc', '--map-grid-dot': dark ? '#334155' : '#cbd5e1',
    '--map-label': dark ? '#f1f5f9' : '#0f172a', '--map-sub': dark ? '#94a3b8' : '#475569',
    '--map-muted': dark ? '#94a3b8' : '#475569', '--map-border': dark ? 'rgba(255,255,255,.1)' : '#cbd5e1',
    '--map-control-text': dark ? '#cbd5e1' : '#334155',
  }
  const [data, setData] = useState({ servers: null, connections: null, users: null, policies: null })
  const [totals, setTotals] = useState({})
  const [errors, setErrors] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [query, setQuery] = useState('')
  const [userFilter, setUserFilter] = useState('all')
  const [serverFilter, setServerFilter] = useState('all')
  const [toolFilter, setToolFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expandedServers, setExpandedServers] = useState(() => new Set())
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 })
  const [positions, setPositions] = useState({})
  const drag = useRef(null)
  const canvas = useRef(null)
  const positionsRef = useRef(positions)
  positionsRef.current = positions

  const load = useCallback(async () => {
    setLoading(true)
    const req = [
      ['servers', '/servers?limit=200'], ['connections', '/connections?limit=200'],
      ['users', '/users?limit=200'], ['policies', '/policies?limit=200'],
    ]
    const results = await Promise.allSettled(req.map(([, path]) => api.get(path)))
    const next = {}, nextTotals = {}, failed = []
    results.forEach((r, i) => {
      const key = req[i][0]
      if (r.status === 'rejected') { next[key] = null; failed.push(key); return }
      next[key] = r.value.data.map(row => {
        if (key !== 'connections') return row
        // The connections API includes bearer tokens for its management UI; discard them immediately.
        const { token, mcp_url, ...safe } = row
        return safe
      })
      nextTotals[key] = Number(r.value.headers?.['x-total-count'] ?? r.value.data.length)
    })
    setData(next); setTotals(nextTotals); setErrors(failed); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const users = data.users || [], connections = data.connections || [], servers = data.servers || [], policies = data.policies || []
  const connectedUsers = users.filter(u => connections.some(c => c.user_id === u.id))
  const graph = useMemo(() => {
    const nodes = [], edges = []
    const addNode = n => nodes.push(n)
    const owners = users.filter(u => connections.some(c => c.user_id === u.id))
    const connectionY = new Map()
    let clientY = 74
    owners.forEach(user => {
      const owned = connections.filter(c => c.user_id === user.id)
      const groupHeight = Math.max(1, owned.length) * 108
      addNode({ id: `u:${user.id}`, type: 'user', entity: user, x: 42, y: clientY + (groupHeight - nodeH) / 2, label: user.name || user.email, sub: user.email, status: `${user.role || 'user'} · ${owned.length} connection${owned.length === 1 ? '' : 's'}` })
      owned.forEach((c, i) => connectionY.set(c.id, clientY + i * 108 + 16))
      clientY += groupHeight + 22
    })
    const orphanConnections = connections.filter(c => !users.some(u => u.id === c.user_id))
    orphanConnections.forEach((c, i) => connectionY.set(c.id, clientY + i * 108 + 16))
    connections.forEach(c => {
      const active = validConnection(c)
      addNode({ id: `c:${c.id}`, type: 'connection', entity: c, x: 306, y: connectionY.get(c.id) ?? 74, label: c.label || c.server_name || `Connection ${c.id}`, sub: c.user_email || `User ${c.user_id}`, status: !active ? c.is_active ? 'Expired' : 'Inactive' : recentlyUsed(c) ? 'Used in last 30m' : 'Ready · no recent use' })
      edges.push({ id: `uc:${c.id}`, from: `u:${c.user_id}`, to: `c:${c.id}`, kind: 'ownership', active })
      // The connection token is a configured route through the gateway to its recorded server.
      edges.push({ id: `cg:${c.id}`, from: `c:${c.id}`, to: 'gateway', kind: 'configured', active })
    })
    servers.forEach(s => {
      const linked = connections.filter(c => c.server_id === s.id)
      if (!linked.length) return
      const activeCount = linked.filter(validConnection).length
      edges.push({ id: `gs:${s.id}`, from: 'gateway', to: `s:${s.id}`, kind: 'serverRoute', active: activeCount > 0 && s.is_enabled, connectionCount: linked.length, activeConnections: activeCount })
    })
    const gatewayY = connections.length ? Math.max(74, (Math.min(...connections.map(c => connectionY.get(c.id) ?? 74)) + Math.max(...connections.map(c => connectionY.get(c.id) ?? 74))) / 2) : 346
    addNode({ id: 'gateway', type: 'gateway', x: 622, y: gatewayY, label: 'MCPlama Gateway', sub: 'Configured proxy path', status: 'Gateway' })
    let serverY = 86
    servers.forEach(s => {
      const y = serverY
      addNode({ id: `s:${s.id}`, type: 'server', entity: s, x: 906, y, label: s.name, sub: `${s.runtime || 'Unknown'} · ${s.transport || 'Unknown'}`, status: s.is_enabled ? `Enabled · ${s.status || 'status unknown'}` : 'Disabled' })
      const allTools = Array.isArray(s.tools) ? s.tools : []
      const isExpanded = expandedServers.has(s.id)
      const shownTools = allTools.slice(0, isExpanded ? allTools.length : toolPreviewLimit)
      if (toolFilter !== 'all' && allTools.includes(toolFilter) && !shownTools.includes(toolFilter)) shownTools.push(toolFilter)
      shownTools.forEach((tool, j) => {
        const toolIndex = allTools.indexOf(tool)
        addNode({ id: `t:${s.id}:${toolIndex}`, type: 'tool', entity: { name: tool, server: s }, x: 1190, y: y + j * 34 + 10, label: tool, sub: s.name, status: s.is_enabled ? 'Registered' : 'Server disabled' })
        edges.push({ id: `st:${s.id}:${toolIndex}`, from: `s:${s.id}`, to: `t:${s.id}:${toolIndex}`, kind: 'registered' })
      })
      const hiddenCount = allTools.length - shownTools.length
      if (hiddenCount > 0 || isExpanded && allTools.length > toolPreviewLimit) {
        const groupLabel = isExpanded ? 'Show fewer' : `+ ${hiddenCount} more tools`
        addNode({ id: `tg:${s.id}`, type: 'toolGroup', entity: { server: s, hiddenCount }, x: 1190, y: y + shownTools.length * 34 + 10, label: groupLabel, sub: '', status: isExpanded ? 'Collapse list' : 'Expand list' })
        edges.push({ id: `sg:${s.id}`, from: `s:${s.id}`, to: `tg:${s.id}`, kind: 'registered' })
      }
      serverY += Math.max(130, (shownTools.length + (hiddenCount > 0 || isExpanded ? 1 : 0)) * 34 + 38)
    })
    return { nodes, edges }
  }, [users, connections, servers, expandedServers, toolFilter])

  const gatewayNode = graph.nodes.find(n => n.id === 'gateway')
  const selected = graph.nodes.find(n => n.id === selectedId)
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const userServerIds = userFilter === 'all' ? null : new Set(connections.filter(c => String(c.user_id) === userFilter).map(c => c.server_id))
    const toolServerIds = toolFilter === 'all' ? null : new Set(servers.filter(s => (s.tools || []).includes(toolFilter)).map(s => s.id))
    const nodes = graph.nodes.filter(n => {
      if (userFilter !== 'all' && n.type === 'user' && String(n.entity.id) !== userFilter) return false
      if (userFilter !== 'all' && n.type === 'connection' && String(n.entity.user_id) !== userFilter) return false
      if (userServerIds && (n.type === 'server' && !userServerIds.has(n.entity.id) || (n.type === 'tool' || n.type === 'toolGroup') && !userServerIds.has(n.entity.server?.id ?? n.entity.server.id))) return false
      if (serverFilter !== 'all' && (n.type === 'server' && String(n.entity.id) !== serverFilter || (n.type === 'tool' || n.type === 'toolGroup') && String(n.entity.server?.id ?? n.entity.server.id) !== serverFilter || n.type === 'connection' && String(n.entity.server_id) !== serverFilter || n.type === 'user' && !connections.some(c => c.user_id === n.entity.id && String(c.server_id) === serverFilter))) return false
      if (toolFilter !== 'all' && n.type === 'tool' && n.label !== toolFilter) return false
      if (toolFilter !== 'all' && n.type === 'toolGroup') return false
      if (toolServerIds && (n.type === 'server' && !toolServerIds.has(n.entity.id) || n.type === 'connection' && !toolServerIds.has(n.entity.server_id) || n.type === 'user' && !connections.some(c => c.user_id === n.entity.id && toolServerIds.has(c.server_id)) || n.type === 'tool' && !toolServerIds.has(n.entity.server.id))) return false
      if (statusFilter === 'active' && (n.type === 'connection' && !validConnection(n.entity) || n.type === 'server' && !n.entity.is_enabled || n.type === 'user' && !n.entity.is_active || n.type === 'tool' && !n.entity.server.is_enabled)) return false
      if (statusFilter === 'attention' && !(n.type === 'connection' && !validConnection(n.entity) || n.type === 'server' && !n.entity.is_enabled || n.type === 'user' && !n.entity.is_active || n.type === 'tool' && !n.entity.server.is_enabled)) return false
      if (q && !`${n.label} ${n.sub} ${n.type}`.toLowerCase().includes(q)) return false
      return true
    })
    const ids = new Set(nodes.map(n => n.id))
    // Retain a path only where both real endpoints remain in the filtered graph.
    return { nodes, edges: graph.edges.filter(e => ids.has(e.from) && ids.has(e.to)) }
  }, [graph, userFilter, serverFilter, toolFilter, statusFilter, query])

  const related = useMemo(() => {
    if (!selectedId) return null
    const chosen = graph.nodes.find(n => n.id === selectedId)
    if (!chosen) return null
    const serverId = chosen.type === 'server' ? chosen.entity.id : chosen.type === 'tool' ? chosen.entity.server.id : chosen.type === 'connection' ? chosen.entity.server_id : null
    const connIds = chosen.type === 'user' ? connections.filter(c => c.user_id === chosen.entity.id).map(c => c.id)
      : chosen.type === 'connection' ? [chosen.entity.id]
        : serverId != null ? connections.filter(c => c.server_id === serverId).map(c => c.id)
        : chosen.type === 'gateway' ? connections.map(c => c.id) : []
    const userIds = chosen.type === 'user' ? [chosen.entity.id] : connections.filter(c => connIds.includes(c.id)).map(c => c.user_id)
    const serverIds = serverId != null ? [serverId] : [...new Set(connections.filter(c => connIds.includes(c.id)).map(c => c.server_id))]
    const ids = new Set([selectedId, 'gateway', ...userIds.map(id => `u:${id}`), ...connIds.map(id => `c:${id}`), ...serverIds.map(id => `s:${id}`)])
    graph.nodes.filter(n => (n.type === 'tool' || n.type === 'toolGroup') && serverIds.includes(n.entity.server?.id ?? n.entity.server.id)).forEach(n => ids.add(n.id))
    const edges = new Set(graph.edges.filter(e => ids.has(e.from) && ids.has(e.to)).map(e => e.id))
    return { ids, edges }
  }, [selectedId, graph, connections])

  const fit = useCallback(() => {
    if (!canvas.current || !visible.nodes.length) return
    const rect = canvas.current.getBoundingClientRect()
    const minX = Math.min(...visible.nodes.map(n => (positionsRef.current[n.id]?.x ?? n.x)))
    const maxX = Math.max(...visible.nodes.map(n => (positionsRef.current[n.id]?.x ?? n.x) + widthOf(n)))
    const minY = Math.min(...visible.nodes.map(n => (positionsRef.current[n.id]?.y ?? n.y)))
    const maxY = Math.max(...visible.nodes.map(n => (positionsRef.current[n.id]?.y ?? n.y) + heightOf(n)))
    const scale = Math.max(.38, Math.min(1.12, Math.min((rect.width - 72) / (maxX - minX + 80), (rect.height - 72) / (maxY - minY + 80))))
    setViewport({ scale, x: (rect.width - (maxX - minX) * scale) / 2 - minX * scale, y: (rect.height - (maxY - minY) * scale) / 2 - minY * scale })
  }, [visible.nodes])
  useEffect(() => { if (!loading) fit() }, [loading, fit])

  const onPointerDown = (e, node) => {
    e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId)
    const p = positions[node.id] || { x: node.x, y: node.y }
    drag.current = { id: node.id, startX: e.clientX, startY: e.clientY, x: p.x, y: p.y }
  }
  const onPointerMove = e => {
    if (!drag.current) return
    const d = drag.current
    setPositions(old => ({ ...old, [d.id]: { x: d.x + (e.clientX - d.startX) / viewport.scale, y: d.y + (e.clientY - d.startY) / viewport.scale } }))
  }
  const onPointerUp = () => { drag.current = null }
  const onCanvasDown = e => { if (e.target.closest('[data-node]')) return; drag.current = { pan: true, startX: e.clientX, startY: e.clientY, x: viewport.x, y: viewport.y } }
  const onWheel = e => { e.preventDefault(); const factor = e.deltaY < 0 ? 1.1 : .91; setViewport(v => ({ ...v, scale: Math.max(.28, Math.min(2, v.scale * factor)) })) }
  const canvasMove = e => {
    if (!drag.current) return
    if (drag.current.pan) { const d = drag.current; setViewport(v => ({ ...v, x: d.x + e.clientX - d.startX, y: d.y + e.clientY - d.startY })); return }
    onPointerMove(e)
  }
  const policyRows = selected?.type === 'tool'
    ? policies.filter(p => p.is_enabled && (p.server_id == null || p.server_id === selected.entity.server.id) && ['tool_allow', 'tool_block'].includes(p.policy_type) && ((p.config?.tools || []).includes(selected.entity.name) || p.policy_type === 'tool_allow' && !(p.config?.tools || []).length))
    : selected?.type === 'server'
      ? policies.filter(p => p.is_enabled && (p.server_id == null || p.server_id === selected.entity.id))
      : selected?.type === 'user'
        ? policies.filter(p => p.is_enabled && (p.user_id == null || p.user_id === selected.entity.id) && (p.role == null || p.role === selected.entity.role))
        : selected?.type === 'connection'
          ? (() => { const u = users.find(user => user.id === selected.entity.user_id); return policies.filter(p => p.is_enabled && (p.server_id == null || p.server_id === selected.entity.server_id) && (p.user_id == null || p.user_id === selected.entity.user_id) && (p.role == null || p.role === u?.role)) })()
        : []

  const isPartial = errors.length > 0 || Object.entries(totals).some(([key, total]) => total > (data[key]?.length || 0))
  const connectionsArePartial = errors.includes('connections') || totals.connections > connections.length
  const activeTokenCount = data.connections ? connections.filter(validConnection).length : null
  const handleNodeClick = n => {
    if (n.type === 'toolGroup') {
      const serverId = n.entity.server.id
      setExpandedServers(current => {
        const next = new Set(current)
        next.has(serverId) ? next.delete(serverId) : next.add(serverId)
        return next
      })
      setSelectedId(`s:${serverId}`)
      return
    }
    setSelectedId(n.id)
  }
  return <main style={{ ...mapStyle, background: 'var(--map-bg)', color: 'var(--map-control-text)' }} className={`permission-map ${dark ? '' : 'permission-map-light'} -m-4 flex min-h-[calc(100vh-60px)] flex-col md:-m-6`}>
    <header className="z-10 flex flex-wrap items-center gap-3 border-b border-white/10 bg-[#0b111c] px-4 py-3 md:px-6" style={{ background: 'var(--map-panel)', borderColor: 'var(--map-border)' }}>
      <div className="mr-2 flex items-center gap-2"><Network size={19} className="text-cyan-500"/><h1 className="text-sm font-semibold tracking-wide text-slate-800 dark:text-slate-100">MCP Network</h1></div>
      <label className="relative min-w-[160px] flex-1 sm:max-w-[260px]"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/><input aria-label="Search map" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search nodes…" className="w-full rounded-lg border border-white/10 bg-[#080d16] py-2 pl-9 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-500/50" style={{ background: 'var(--map-panel-soft)', color: 'var(--map-control-text)', borderColor: 'var(--map-border)' }}/></label>
      <select aria-label="Filter users" value={userFilter} onChange={e => setUserFilter(e.target.value)} className="map-select"><option value="all">All connected users</option>{connectedUsers.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}</select>
      <select aria-label="Filter servers" value={serverFilter} onChange={e => setServerFilter(e.target.value)} className="map-select"><option value="all">All servers</option>{servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <select aria-label="Filter tools" value={toolFilter} onChange={e => setToolFilter(e.target.value)} className="map-select"><option value="all">All tools</option>{[...new Set(servers.flatMap(s => s.tools || []))].map(t => <option key={t}>{t}</option>)}</select>
      <select aria-label="Filter status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="map-select"><option value="all">Any status</option><option value="active">Active</option><option value="attention">Needs attention</option></select>
      <button type="button" onClick={load} title="Refresh data" className="map-button"><RefreshCw size={15}/></button>
      <button type="button" onClick={() => { setPositions({}); setViewport({ x: 0, y: 0, scale: 1 }); window.requestAnimationFrame(() => window.requestAnimationFrame(fit)) }} title="Reset dragged nodes" className="map-button"><RotateCcw size={14}/></button>
    </header>
    {isPartial && <div className="border-b border-amber-400/20 bg-amber-500/10 px-5 py-2 text-xs text-amber-200">Partial topology: {errors.length ? `failed to load ${errors.join(', ')}` : 'one or more API lists exceed the 200-record display limit'}. Missing relationships are not inferred.</div>}
    {loading && !data.servers && <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#070b12]"><Spinner size={24}/></div>}
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <div ref={canvas} onPointerDown={onCanvasDown} onPointerMove={canvasMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel} className="relative min-h-[620px] flex-1 cursor-grab overflow-hidden active:cursor-grabbing" title="Drag the canvas to pan · drag a node to rearrange · scroll to zoom">
        <svg className="absolute inset-0 h-full w-full" aria-label="MCPlama network graph" role="img">
          <defs><pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="var(--map-grid-dot)" opacity=".7"/></pattern><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#64748b"/></marker></defs>
          <rect width="100%" height="100%" fill="url(#dots)"/>
          <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
            <text x="42" y="34" className="map-column">USERS / CLIENTS</text><text x="306" y="34" className="map-column">MCP CONNECTIONS</text><text x="622" y={gatewayNode.y - 18} className="map-column">GATEWAY</text><text x="906" y="52" className="map-column">MCP SERVERS</text><text x="1190" y="52" className="map-column">REGISTERED TOOLS</text>
            {visible.edges.map(e => {
              const a = graph.nodes.find(n => n.id === e.from), b = graph.nodes.find(n => n.id === e.to)
              if (!a || !b) return null
              const ap = positions[a.id] || a, bp = positions[b.id] || b
              const highlighted = !related || related.edges.has(e.id)
              const active = e.active !== false
              const aWidth = widthOf(a), aHeight = heightOf(a), bHeight = heightOf(b)
              const path = `M ${ap.x + aWidth} ${ap.y + aHeight / 2} C ${ap.x + aWidth + 46} ${ap.y + aHeight / 2}, ${bp.x - 46} ${bp.y + bHeight / 2}, ${bp.x} ${bp.y + bHeight / 2}`
              return <g key={e.id} opacity={highlighted ? 1 : .12}><path d={path} fill="none" stroke={active ? (e.kind === 'registered' ? '#64748b' : '#06b6d4') : '#f59e0b'} strokeWidth={highlighted ? 1.8 : 1.2} strokeDasharray={e.kind === 'registered' ? '3 5' : active ? undefined : '5 5'} markerEnd="url(#arrow)"/><title>{e.kind === 'ownership' ? 'Recorded user ownership' : e.kind === 'configured' ? `Configured path · ${active ? 'connection active and unexpired' : 'connection inactive or expired'}` : e.kind === 'serverRoute' ? `${e.connectionCount} recorded connection${e.connectionCount === 1 ? '' : 's'} · ${e.activeConnections} active and unexpired` : 'Tool registered on server'}</title></g>
            })}
            {visible.nodes.map(n => {
              const p = positions[n.id] || n, pal = palettes[n.type === 'toolGroup' ? 'tool' : n.type], Icon = pal.icon
              const active = n.type === 'connection' ? validConnection(n.entity) : n.type === 'server' || n.type === 'user' ? n.entity.is_enabled ?? n.entity.is_active : n.type === 'tool' || n.type === 'toolGroup' ? n.entity.server.is_enabled : true
              const highlighted = !related || related.ids.has(n.id), chosen = selectedId === n.id
              if (n.type === 'tool') return <g key={n.id} data-node="true" transform={`translate(${p.x} ${p.y})`} onPointerDown={e => onPointerDown(e, n)} onClick={() => handleNodeClick(n)} className="cursor-grab active:cursor-grabbing" opacity={highlighted ? 1 : .2}><title>Registered tool · click to inspect</title><rect width={toolW} height={toolH} rx="14" fill={pal.fill} stroke={chosen ? '#f8fafc' : active ? pal.stroke : '#f59e0b'} strokeWidth={chosen ? 2 : 1}/><circle cx="14" cy="14" r="3" fill={active ? '#34d399' : '#f59e0b'}/><text x="25" y="18" className="map-tool-label">{short(n.label, 29)}</text></g>
              if (n.type === 'toolGroup') return <g key={n.id} data-node="true" transform={`translate(${p.x} ${p.y})`} onPointerDown={e => onPointerDown(e, n)} onClick={() => handleNodeClick(n)} className="cursor-pointer" opacity={highlighted ? 1 : .2}><title>{n.status} for {n.entity.server.name}</title><rect width={groupW} height={toolH} rx="14" fill="var(--map-panel)" stroke={pal.stroke} strokeDasharray="4 3"/><text x={groupW / 2} y="18" textAnchor="middle" className="map-tool-label">{short(n.label, 22)}</text></g>
              return <g key={n.id} data-node="true" transform={`translate(${p.x} ${p.y})`} onPointerDown={e => onPointerDown(e, n)} onClick={() => handleNodeClick(n)} className="cursor-grab active:cursor-grabbing" opacity={highlighted ? 1 : .2}>
                <title>Drag to rearrange · click to inspect {n.type}</title><rect width={nodeW} height={nodeH} rx={n.type === 'user' ? 22 : 10} fill={pal.fill} stroke={chosen ? '#f8fafc' : active ? pal.stroke : '#f59e0b'} strokeWidth={chosen ? 2.5 : 1.4}/>
                <foreignObject x="12" y="15" width="24" height="24"><div xmlns="http://www.w3.org/1999/xhtml" className="flex h-6 w-6 items-center justify-center" style={{color: active ? pal.stroke : '#fbbf24'}}><Icon size={17}/></div></foreignObject>
                <text x="45" y="31" className="map-label">{short(n.label, 20)}</text><text x="45" y="49" className="map-sub">{short(n.sub, 23)}</text>
                <circle cx="166" cy="60" r="3.5" fill={active ? '#34d399' : '#f59e0b'}/><text x="158" y="65" textAnchor="end" className="map-status">{short(n.status, 20)}</text>
              </g>
            })}
          </g>
        </svg>
        <div className="absolute bottom-4 left-4 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-white/10 bg-[#0b111c]/95 px-3 py-2 text-[10px] text-slate-400 shadow-xl backdrop-blur" style={{ background: 'var(--map-panel)', borderColor: 'var(--map-border)' }}>
          <Legend color="#38bdf8" label="User"/><Legend color="#a78bfa" label="Connection"/><Legend color="#22d3ee" label="Gateway"/><Legend color="#34d399" label="Server"/><Legend color="#94a3b8" label="Tool"/><span className="h-3 border-l border-white/15"/><span><i className="mr-1 inline-block w-5 border-t border-cyan-400"/>Configured path</span><span><i className="mr-1 inline-block w-5 border-t border-dashed border-slate-500"/>Registered tool</span><span><i className="mr-1 inline-block w-5 border-t border-dashed border-amber-400"/>Inactive / expired</span><span className="hidden border-l border-white/15 pl-3 lg:inline">Drag nodes to tidy · drag canvas to pan</span>
        </div>
        <div className="absolute right-4 bottom-4 flex flex-col gap-1"><button title="Zoom in" className="map-button" onClick={() => setViewport(v => ({...v, scale: Math.min(2, v.scale * 1.2)}))}><ZoomIn size={15}/></button><button title="Zoom out" className="map-button" onClick={() => setViewport(v => ({...v, scale: Math.max(.28, v.scale / 1.2)}))}><ZoomOut size={15}/></button><button title="Fit graph" className="map-button" onClick={fit}><Maximize2 size={14}/></button></div>
        <div className="absolute right-4 top-4 flex flex-wrap justify-end gap-2 text-[10px]"><span className="rounded-lg border px-2.5 py-1.5" style={{ background: 'var(--map-panel)', borderColor: 'var(--map-border)', color: 'var(--map-muted)' }}>{visible.nodes.length} nodes · {visible.edges.length} links</span><span className="rounded-lg border px-2.5 py-1.5" style={{ background: 'var(--map-panel)', borderColor: 'var(--map-border)', color: 'var(--map-control-text)' }}>{errors.includes('connections') ? '—' : connectionsArePartial ? '≥ ' : ''}{activeTokenCount ?? '—'} active, unexpired tokens</span></div>
        {!loading && !errors.length && users.length === 0 && connections.length === 0 && servers.length === 0 && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className="max-w-sm rounded-xl border border-white/10 bg-[#0b111c]/95 p-5 text-center shadow-xl"><Network className="mx-auto mb-3 text-slate-600" size={30}/><p className="text-sm font-medium text-slate-300">No configured topology yet</p><p className="mt-1 text-xs text-slate-500">The gateway is shown as the proxy component. Add servers and create user connections to populate the map.</p><Link to="/servers" className="pointer-events-auto mt-3 inline-block text-xs text-cyan-400">Manage servers →</Link></div></div>}
      </div>
      {selected && <aside className="absolute inset-y-0 right-0 z-10 w-[min(360px,90vw)] overflow-y-auto border-l border-white/10 bg-[#0b111c]/[.98] p-5 shadow-2xl backdrop-blur md:relative md:w-[330px] md:shrink-0" style={{ background: 'var(--map-panel)', borderColor: 'var(--map-border)' }}>
        <div className="mb-5 flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-slate-500">Selected {selected.type}</p><h2 className="mt-1 break-words text-base font-semibold text-slate-100">{selected.label}</h2></div><button onClick={() => setSelectedId(null)} aria-label="Close details" className="map-button"><X size={15}/></button></div>
        <Details selected={selected} connections={connections} servers={servers} users={users} policies={policyRows}/>
      </aside>}
    </div>
    <style>{`.map-select{max-width:170px;border:1px solid var(--map-border);border-radius:.5rem;background:var(--map-panel-soft);padding:.48rem .6rem;color:var(--map-control-text);font-size:11px;outline:none}.map-select option{background:var(--map-panel);color:var(--map-control-text)}.map-button{display:flex;height:32px;width:32px;align-items:center;justify-content:center;border:1px solid var(--map-border);border-radius:.5rem;background:var(--map-panel);color:var(--map-muted);transition:all .15s}.map-button:hover{border-color:rgba(34,211,238,.55);color:#0891b2}.map-column{fill:var(--map-muted);font-size:10px;font-family:ui-monospace,monospace;letter-spacing:1.8px}.map-label{fill:var(--map-label);font-size:12px;font-family:ui-monospace,monospace;font-weight:600}.map-sub,.map-status{fill:var(--map-sub);font-size:10px;font-family:ui-monospace,monospace}.map-status{font-size:8px}.map-traffic{fill:var(--map-muted);font-size:8px;font-family:ui-monospace,monospace}.permission-map-light .text-slate-100{color:#0f172a!important}.permission-map-light .text-slate-200{color:#1e293b!important}.permission-map-light .text-slate-300{color:#334155!important}.permission-map-light .text-slate-400,.permission-map-light .text-slate-500{color:#475569!important}.permission-map-light .text-slate-600{color:#64748b!important}.permission-map-light .border-white\\/10{border-color:#cbd5e1!important}.permission-map-light .bg-white\\/\\[\\.02\\]{background:#f8fafc!important}`}</style>
  </main>
}

function Legend({ color, label }) { return <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: color }}/>{label}</span> }
function Field({ name, value }) { return <div className="flex items-start justify-between gap-4 border-b border-white/[.06] py-2.5"><span className="shrink-0 text-[11px] text-slate-500">{name}</span><span className="break-all text-right text-[11px] text-slate-200">{value ?? 'Unknown'}</span></div> }
function Details({ selected, connections, servers, users, policies }) {
  const n = selected
  const connCount = n.type === 'server' ? connections.filter(c => c.server_id === n.entity.id).length : 0
  const userConns = n.type === 'user' ? connections.filter(c => c.user_id === n.entity.id) : []
  return <>
    {n.type === 'user' && <><Field name="Email" value={n.entity.email}/><Field name="Role" value={n.entity.role}/><Field name="Account" value={n.entity.is_active ? 'Active' : 'Inactive'}/><Field name="Recorded connections" value={userConns.length}/><PolicySummary policies={policies}/><div className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Connections owned by user</div>{userConns.length ? userConns.map(c => <Field key={c.id} name={c.label || c.server_name} value={`${c.is_active ? 'Active' : 'Inactive'} · ${c.expires_at ? `expires ${new Date(c.expires_at).toLocaleDateString()}` : 'no expiry'}`}/>) : <p className="mt-2 text-xs text-slate-500">No connection records.</p>}</>}
    {n.type === 'connection' && <><Field name="Label" value={n.entity.label}/><Field name="User" value={n.entity.user_email || `User ${n.entity.user_id}`}/><Field name="Server" value={n.entity.server_name || `Server ${n.entity.server_id}`}/><Field name="Connection state" value={n.entity.is_active ? 'Active' : 'Inactive'}/><Field name="Current validity" value={validConnection(n.entity) ? 'Active and unexpired' : n.entity.is_active ? 'Expired' : 'Inactive'}/><Field name="Created" value={new Date(n.entity.created_at).toLocaleString()}/><Field name="Last used" value={n.entity.last_used_at ? new Date(n.entity.last_used_at).toLocaleString() : 'Not recorded'}/><Field name="Expires" value={n.entity.expires_at ? new Date(n.entity.expires_at).toLocaleString() : 'No expiry set'}/><p className="mt-3 rounded-lg border border-violet-400/20 bg-violet-400/5 p-3 text-[11px] leading-5 text-violet-200">A connection record establishes a configured route. Active status reflects token state and expiry; it does not prove the client is currently connected.</p><PolicySummary policies={policies}/><Link className="mt-3 inline-block text-xs text-cyan-400" to="/connections">Manage connections ↗</Link></>}
    {n.type === 'server' && <><Field name="Runtime" value={n.entity.runtime}/><Field name="Transport" value={n.entity.transport}/><Field name="Enabled" value={n.entity.is_enabled ? 'Yes' : 'No'}/><Field name="Reported status" value={n.entity.status || 'Unknown'}/><Field name="Registered tools" value={n.entity.tools?.length ?? 'Unknown'}/><Field name="Recorded connections" value={connCount}/><Field name="Version" value={n.entity.version || 'Not provided'}/><PolicySummary policies={policies}/><Link className="mt-3 inline-block text-xs text-cyan-400" to={`/servers/${n.entity.id}`}>Manage server ↗</Link></>}
    {n.type === 'tool' && <><Field name="Registered on" value={n.entity.server.name}/><Field name="Server state" value={n.entity.server.is_enabled ? 'Enabled' : 'Disabled'}/><PolicySummary policies={policies} toolName={n.entity.name}/><p className="mt-3 text-[11px] leading-5 text-slate-500">Registration shows the server reports this tool. It does not establish permission for any user.</p><Link className="mt-3 inline-block text-xs text-cyan-400" to={`/servers/${n.entity.server.id}`}>View server ↗</Link></>}
    {n.type === 'gateway' && <><Field name="Component" value="MCPlama Gateway"/><Field name="Role" value="Connection proxy"/><Field name="Topology basis" value="Connections route through the gateway to their recorded MCP server."/><p className="mt-3 text-[11px] leading-5 text-slate-500">Gateway node represents the product's configured proxy path, not a live health check.</p></>}
  </>
}
function PolicySummary({ policies, toolName }) {
  return <section className="mt-5"><div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500"><Shield size={12}/> Matching configured policies</div>{policies.length ? policies.map(p => <div key={p.id} className="mb-2 rounded-lg border border-white/[.08] bg-white/[.02] p-2.5"><div className="text-xs text-slate-200">{p.name}</div><div className="mt-1 text-[10px] text-slate-500">{p.policy_type}{p.policy_type === 'tool_allow' ? ` · ${toolName ? `configured list includes ${toolName}` : `tool list: ${(p.config?.tools || []).join(', ') || 'empty'}`}` : p.policy_type === 'tool_block' ? ` · ${toolName ? `configured to block ${toolName}` : `tools: ${(p.config?.tools || []).join(', ')}`}` : ''}</div><div className="mt-1 text-[9px] text-slate-600">{p.user_id ? `User ID ${p.user_id}` : 'All users'}{p.role ? ` · role ${p.role}` : ''}{p.server_id ? ` · server ID ${p.server_id}` : ' · all servers'}</div></div>) : <p className="text-[11px] leading-5 text-slate-500">No matching enabled policy record. Effective access is not inferred by this map.</p>}</section>
}

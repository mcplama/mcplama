/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Server, ShieldCheck, Trash2, UsersRound, X } from 'lucide-react'
import api from '../lib/api'
import { Spinner } from '../components/ui'
import { Paginator } from '../components/ui/Paginator'
import { usePagination } from '../hooks/usePagination'
import Button from '../components/kit/Button'

const panel = 'rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]'
const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-theme-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-white/[0.03]'

export default function GroupsPage() {
  const [groups, setGroups] = useState([])
  const [users, setUsers] = useState([])
  const [servers, setServers] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })
  const [addUserId, setAddUserId] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const results = await Promise.allSettled([
      api.get('/groups'), api.get('/users?limit=200'), api.get('/servers?limit=200'),
    ])
    if (results.some(r => r.status === 'rejected')) setError('Some group data could not be loaded. Check your admin access and retry.')
    if (results[0].status === 'fulfilled') setGroups(results[0].value.data)
    if (results[1].status === 'fulfilled') setUsers(results[1].value.data)
    if (results[2].status === 'fulfilled') setServers(results[2].value.data)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const selected = groups.find(g => g.id === selectedId) || groups[0] || null
  const { page, setPage, totalPages, paginated } = usePagination(groups)
  const memberIds = useMemo(() => new Set((selected?.members || []).map(m => m.id)), [selected])
  const serverIds = useMemo(() => new Set((selected?.servers || []).map(s => s.id)), [selected])
  const availableUsers = users.filter(u => !memberIds.has(u.id))
  const replaceGroup = updated => setGroups(current => current.map(g => g.id === updated.id ? updated : g))

  const createGroup = async e => {
    e.preventDefault(); if (!form.name.trim()) return
    setSaving(true); setError('')
    try {
      const { data } = await api.post('/groups', { name: form.name.trim(), description: form.description.trim() || null })
      setGroups(current => [...current, data].sort((a, b) => a.name.localeCompare(b.name)))
      setSelectedId(data.id); setForm({ name: '', description: '' }); setShowCreate(false)
    } catch (err) { setError(err.response?.data?.detail || 'Could not create group') }
    finally { setSaving(false) }
  }
  const removeGroup = async () => {
    if (!selected || !window.confirm(`Delete “${selected.name}”? Its group grants will be removed.`)) return
    setSaving(true); setError('')
    try {
      await api.delete(`/groups/${selected.id}`)
      setGroups(current => current.filter(g => g.id !== selected.id)); setSelectedId(null)
    } catch (err) { setError(err.response?.data?.detail || 'Could not delete group') }
    finally { setSaving(false) }
  }
  const addMember = async () => {
    if (!selected || !addUserId) return
    setSaving(true); setError('')
    try {
      const { data } = await api.post(`/groups/${selected.id}/members/${addUserId}`)
      replaceGroup(data); setAddUserId('')
    } catch (err) { setError(err.response?.data?.detail || 'Could not add member') }
    finally { setSaving(false) }
  }
  const removeMember = async id => {
    if (!selected) return
    setSaving(true); setError('')
    try { const { data } = await api.delete(`/groups/${selected.id}/members/${id}`); replaceGroup(data) }
    catch (err) { setError(err.response?.data?.detail || 'Could not remove member') }
    finally { setSaving(false) }
  }
  const toggleServer = async serverId => {
    if (!selected) return
    setSaving(true); setError('')
    try {
      const { data } = serverIds.has(serverId)
        ? await api.delete(`/groups/${selected.id}/servers/${serverId}`)
        : await api.post(`/groups/${selected.id}/servers/${serverId}`)
      replaceGroup(data)
    } catch (err) { setError(err.response?.data?.detail || 'Could not update server access') }
    finally { setSaving(false) }
  }

  if (loading) return <div className="flex h-64 items-center justify-center"><Spinner size={24}/></div>
  return <div className="animate-fade-in">
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
    <header className="flex flex-col gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
      <div><h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Groups</h3><p className="text-sm text-gray-500 dark:text-gray-400">Manage team membership and MCP server access</p></div>
      <div className="flex items-center gap-3"><button className={`${button} h-10 w-10 p-0`} onClick={load} title="Refresh" aria-label="Refresh groups"><RefreshCw size={14}/></button><Button variant="primary" size="sm" startIcon={<Plus size={14}/>} onClick={() => setShowCreate(v => !v)}>New group</Button></div>
    </header>
    <div className="space-y-5 p-4 sm:p-5">
    {error && <div role="alert" className="rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">{error}</div>}
    {showCreate && <form onSubmit={createGroup} className={`${panel} grid gap-3 p-4 sm:grid-cols-[1fr_2fr_auto_auto] sm:items-end`}>
      <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Group name<input autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} maxLength={120} placeholder="Engineering" className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"/></label>
      <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Description<input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional" className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"/></label>
      <Button size="sm" disabled={saving || !form.name.trim()}>{saving ? 'Creating…' : 'Create'}</Button><button type="button" className={button} onClick={() => setShowCreate(false)}><X size={14}/> Cancel</button>
    </form>}
    <div className="grid gap-5 xl:grid-cols-[300px_1fr]">
      <section className={`${panel} overflow-hidden`}>
        <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800"><h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">Your groups <span className="ml-1 text-xs font-normal text-gray-400">{groups.length}</span></h2></div>
        {groups.length === 0 ? <div className="p-6 text-center"><UsersRound size={24} className="mx-auto text-gray-400"/><p className="mt-3 text-sm font-medium text-gray-800 dark:text-white">No groups yet</p><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Create a group, add users, then grant server access.</p></div> : <><div className="max-h-[65vh] space-y-1 overflow-auto p-2">{paginated.map(g => <button key={g.id} onClick={() => setSelectedId(g.id)} className={`w-full rounded-xl px-3 py-3 text-left transition ${selected?.id === g.id ? 'bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-500/10 dark:ring-brand-500/30' : 'hover:bg-gray-50 dark:hover:bg-white/[.04]'}`}><span className="block truncate text-sm font-medium text-gray-800 dark:text-white/90">{g.name}</span><span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{g.members.length} members · {g.servers.length} servers</span></button>)}</div><Paginator page={page} totalPages={totalPages} onChange={setPage} total={groups.length}/></>}
      </section>
      {selected ? <section className="space-y-5">
        <div className={`${panel} flex flex-wrap items-start justify-between gap-3 p-5`}><div><h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">{selected.name}</h2><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{selected.description || 'No description'}</p></div><button className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-error-600 transition-colors hover:bg-error-50 dark:text-error-400 dark:hover:bg-error-500/10" onClick={removeGroup} disabled={saving}><Trash2 size={14}/> Delete group</button></div>
        <div className="grid gap-5 lg:grid-cols-2">
          <section className={`${panel} overflow-hidden`}><div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800"><UsersRound size={16} className="text-brand-500"/><div><h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">Members</h3><p className="text-xs text-gray-500 dark:text-gray-400">{selected.members.length} users</p></div></div><div className="flex gap-2 border-b border-gray-100 p-3 dark:border-gray-800"><select aria-label="Choose user to add" value={addUserId} onChange={e => setAddUserId(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"><option value="">Add a user…</option>{availableUsers.map(u => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}</select><button className={button} disabled={!addUserId || saving} onClick={addMember}><Plus size={14}/> Add</button></div><div className="divide-y divide-gray-100 dark:divide-gray-800">{selected.members.map(m => <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-gray-800 dark:text-white/90">{m.name || m.email}</p><p className="truncate text-xs text-gray-500 dark:text-gray-400">{m.email} · {m.role}{!m.is_active ? ' · disabled' : ''}</p></div><button aria-label={`Remove ${m.email}`} onClick={() => removeMember(m.id)} disabled={saving} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-error-500 dark:hover:bg-white/10"><X size={14}/></button></div>)}{selected.members.length === 0 && <p className="px-4 py-6 text-center text-xs text-gray-500 dark:text-gray-400">No members in this group yet.</p>}</div></section>
          <section className={`${panel} overflow-hidden`}><div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800"><ShieldCheck size={16} className="text-success-500"/><div><h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">MCP server access</h3><p className="text-xs text-gray-500 dark:text-gray-400">{selected.servers.length} servers granted to this group</p></div></div><div className="divide-y divide-gray-100 dark:divide-gray-800">{servers.map(s => { const granted = serverIds.has(s.id); return <label key={s.id} className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/[.02]"><input type="checkbox" checked={granted} disabled={saving} onChange={() => toggleServer(s.id)} className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"/><Server size={15} className={granted ? 'text-brand-500' : 'text-gray-400'}/><span className="min-w-0 flex-1"><span className="block truncate text-sm text-gray-800 dark:text-white/90">{s.name}</span><span className="block text-xs text-gray-500 dark:text-gray-400">{s.runtime || 'Unknown runtime'} · {s.transport || 'Unknown transport'}{!s.is_enabled ? ' · disabled' : ''}</span></span>{granted && <span className="rounded-full bg-success-50 px-2 py-1 text-[10px] text-success-700 dark:bg-success-500/10 dark:text-success-400">Granted</span>}</label>})}{servers.length === 0 && <p className="px-4 py-6 text-center text-xs text-gray-500 dark:text-gray-400">No servers are configured.</p>}</div></section>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">Group grants are checked when a user connects. Removing a user or grant revokes group-derived access; another direct or group grant can still keep access in place.</p>
      </section> : <section className={`${panel} flex min-h-64 items-center justify-center p-8 text-center`}><div><UsersRound size={28} className="mx-auto text-gray-400"/><p className="mt-3 text-sm text-gray-600 dark:text-gray-300">Select a group to manage its members and server grants.</p></div></section>}
    </div>
    </div>
    </div>
  </div>
}

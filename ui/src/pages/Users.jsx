/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Users as UsersIcon } from 'lucide-react'
import api from '../lib/api'
import { parseServerTimestamp } from '../lib/formatTime'
import { Toggle, Spinner, EmptyState } from '../components/ui'
import { Paginator } from '../components/ui/Paginator'
import { usePagination } from '../hooks/usePagination'
import { useBackendPagination } from './_shared'
import { Table, TableHeader, TableBody, TableRow, TableCell } from '../components/kit/Table'
import Badge from '../components/kit/Badge'
import Button from '../components/kit/Button'

const UserAvatar = ({ name, email }) => {
  const letter = (name || email || '?')[0].toUpperCase()
  return (
    <div className="w-10 h-10 rounded-full bg-brand-50 dark:bg-brand-500/15 flex items-center justify-center shrink-0 ring-1 ring-brand-200 dark:ring-brand-500/20">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-brand-500 dark:text-brand-400">
        <path d="M12 12c2.7614 0 5-2.2386 5-5s-2.2386-5-5-5-5 2.2386-5 5 2.2386 5 5 5zm0 2c-3.3317 0-10 1.6717-10 5v1h20v-1c0-3.3283-6.6683-5-10-5z" />
      </svg>
      <span className="sr-only">{letter}</span>
    </div>
  )
}

const TABS = [
  { id: 'team',        label: 'Users' },
  { id: 'invitations', label: 'Invitations' },
  { id: 'requests',    label: 'Requests' },
]

export default function Users() {
  const [activeTab, setActiveTab]   = useState('team')
  const [invites, setInvites]       = useState([])
  const [requests, setRequests]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'member' })
  const [inviting, setInviting]     = useState(false)
  const [copied, setCopied]         = useState(null)

  const { data: users, total: usersTotal, page: uPage, setPage: setUPage, totalPages: uTotalPages, reload: reloadUsers, PAGE_SIZE: U_PS } =
    useBackendPagination((limit, offset) => api.get(`/users?limit=${limit}&offset=${offset}`))

  const load = useCallback(() =>
    Promise.all([
      api.get('/auth/invites').catch(() => ({ data: [] })),
      api.get('/requests').catch(() => ({ data: [] })),
    ])
      .then(([i, r]) => { setInvites(i.data); setRequests(r.data) })
      .finally(() => setLoading(false))
  , [])
  useEffect(() => { load() }, [load])

  const updateUser  = async (id, params) => { await api.patch('/users/' + id, params); reloadUsers() }
  const deleteUser  = async (id) => { if (!confirm('Delete this user?')) return; await api.delete('/users/' + id); reloadUsers() }

  const inviteUrl = (token) => `${window.location.origin}/invite/${token}`
  const copyToClipboard = (text) => {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
    const el = document.createElement('textarea')
    el.value = text; el.style.position = 'fixed'; el.style.opacity = '0'
    document.body.appendChild(el); el.select(); document.execCommand('copy')
    document.body.removeChild(el); return Promise.resolve()
  }

  const createInvite = async (sendEmail = false) => {
    if (!inviteForm.email.trim()) return
    setInviting(true)
    try {
      const { data } = await api.post('/auth/invite', { ...inviteForm, send_email: sendEmail })
      setInvites(i => [data, ...i])
      setShowInvite(false)
      setInviteForm({ email: '', role: 'member' })
      if (!sendEmail) copyToClipboard(inviteUrl(data.token)).then(() => { setCopied('new'); setTimeout(() => setCopied(null), 3000) })
    } catch (e) { alert(e.response?.data?.detail || 'Failed to create invite') } finally { setInviting(false) }
  }

  const copyInviteUrl  = (token, id) => { copyToClipboard(inviteUrl(token)).then(() => { setCopied(id); setTimeout(() => setCopied(null), 2000) }) }
  const deleteInvite   = async (id) => { await api.delete(`/auth/invites/${id}`); setInvites(i => i.filter(x => x.id !== id)) }
  const approveRequest = async (id) => { await api.post(`/requests/${id}/approve`); setRequests(rs => rs.filter(r => r.id !== id)); load() }
  const denyRequest    = async (id) => { await api.post(`/requests/${id}/deny`); setRequests(rs => rs.filter(r => r.id !== id)) }
  const revokeAccess   = async (req) => {
    if (!confirm(`Revoke ${req.user_name}'s access to ${req.server_name}?`)) return
    await api.delete(`/servers/${req.server_id}/members/${req.user_id}`)
    setRequests(rs => rs.filter(r => r.id !== req.id))
  }

  const { page: iPage, setPage: setIPage, totalPages: iTotalPages, paginated: pInvites } = usePagination(invites)
  const pending        = requests.filter(r => r.status === 'pending')
  const pendingInvites = invites.filter(i => !i.accepted)

  const tabBadge = { team: 0, invitations: pendingInvites.length, requests: pending.length }

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner size={24} /></div>

  return (
    <div className="animate-fade-in">
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">

        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Users</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">{usersTotal} members</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Tabs */}
            <div className="hidden h-11 items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 lg:inline-flex dark:bg-gray-900">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => { setActiveTab(t.id); if (t.id === 'invitations') setShowInvite(false) }}
                  className={`text-theme-sm h-10 rounded-md px-3 py-2 font-medium hover:text-gray-900 dark:hover:text-white flex items-center gap-1.5 ${
                    activeTab === t.id
                      ? 'shadow-theme-xs bg-white text-gray-900 dark:bg-gray-800 dark:text-white'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {t.label}
                  {tabBadge[t.id] > 0 && (
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-warning-500 text-white text-[10px] font-bold">
                      {tabBadge[t.id]}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <Button
              variant="primary"
              size="sm"
              startIcon={<Plus size={14} />}
              onClick={() => { setActiveTab('invitations'); setShowInvite(true) }}
            >
              Invite user
            </Button>
          </div>
        </div>

        {/* ── TEAM TAB ── */}
        {activeTab === 'team' && (
          <>
            <div className="overflow-x-auto">
              {users.length === 0 ? (
                <div className="py-12"><EmptyState icon={UsersIcon} title="No users yet" description="Invite your first team member" /></div>
              ) : (
                <Table>
                  <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                    <TableRow>
                      {['Member', 'Role', 'Status', 'Joined', ''].map((h, i) => (
                        <TableCell key={i} isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400 whitespace-nowrap">
                          {h}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                    {users.map(u => (
                      <TableRow key={u.id} className="transition hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                        <TableCell className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <UserAvatar name={u.name} email={u.email} />
                            <div className="min-w-0">
                              <span className="block font-medium text-gray-800 text-theme-sm dark:text-white/90 truncate">{u.name}</span>
                              <span className="block text-gray-500 text-theme-xs dark:text-gray-400 truncate">{u.email}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-5 py-4">
                          <select
                            value={u.role}
                            onChange={e => updateUser(u.id, { role: e.target.value })}
                            className="text-theme-xs rounded-lg px-2.5 py-1.5 bg-gray-50 border border-gray-200 text-gray-700 outline-none cursor-pointer dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300"
                          >
                            <option value="admin">Admin</option>
                            <option value="member">Member</option>
                          </select>
                        </TableCell>
                        <TableCell className="px-5 py-4 whitespace-nowrap">
                          <Badge size="sm" color={u.is_active ? 'success' : 'error'}>
                            {u.is_active ? 'Active' : 'Disabled'}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-5 py-4 text-theme-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {u.created_at ? parseServerTimestamp(u.created_at).toLocaleDateString() : '—'}
                        </TableCell>
                        <TableCell className="px-5 py-4 whitespace-nowrap">
                          <div className="flex items-center justify-end gap-3">
                            <Toggle enabled={u.is_active} onChange={v => updateUser(u.id, { is_active: v })} />
                            <button
                              onClick={() => deleteUser(u.id)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-error-500 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            {uTotalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-200 px-5 py-4 dark:border-gray-800">
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  Showing <span className="text-gray-800 dark:text-white/90">{(uPage - 1) * U_PS + 1}</span> to{' '}
                  <span className="text-gray-800 dark:text-white/90">{Math.min(uPage * U_PS, usersTotal)}</span> of{' '}
                  <span className="text-gray-800 dark:text-white/90">{usersTotal}</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setUPage(p => Math.max(1, p - 1))}
                    disabled={uPage === 1}
                    className={`shadow-theme-xs flex items-center justify-center rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 ${uPage === 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <svg className="fill-current" width="16" height="16" viewBox="0 0 20 20" fill="none">
                      <path fillRule="evenodd" clipRule="evenodd" d="M2.58203 9.99868C2.58174 10.1909 2.6549 10.3833 2.80152 10.53L7.79818 15.5301C8.09097 15.8231 8.56584 15.8233 8.85883 15.5305C9.15183 15.2377 9.152 14.7629 8.85921 14.4699L5.13911 10.7472L16.6665 10.7472C17.0807 10.7472 17.4165 10.4114 17.4165 9.99715C17.4165 9.58294 17.0807 9.24715 16.6665 9.24715L5.14456 9.24715L8.85919 5.53016C9.15199 5.23717 9.15184 4.7623 8.85885 4.4695C8.56587 4.1767 8.09099 4.17685 7.79819 4.46984L2.84069 9.43049C2.68224 9.568 2.58203 9.77087 2.58203 9.99715C2.58203 9.99766 2.58203 9.99817 2.58203 9.99868Z" fill="" />
                    </svg>
                  </button>
                  {Array.from({ length: Math.min(uTotalPages, 5) }, (_, i) => i + 1).map(p => (
                    <button
                      key={p}
                      onClick={() => setUPage(p)}
                      className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-medium transition ${p === uPage ? 'bg-brand-500 text-white' : 'text-gray-600 hover:bg-brand-500 hover:text-white dark:text-gray-400'}`}
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    onClick={() => setUPage(p => Math.min(uTotalPages, p + 1))}
                    disabled={uPage === uTotalPages}
                    className={`shadow-theme-xs flex items-center justify-center rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 ${uPage === uTotalPages ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <svg className="fill-current" width="16" height="16" viewBox="0 0 20 20" fill="none">
                      <path fillRule="evenodd" clipRule="evenodd" d="M17.4165 9.9986C17.4168 10.1909 17.3437 10.3832 17.197 10.53L12.2004 15.5301C11.9076 15.8231 11.4327 15.8233 11.1397 15.5305C10.8467 15.2377 10.8465 14.7629 11.1393 14.4699L14.8594 10.7472L3.33203 10.7472C2.91782 10.7472 2.58203 10.4114 2.58203 9.99715C2.58203 9.58294 2.91782 9.24715 3.33203 9.24715L14.854 9.24715L11.1393 5.53016C10.8465 5.23717 10.8467 4.7623 11.1397 4.4695C11.4327 4.1767 11.9075 4.17685 12.2003 4.46984L17.1578 9.43049C17.3163 9.568 17.4165 9.77087 17.4165 9.99715C17.4165 9.99763 17.4165 9.99812 17.4165 9.9986Z" fill="" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── INVITATIONS TAB ── */}
        {activeTab === 'invitations' && (
          <>
            {showInvite && (
              <div className="border-b border-gray-200 bg-gray-50 px-5 py-5 dark:border-gray-800 dark:bg-white/[0.02] space-y-4 animate-fade-in">
                <p className="text-sm font-semibold text-gray-800 dark:text-white/90">Invite a new team member</p>
                <div className="flex gap-3">
                  <input
                    className="flex-[2] rounded-lg px-3 py-2.5 text-sm bg-white border border-gray-300 text-gray-800 outline-none focus:border-brand-300 dark:bg-gray-900 dark:border-gray-700 dark:text-white/90"
                    type="email" value={inviteForm.email}
                    onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="colleague@company.com"
                    onKeyDown={e => e.key === 'Enter' && createInvite(false)}
                    autoFocus
                  />
                  <select
                    className="flex-1 rounded-lg px-3 py-2.5 text-sm bg-white border border-gray-300 text-gray-800 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-white/90"
                    value={inviteForm.role} onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="primary" size="sm" onClick={() => createInvite(true)} disabled={inviting}>Send by email</Button>
                  <Button variant="outline" size="sm" onClick={() => createInvite(false)} disabled={inviting}>
                    {copied === 'new' ? '✓ Link copied!' : 'Copy link instead'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowInvite(false)}>Cancel</Button>
                </div>
                <p className="text-xs text-gray-400">Email requires SMTP configured in Settings. Copy link works without email.</p>
              </div>
            )}
            <div className="overflow-x-auto">
              {invites.length === 0 ? (
                <div className="py-12"><EmptyState icon={UsersIcon} title="No invitations yet" description="Invite a team member using the button above" /></div>
              ) : (
                <Table>
                  <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                    <TableRow>
                      {['Email', 'Role', 'Expires', 'Status', ''].map((h, i) => (
                        <TableCell key={i} isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                          {h}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                    {pInvites.map(inv => (
                      <TableRow key={inv.id} className="transition hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                        <TableCell className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-brand-50 dark:bg-brand-500/15 flex items-center justify-center shrink-0 ring-1 ring-brand-200 dark:ring-brand-500/20">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-brand-500 dark:text-brand-400">
                                <path d="M12 12c2.7614 0 5-2.2386 5-5s-2.2386-5-5-5-5 2.2386-5 5 2.2386 5 5 5zm0 2c-3.3317 0-10 1.6717-10 5v1h20v-1c0-3.3283-6.6683-5-10-5z" />
                              </svg>
                            </div>
                            <span className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{inv.email}</span>
                          </div>
                        </TableCell>
                        <TableCell className="px-5 py-4 whitespace-nowrap">
                          <Badge size="sm" color="light">{inv.role}</Badge>
                        </TableCell>
                        <TableCell className="px-5 py-4 text-theme-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {parseServerTimestamp(inv.expires_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="px-5 py-4 whitespace-nowrap">
                          {inv.accepted
                            ? <Badge size="sm" color="success">Accepted</Badge>
                            : <Badge size="sm" color="warning">Pending</Badge>
                          }
                        </TableCell>
                        <TableCell className="px-5 py-4 whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            {!inv.accepted && (
                              <button
                                onClick={() => copyInviteUrl(inv.token, inv.id)}
                                className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${copied === inv.id ? 'bg-success-50 text-success-600 border-success-200 dark:bg-success-500/10 dark:text-success-400' : 'bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400'}`}
                              >
                                {copied === inv.id ? '✓ Copied' : 'Copy link'}
                              </button>
                            )}
                            <button onClick={() => deleteInvite(inv.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-error-500 transition-colors">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            {iTotalPages > 1 && (
              <div className="border-t border-gray-200 dark:border-gray-800">
                <Paginator page={iPage} totalPages={iTotalPages} onChange={setIPage} total={invites.length} />
              </div>
            )}
          </>
        )}

        {/* ── REQUESTS TAB ── */}
        {activeTab === 'requests' && (
          <div className="overflow-x-auto">
            {requests.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-gray-400">No access requests</p>
              </div>
            ) : (
              <Table>
                <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                  <TableRow>
                    {['User', 'Server', 'Message', 'Date', 'Status', ''].map((h, i) => (
                      <TableCell key={i} isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400 whitespace-nowrap">
                        {h}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {requests.map(req => (
                    <TableRow key={req.id} className="transition hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                      <TableCell className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-brand-50 dark:bg-brand-500/15 flex items-center justify-center shrink-0 ring-1 ring-brand-200 dark:ring-brand-500/20">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-brand-500 dark:text-brand-400">
                              <path d="M12 12c2.7614 0 5-2.2386 5-5s-2.2386-5-5-5-5 2.2386-5 5 2.2386 5 5 5zm0 2c-3.3317 0-10 1.6717-10 5v1h20v-1c0-3.3283-6.6683-5-10-5z" />
                            </svg>
                          </div>
                          <div className="min-w-0">
                            <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{req.user_name}</p>
                            <p className="text-theme-xs text-gray-400">{req.user_email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-5 py-4 whitespace-nowrap">
                        <Badge size="sm" color="light">{req.server_name}</Badge>
                      </TableCell>
                      <TableCell className="px-5 py-4 max-w-[200px]">
                        {req.message
                          ? <p className="text-theme-xs text-gray-500 dark:text-gray-400 italic truncate">"{req.message}"</p>
                          : <span className="text-theme-xs text-gray-300">—</span>
                        }
                      </TableCell>
                      <TableCell className="px-5 py-4 text-theme-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {parseServerTimestamp(req.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="px-5 py-4 whitespace-nowrap">
                        <Badge size="sm" color={req.status === 'approved' ? 'success' : req.status === 'denied' ? 'error' : 'warning'}>
                          {req.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-5 py-4 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          {req.status === 'pending' && <>
                            <button onClick={() => approveRequest(req.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-success-50 text-success-700 border border-success-200 hover:bg-success-100 transition-colors dark:bg-success-500/10 dark:text-success-400 dark:border-success-500/20">Approve</button>
                            <button onClick={() => denyRequest(req.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-error-50 text-error-600 border border-error-200 hover:bg-error-100 transition-colors dark:bg-error-500/10 dark:text-error-400 dark:border-error-500/20">Deny</button>
                          </>}
                          {req.status === 'approved' && (
                            <button onClick={() => revokeAccess(req)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-error-50 text-error-600 border border-error-200 hover:bg-error-100 transition-colors dark:bg-error-500/10 dark:text-error-400 dark:border-error-500/20">Revoke</button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

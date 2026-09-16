/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState } from 'react'
import { Trash2, Link2, Clock, Copy, Check } from 'lucide-react'
import { PageHeader, Spinner } from '../components/ui'
import { Paginator } from '../components/ui/Paginator'
import { useBackendPagination } from './_shared'
import { useAuth } from '../hooks/useAuth'
import { copyText } from '../lib/clipboard'
import { parseServerTimestamp } from '../lib/formatTime'
import api from '../lib/api'

function fixMcpUrl(url) {
  try { return window.location.origin + new URL(url).pathname } catch { return url }
}

function fmtDate(iso) {
  if (!iso) return '—'
  return parseServerTimestamp(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtRelative(iso) {
  if (!iso) return 'Never'
  const diff = Date.now() - parseServerTimestamp(iso)
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return fmtDate(iso)
}

function isExpired(iso) {
  return iso && parseServerTimestamp(iso) < new Date()
}

function CopyUrlButton({ url }) {
  const [copied, setCopied] = useState(false)
  const copy = async (e) => {
    e.stopPropagation()
    try {
      await copyText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Copy failed', err)
    }
  }
  return (
    <button
      onClick={copy}
      title={url}
      className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-brand-500 dark:text-gray-500 dark:hover:text-brand-400 shrink-0"
    >
      {copied ? <Check size={12} className="text-success-500" /> : <Copy size={12} />}
    </button>
  )
}

// Inline expiry editor shown to admins
function ExpiryCell({ conn, onUpdated }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(
    conn.expires_at ? parseServerTimestamp(conn.expires_at).toISOString().slice(0, 10) : ''
  )
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await api.patch(`/connections/${conn.id}`, {
        expires_at: value ? new Date(value).toISOString() : null,
      })
      onUpdated()
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="date"
          value={value}
          onChange={e => setValue(e.target.value)}
          className="text-xs border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-white"
        />
        <button
          onClick={save}
          disabled={saving}
          className="text-xs text-brand-500 hover:text-brand-600 font-medium disabled:opacity-50"
        >
          {saving ? '...' : 'Save'}
        </button>
        <button
          onClick={() => setEditing(false)}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-brand-500 dark:hover:text-brand-400 group"
      title="Set expiry"
    >
      {conn.expires_at ? (
        <span className={isExpired(conn.expires_at) ? 'text-error-500 dark:text-error-400' : ''}>
          {fmtDate(conn.expires_at)}
        </span>
      ) : (
        <span className="text-gray-400 dark:text-gray-600">Never</span>
      )}
      <Clock size={13} className="opacity-0 group-hover:opacity-60 transition-opacity" />
    </button>
  )
}

export function Connections() {
  const [revoking, setRevoking] = useState(null)
  const { isAdmin } = useAuth()

  const { data: connections, total, page, setPage, totalPages, loading, reload: load, PAGE_SIZE } =
    useBackendPagination((limit, offset) => api.get(`/connections?limit=${limit}&offset=${offset}`))

  const revoke = async (id) => {
    if (!confirm('Revoke this connection? Your AI client will lose access immediately.')) return
    setRevoking(id)
    try { await api.delete('/connections/' + id); load() }
    finally { setRevoking(null) }
  }

  const isOnline = c => c.last_used_at && Date.now() - parseServerTimestamp(c.last_used_at) < 30 * 60_000

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner size={24} /></div>

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Connections" description="Manage your active MCP connection tokens" />

      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center justify-between border-b border-gray-100 dark:border-gray-800 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Connection Tokens</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              MCP URLs used to authenticate AI clients — {total ?? connections.length} total
            </p>
          </div>
        </div>

        {connections.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-gray-200 dark:border-gray-800 text-gray-400">
              <Link2 size={22} />
            </div>
            <p className="text-sm font-semibold text-gray-800 dark:text-white/90">No connections yet</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">Open a server and create a connection token to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800">
                  <th className="py-3 pl-6 pr-5 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Connection</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Server</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Used by</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Created</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Last used</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                    Expires {isAdmin && <span className="text-gray-400 font-normal">(click to edit)</span>}
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Active</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {connections.map(c => {
                  const online = isOnline(c)
                  const expired = isExpired(c.expires_at)
                  const mcpUrl = fixMcpUrl(c.mcp_url)
                  return (
                    <tr key={c.id} className={(!c.is_active || expired) ? 'opacity-50' : ''}>
                      <td className="py-4 pl-6 pr-5">
                        <p className="mb-1 text-sm font-medium text-gray-800 dark:text-white/90">
                          {c.label || c.server_name}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[240px]" title={mcpUrl}>
                            {mcpUrl}
                          </p>
                          <CopyUrlButton url={mcpUrl} />
                        </div>
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap">
                        {expired ? (
                          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400">Expired</span>
                        ) : c.is_active ? (
                          online
                            ? <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500">● Online</span>
                            : <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500">Active</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500">Revoked</span>
                        )}
                      </td>

                      <td className="px-5 py-4 text-sm whitespace-nowrap text-gray-500 dark:text-gray-400">
                        {c.server_name || '—'}
                      </td>

                      <td className="px-5 py-4 text-sm whitespace-nowrap text-gray-500 dark:text-gray-400">
                        {c.user_email || '—'}
                      </td>

                      <td className="px-5 py-4 text-sm whitespace-nowrap text-gray-500 dark:text-gray-400">
                        {fmtDate(c.created_at)}
                      </td>

                      <td className="px-5 py-4 text-sm whitespace-nowrap text-gray-500 dark:text-gray-400">
                        {fmtRelative(c.last_used_at)}
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap">
                        {isAdmin
                          ? <ExpiryCell conn={c} onUpdated={load} />
                          : <span className="text-sm text-gray-500 dark:text-gray-400">{fmtDate(c.expires_at)}</span>
                        }
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap">
                        <label className="flex cursor-pointer select-none items-center">
                          <div className="relative" onClick={() => c.is_active && revoke(c.id)}>
                            <div className={`block h-6 w-11 rounded-full transition duration-150 ease-linear ${c.is_active && !expired ? 'bg-brand-500' : 'bg-gray-200 dark:bg-white/10'}`} />
                            <div className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-theme-sm duration-150 ease-linear transform ${c.is_active && !expired ? 'translate-x-full' : 'translate-x-0'}`} />
                          </div>
                        </label>
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap">
                        <button
                          onClick={() => revoke(c.id)}
                          disabled={revoking === c.id || !c.is_active}
                          className="text-gray-500 dark:text-gray-400 hover:text-error-500 dark:hover:text-error-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title="Revoke"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="border-t border-gray-100 dark:border-gray-800 px-6 py-4">
            <Paginator page={page} totalPages={totalPages} onChange={setPage} total={total} pageSize={PAGE_SIZE} />
          </div>
        )}
      </div>
    </div>
  )
}

export default Connections

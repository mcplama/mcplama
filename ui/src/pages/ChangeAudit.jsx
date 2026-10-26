/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Shield, X } from 'lucide-react'
import api from '../lib/api'
import { formatLogTimestamp } from '../lib/formatTime'
import { Spinner, EmptyState } from '../components/ui'

const PAGE_SIZE = 20
const eventLabels = {
  'server.created': 'Server created',
  'server.updated': 'Server configuration updated',
  'server.deleted': 'Server deleted',
  'server.credentials.updated': 'User credentials saved',
  'user.invite.created': 'User invited',
  'user.invite.accepted': 'Invitation accepted',
  'user.invite.revoked': 'Invitation revoked',
  'user.updated': 'User access updated',
  'user.deleted': 'User removed',
  'policy.created': 'Policy created',
  'policy.updated': 'Policy updated',
  'policy.deleted': 'Policy deleted',
  'access.granted': 'Server access granted',
  'access.revoked': 'Server access revoked',
  'access.request.denied': 'Access request denied',
  'connection.updated': 'Connection access updated',
  'connection.revoked': 'Connection revoked',
}
const humanize = value => String(value).replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase())
const displayValue = value => value == null ? '—' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : Array.isArray(value) ? value.join(', ') : String(value)

export default function ChangeAudit() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [selectedLog, setSelectedLog] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
    if (query) params.set('search', query)
    return api.get(`/audit/changes?${params}`)
      .then(r => { setLogs(r.data); setTotal(parseInt(r.headers?.['x-total-count'] || 0)) })
      .finally(() => setLoading(false))
  }, [page, query])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [query])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to = Math.min(page * PAGE_SIZE, total)

  return (
    <div className="animate-fade-in overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Audit Logs</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">{total} configuration, credential, policy, and access changes. Select a row for event details.</p>
        </div>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search user, action, server…"
            className="h-10 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
          />
          <button onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300">
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        {loading ? <div className="flex h-48 items-center justify-center"><Spinner size={24} /></div>
          : logs.length === 0 ? <div className="py-12"><EmptyState icon={Shield} title="No audit events" description="Administrative changes will appear here." /></div>
            : <table className="w-full table-auto">
              <thead><tr className="border-b border-gray-200 dark:border-gray-800">
                {['Timestamp', 'User', 'Change', 'Resource', 'Details'].map(label => <th key={label} className="p-4 text-left text-xs font-medium text-gray-700 dark:text-gray-400">{label}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {logs.map(log => {
                  const ts = formatLogTimestamp(log.timestamp)
                  const fields = log.meta?.changed_fields || []
                  const scopes = log.meta?.credential_scopes || []
                  const changes = log.meta?.changes || []
                  return <tr key={log.id} role="button" tabIndex={0}
                    onClick={() => setSelectedLog(log)}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedLog(log) } }}
                    className="cursor-pointer hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:hover:bg-gray-900 dark:focus:bg-gray-900">
                    <td className="whitespace-nowrap p-4"><div className="flex flex-col text-xs"><span className="font-medium text-gray-700 dark:text-gray-300">{ts.date}</span><span className="font-mono text-gray-500">{ts.time}</span></div></td>
                    <td className="p-4 text-sm text-gray-700 dark:text-gray-300">{log.user_email || '—'}</td>
                    <td className="p-4 text-sm font-semibold text-gray-700 dark:text-gray-300">{eventLabels[log.action] || humanize(log.action)}</td>
                    <td className="p-4 text-sm text-gray-700 dark:text-gray-300">{log.resource_name || log.server_name || (log.server_id ? `Server #${log.server_id}` : '—')}</td>
                    <td className="p-4 text-xs text-gray-500 dark:text-gray-400">
                      {[
                        ...(changes.length ? [changes.map(change => `${humanize(change.field)}: ${displayValue(change.before)} → ${displayValue(change.after)}`).join('; ')] : []),
                        ...(!changes.length && fields.length ? [`Fields: ${fields.map(humanize).join(', ')}`] : []),
                        ...(scopes.length ? [`Credentials: ${scopes.map(humanize).join(', ')}`] : []),
                        ...(log.meta?.details?.target_user_email ? [`Target: ${log.meta.details.target_user_email}`] : []),
                      ].join(' · ') || '—'}
                    </td>
                  </tr>
                })}
              </tbody>
            </table>}
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 px-5 py-4 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        <span>Showing {from} to {to} of {total}</span>
        <div className="flex items-center gap-3">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="rounded border px-3 py-1 disabled:opacity-40 dark:border-gray-700">Previous</button>
          <span>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded border px-3 py-1 disabled:opacity-40 dark:border-gray-700">Next</button>
        </div>
      </div>

      {selectedLog && (() => {
        const ts = formatLogTimestamp(selectedLog.timestamp)
        const fields = selectedLog.meta?.changed_fields || []
        const scopes = selectedLog.meta?.credential_scopes || []
        const changes = selectedLog.meta?.changes || []
        const details = selectedLog.meta?.details || {}
        return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={() => setSelectedLog(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="audit-detail-title"
            onClick={event => event.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <header className="flex shrink-0 items-start justify-between border-b border-gray-200 p-5 dark:border-gray-800">
              <div>
                <h2 id="audit-detail-title" className="text-lg font-semibold text-gray-900 dark:text-white">{eventLabels[selectedLog.action] || humanize(selectedLog.action)}</h2>
                <p className="mt-1 text-sm text-gray-500">Audit event #{selectedLog.id}</p>
              </div>
              <button aria-label="Close details" onClick={() => setSelectedLog(null)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10"><X size={18} /></button>
            </header>
            <div className="min-h-0 space-y-5 overflow-y-auto p-5">
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div><dt className="text-xs font-medium uppercase text-gray-500">When</dt><dd className="mt-1 text-sm text-gray-800 dark:text-gray-200">{ts.date} {ts.time}</dd></div>
                <div><dt className="text-xs font-medium uppercase text-gray-500">Changed by</dt><dd className="mt-1 break-all text-sm text-gray-800 dark:text-gray-200">{selectedLog.user_email || 'Unknown user'}</dd></div>
                <div><dt className="text-xs font-medium uppercase text-gray-500">Resource</dt><dd className="mt-1 text-sm text-gray-800 dark:text-gray-200">{selectedLog.resource_name || selectedLog.server_name || '—'}</dd></div>
                <div><dt className="text-xs font-medium uppercase text-gray-500">Resource type and ID</dt><dd className="mt-1 text-sm text-gray-800 dark:text-gray-200">{humanize(selectedLog.resource_type || 'server')} · {selectedLog.resource_id || selectedLog.server_id || '—'}</dd></div>
                <div><dt className="text-xs font-medium uppercase text-gray-500">User ID</dt><dd className="mt-1 text-sm text-gray-800 dark:text-gray-200">{selectedLog.user_id ?? '—'}</dd></div>
                <div><dt className="text-xs font-medium uppercase text-gray-500">Event</dt><dd className="mt-1 text-sm text-gray-800 dark:text-gray-200">{selectedLog.action}</dd></div>
              </dl>
              <div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">What changed</h3>
                {changes.length > 0 && <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">{changes.map((change, index) => <li key={`${change.field}-${index}`} className="min-w-0 rounded-md bg-gray-50 px-3 py-2 dark:bg-white/5">
                  <div className="truncate text-xs font-semibold text-gray-700 dark:text-gray-300" title={humanize(change.field)}>{humanize(change.field)}</div>
                  <div className="mt-1 break-words text-sm text-gray-600 dark:text-gray-400">
                    {Object.prototype.hasOwnProperty.call(change, 'before') && <><span>{displayValue(change.before)}</span><span className="mx-2" aria-label="changed to">→</span></>}
                    <span>{displayValue(change.after)}</span>
                  </div>
                </li>)}</ul>}
                {fields.length > 0 && <>
                  <h4 className="mt-4 text-xs font-semibold uppercase text-gray-500">Fields affected</h4>
                  <ul className="mt-2 flex flex-wrap gap-2">{fields.map(field => <li key={field} className="rounded-md bg-gray-100 px-2.5 py-1 text-xs text-gray-700 dark:bg-white/10 dark:text-gray-300">{humanize(field)}</li>)}</ul>
                </>}
                {!changes.length && !fields.length && <p className="mt-1 text-sm text-gray-500">No field-level changes were recorded for this event.</p>}
              </div>
              {scopes.length > 0 && <div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Credential scopes affected</h3>
                <ul className="mt-2 flex flex-wrap gap-2">{scopes.map(scope => <li key={scope} className="rounded-md bg-brand-50 px-2.5 py-1 text-xs text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{humanize(scope)}</li>)}</ul>
                <p className="mt-2 text-xs text-gray-500">This log records which settings and credential scopes changed. Credential values are never stored here.</p>
              </div>}
              {Object.keys(details).length > 0 && <div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Additional details</h3>
                <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {Object.entries(details).map(([key, value]) => <div key={key} className="rounded-md bg-gray-50 px-3 py-2 dark:bg-white/5">
                    <dt className="text-xs text-gray-500">{humanize(key)}</dt>
                    <dd className="mt-0.5 break-all text-sm text-gray-800 dark:text-gray-200">{typeof value === 'boolean' ? (value ? 'Yes' : 'No') : Array.isArray(value) ? value.map(humanize).join(', ') : String(value ?? '—')}</dd>
                  </div>)}
                </dl>
              </div>}
            </div>
            <footer className="flex shrink-0 justify-end border-t border-gray-200 p-4 dark:border-gray-800">
              <button onClick={() => setSelectedLog(null)} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white">Close</button>
            </footer>
          </section>
        </div>
      })()}
    </div>
  )
}

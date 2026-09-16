/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, Download, Radio, Activity, Ban, X } from 'lucide-react'
import api from '../lib/api'
import { formatLogTimestamp, parseServerTimestamp } from '../lib/formatTime'
import { Spinner, EmptyState } from '../components/ui'
import { Table, TableHeader, TableBody, TableRow, TableCell } from '../components/kit/Table'
import Badge from '../components/kit/Badge'
import Button from '../components/kit/Button'

const PER_PAGE = 20

const statusBadgeProps = (code) => {
  if (!code) return { color: 'light', label: '—' }
  if (code >= 500) return { color: 'error', label: code }
  if (code >= 400) return { color: 'warning', label: code }
  return { color: 'success', label: code }
}

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'ok', label: 'Success' },
  { id: 'error', label: 'Errors' },
]

export default function ActivityPage() {
  const [logs, setLogs]           = useState([])
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(true)
  const [live, setLive]           = useState(false)
  const [query, setQuery]         = useState('')
  const [statusFilter, setStatus] = useState('all')
  const [serverFilter, setServer] = useState('all')
  const [servers, setServers]     = useState([])
  const [page, setPage]           = useState(1)
  const [selectedLog, setSelectedLog] = useState(null)
  const debounceRef               = useRef(null)
  const serversLoaded             = useRef(false)

  const load = useCallback(async (p = page, q = query, sf = statusFilter, sv = serverFilter) => {
    const params = new URLSearchParams({ limit: PER_PAGE, offset: (p - 1) * PER_PAGE })
    if (q)            params.set('search', q)
    if (sf !== 'all') params.set('status', sf)
    if (sv !== 'all') params.set('server_id', sv)

    const [logsRes, serversRes] = await Promise.all([
      api.get(`/audit?${params}`),
      serversLoaded.current ? Promise.resolve(null) : api.get('/servers'),
    ])
    setLogs(logsRes.data)
    setTotal(parseInt(logsRes.headers?.['x-total-count'] ?? '0', 10))
    if (serversRes) { setServers(serversRes.data); serversLoaded.current = true }
    setLoading(false)
  }, [page, query, statusFilter, serverFilter])

  useEffect(() => {
    setLoading(true)
    load(page, query, statusFilter, serverFilter)
  }, [page, statusFilter, serverFilter]) // eslint-disable-line

  const handleSearch = (val) => {
    setQuery(val)
    setPage(1)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setLoading(true); load(1, val, statusFilter, serverFilter) }, 350)
  }

  useEffect(() => {
    if (!live) return
    const t = setInterval(() => load(1, query, statusFilter, serverFilter), 3000)
    return () => clearInterval(t)
  }, [live, load, query, statusFilter, serverFilter])

  useEffect(() => {
    if (!selectedLog) return undefined
    const closeOnEscape = event => {
      if (event.key === 'Escape') setSelectedLog(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [selectedLog])

  const exportCSV = async () => {
    const params = new URLSearchParams({ limit: 200, offset: 0 })
    if (query)              params.set('search', query)
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (serverFilter !== 'all') params.set('server_id', serverFilter)
    const res = await api.get(`/audit?${params}`)
    const rows = [
      ['Timestamp', 'User', 'Server', 'Action', 'Tool', 'Status', 'Latency (ms)'],
      ...res.data.map(l => [l.timestamp, l.user_email, l.server_name, l.action, l.tool, l.status_code, l.latency_ms]),
    ]
    const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `mcplama-audit-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
  const from = total === 0 ? 0 : (page - 1) * PER_PAGE + 1
  const to   = Math.min(page * PER_PAGE, total)

  const pageNumbers = (() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1)
    if (page <= 3) return [1, 2, 3, 4, 5]
    if (page >= totalPages - 2) return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
    return [page - 2, page - 1, page, page + 1, page + 2]
  })()

  return (
    <div className="animate-fade-in">
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">

        {/* ── Header ── */}
        <div className="flex flex-col gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Live Activity</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {total.toLocaleString()} events{query || statusFilter !== 'all' ? ' (filtered)' : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Status tabs */}
            <div className="hidden h-11 items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 lg:inline-flex dark:bg-gray-900">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => { setStatus(t.id); setPage(1) }}
                  className={`text-theme-sm h-10 rounded-md px-3 py-2 font-medium hover:text-gray-900 dark:hover:text-white ${
                    statusFilter === t.id
                      ? 'shadow-theme-xs bg-white text-gray-900 dark:bg-gray-800 dark:text-white'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <span className="absolute top-1/2 left-4 -translate-y-1/2 text-gray-500 dark:text-gray-400">
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                  <path fillRule="evenodd" clipRule="evenodd" d="M3.04199 9.37363C3.04199 5.87693 5.87735 3.04199 9.37533 3.04199C12.8733 3.04199 15.7087 5.87693 15.7087 9.37363C15.7087 12.8703 12.8733 15.7053 9.37533 15.7053C5.87735 15.7053 3.04199 12.8703 3.04199 9.37363ZM9.37533 1.54199C5.04926 1.54199 1.54199 5.04817 1.54199 9.37363C1.54199 13.6991 5.04926 17.2053 9.37533 17.2053C11.2676 17.2053 13.0032 16.5344 14.3572 15.4176L17.1773 18.238C17.4702 18.5309 17.945 18.5309 18.2379 18.238C18.5308 17.9451 18.5309 17.4703 18.238 17.1773L15.4182 14.3573C16.5367 13.0033 17.2087 11.2669 17.2087 9.37363C17.2087 5.04817 13.7014 1.54199 9.37533 1.54199Z" fill="currentColor" />
                </svg>
              </span>
              <input
                value={query}
                onChange={e => handleSearch(e.target.value)}
                placeholder="Search tool, user, server…"
                className="shadow-theme-xs h-11 w-full rounded-lg border border-gray-300 bg-transparent py-2.5 pr-4 pl-10 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:ring-3 focus:ring-brand-500/10 focus:outline-none sm:w-[220px] dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
              />
            </div>

            {/* Server filter */}
            {servers.length > 0 && (
              <select
                value={serverFilter}
                onChange={e => { setServer(e.target.value); setPage(1) }}
                className="shadow-theme-xs h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
              >
                <option value="all">All servers</option>
                {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}

            {/* Live toggle */}
            <button
              onClick={() => setLive(l => !l)}
              className={`shadow-theme-xs flex h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-all ${
                live
                  ? 'border-success-300 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-400'
                  : 'border-gray-300 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'
              }`}
            >
              <Radio size={14} className={live ? 'animate-pulse' : ''} />
              {live ? 'Live' : 'Paused'}
            </button>

            <Button variant="outline" size="sm" onClick={() => { setLoading(true); load(page, query, statusFilter, serverFilter) }} startIcon={<RefreshCw size={14} />}>
              Refresh
            </Button>

            <Button variant="outline" size="sm" onClick={exportCSV} startIcon={<Download size={14} />}>
              Export CSV
            </Button>
          </div>
        </div>

        {/* ── Table ── */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Spinner size={24} />
            </div>
          ) : logs.length === 0 ? (
            <div className="py-12">
              <EmptyState icon={Activity} title="No events" description="Tool calls will appear here in real time." />
            </div>
          ) : (
            <Table>
              <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                <TableRow>
                  {['Timestamp', 'User', 'Server', 'Tool / Action', 'Latency', 'Status'].map((h, i) => (
                    <TableCell
                      key={i}
                      isHeader
                      className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400 whitespace-nowrap"
                    >
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHeader>

              <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                {logs.map(log => {
                  const badge = statusBadgeProps(log.status_code)
                  const ts = formatLogTimestamp(log.timestamp)
                  return (
                      <TableRow
                        key={log.id}
                        tabIndex={0}
                        aria-selected={selectedLog?.id === log.id}
                        className={`cursor-pointer transition hover:bg-gray-50 dark:hover:bg-white/[0.02] ${selectedLog?.id === log.id ? 'bg-brand-50/60 dark:bg-brand-500/5' : ''}`}
                        onClick={() => setSelectedLog(log)}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setSelectedLog(log)
                          }
                        }}
                      >
                        <TableCell className="px-5 py-4 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span className="text-theme-xs font-medium text-gray-700 dark:text-gray-300">
                              {ts.date}
                            </span>
                            <span className="text-theme-xs font-mono text-gray-400 dark:text-gray-500">
                              {ts.time}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="px-5 py-4 text-theme-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {log.user_email || 'system'}
                        </TableCell>
                        <TableCell className="px-5 py-4 whitespace-nowrap">
                          {log.server_name
                            ? <Badge size="sm" color="light">{log.server_name}</Badge>
                            : <span className="text-theme-xs text-gray-400">—</span>
                          }
                        </TableCell>
                        <TableCell className="px-5 py-4 whitespace-nowrap">
                          <span className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
                            {log.tool || log.action}
                          </span>
                          {log.tool && log.action !== log.tool && (
                            <span className="block text-theme-xs text-gray-400">{log.action}</span>
                          )}
                        </TableCell>
                        <TableCell className="px-5 py-4 text-theme-xs font-mono text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {log.latency_ms ? `${log.latency_ms}ms` : '—'}
                        </TableCell>
                        <TableCell className="px-5 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Badge size="sm" color={badge.color}>{badge.label}</Badge>
                            {log.meta?.action_taken === 'blocked' && (
                              <Badge size="sm" color="error">Blocked</Badge>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {/* ── Pagination footer ── */}
        <div className="flex flex-col items-center justify-between gap-3 border-t border-gray-200 px-5 py-4 dark:border-gray-800 sm:flex-row">
          <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Showing <span className="text-gray-800 dark:text-white/90">{from}</span> to{' '}
            <span className="text-gray-800 dark:text-white/90">{to}</span> of{' '}
            <span className="text-gray-800 dark:text-white/90">{total}</span>
          </span>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => { setPage(p => Math.max(1, p - 1)); setSelectedLog(null) }}
              disabled={page === 1}
              className={`shadow-theme-xs flex items-center justify-center rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] ${page === 1 ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <svg className="fill-current" width="18" height="18" viewBox="0 0 20 20" fill="none">
                <path fillRule="evenodd" clipRule="evenodd" d="M2.58203 9.99868C2.58174 10.1909 2.6549 10.3833 2.80152 10.53L7.79818 15.5301C8.09097 15.8231 8.56584 15.8233 8.85883 15.5305C9.15183 15.2377 9.152 14.7629 8.85921 14.4699L5.13911 10.7472L16.6665 10.7472C17.0807 10.7472 17.4165 10.4114 17.4165 9.99715C17.4165 9.58294 17.0807 9.24715 16.6665 9.24715L5.14456 9.24715L8.85919 5.53016C9.15199 5.23717 9.15184 4.7623 8.85885 4.4695C8.56587 4.1767 8.09099 4.17685 7.79819 4.46984L2.84069 9.43049C2.68224 9.568 2.58203 9.77087 2.58203 9.99715C2.58203 9.99766 2.58203 9.99817 2.58203 9.99868Z" fill="" />
              </svg>
            </button>

            {pageNumbers.map(p => (
              <button
                key={p}
                onClick={() => { setPage(p); setSelectedLog(null) }}
                className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-medium transition ${
                  p === page
                    ? 'bg-brand-500 text-white'
                    : 'text-gray-600 hover:bg-brand-500 hover:text-white dark:text-gray-400 dark:hover:text-white'
                }`}
              >
                {p}
              </button>
            ))}

            <button
              onClick={() => { setPage(p => Math.min(totalPages, p + 1)); setSelectedLog(null) }}
              disabled={page === totalPages}
              className={`shadow-theme-xs flex items-center justify-center rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] ${page === totalPages ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <svg className="fill-current" width="18" height="18" viewBox="0 0 20 20" fill="none">
                <path fillRule="evenodd" clipRule="evenodd" d="M17.4165 9.9986C17.4168 10.1909 17.3437 10.3832 17.197 10.53L12.2004 15.5301C11.9076 15.8231 11.4327 15.8233 11.1397 15.5305C10.8467 15.2377 10.8465 14.7629 11.1393 14.4699L14.8594 10.7472L3.33203 10.7472C2.91782 10.7472 2.58203 10.4114 2.58203 9.99715C2.58203 9.58294 2.91782 9.24715 3.33203 9.24715L14.854 9.24715L11.1393 5.53016C10.8465 5.23717 10.8467 4.7623 11.1397 4.4695C11.4327 4.1767 11.9075 4.17685 12.2003 4.46984L17.1578 9.43049C17.3163 9.568 17.4165 9.77087 17.4165 9.99715C17.4165 9.99763 17.4165 9.99812 17.4165 9.9986Z" fill="" />
              </svg>
            </button>
          </div>
        </div>

      </div>

      {selectedLog && (
        <div
          role="presentation"
          onMouseDown={event => { if (event.target === event.currentTarget) setSelectedLog(null) }}
          className="fixed inset-0 z-[110] flex justify-end bg-black/50 backdrop-blur-[2px]"
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={`Activity log ${selectedLog.id} details`}
            className="activity-log-panel flex h-full w-[min(520px,94vw)] flex-col border-l border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950"
          >
            <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-gray-200 px-5 dark:border-gray-800">
              <div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">Log details</h3>
                <p className="text-theme-xs text-gray-400">Event #{selectedLog.id}</p>
              </div>
              <button
                type="button"
                aria-label="Close log details"
                onClick={() => setSelectedLog(null)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/5"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto p-5">
              <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.03]">
                <div>
                  <p className="text-theme-xs font-semibold uppercase tracking-wide text-gray-400">{selectedLog.tool ? 'Tool call' : 'Activity'}</p>
                  <p className="mt-1 break-all text-sm font-semibold text-gray-800 dark:text-white/90">
                    {selectedLog.tool || selectedLog.action}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge size="sm" color={statusBadgeProps(selectedLog.status_code).color}>
                    {statusBadgeProps(selectedLog.status_code).label}
                  </Badge>
                  {selectedLog.meta?.action_taken === 'blocked' && <Badge size="sm" color="error">Blocked</Badge>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {[
                  ['Timestamp', parseServerTimestamp(selectedLog.timestamp).toISOString()],
                  ['User', selectedLog.user_email || 'system'],
                  ['Server', selectedLog.server_name || '—'],
                  ['Action', selectedLog.action || '—'],
                  ['IP address', selectedLog.ip_address || '—'],
                  ['Latency', selectedLog.latency_ms ? `${selectedLog.latency_ms}ms` : '—'],
                  ['Resource type', selectedLog.resource_type || '—'],
                  ['Resource ID', selectedLog.resource_id || '—'],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <p className="mb-1 text-theme-xs font-semibold text-gray-400 dark:text-gray-500">{label}</p>
                    <p className="break-all font-mono text-theme-xs text-gray-700 dark:text-gray-300">{String(value)}</p>
                  </div>
                ))}
              </div>

              {selectedLog.request_body && (
                <div>
                  <p className="mb-2 text-theme-xs font-semibold text-gray-500 dark:text-gray-400">Request body</p>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-gray-200 bg-gray-50 p-4 font-mono text-theme-xs text-gray-700 dark:border-gray-800 dark:bg-black/20 dark:text-gray-300">
                    {selectedLog.request_body}
                  </pre>
                </div>
              )}

              {selectedLog.meta?.action_taken === 'blocked' && (
                <div className="rounded-xl border border-error-200 bg-error-50 p-4 text-theme-xs dark:border-error-500/20 dark:bg-error-500/10">
                  <p className="mb-1 flex items-center gap-1.5 font-semibold text-error-600 dark:text-error-400">
                    <Ban size={13} /> Blocked by policy
                  </p>
                  <p className="break-all text-gray-600 dark:text-gray-400">Policy: {selectedLog.meta.policy || '—'}</p>
                </div>
              )}

              {selectedLog.error && selectedLog.meta?.action_taken !== 'blocked' && (
                <div>
                  <p className="mb-2 text-theme-xs font-semibold text-error-600 dark:text-error-400">Error</p>
                  <pre className="whitespace-pre-wrap break-all rounded-xl border border-error-200 bg-error-50 p-4 font-mono text-theme-xs text-error-600 dark:border-error-500/20 dark:bg-error-500/10 dark:text-error-400">
                    {selectedLog.error}
                  </pre>
                </div>
              )}

              {selectedLog.meta && Object.keys(selectedLog.meta).length > 0 && (
                <details className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                  <summary className="cursor-pointer text-theme-xs font-semibold text-gray-600 dark:text-gray-400">Raw metadata</summary>
                  <pre className="mt-3 overflow-auto whitespace-pre-wrap break-all font-mono text-theme-xs text-gray-600 dark:text-gray-400">
                    {JSON.stringify(selectedLog.meta, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </aside>
        </div>
      )}

      <style>{`
        @keyframes activityPanelIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .activity-log-panel { animation: activityPanelIn 0.2s ease-out; }
      `}</style>
    </div>
  )
}

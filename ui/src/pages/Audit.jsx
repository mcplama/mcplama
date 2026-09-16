/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, BarChart2 } from 'lucide-react'
import api from '../lib/api'
import { copyText } from '../lib/clipboard'
import { formatLogTimestamp } from '../lib/formatTime'
import { Spinner, EmptyState } from '../components/ui'

const PAGE_SIZE = 20

const statusBadge = (code) => {
  if (!code) return { cls: 'bg-gray-100 text-gray-600 dark:bg-gray-500/15 dark:text-gray-400', label: '—' }
  if (code >= 500) return { cls: 'bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500', label: code }
  if (code >= 400) return { cls: 'bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400', label: code }
  return { cls: 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-500', label: code }
}

const SortIcon = () => (
  <span className="flex flex-col gap-0.5">
    <svg className="text-gray-300" width="8" height="5" viewBox="0 0 8 5" fill="none">
      <path d="M4.40962 0.585167C4.21057 0.300808 3.78943 0.300807 3.59038 0.585166L1.05071 4.21327C0.81874 4.54466 1.05582 5 1.46033 5H6.53967C6.94418 5 7.18126 4.54466 6.94929 4.21327L4.40962 0.585167Z" fill="currentColor" />
    </svg>
    <svg className="text-gray-300" width="8" height="5" viewBox="0 0 8 5" fill="none">
      <path d="M4.40962 4.41483C4.21057 4.69919 3.78943 4.69919 3.59038 4.41483L1.05071 0.786732C0.81874 0.455343 1.05582 0 1.46033 0H6.53967C6.94418 0 7.18126 0.455342 6.94929 0.786731L4.40962 4.41483Z" fill="currentColor" />
    </svg>
  </span>
)

const KebabIcon = () => (
  <svg className="fill-current" width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path fillRule="evenodd" clipRule="evenodd" d="M5.99902 10.245C6.96552 10.245 7.74902 11.0285 7.74902 11.995V12.005C7.74902 12.9715 6.96552 13.755 5.99902 13.755C5.03253 13.755 4.24902 12.9715 4.24902 12.005V11.995C4.24902 11.0285 5.03253 10.245 5.99902 10.245ZM17.999 10.245C18.9655 10.245 19.749 11.0285 19.749 11.995V12.005C19.749 12.9715 18.9655 13.755 17.999 13.755C17.0325 13.755 16.249 12.9715 16.249 12.005V11.995C16.249 11.0285 17.0325 10.245 17.999 10.245ZM13.749 11.995C13.749 11.0285 12.9655 10.245 11.999 10.245C11.0325 10.245 10.249 11.0285 10.249 11.995V12.005C10.249 12.9715 11.0325 13.755 11.999 13.755C12.9655 13.755 13.749 12.9715 13.749 12.005V11.995Z" fill="" />
  </svg>
)

const TABS = [
  { id: 'all', label: 'All Logs' },
  { id: 'errors', label: 'Errors' },
  { id: 'success', label: 'Success' },
]

export default function Audit() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [openMenu, setOpenMenu] = useState(null)
  const [auto, setAuto] = useState(false)
  const menuRef = useRef(null)

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
    if (query) params.set('search', query)
    return api.get(`/audit?${params}`)
      .then(r => { setLogs(r.data); setTotal(parseInt(r.headers?.['x-total-count'] || 0)) })
      .finally(() => setLoading(false))
  }, [page, query])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [query, filter])
  useEffect(() => {
    if (!auto) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [auto, load])

  useEffect(() => {
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpenMenu(null) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const displayed = filter === 'errors'
    ? logs.filter(l => l.status_code >= 400)
    : filter === 'success'
    ? logs.filter(l => l.status_code >= 200 && l.status_code < 400)
    : logs

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to = Math.min(page * PAGE_SIZE, total)

  const pageNumbers = (() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1)
    if (page <= 3) return [1, 2, 3, 4, 5]
    if (page >= totalPages - 2) return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
    return [page - 2, page - 1, page, page + 1, page + 2]
  })()

  return (
    <div className="animate-fade-in">
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Activity Log</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">{total} total entries</p>
          </div>
          <div className="flex gap-3.5">
            <div className="hidden h-11 items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 lg:inline-flex dark:bg-gray-900">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setFilter(t.id)}
                  className={`text-theme-sm h-10 rounded-md px-3 py-2 font-medium hover:text-gray-900 dark:hover:text-white ${
                    filter === t.id
                      ? 'shadow-theme-xs text-gray-900 dark:text-white bg-white dark:bg-gray-800'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="hidden flex-col gap-3 sm:flex sm:flex-row sm:items-center">
              <div className="relative">
                <span className="absolute top-1/2 left-4 -translate-y-1/2 text-gray-500 dark:text-gray-400">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path fillRule="evenodd" clipRule="evenodd" d="M3.04199 9.37363C3.04199 5.87693 5.87735 3.04199 9.37533 3.04199C12.8733 3.04199 15.7087 5.87693 15.7087 9.37363C15.7087 12.8703 12.8733 15.7053 9.37533 15.7053C5.87735 15.7053 3.04199 12.8703 3.04199 9.37363ZM9.37533 1.54199C5.04926 1.54199 1.54199 5.04817 1.54199 9.37363C1.54199 13.6991 5.04926 17.2053 9.37533 17.2053C11.2676 17.2053 13.0032 16.5344 14.3572 15.4176L17.1773 18.238C17.4702 18.5309 17.945 18.5309 18.2379 18.238C18.5308 17.9451 18.5309 17.4703 18.238 17.1773L15.4182 14.3573C16.5367 13.0033 17.2087 11.2669 17.2087 9.37363C17.2087 5.04817 13.7014 1.54199 9.37533 1.54199Z" fill="currentColor" />
                  </svg>
                </span>
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search action, tool, user…"
                  className="shadow-theme-xs focus:border-brand-300 focus:ring-brand-500/10 dark:focus:border-brand-800 h-11 w-full rounded-lg border border-gray-300 bg-transparent py-2.5 pr-4 pl-11 text-sm text-gray-800 placeholder:text-gray-400 focus:ring-3 focus:outline-none xl:w-[280px] dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                  type="text"
                />
              </div>
              <button
                onClick={load}
                className="shadow-theme-xs flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 sm:w-auto dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
              >
                <RefreshCw size={16} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Spinner size={24} />
            </div>
          ) : displayed.length === 0 ? (
            <div className="py-12">
              <EmptyState icon={BarChart2} title="No entries" description="Audit events appear here as they happen." />
            </div>
          ) : (
            <table className="w-full table-auto">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <th className="p-4 text-left">
                    <p className="text-theme-xs font-medium text-gray-700 dark:text-gray-400">Timestamp</p>
                  </th>
                  <th className="cursor-pointer p-4 text-left">
                    <div className="flex items-center gap-3">
                      <p className="text-theme-xs font-medium text-gray-700 dark:text-gray-400">User</p>
                      <SortIcon />
                    </div>
                  </th>
                  <th className="cursor-pointer p-4 text-left">
                    <div className="flex items-center gap-3">
                      <p className="text-theme-xs font-medium text-gray-700 dark:text-gray-400">Action</p>
                      <SortIcon />
                    </div>
                  </th>
                  <th className="p-4 text-left">
                    <p className="text-theme-xs font-medium text-gray-700 dark:text-gray-400">Tool / Server</p>
                  </th>
                  <th className="p-4 text-left">
                    <p className="text-theme-xs font-medium text-gray-700 dark:text-gray-400">Latency</p>
                  </th>
                  <th className="p-4 text-left">
                    <p className="text-theme-xs font-medium text-gray-700 dark:text-gray-400">Status</p>
                  </th>
                  <th className="p-4 text-left">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800" ref={menuRef}>
                {displayed.map(log => {
                  const badge = statusBadge(log.status_code)
                  const ts = formatLogTimestamp(log.timestamp)
                  return (
                    <tr key={log.id} className="transition hover:bg-gray-50 dark:hover:bg-gray-900">
                      <td className="p-4 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="text-theme-xs font-medium text-gray-700 dark:text-gray-400">
                            {ts.date}
                          </span>
                          <span className="text-theme-xs font-mono text-gray-500 dark:text-gray-500">
                            {ts.time}
                          </span>
                        </div>
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-400 truncate max-w-[180px] block">
                          {log.user_email || '—'}
                        </span>
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-400">
                          {log.action}
                        </span>
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <p className="text-sm font-mono text-gray-700 dark:text-gray-400 truncate max-w-[180px]">
                          {log.tool || log.server_name || '—'}
                        </p>
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <p className="text-theme-xs font-mono text-gray-700 dark:text-gray-400">
                          {log.latency_ms ? `${log.latency_ms}ms` : '—'}
                        </p>
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <span className={`text-theme-xs rounded-full px-2 py-0.5 font-medium ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <div className="relative flex justify-center">
                          <button
                            onClick={() => setOpenMenu(openMenu === log.id ? null : log.id)}
                            className="text-gray-500 dark:text-gray-400"
                          >
                            <KebabIcon />
                          </button>
                          {openMenu === log.id && (
                            <div className="absolute right-0 top-8 z-10 p-2 bg-white border border-gray-200 rounded-2xl shadow-lg dark:border-gray-800 dark:bg-gray-900 w-40">
                              <div className="space-y-1">
                                <button
                                  onClick={() => { copyText(JSON.stringify(log, null, 2)); setOpenMenu(null) }}
                                  className="text-xs flex w-full rounded-lg px-3 py-2 text-left font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-300"
                                >
                                  Copy JSON
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Footer */}
        <div className="flex items-center flex-col sm:flex-row justify-between border-t border-gray-200 px-5 py-4 dark:border-gray-800">
          <div className="pb-3 sm:pb-0">
            <span className="block text-sm font-medium text-gray-500 dark:text-gray-400">
              Showing <span className="text-gray-800 dark:text-white/90">{from}</span> to{' '}
              <span className="text-gray-800 dark:text-white/90">{to}</span> of{' '}
              <span className="text-gray-800 dark:text-white/90">{total}</span>
            </span>
          </div>
          <div className="flex items-center justify-between p-4 sm:p-0 rounded-lg w-full sm:w-auto bg-gray-50 dark:bg-white/[0.03] dark:sm:bg-transparent sm:bg-transparent gap-2 sm:justify-normal">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className={`shadow-theme-xs flex items-center gap-2 rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 hover:text-gray-800 sm:p-2.5 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200 ${page === 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <svg className="fill-current" width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path fillRule="evenodd" clipRule="evenodd" d="M2.58203 9.99868C2.58174 10.1909 2.6549 10.3833 2.80152 10.53L7.79818 15.5301C8.09097 15.8231 8.56584 15.8233 8.85883 15.5305C9.15183 15.2377 9.152 14.7629 8.85921 14.4699L5.13911 10.7472L16.6665 10.7472C17.0807 10.7472 17.4165 10.4114 17.4165 9.99715C17.4165 9.58294 17.0807 9.24715 16.6665 9.24715L5.14456 9.24715L8.85919 5.53016C9.15199 5.23717 9.15184 4.7623 8.85885 4.4695C8.56587 4.1767 8.09099 4.17685 7.79819 4.46984L2.84069 9.43049C2.68224 9.568 2.58203 9.77087 2.58203 9.99715C2.58203 9.99766 2.58203 9.99817 2.58203 9.99868Z" fill="" />
              </svg>
            </button>
            <span className="block text-sm font-medium text-gray-700 sm:hidden dark:text-gray-400">
              Page {page} of {totalPages}
            </span>
            <ul className="hidden items-center gap-0.5 sm:flex">
              {pageNumbers.map(p => (
                <li key={p}>
                  <button
                    onClick={() => setPage(p)}
                    className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-medium ${
                      p === page
                        ? 'bg-brand-500 text-white'
                        : 'hover:bg-brand-500 text-gray-700 hover:text-white dark:text-gray-400 dark:hover:text-white'
                    }`}
                  >
                    {p}
                  </button>
                </li>
              ))}
            </ul>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className={`shadow-theme-xs flex items-center gap-2 rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 hover:text-gray-800 sm:p-2.5 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200 ${page === totalPages ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <svg className="fill-current" width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path fillRule="evenodd" clipRule="evenodd" d="M17.4165 9.9986C17.4168 10.1909 17.3437 10.3832 17.197 10.53L12.2004 15.5301C11.9076 15.8231 11.4327 15.8233 11.1397 15.5305C10.8467 15.2377 10.8465 14.7629 11.1393 14.4699L14.8594 10.7472L3.33203 10.7472C2.91782 10.7472 2.58203 10.4114 2.58203 9.99715C2.58203 9.58294 2.91782 9.24715 3.33203 9.24715L14.854 9.24715L11.1393 5.53016C10.8465 5.23717 10.8467 4.7623 11.1397 4.4695C11.4327 4.1767 11.9075 4.17685 12.2003 4.46984L17.1578 9.43049C17.3163 9.568 17.4165 9.77087 17.4165 9.99715C17.4165 9.99763 17.4165 9.99812 17.4165 9.9986Z" fill="" />
              </svg>
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

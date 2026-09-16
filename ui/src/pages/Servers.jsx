/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useEffect, useCallback } from 'react'
import { Bug, ChevronRight, Mail, Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { Alert, Modal, ModalHeader, Spinner, Toggle, EmptyState, StatusDot } from '../components/ui'
import { Paginator } from '../components/ui/Paginator'
import ServerIcon from '../components/ui/ServerIcon'
import { usePagination } from '../hooks/usePagination'
import AddServerModal from './_AddServerModal'
import { Table, TableHeader, TableBody, TableRow, TableCell } from '../components/kit/Table'
import Badge from '../components/kit/Badge'
import Button from '../components/kit/Button'

export default function Servers() {
  const [servers, setServers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  const load = useCallback(() =>
    api.get('/servers?limit=200').then(r => setServers(r.data)).finally(() => setLoading(false))
  , [])
  useEffect(() => { load() }, [load])

  const filtered = servers.filter(s =>
    !search ||
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.category || '').toLowerCase().includes(search.toLowerCase())
  )
  const { page, setPage, totalPages, paginated, total } = usePagination(filtered)

  const toggle = async (id, enabled) => {
    await api.patch('/servers/' + id, { is_enabled: enabled })
    setServers(sv => sv.map(s => s.id === id ? { ...s, is_enabled: enabled } : s))
  }

  const openBugReport = async (includeLogs) => {
    setReportLoading(true)
    setReportError('')

    let logSection = 'Recent activity logs were not included.'
    if (includeLogs) {
      try {
        const response = await api.get('/diagnostics/logs')
        const data = response.data || {}
        const backend = (data.backend_logs || []).join('\n') || 'No backend application logs were available.'
        const containers = (data.containers || []).map(container =>
          `--- ${container.name} (${container.image || 'unknown image'}) ---\n${container.logs || 'No container logs were available.'}`
        ).join('\n') || 'No running MCP container logs were available.'
        logSection = `Diagnostic logs generated at ${data.generated_at || 'unknown time'}:\n\n[Backend application logs]\n${backend}\n\n[Running MCP container logs]\n${containers}`
      } catch {
        setReportError('We could not load the activity logs. You can still report the bug without them.')
        setReportLoading(false)
        return
      }
    }

    const body = [
      'Hi MCPlama support,',
      '',
      'I would like to report a bug:',
      '',
      '[Please describe what happened and how to reproduce it]',
      '',
      `App: MCPlama\nConnected servers: ${servers.length}`,
      '',
      logSection,
    ].join('\n')
    window.location.href = `mailto:support@mcplama.com?subject=${encodeURIComponent('MCPlama bug report')}&body=${encodeURIComponent(body)}`
    setReportLoading(false)
    setShowReport(false)
  }

  const from = filtered.length === 0 ? 0 : (page - 1) * 20 + 1
  const to   = Math.min(page * 20, total)

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
        <div className="flex flex-col gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Servers</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">{servers.length} connected MCP servers</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative">
              <span className="absolute top-1/2 left-4 -translate-y-1/2 text-gray-500 dark:text-gray-400">
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                  <path fillRule="evenodd" clipRule="evenodd" d="M3.04199 9.37363C3.04199 5.87693 5.87735 3.04199 9.37533 3.04199C12.8733 3.04199 15.7087 5.87693 15.7087 9.37363C15.7087 12.8703 12.8733 15.7053 9.37533 15.7053C5.87735 15.7053 3.04199 12.8703 3.04199 9.37363ZM9.37533 1.54199C5.04926 1.54199 1.54199 5.04817 1.54199 9.37363C1.54199 13.6991 5.04926 17.2053 9.37533 17.2053C11.2676 17.2053 13.0032 16.5344 14.3572 15.4176L17.1773 18.238C17.4702 18.5309 17.945 18.5309 18.2379 18.238C18.5308 17.9451 18.5309 17.4703 18.238 17.1773L15.4182 14.3573C16.5367 13.0033 17.2087 11.2669 17.2087 9.37363C17.2087 5.04817 13.7014 1.54199 9.37533 1.54199Z" fill="currentColor" />
                </svg>
              </span>
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }}
                placeholder="Search servers…"
                className="shadow-theme-xs h-11 w-full rounded-lg border border-gray-300 bg-transparent py-2.5 pr-4 pl-10 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:ring-3 focus:ring-brand-500/10 focus:outline-none sm:w-[200px] dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
              />
            </div>
            <Button variant="outline" size="sm" startIcon={<Bug size={14} />} onClick={() => { setReportError(''); setShowReport(true) }}>
              Report a bug
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/catalog')}>
              Browse catalog
            </Button>
            <Button variant="primary" size="sm" startIcon={<Plus size={14} />} onClick={() => setShowAdd(true)}>
              Add custom
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center h-48"><Spinner size={24} /></div>
          ) : servers.length === 0 ? (
            <div className="py-12">
              <EmptyState
                icon={ServerIcon}
                title="No servers connected"
                description="Add servers from the catalog or connect a custom MCP server."
                action={
                  <div className="flex gap-2">
                    <Button variant="primary" size="sm" onClick={() => navigate('/catalog')}>Browse catalog</Button>
                    <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>Custom URL</Button>
                  </div>
                }
              />
            </div>
          ) : (
            <Table>
              <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                <TableRow>
                  {['Server', 'Category', 'Endpoint', 'Tools', 'Status', ''].map((h, i) => (
                    <TableCell key={i} isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400 whitespace-nowrap">
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                {paginated.map(s => (
                  <TableRow key={s.id} className="transition hover:bg-gray-50 dark:hover:bg-white/[0.02]">

                    {/* Server name + icon */}
                    <TableCell className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <ServerIcon server={s} size="sm" />
                        <span className="font-medium text-theme-sm text-gray-800 dark:text-white/90 whitespace-nowrap">
                          {s.name}
                        </span>
                      </div>
                    </TableCell>

                    {/* Category */}
                    <TableCell className="px-5 py-4 whitespace-nowrap">
                      {s.category
                        ? <Badge size="sm" color="light">{s.category}</Badge>
                        : <span className="text-theme-xs text-gray-400">—</span>
                      }
                    </TableCell>

                    {/* Endpoint */}
                    <TableCell className="px-5 py-4 max-w-[220px]">
                      <p className="text-theme-xs font-mono text-gray-500 dark:text-gray-400 truncate">
                        {s.url || s.package || s.docker_image || '—'}
                      </p>
                    </TableCell>

                    {/* Tools count */}
                    <TableCell className="px-5 py-4 whitespace-nowrap text-theme-xs text-gray-500 dark:text-gray-400">
                      {(s.tools || []).length}
                    </TableCell>

                    {/* Status + toggle */}
                    <TableCell className="px-5 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          <StatusDot status={s.is_enabled ? 'online' : 'offline'} pulse={s.is_enabled} />
                          <Badge size="sm" color={s.is_enabled ? 'success' : 'light'}>
                            {s.is_enabled ? 'Active' : 'Disabled'}
                          </Badge>
                        </div>
                        <Toggle enabled={s.is_enabled} onChange={v => toggle(s.id, v)} />
                      </div>
                    </TableCell>

                    {/* Detail link */}
                    <TableCell className="px-5 py-4 whitespace-nowrap">
                      <Link to={'/servers/' + s.id} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors p-1 flex items-center justify-center">
                        <ChevronRight size={16} />
                      </Link>
                    </TableCell>

                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Pagination footer */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-5 py-4 dark:border-gray-800">
            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
              Showing <span className="text-gray-800 dark:text-white/90">{from}</span> to{' '}
              <span className="text-gray-800 dark:text-white/90">{to}</span> of{' '}
              <span className="text-gray-800 dark:text-white/90">{total}</span>
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className={`shadow-theme-xs flex items-center justify-center rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 ${page === 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <svg className="fill-current" width="16" height="16" viewBox="0 0 20 20" fill="none">
                  <path fillRule="evenodd" clipRule="evenodd" d="M2.58203 9.99868C2.58174 10.1909 2.6549 10.3833 2.80152 10.53L7.79818 15.5301C8.09097 15.8231 8.56584 15.8233 8.85883 15.5305C9.15183 15.2377 9.152 14.7629 8.85921 14.4699L5.13911 10.7472L16.6665 10.7472C17.0807 10.7472 17.4165 10.4114 17.4165 9.99715C17.4165 9.58294 17.0807 9.24715 16.6665 9.24715L5.14456 9.24715L8.85919 5.53016C9.15199 5.23717 9.15184 4.7623 8.85885 4.4695C8.56587 4.1767 8.09099 4.17685 7.79819 4.46984L2.84069 9.43049C2.68224 9.568 2.58203 9.77087 2.58203 9.99715C2.58203 9.99766 2.58203 9.99817 2.58203 9.99868Z" fill="" />
                </svg>
              </button>
              {pageNumbers.map(p => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-medium transition ${p === page ? 'bg-brand-500 text-white' : 'text-gray-600 hover:bg-brand-500 hover:text-white dark:text-gray-400 dark:hover:text-white'}`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className={`shadow-theme-xs flex items-center justify-center rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 ${page === totalPages ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <svg className="fill-current" width="16" height="16" viewBox="0 0 20 20" fill="none">
                  <path fillRule="evenodd" clipRule="evenodd" d="M17.4165 9.9986C17.4168 10.1909 17.3437 10.3832 17.197 10.53L12.2004 15.5301C11.9076 15.8231 11.4327 15.8233 11.1397 15.5305C10.8467 15.2377 10.8465 14.7629 11.1393 14.4699L14.8594 10.7472L3.33203 10.7472C2.91782 10.7472 2.58203 10.4114 2.58203 9.99715C2.58203 9.58294 2.91782 9.24715 3.33203 9.24715L14.854 9.24715L11.1393 5.53016C10.8465 5.23717 10.8467 4.7623 11.1397 4.4695C11.4327 4.1767 11.9075 4.17685 12.2003 4.46984L17.1578 9.43049C17.3163 9.568 17.4165 9.77087 17.4165 9.99715C17.4165 9.99763 17.4165 9.99812 17.4165 9.9986Z" fill="" />
                </svg>
              </button>
            </div>
          </div>
        )}

      </div>

      {showAdd && (
        <AddServerModal
          onClose={() => setShowAdd(false)}
          onAdded={id => { setShowAdd(false); navigate('/servers/' + id) }}
        />
      )}

      {showReport && (
        <Modal onClose={() => !reportLoading && setShowReport(false)} width="max-w-lg">
          <ModalHeader
            title="Report a bug"
            subtitle="Send a message to support@mcplama.com"
            onClose={() => !reportLoading && setShowReport(false)}
          />
          <div className="space-y-4 px-6 py-5">
            <p className="text-sm leading-relaxed text-t2">
              Would you like to include recent application, backend, and MCP container debug logs? They can help us diagnose the problem. Logs are bounded and credential-like values are redacted, but please review the email before sending.
            </p>
            {reportError && <Alert variant="warn">{reportError}</Alert>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" size="sm" disabled={reportLoading} onClick={() => openBugReport(false)}>
                Report without logs
              </Button>
              <Button variant="primary" size="sm" disabled={reportLoading} startIcon={reportLoading ? <Spinner size={14} /> : <Mail size={14} />} onClick={() => openBugReport(true)}>
                Include logs &amp; open email
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

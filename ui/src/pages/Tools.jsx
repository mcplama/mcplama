/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useEffect } from 'react'
import { Search, Zap } from 'lucide-react'
import api from '../lib/api'
import { Card, Badge, Spinner, EmptyState, PageHeader } from '../components/ui'
import { Paginator } from '../components/ui/Paginator'
import ServerIcon from '../components/ui/ServerIcon'
import { usePagination } from '../hooks/usePagination'

export default function Tools() {
  const [servers, setServers] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/servers').then(r => setServers(r.data)).finally(() => setLoading(false))
  }, [])

  const tools = servers.flatMap(s => (s.tools || []).map(t => ({ tool: t, server: s })))
  const filtered = query
    ? tools.filter(({ tool, server }) =>
        tool.toLowerCase().includes(query.toLowerCase()) ||
        server.name.toLowerCase().includes(query.toLowerCase()))
    : tools
  const { page, setPage, totalPages, paginated, total } = usePagination(filtered)

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner size={24} /></div>

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Tools registry"
        description={`${tools.length} tools across ${servers.filter(s => s.is_enabled).length} active servers`}
      />
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-t3" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search tools…"
          className="w-full pl-9 pr-3 py-2 text-sm rounded-xl bg-surface border border-border text-t1 outline-none focus:border-accent transition-all"
        />
      </div>
      <Card>
        <div className="divide-y divide-border">
          {filtered.length === 0 && (
            <EmptyState icon={Zap} title="No tools" description="Tools appear here when servers are connected and enabled." />
          )}
          {paginated.map(({ tool, server }, i) => (
            <div
              key={`${server.id}-${tool}-${i}`}
              className="flex items-center gap-4 px-6 py-3 hover:bg-t1/[0.02] transition-colors"
            >
              <ServerIcon server={server} size="sm" />
              <span className="flex-1 text-sm font-mono font-medium text-t1">{tool}</span>
              <span className="text-xs text-t3">{server.name}</span>
              <Badge variant={server.is_enabled ? 'ok' : 'default'}>{server.is_enabled ? 'active' : 'disabled'}</Badge>
            </div>
          ))}
        </div>
        <Paginator page={page} totalPages={totalPages} onChange={setPage} total={total} />
      </Card>
    </div>
  )
}

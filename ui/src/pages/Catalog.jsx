/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useEffect } from 'react'
import { Search, Plus, Lock, CheckCircle, Package as PackageIcon, Settings, MoreVertical, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { Btn, Spinner, EmptyState, PageHeader } from '../components/ui'
import { Paginator } from '../components/ui/Paginator'
import { usePagination } from '../hooks/usePagination'
import AddServerModal from './_AddServerModal'
import { CatIcon, CatalogDetailModal, catalogRequirementFields } from './_CatalogHelpers'

const customCatalogEntry = server => ({
  ...server,
  id: `custom-${server.id}`,
  server_id: server.id,
  publisher: 'Your organization',
  custom: true,
  installed_by_admin: true,
})

export default function Catalog() {
  const [registry, setRegistry]             = useState([])
  const [installed, setInstalled]           = useState([])
  const [query, setQuery]                   = useState('')
  const [cat, setCat]                       = useState('all')
  const [loading, setLoading]               = useState(true)
  const [adding, setAdding]                 = useState(null)
  const [showAdd, setShowAdd]               = useState(false)
  const [showOfficialOnly, setShowOfficialOnly] = useState(false)
  const [selected, setSelected]             = useState(null)
  const [refreshing, setRefreshing]         = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([api.get('/registry'), api.get('/servers', { params: { limit: 1000 } })])
      .then(([r, s]) => {
        const servers = s.data
        const customServers = servers.filter(sv => !sv.registry_id).map(customCatalogEntry)
        const registryServers = r.data.map(entry => ({
          ...entry,
          installed_by_admin: servers.some(sv => sv.registry_id === entry.id),
        }))
        setRegistry([...customServers, ...registryServers])
        setInstalled([
          ...servers.map(sv => sv.registry_id).filter(Boolean),
          ...customServers.map(sv => sv.id),
        ])
      })
      .finally(() => setLoading(false))
  }, [])

  const refreshCatalog = async () => {
    setRefreshing(true)
    try {
      await api.post('/registry/refresh')
      const [{ data }, { data: servers }] = await Promise.all([
        api.get('/registry'),
        api.get('/servers', { params: { limit: 1000 } }),
      ])
      setRegistry([
        ...servers.filter(sv => !sv.registry_id).map(customCatalogEntry),
        ...data.map(entry => ({
          ...entry,
          installed_by_admin: servers.some(sv => sv.registry_id === entry.id),
        })),
      ])
    } catch (e) { alert(e.response?.data?.detail || 'Failed to refresh catalog') }
    finally { setRefreshing(false) }
  }

  const install = async (entry) => {
    setAdding(entry.id)
    try {
      const { data } = await api.post('/servers', {
        name: entry.name, description: entry.description, icon: entry.icon, color: entry.color,
        logo_url: entry.logo_url || null, category: entry.category, registry_id: entry.id,
        docs_url: entry.docs_url, version: entry.version, runtime: entry.runtime,
        transport: entry.transport, docker_image: entry.docker_image || null,
        docker_args: entry.docker_args || [], container_port: entry.container_port || 8000,
        package: entry.package || null, args: entry.args || [], url: entry.url || null,
        auth_type: entry.auth_type || 'none', auth_mode: entry.auth_mode || 'none',
        user_config_schema: catalogRequirementFields(entry), tools: entry.tools || [],
      })
      setInstalled(i => [...i, entry.id])
      navigate('/servers/' + data.id)
    } catch (e) { alert(e.response?.data?.detail || 'Failed to install') }
    finally { setAdding(null) }
  }

  const categories = ['all', ...new Set(registry.map(e => e.category).filter(Boolean))]
  const filtered = registry.filter(e =>
    (cat === 'all' || e.category === cat) &&
    (!query || e.name.toLowerCase().includes(query.toLowerCase()) || (e.description || '').toLowerCase().includes(query.toLowerCase())) &&
    (!showOfficialOnly || e.official)
  )
  const { page, setPage, totalPages, paginated, total } = usePagination(filtered, 20)

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner size={24} /></div>

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Catalog"
        description={`${registry.length} MCP connectors — install with one click`}
        action={
          <div className="flex gap-2">
            <Btn variant="secondary" size="sm" icon={RefreshCw} loading={refreshing} onClick={refreshCatalog}>
              Update catalog
            </Btn>
            <Btn variant="secondary" size="sm" icon={Plus} onClick={() => setShowAdd(true)}>Add custom</Btn>
          </div>
        }
      />

      {/* Search + filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setPage(1) }}
            placeholder="Search connectors…"
            className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-gray-800 text-gray-800 dark:text-white/90 placeholder:text-gray-400 outline-none focus:border-brand-300 focus:ring-3 focus:ring-brand-500/10 dark:focus:border-brand-800 transition-all"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowOfficialOnly(s => !s)}
            className={`filter-btn${showOfficialOnly ? ' active' : ''}`}
          >
            ✓ Official
          </button>
          {categories.map(c => (
            <button key={c} onClick={() => { setCat(c); setPage(1) }} className={`filter-btn${cat === c ? ' active' : ''}`}>
              <CatIcon cat={c} size={10} /> {c}
            </button>
          ))}
        </div>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {paginated.map(entry => {
          const isInstalled = installed.includes(entry.id)
          const credCount   = catalogRequirementFields(entry).length
          return (
            <article
              key={entry.id}
              tabIndex={0}
              onClick={() => setSelected(entry)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelected(entry)
                }
              }}
              className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] flex flex-col cursor-pointer transition hover:border-brand-300 hover:shadow-theme-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            >
              {/* Card body */}
              <div className="relative p-5 pb-8 flex-1">
                {/* Logo */}
                <div className="mb-5 inline-flex h-10 w-10 items-center justify-center">
                  {entry.logo_url
                    ? <img src={entry.logo_url} alt={entry.name} className="h-10 w-10 object-contain" />
                    : <PackageIcon size={24} className="text-brand-500" />}
                </div>

                <h3 className="mb-2 text-lg font-semibold text-gray-800 dark:text-white/90 leading-snug">
                  {entry.name}
                  {entry.official && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-500 dark:bg-brand-500/10 dark:text-brand-400">
                      ✓ Official
                    </span>
                  )}
                  {entry.verified_by_mcplama && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-500 dark:bg-brand-500/10 dark:text-brand-400">
                      ✓ Verified by MCPlama
                    </span>
                  )}
                  {entry.installed_by_admin && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-success-50 px-1.5 py-0.5 text-[10px] font-bold text-success-600 dark:bg-success-500/10 dark:text-success-400">
                      Installed by admin
                    </span>
                  )}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed">
                  {entry.description || 'No description available.'}
                </p>

                {/* Publisher + creds */}
                <div className="mt-3 flex items-center gap-3">
                  {entry.publisher && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">by {entry.publisher}</span>
                  )}
                  {credCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                      <Lock size={10} /> {credCount} credential{credCount > 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {/* Dots menu */}
                <div className="absolute top-5 right-5">
                  <button
                    onClick={event => { event.stopPropagation(); setSelected(entry) }}
                    className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                  >
                    <MoreVertical size={20} />
                  </button>
                </div>
              </div>

              {/* Card footer */}
              <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-800 p-5">
                <div className="flex gap-3">
                  {isInstalled && (
                    <button
                      onClick={event => { event.stopPropagation(); navigate('/servers') }}
                      className="shadow-theme-xs inline-flex h-11 w-11 items-center justify-center rounded-lg border border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                    >
                      <Settings size={18} />
                    </button>
                  )}
                  <button
                    onClick={event => { event.stopPropagation(); setSelected(entry) }}
                    className="shadow-theme-xs inline-flex h-11 items-center justify-center rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 dark:border-gray-700 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                  >
                    Details
                  </button>
                </div>

                {isInstalled ? (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success-600 dark:text-success-400">
                    <CheckCircle size={16} /> {entry.installed_by_admin ? 'Installed by admin' : 'Installed'}
                  </span>
                ) : (
                  <span className="text-xs font-medium text-brand-500">View details to install →</span>
                )}
              </div>
            </article>
          )
        })}

        {filtered.length === 0 && (
          <div className="col-span-3">
            <EmptyState icon={Search} title="No results" description={query ? `No connectors matching "${query}"` : 'No connectors in this category'} />
          </div>
        )}
      </div>

      <Paginator page={page} totalPages={totalPages} onChange={setPage} total={total} />

      {selected && (
        <CatalogDetailModal
          entry={selected}
          onClose={() => setSelected(null)}
          onInstall={install}
          installing={adding === selected?.id}
          isInstalled={installed.includes(selected?.id)}
        />
      )}

      {showAdd && (
        <AddServerModal
          onClose={() => setShowAdd(false)}
          onAdded={id => { setShowAdd(false); navigate('/servers/' + id) }}
        />
      )}
    </div>
  )
}

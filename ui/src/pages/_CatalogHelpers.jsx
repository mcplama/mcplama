/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useEffect } from 'react'
import {
  Globe, HardDrive, Zap, Lock, Package as PackageIcon,
  Search, Code2, Database, FolderOpen, CreditCard, Layout,
  Cloud, Wrench, BarChart2, Gamepad2, Grid3x3,
  X, ExternalLink, CheckCircle, Loader2,
} from 'lucide-react'

const CAT_ICONS = {
  search: Search, dev: Code2, database: Database, storage: FolderOpen,
  finance: CreditCard, productivity: Layout, cloud: Cloud, tools: Wrench,
  monitoring: BarChart2, gaming: Gamepad2, all: Grid3x3,
}

export function CatIcon({ cat, size = 11, ...props }) {
  const Icon = CAT_ICONS[cat] || Wrench
  return <Icon size={size} {...props} />
}

export function catalogRequirementFields(entry) {
  if (entry.user_config_schema?.length) return entry.user_config_schema
  if (typeof entry.requirements !== 'string') return []

  const configured = entry.requirements.match(/Configure:\s*([^.;]+)/i)?.[1]
  if (!configured) return []

  return configured
    .split(',')
    .map(key => key.replace(/[`'".]/g, '').trim())
    .filter(Boolean)
    .map(key => ({
      key,
      label: key,
      type: /(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)/i.test(key) ? 'secret' : 'text',
    }))
}

export function CatalogDetailModal({ entry, onClose, onInstall, installing, isInstalled }) {
  const requirementFields = catalogRequirementFields(entry)

  useEffect(() => {
    const closeOnEscape = event => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[110] flex justify-start"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${entry.name} catalog details`}
        className="catalog-detail-panel flex h-full w-[min(540px,94vw)] flex-col overflow-hidden bg-surface border-r border-border shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center gap-4 p-6 border-b border-border">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 overflow-hidden bg-card2 border border-border">
            {entry.logo_url
              ? <img src={entry.logo_url} alt={entry.name} className="w-10 h-10 object-contain" />
              : <PackageIcon size={26} className="text-accent" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-t1">{entry.name}</h2>
              {entry.official && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-accent/10 text-accent border border-accent/25">
                  ✓ Official
                </span>
              )}
              {entry.verified_by_mcplama && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-accent/10 text-accent border border-accent/25">
                  ✓ Verified by MCPlama
                </span>
              )}
              {entry.installed_by_admin && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-ok/10 text-ok border border-ok/25">
                  Installed by admin
                </span>
              )}
            </div>
            <p className="text-xs mt-0.5 text-t3">
              by <span className="text-t2">{entry.publisher}</span>
              {entry.installs > 0 && <span> · {entry.installs.toLocaleString()} installs</span>}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-t3 hover:text-t1 transition-colors p-1.5 rounded-lg hover:bg-card2"
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 flex-1 overflow-y-auto">
          <p className="text-sm leading-relaxed text-t2 break-words">{entry.description || 'No description available.'}</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl p-3 bg-card2 border border-border">
              <p className="text-[10px] font-semibold uppercase tracking-wide mb-1 text-t3">Runtime</p>
              <p className="text-sm font-mono font-medium text-t1">
                {entry.runtime === 'npx' ? 'NPX'
                  : entry.runtime === 'uvx' ? 'UVX'
                  : entry.runtime === 'docker' ? 'Docker'
                  : 'Remote'}
              </p>
              {(entry.package || entry.docker_image) && (
                <p className="text-[10px] mt-1 font-mono truncate text-t3">
                  {entry.package || entry.docker_image}
                </p>
              )}
            </div>
            <div className="rounded-xl p-3 bg-card2 border border-border">
              <p className="text-[10px] font-semibold uppercase tracking-wide mb-1 text-t3">Category</p>
              <p className="flex items-center gap-1.5 text-sm font-medium capitalize text-t1">
                <CatIcon cat={entry.category} size={13} /> {entry.category}
              </p>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide mb-2 text-t3">Setup requirements</p>
            <div className="rounded-xl p-3 bg-card2 border border-border">
              <p className="text-xs leading-relaxed text-t2 break-words">
                {entry.requirements || (requirementFields.length > 0
                  ? `Configure: ${requirementFields.map(field => field.key).join(', ')}.`
                  : 'No credentials or additional setup declared by the publisher.')}
              </p>
            </div>

            {requirementFields.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide mt-4 text-t3">
                  Configuration fields ({requirementFields.length})
                </p>
                {requirementFields.map(f => (
                  <div key={f.key} className="flex items-center gap-3 rounded-xl px-3 py-2.5 bg-card2 border border-border">
                    <span className="text-xs font-mono font-semibold shrink-0 text-accent">{f.key}</span>
                    <span className={`text-[10px] ml-auto shrink-0 px-1.5 py-0.5 rounded ${
                      f.type === 'secret'
                        ? 'bg-danger/10 text-danger'
                        : 'bg-ok/10 text-ok'
                    }`}>
                      {f.type === 'secret' ? 'secret' : 'text'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {entry.docs_url && (
            <a href={entry.docs_url} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-accent hover:underline transition-all">
              <ExternalLink size={11} /> View documentation
            </a>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border">
          <span className="text-xs text-t3">Review the requirements before installing.</span>
          {isInstalled ? (
            <span className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-xl bg-ok/10 text-ok border border-ok/25">
              <CheckCircle size={14} /> {entry.installed_by_admin ? 'Installed by admin' : 'Installed'}
            </span>
          ) : (
            <button
              onClick={() => onInstall(entry)}
              disabled={installing}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-accent text-white hover:opacity-85 transition-all disabled:opacity-60"
            >
              {installing
                ? <><Loader2 size={13} className="animate-spin" /> Installing...</>
                : <><Zap size={13} /> Install</>}
            </button>
          )}
        </div>
        <style>{`
          @keyframes catalogPanelIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }
          .catalog-detail-panel { animation: catalogPanelIn 0.2s ease-out; }
        `}</style>
      </aside>
    </div>
  )
}

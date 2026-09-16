/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { ChevronLeft, ChevronRight } from 'lucide-react'

export function Paginator({ page, totalPages, onChange, total, pageSize = 20 }: {
  page: number; totalPages: number; onChange: (p: number) => void; total: number; pageSize?: number
}) {
  if (totalPages <= 1) return null
  const from = (page - 1) * pageSize + 1
  const to   = Math.min(page * pageSize, total)

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
    .reduce<(number | string)[]>((acc, p, i, arr) => {
      if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('…')
      acc.push(p)
      return acc
    }, [])

  return (
    <div className="flex items-center justify-center gap-1.5 py-4 border-t border-border">
      <button
        onClick={() => onChange(page - 1)} disabled={page === 1}
        aria-label="Previous page"
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-card border border-border text-t1 disabled:opacity-40 disabled:cursor-not-allowed hover:border-border2 transition-colors"
      ><ChevronLeft size={13} /> Prev</button>

      {pages.map((p, i) =>
        p === '…'
          ? <span key={`e${i}`} className="text-t3 text-xs px-0.5">…</span>
          : <button
              key={p}
              onClick={() => onChange(p as number)}
              className={`w-8 h-8 rounded-lg text-xs font-semibold transition-all ${
                page === p
                  ? 'bg-accent text-white border border-accent'
                  : 'bg-card text-t2 border border-border hover:border-border2'
              }`}
            >{p}</button>
      )}

      <button
        onClick={() => onChange(page + 1)} disabled={page === totalPages}
        aria-label="Next page"
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-card border border-border text-t1 disabled:opacity-40 disabled:cursor-not-allowed hover:border-border2 transition-colors"
      >Next <ChevronRight size={13} /></button>

      <span className="text-t3 text-xs ml-1">{from}–{to} of {total}</span>
    </div>
  )
}

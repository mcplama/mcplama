/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { type ReactNode } from 'react'
import clsx from 'clsx'
import { Card } from './Card'

interface StatProps {
  label: string
  value: ReactNode
  sub?: string
  accent?: boolean
  icon?: React.ElementType
  trend?: number
}

export function Stat({ label, value, sub, accent, icon: Icon, trend }: StatProps) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-3">
        <div className={clsx(
          'w-9 h-9 rounded-xl flex items-center justify-center',
          accent ? 'bg-accent/10 text-info' : 'bg-card2 text-t3'
        )}>
          {Icon && <Icon size={17} strokeWidth={1.8} />}
        </div>
        {trend !== undefined && (
          <span className={clsx('text-xs font-medium', trend >= 0 ? 'text-ok' : 'text-danger')}>
            {trend >= 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
      <p className={clsx('text-2xl font-bold tracking-tight mb-0.5', accent ? 'text-info' : 'text-t1')}>{value}</p>
      <p className="text-sm text-t3">{label}</p>
      {sub && <p className="text-xs mt-0.5 text-t3">{sub}</p>}
    </Card>
  )
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-t1 font-display">{title}</h1>
        {description && <p className="text-sm mt-1 text-t3">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export const SectionHeader = PageHeader

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={clsx(
      'inline-flex items-center text-xs font-mono px-2 py-0.5 rounded-lg',
      'bg-card2 text-t2 border border-border', className
    )}>
      {children}
    </span>
  )
}

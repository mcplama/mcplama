/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { type ReactNode } from 'react'
import clsx from 'clsx'

type BadgeVariant = 'default' | 'primary' | 'ok' | 'warn' | 'danger' | 'info' | 'purple' | 'accent'

interface BadgeProps {
  children: ReactNode
  variant?: BadgeVariant
  dot?: boolean
  className?: string
}

const VARIANTS: Record<BadgeVariant, string> = {
  default: 'bg-card2 text-t2 border-border',
  primary: 'bg-info/10 text-info border-info/25',
  ok:      'bg-ok/10 text-ok border-ok/25',
  warn:    'bg-warn/10 text-warn border-warn/25',
  danger:  'bg-danger/10 text-danger border-danger/25',
  info:    'bg-info/10 text-info border-info/25',
  purple:  'bg-purple-500/10 text-purple-300 border-purple-500/25',
  accent:  'bg-accent/10 text-accent border-accent/25',
}

const DOT_COLORS: Record<BadgeVariant, string> = {
  default: 'bg-t3', primary: 'bg-accent', ok: 'bg-ok',
  warn: 'bg-warn', danger: 'bg-danger', info: 'bg-info', purple: 'bg-purple-300', accent: 'bg-accent',
}

export function Badge({ children, variant = 'default', dot, className }: BadgeProps) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border',
      VARIANTS[variant], className
    )}>
      {dot && <span className={clsx('w-1.5 h-1.5 rounded-full', DOT_COLORS[variant])} />}
      {children}
    </span>
  )
}

export function StatusDot({ status, pulse }: { status: string; pulse?: boolean }) {
  const COLOR: Record<string, string> = {
    online: 'bg-ok', degraded: 'bg-warn', offline: 'bg-danger', provisioning: 'bg-info',
  }
  const color = COLOR[status] ?? 'bg-t3'
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {pulse && status === 'online' && (
        <span className={clsx('animate-ping absolute inset-0 rounded-full opacity-50', color)} />
      )}
      <span className={clsx('relative rounded-full h-2 w-2', color)} />
    </span>
  )
}

export function AuthStatusBadge({ status }: { status: string }) {
  const MAP: Record<string, { variant: BadgeVariant; dot: boolean; label: string }> = {
    connected:      { variant: 'ok',      dot: true,  label: 'Connected' },
    expired:        { variant: 'danger',  dot: true,  label: 'Expired' },
    not_connected:  { variant: 'default', dot: false, label: 'Not connected' },
    no_credentials: { variant: 'warn',    dot: false, label: 'Needs credentials' },
    not_required:   { variant: 'default', dot: false, label: 'No auth' },
    not_configured: { variant: 'warn',    dot: false, label: 'Not configured' },
  }
  const c = MAP[status] ?? MAP.not_required
  return <Badge variant={c.variant} dot={c.dot}>{c.label}</Badge>
}

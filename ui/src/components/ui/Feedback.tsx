/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { type ReactNode } from 'react'
import { Loader, Lock } from 'lucide-react'
import clsx from 'clsx'
import { Badge } from './Badge'

export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return <Loader size={size} className={clsx('spin text-t3', className)} />
}

export function EmptyState({ icon: Icon, title, description, action, className }: {
  icon?: React.ElementType; title: string; description?: string; action?: ReactNode; className?: string
}) {
  return (
    <div className={clsx('flex flex-col items-center justify-center py-16 px-6 text-center', className)}>
      {Icon && (
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 bg-accent/[0.07] border border-accent/20">
          <Icon size={24} strokeWidth={1.5} className="text-accent/70" />
        </div>
      )}
      <p className="text-sm font-semibold text-t2 mb-1.5">{title}</p>
      {description && <p className="text-sm text-t3 mb-5 max-w-xs leading-relaxed">{description}</p>}
      {action}
    </div>
  )
}

type AlertVariant = 'info' | 'warn' | 'danger' | 'success'

const ALERT: Record<AlertVariant, string> = {
  info:    'bg-accent/8 border-accent/20 text-info',
  warn:    'bg-warn/8 border-warn/20 text-warn',
  danger:  'bg-danger/8 border-danger/20 text-danger',
  success: 'bg-ok/8 border-ok/20 text-ok',
}

export function Alert({ children, variant = 'info', className }: { children: ReactNode; variant?: AlertVariant; className?: string }) {
  return (
    <div className={clsx('flex gap-3 rounded-xl px-4 py-3 text-sm leading-relaxed border', ALERT[variant], className)}>
      {children}
    </div>
  )
}

export function EnterpriseGate({ feature, children }: { feature: string; children: ReactNode }) {
  return (
    <div className="relative rounded-2xl overflow-hidden">
      <div className="opacity-20 pointer-events-none select-none">{children}</div>
      <div className="absolute inset-0 flex flex-col items-center justify-center backdrop-blur-sm bg-surface/85">
        <Lock size={16} className="mb-2 text-t3" />
        <Badge variant="default" className="mb-2">Pro feature</Badge>
        <p className="text-xs text-center max-w-[180px] text-t3">{feature}</p>
      </div>
    </div>
  )
}

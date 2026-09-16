/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { type ReactNode, type MouseEvent } from 'react'
import clsx from 'clsx'

interface CardProps {
  children: ReactNode
  className?: string
  onClick?: (e: MouseEvent<HTMLDivElement>) => void
}

export function Card({ children, className, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'bg-card rounded-2xl transition-all shadow-card',
        onClick && 'cursor-pointer hover:shadow-md',
        className
      )}
    >
      {children}
    </div>
  )
}

interface PanelHeadProps {
  title: string
  sub?: string | number
  action?: ReactNode
  border?: boolean
}

export function PanelHead({ title, sub, action, border = true }: PanelHeadProps) {
  return (
    <div className={clsx('flex items-center justify-between px-6 py-4', border && 'border-b border-border')}>
      <div className="flex items-center gap-3 min-w-0">
        <h3 className="text-sm font-semibold text-t1">{title}</h3>
        {sub !== undefined && (
          <span className="text-xs font-mono px-2 py-0.5 rounded-full border bg-card2 border-border text-t3">
            {sub}
          </span>
        )}
      </div>
      {action}
    </div>
  )
}

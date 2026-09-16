/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { type ReactNode, type ButtonHTMLAttributes } from 'react'
import { Loader } from 'lucide-react'
import clsx from 'clsx'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type Size = 'xs' | 'sm' | 'md' | 'lg'

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: React.ElementType
  children?: ReactNode
}

const SIZES: Record<Size, string> = {
  xs: 'text-xs px-4 py-1.5 h-7',
  sm: 'text-sm px-3 py-1.5 h-8',
  md: 'text-sm px-4 py-2 h-9',
  lg: 'text-base px-5 py-2.5 h-11',
}

const VARIANTS: Record<Variant, string> = {
  primary:   'bg-accent text-white hover:opacity-85 shadow-sm',
  secondary: 'bg-card2 text-t2 border border-border hover:border-border2 hover:text-t1',
  ghost:     'bg-transparent text-t2 hover:bg-card hover:text-t1',
  danger:    'bg-card text-danger border border-danger/30 hover:border-danger/60',
  success:   'bg-card text-ok border border-ok/30 hover:border-ok/60',
}

export function Btn({ children, variant = 'secondary', size = 'md', className, loading, disabled, icon: Icon, ...props }: BtnProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 font-bold rounded-xl',
        'transition-all duration-150 select-none whitespace-nowrap',
        'disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        SIZES[size],
        VARIANTS[variant],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading
        ? <Loader size={14} className="spin shrink-0" />
        : Icon ? <Icon size={14} className="shrink-0" /> : null}
      {children}
    </button>
  )
}

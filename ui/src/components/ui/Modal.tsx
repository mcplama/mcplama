/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { type ReactNode } from 'react'
import { X } from 'lucide-react'
import clsx from 'clsx'

export function Modal({ children, onClose, width = 'max-w-xl', closeOnBackdrop = true }: { children: ReactNode; onClose: () => void; width?: string; closeOnBackdrop?: boolean }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
      onClick={e => closeOnBackdrop && e.target === e.currentTarget && onClose()}
    >
      <div className={clsx(
        'w-full rounded-2xl shadow-card flex flex-col max-h-[90vh] animate-scale-in overflow-hidden',
        'bg-card border border-border2', width
      )}>
        {children}
      </div>
    </div>
  )
}

export function ModalHeader({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between px-6 py-5 shrink-0 border-b border-border">
      <div>
        <p className="text-base font-semibold text-t1">{title}</p>
        {subtitle && <p className="text-sm mt-0.5 text-t3">{subtitle}</p>}
      </div>
      <button
        onClick={onClose}
        className="w-8 h-8 flex items-center justify-center rounded-xl ml-4 shrink-0 text-t3 hover:bg-card2 hover:text-t1 transition-all"
      >
        <X size={16} />
      </button>
    </div>
  )
}

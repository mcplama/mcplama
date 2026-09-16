/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, type ReactNode } from 'react'
import { Copy, Check } from 'lucide-react'
import clsx from 'clsx'

export function CopyBtn({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error('Copy failed', err)
    }
  }
  return (
    <button onClick={copy} className={clsx('text-t3 hover:text-t2 transition-colors', className)}>
      {copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
    </button>
  )
}

export function CodeBlock({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  const text = String(children)
  return (
    <div className={clsx('group', className)}>
      {label && <p className="text-xs font-medium text-t3 mb-1.5">{label}</p>}
      <div className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 bg-card2 border border-border overflow-x-auto">
        <code className="flex-1 text-xs font-mono text-t2 whitespace-nowrap">{text}</code>
        <CopyBtn text={text} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  )
}

export function CodeEditor({ value, label, className }: { value: string; label?: string; className?: string }) {
  return (
    <div className={clsx('group', className)}>
      {label && <p className="text-xs font-medium text-t3 mb-1.5">{label}</p>}
      <div className="relative rounded-xl overflow-hidden border border-border" style={{ background: '#0a0e16' }}>
        <pre className="p-4 text-xs font-mono overflow-x-auto leading-relaxed whitespace-pre text-t2">{value}</pre>
        <CopyBtn text={value} className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  )
}

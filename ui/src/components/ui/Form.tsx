/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes, type ReactNode } from 'react'
import clsx from 'clsx'

interface FieldWrapProps {
  label?: string
  error?: string
  hint?: string
  required?: boolean
  className?: string
  children: ReactNode
}

function FieldWrap({ label, error, hint, required, className, children }: FieldWrapProps) {
  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-semibold text-t2 mb-1.5">
          {label}{required && <span className="ml-1 text-danger">*</span>}
        </label>
      )}
      {children}
      {error     && <p className="text-xs mt-1.5 font-medium text-danger">{error}</p>}
      {hint && !error && <p className="text-xs mt-1.5 leading-relaxed text-t3">{hint}</p>}
    </div>
  )
}

const inputCls = (error?: string) => clsx(
  'w-full rounded-xl px-3 py-2.5 text-sm bg-card border text-t1 placeholder:text-t3/60',
  'transition-all outline-none',
  'focus:border-accent focus:ring-2 focus:ring-accent/20',
  error ? 'border-danger focus:ring-danger/20' : 'border-border'
)

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string; error?: string; hint?: string; prefix?: ReactNode; suffix?: ReactNode
}

export function Input({ label, error, hint, required, className, prefix, suffix, ...props }: InputProps) {
  return (
    <FieldWrap label={label} error={error} hint={hint} required={required} className={className}>
      <div className="relative">
        {prefix && <div className="absolute left-3 top-1/2 -translate-y-1/2 text-t3">{prefix}</div>}
        <input className={clsx(inputCls(error), prefix && 'pl-9', suffix && 'pr-9')} {...props} />
        {suffix && <div className="absolute right-3 top-1/2 -translate-y-1/2 text-t3">{suffix}</div>}
      </div>
    </FieldWrap>
  )
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string; error?: string; hint?: string
}

export function Textarea({ label, error, hint, required, className, ...props }: TextareaProps) {
  return (
    <FieldWrap label={label} error={error} hint={hint} required={required} className={className}>
      <textarea className={clsx(inputCls(error), 'resize-none')} {...props} />
    </FieldWrap>
  )
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string; error?: string; children: ReactNode
}

export function Select({ label, error, required, children, className, ...props }: SelectProps) {
  return (
    <FieldWrap label={label} error={error} required={required} className={className}>
      <select className={inputCls(error)} {...props}>{children}</select>
    </FieldWrap>
  )
}

export function Toggle({ enabled, onChange, disabled }: { enabled: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      onClick={() => !disabled && onChange(!enabled)}
      className={clsx(
        'relative inline-flex h-5 w-9 rounded-full transition-all duration-200 shrink-0',
        enabled ? 'bg-accent' : 'bg-border',
        disabled && 'opacity-40 cursor-not-allowed'
      )}
    >
      <span
        className="inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform duration-200"
        style={{ transform: enabled ? 'translateX(16px)' : 'translateX(2px)' }}
      />
    </button>
  )
}

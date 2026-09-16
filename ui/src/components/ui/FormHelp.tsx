/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState } from 'react'

export function FormHelp({ text }: { text: string }) {
  const [open, setOpen] = useState(false)

  return (
    <span className="relative inline-flex align-middle ml-1 group">
      <button
        type="button"
        aria-label="More information"
        title={text}
        onClick={() => setOpen(value => !value)}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-t3/60 text-[9px] font-bold normal-case tracking-normal text-t3 hover:border-accent hover:text-accent focus:outline-none focus:ring-1 focus:ring-accent"
      >?
      </button>
      <span
        role="tooltip"
        className={`${open ? 'block' : 'hidden'} group-hover:block absolute z-50 left-1/2 bottom-full mb-2 -translate-x-1/2 w-56 rounded-lg border border-border bg-card px-2.5 py-2 text-[11px] font-normal normal-case tracking-normal leading-relaxed text-t2 shadow-lg`}
      >
        {text}
      </span>
    </span>
  )
}

/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

export default function Footer() {
  return (
    <footer className="h-8 bg-surface border-t border-border flex items-center justify-end px-5 shrink-0">
      <span className="text-[11px] text-t3">Mcplama &copy; {new Date().getFullYear()}</span>
    </footer>
  )
}

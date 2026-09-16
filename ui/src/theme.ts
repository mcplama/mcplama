/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

/**
 * theme.ts — single source of truth for design tokens.
 * All values point to CSS vars defined in index.css.
 * Use Tailwind classes (bg-surface, text-t1) where possible.
 * Use T.x only for inline styles that need dynamic/gradient values.
 */
export const T = {
  // Backgrounds
  bg:      'var(--bg)',
  surface: 'var(--surface)',
  card:    'var(--card)',
  card2:   'var(--card2)',

  // Borders
  border:  'var(--border)',
  border2: 'var(--border2)',

  // Brand
  accent:       'var(--accent)',
  accentHover:  'var(--accent-hover)',
  accentSolid:  'var(--accent-solid)',
  accentGrad:   'var(--accent-grad)',
  onAccent:     'var(--on-accent)',

  // Text
  t1: 'var(--t1)',
  t2: 'var(--t2)',
  t3: 'var(--t3)',

  // Status
  ok:     'var(--ok)',
  warn:   'var(--warn)',
  danger: 'var(--danger)',
  info:   'var(--info)',
} as const

export type ThemeToken = keyof typeof T

/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

const STORAGE_KEY = 'mcplama_time'

export interface TimePref {
  timezone: string
  timeFormat: '24h' | '12h'
  dateFormat: string
}

const DEFAULT_PREF: TimePref = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  timeFormat: '24h',
  dateFormat: 'YYYY-MM-DD',
}

export function getTimePref(): TimePref {
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    return s ? JSON.parse(s) : DEFAULT_PREF
  } catch {
    return DEFAULT_PREF
  }
}

/**
 * The backend serializes timestamps from naive UTC datetimes (no "Z"/offset
 * suffix). `new Date("...")` on a string like that is parsed as *local* wall
 * time per the ECMA-262 date-time string spec, not UTC — so without this,
 * every log timestamp silently renders as the raw UTC clock reading
 * regardless of the viewer's timezone or the Time & date preference below.
 */
export function parseServerTimestamp(raw: string | number | Date): Date {
  if (typeof raw !== 'string') return new Date(raw)
  const hasZone = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(raw)
  return new Date(hasZone ? raw : raw + 'Z')
}

/** Formats a server timestamp using the same Time & date preference shown on the Settings page. */
export function formatLogTimestamp(raw: string | number | Date, pref: TimePref = getTimePref()) {
  const d = parseServerTimestamp(raw)
  const time = d.toLocaleTimeString('en', {
    timeZone: pref.timezone,
    hour12: pref.timeFormat === '12h',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: pref.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const get = (type: string) => parts.find(p => p.type === type)?.value || '00'
  const [y, m, day] = [get('year'), get('month'), get('day')]
  const date = pref.dateFormat === 'DD/MM/YYYY' ? `${day}/${m}/${y}`
    : pref.dateFormat === 'MM/DD/YYYY' ? `${m}/${day}/${y}`
    : `${y}-${m}-${day}`
  return { date, time }
}

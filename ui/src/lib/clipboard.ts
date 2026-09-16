/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

/**
 * navigator.clipboard is only defined in secure contexts (HTTPS, or
 * localhost) — MCPlama is routinely accessed over plain HTTP on a LAN IP,
 * where it's simply undefined. Falls back to the classic hidden-textarea +
 * execCommand('copy') approach, which works in insecure contexts too.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

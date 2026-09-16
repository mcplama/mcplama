/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

// Shared helpers used across multiple page files.
// Do NOT import T from theme here — use Tailwind classes in pages instead.
import { useState, useEffect, useCallback } from 'react'
import api from '../lib/api'

export const PAGE_SIZE = 20

export function useBackendPagination(fetchFn, deps = []) {
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    const limit = PAGE_SIZE
    const offset = (page - 1) * PAGE_SIZE
    fetchFn(limit, offset)
      .then(r => {
        setData(r.data)
        setTotal(parseInt(r.headers?.['x-total-count'] || r.data.length))
      })
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, ...deps])

  useEffect(() => { load() }, [load])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return { data, total, page, setPage, totalPages, loading, reload: load, PAGE_SIZE }
}

/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useMemo } from 'react'

interface PaginationResult<T> {
  page: number
  setPage: (p: number) => void
  totalPages: number
  paginated: T[]
  total: number
  resetPage: () => void
}

export function usePagination<T>(items: T[], pageSize = 20): PaginationResult<T> {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const safePage = Math.min(page, totalPages)

  const paginated = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize]
  )

  return { page: safePage, setPage, totalPages, paginated, total: items.length, resetPage: () => setPage(1) }
}

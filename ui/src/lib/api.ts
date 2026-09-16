/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

/// <reference types="vite/client" />
import axios from 'axios'

export const USER_KEY = 'Mcplama_user'

// ── Axios instance ────────────────────────────────────────────────────────────
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api/v1',
  withCredentials: true,
})

// Routes that should NOT trigger a /login redirect on 401
const SKIP_REDIRECT = [
  '/auth/setup-status',
  '/auth/login',
  '/auth/setup',
  '/auth/me',
]

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      const url = err.config?.url ?? ''
      if (!SKIP_REDIRECT.some(s => url.includes(s))) {
        localStorage.removeItem(USER_KEY)
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)

export default api

// ── Resource helpers ──────────────────────────────────────────────────────────
// Use these in components instead of calling api.get('/path') directly.
// Keeps endpoint strings in one place and makes refactoring easy.

export const auth = {
  login:    (email: string, password: string) => api.post('/auth/login', { email, password }),
  me:       ()                                => api.get('/auth/me'),
  logout:   ()                                => api.post('/auth/logout'),
}

export const servers = {
  list:       ()                                  => api.get('/servers'),
  get:        (id: number | string)               => api.get(`/servers/${id}`),
  create:     (data: Record<string, unknown>)     => api.post('/servers', data),
  update:     (id: number | string, data: Record<string, unknown>) => api.patch(`/servers/${id}`, data),
  delete:     (id: number | string, deleteImage?: boolean) => api.delete(`/servers/${id}`, { params: { delete_image: !!deleteImage } }),
  test:       (id: number | string)               => api.post(`/servers/${id}/test`),
  authStatus: (id: number | string)               => api.get(`/servers/${id}/auth-status`),
}

export const registry = {
  list:    (q?: string, category?: string) => api.get('/registry', { params: { q, category } }),
  get:     (id: number | string)           => api.get(`/registry/${id}`),
  refresh: ()                              => api.post('/registry/refresh'),
}

export const oauthApi = {
  authorizeUrl: (serverId: number | string) => `/api/v1/oauth/${serverId}/authorize`,
  disconnect:   (serverId: number | string) => api.post(`/oauth/${serverId}/disconnect`),
}

export const connections = {
  list:         ()                              => api.get('/connections'),
  create:       (data: Record<string, unknown>) => api.post('/connections', data),
  delete:       (id: number | string)           => api.delete(`/connections/${id}`),
  claudeConfig: ()                              => api.get('/connections/config/claude-desktop'),
}

export const users = {
  list:   ()                                                        => api.get('/users'),
  update: (id: number | string, data: Record<string, unknown>)     => api.patch(`/users/${id}`, data),
  delete: (id: number | string)                                     => api.delete(`/users/${id}`),
}

export const policies = {
  list:   ()                              => api.get('/policies'),
  create: (data: Record<string, unknown>) => api.post('/policies', data),
  delete: (id: number | string)           => api.delete(`/policies/${id}`),
}

export const audit = {
  list: (params?: Record<string, unknown>) => api.get('/audit', { params }),
}

export const gateway = {
  stats:  ()                              => api.get('/gateway/stats'),
  config: ()                              => api.get('/gateway/config'),
  save:   (data: Record<string, unknown>) => api.post('/gateway/config', data),
}

export const alerts = {
  list:   ()                              => api.get('/alerts'),
  create: (data: Record<string, unknown>) => api.post('/alerts', data),
  toggle: (id: number | string)           => api.patch(`/alerts/${id}/toggle`),
  delete: (id: number | string)           => api.delete(`/alerts/${id}`),
  check:  ()                              => api.get('/alerts/check'),
}

export const smtp = {
  get:  ()                              => api.get('/smtp'),
  save: (data: Record<string, unknown>) => api.post('/smtp', data),
  test: (to: string)                    => api.post(`/smtp/test?to=${encodeURIComponent(to)}`),
}

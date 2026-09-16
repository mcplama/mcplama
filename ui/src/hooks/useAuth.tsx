/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { auth as authApi, USER_KEY } from '../lib/api'

interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'member'
}

interface AuthContextType {
  user: User | null
  loading: boolean
  isAdmin: boolean
  login: (email: string, password: string) => Promise<unknown>
  register: (form: Record<string, string>) => Promise<unknown>
  setSession: (user: User) => void
  logout: () => void
}

const Ctx = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') } catch { return null }
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    authApi.me()
      .then((r: { data: User }) => { setUser(r.data); localStorage.setItem(USER_KEY, JSON.stringify(r.data)) })
      .catch(() => { localStorage.removeItem(USER_KEY); setUser(null) })
      .finally(() => setLoading(false))
  }, [])

  const login = async (email: string, password: string) => {
    const { data } = await authApi.login(email, password)
    localStorage.setItem(USER_KEY, JSON.stringify(data.user))
    setUser(data.user)
    return data
  }

  const register = async (form: Record<string, string>) => {
    const { data } = await authApi.register(form)
    localStorage.setItem(USER_KEY, JSON.stringify(data.user))
    setUser(data.user)
    return data
  }

  const setSession = (sessionUser: User) => {
    localStorage.setItem(USER_KEY, JSON.stringify(sessionUser))
    setUser(sessionUser)
  }

  const logout = () => {
    authApi.logout().catch(() => {})
    localStorage.removeItem(USER_KEY)
    setUser(null)
  }

  return (
    <Ctx.Provider value={{ user, loading, isAdmin: user?.role === 'admin', login, register, setSession, logout }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

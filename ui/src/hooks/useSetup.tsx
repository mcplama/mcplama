/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import api from '../lib/api'

interface SetupContextType {
  setupDone: boolean | null
  loading: boolean
  markSetupDone: () => void
}

const SetupContext = createContext<SetupContextType | undefined>(undefined)

export function SetupProvider({ children }: { children: ReactNode }) {
  const [setupDone, setSetupDone] = useState<boolean | null>(null)

  useEffect(() => {
    api.get('/auth/setup-status')
      .then(r => setSetupDone(r.data.setup_done))
      .catch(() => setSetupDone(true))
  }, [])

  return (
    <SetupContext.Provider value={{ setupDone, loading: setupDone === null, markSetupDone: () => setSetupDone(true) }}>
      {children}
    </SetupContext.Provider>
  )
}

export function useSetup() {
  const ctx = useContext(SetupContext)
  if (!ctx) throw new Error('useSetup must be used within SetupProvider')
  return ctx
}

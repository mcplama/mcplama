/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

type SidebarContextType = {
  isExpanded: boolean
  isMobileOpen: boolean
  isHovered: boolean
  toggleSidebar: () => void
  toggleMobileSidebar: () => void
  setIsHovered: (v: boolean) => void
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

export function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider')
  return ctx
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 1024
      setIsMobile(mobile)
      if (!mobile) setIsMobileOpen(false)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const toggleSidebar = () => setIsExpanded(prev => !prev)
  const toggleMobileSidebar = () => setIsMobileOpen(prev => !prev)

  return (
    <SidebarContext.Provider value={{
      isExpanded: isMobile ? false : isExpanded,
      isMobileOpen,
      isHovered,
      toggleSidebar,
      toggleMobileSidebar,
      setIsHovered,
    }}>
      {children}
    </SidebarContext.Provider>
  )
}

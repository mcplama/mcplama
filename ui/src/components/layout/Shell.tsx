/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { type ReactNode } from 'react'
import { SidebarProvider, useSidebar } from '../../context/SidebarContext'
import Sidebar from './Sidebar'
import Navbar from './Navbar'

function LayoutContent({ children }: { children: ReactNode }) {
  const { isExpanded, isHovered, isMobileOpen, toggleMobileSidebar } = useSidebar()

  return (
    <div className="min-h-screen xl:flex bg-bg font-sans">
      <Sidebar />

      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-gray-900/50 lg:hidden"
          onClick={toggleMobileSidebar}
        />
      )}

      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ease-in-out
          ${isExpanded || isHovered ? 'lg:ml-[290px]' : 'lg:ml-[90px]'}
        `}
      >
        <Navbar />
        <main className="flex-1 overflow-auto p-4 md:p-6 bg-bg">
          {children}
        </main>
      </div>
    </div>
  )
}

export default function Shell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <LayoutContent>{children}</LayoutContent>
    </SidebarProvider>
  )
}

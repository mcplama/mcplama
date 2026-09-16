/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Moon, Sun, LogOut, User, ChevronDown, Plus } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { useSidebar } from '../../context/SidebarContext'

const COMMANDS = [
  { label: 'Overview', path: '/', keywords: 'dashboard home' },
  { label: 'Servers', path: '/servers', keywords: 'mcp installed' },
  { label: 'Connections', path: '/connections', keywords: 'tokens clients' },
  { label: 'Catalog', path: '/catalog', keywords: 'add install mcp' },
  { label: 'Activity', path: '/activity', keywords: 'logs audit events' },
  { label: 'Policies', path: '/policies', keywords: 'access rules security' },
  { label: 'Alerts', path: '/alerts', keywords: 'notifications monitoring' },
  { label: 'Users', path: '/users', keywords: 'members team invite' },
  { label: 'Settings', path: '/settings', keywords: 'configuration account' },
]

export default function Navbar() {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { isMobileOpen, toggleSidebar, toggleMobileSidebar } = useSidebar()
  const navigate = useNavigate()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [activeCommand, setActiveCommand] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const filteredCommands = COMMANDS.filter(command => {
    const query = commandQuery.trim().toLowerCase()
    return !query || `${command.label} ${command.keywords}`.toLowerCase().includes(query)
  })

  const runCommand = (path: string) => {
    navigate(path)
    setCommandOpen(false)
    setCommandQuery('')
    setActiveCommand(0)
  }

  const handleToggle = () => {
    if (window.innerWidth >= 1024) toggleSidebar()
    else toggleMobileSidebar()
  }

  const initials = (user?.name ?? 'A')
    .split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setCommandOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && window.innerWidth >= 1024) {
        event.preventDefault()
        setCommandOpen(true)
        window.setTimeout(() => searchInputRef.current?.focus(), 0)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  return (
    <header className="sticky top-0 z-[99] flex w-full bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between w-full px-4 lg:px-6 py-3 gap-4">

        {/* Left: hamburger + logo (mobile) + search */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Hamburger */}
          <button
            onClick={handleToggle}
            className="flex items-center justify-center w-10 h-10 text-gray-500 border border-gray-200 rounded-lg dark:border-gray-800 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
            aria-label="Toggle Sidebar"
          >
            {isMobileOpen ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path fillRule="evenodd" clipRule="evenodd"
                  d="M6.22 7.28a1 1 0 011.41-1.41L12 10.59l4.36-4.72a1 1 0 111.47 1.36L13.06 12l4.77 4.72a1 1 0 01-1.42 1.41L12 13.41l-4.35 4.72a1 1 0 01-1.48-1.36L10.94 12 6.22 7.28z"
                  fill="currentColor" />
              </svg>
            ) : (
              <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
                <path fillRule="evenodd" clipRule="evenodd"
                  d="M0.583 1C0.583.586.919.25 1.333.25h13.334c.414 0 .75.336.75.75s-.336.75-.75.75H1.333A.75.75 0 01.583 1zm0 10c0-.414.336-.75.75-.75h13.334c.414 0 .75.336.75.75s-.336.75-.75.75H1.333A.75.75 0 01.583 11zM1.333 5.25a.75.75 0 000 1.5H8a.75.75 0 000-1.5H1.333z"
                  fill="currentColor" />
              </svg>
            )}
          </button>

          {/* Logo (mobile only) */}
          <div className="lg:hidden flex items-center gap-2">
            <img src="/icons/mcplama-icon-128.png" alt="MCPlama" className="w-7 h-7 rounded-lg" />
            <span className="text-sm font-bold text-gray-900 dark:text-white">MCPlama</span>
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
              Beta
            </span>
          </div>

          {/* Search bar */}
          <div ref={searchRef} className="hidden lg:flex items-center relative max-w-md w-full">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
              <Search size={16} className="text-gray-400" />
            </span>
            <input
              ref={searchInputRef}
              type="text"
              value={commandQuery}
              placeholder="Search pages or type command..."
              onFocus={() => setCommandOpen(true)}
              onChange={event => { setCommandQuery(event.target.value); setCommandOpen(true); setActiveCommand(0) }}
              onKeyDown={event => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  if (filteredCommands.length > 0) {
                    setActiveCommand(index => Math.min(index + 1, filteredCommands.length - 1))
                  }
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActiveCommand(index => Math.max(index - 1, 0))
                } else if (event.key === 'Enter' && filteredCommands[activeCommand]) {
                  event.preventDefault()
                  runCommand(filteredCommands[activeCommand].path)
                } else if (event.key === 'Escape') {
                  setCommandOpen(false)
                  searchInputRef.current?.blur()
                }
              }}
              className="h-11 w-full rounded-lg border border-gray-200 bg-transparent py-2.5 pl-10 pr-14 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:ring-2 focus:ring-brand-500/10 dark:border-gray-800 dark:bg-white/[0.03] dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-700"
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-400 dark:border-gray-700 dark:bg-white/[0.03] dark:text-gray-500">
              ⌘K
            </kbd>

            {commandOpen && (
              <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[120] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-theme-lg dark:border-gray-700 dark:bg-gray-900">
                {filteredCommands.length > 0 ? (
                  <div className="max-h-80 overflow-y-auto p-1.5">
                    {filteredCommands.map((command, index) => (
                      <button
                        key={command.path}
                        type="button"
                        onMouseEnter={() => setActiveCommand(index)}
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => runCommand(command.path)}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                          activeCommand === index
                            ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400'
                            : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5'
                        }`}
                      >
                        <span className="flex items-center gap-2.5"><Search size={14} /> {command.label}</span>
                        <span className="text-xs text-gray-400">Open →</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">No matching page</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2 shrink-0">

          {/* Add server shortcut */}
          <button
            onClick={() => navigate('/catalog')}
            className="hidden sm:flex items-center gap-1.5 h-10 px-4 rounded-lg text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 transition-colors"
          >
            <Plus size={15} strokeWidth={2.5} />
            <span className="hidden md:inline">Add server</span>
          </button>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="relative flex items-center justify-center w-10 h-10 text-gray-500 border border-gray-200 rounded-full hover:bg-gray-100 hover:text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white transition-colors"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* User dropdown */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setUserMenuOpen(v => !v)}
              className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <div className="w-9 h-9 rounded-full bg-brand-50 dark:bg-brand-500/10 border border-brand-200 dark:border-brand-500/20 flex items-center justify-center text-xs font-bold text-brand-600 dark:text-brand-400">
                {initials}
              </div>
              <span className="hidden md:block text-sm font-medium text-gray-700 dark:text-gray-300">
                {user?.name}
              </span>
              <ChevronDown
                size={14}
                className={`text-gray-400 transition-transform duration-200 ${userMenuOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {userMenuOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-gray-200 bg-white shadow-theme-lg dark:border-gray-800 dark:bg-gray-dark z-50 py-2 animate-scale-in">
                <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 mb-1">
                  <p className="text-sm font-semibold text-gray-800 dark:text-white/90 truncate">
                    {user?.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{user?.role}</p>
                </div>

                <button
                  onClick={() => { setUserMenuOpen(false); navigate('/settings') }}
                  className="flex items-center gap-3 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5 transition-colors"
                >
                  <User size={15} className="text-gray-400" />
                  Account settings
                </button>

                <div className="border-t border-gray-100 dark:border-gray-800 mt-1 pt-1">
                  <button
                    onClick={() => { setUserMenuOpen(false); logout() }}
                    className="flex items-center gap-3 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5 transition-colors"
                  >
                    <LogOut size={15} className="text-gray-400" />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

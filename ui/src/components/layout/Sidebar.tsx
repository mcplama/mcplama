/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Package, Server, Link2, Activity,
  Shield, Bell, Users, Settings, HelpCircle,
  type LucideIcon,
} from 'lucide-react'
import { useSidebar } from '../../context/SidebarContext'

type NavItem = { to: string; icon: LucideIcon; label: string; end?: boolean }

const mainItems: NavItem[] = [
  { to: '/',            icon: LayoutDashboard, label: 'Overview',    end: true },
  { to: '/servers',     icon: Server,          label: 'Servers'               },
  { to: '/connections', icon: Link2,           label: 'Connections'           },
  { to: '/catalog',     icon: Package,         label: 'Catalog'               },
  { to: '/activity',    icon: Activity,        label: 'Activity'              },
  { to: '/policies',    icon: Shield,          label: 'Policies'              },
  { to: '/alerts',      icon: Bell,            label: 'Alerts'                },
]

const mgmtItems: NavItem[] = [
  { to: '/users',    icon: Users,    label: 'Users'    },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

function NavItemRow({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const location = useLocation()
  const isActive = item.end
    ? location.pathname === item.to
    : location.pathname.startsWith(item.to)

  return (
    <li>
      <NavLink
        to={item.to}
        end={item.end}
        className={`menu-item group ${isActive ? 'menu-item-active' : 'menu-item-inactive'}
          ${collapsed ? 'lg:justify-center' : ''}`}
      >
        <span className={`shrink-0 ${isActive ? 'menu-item-icon-active' : 'menu-item-icon-inactive'}`}>
          <item.icon size={20} strokeWidth={1.8} />
        </span>
        {!collapsed && (
          <span className="truncate">{item.label}</span>
        )}
      </NavLink>
    </li>
  )
}

export default function Sidebar() {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar()
  const collapsed = !isExpanded && !isHovered && !isMobileOpen

  return (
    <aside
      className={`
        fixed top-0 left-0 z-[50] flex flex-col h-screen
        bg-white dark:bg-gray-900
        border-r border-gray-200 dark:border-gray-800
        transition-all duration-300 ease-in-out
        ${isExpanded || isMobileOpen ? 'w-[290px]' : isHovered ? 'w-[290px]' : 'w-[90px]'}
        ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0
        lg:mt-0 mt-[60px]
      `}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Logo */}
      <div className={`py-6 flex border-b border-gray-100 dark:border-gray-800 px-5
        ${collapsed ? 'lg:justify-center' : 'justify-start'}`}
      >
        {!collapsed ? (
          <div className="flex items-center gap-2.5">
            <img
              src="/icons/mcplama-icon-128.png"
              alt="MCPlama"
              className="w-8 h-8 rounded-lg shrink-0"
            />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[15px] font-bold text-gray-900 dark:text-white tracking-tight leading-none">
                  MCPlama
                </span>
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                  Beta
                </span>
              </div>
              <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">
                MCP Gateway
              </span>
            </div>
          </div>
        ) : (
          <img
            src="/icons/mcplama-icon-128.png"
            alt="MCPlama"
            className="w-8 h-8 rounded-lg"
          />
        )}
      </div>

      {/* Nav */}
      <div className="flex flex-col overflow-y-auto no-scrollbar flex-1 px-4 py-5 gap-6">
        {/* Main */}
        <div>
          {!collapsed && (
            <p className="mb-3 text-xs uppercase tracking-widest font-semibold text-gray-400 dark:text-gray-500 px-1">
              Menu
            </p>
          )}
          <ul className="flex flex-col gap-1">
            {mainItems.map(item => (
              <NavItemRow key={item.to} item={item} collapsed={collapsed} />
            ))}
          </ul>
        </div>

        {/* Management */}
        <div>
          {!collapsed && (
            <p className="mb-3 text-xs uppercase tracking-widest font-semibold text-gray-400 dark:text-gray-500 px-1">
              Management
            </p>
          )}
          <ul className="flex flex-col gap-1">
            {mgmtItems.map(item => (
              <NavItemRow key={item.to} item={item} collapsed={collapsed} />
            ))}
          </ul>
        </div>
      </div>

      {/* Help link */}
      <div className="px-4 pb-5 border-t border-gray-100 dark:border-gray-800 pt-3">
        <a
          href="https://mcplama.com/docs"
          className={`menu-item group menu-item-inactive w-full
            ${collapsed ? 'lg:justify-center' : ''}`}
        >
          <span className="menu-item-icon-inactive shrink-0">
            <HelpCircle size={20} strokeWidth={1.8} />
          </span>
          {!collapsed && <span>Help &amp; Info</span>}
        </a>
      </div>
    </aside>
  )
}

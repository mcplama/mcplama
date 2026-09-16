/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import clsx from 'clsx'

interface Tab {
  id: string
  label: string
  icon?: React.ElementType
  logo?: string
}

export function Tabs({ tabs, active, onChange, className }: {
  tabs: Tab[]
  active: string
  onChange: (id: string) => void
  className?: string
}) {
  return (
    <div className={clsx('tab-bar flex-wrap', className)}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={clsx('tab-btn', active === tab.id && 'active')}
        >
          {tab.logo
            ? <img className="tab-logo" src={tab.logo} alt="" aria-hidden="true" />
            : tab.icon && <tab.icon size={16} />}
          {tab.label}
        </button>
      ))}
    </div>
  )
}

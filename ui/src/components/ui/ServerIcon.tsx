/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { Package } from 'lucide-react'
import * as LucideIcons from 'lucide-react'

const SIZE_MAP = {
  xs: { box: 24, img: 16, font: 10, icon: 11 },
  sm: { box: 30, img: 20, font: 12, icon: 13 },
  md: { box: 38, img: 26, font: 14, icon: 17 },
  lg: { box: 48, img: 32, font: 18, icon: 22 },
}

const COLOR_MAP = {
  blue:   { bg: '#1e3a5f', border: '#2d5a9e', icon: '#60a5fa' },
  purple: { bg: '#2e1f5e', border: '#5b4a9e', icon: '#a78bfa' },
  green:  { bg: '#1a3a2a', border: '#2d6e4e', icon: '#34d399' },
  red:    { bg: '#3a1f1f', border: '#8b3333', icon: '#f87171' },
  orange: { bg: '#3a2a1a', border: '#8b5e33', icon: '#fb923c' },
  yellow: { bg: '#3a3000', border: '#8b7500', icon: '#fbbf24' },
  gray:   { bg: '#1c2333', border: '#374151', icon: '#94a3b8' },
}

function toPascalCase(str) {
  if (!str) return null
  return str.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')
}

export default function ServerIcon({ server, icon, color, logo_url, name, size = 'md' }) {
  const _logo  = logo_url || server?.logo_url
  const _name  = name     || server?.name  || ''
  const _icon  = icon     || server?.icon
  const _color = color    || server?.color || 'blue'

  const { box, img, font, icon: iconSize } = SIZE_MAP[size] || SIZE_MAP.md
  const palette = COLOR_MAP[_color] || COLOR_MAP.blue
  const radius = Math.round(box * 0.28)

  const containerStyle = {
    width: box, height: box, borderRadius: radius, flexShrink: 0,
    background: palette.bg, border: `1px solid ${palette.border}`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  }

  // 1. logo_url
  if (_logo) {
    return (
      <div style={containerStyle}>
        <img src={_logo} alt={_name}
          style={{ width: img, height: img, objectFit: 'contain' }}
          onError={e => {
            e.target.style.display = 'none'
            e.target.nextSibling.style.display = 'flex'
          }} />
        <span style={{
          display: 'none', width: '100%', height: '100%',
          alignItems: 'center', justifyContent: 'center',
          fontSize: font, fontWeight: 700, color: palette.icon, textTransform: 'uppercase',
        }}>
          {_name.slice(0, 2)}
        </span>
      </div>
    )
  }

  // 2. Lucide icon (kebab-case → PascalCase)
  const iconName = toPascalCase(_icon)
  const Icon = iconName ? (LucideIcons[iconName] || null) : null
  if (Icon) {
    return (
      <div style={containerStyle}>
        <Icon size={iconSize} style={{ color: palette.icon }} />
      </div>
    )
  }

  // 3. Initials / Package fallback
  return (
    <div style={containerStyle}>
      {_name
        ? <span style={{ fontSize: font, fontWeight: 700, color: palette.icon, textTransform: 'uppercase' }}>
            {_name.slice(0, 2)}
          </span>
        : <Package size={iconSize} style={{ color: palette.icon }} />
      }
    </div>
  )
}

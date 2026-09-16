/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronRight, Pause, Play, RefreshCw,
  Package, Users, Link2, Shield, Bell,
  Server, Plug, Wrench, AlertTriangle,
  ArrowUp, ArrowDown,
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import api from '../lib/api'
import { formatLogTimestamp, parseServerTimestamp } from '../lib/formatTime'
import { Spinner } from '../components/ui'
import Badge from '../components/kit/Badge'
import { Table, TableHeader, TableBody, TableRow, TableCell } from '../components/kit/Table'
import ServerIcon from '../components/ui/ServerIcon'
import { useAuth } from '../hooks/useAuth'

const CHART_COLORS = ['#465fff', '#12b76a', '#f79009', '#f04438', '#0ba5ec']

/* ─── Shared primitives ─────────────────────────────────── */

function Card({ children, className = '' }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] ${className}`}>
      {children}
    </div>
  )
}

function CardHeader({ title, sub, link, action }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
      <div>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">{title}</h3>
        {sub && <p className="mt-0.5 text-theme-sm text-gray-500 dark:text-gray-400">{sub}</p>}
      </div>
      {link && (
        <Link to={link} className="flex items-center gap-1 text-theme-xs font-medium text-brand-500 hover:underline no-underline">
          View all <ChevronRight size={13} />
        </Link>
      )}
      {action}
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, iconBg, iconColor, positive }) {
  return (
    <Card className="p-5 md:p-6">
      <div className="flex items-center justify-between">
        <div className={`flex items-center justify-center w-12 h-12 rounded-xl ${iconBg}`}>
          <Icon size={22} className={iconColor} strokeWidth={1.8} />
        </div>
        {positive !== null && positive !== undefined && (
          <Badge size="sm" color={positive ? 'success' : 'error'}
            startIcon={positive ? <ArrowUp size={10} /> : <ArrowDown size={10} />}>
            {positive ? 'Up' : 'Down'}
          </Badge>
        )}
      </div>
      <div className="mt-5">
        <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
        <h4 className="mt-2 font-bold text-gray-800 text-title-sm dark:text-white/90 leading-none">{value}</h4>
      </div>
    </Card>
  )
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2 shadow-theme-md text-theme-xs">
      <p className="text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }} className="font-semibold">{p.name}: {p.value}</p>
      ))}
    </div>
  )
}

/* ─── Quick actions ─────────────────────────────────────── */

const QUICK_ACTIONS = [
  { label: 'Browse catalog',   icon: Package, to: '/catalog',     cls: 'bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400' },
  { label: 'Invite a user',    icon: Users,   to: '/users',       cls: 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400' },
  { label: 'View connections', icon: Link2,   to: '/connections', cls: 'bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-orange-400' },
  { label: 'Create policy',    icon: Shield,  to: '/policies',    cls: 'bg-blue-light-50 text-blue-light-500 dark:bg-blue-light-500/15' },
  { label: 'Check alerts',     icon: Bell,    to: '/alerts',      cls: 'bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-400' },
]

/* ─── Dashboard ─────────────────────────────────────────── */

export default function Dashboard() {
  const [stats, setStats]                     = useState(null)
  const [health, setHealth]                   = useState(null)
  const [servers, setServers]                 = useState([])
  const [logs, setLogs]                       = useState([])
  const [chartLogs, setChartLogs]             = useState([])
  const [chartLoading, setChartLoading]       = useState(false)
  const [recentAlerts, setRecentAlerts]       = useState([])
  const [topTools, setTopTools]               = useState([])
  const [loading, setLoading]                 = useState(true)
  const [liveEnabled, setLiveEnabled]         = useState(true)
  const [period, setPeriod]                   = useState('Today')
  const [pendingRequests, setPendingRequests] = useState([])
  const { user }  = useAuth()
  const liveRef   = useRef(null)

  const sinceForPeriod = (p) => {
    const now = new Date()
    if (p === 'Today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.toISOString() }
    if (p === 'Week')  return new Date(now - 7  * 86_400_000).toISOString()
    return                    new Date(now - 30 * 86_400_000).toISOString()
  }

  const loadChart = useCallback(async (p) => {
    setChartLoading(true)
    try {
      const since = sinceForPeriod(p)
      const { data } = await api.get(`/audit?limit=2000&since=${encodeURIComponent(since)}`)
      setChartLogs(data)
    } catch {}
    finally { setChartLoading(false) }
  }, [])

  const load = useCallback(async () => {
    try {
      const [s, sv, lg, al, pr, h] = await Promise.all([
        api.get('/gateway/stats'),
        api.get('/servers'),
        api.get('/audit?limit=200'),
        api.get('/alerts').catch(() => ({ data: [] })),
        api.get('/requests?status=pending&limit=5').catch(() => ({ data: [] })),
        fetch('/health').then(r => r.json()).catch(() => null),
      ])
      setStats(s.data)
      setHealth(h)
      setServers(sv.data.filter(s => s.is_enabled).slice(0, 5))
      setLogs(lg.data)
      setRecentAlerts(al.data.slice(0, 4))
      setPendingRequests(pr.data)
      const tc = {}
      lg.data.forEach(l => { if (l.tool && l.action === 'proxy.call') tc[l.tool] = (tc[l.tool] || 0) + 1 })
      const sorted = Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 5)
      const max = sorted[0]?.[1] || 1
      setTopTools(sorted.map(([tool, count]) => ({ tool, count, pct: Math.round(count / max * 100) })))
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadChart(period) }, [period, loadChart])
  useEffect(() => {
    if (liveRef.current) clearInterval(liveRef.current)
    if (liveEnabled) liveRef.current = setInterval(load, 8000)
    return () => clearInterval(liveRef.current)
  }, [liveEnabled, load])

  const firstName    = user?.name?.split(' ')[0] || 'Admin'
  const callsToday   = stats?.calls_today || 0
  const callsTotal   = stats?.calls_total || 0
  const totalServers = stats?.active_servers || 0
  const connections  = stats?.total_connections || 0
  const tools        = stats?.total_tools || 0
  const errorCount   = logs.filter(l => (l.status_code || 0) >= 400).length
  const errorRate    = logs.length ? Math.round((errorCount / logs.length) * 100) : 0
  const policyBlocks = logs.filter(l => l.action === 'policy.blocked').length
  const latencies    = logs.filter(l => l.latency_ms).map(l => l.latency_ms)
  const avgLatency   = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0

  const chartData = useMemo(() => {
    const now = new Date()
    if (period === 'Today') {
      return Array.from({ length: 24 }, (_, i) => {
        const slotStart = new Date(now); slotStart.setHours(i, 0, 0, 0)
        const slotEnd   = slotStart.getTime() + 3_600_000
        return {
          time: i.toString().padStart(2, '0') + ':00',
          calls: chartLogs.filter(l => { const t = parseServerTimestamp(l.timestamp).getTime(); return t >= slotStart.getTime() && t < slotEnd }).length,
        }
      })
    }
    const days = period === 'Week' ? 7 : 30
    return Array.from({ length: days }, (_, i) => {
      const day = new Date(now.getTime() - (days - 1 - i) * 86_400_000); day.setHours(0, 0, 0, 0)
      const nextDay = day.getTime() + 86_400_000
      return {
        time: period === 'Week'
          ? day.toLocaleDateString('en', { weekday: 'short' })
          : day.toLocaleDateString('en', { month: 'short', day: 'numeric' }),
        calls: chartLogs.filter(l => { const t = parseServerTimestamp(l.timestamp).getTime(); return t >= day.getTime() && t < nextDay }).length,
      }
    })
  }, [period, chartLogs])

  const serverCalls    = servers.filter(s => (s.calls_today || 0) > 0).map(s => ({ name: s.name, value: s.calls_today || 0 }))
  const latencyBuckets = [
    { range: '<50ms',   count: latencies.filter(l => l < 50).length },
    { range: '50-100',  count: latencies.filter(l => l >= 50 && l < 100).length },
    { range: '100-200', count: latencies.filter(l => l >= 100 && l < 200).length },
    { range: '200-500', count: latencies.filter(l => l >= 200 && l < 500).length },
    { range: '>500ms',  count: latencies.filter(l => l >= 500).length },
  ]

  return (
    <div className="grid grid-cols-12 gap-4 md:gap-6">

      {/* Greeting */}
      <div className="col-span-12">
        <p className="text-theme-sm text-gray-500 dark:text-gray-400 mb-0.5">Hi {firstName},</p>
        <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90 tracking-tight">Welcome back!</h1>
      </div>

      {/* ── Main column ── */}
      <div className="col-span-12 xl:col-span-8 space-y-4 md:space-y-6">

        {/* Metric cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 md:gap-6">
          <MetricCard icon={Server}        label="Active servers"  value={totalServers} iconBg="bg-brand-50 dark:bg-brand-500/15"      iconColor="text-brand-500"              positive={totalServers > 0} />
          <MetricCard icon={Plug}          label="Connections"     value={connections}  iconBg="bg-success-50 dark:bg-success-500/15"  iconColor="text-success-600 dark:text-success-400" positive={connections > 0} />
          <MetricCard icon={Wrench}        label="Tools"           value={tools}        iconBg="bg-blue-light-50 dark:bg-blue-light-500/15" iconColor="text-blue-light-500"   positive={null} />
          <MetricCard icon={AlertTriangle} label="Policy blocks"   value={policyBlocks} iconBg="bg-warning-50 dark:bg-warning-500/15"  iconColor="text-warning-600 dark:text-orange-400" positive={policyBlocks === 0} />
        </div>

        {/* Gateway hero + calls chart */}
        <Card>
          <div className="flex flex-col gap-3 px-5 pt-5 pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="text-theme-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Gateway activity</span>
              <div className="flex items-baseline gap-3 mt-1">
                <span className="text-title-sm font-bold text-gray-800 dark:text-white/90 tracking-tight">{callsToday.toLocaleString()}</span>
                <span className="text-theme-sm text-gray-500 dark:text-gray-400">{callsTotal.toLocaleString()} all-time</span>
                <Badge size="sm" color="success" startIcon={<ArrowUp size={10} />}>calls today</Badge>
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              {['Today', 'Week', 'Month'].map(l => (
                <button key={l} onClick={() => setPeriod(l)} disabled={chartLoading}
                  className={`px-3 py-1.5 rounded-lg text-theme-xs font-semibold border transition-colors ${l === period
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700 dark:hover:bg-white/5'
                  } disabled:opacity-60`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="px-2 pt-4 pb-2 relative">
            {chartLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-black/20 z-10 rounded-b-2xl">
                <Spinner size={20} />
              </div>
            )}
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={chartData} margin={{ top: 4, right: 12, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="brandGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#465fff" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#465fff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fill: '#98a2b3', fontSize: 11 }} axisLine={false} tickLine={false} interval={2} />
                <YAxis tick={{ fill: '#98a2b3', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} />
                <Area type="monotone" dataKey="calls" name="Calls" stroke="#465fff" strokeWidth={2}
                  fill="url(#brandGrad)" dot={false} activeDot={{ r: 4, fill: '#465fff' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Active servers table */}
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
            <div>
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Active servers</h3>
            </div>
            <Link to="/servers" className="flex items-center gap-1 text-theme-xs font-medium text-brand-500 hover:underline no-underline">
              View all <ChevronRight size={13} />
            </Link>
          </div>

          {servers.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-theme-sm text-gray-500 dark:text-gray-400">No active servers</p>
              <Link to="/catalog" className="text-theme-xs text-brand-500 mt-2 block hover:underline">Browse catalog →</Link>
            </div>
          ) : (
            <Table>
              <TableHeader className="border-b border-gray-100 dark:border-gray-800">
                <TableRow>
                  {['Server', 'Calls today', 'Share', 'Status'].map(h => (
                    <TableCell key={h} isHeader className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-start">
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
                {servers.map(s => {
                  const isOnline = s.last_used_at && new Date() - parseServerTimestamp(s.last_used_at) < 30 * 60 * 1000
                  const pct = callsToday > 0 ? Math.round((s.calls_today || 0) / callsToday * 100) : 0
                  return (
                    <TableRow key={s.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                      <TableCell className="px-5 py-3.5">
                        <Link to={`/servers/${s.id}`} className="flex items-center gap-3 no-underline">
                          <ServerIcon server={s} size="sm" />
                          <span className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{s.name}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-theme-sm text-gray-500 dark:text-gray-400">
                        {s.calls_today || 0}
                      </TableCell>
                      <TableCell className="px-5 py-3.5">
                        <div className="h-1.5 w-24 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                        </div>
                      </TableCell>
                      <TableCell className="px-5 py-3.5">
                        <Badge size="sm" color={isOnline ? 'success' : 'warning'}
                          startIcon={<span className={`inline-block w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-success-500' : 'bg-warning-400'}`} />}>
                          {isOnline ? 'Online' : 'Idle'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Latency + Error rate */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6">
          <Card>
            <CardHeader title="Latency distribution" />
            <div className="px-4 pt-3 pb-4">
              <div className="flex items-baseline gap-2.5 mb-3">
                <span className="text-title-sm font-bold text-gray-800 dark:text-white/90 leading-none">{avgLatency}<span className="text-base font-semibold">ms</span></span>
                {avgLatency > 0 && (
                  <Badge size="sm" color={avgLatency < 200 ? 'success' : 'warning'}>
                    {avgLatency < 200 ? 'Good' : 'Slow'}
                  </Badge>
                )}
              </div>
              <ResponsiveContainer width="100%" height={90}>
                <BarChart data={latencyBuckets} margin={{ top: 0, right: 4, left: -28, bottom: 0 }}>
                  <XAxis dataKey="range" tick={{ fill: '#98a2b3', fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#98a2b3', fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="count" name="Requests" fill="#465fff" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <CardHeader title="Error rate" />
            <div className="px-5 py-4">
              <div className="flex items-baseline gap-2.5 mb-3">
                <span className={`text-title-sm font-bold leading-none ${errorRate > 10 ? 'text-error-600 dark:text-error-400' : 'text-gray-800 dark:text-white/90'}`}>
                  {errorRate}<span className="text-base font-semibold">%</span>
                </span>
                <Badge size="sm" color={errorRate < 5 ? 'success' : errorRate < 20 ? 'warning' : 'error'}>
                  {errorRate < 5 ? 'Healthy' : errorRate < 20 ? 'Warning' : 'Critical'}
                </Badge>
              </div>
              <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden mb-4">
                <div className={`h-full rounded-full transition-all ${errorRate > 20 ? 'bg-error-500' : errorRate > 5 ? 'bg-warning-500' : 'bg-success-500'}`}
                  style={{ width: `${Math.min(errorRate, 100)}%` }} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Total requests', value: logs.length },
                  { label: 'Errors',         value: errorCount },
                  { label: 'Success rate',   value: `${100 - errorRate}%` },
                  { label: 'Avg latency',    value: `${avgLatency}ms` },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-gray-800 px-3 py-2">
                    <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
                    <p className="text-theme-sm font-bold text-gray-800 dark:text-white/90 mt-0.5">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* By server + Live activity */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6">
          {/* By server donut */}
          <Card>
            <CardHeader title="Calls by server" />
            <div className="p-4">
              {serverCalls.length === 0 ? (
                <p className="text-theme-xs text-gray-500 dark:text-gray-400 text-center py-8">No calls yet</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={120}>
                    <PieChart>
                      <Pie data={serverCalls} cx="50%" cy="50%" innerRadius={34} outerRadius={54} paddingAngle={3} dataKey="value">
                        {serverCalls.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip content={<ChartTip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-3 space-y-2">
                    {serverCalls.map((s, i) => (
                      <div key={s.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                          <span className="text-theme-xs text-gray-600 dark:text-gray-300">{s.name}</span>
                        </div>
                        <span className="text-theme-xs font-semibold text-gray-800 dark:text-white/90">{s.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Card>

          {/* Live activity */}
          <Card>
            <CardHeader title="Live activity" action={
              <div className="flex items-center gap-2">
                {liveEnabled && (
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-success-500 inline-block animate-pulse" />
                    <span className="text-theme-xs font-semibold text-success-600 dark:text-success-400">Live</span>
                  </div>
                )}
                <button onClick={() => setLiveEnabled(v => !v)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-theme-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                  {liveEnabled ? <><Pause size={10} /> Pause</> : <><Play size={10} /> Resume</>}
                </button>
                <button onClick={load} className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                  <RefreshCw size={12} />
                </button>
              </div>
            } />
            <div className="max-h-[220px] overflow-y-auto">
              {logs.length === 0 ? (
                <p className="text-theme-xs text-gray-500 dark:text-gray-400 p-6 text-center">No activity yet</p>
              ) : logs.map(log => {
                const isErr  = (log.status_code || 0) >= 400
                const isWarn = log.action === 'policy.blocked'
                const dot    = isErr ? 'bg-error-500' : isWarn ? 'bg-warning-500' : 'bg-success-500'
                const time   = formatLogTimestamp(log.timestamp).time
                return (
                  <div key={log.id} className="flex items-center gap-2.5 px-4 py-2 border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                    <span className="text-theme-xs text-gray-400 w-14 shrink-0 tabular-nums">{time}</span>
                    <span className="text-theme-xs flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                      <strong className={isErr ? 'text-error-600 dark:text-error-400' : isWarn ? 'text-warning-600 dark:text-orange-400' : 'text-gray-500 dark:text-gray-400'}>
                        {log.action}
                      </strong>
                      {log.tool ? <span className="text-gray-500 dark:text-gray-400"> · {log.tool}</span> : ''}
                    </span>
                    <span className="text-theme-xs text-gray-400 shrink-0">{log.latency_ms ? `${log.latency_ms}ms` : '—'}</span>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>
      </div>

      {/* ── Sidebar column ── */}
      <div className="col-span-12 xl:col-span-4 space-y-4 md:space-y-6">

        {/* Quick actions */}
        <Card>
          <CardHeader title="Quick actions" />
          <div className="p-3 flex flex-col gap-1.5">
            {QUICK_ACTIONS.map(({ label, icon: Icon, to, cls }) => (
              <Link key={to} to={to}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-brand-300 dark:hover:border-brand-500/40 transition-colors no-underline">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${cls}`}>
                  <Icon size={14} strokeWidth={1.8} />
                </div>
                <span className="text-theme-sm font-medium text-gray-700 dark:text-gray-300 flex-1">{label}</span>
                <ChevronRight size={14} className="text-gray-400" />
              </Link>
            ))}
          </div>
        </Card>

        {/* Access requests */}
        <Card>
          <CardHeader title="Access requests" action={
            pendingRequests.length > 0 && (
              <Badge size="sm" color="warning">{pendingRequests.length} pending</Badge>
            )
          } />
          {pendingRequests.length === 0 ? (
            <p className="text-theme-xs text-gray-500 dark:text-gray-400 px-5 py-4 text-center">No pending requests</p>
          ) : pendingRequests.map(req => (
            <div key={req.id} className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-7 h-7 rounded-full bg-brand-100 dark:bg-brand-500/20 flex items-center justify-center text-[11px] font-bold text-brand-500 shrink-0">
                  {req.user_name?.[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-theme-xs font-semibold text-gray-800 dark:text-white/90 truncate">{req.user_name}</p>
                  <p className="text-theme-xs text-gray-500 dark:text-gray-400">{req.server_name}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => { await api.post(`/requests/${req.id}/approve`); setPendingRequests(rs => rs.filter(r => r.id !== req.id)) }}
                  className="flex-1 py-1.5 rounded-lg text-theme-xs font-semibold bg-success-50 text-success-600 border border-success-200 dark:bg-success-500/15 dark:text-success-400 dark:border-success-500/30 hover:bg-success-100 dark:hover:bg-success-500/20 transition-colors">
                  Approve
                </button>
                <button
                  onClick={async () => { await api.post(`/requests/${req.id}/deny`); setPendingRequests(rs => rs.filter(r => r.id !== req.id)) }}
                  className="flex-1 py-1.5 rounded-lg text-theme-xs font-semibold bg-error-50 text-error-600 border border-error-200 dark:bg-error-500/15 dark:text-error-400 dark:border-error-500/30 hover:bg-error-100 dark:hover:bg-error-500/20 transition-colors">
                  Deny
                </button>
              </div>
            </div>
          ))}
        </Card>

        {/* System health */}
        <Card>
          <CardHeader title="System health" />
          <div className="px-5 py-1">
            {[
              { label: 'Gateway',     value: 'Online',                   color: 'success' },
              { label: 'Database',    value: 'Connected',                color: 'success' },
              { label: 'Containers',  value: health ? `${health.running_containers} running` : '—',  color: health?.running_containers > 0 ? 'success' : 'light' },
              { label: 'Error rate',  value: `${errorRate}%`,            color: errorRate > 10 ? 'error' : errorRate > 0 ? 'warning' : 'success' },
              { label: 'Avg latency', value: avgLatency ? `${avgLatency}ms` : '—', color: avgLatency > 500 ? 'error' : avgLatency > 200 ? 'warning' : 'success' },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center justify-between py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
                <span className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</span>
                <Badge size="sm" color={color}>{value}</Badge>
              </div>
            ))}
          </div>
        </Card>

        {/* Recent alerts */}
        <Card>
          <CardHeader title="Recent alerts" link="/alerts" />
          {recentAlerts.length === 0 ? (
            <p className="text-theme-xs text-gray-500 dark:text-gray-400 px-5 py-4 text-center">No alerts fired</p>
          ) : recentAlerts.map(a => (
            <div key={a.id} className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0">
              <div className={`w-2 h-2 rounded-full shrink-0 ${a.severity === 'danger' ? 'bg-error-500' : a.severity === 'warn' ? 'bg-warning-500' : 'bg-brand-500'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-theme-xs font-semibold text-gray-800 dark:text-white/90 truncate">{a.name}</p>
                <p className="text-theme-xs text-gray-500 dark:text-gray-400">{a.current_value || '—'}</p>
              </div>
              <Badge size="sm" color={a.status === 'firing' ? 'error' : 'success'}>
                {a.status === 'firing' ? 'FIRING' : 'OK'}
              </Badge>
            </div>
          ))}
        </Card>

        {/* Top tools */}
        <Card>
          <CardHeader title="Top tools today" link="/tools" />
          {topTools.length === 0 ? (
            <p className="text-theme-xs text-gray-500 dark:text-gray-400 px-5 py-4 text-center">No tool calls yet</p>
          ) : topTools.map(({ tool, count, pct }, i) => (
            <div key={tool} className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-theme-xs font-medium text-gray-800 dark:text-white/90 truncate max-w-[180px]">{tool}</span>
                <span className="text-theme-xs text-gray-400 shrink-0">{count}</span>
              </div>
              <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
              </div>
            </div>
          ))}
        </Card>

      </div>
    </div>
  )
}

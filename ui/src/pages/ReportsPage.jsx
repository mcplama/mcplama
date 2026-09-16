/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { useState, useEffect } from 'react'
import { Download, FileText } from 'lucide-react'
import api from '../lib/api'
import { Card, PanelHead, Btn, PageHeader } from '../components/ui'

export default function ReportsPage() {
  const [loading, setLoading] = useState(false)
  const [logs, setLogs]       = useState([])
  const [stats, setStats]     = useState(null)
  const [servers, setServers] = useState([])
  const [period, setPeriod]   = useState('7d')

  useEffect(() => {
    Promise.all([api.get('/audit?limit=1000'), api.get('/gateway/stats'), api.get('/servers')])
      .then(([l,s,sv]) => { setLogs(l.data); setStats(s.data); setServers(sv.data) })
      .catch(() => {})
  }, [])

  const exportFullAudit = () => {
    const rows = [
      ['Timestamp','User Email','User ID','Server','Server ID','Action','Tool','Status','Latency ms','IP'],
      ...logs.map(l => [l.timestamp,l.user_email,l.user_id,l.server_name,l.server_id,l.action,l.tool,l.status_code,l.latency_ms,l.ip_address])
    ]
    const csv = rows.map(r => r.map(v => `"${v||''}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type:'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `Mcplama-full-audit-${new Date().toISOString().split('T')[0]}.csv`; a.click()
  }

  const generateReport = async () => {
    setLoading(true)
    const report = [
      'Mcplama Compliance Report', `Generated: ${new Date().toISOString()}`, `Period: Last ${period}`, '',
      '== Summary ==',
      `Total tool calls: ${logs.length}`, `Active servers: ${stats?.active_servers||0}`,
      `Total users: ${stats?.total_users||0}`,
      `Error rate: ${logs.length ? Math.round((logs.filter(l=>(l.status_code||0)>=400).length/logs.length)*100) : 0}%`, '',
      '== Servers ==', ...servers.map(s => `${s.name}: ${s.calls_today} calls today`), '',
      '== Recent Activity ==', ...logs.slice(0,50).map(l => `${l.timestamp} | ${l.user_email} | ${l.tool||l.action} | ${l.status_code}`)
    ].join('\n')
    const blob = new Blob([report], { type:'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `Mcplama-report-${new Date().toISOString().split('T')[0]}.txt`; a.click()
    setLoading(false)
  }

  const topTools = Object.entries(logs.reduce((acc,l) => { if(l.tool) acc[l.tool]=(acc[l.tool]||0)+1; return acc }, {}))
    .sort((a,b) => b[1]-a[1]).slice(0,5)
  const topUsers = Object.entries(logs.reduce((acc,l) => { if(l.user_email) acc[l.user_email]=(acc[l.user_email]||0)+1; return acc }, {}))
    .sort((a,b) => b[1]-a[1]).slice(0,5)

  const errorCount = logs.filter(l => (l.status_code||0) >= 400).length
  const summaryCards = [
    { label:'Tool calls (all time)', value:(stats?.calls_today||0).toLocaleString(), sub:`${stats?.calls_today||0} today`, cls:'bg-accent/10 border-accent/25 text-accent' },
    { label:'Unique users', value:new Set(logs.map(l=>l.user_email).filter(Boolean)).size, sub:'in audit period', cls:'bg-info/10 border-info/25 text-info' },
    { label:'Servers monitored', value:stats?.total_servers||servers.length||0, sub:`${stats?.active_connections||0} connections`, cls:'bg-ok/10 border-ok/25 text-ok' },
    { label:'Error rate', value:logs.length ? `${Math.round((errorCount/logs.length)*100)}%` : '0%', sub:`${errorCount} errors`, cls:'bg-warn/10 border-warn/25 text-warn' },
  ]

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Reports"
        description="Compliance exports and usage analytics"
        action={
          <div className="flex gap-2">
            <select value={period} onChange={e => setPeriod(e.target.value)}
              className="px-3 py-2 text-sm rounded-xl bg-card2 border border-border text-t2 outline-none">
              <option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option><option value="90d">Last 90 days</option>
            </select>
            <Btn variant="secondary" size="sm" icon={Download} onClick={exportFullAudit}>Export full audit</Btn>
            <Btn variant="primary" size="sm" icon={FileText} loading={loading} onClick={generateReport}>Generate report</Btn>
          </div>
        }
      />

      <div className="grid grid-cols-4 gap-4">
        {summaryCards.map(({ label, value, sub, cls }) => (
          <div key={label} className={`p-4 rounded-2xl border ${cls}`}>
            <p className="text-2xl font-bold mb-0.5">{value}</p>
            <p className="text-xs font-medium text-t2 mb-0.5">{label}</p>
            {sub && <p className="text-xs text-t3">{sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-5">
        <Card>
          <PanelHead title="Most called tools" />
          <div className="px-5 py-4 space-y-3">
            {topTools.length === 0 && <p className="text-sm text-center py-4 text-t3">No data yet</p>}
            {topTools.map(([tool, count]) => (
              <div key={tool}>
                <div className="flex justify-between mb-1">
                  <span className="text-xs font-mono font-medium text-t1">{tool}</span>
                  <span className="text-xs text-t3">{count}</span>
                </div>
                <div className="h-1.5 rounded-full bg-card2">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width:`${Math.round((count/Math.max(topTools[0]?.[1],1))*100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <PanelHead title="Most active users" />
          <div className="px-5 py-4 space-y-3">
            {topUsers.length === 0 && <p className="text-sm text-center py-4 text-t3">No data yet</p>}
            {topUsers.map(([email, count]) => (
              <div key={email}>
                <div className="flex justify-between mb-1">
                  <span className="text-xs font-medium text-t1">{email}</span>
                  <span className="text-xs text-t3">{count} calls</span>
                </div>
                <div className="h-1.5 rounded-full bg-card2">
                  <div className="h-full rounded-full bg-info transition-all" style={{ width:`${Math.round((count/Math.max(topUsers[0]?.[1],1))*100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <PanelHead title="Compliance exports" />
        <div className="px-5 py-4 grid grid-cols-3 gap-3">
          {[
            { title:'Full audit log',  desc:'All tool calls with user, server, timestamp, status', format:'CSV' },
            { title:'Access report',   desc:'Who accessed which servers and when',                  format:'CSV' },
            { title:'Summary report',  desc:'Executive summary of MCP activity',                   format:'TXT' },
          ].map(({ title, desc, format }) => (
            <div key={title} className="p-4 rounded-xl border border-border bg-card2">
              <div className="flex items-start justify-between mb-2">
                <p className="text-sm font-semibold text-t1">{title}</p>
                <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-accent/20 text-accent">{format}</span>
              </div>
              <p className="text-xs text-t3 mb-3">{desc}</p>
              <Btn variant="secondary" size="xs" icon={Download} onClick={exportFullAudit}>Download</Btn>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

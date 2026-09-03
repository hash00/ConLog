import { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, AreaChart, Area,
  PieChart, Pie, Cell, Legend, ScatterChart, Scatter, ZAxis,
} from 'recharts'
import { ArrowUp, ArrowDown, ExternalLink } from 'lucide-react'
import type { LogEntry, ProcessStats } from '../types'
import { useThemeColors } from '../theme'
import { useSort } from '../hooks/useSort'
import {
  computeProcessStats, computeTimeline, computeSubsystemStats,
  computeErrorPatterns,
} from '../utils/stats'

interface MetricsPageProps {
  entries: LogEntry[]
  loading: boolean
  onOpenProcess?: (pid: number) => void
}

type ProcRow = ProcessStats & { ratio: number }

type TipPayload = { name?: string; value?: number | string; color?: string }

const Tip = ({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TipPayload[]
  label?: string | number
}) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-panel border border-border rounded-lg p-3 text-xs shadow-xl">
      {label && <div className="text-subtle mb-1.5 font-medium">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-body">{p.name}:</span>
          <span className="text-bright font-mono font-medium">{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
    </div>
  )
}

function SortTh({ label, k, align = 'right', cls = '', sortKey, sortDir, onToggle }: {
  label: string
  k: keyof ProcRow
  align?: 'left' | 'right'
  cls?: string
  sortKey: keyof ProcRow | null
  sortDir: 'asc' | 'desc'
  onToggle: (k: keyof ProcRow) => void
}) {
  return (
    <th
      onClick={() => onToggle(k)}
      className={`${align === 'left' ? 'text-left' : 'text-right'} py-2 px-3 font-medium cursor-pointer select-none hover:text-body ${sortKey === k ? 'text-accent' : ''} ${cls}`}
    >
      <span className="inline-flex items-center gap-1">{label}
        {sortKey === k && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </span>
    </th>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-panel border border-border rounded-xl p-4 ${className}`}>{children}</div>
}
function CardTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-subtle mb-3 uppercase tracking-wider">{children}</div>
}
function StatBig({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div>
      <div className="text-3xl font-bold font-mono" style={{ color: color || 'rgb(var(--c-bright))' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="text-xs text-body mt-1">{label}</div>
      {sub && <div className="text-xs text-dim mt-0.5">{sub}</div>}
    </div>
  )
}

export function MetricsPage({ entries, loading, onOpenProcess }: MetricsPageProps) {
  const [processTab, setProcessTab] = useState<'errors' | 'total'>('errors')
  const [procSearch, setProcSearch] = useState('')
  const [runAs, setRunAs] = useState<'all' | 'root' | 'user'>('all')
  const c = useThemeColors()

  const stats = useMemo(() => {
    // Single pass instead of four .filter() scans + two Sets over all entries.
    let faults = 0, errors = 0, debugs = 0, infos = 0
    const pids = new Set<number>(), subs = new Set<string>()
    for (const e of entries) {
      if (e.messageType === 'fault') faults++
      else if (e.messageType === 'error') errors++
      else if (e.messageType === 'debug') debugs++
      else infos++
      pids.add(e.processID)
      if (e.subsystem) subs.add(e.subsystem)
    }
    const total = entries.length
    return {
      faults, errors, debugs, infos, uniquePids: pids.size, uniqueSubsystems: subs.size,
      errorRate: total ? (errors / total * 100).toFixed(1) : '0',
      faultRate: total ? (faults / total * 100).toFixed(2) : '0',
      total,
    }
  }, [entries])

  const timeline = useMemo(() => computeTimeline(entries), [entries])
  const processList = useMemo(() => computeProcessStats(entries), [entries])
  const subsystems = useMemo(() => computeSubsystemStats(entries), [entries])
  const patterns = useMemo(() => computeErrorPatterns(entries), [entries])

  const procRows = useMemo<ProcRow[]>(() => processList.slice(0, 100).map(p => ({
    ...p, ratio: p.total > 0 ? Math.round((p.errors + p.faults) / p.total * 100) : 0,
  })), [processList])
  const filteredProcRows = useMemo(() => {
    const q = procSearch.trim().toLowerCase()
    return procRows.filter(p => {
      if (runAs === 'root' && !p.isRoot) return false
      if (runAs === 'user' && p.isRoot) return false
      if (q && !(p.name.toLowerCase().includes(q) || String(p.pid ?? '').includes(q))) return false
      return true
    })
  }, [procRows, procSearch, runAs])
  const { sorted: sortedProcs, key: sortKey, dir: sortDir, toggle } = useSort<ProcRow>(filteredProcRows, null)

  const topProcesses = useMemo(() => processList.slice(0, 12).map(p => ({
    name: p.name.length > 20 ? p.name.slice(0, 18) + '…' : p.name, errors: p.errors, faults: p.faults, total: p.total,
  })), [processList])

  const scatter = useMemo(() => processList.slice(0, 30).map(p => ({
    x: p.pid || 0, y: p.errors + p.faults, z: p.total, name: p.name,
  })), [processList])

  const severityPie = useMemo(() => [
    { name: 'Faults', value: stats.faults, color: c.fault },
    { name: 'Errors', value: stats.errors, color: c.error },
    { name: 'Debug', value: stats.debugs, color: c.debug },
    { name: 'Info/Default', value: stats.infos, color: c.info },
  ].filter(d => d.value > 0), [stats, c])

  const subsystemBar = useMemo(() => subsystems.slice(0, 12).map(s => ({
    name: s.name.replace('com.apple.', 'ᴬ.').slice(0, 22),
    errors: s.errors, faults: s.faults, other: s.total - s.errors - s.faults,
  })), [subsystems])

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin mx-auto" />
        <div className="text-subtle text-sm">Building metrics…</div>
      </div>
    </div>
  )

  if (!entries.length) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-2">
        <div className="text-4xl mb-4">📊</div>
        <div className="text-body">No data loaded</div>
        <div className="text-subtle text-sm">Fetch logs in Settings first.</div>
      </div>
    </div>
  )

  const axisTick = { fontSize: 10, fill: c.axis }
  const catTick = { fontSize: 10, fill: c.legend }

  const sortThProps = { sortKey, sortDir, onToggle: toggle } as const

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">

      {/* ── KPI row ── */}
      <div className="grid grid-cols-4 gap-4">
        <Card><CardTitle>Error rate</CardTitle><StatBig label="of all entries are errors" value={`${stats.errorRate}%`} sub={`${stats.errors.toLocaleString()} errors`} color={c.error} /></Card>
        <Card><CardTitle>Fault rate</CardTitle><StatBig label="of all entries are faults" value={`${stats.faultRate}%`} sub={`${stats.faults.toLocaleString()} faults`} color={c.fault} /></Card>
        <Card><CardTitle>Total events</CardTitle><StatBig label="log entries fetched" value={stats.total} color={c.info} /></Card>
        <Card><CardTitle>Unique processes</CardTitle><StatBig label={`across ${stats.uniqueSubsystems} subsystems`} value={stats.uniquePids} color={c.accent} /></Card>
      </div>

      {/* ── Process summary table (centerpiece) ── */}
      <div>
        <div className="mb-2 flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-bright">Process summary</h2>
          <span className="text-xs text-dim">click a column to sort · click a PID or double-click a row to inspect</span>
          <div className="ml-auto flex items-center gap-2">
            <input value={procSearch} onChange={e => setProcSearch(e.target.value)} placeholder="Filter process / PID…"
              className="bg-surface border border-border rounded-lg px-2.5 py-1 text-xs text-body placeholder:text-dim outline-none w-44" />
            <div className="flex bg-surface border border-border rounded-lg p-0.5 gap-0.5">
              {(['all', 'root', 'user'] as const).map(r => (
                <button key={r} onClick={() => setRunAs(r)}
                  className={`px-2.5 py-1 rounded text-xs font-medium capitalize transition-colors ${runAs === r ? 'bg-accent/20 text-accent' : 'text-dim hover:text-body'}`}>{r}</button>
              ))}
            </div>
            <span className="text-xs text-dim font-mono">{sortedProcs.length}/{procRows.length}</span>
          </div>
        </div>
        <Card className="!p-2">
          <div className="overflow-auto max-h-[460px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-panel z-10">
                <tr className="border-b border-border text-dim uppercase tracking-wider text-[10px]">
                  <SortTh label="Process" k="name" align="left" {...sortThProps} />
                  <SortTh label="PID" k="pid" {...sortThProps} />
                  <SortTh label="Run as" k="isRoot" {...sortThProps} />
                  <SortTh label="Faults" k="faults" cls="text-fault" {...sortThProps} />
                  <SortTh label="Errors" k="errors" cls="text-error" {...sortThProps} />
                  <SortTh label="Debug" k="debug" cls="text-debug" {...sortThProps} />
                  <SortTh label="Total" k="total" {...sortThProps} />
                  <SortTh label="Error %" k="ratio" {...sortThProps} />
                </tr>
              </thead>
              <tbody>
                {sortedProcs.map((p, i) => (
                  <tr key={i}
                    onDoubleClick={() => p.pid != null && onOpenProcess?.(p.pid)}
                    className="border-b border-border/40 hover:bg-surface transition-colors cursor-pointer">
                    <td className="py-1.5 px-3 font-mono text-accent">{p.name}</td>
                    <td className="text-right px-3 font-mono">
                      <button onClick={() => p.pid != null && onOpenProcess?.(p.pid)}
                        className="text-accent/80 hover:text-accent hover:underline inline-flex items-center gap-0.5 group">
                        {p.pid ?? '—'}<ExternalLink size={9} className="opacity-0 group-hover:opacity-100" />
                      </button>
                    </td>
                    <td className="text-right px-3">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${p.isRoot ? 'bg-error/15 text-error' : 'bg-surface text-dim'}`}>
                        {p.isRoot ? 'root' : 'user'}
                      </span>
                    </td>
                    <td className="text-right px-3 font-mono text-fault">{p.faults || '—'}</td>
                    <td className="text-right px-3 font-mono text-error">{p.errors || '—'}</td>
                    <td className="text-right px-3 font-mono text-debug">{p.debug || '—'}</td>
                    <td className="text-right px-3 font-mono text-body">{p.total}</td>
                    <td className="text-right px-3">
                      <span className={`font-mono px-1.5 py-0.5 rounded text-[10px] ${p.ratio > 80 ? 'bg-error/20 text-error' : p.ratio > 40 ? 'bg-warn/20 text-warn' : 'bg-surface text-dim'}`}>{p.ratio}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* ── Compact charts ── */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardTitle>Errors + faults over time</CardTitle>
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart data={timeline}>
              <defs>
                <linearGradient id="gFault" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={c.fault} stopOpacity={0.3} /><stop offset="95%" stopColor={c.fault} stopOpacity={0} /></linearGradient>
                <linearGradient id="gError" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={c.error} stopOpacity={0.3} /><stop offset="95%" stopColor={c.error} stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
              <XAxis dataKey="time" tick={axisTick} /><YAxis tick={axisTick} />
              <Tooltip content={<Tip />} />
              <Area type="monotone" dataKey="faults" stroke={c.fault} fill="url(#gFault)" strokeWidth={2} name="faults" />
              <Area type="monotone" dataKey="errors" stroke={c.error} fill="url(#gError)" strokeWidth={2} name="errors" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <CardTitle>Severity breakdown</CardTitle>
          <ResponsiveContainer width="100%" height={150}>
            <PieChart>
              <Pie data={severityPie} cx="50%" cy="50%" innerRadius={40} outerRadius={62} paddingAngle={3} dataKey="value">
                {severityPie.map((e, i) => <Cell key={i} fill={e.color} stroke="transparent" />)}
              </Pie>
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: c.legend }} />
              <Tooltip content={<Tip />} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-2">
            <CardTitle>Top processes</CardTitle>
            <div className="flex gap-1">
              {(['errors','total'] as const).map(t => (
                <button key={t} onClick={() => setProcessTab(t)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${processTab === t ? 'bg-accent/20 text-accent' : 'text-dim hover:text-body'}`}>{t}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart layout="vertical" data={topProcesses}>
              <XAxis type="number" tick={axisTick} />
              <YAxis type="category" dataKey="name" width={120} tick={catTick} />
              <Tooltip content={<Tip />} />
              {processTab === 'errors' ? (
                <>
                  <Bar dataKey="errors" stackId="a" fill={c.error} name="errors" />
                  <Bar dataKey="faults" stackId="a" fill={c.fault} name="faults" radius={[0,2,2,0]} />
                </>
              ) : (
                <Bar dataKey="total" fill={c.info} name="total events" radius={[0,2,2,0]} />
              )}
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <CardTitle>PID vs error count (bubble = total)</CardTitle>
          <ResponsiveContainer width="100%" height={200}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
              <XAxis dataKey="x" name="PID" tick={axisTick} />
              <YAxis dataKey="y" name="Errors" tick={axisTick} />
              <ZAxis dataKey="z" range={[40, 400]} name="total" />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0]?.payload
                return (
                  <div className="bg-panel border border-border rounded-lg p-2 text-xs">
                    <div className="text-bright font-medium">{d?.name}</div>
                    <div className="text-subtle">PID {d?.x} · {d?.y} errors · {d?.z} total</div>
                  </div>
                )
              }} />
              <Scatter data={scatter} fill={c.error} fillOpacity={0.7} />
            </ScatterChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <CardTitle>Top subsystems (errors/faults)</CardTitle>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart layout="vertical" data={subsystemBar}>
              <XAxis type="number" tick={axisTick} />
              <YAxis type="category" dataKey="name" width={140} tick={catTick} />
              <Tooltip content={<Tip />} />
              <Bar dataKey="faults" stackId="a" fill={c.fault} name="faults" />
              <Bar dataKey="errors" stackId="a" fill={c.error} name="errors" />
              <Bar dataKey="other" stackId="a" fill={c.other} name="other" radius={[0,2,2,0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <CardTitle>Repeated error patterns</CardTitle>
          <div className="space-y-2 mt-1">
            {patterns.slice(0, 10).map((p, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="text-xs text-dim font-mono w-8 text-right shrink-0">{p.count}×</div>
                <div className="flex-1 min-w-0">
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(p.count / patterns[0].count) * 100}%`, background: i < 3 ? c.error : i < 6 ? c.warn : c.info }} />
                  </div>
                </div>
                <div className="text-xs text-body font-mono truncate flex-[3] min-w-0">{p.message}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState, useCallback } from 'react'
import { RefreshCw, ArrowUp, ArrowDown, ExternalLink, Search, List, Network } from 'lucide-react'
import type { LogEntry, ProcessListItem } from '../types'
import { formatBytes, appDisplayName } from '../utils/stats'
import { useSort } from '../hooks/useSort'

interface ProcessesViewProps {
  entries: LogEntry[]
  onOpenProcess: (pid: number) => void
}

type Row = ProcessListItem & { logs: number }

function Th({ label, k, align = 'right', mode, sortKey, dir, onToggle }: {
  label: string
  k: keyof Row
  align?: 'left' | 'right'
  mode: 'list' | 'tree'
  sortKey: keyof Row | null
  dir: 'asc' | 'desc'
  onToggle: (k: keyof Row) => void
}) {
  return (
    <th onClick={() => mode === 'list' && onToggle(k)}
      className={`${align === 'left' ? 'text-left' : 'text-right'} py-2 px-3 font-medium whitespace-nowrap ${mode === 'list' ? 'cursor-pointer hover:text-body' : ''} ${sortKey === k && mode === 'list' ? 'text-accent' : ''}`}>
      <span className="inline-flex items-center gap-1">{label}{mode === 'list' && sortKey === k && (dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</span>
    </th>
  )
}

export function ProcessesView({ entries, onOpenProcess }: ProcessesViewProps) {
  const [procs, setProcs] = useState<ProcessListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [runAs, setRunAs] = useState<'all' | 'root' | 'user'>('all')
  const [auto, setAuto] = useState(true)
  const [mode, setMode] = useState<'list' | 'tree'>('list')

  const load = useCallback(() => {
    if (!window.electronAPI?.listProcesses) { setLoading(false); return }
    setLoading(true)
    // Use Activity Monitor-style names (owning .app for extensions, etc.).
    window.electronAPI.listProcesses()
      .then(p => { setProcs(p.map(x => ({ ...x, name: appDisplayName(x.path) || x.name }))); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (!auto) return; const t = setInterval(load, 4000); return () => clearInterval(t) }, [auto, load])

  const logCounts = useMemo(() => {
    const m = new Map<number, number>()
    for (const e of entries) m.set(e.processID, (m.get(e.processID) ?? 0) + 1)
    return m
  }, [entries])

  const matchesFilter = useCallback((p: ProcessListItem) => {
    const q = search.trim().toLowerCase()
    if (runAs === 'root' && !p.isRoot) return false
    if (runAs === 'user' && p.isRoot) return false
    if (q && !(p.name.toLowerCase().includes(q) || String(p.pid).includes(q) || p.user.toLowerCase().includes(q))) return false
    return true
  }, [search, runAs])

  // List mode
  const rows = useMemo<Row[]>(() => procs.filter(matchesFilter).map(p => ({ ...p, logs: logCounts.get(p.pid) ?? 0 })), [procs, matchesFilter, logCounts])
  const { sorted, key, dir, toggle } = useSort<Row>(rows, 'cpu', 'desc')

  // Tree mode: flatten the ppid hierarchy to [{p, depth}], keeping matches + ancestors.
  const tree = useMemo(() => {
    if (mode !== 'tree') return [] as { p: ProcessListItem; depth: number }[]
    const byPid = new Map(procs.map(p => [p.pid, p]))
    const children = new Map<number, ProcessListItem[]>()
    for (const p of procs) { const a = children.get(p.ppid) ?? []; a.push(p); children.set(p.ppid, a) }
    for (const a of children.values()) a.sort((x, y) => y.cpu - x.cpu)

    const filtering = search.trim() !== '' || runAs !== 'all'
    const keep = new Set<number>()
    if (filtering) {
      for (const p of procs) if (matchesFilter(p)) {
        let cur: ProcessListItem | undefined = p
        const seen = new Set<number>()
        while (cur && !seen.has(cur.pid)) { keep.add(cur.pid); seen.add(cur.pid); cur = byPid.get(cur.ppid) }
      }
    }
    const roots = procs.filter(p => !byPid.has(p.ppid) || p.ppid === 0).sort((x, y) => y.cpu - x.cpu)
    const out: { p: ProcessListItem; depth: number }[] = []
    const visited = new Set<number>()
    const walk = (p: ProcessListItem, depth: number) => {
      if (visited.has(p.pid)) return
      visited.add(p.pid)
      if (!filtering || keep.has(p.pid)) out.push({ p, depth })
      for (const ch of children.get(p.pid) ?? []) walk(ch, depth + 1)
    }
    for (const r of roots) walk(r, 0)
    return out
  }, [mode, procs, search, runAs, matchesFilter])

  const thProps = { mode, sortKey: key, dir, onToggle: toggle } as const

  const renderRow = (p: Row | ProcessListItem, depth = 0) => {
    const logs = 'logs' in p ? p.logs : (logCounts.get(p.pid) ?? 0)
    return (
      <tr key={p.pid} onDoubleClick={() => onOpenProcess(p.pid)} className="border-b border-border/40 hover:bg-surface transition-colors cursor-pointer">
        <td className="py-1.5 px-3 font-mono text-accent truncate max-w-sm" title={p.path} style={{ paddingLeft: 12 + depth * 16 }}>
          {depth > 0 && <span className="text-dim">└ </span>}{p.name}
        </td>
        <td className="text-right px-3 font-mono">
          <button onClick={() => onOpenProcess(p.pid)} className="text-accent/80 hover:text-accent hover:underline inline-flex items-center gap-0.5 group">{p.pid}<ExternalLink size={9} className="opacity-0 group-hover:opacity-100" /></button>
        </td>
        <td className="px-3 font-mono text-subtle truncate max-w-[120px]">{p.user}</td>
        <td className="text-right px-3 font-mono text-body">{p.cpu.toFixed(1)}</td>
        <td className="text-right px-3 font-mono text-dim">{p.mem.toFixed(1)}</td>
        <td className="text-right px-3 font-mono text-dim">{formatBytes(p.rss)}</td>
        <td className="px-3 font-mono text-dim">{p.stat}</td>
        <td className="text-right px-3"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${p.isRoot ? 'bg-error/15 text-error' : 'bg-surface text-dim'}`}>{p.isRoot ? 'root' : 'user'}</span></td>
        <td className="text-right px-3">{logs > 0 ? <button onClick={() => onOpenProcess(p.pid)} className="font-mono text-accent hover:underline">{logs.toLocaleString()}</button> : <span className="font-mono text-dim">—</span>}</td>
      </tr>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-panel shrink-0">
        <div className="flex items-center gap-2 bg-surface border border-border rounded-lg px-3 py-1.5 flex-1 max-w-sm">
          <Search size={13} className="text-dim" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by name, PID, user…" className="bg-transparent text-xs text-body placeholder:text-dim outline-none flex-1" />
        </div>
        <div className="flex bg-surface border border-border rounded-lg p-0.5 gap-0.5">
          {(['list', 'tree'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium capitalize transition-colors ${mode === m ? 'bg-accent/20 text-accent' : 'text-dim hover:text-body'}`}>
              {m === 'list' ? <List size={13} /> : <Network size={13} />}{m}
            </button>
          ))}
        </div>
        <div className="flex bg-surface border border-border rounded-lg p-0.5 gap-0.5">
          {(['all', 'root', 'user'] as const).map(r => (
            <button key={r} onClick={() => setRunAs(r)} className={`px-2.5 py-1 rounded text-xs font-medium capitalize transition-colors ${runAs === r ? 'bg-accent/20 text-accent' : 'text-dim hover:text-body'}`}>{r}</button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-dim cursor-pointer select-none"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} className="accent-accent" /> Auto</label>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border text-body text-xs rounded-lg hover:border-muted transition-colors"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh</button>
        <div className="ml-auto text-xs text-dim font-mono">{(mode === 'list' ? sorted.length : tree.length).toLocaleString()} processes</div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-void z-10">
            <tr className="border-b border-border text-dim uppercase tracking-wider text-[10px]">
              <Th label={mode === 'tree' ? 'Process tree' : 'Process'} k="name" align="left" {...thProps} />
              <Th label="PID" k="pid" {...thProps} /><Th label="User" k="user" align="left" {...thProps} />
              <Th label="% CPU" k="cpu" {...thProps} /><Th label="% Mem" k="mem" {...thProps} /><Th label="Memory" k="rss" {...thProps} />
              <Th label="State" k="stat" align="left" {...thProps} /><Th label="Run as" k="isRoot" {...thProps} /><Th label="Log entries" k="logs" {...thProps} />
            </tr>
          </thead>
          <tbody>
            {mode === 'list' ? sorted.map(p => renderRow(p)) : tree.map(({ p, depth }) => renderRow(p, depth))}
          </tbody>
        </table>
        {!window.electronAPI && <div className="p-6 text-sm text-dim">Process list is only available in the Electron app.</div>}
      </div>
    </div>
  )
}

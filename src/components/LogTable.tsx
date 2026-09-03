import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { format, parseISO } from 'date-fns'
import { Search, Lightbulb, X, ExternalLink, WrapText, ArrowUp, ArrowDown, Filter, Columns3, Check, Star, Regex, Bookmark, Save, Trash2 } from 'lucide-react'
import type { LogEntry } from '../types'
import { getProcessName, severityBg } from '../utils/stats'
import { getDiagnosticHints } from '../utils/diagnostics'
import { useSort } from '../hooks/useSort'

interface LogTableProps {
  entries: LogEntry[]
  isStream?: boolean
  onPidClick?: (pid: number) => void
  /** Persist column order/width/visibility/wrap to localStorage (Log Explorer). */
  persist?: boolean
}

const ROW_H = 30
const MIN_COL = 56

function lib(e: LogEntry): string {
  if (!e.senderImagePath) return '—'
  const parts = e.senderImagePath.split('/')
  return parts[parts.length - 1] || '—'
}
function fmtTime(ts: string): string { try { return format(parseISO(ts), 'HH:mm:ss.SSS') } catch { return ts } }
function fmtDate(ts: string): string { try { return format(parseISO(ts), 'yyyy-MM-dd') } catch { return ts } }

interface Col {
  key: string
  label: string
  sortKey: keyof LogEntry
  filter: 'facet' | 'text'   // value-picker vs contains-text
  width: number
  defaultVisible: boolean
  get: (e: LogEntry) => string
}

const BASE_COLS: Col[] = [
  { key: 'date', label: 'Date', sortKey: 'timestamp', filter: 'text', width: 96, defaultVisible: false, get: e => fmtDate(e.timestamp) },
  { key: 'time', label: 'Time', sortKey: 'timestamp', filter: 'text', width: 104, defaultVisible: true, get: e => fmtTime(e.timestamp) },
  { key: 'type', label: 'Type', sortKey: 'messageType', filter: 'facet', width: 74, defaultVisible: true, get: e => e.messageType },
  { key: 'pid', label: 'PID', sortKey: 'processID', filter: 'facet', width: 64, defaultVisible: true, get: e => String(e.processID) },
  { key: 'process', label: 'Process', sortKey: 'processImagePath', filter: 'facet', width: 150, defaultVisible: true, get: e => getProcessName(e) },
  { key: 'library', label: 'Library', sortKey: 'senderImagePath', filter: 'facet', width: 132, defaultVisible: true, get: e => lib(e) },
  { key: 'subsystem', label: 'Subsystem', sortKey: 'subsystem', filter: 'facet', width: 168, defaultVisible: true, get: e => e.subsystem || '—' },
  { key: 'category', label: 'Category', sortKey: 'category', filter: 'facet', width: 110, defaultVisible: true, get: e => e.category || '—' },
  { key: 'thread', label: 'Thread', sortKey: 'threadID', filter: 'facet', width: 88, defaultVisible: true, get: e => e.threadID != null ? '0x' + e.threadID.toString(16) : '—' },
  { key: 'activity', label: 'Activity', sortKey: 'activityIdentifier', filter: 'facet', width: 86, defaultVisible: true, get: e => e.activityIdentifier ? String(e.activityIdentifier) : '—' },
  { key: 'eventType', label: 'Event', sortKey: 'eventType', filter: 'facet', width: 110, defaultVisible: false, get: e => e.eventType || '—' },
  { key: 'message', label: 'Message', sortKey: 'eventMessage', filter: 'text', width: 560, defaultVisible: true, get: e => e.eventMessage },
  { key: 'formatString', label: 'Format string', sortKey: 'formatString', filter: 'text', width: 240, defaultVisible: false, get: e => e.formatString || '—' },
  { key: 'traceID', label: 'Trace ID', sortKey: 'traceID', filter: 'text', width: 130, defaultVisible: false, get: e => e.traceID != null ? String(e.traceID) : '—' },
  { key: 'machTimestamp', label: 'Mach time', sortKey: 'machTimestamp', filter: 'text', width: 130, defaultVisible: false, get: e => e.machTimestamp != null ? String(e.machTimestamp) : '—' },
  { key: 'parentActivity', label: 'Parent activity', sortKey: 'parentActivityIdentifier', filter: 'text', width: 120, defaultVisible: false, get: e => e.parentActivityIdentifier ? String(e.parentActivityIdentifier) : '—' },
  { key: 'senderPC', label: 'Sender PC', sortKey: 'senderProgramCounter', filter: 'text', width: 110, defaultVisible: false, get: e => e.senderProgramCounter != null ? String(e.senderProgramCounter) : '—' },
  { key: 'processUUID', label: 'Process UUID', sortKey: 'processImageUUID', filter: 'text', width: 150, defaultVisible: false, get: e => e.processImageUUID || '—' },
  { key: 'senderUUID', label: 'Sender UUID', sortKey: 'senderImageUUID', filter: 'text', width: 150, defaultVisible: false, get: e => e.senderImageUUID || '—' },
  { key: 'bootUUID', label: 'Boot UUID', sortKey: 'bootUUID', filter: 'text', width: 150, defaultVisible: false, get: e => e.bootUUID || '—' },
  { key: 'backtrace', label: 'Backtrace', sortKey: 'eventMessage', filter: 'text', width: 96, defaultVisible: false, get: e => e.backtrace?.frames?.length ? `${e.backtrace.frames.length} frames` : '—' },
]

const STORE_KEY = 'conlog-logtable-v1'
const BM_KEY = 'conlog-bookmarks-v1'
const PRESET_KEY = 'conlog-presets-v1'
type Persisted = { order?: string[]; widths?: Record<string, number>; visible?: Record<string, boolean>; wrap?: boolean }
function loadPersisted(): Persisted | null {
  try { const raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) as Persisted : null } catch { return null }
}
interface Preset { name: string; search: string; regex: boolean; facetSel: Record<string, string[]>; textSel: Record<string, string> }
function bmKey(e: LogEntry): string { return `${e.timestamp}|${e.processID}|${(e.eventMessage || '').slice(0, 80)}` }
function loadBookmarks(): Set<string> { try { const r = localStorage.getItem(BM_KEY); return new Set<string>(r ? JSON.parse(r) : []) } catch { return new Set() } }
function loadPresets(): Preset[] { try { const r = localStorage.getItem(PRESET_KEY); return r ? JSON.parse(r) as Preset[] : [] } catch { return [] } }

function useOutsideClose(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onClose])
  return ref
}

function FilterPopover({ col, values, selected, text, onValues, onText, onClose }:
  { col: Col; values: { v: string; n: number }[]; selected: string[]; text: string;
    onValues: (s: string[]) => void; onText: (t: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const ref = useOutsideClose(true, onClose)

  if (col.filter === 'text') {
    return (
      <div ref={ref} className="absolute top-full left-0 mt-1 w-72 bg-panel border border-border rounded-lg shadow-2xl z-30 p-2.5" onClick={e => e.stopPropagation()}>
        <div className="text-[10px] uppercase tracking-wider text-dim mb-1.5">Contains</div>
        <input autoFocus value={text} onChange={e => onText(e.target.value)} placeholder={`Text in ${col.label}…`}
          className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-body outline-none" />
        {text && <button onClick={() => onText('')} className="mt-2 text-[11px] text-accent hover:underline">Clear</button>}
      </div>
    )
  }

  const sel = new Set(selected)
  const shown = q ? values.filter(x => x.v.toLowerCase().includes(q.toLowerCase())) : values
  const toggle = (v: string) => { const n = new Set(sel); n.has(v) ? n.delete(v) : n.add(v); onValues([...n]) }
  return (
    <div ref={ref} className="absolute top-full left-0 mt-1 bg-panel border border-border rounded-lg shadow-2xl z-30 p-2 flex flex-col"
      style={{ width: 280, resize: 'both', overflow: 'hidden', minWidth: 220, minHeight: 200, maxWidth: 640 }}
      onClick={e => e.stopPropagation()}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={`Filter ${col.label}…`}
        className="bg-surface border border-border rounded px-2 py-1 text-xs text-body outline-none mb-2 shrink-0" />
      <div className="flex items-center justify-between mb-1.5 text-[11px] shrink-0">
        <button onClick={() => onValues([])} className="text-accent hover:underline">Clear</button>
        <span className="text-dim">{selected.length ? `${selected.length} selected` : 'All'}</span>
        <button onClick={() => onValues(shown.map(x => x.v))} className="text-accent hover:underline">Select all</button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-0.5 min-h-0">
        {shown.slice(0, 500).map(({ v, n }) => (
          <button key={v} onClick={() => toggle(v)} className="w-full flex items-start gap-2 px-1.5 py-1 rounded hover:bg-surface text-left">
            <span className={`w-3.5 h-3.5 mt-0.5 rounded border flex items-center justify-center shrink-0 ${sel.has(v) ? 'bg-accent border-accent' : 'border-muted'}`}>
              {sel.has(v) && <Check size={10} className="text-white" />}
            </span>
            <span className="text-xs text-body font-mono break-all flex-1">{v || '—'}</span>
            <span className="text-[10px] text-dim shrink-0">{n}</span>
          </button>
        ))}
        {shown.length === 0 && <div className="text-xs text-dim px-1.5 py-2">No matches</div>}
      </div>
      <div className="text-[10px] text-dim pt-1.5 shrink-0">Drag corner to resize</div>
    </div>
  )
}

function DiagnosticPanel({ entry, allEntries, onClose, onPidClick }: { entry: LogEntry; allEntries: LogEntry[]; onClose: () => void; onPidClick?: (pid: number) => void }) {
  const hints = getDiagnosticHints(entry)
  // ±1s context from OTHER processes — helps spot a root cause around a fault.
  const related = useMemo(() => {
    const t0 = Date.parse(entry.timestamp)
    if (Number.isNaN(t0)) return []
    return allEntries
      .filter(e => e !== entry && e.processID !== entry.processID && Math.abs(Date.parse(e.timestamp) - t0) <= 1000)
      .slice(0, 40)
  }, [entry, allEntries])
  return (
    <div className="border-t border-border bg-panel flex flex-col" style={{ minHeight: 220, maxHeight: 360 }}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2"><Lightbulb size={13} className="text-warn" /><span className="text-xs font-medium text-body">Diagnostic — {getProcessName(entry)}</span></div>
        <button onClick={onClose} className="text-dim hover:text-body"><X size={13} /></button>
      </div>
      <div className="px-4 py-2.5 border-b border-border"><div className="font-mono text-xs text-body leading-relaxed break-all">{entry.eventMessage}</div></div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {related.length > 0 && (
          <details className="rounded-lg border border-border bg-surface p-3">
            <summary className="text-xs font-medium text-body cursor-pointer">Related context · {related.length} events from other processes within ±1s</summary>
            <div className="mt-2 space-y-0.5 font-mono text-[10px]">
              {related.map((e, i) => (
                <div key={i} className="flex gap-2">
                  <span className={e.messageType === 'fault' ? 'text-fault' : e.messageType === 'error' ? 'text-error' : 'text-dim'}>[{e.messageType.toUpperCase().slice(0,3)}]</span>
                  <button onClick={() => onPidClick?.(e.processID)} className="text-accent hover:underline shrink-0">{getProcessName(e)}</button>
                  <span className="text-subtle truncate">{e.eventMessage}</span>
                </div>
              ))}
            </div>
          </details>
        )}
        {entry.backtrace?.frames?.length ? (
          <details className="rounded-lg border border-border bg-surface p-3">
            <summary className="text-xs font-medium text-body cursor-pointer">Backtrace · {entry.backtrace.frames.length} frames</summary>
            <div className="mt-2 space-y-0.5 font-mono text-[10px] text-subtle">
              {entry.backtrace.frames.map((f, i) => (
                <div key={i}>#{i} {f.imageUUID ?? '?'} +{f.imageOffset ?? 0}</div>
              ))}
            </div>
          </details>
        ) : null}
        {hints.map((h, i) => (
          <div key={i} className={`rounded-lg p-3 border ${h.severity === 'high' ? 'bg-error/5 border-error/20' : h.severity === 'medium' ? 'bg-warn/5 border-warn/20' : 'bg-surface border-border'}`}>
            <div className={`text-xs font-medium mb-1 ${h.severity === 'high' ? 'text-error' : h.severity === 'medium' ? 'text-warn' : 'text-body'}`}>{h.title}</div>
            <div className="text-xs text-subtle leading-relaxed">{h.description}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function LogTable({ entries, isStream = false, onPidClick, persist = false }: LogTableProps) {
  const saved = useMemo(() => (persist ? loadPersisted() : null), [persist])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<LogEntry | null>(null)
  const [wrap, setWrap] = useState<boolean>(saved?.wrap ?? true)

  const [order, setOrder] = useState<string[]>(() => {
    const all = BASE_COLS.map(c => c.key)
    if (!saved?.order) return all
    const known = saved.order.filter(k => all.includes(k))
    return [...known, ...all.filter(k => !known.includes(k))]
  })
  const [widths, setWidths] = useState<Record<string, number>>(() => ({ ...Object.fromEntries(BASE_COLS.map(c => [c.key, c.width])), ...(saved?.widths ?? {}) }))
  const [visible, setVisible] = useState<Record<string, boolean>>(() => ({ ...Object.fromEntries(BASE_COLS.map(c => [c.key, c.defaultVisible])), ...(saved?.visible ?? {}) }))
  const [facetSel, setFacetSel] = useState<Record<string, string[]>>({})
  const [textSel, setTextSel] = useState<Record<string, string>>({})
  const [openFilter, setOpenFilter] = useState<string | null>(null)
  const [showCols, setShowCols] = useState(false)
  const dragKey = useRef<string | null>(null)
  const [regex, setRegex] = useState(false)
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => (persist ? loadBookmarks() : new Set()))
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false)
  const [presets, setPresets] = useState<Preset[]>(() => (persist ? loadPresets() : []))
  const [showPresets, setShowPresets] = useState(false)

  const toggleBookmark = useCallback((e: LogEntry) => {
    setBookmarks(prev => {
      const next = new Set(prev); const k = bmKey(e); next.has(k) ? next.delete(k) : next.add(k)
      try { localStorage.setItem(BM_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }, [])
  const savePreset = useCallback(() => {
    const name = window.prompt('Name this filter preset:')?.trim()
    if (!name) return
    setPresets(prev => {
      const next = [...prev.filter(p => p.name !== name), { name, search, regex, facetSel, textSel }]
      try { localStorage.setItem(PRESET_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [search, regex, facetSel, textSel])
  const applyPreset = useCallback((p: Preset) => {
    setSearch(p.search); setRegex(p.regex); setFacetSel(p.facetSel || {}); setTextSel(p.textSel || {}); setShowPresets(false)
  }, [])
  const deletePreset = useCallback((name: string) => {
    setPresets(prev => { const next = prev.filter(p => p.name !== name); try { localStorage.setItem(PRESET_KEY, JSON.stringify(next)) } catch { /* ignore */ }  return next })
  }, [])

  const byKey = useMemo(() => Object.fromEntries(BASE_COLS.map(c => [c.key, c])), [])
  const cols = useMemo(() => order.map(k => byKey[k]).filter(c => c && visible[c.key]), [order, visible, byKey])

  // Remember column layout between launches (Log Explorer only).
  useEffect(() => {
    if (!persist) return
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ order, widths, visible, wrap })) } catch { /* ignore */ }
  }, [persist, order, widths, visible, wrap])
  const gridTemplate = (persist ? '30px ' : '') + cols.map(c => `${widths[c.key]}px`).join(' ')
  const minWidth = (persist ? 30 : 0) + cols.reduce((s, c) => s + widths[c.key], 0)

  // Predicate that applies the global search + all column filters EXCEPT `exceptKey`.
  // Excluding a column when computing its own facet list is what makes the value
  // options reflect the other active filters (cross-filtering).
  // Compile the regex once (invalid pattern → no rows, signalled via regexError).
  const { rx, regexError } = useMemo(() => {
    if (!regex || !search.trim()) return { rx: null as RegExp | null, regexError: false }
    try { return { rx: new RegExp(search, 'i'), regexError: false } } catch { return { rx: null, regexError: true } }
  }, [regex, search])

  const makePass = useCallback((exceptKey: string | null) => {
    const q = search.trim().toLowerCase()
    const facets = Object.entries(facetSel).filter(([k, v]) => v && v.length && k !== exceptKey)
    const texts = Object.entries(textSel).filter(([k, v]) => v && v.trim() && k !== exceptKey)
    return (e: LogEntry) => {
      if (bookmarkedOnly && !bookmarks.has(bmKey(e))) return false
      if (regex) {
        if (regexError) return false
        if (rx && !(rx.test(e.eventMessage || '') || rx.test(getProcessName(e)) || rx.test(e.subsystem || ''))) return false
      } else if (q && !(
        e.eventMessage?.toLowerCase().includes(q) || e.processImagePath?.toLowerCase().includes(q) ||
        e.senderImagePath?.toLowerCase().includes(q) || e.subsystem?.toLowerCase().includes(q) ||
        e.category?.toLowerCase().includes(q) || String(e.processID).includes(q)
      )) return false
      for (const [k, vals] of facets) { const c = byKey[k]; if (c && !vals.includes(c.get(e))) return false }
      for (const [k, t] of texts) { const c = byKey[k]; if (c && !c.get(e).toLowerCase().includes(t.trim().toLowerCase())) return false }
      return true
    }
  }, [search, facetSel, textSel, byKey, regex, rx, regexError, bookmarkedOnly, bookmarks])

  const filtered = useMemo(() => entries.filter(makePass(null)), [entries, makePass])
  const { sorted, key: sortKey, dir: sortDir, toggle } = useSort<LogEntry>(filtered, null)

  // Facet values for the open column, counted over rows passing the OTHER filters.
  const facetValues = useMemo(() => {
    if (!openFilter) return []
    const col = byKey[openFilter]
    if (!col || col.filter !== 'facet') return []
    const pass = makePass(openFilter)
    const counts = new Map<string, number>()
    for (const e of entries) if (pass(e)) { const v = col.get(e); counts.set(v, (counts.get(v) ?? 0) + 1) }
    for (const v of (facetSel[openFilter] ?? [])) if (!counts.has(v)) counts.set(v, 0) // keep selected even if now absent
    return [...counts.entries()].map(([v, n]) => ({ v, n })).sort((a, b) => b.n - a.n)
  }, [openFilter, entries, makePass, byKey, facetSel])

  const parentRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  // TanStack Virtual's returned functions are documented as stable; this is the library's normal API shape.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (wrap ? 52 : ROW_H),
    overscan: 16,
    measureElement: el => el.getBoundingClientRect().height,
  })
  useEffect(() => { virtualizer.measure() }, [wrap, widths, virtualizer])

  const onScroll = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }, [])

  // #22 Esc clears this table's filters (broadcast from the global handler).
  useEffect(() => {
    const clear = () => { setSearch(''); setFacetSel({}); setTextSel({}); setBookmarkedOnly(false) }
    window.addEventListener('conlog-clear-filters', clear)
    return () => window.removeEventListener('conlog-clear-filters', clear)
  }, [])

  // #22 Arrow-key row navigation when the table is focused.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    e.preventDefault()
    setSelected(cur => {
      const idx = cur ? sorted.indexOf(cur) : -1
      const next = e.key === 'ArrowDown' ? Math.min(sorted.length - 1, idx + 1) : Math.max(0, idx - 1)
      if (next >= 0 && next < sorted.length) { virtualizer.scrollToIndex(next); return sorted[next] }
      return cur
    })
  }, [sorted, virtualizer])
  useEffect(() => {
    if (isStream && !sortKey && followRef.current && sorted.length > 0) virtualizer.scrollToIndex(sorted.length - 1)
  }, [sorted.length, isStream, sortKey, virtualizer])

  const startResize = (key: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX, startW = widths[key]
    const move = (ev: MouseEvent) => setWidths(w => ({ ...w, [key]: Math.max(MIN_COL, startW + (ev.clientX - startX)) }))
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up)
  }
  const onDrop = (targetKey: string) => {
    const src = dragKey.current; dragKey.current = null
    if (!src || src === targetKey) return
    setOrder(prev => { const next = prev.filter(k => k !== src); next.splice(next.indexOf(targetKey), 0, src); return next })
  }

  const items = virtualizer.getVirtualItems()
  const activeFilterCount = Object.values(facetSel).filter(v => v?.length).length + Object.values(textSel).filter(v => v?.trim()).length
  const isFiltered = (k: string) => (facetSel[k]?.length ?? 0) > 0 || !!textSel[k]?.trim()

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-panel shrink-0">
        <div className={`flex items-center gap-2 bg-surface border rounded-lg px-3 py-1.5 flex-1 max-w-sm ${regexError ? 'border-error' : 'border-border'}`}>
          <Search size={13} className="text-dim" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} data-logsearch
            placeholder={regex ? 'Regular expression…' : 'Search all columns…'} className="bg-transparent text-xs text-body placeholder:text-dim outline-none flex-1" />
          {regexError && <span className="text-[10px] text-error">bad regex</span>}
          {search && <button onClick={() => setSearch('')} className="text-dim hover:text-body"><X size={12} /></button>}
        </div>
        <button onClick={() => setRegex(r => !r)} title="Treat search as a regular expression"
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${regex ? 'bg-accent/20 text-accent' : 'text-dim hover:text-body hover:bg-surface'}`}><Regex size={14} /></button>
        {activeFilterCount > 0 && (
          <button onClick={() => { setFacetSel({}); setTextSel({}) }} className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-accent/15 text-accent">
            <Filter size={12} /> {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} · clear
          </button>
        )}
        {persist && (
          <>
            <button onClick={() => setBookmarkedOnly(b => !b)} title="Show only bookmarked rows"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${bookmarkedOnly ? 'bg-warn/20 text-warn' : 'text-dim hover:text-body hover:bg-surface'}`}>
              <Star size={13} className={bookmarkedOnly ? 'fill-warn' : ''} /> {bookmarks.size > 0 ? bookmarks.size : ''}
            </button>
            <div className="relative">
              <button onClick={() => setShowPresets(s => !s)} className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-dim hover:text-body hover:bg-surface" title="Filter presets"><Bookmark size={13} /> Presets</button>
              {showPresets && (
                <div className="absolute top-full left-0 mt-1 w-60 bg-panel border border-border rounded-lg shadow-2xl z-30 p-1.5">
                  <button onClick={savePreset} className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface text-left text-xs text-accent"><Save size={13} /> Save current filters…</button>
                  {presets.length > 0 && <div className="border-t border-border my-1" />}
                  {presets.map(p => (
                    <div key={p.name} className="flex items-center gap-1 group">
                      <button onClick={() => applyPreset(p)} className="flex-1 px-2 py-1.5 rounded hover:bg-surface text-left text-xs text-body truncate">{p.name}</button>
                      <button onClick={() => deletePreset(p.name)} className="text-dim hover:text-error opacity-0 group-hover:opacity-100 px-1"><Trash2 size={12} /></button>
                    </div>
                  ))}
                  {presets.length === 0 && <div className="text-[11px] text-dim px-2 py-1.5">No saved presets yet.</div>}
                </div>
              )}
            </div>
          </>
        )}
        <div className="relative">
          <button onClick={() => setShowCols(s => !s)} className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-dim hover:text-body hover:bg-surface" title="Show / hide columns">
            <Columns3 size={13} /> Columns
          </button>
          {showCols && <ColumnPicker order={order} byKey={byKey} visible={visible} onClose={() => setShowCols(false)} onToggle={k => setVisible(v => ({ ...v, [k]: !v[k] }))} />}
        </div>
        <button onClick={() => setWrap(w => !w)} className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${wrap ? 'bg-accent/20 text-accent' : 'text-dim hover:text-body hover:bg-surface'}`} title="Toggle word wrap"><WrapText size={13} /> Wrap</button>
        <div className="ml-auto text-xs text-dim font-mono">{sorted.length.toLocaleString()} / {entries.length.toLocaleString()}</div>
      </div>

      <div ref={parentRef} onScroll={onScroll} onKeyDown={onKeyDown} tabIndex={0} className="flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-accent/40">
        <div style={{ minWidth }}>
          <div className="grid sticky top-0 z-20 border-b border-border bg-void text-[10px] font-medium text-dim uppercase tracking-wider" style={{ gridTemplateColumns: gridTemplate }}>
            {persist && <div className="border-r border-border/50" />}
            {cols.map(col => (
              <div key={col.key} className="relative flex items-center gap-1 px-3 py-2 border-r border-border/50"
                draggable onDragStart={() => { dragKey.current = col.key }} onDragOver={e => e.preventDefault()} onDrop={() => onDrop(col.key)}>
                <button onClick={() => toggle(col.sortKey)} className={`flex items-center gap-1 hover:text-body ${sortKey === col.sortKey ? 'text-accent' : ''}`}>
                  {col.label}{sortKey === col.sortKey && (sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                </button>
                <button onClick={() => setOpenFilter(k => k === col.key ? null : col.key)} className={`ml-0.5 ${isFiltered(col.key) ? 'text-accent' : 'text-dim/60 hover:text-body'}`} title={`Filter ${col.label}`}><Filter size={10} /></button>
                {openFilter === col.key && (
                  <FilterPopover col={col} values={facetValues} selected={facetSel[col.key] ?? []} text={textSel[col.key] ?? ''}
                    onValues={s => setFacetSel(f => ({ ...f, [col.key]: s }))} onText={t => setTextSel(f => ({ ...f, [col.key]: t }))} onClose={() => setOpenFilter(null)} />
                )}
                <div onMouseDown={e => startResize(col.key, e)} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-accent/40" />
              </div>
            ))}
          </div>

          {sorted.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-dim text-sm">No matching entries</div>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
              {items.map(vi => {
                const e = sorted[vi.index]; const isSel = selected === e
                return (
                  <div key={vi.key} data-index={vi.index} ref={virtualizer.measureElement} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}>
                    <div onClick={() => setSelected(isSel ? null : e)} className={`grid ${wrap ? 'items-start py-1.5' : 'items-center'} cursor-pointer border-b border-border/40 hover:bg-surface transition-colors text-xs font-mono ${isSel ? 'bg-accent/5' : ''}`} style={{ gridTemplateColumns: gridTemplate, minHeight: ROW_H }}>
                      {persist && (
                        <span className="flex items-center justify-center">
                          <button onClick={ev => { ev.stopPropagation(); toggleBookmark(e) }} title="Bookmark"
                            className={bookmarks.has(bmKey(e)) ? 'text-warn' : 'text-dim/40 hover:text-warn'}>
                            <Star size={12} className={bookmarks.has(bmKey(e)) ? 'fill-warn' : ''} />
                          </button>
                        </span>
                      )}
                      {cols.map(col => {
                        if (col.key === 'type') return <span key="type" className="px-3 flex items-center"><span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium w-fit ${severityBg(e.messageType)}`}>{e.messageType.toUpperCase().slice(0,5)}</span></span>
                        if (col.key === 'pid') return (
                          <span key="pid" className="px-3 flex items-center">
                            <button onClick={ev => { ev.stopPropagation(); onPidClick?.(e.processID) }} className="text-accent/80 hover:text-accent hover:underline flex items-center gap-0.5 group" title={`Inspect PID ${e.processID}`}>{e.processID}<ExternalLink size={9} className="opacity-0 group-hover:opacity-100" /></button>
                          </span>
                        )
                        const cls = col.key === 'process' ? 'text-accent' : col.key === 'message' ? 'text-body' : ['time','date','thread','activity','category','eventType','formatString'].includes(col.key) ? 'text-dim' : 'text-subtle'
                        const doWrap = wrap && (col.key === 'message' || col.key === 'formatString')
                        return <span key={col.key} className={`px-3 ${doWrap ? 'whitespace-pre-wrap break-words' : 'truncate'} ${cls}`}>{col.get(e)}</span>
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {selected && <DiagnosticPanel entry={selected} allEntries={entries} onClose={() => setSelected(null)} onPidClick={onPidClick} />}
    </div>
  )
}

function ColumnPicker({ order, byKey, visible, onToggle, onClose }:
  { order: string[]; byKey: Record<string, Col>; visible: Record<string, boolean>; onToggle: (k: string) => void; onClose: () => void }) {
  const ref = useOutsideClose(true, onClose)
  return (
    <div ref={ref} className="absolute top-full right-0 mt-1 w-52 bg-panel border border-border rounded-lg shadow-2xl z-30 p-1.5 max-h-80 overflow-y-auto">
      <div className="text-[10px] uppercase tracking-wider text-dim px-1.5 py-1">Columns</div>
      {order.map(k => {
        const col = byKey[k]; const on = visible[k]
        return (
          <button key={k} onClick={() => onToggle(k)} className="w-full flex items-center gap-2 px-1.5 py-1 rounded hover:bg-surface text-left">
            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-accent border-accent' : 'border-muted'}`}>{on && <Check size={10} className="text-white" />}</span>
            <span className="text-xs text-body">{col.label}</span>
          </button>
        )
      })}
    </div>
  )
}

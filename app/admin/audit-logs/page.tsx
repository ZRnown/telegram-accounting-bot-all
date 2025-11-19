"use client"

import { useEffect, useMemo, useState } from 'react'

type Item = { id: string; username?: string; action?: string; target?: string; ip?: string; createdAt?: string }

type Query = { page: number; size: number; username: string; ip: string; action: string; from: string; to: string }

export default function AuditLogsPage() {
  const [q, setQ] = useState<Query>({ page: 1, size: 20, username: '', ip: '', action: '', from: '', to: '' })
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const params = useMemo(() => {
    const sp = new URLSearchParams()
    sp.set('page', String(q.page))
    sp.set('size', String(q.size))
    if (q.username.trim()) sp.set('username', q.username.trim())
    if (q.ip.trim()) sp.set('ip', q.ip.trim())
    if (q.action.trim()) sp.set('action', q.action.trim())
    if (q.from) sp.set('from', q.from)
    if (q.to) sp.set('to', q.to)
    return sp.toString()
  }, [q])

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/audit-logs?${params}`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || '加载失败')
      setItems(Array.isArray(data.items) ? data.items : [])
      setTotal(Number(data.total || 0))
    } catch (e: any) {
      setError(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [params])

  const totalPages = Math.max(1, Math.ceil(total / q.size))

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <h1 className="text-xl font-semibold">审计日志</h1>
        <div className="flex-1" />
        <button className="px-3 py-1 border rounded" onClick={fetchData} disabled={loading}>{loading ? '刷新中...' : '刷新'}</button>
      </div>

      <div className="border rounded p-3 mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <div>
          <div className="text-sm text-slate-600 mb-1">用户名</div>
          <input className="w-full border rounded px-3 py-2" value={q.username} onChange={e => setQ(s => ({ ...s, username: e.target.value, page: 1 }))} placeholder="admin" />
        </div>
        <div>
          <div className="text-sm text-slate-600 mb-1">IP</div>
          <input className="w-full border rounded px-3 py-2" value={q.ip} onChange={e => setQ(s => ({ ...s, ip: e.target.value, page: 1 }))} placeholder="127.0.0.1" />
        </div>
        <div>
          <div className="text-sm text-slate-600 mb-1">操作(Action)</div>
          <input className="w-full border rounded px-3 py-2" value={q.action} onChange={e => setQ(s => ({ ...s, action: e.target.value, page: 1 }))} placeholder="login_success" />
        </div>
        <div>
          <div className="text-sm text-slate-600 mb-1">起始时间(ISO)</div>
          <input className="w-full border rounded px-3 py-2" value={q.from} onChange={e => setQ(s => ({ ...s, from: e.target.value, page: 1 }))} placeholder="2025-01-01T00:00:00Z" />
        </div>
        <div>
          <div className="text-sm text-slate-600 mb-1">结束时间(ISO)</div>
          <input className="w-full border rounded px-3 py-2" value={q.to} onChange={e => setQ(s => ({ ...s, to: e.target.value, page: 1 }))} placeholder="2025-01-31T23:59:59Z" />
        </div>
        <div className="flex items-end">
          <button className="px-3 py-2 border rounded w-full" onClick={() => setQ(s => ({ ...s, page: 1 }))}>应用筛选</button>
        </div>
      </div>

      {error && <div className="text-red-600 mb-2">{error}</div>}

      <div className="overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-3 py-2 border-b">时间</th>
              <th className="text-left px-3 py-2 border-b">用户名</th>
              <th className="text-left px-3 py-2 border-b">动作</th>
              <th className="text-left px-3 py-2 border-b">目标</th>
              <th className="text-left px-3 py-2 border-b">IP</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400">暂无数据</td></tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 border-b">{it.createdAt ? new Date(it.createdAt).toLocaleString() : ''}</td>
                <td className="px-3 py-2 border-b">{it.username || ''}</td>
                <td className="px-3 py-2 border-b">{it.action || ''}</td>
                <td className="px-3 py-2 border-b break-all">{it.target || ''}</td>
                <td className="px-3 py-2 border-b">{it.ip || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="text-sm text-slate-600">共 {total} 条，{q.size} 条/页</div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1 border rounded disabled:opacity-50" onClick={() => setQ(s => ({ ...s, page: Math.max(1, s.page - 1) }))} disabled={q.page <= 1}>上一页</button>
          <div className="text-sm">{q.page} / {totalPages}</div>
          <button className="px-3 py-1 border rounded disabled:opacity-50" onClick={() => setQ(s => ({ ...s, page: Math.min(totalPages, s.page + 1) }))} disabled={q.page >= totalPages}>下一页</button>
          <select className="px-2 py-1 border rounded" value={q.size} onChange={e => setQ(s => ({ ...s, size: Number(e.target.value), page: 1 }))}>
            {[10,20,50,100].map(n => <option key={n} value={n}>{n}/页</option>)}
          </select>
        </div>
      </div>
    </div>
  )
}

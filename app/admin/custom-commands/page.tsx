"use client"

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { toast } from '@/hooks/use-toast'

type Item = {
  name: string
  text?: string
  imageUrl?: string
  updatedAt?: string
  updatedBy?: string
}

export default function CustomCommandsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const botId = useMemo(() => (searchParams?.get('botId') || '').trim(), [searchParams])
  const [mounted, setMounted] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)

  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [error, setError] = useState<string | null>(null)

  // form state
  const [formName, setFormName] = useState('')
  const [formText, setFormText] = useState('')
  const [saving, setSaving] = useState(false)
  const [formImageUrl, setFormImageUrl] = useState('')

  // modal state for add/edit
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [modalName, setModalName] = useState('')
  const [modalText, setModalText] = useState('')
  const [modalImageUrl, setModalImageUrl] = useState('')
  const [modalSaving, setModalSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null)

  const refresh = async () => {
    if (!botId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/custom-commands?botId=${encodeURIComponent(botId)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || '加载失败')
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch (e: any) {
      setError(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setMounted(true)
    ;(async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' })
        if (res.ok) {
          setIsAdmin(true)
        } else {
          setIsAdmin(false)
          router.push('/')
        }
      } catch {
        setIsAdmin(false)
        router.push('/')
      }
    })()
  }, [router])

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: '已复制', description: text })
    } catch (e: any) {
      toast({ title: '复制失败', description: e?.message || '' , variant: 'destructive'})
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!botId) { toast({ title: '错误', description: '缺少 botId', variant: 'destructive' }); return }
    const name = formName.trim()
    if (!name) { toast({ title: '提示', description: '请输入指令名称' }); return }
    try {
      setSaving(true)
      const res = await fetch('/api/custom-commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId, name, text: formText || '' })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || '保存失败')
      // if image url provided, then set image
      const img = (formImageUrl || '').trim()
      if (img.length > 0) {
        const ires = await fetch('/api/custom-commands/image', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ botId, name, imageUrl: img })
        })
        const idata = await ires.json().catch(() => ({}))
        if (!ires.ok) throw new Error(idata?.error || '设置图片失败')
      }
      setFormName('')
      setFormText('')
      setFormImageUrl('')
      await refresh()
      toast({ title: '成功', description: '已保存自定义指令' })
    } catch (e: any) {
      toast({ title: '错误', description: e?.message || '保存失败', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const openCreateModal = () => {
    setModalMode('create')
    setModalName('')
    setModalText('')
    setModalImageUrl('')
    setModalOpen(true)
  }

  const openEditModal = (it: Item) => {
    setModalMode('edit')
    setModalName(it.name)
    setModalText(it.text || '')
    setModalImageUrl(it.imageUrl || '')
    setModalOpen(true)
  }

  const submitModal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!botId) { toast({ title: '错误', description: '缺少 botId', variant: 'destructive' }); return }
    const name = (modalName || '').trim()
    if (!name) { toast({ title: '提示', description: '请输入指令名称' }); return }
    try {
      setModalSaving(true)
      // 先提交文本
      const res = await fetch('/api/custom-commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId, name, text: modalText || '' })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || '保存失败')
      // 再设置图片（可选，可清空）
      const image = (modalImageUrl || '').trim()
      if (image.length > 0 || modalMode === 'edit') {
        const ires = await fetch('/api/custom-commands/image', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ botId, name, imageUrl: image })
        })
        const idata = await ires.json().catch(() => ({}))
        if (!ires.ok) throw new Error(idata?.error || '设置图片失败')
      }
      setModalOpen(false)
      await refresh()
      toast({ title: '成功', description: '已保存自定义指令' })
    } catch (e: any) {
      toast({ title: '错误', description: e?.message || '保存失败', variant: 'destructive' })
    } finally {
      setModalSaving(false)
    }
  }

  const setImage = (it: Item) => {
    // 复用编辑弹窗
    openEditModal(it)
  }

  const remove = async (name: string) => {
    if (!botId) { toast({ title: '错误', description: '缺少 botId', variant: 'destructive' }); return }
    try {
      const res = await fetch('/api/custom-commands', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId, name })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || '删除失败')
      await refresh()
      toast({ title: '成功', description: '已删除' })
    } catch (e: any) {
      toast({ title: '错误', description: e?.message || '删除失败', variant: 'destructive' })
    }
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <button className="px-3 py-1 border rounded" onClick={() => router.back()}>返回</button>
        <h1 className="text-xl font-semibold">自定义指令管理</h1>
        <div className="flex-1" />
        <button className="px-3 py-1 border rounded bg-black text-white" onClick={openCreateModal}>新增指令</button>
      </div>

      {/* 隐藏 botId 展示，仅保留内部使用 */}

      <form onSubmit={onSubmit} className="border rounded p-4 mb-6">
        <h2 className="font-medium mb-3">新增 / 编辑文本内容</h2>
        <div className="grid gap-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">指令名称</label>
            <input className="w-full px-3 py-2 border rounded" placeholder="例如：小十地址" value={formName} onChange={e => setFormName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">文本内容</label>
            <textarea className="w-full px-3 py-2 border rounded min-h-[100px]" placeholder="这里是内容" value={formText} onChange={e => setFormText(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">图片 URL（可选）</label>
            <div className="flex gap-2 items-center">
              <input className="w-full px-3 py-2 border rounded" placeholder="https://.../image.png" value={formImageUrl} onChange={e => setFormImageUrl(e.target.value)} />
              <button type="button" className="px-3 py-2 rounded border" onClick={() => fileInputRef.current?.click()}>上传图片</button>
              <input ref={fileInputRef} className="hidden" type="file" accept="image/*" onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                try {
                  const fd = new FormData()
                  fd.append('file', f)
                  const r = await fetch('/api/uploads', { method: 'POST', body: fd })
                  const j = await r.json().catch(() => ({}))
                  if (!r.ok) throw new Error(j?.error || '上传失败')
                  setFormImageUrl(j.url || '')
                  toast({ title: '上传成功', description: '图片已上传' })
                } catch (err: any) {
                  toast({ title: '错误', description: err?.message || '上传失败', variant: 'destructive' })
                } finally {
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }
              }} />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 rounded bg-black text-white disabled:opacity-50" disabled={saving}>{saving ? '保存中...' : '保存'}</button>
            <button type="button" className="px-3 py-2 rounded border" onClick={() => { setFormName(''); setFormText('') }}>重置</button>
          </div>
        </div>
      </form>

      <div className="flex items-center justify-between mb-2">
        <h2 className="font-medium">指令列表</h2>
        <button className="px-3 py-1 border rounded" onClick={refresh} disabled={loading}>{loading ? '刷新中...' : '刷新'}</button>
      </div>
      {error && <div className="text-red-600 mb-2">{error}</div>}

      <div className="border rounded divide-y">
        {items.length === 0 && (
          <div className="p-4 text-gray-500">暂无数据</div>
        )}
        {items.map((it) => (
          <div key={it.name} className="p-4 grid gap-2">
            <div className="flex items-center justify-between">
              <div className="font-medium">{it.name}</div>
              <div className="text-xs text-gray-500">{it.updatedAt ? new Date(it.updatedAt).toLocaleString() : ''}</div>
            </div>
            {it.text && (
              <div className="whitespace-pre-wrap text-sm bg-gray-50 p-2 rounded border">{it.text}</div>
            )}
            {it.imageUrl && (
              <div className="flex items-center gap-3">
                <img src={it.imageUrl} alt={it.name} className="w-24 h-24 object-cover rounded border" />
                <a className="text-blue-600 underline break-all" href={it.imageUrl} target="_blank" rel="noreferrer">{it.imageUrl}</a>
              </div>
            )}
            <div className="flex gap-2 mt-2">
              <button className="px-3 py-1 border rounded" onClick={() => openEditModal(it)}>编辑</button>
              <button className="px-3 py-1 border rounded" onClick={() => setImage(it)}>设置图片</button>
              <button className="px-3 py-1 border rounded text-red-600" onClick={() => remove(it.name)}>删除</button>
            </div>
          </div>
        ))}
      </div>

      {/* 删除快速复制区域，保持页面简洁 */}

      {/* Modal for create/edit */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !modalSaving && setModalOpen(false)} />
          <div className="relative bg-white rounded-lg shadow-lg w-full max-w-lg p-5">
            <div className="text-lg font-medium mb-3">{modalMode === 'create' ? '新增指令' : '编辑指令'}</div>
            <form onSubmit={submitModal} className="grid gap-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">指令名称</label>
                <input className="w-full px-3 py-2 border rounded disabled:opacity-60" placeholder="例如：小十地址" value={modalName} onChange={e => setModalName(e.target.value)} disabled={modalMode === 'edit'} />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">文本内容</label>
                <textarea className="w-full px-3 py-2 border rounded min-h-[100px]" placeholder="这里是内容" value={modalText} onChange={e => setModalText(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">图片 URL（可选，留空表示不设置/清除）</label>
                <div className="flex gap-2 items-center">
                  <input className="w-full px-3 py-2 border rounded" placeholder="https://.../image.png" value={modalImageUrl} onChange={e => setModalImageUrl(e.target.value)} />
                  <button type="button" className="px-3 py-2 rounded border" onClick={() => (document.getElementById('modal-file') as HTMLInputElement)?.click()}>上传图片</button>
                  <input id="modal-file" className="hidden" type="file" accept="image/*" onChange={async (e) => {
                    const f = (e.target as HTMLInputElement).files?.[0]
                    if (!f) return
                    try {
                      const fd = new FormData()
                      fd.append('file', f)
                      const r = await fetch('/api/uploads', { method: 'POST', body: fd })
                      const j = await r.json().catch(() => ({}))
                      if (!r.ok) throw new Error(j?.error || '上传失败')
                      setModalImageUrl(j.url || '')
                      toast({ title: '上传成功', description: '图片已上传' })
                    } catch (err: any) {
                      toast({ title: '错误', description: err?.message || '上传失败', variant: 'destructive' })
                    } finally {
                      ;(document.getElementById('modal-file') as HTMLInputElement).value = ''
                    }
                  }} />
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <button type="button" className="px-3 py-2 rounded border" onClick={() => !modalSaving && setModalOpen(false)} disabled={modalSaving}>取消</button>
                <button type="submit" className="px-4 py-2 rounded bg-black text-white disabled:opacity-50" disabled={modalSaving}>{modalSaving ? '保存中...' : '保存'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

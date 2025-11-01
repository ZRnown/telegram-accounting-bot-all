"use client"

import { Fragment, Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { DashboardHeader } from "@/components/dashboard-header"
import { StatisticsCards } from "@/components/statistics-cards"
import { TransactionTables } from "@/components/transaction-tables"
import { CategoryStats } from "@/components/category-stats"

function DashboardPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [mounted, setMounted] = useState(false)
  const [currentDate, setCurrentDate] = useState(new Date())
  const chatId = (searchParams?.get("chatId") || "").trim()
  const [chatTitle, setChatTitle] = useState<string>("")
  const [groupsCount, setGroupsCount] = useState<number | null>(null)
  const [groups, setGroups] = useState<Array<{ id: string; title: string | null; status?: string; allowed?: boolean; createdAt: string; botId?: string | null; bot?: { name: string } }>>([])
  const [drafts, setDrafts] = useState<Record<string, { status: "PENDING" | "APPROVED" | "BLOCKED"; botId?: string | null; allowed: boolean }>>({})
  const [bots, setBots] = useState<Array<{ id: string; name: string; enabled?: boolean }>>([])
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [isAdmin, setIsAdmin] = useState<boolean>(false)
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})
  const [featureCache, setFeatureCache] = useState<Record<string, { items: Array<{ feature: string; enabled: boolean }>; loading?: boolean }>>({})
  const [featureSaving, setFeatureSaving] = useState<Record<string, boolean>>({})
  const [showCreateBot, setShowCreateBot] = useState<boolean>(false)
  const [createForm, setCreateForm] = useState<{ token: string; enabled: boolean }>({ token: "", enabled: true })
  const [introspect, setIntrospect] = useState<{ username?: string; first_name?: string; id?: number } | null>(null)
  const [broadcastDrafts, setBroadcastDrafts] = useState<Record<string, { open: boolean; message: string; sending?: boolean }>>({})
  const [manualAdd, setManualAdd] = useState<{ open: boolean; chatId: string; botId: string; saving?: boolean; error?: string }>({ open: false, chatId: '', botId: '' })
  const [batchSaving, setBatchSaving] = useState(false)
  
  // 白名单用户管理状态
  const [whitelistedUsers, setWhitelistedUsers] = useState<Array<{ id: string; userId: string; username: string | null; note: string | null; createdAt: string }>>([])
  const [whitelistLoading, setWhitelistLoading] = useState(false)
  const [whitelistForm, setWhitelistForm] = useState({ userId: '', note: '' })
  const [whitelistSaving, setWhitelistSaving] = useState(false)
  
  // 邀请记录状态
  const [inviteRecords, setInviteRecords] = useState<Array<{ id: string; chatId: string; chatTitle: string | null; inviterId: string; inviterUsername: string | null; autoAllowed: boolean; createdAt: string }>>([])
  const [inviteLoading, setInviteLoading] = useState(false)
  const [invitePage, setInvitePage] = useState(1)
  const [inviteTotal, setInviteTotal] = useState(0)

  const FEATURE_NAME_MAP: Record<string, string> = {
    accounting_basic: '基础记账',
  }

  useEffect(() => {
    setMounted(true)
    // Require auth only for admin homepage (no chatId)
    const token = localStorage.getItem("auth_token")
    setIsAdmin(!!token)
    if (!chatId && !token) {
      router.push("/")
    }
    // 加载白名单和邀请记录
    if (!chatId && token) {
      loadWhitelistedUsers()
      loadInviteRecords()
    }
  }, [router, chatId])
  
  // 加载白名单用户
  const loadWhitelistedUsers = async () => {
    setWhitelistLoading(true)
    try {
      const res = await fetch('/api/whitelisted-users')
      if (res.ok) {
        const json = await res.json()
        setWhitelistedUsers(Array.isArray(json.items) ? json.items : [])
      }
    } catch (e) {
      console.error('加载白名单失败', e)
    } finally {
      setWhitelistLoading(false)
    }
  }
  
  // 移除自动填充功能（用户名将在添加后自动显示在表格中）
  
  // 添加白名单用户
  const addWhitelistedUser = async () => {
    if (!whitelistForm.userId.trim()) {
      alert('请输入用户ID')
      return
    }
    setWhitelistSaving(true)
    try {
      const res = await fetch('/api/whitelisted-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(whitelistForm)
      })
      if (res.ok) {
        await loadWhitelistedUsers()
        setWhitelistForm({ userId: '', note: '' })
        alert('添加成功！用户名已自动获取并显示在表格中。')
      } else {
        const json = await res.json()
        alert(json.error || '添加失败')
      }
    } catch (e) {
      alert('添加失败')
    } finally {
      setWhitelistSaving(false)
    }
  }
  
  // 删除白名单用户
  const removeWhitelistedUser = async (userId: string) => {
    if (!confirm('确定要删除这个白名单用户吗？')) return
    try {
      const res = await fetch('/api/whitelisted-users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      })
      if (res.ok) {
        await loadWhitelistedUsers()
        alert('删除成功')
      } else {
        alert('删除失败')
      }
    } catch (e) {
      alert('删除失败')
    }
  }
  
  // 加载邀请记录
  const loadInviteRecords = async (page = 1) => {
    setInviteLoading(true)
    try {
      const res = await fetch(`/api/invite-records?page=${page}&size=20`)
      if (res.ok) {
        const json = await res.json()
        setInviteRecords(Array.isArray(json.items) ? json.items : [])
        setInviteTotal(json.total || 0)
        setInvitePage(page)
      }
    } catch (e) {
      console.error('加载邀请记录失败', e)
    } finally {
      setInviteLoading(false)
    }
  }
  
  // 删除邀请记录
  const deleteInviteRecord = async (id: string) => {
    if (!confirm('确定要删除这条邀请记录吗？')) return
    try {
      const res = await fetch('/api/invite-records', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      })
      if (res.ok) {
        await loadInviteRecords(invitePage)
        alert('删除成功')
      } else {
        alert('删除失败')
      }
    } catch (e) {
      alert('删除失败')
    }
  }

  // 仅展示"已在该群内的机器人"
  const [eligibleBots, setEligibleBots] = useState<Record<string, Array<{ id: string; name: string }>>>({})
  useEffect(() => {
    // 当 groups 列表变化时，并行加载所有群组的可绑定机器人（已加入该群）
    (async () => {
      if (!Array.isArray(groups) || groups.length === 0) return
      
      // 过滤出尚未加载的群组
      const groupsToLoad = groups.filter(g => !eligibleBots[g.id])
      if (groupsToLoad.length === 0) return
      
      // 并行加载所有群组的 eligibleBots，大幅提升性能
      const results = await Promise.allSettled(
        groupsToLoad.map(async (g) => {
          const cid = g.id
          try {
            const res = await fetch(`/api/chats/${encodeURIComponent(cid)}/eligible-bots`)
            if (!res.ok) return { cid, items: [] }
            const json = await res.json().catch(() => ({}))
            const items = Array.isArray(json?.items) ? json.items : []
            return { cid, items }
          } catch (e) {
            console.error(`[eligible-bots] chat=${cid}`, e)
            return { cid, items: [] }
          }
        })
      )
      
      // 一次性更新所有结果，避免多次渲染
      const newEligibleBots: Record<string, Array<{ id: string; name: string }>> = {}
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
          newEligibleBots[result.value.cid] = result.value.items
        }
      })
      
      if (Object.keys(newEligibleBots).length > 0) {
        setEligibleBots((m) => ({ ...m, ...newEligibleBots }))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(groups)])

  // 本地缓存机制 - 缓存群组和机器人数据5分钟
  const CACHE_KEY_BOTS = 'dashboard_cache_bots'
  const CACHE_KEY_GROUPS = 'dashboard_cache_groups'
  const CACHE_TTL = 5 * 60 * 1000 // 5分钟

  const getCachedData = (key: string) => {
    if (typeof window === 'undefined') return null
    try {
      const cached = localStorage.getItem(key)
      if (!cached) return null
      const { data, timestamp } = JSON.parse(cached)
      if (Date.now() - timestamp > CACHE_TTL) {
        localStorage.removeItem(key)
        return null
      }
      return data
    } catch {
      return null
    }
  }

  const setCachedData = (key: string, data: any) => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }))
    } catch {}
  }

  // load chat title if chatId present; otherwise load bots and group list for empty state
  useEffect(() => {
    if (!mounted) return
    const load = async () => {
      try {
        if (chatId) {
          const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/settings`)
          if (res.ok) {
            const json = await res.json()
            setChatTitle(json?.chat?.title || "")
          }
        } else {
          // 尝试从缓存加载
          const cachedBots = getCachedData(CACHE_KEY_BOTS)
          const cachedGroups = getCachedData(CACHE_KEY_GROUPS)

          if (cachedBots && cachedGroups) {
            // 使用缓存数据
            setBots(cachedBots)
            setGroups(cachedGroups)
            setGroupsCount(cachedGroups.length)
            const d: Record<string, { status: "PENDING" | "APPROVED" | "BLOCKED"; botId?: string | null; allowed: boolean }> = {}
            for (const it of cachedGroups) {
              const status = (it.status as any) || (it.allowed ? 'APPROVED' : 'PENDING')
              const allowed = status === 'APPROVED'
              d[it.id] = { status, botId: it.botId ?? null, allowed }
            }
            setDrafts(d)
            // 后台异步刷新缓存
            setTimeout(() => {
              Promise.all([fetch('/api/bots'), fetch('/api/chats')]).then(async ([botsRes, chatsRes]) => {
                if (botsRes.ok && chatsRes.ok) {
                  const botsData = await botsRes.json()
                  const chatsData = await chatsRes.json()
                  const botsItems = Array.isArray(botsData?.items) ? botsData.items : []
                  const chatsItems = (Array.isArray(chatsData?.items) ? chatsData.items : []).filter((it: any) => String(it.id || '').startsWith('-'))
                  const newBots = botsItems.map((b: any) => ({ id: b.id, name: b.name, enabled: !!b.enabled }))
                  setCachedData(CACHE_KEY_BOTS, newBots)
                  setCachedData(CACHE_KEY_GROUPS, chatsItems)
                }
              }).catch(() => {})
            }, 100)
          } else {
            // 没有缓存，正常加载
            const botsRes = await fetch('/api/bots')
            if (botsRes.ok) {
              const data = await botsRes.json()
              const items = Array.isArray(data?.items) ? data.items : []
              const botsData = items.map((b: any) => ({ id: b.id, name: b.name, enabled: !!b.enabled }))
              setBots(botsData)
              setCachedData(CACHE_KEY_BOTS, botsData)
            }
            const res = await fetch('/api/chats')
            if (res.ok) {
              const json = await res.json()
              const items = (Array.isArray(json?.items) ? json.items : []).filter((it: any) => String(it.id || '').startsWith('-'))
              setGroups(items)
              setGroupsCount(items.length)
              setCachedData(CACHE_KEY_GROUPS, items)
              const d: Record<string, { status: "PENDING" | "APPROVED" | "BLOCKED"; botId?: string | null; allowed: boolean }> = {}
              for (const it of items) {
                const status = (it.status as any) || (it.allowed ? 'APPROVED' : 'PENDING')
                const allowed = status === 'APPROVED'
                d[it.id] = { status, botId: it.botId ?? null, allowed }
              }
              setDrafts(d)
            }
          }
        }
      } catch {}
    }
    load()
  }, [mounted, chatId])

  if (!mounted) {
    return null
  }

  const handlePreviousDay = () => {
    const newDate = new Date(currentDate)
    newDate.setDate(newDate.getDate() - 1)
    setCurrentDate(newDate)
  }

  const handleNextDay = () => {
    const newDate = new Date(currentDate)
    newDate.setDate(newDate.getDate() + 1)
    setCurrentDate(newDate)
  }

  const handleDateChange = (date: Date) => {
    setCurrentDate(date)
  }

  const handleViewSummary = () => {
    if (chatId) {
      router.push(`/summary?chatId=${encodeURIComponent(chatId)}`)
    } else {
      router.push("/summary")
    }
  }

  const handleLogout = () => {
    localStorage.removeItem("auth_token")
    router.push("/")
  }

  const showCompact = !chatId

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <DashboardHeader
          currentDate={currentDate}
          onPreviousDay={handlePreviousDay}
          onNextDay={handleNextDay}
          onViewSummary={handleViewSummary}
          onLogout={handleLogout}
          onDateChange={handleDateChange}
          chatId={chatId}
          chatTitle={chatTitle}
          compact={showCompact}
          hideLogout={!!chatId}
          hideGroupButton={!!chatId}
          showBackHome={!!chatId && isAdmin}
          isAdmin={isAdmin}
        />

        {showCompact ? (
          <div className="mt-6 space-y-6">
            {/* 白名单用户管理 */}
            <div className="bg-white border rounded-lg p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="text-lg font-semibold text-slate-900">🔐 白名单用户管理</div>
                  <div className="text-sm text-slate-600 mt-1">
                    白名单中的用户邀请机器人进群后，该群将自动被授权使用（无需手动批准）
                  </div>
                </div>
              </div>

              {/* 添加白名单用户表单 */}
              <div className="bg-slate-50 rounded-lg p-4 mb-4">
                <div className="text-sm font-medium text-slate-700 mb-3">添加白名单用户</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">用户ID（必填）*</label>
                    <input
                      type="text"
                      className="w-full border rounded px-3 py-2 text-sm"
                      placeholder="例如：123456789"
                      value={whitelistForm.userId}
                      onChange={(e) => setWhitelistForm(f => ({ ...f, userId: e.target.value }))}
                    />
                    <p className="text-xs text-slate-500 mt-1">💡 Telegram用户的数字ID（添加后用户名会自动显示在表格中）</p>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">备注（可选）</label>
                    <input
                      type="text"
                      className="w-full border rounded px-3 py-2 text-sm"
                      placeholder="例如：张三-运营"
                      value={whitelistForm.note}
                      onChange={(e) => setWhitelistForm(f => ({ ...f, note: e.target.value }))}
                    />
                    <p className="text-xs text-slate-500 mt-1">💡 额外说明信息</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
                    onClick={addWhitelistedUser}
                    disabled={whitelistSaving || !whitelistForm.userId.trim()}
                  >
                    {whitelistSaving ? '添加中...' : '➕ 添加到白名单'}
                  </button>
                </div>
              </div>

              {/* 白名单用户列表 */}
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left py-3 px-4 text-slate-600 font-medium">用户ID</th>
                      <th className="text-left py-3 px-4 text-slate-600 font-medium">用户名</th>
                      <th className="text-left py-3 px-4 text-slate-600 font-medium">备注</th>
                      <th className="text-left py-3 px-4 text-slate-600 font-medium">添加时间</th>
                      <th className="text-right py-3 px-4 text-slate-600 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {whitelistLoading ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-slate-500">
                          加载中...
                        </td>
                      </tr>
                    ) : whitelistedUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-slate-500">
                          暂无白名单用户，添加后该用户邀请机器人进群将自动授权
                        </td>
                      </tr>
                    ) : (
                      whitelistedUsers.map((user) => (
                        <tr key={user.id} className="border-b hover:bg-slate-50">
                          <td className="py-3 px-4 font-mono text-xs">{user.userId}</td>
                          <td className="py-3 px-4">{user.username || '-'}</td>
                          <td className="py-3 px-4">{user.note || '-'}</td>
                          <td className="py-3 px-4 text-slate-600">
                            {new Date(user.createdAt).toLocaleString('zh-CN')}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              className="px-3 py-1 text-xs border rounded hover:bg-red-50 hover:border-red-300 hover:text-red-600"
                              onClick={() => removeWhitelistedUser(user.userId)}
                            >
                              删除
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* 邀请记录 */}
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium text-slate-700">📋 最近邀请记录</div>
                  <button
                    className="text-xs px-2 py-1 border rounded hover:bg-slate-50"
                    onClick={() => loadInviteRecords(invitePage)}
                    disabled={inviteLoading}
                  >
                    {inviteLoading ? '刷新中...' : '刷新'}
                  </button>
                </div>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="text-left py-2 px-3 text-slate-600">群组</th>
                        <th className="text-left py-2 px-3 text-slate-600">邀请人ID</th>
                        <th className="text-left py-2 px-3 text-slate-600">邀请人用户名</th>
                        <th className="text-center py-2 px-3 text-slate-600">自动授权</th>
                        <th className="text-left py-2 px-3 text-slate-600">时间</th>
                        <th className="text-right py-2 px-3 text-slate-600">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inviteLoading ? (
                        <tr>
                          <td colSpan={6} className="text-center py-6 text-slate-500">
                            加载中...
                          </td>
                        </tr>
                      ) : inviteRecords.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center py-6 text-slate-500">
                            暂无邀请记录
                          </td>
                        </tr>
                      ) : (
                        inviteRecords.map((record) => (
                          <tr key={record.id} className="border-b hover:bg-slate-50">
                            <td className="py-2 px-3">{record.chatTitle || record.chatId}</td>
                            <td className="py-2 px-3 font-mono">{record.inviterId}</td>
                            <td className="py-2 px-3">{record.inviterUsername || '-'}</td>
                            <td className="py-2 px-3 text-center">
                              {record.autoAllowed ? (
                                <span className="inline-block px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                                  ✓ 已授权
                                </span>
                              ) : (
                                <span className="inline-block px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs">
                                  待审核
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-slate-600">
                              {new Date(record.createdAt).toLocaleString('zh-CN')}
                            </td>
                            <td className="py-2 px-3 text-right">
                              <button
                                className="px-2 py-1 text-xs border rounded hover:bg-red-50 hover:border-red-300 hover:text-red-600"
                                onClick={() => deleteInviteRecord(record.id)}
                              >
                                删除
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {inviteTotal > 20 && (
                  <div className="flex items-center justify-between mt-3 text-xs text-slate-600">
                    <button
                      className="px-3 py-1 border rounded hover:bg-slate-50 disabled:opacity-50"
                      onClick={() => loadInviteRecords(invitePage - 1)}
                      disabled={invitePage <= 1 || inviteLoading}
                    >
                      上一页
                    </button>
                    <span>第 {invitePage} 页 / 共 {Math.ceil(inviteTotal / 20)} 页</span>
                    <button
                      className="px-3 py-1 border rounded hover:bg-slate-50 disabled:opacity-50"
                      onClick={() => loadInviteRecords(invitePage + 1)}
                      disabled={invitePage * 20 >= inviteTotal || inviteLoading}
                    >
                      下一页
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 机器人概览 */}
            <div className="bg-white border rounded-lg p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="text-lg font-semibold text-slate-900">机器人管理</div>
                  <div className="text-sm text-slate-600 mt-1">全部机器人集中展示，可在此启用/停用。</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="px-3 py-1.5 text-sm border rounded-md hover:bg-slate-50"
                    onClick={() => setShowCreateBot((v) => !v)}
                  >{showCreateBot ? '收起创建' : '创建新机器人'}</button>
                </div>
              </div>

            {manualAdd.open && (
              <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg shadow-lg p-5 w-full max-w-md">
                  <div className="text-lg font-semibold mb-3">手动添加群</div>
                  <div className="space-y-3">
                    <div className="text-sm text-slate-600">请输入 Chat ID 与要绑定的机器人。</div>
                    <input
                      className="w-full border rounded px-2 py-1 text-sm"
                      placeholder="Chat ID，如 -1001234567890"
                      value={manualAdd.chatId}
                      onChange={(e) => setManualAdd((m) => ({ ...m, chatId: e.target.value }))}
                    />
                    <select
                      className="w-full border rounded px-2 py-1 text-sm"
                      value={manualAdd.botId}
                      onChange={(e) => setManualAdd((m) => ({ ...m, botId: e.target.value }))}
                    >
                      <option value="">选择机器人</option>
                      {bots.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                    {manualAdd.error && <div className="text-xs text-red-600">{manualAdd.error}</div>}
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      className="px-3 py-1.5 text-sm border rounded-md hover:bg-slate-50"
                      onClick={() => setManualAdd({ open: false, chatId: '', botId: '' })}
                    >取消</button>
                    <button
                      className="px-3 py-1.5 text-sm border rounded-md hover:bg-slate-50 disabled:opacity-50"
                      disabled={!manualAdd.chatId.trim() || !manualAdd.botId || manualAdd.saving}
                      onClick={async () => {
                        const chatId = manualAdd.chatId.trim()
                        const botId = manualAdd.botId
                        setManualAdd((m) => ({ ...m, saving: true, error: '' }))
                        try {
                          const res = await fetch('/api/chats/manual-add', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId, botId })
                          })
                          if (!res.ok) {
                            const msg = await res.text().catch(() => '')
                            throw new Error(msg || '添加失败')
                          }
                          // 重新加载群列表
                          const gl = await fetch('/api/chats')
                          if (gl.ok) {
                            const j = await gl.json().catch(() => ({}))
                            const items = Array.isArray(j?.items) ? j.items : []
                            setGroups(items)
                            setGroupsCount(items.length)
                          }
                          setManualAdd({ open: false, chatId: '', botId: '' })
                        } catch (e) {
                          setManualAdd((m) => ({ ...m, saving: false, error: (e as Error).message }))
                        } finally {
                          setManualAdd((m) => ({ ...m, saving: false }))
                        }
                      }}
                    >{manualAdd.saving ? '添加中...' : '确定添加'}</button>
                  </div>
                </div>
              </div>
            )}

              {showCreateBot && (
                <div className="border rounded-md p-4 mb-4 space-y-3">
                  <div className="flex gap-2">
                    <input
                      className="border rounded px-2 py-1 text-sm flex-1"
                      placeholder="机器人 Token"
                      value={createForm.token}
                      onChange={(e) => { setCreateForm(f => ({ ...f, token: e.target.value })); setIntrospect(null) }}
                    />
                    <button
                      className="px-3 py-1.5 text-sm border rounded-md hover:bg-slate-50"
                      onClick={async () => {
                        if (!createForm.token) { alert('请先填写 Token'); return }
                        try {
                          const res = await fetch('/api/bots/introspect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: createForm.token }) })
                          if (res.ok) {
                            const me = await res.json()
                            setIntrospect(me)
                          } else {
                            const msg = await res.json().catch(() => ({}))
                            alert(`识别失败：${msg?.error || '请检查 Token'}`)
                          }
                        } catch {
                          alert('识别失败，请检查网络')
                        }
                      }}
                    >识别</button>
                  </div>
                  <div className="text-xs text-slate-500">识别成功后将自动使用 @username 作为名称。</div>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={createForm.enabled} onChange={(e) => setCreateForm(f => ({ ...f, enabled: e.target.checked }))} />
                    <span>创建后立即启用</span>
                  </label>
                  {introspect && (
                    <div className="text-xs text-slate-500">识别成功：{introspect.username ? `@${introspect.username}` : introspect.first_name}（ID: {introspect.id}）</div>
                  )}
                  <div>
                    <button
                      className="px-3 py-1.5 text-sm border rounded-md hover:bg-slate-50 disabled:opacity-50"
                      disabled={!introspect}
                      onClick={async () => {
                        if (!createForm.token || !introspect) { alert('请先识别 Token'); return }
                        const name = introspect.username ? `@${introspect.username}` : (introspect.first_name || '新机器人')
                        const payload = { name, token: createForm.token, enabled: createForm.enabled }
                        const res = await fetch('/api/bots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
                        if (res.ok) {
                          try {
                            const botsRes2 = await fetch('/api/bots')
                            if (botsRes2.ok) {
                              const data2 = await botsRes2.json()
                              const items2 = Array.isArray(data2?.items) ? data2.items : []
                              setBots(items2.map((x: any) => ({ id: x.id, name: x.name, enabled: !!x.enabled })))
                            }
                          } catch {}
                          setCreateForm({ token: '', enabled: true })
                          setIntrospect(null)
                          setShowCreateBot(false)
                        } else {
                          alert('创建失败')
                        }
                      }}
                    >创建</button>
                  </div>
                </div>
              )}

              {bots.length === 0 ? (
                <div className="text-sm text-slate-500">暂无机器人，请先创建。</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {bots.map((bot) => (
                    <div key={bot.id} className="border rounded-md p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-slate-900">{bot.name}</div>
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={!!bot.enabled}
                            onChange={async (e) => {
                              const enabled = e.target.checked
                              const res = await fetch(`/api/bots/${encodeURIComponent(bot.id)}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ enabled })
                              })
                              if (res.ok) {
                                setBots((prev) => prev.map((b) => b.id === bot.id ? { ...b, enabled } : b))
                              } else {
                                alert('更新启用状态失败')
                              }
                            }}
                          />
                          <span>{bot.enabled ? '已启用' : '未启用'}</span>
                        </label>
                      </div>
                      <div className="text-xs text-slate-500">ID: {bot.id.slice(0, 8)}…</div>
                      <div className="flex items-center gap-2">
                        <button
                          className="px-3 py-1.5 text-xs border rounded-md hover:bg-slate-50"
                          onClick={() => {
                            setBroadcastDrafts((prev) => {
                              const current = prev[bot.id] || { open: false, message: '' }
                              return {
                                ...prev,
                                [bot.id]: { open: !current.open, message: current.message, sending: false },
                              }
                            })
                          }}
                        >{broadcastDrafts[bot.id]?.open ? '收起群发' : '群发通知'}</button>
                        <button
                          className="px-3 py-1.5 text-xs border rounded-md hover:bg-red-50 text-red-600"
                          onClick={async () => {
                            if (!confirm('确认删除该机器人？此操作不可恢复')) return
                            try {
                              const res = await fetch(`/api/bots/${encodeURIComponent(bot.id)}`, { method: 'DELETE' })
                              if (res.status === 204) {
                                setBots((prev) => prev.filter((b) => b.id !== bot.id))
                              } else {
                                const msg = await res.text().catch(() => '')
                                alert(`删除失败：${msg || 'Server error'}`)
                              }
                            } catch {
                              alert('删除失败：网络错误')
                            }
                          }}
                        >删除机器人</button>
                      </div>
                      {broadcastDrafts[bot.id]?.open && (
                        <div className="space-y-2 text-sm">
                          <textarea
                            className="w-full border rounded-md px-2 py-1 text-sm min-h-[80px]"
                            placeholder="在此输入要发送至所有绑定群组的公告"
                            value={broadcastDrafts[bot.id]?.message || ''}
                            onChange={(e) => {
                              const value = e.target.value
                              setBroadcastDrafts((prev) => ({
                                ...prev,
                                [bot.id]: { ...(prev[bot.id] || { open: true, sending: false }), open: true, message: value },
                              }))
                            }}
                          />
                          <div className="flex justify-end gap-3">
                            <button
                              className="px-3 py-1.5 text-xs border rounded-md hover:bg-slate-50"
                              onClick={() => setBroadcastDrafts((prev) => ({ ...prev, [bot.id]: { open: false, message: '', sending: false } }))}
                            >取消</button>
                            <button
                              className="px-3 py-1.5 text-xs border rounded-md hover:bg-slate-50 disabled:opacity-50"
                              disabled={!broadcastDrafts[bot.id]?.message?.trim() || broadcastDrafts[bot.id]?.sending}
                              onClick={async () => {
                                const current = broadcastDrafts[bot.id]
                                if (!current?.message?.trim()) return
                                setBroadcastDrafts((prev) => ({ ...prev, [bot.id]: { ...current, sending: true } }))
                                try {
                                  const res = await fetch(`/api/bots/${encodeURIComponent(bot.id)}/broadcast`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ message: current.message }),
                                  })
                                  if (res.ok) {
                                    const json = await res.json().catch(() => null)
                                    alert(`已发送：${json?.sent ?? 0} / ${json?.total ?? 0}`)
                                    setBroadcastDrafts((prev) => ({ ...prev, [bot.id]: { open: false, message: '', sending: false } }))
                                  } else {
                                    const err = await res.json().catch(() => ({}))
                                    alert(`发送失败：${err?.error || '请检查网络'}`)
                                    setBroadcastDrafts((prev) => ({ ...prev, [bot.id]: { ...current, sending: false } }))
                                  }
                                } catch (e) {
                                  alert('发送失败：网络错误')
                                  setBroadcastDrafts((prev) => ({ ...prev, [bot.id]: { ...current, sending: false } }))
                                }
                              }}
                            >{broadcastDrafts[bot.id]?.sending ? '发送中...' : '发送群发'}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 群组管理卡片 */}
            <div className="bg-white border rounded-lg p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="text-lg font-semibold text-slate-900">群组管理</div>
                  <div className="text-sm text-slate-600 mt-1">{groupsCount === 0 ? '暂无群组' : (groupsCount == null ? '加载中...' : `共 ${groupsCount} 个群组`)}</div>
                </div>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1.5 text-sm border rounded-md hover:bg-blue-50 text-blue-600 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={batchSaving || groups.length === 0}
                    onClick={async () => {
                      if (!confirm(`确认保存所有 ${groups.length} 个群组的设置？`)) return
                      setBatchSaving(true)
                      let successCount = 0
                      let failCount = 0
                      
                      for (const it of groups) {
                        const latest = drafts[it.id]
                        if (!latest) continue
                        
                        try {
                          const res = await fetch(`/api/chats/${encodeURIComponent(it.id)}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              status: latest.status,
                              botId: latest.botId ?? null,
                              allowed: latest.allowed,
                            }),
                          })
                          if (res.ok) {
                            successCount++
                          } else {
                            failCount++
                          }
                        } catch {
                          failCount++
                        }
                      }
                      
                      setBatchSaving(false)
                      alert(`批量保存完成！\n成功：${successCount} 个\n失败：${failCount} 个`)
                      
                      // 清除缓存，重新加载
                      if (typeof window !== 'undefined') {
                        localStorage.removeItem('dashboard_cache_groups')
                        localStorage.removeItem('dashboard_cache_bots')
                      }
                      window.location.reload()
                    }}
                  >{batchSaving ? '批量保存中...' : '💾 一键保存全部'}</button>
                  <button
                    className="px-3 py-1.5 text-sm border rounded-md hover:bg-slate-50"
                    onClick={() => setManualAdd({ open: true, chatId: '', botId: '' })}
                  >手动添加群</button>
                </div>
              </div>

              {groupsCount === 0 ? (
                <div className="text-center text-slate-500 text-sm py-6">暂无群组</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse">
                    <thead className="bg-slate-50">
                      <tr className="border-b-2 border-slate-200">
                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Chat ID</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">群组名称</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">绑定机器人</th>
                        <th className="text-center py-3 px-4 text-sm font-semibold text-slate-700">允许使用</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">创建时间</th>
                        <th className="text-center py-3 px-4 text-sm font-semibold text-slate-700">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((it, idx) => {
                        const draft = drafts[it.id] || { status: 'PENDING', botId: it.botId ?? null, allowed: !!it.allowed }
                        return (
                          <Fragment key={it.id}>
                            <tr className={`border-b hover:bg-slate-50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-25'}`}>
                              <td className="py-3 px-4 text-sm text-slate-900 font-mono">{it.id}</td>
                              <td className="py-3 px-4 text-sm text-slate-900 font-medium">{it.title || '-'}</td>
                              <td className="py-3 px-4">
                                <select
                                  className="border rounded-md px-3 py-1.5 text-sm w-full max-w-[200px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                  value={draft.botId || ''}
                                  onChange={(e) => {
                                    const value = e.target.value || null
                                    setDrafts((d) => ({
                                      ...d,
                                      [it.id]: {
                                        status: (d[it.id]?.status || draft.status) as typeof draft.status,
                                        botId: value,
                                        allowed: d[it.id]?.allowed ?? draft.allowed,
                                      },
                                    }))
                                  }}
                                >
                                  <option value="">未绑定</option>
                                  {(eligibleBots[it.id] || []).map((b) => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-3 px-4 text-center">
                                <label className="inline-flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                    checked={draft.allowed}
                                    onChange={(e) => {
                                      const allowed = e.target.checked
                                      const status = allowed ? 'APPROVED' : 'PENDING'
                                      setDrafts((d) => ({
                                        ...d,
                                        [it.id]: {
                                          status,
                                          allowed,
                                          botId: (d[it.id]?.botId ?? draft.botId) ?? null,
                                        },
                                      }))
                                    }}
                                  />
                                  <span className={`text-xs font-medium ${draft.allowed ? 'text-green-600' : 'text-slate-500'}`}>
                                    {draft.allowed ? '✓ 已允许' : '✗ 未允许'}
                                  </span>
                                </label>
                              </td>
                              <td className="py-3 px-4 text-sm text-slate-600">{new Date(it.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                              <td className="py-3 px-4">
                                <div className="flex items-center justify-center gap-1.5 flex-wrap">
                                  <button
                                    className="px-2.5 py-1 text-xs border rounded hover:bg-slate-50 whitespace-nowrap"
                                    onClick={() => router.push(`/dashboard?chatId=${encodeURIComponent(it.id)}`)}
                                  >📊 账单</button>
                                  <button
                                    className="px-2.5 py-1 text-xs border rounded hover:bg-slate-50 whitespace-nowrap"
                                    onClick={async () => {
                                      setExpandedRows((r) => ({ ...r, [it.id]: !r[it.id] }))
                                      const chatId = it.id
                                      if (!expandedRows[it.id] && !featureCache[chatId]) {
                                        setFeatureCache((c) => ({ ...c, [chatId]: { items: [], loading: true } }))
                                        try {
                                          const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/features`)
                                          if (res.ok) {
                                            const json = await res.json()
                                            const items = Array.isArray(json?.items) ? json.items : []
                                            setFeatureCache((c) => ({ ...c, [chatId]: { items } }))
                                          } else {
                                            setFeatureCache((c) => ({ ...c, [chatId]: { items: [] } }))
                                          }
                                        } catch {
                                          setFeatureCache((c) => ({ ...c, [chatId]: { items: [] } }))
                                        }
                                      }
                                    }}
                                  >{expandedRows[it.id] ? '⬆️ 收起' : '⚙️ 功能'}</button>
                                  <button
                                    className="px-2.5 py-1 text-xs border rounded hover:bg-slate-50 whitespace-nowrap"
                                    onClick={() => router.push(`/chats/${encodeURIComponent(it.id)}?chatId=${encodeURIComponent(it.id)}`)}
                                  >🔧 设置</button>
                                  <button
                                    className="px-2.5 py-1 text-xs border rounded hover:bg-green-50 text-green-700 font-medium whitespace-nowrap disabled:opacity-50"
                                    disabled={!!saving[it.id]}
                                    onClick={async () => {
                                      const latest = drafts[it.id]
                                      if (!latest) return
                                      setSaving((s) => ({ ...s, [it.id]: true }))
                                      try {
                                        const res = await fetch(`/api/chats/${encodeURIComponent(it.id)}`, {
                                          method: 'PATCH',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({
                                            status: latest.status,
                                            botId: latest.botId ?? null,
                                            allowed: latest.allowed,
                                          }),
                                        })
                                        if (!res.ok) {
                                          const msg = await res.text().catch(() => '')
                                          throw new Error(msg || 'save failed')
                                        }
                                        alert('✅ 保存成功')
                                      } catch (e) {
                                        alert(`❌ 保存失败：${(e as Error).message}`)
                                      } finally {
                                        setSaving((s) => ({ ...s, [it.id]: false }))
                                      }
                                    }}
                                  >{saving[it.id] ? '⏳' : '💾'}</button>
                                  <button
                                    className="px-2.5 py-1 text-xs border rounded hover:bg-red-50 text-red-600 whitespace-nowrap"
                                    onClick={async () => {
                                      if (!confirm('确认删除该群组及其相关数据？此操作不可恢复')) return
                                      try {
                                        const res = await fetch(`/api/chats/${encodeURIComponent(it.id)}`, { method: 'DELETE' })
                                        if (res.status === 204) {
                                          setGroups((prev) => prev.filter((g) => g.id !== it.id))
                                          const n = (groupsCount || 0) - 1
                                          setGroupsCount(n < 0 ? 0 : n)
                                          alert('✅ 删除成功')
                                        } else {
                                          const msg = await res.text().catch(() => '')
                                          alert(`❌ 删除失败：${msg || 'Server error'}`)
                                        }
                                      } catch {
                                        alert('❌ 删除失败：网络错误')
                                      }
                                    }}
                                  >🗑️</button>
                                </div>
                              </td>
                            </tr>
                            {expandedRows[it.id] && (
                              <tr>
                                <td colSpan={6} className="bg-slate-50 p-3">
                                  <div>
                                    <div className="text-sm text-slate-700 mb-2">功能开关（群组 {it.title || it.id}）</div>
                                    <div className="flex flex-wrap gap-4 items-center">
                                      {((featureCache[it.id]?.items) || []).map((f, idx) => (
                                        <label key={f.feature + idx} className="inline-flex items-center gap-2 text-sm">
                                          <input
                                            type="checkbox"
                                            checked={!!f.enabled}
                                            onChange={(e) => {
                                              const enabled = e.target.checked
                                              const chatId = it.id
                                              setFeatureCache((c) => ({
                                                ...c,
                                                [chatId]: { items: (c[chatId]?.items || []).map(x => x.feature === f.feature ? { ...x, enabled } : x) },
                                              }))
                                            }}
                                          />
                                          <span>{FEATURE_NAME_MAP[f.feature] || f.feature}</span>
                                        </label>
                                      ))}
                                      <button
                                        className="px-3 py-1.5 text-sm border rounded-md hover:bg-slate-50 disabled:opacity-50"
                                        disabled={featureSaving[it.id]}
                                        onClick={async () => {
                                          const chatId = it.id
                                          const payload = { features: (featureCache[chatId]?.items || []) }
                                          setFeatureSaving((s) => ({ ...s, [chatId]: true }))
                                          try {
                                            const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/features`, {
                                              method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
                                            })
                                            if (!res.ok) {
                                              const msg = await res.text().catch(() => '')
                                              throw new Error(msg || '保存功能开关失败')
                                            }
                                            // reload features back to cache
                                            const fres = await fetch(`/api/chats/${encodeURIComponent(chatId)}/features`)
                                            if (fres.ok) {
                                              const json = await fres.json().catch(() => ({}))
                                              const items = Array.isArray(json?.items) ? json.items : []
                                              setFeatureCache((c) => ({ ...c, [chatId]: { items } }))
                                            }
                                            alert('已保存功能开关')
                                          } catch (e) {
                                            alert((e as Error).message)
                                          } finally {
                                            setFeatureSaving((s) => ({ ...s, [chatId]: false }))
                                          }
                                        }}
                                      >{featureSaving[it.id] ? '保存中...' : '保存功能'}</button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6 mt-6">
            <StatisticsCards currentDate={currentDate} chatId={chatId} />
            <TransactionTables currentDate={currentDate} chatId={chatId} />
            <CategoryStats currentDate={currentDate} chatId={chatId} />
          </div>
        )}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-500">加载中...</div>}>
      <DashboardPageInner />
    </Suspense>
  )
}

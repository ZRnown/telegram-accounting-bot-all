"use client"

import { Fragment, Suspense, useEffect, useState, useMemo, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { DashboardHeader } from "@/components/dashboard-header"
import { StatisticsCards } from "@/components/statistics-cards"
import { TransactionTables } from "@/components/transaction-tables"
import { CategoryStats } from "@/components/category-stats"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

function DashboardPageInner() {
  const { toast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [mounted, setMounted] = useState(false)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [dateInitialized, setDateInitialized] = useState(false)
  const chatId = (searchParams?.get("chatId") || "").trim()
  const [billData, setBillData] = useState<{ billStartTime?: string; billEndTime?: string } | null>(null) // 🔥 累计模式账单时间数据
  const [chatTitle, setChatTitle] = useState<string>("")
  const [groupsCount, setGroupsCount] = useState<number | null>(null)
  const [groups, setGroups] = useState<Array<{ id: string; title: string | null; status?: string; allowed?: boolean; createdAt: string; botId?: string | null; invitedBy?: string | null; invitedByUsername?: string | null; bot?: { name: string } }>>([])
  const [inviterFilter, setInviterFilter] = useState<string>('全部') // 🔥 新增：邀请人筛选
  const [drafts, setDrafts] = useState<Record<string, { status: "PENDING" | "APPROVED" | "BLOCKED"; botId?: string | null; allowed: boolean }>>({})
  const [bots, setBots] = useState<Array<{ id: string; name: string; enabled?: boolean; realName?: string | null }>>([])
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [isAdmin, setIsAdmin] = useState<boolean>(false)
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})
  const [featureCache, setFeatureCache] = useState<Record<string, { items: Array<{ feature: string; enabled: boolean }>; loading?: boolean }>>({})
  const [featureSaving, setFeatureSaving] = useState<Record<string, boolean>>({})
  // 🔥 快捷设置缓存（地址验证、删除账单确认、计算器）
  const [quickSettingsCache, setQuickSettingsCache] = useState<Record<string, { addressVerificationEnabled: boolean; deleteBillConfirm: boolean; calculatorEnabled: boolean; loading?: boolean }>>({})
  const [quickSettingsSaving, setQuickSettingsSaving] = useState<Record<string, boolean>>({})
  const [showCreateBot, setShowCreateBot] = useState<boolean>(false)
  const [createForm, setCreateForm] = useState<{ token: string; enabled: boolean }>({ token: "", enabled: true })
  const [broadcastDrafts, setBroadcastDrafts] = useState<Record<string, { open: boolean; message: string; sending?: boolean }>>({})
  const [grpMemberDlg, setGrpMemberDlg] = useState<{ open: boolean; botId?: string; groupId?: string; groupName?: string; items?: Array<{ id: string; title: string }>; selected?: Set<string>; origSelected?: Set<string>; loading?: boolean; saving?: boolean; filter?: string }>({ open: false })
  const [manualAdd, setManualAdd] = useState<{ open: boolean; chatId: string; botId: string; saving?: boolean; error?: string }>({ open: false, chatId: '', botId: '' })
  const [batchSaving, setBatchSaving] = useState(false)
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set()) // 🔥 批量选中状态
  // 每个机器人的命令别名弹窗与数据
  const [aliasDialogs, setAliasDialogs] = useState<Record<string, {
    open: boolean
    loading?: boolean
    saving?: boolean
    exactPairs: Array<{ key: string; value: string }>
    commands?: Array<{ type: string; key: string; title: string; desc?: string; examples?: string[]; group?: string }>
    mappedExact?: Record<string, string[]>
    mappedPrefix?: Record<string, string[]>
    draftsExact?: Record<string, string>
    draftsPrefix?: Record<string, string>
    modesExact?: Record<string, 'alias' | 'replace'>
    modesPrefix?: Record<string, 'alias' | 'replace'>
  }>>({})
  
  // 🔥 确认对话框状态
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    title: string
    description: string
    onConfirm: () => void
  }>({
    open: false,
    title: '',
    description: '',
    onConfirm: () => {}
  })
  
  // 白名单用户管理状态
  const [whitelistedUsers, setWhitelistedUsers] = useState<Array<{ id: string; userId: string; username: string | null; note: string | null; createdAt: string }>>([])
  const [whitelistLoading, setWhitelistLoading] = useState(false)
  const [whitelistForm, setWhitelistForm] = useState({ userId: '', note: '' })
  const [whitelistSaving, setWhitelistSaving] = useState(false)
  
  // 🔥 邀请记录功能已删除

  const FEATURE_NAME_MAP: Record<string, string> = {
    accounting_basic: '基础记账',
  }

  useEffect(() => {
    setMounted(true)
    // Require auth only for admin homepage (no chatId)
    ;(async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' })
        if (res.ok) {
          setIsAdmin(true)
          if (!chatId) {
            loadWhitelistedUsers()
          }
        } else {
          setIsAdmin(false)
          if (!chatId) router.push('/')
        }
      } catch {
        setIsAdmin(false)
        if (!chatId) router.push('/')
      }
    })()
  }, [router, chatId])

  // 🔥 初始化时根据日切时间获取当前应该查看的日期
  useEffect(() => {
    if (!chatId || dateInitialized) return
    
    const fetchCurrentDate = async () => {
      try {
        const params = new URLSearchParams()
        params.set('chatId', chatId)
        const res = await fetch(`/api/stats/current-date?${params.toString()}`)
        if (res.ok) {
          const data = await res.json()
          if (data.date) {
            // 解析日期字符串 YYYY-MM-DD
            const [year, month, day] = data.date.split('-').map(Number)
            const targetDate = new Date(year, month - 1, day)
            setCurrentDate(targetDate)
            setDateInitialized(true)
          }
        }
      } catch (e) {
        console.error('获取当前日期失败', e)
        // 失败时标记为已初始化，使用默认的当前日期
        setDateInitialized(true)
      }
    }
    
    fetchCurrentDate()
  }, [chatId, dateInitialized])
  
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
      toast({ title: '提示', description: '请输入用户ID', variant: 'destructive' })
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
        toast({ title: '成功', description: '添加成功！用户名已自动获取并显示在表格中。' })
      } else {
        const json = await res.json()
        toast({ title: '错误', description: json.error || '添加失败', variant: 'destructive' })
      }
    } catch (e) {
      toast({ title: '错误', description: '添加失败', variant: 'destructive' })
    } finally {
      setWhitelistSaving(false)
    }
  }
  
  // 🔥 显示确认对话框的辅助函数
  const showConfirm = (title: string, description: string, onConfirm: () => void) => {
    setConfirmDialog({
      open: true,
      title,
      description,
      onConfirm
    })
  }
  
  // 删除白名单用户
  const removeWhitelistedUser = async (userId: string) => {
    showConfirm(
      '删除白名单用户',
      '确定要删除这个白名单用户吗？',
      async () => {
    try {
      const res = await fetch('/api/whitelisted-users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      })
        if (res.ok) {
          await loadWhitelistedUsers()
          toast({ title: '成功', description: '删除成功' })
        } else {
          toast({ title: '错误', description: '删除失败', variant: 'destructive' })
        }
      } catch (e) {
        toast({ title: '错误', description: '删除失败', variant: 'destructive' })
      }
    })
  }
  
  // 🔥 邀请记录功能已删除

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
  const CACHE_MANUAL_ADDED = 'dashboard_manual_added_chats'

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

  // 读取本地记录的“手动添加”的群组
  const getManualAddedSet = (): Set<string> => {
    if (typeof window === 'undefined') return new Set<string>()
    try {
      const raw = localStorage.getItem(CACHE_MANUAL_ADDED)
      if (!raw) return new Set<string>()
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return new Set(arr as string[])
      return new Set<string>()
    } catch {
      return new Set<string>()
    }
  }

  const addManualAdded = (chatId: string) => {
    if (typeof window === 'undefined') return
    try {
      const set = getManualAddedSet()
      set.add(chatId)
      localStorage.setItem(CACHE_MANUAL_ADDED, JSON.stringify(Array.from(set)))
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
                  const newBots = botsItems.map((b: any) => ({ id: b.id, name: b.name, enabled: !!b.enabled, realName: b.realName || null }))
                  setCachedData(CACHE_KEY_BOTS, newBots)
                  setCachedData(CACHE_KEY_GROUPS, chatsItems)
                }
              }).catch(() => {})
            }, 100)
          } else {
            // 🔥 并行加载机器人和群组，提升加载速度
            const [botsRes, chatsRes] = await Promise.all([
              fetch('/api/bots'),
              fetch('/api/chats')
            ])
            
            if (botsRes.ok) {
              const data = await botsRes.json()
              const items = Array.isArray(data?.items) ? data.items : []
              const botsData = items.map((b: any) => ({ id: b.id, name: b.name, enabled: !!b.enabled }))
              setBots(botsData)
              setCachedData(CACHE_KEY_BOTS, botsData)
            }
            
            if (chatsRes.ok) {
              const json = await chatsRes.json()
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
    
    // 🔥 自动刷新群组列表（每30秒轮询一次，提升更新速度）
    if (!chatId) {
      const interval = setInterval(() => {
        Promise.all([fetch('/api/bots'), fetch('/api/chats')]).then(async ([botsRes, chatsRes]) => {
          if (botsRes.ok && chatsRes.ok) {
            const botsData = await botsRes.json()
            const chatsData = await chatsRes.json()
            const botsItems = Array.isArray(botsData?.items) ? botsData.items : []
            const chatsItems = (Array.isArray(chatsData?.items) ? chatsData.items : []).filter((it: any) => String(it.id || '').startsWith('-'))
            const newBots = botsItems.map((b: any) => ({ id: b.id, name: b.name, enabled: !!b.enabled, realName: b.realName || null }))
            setBots(newBots)
            setGroups(chatsItems)
            setGroupsCount(chatsItems.length)
            const d: Record<string, { status: "PENDING" | "APPROVED" | "BLOCKED"; botId?: string | null; allowed: boolean }> = {}
            for (const it of chatsItems) {
              const status = (it.status as any) || (it.allowed ? 'APPROVED' : 'PENDING')
              const allowed = status === 'APPROVED'
              d[it.id] = { status, botId: it.botId ?? null, allowed }
            }
            setDrafts(d)
            setCachedData(CACHE_KEY_BOTS, newBots)
            setCachedData(CACHE_KEY_GROUPS, chatsItems)
          }
        }).catch(() => {})
      }, 30 * 1000) // 🔥 每30秒刷新一次
      
      return () => clearInterval(interval)
    }
  }, [mounted, chatId])

  // 辅助：打开并加载某个机器人的命令别名
  const openAliasDialog = useCallback(async (botId: string) => {
    setAliasDialogs((m) => ({ ...m, [botId]: { open: true, loading: true, saving: false, exactPairs: [], commands: [], mappedExact: {}, mappedPrefix: {}, draftsExact: {}, draftsPrefix: {}, modesExact: {}, modesPrefix: {} } }))
    try {
      const token = typeof window !== 'undefined' ? (localStorage.getItem('auth_token') || '') : ''
      const [aliasRes, cmdsRes] = await Promise.all([
        fetch(`/api/bots/${encodeURIComponent(botId)}/command-aliases`),
        fetch(`/api/bots/${encodeURIComponent(botId)}/commands`, { headers: token ? { 'x-auth-token': token } as any : undefined })
      ])
      const toPairs = (obj: any) => Object.entries(obj || {}).map(([k, v]) => ({ key: String(k), value: String(v) }))
      let exactPairs: Array<{ key: string; value: string }> = []
      let prefixPairs: Array<{ key: string; value: string }> = []
      if (aliasRes.ok) {
        const j = await aliasRes.json().catch(() => ({}))
        exactPairs = toPairs(j?.exact_map)
        prefixPairs = toPairs(j?.prefix_map)
      }
      let commands: Array<{ type: string; key: string; title: string; desc?: string; examples?: string[]; group?: string }> = []
      if (cmdsRes.ok) {
        const data = await cmdsRes.json().catch(() => ({}))
        commands = Array.isArray(data?.commands) ? data.commands : []
      }
      // 按目标key聚合成 per-command 的别名列表
      const mappedExact: Record<string, string[]> = {}
      for (const p of exactPairs) {
        if (!p?.value) continue
        if (!mappedExact[p.value]) mappedExact[p.value] = []
        mappedExact[p.value].push(p.key)
      }
      const mappedPrefix: Record<string, string[]> = {}
      for (const p of prefixPairs) {
        if (!p?.value) continue
        if (!mappedPrefix[p.value]) mappedPrefix[p.value] = []
        mappedPrefix[p.value].push(p.key)
      }
      setAliasDialogs((m) => ({
        ...m,
        [botId]: {
          open: true,
          loading: false,
          saving: false,
          exactPairs,
          commands,
          mappedExact,
          mappedPrefix,
          draftsExact: {},
          draftsPrefix: {},
          modesExact: {},
          modesPrefix: {},
        }
      }))
    } catch {
      setAliasDialogs((m) => ({ ...m, [botId]: { open: true, loading: false, saving: false, exactPairs: [], commands: [], mappedExact: {}, mappedPrefix: {}, draftsExact: {}, draftsPrefix: {}, modesExact: {}, modesPrefix: {} } }))
    }
  }, [])

  const closeAliasDialog = useCallback((botId: string) => {
    setAliasDialogs((m) => ({ ...m, [botId]: { ...(m[botId] || { exactPairs: [] }), open: false } }))
  }, [])

  const saveAliasDialog = useCallback(async (botId: string) => {
    const data = aliasDialogs[botId]
    if (!data) return
    const pairsToObj = (arr: Array<{ key: string; value: string }>) => {
      const out: Record<string, string> = {}
      for (const it of arr) {
        const k = (it.key || '').trim()
        const v = (it.value || '').trim()
        if (!k || !v) continue
        if (k.length > 100 || v.length > 100) continue
        if (out[k] != null) continue
        out[k] = v
      }
      return out
    }
    // 从 per-command 映射构建 map（别名 -> 规范命令）
    const exactFromMapped: Record<string, string> = {}
    const prefixFromMapped: Record<string, string> = {}
    Object.entries(data.mappedExact || {}).forEach(([target, aliases]) => {
      (aliases || []).forEach((a) => {
        const kk = String(a || '').trim()
        if (!kk || kk.length > 100) return
        if (exactFromMapped[kk] != null) return
        exactFromMapped[kk] = target
      })
    })
    Object.entries(data.mappedPrefix || {}).forEach(([target, aliases]) => {
      (aliases || []).forEach((a) => {
        const kk = String(a || '').trim()
        if (!kk || kk.length > 100) return
        if (prefixFromMapped[kk] != null) return
        prefixFromMapped[kk] = target
      })
    })
    // 合并高级表格模式的编辑（保持兼容）
    const exactPairsObj = pairsToObj(data.exactPairs || [])
    const payload = {
      exact_map: { ...exactPairsObj, ...exactFromMapped },
      prefix_map: { ...prefixFromMapped },
    }
    try {
      setAliasDialogs((m) => ({ ...m, [botId]: { ...(m[botId] || { exactPairs: [] }), saving: true } }))
      const token = localStorage.getItem('auth_token') || ''
      const res = await fetch(`/api/bots/${encodeURIComponent(botId)}/command-aliases`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': token }, body: JSON.stringify(payload)
      })
      if (!res.ok) {
        const msg = await res.text().catch(() => '')
        throw new Error(msg || '保存失败')
      }
      toast({ title: '已保存', description: '命令别名稍后在该机器人生效' })
      setAliasDialogs((m) => ({ ...m, [botId]: { ...(m[botId] || { exactPairs: [] }), saving: false } }))
    } catch (e) {
      setAliasDialogs((m) => ({ ...m, [botId]: { ...(m[botId] || { exactPairs: [] }), saving: false } }))
      toast({ title: '错误', description: (e as Error).message || '保存失败', variant: 'destructive' })
    }
  }, [aliasDialogs, toast])

  // 🔥 使用 useMemo 优化计算（必须在所有条件返回之前）
  const manualAddedSet = useMemo(() => getManualAddedSet(), [groups])
  const inviterOptions = useMemo(() => {
    return Array.from(new Set(groups.map(g => g.invitedByUsername || (manualAddedSet.has(g.id) ? '手动' : '-'))))
      .filter(x => x !== '-')
      .sort()
  }, [groups, manualAddedSet])
  
  const filteredGroups = useMemo(() => {
    return inviterFilter === '全部' 
      ? groups 
      : groups.filter(g => (g.invitedByUsername || '-') === inviterFilter)
  }, [groups, inviterFilter])

  // 🔥 使用 useCallback 优化事件处理（必须在所有条件返回之前）
  const handlePreviousDay = useCallback(() => {
    setCurrentDate(prev => {
      const newDate = new Date(prev)
      newDate.setDate(newDate.getDate() - 1)
      return newDate
    })
  }, [])

  const handleNextDay = useCallback(() => {
    setCurrentDate(prev => {
      const newDate = new Date(prev)
      newDate.setDate(newDate.getDate() + 1)
      // 🔥 限制：不能超过今天
      const today = new Date()
      today.setHours(23, 59, 59, 999)
      if (newDate > today) {
        return prev // 如果超过今天，不更新
      }
      return newDate
    })
  }, [])

  const handleDateChange = useCallback((date: Date) => {
    // 🔥 限制：不能选择未来日期
    const today = new Date()
    today.setHours(23, 59, 59, 999)
    if (date > today) {
      return // 如果超过今天，不更新
    }
    setCurrentDate(date)
  }, [])

  const handleViewSummary = useCallback(() => {
    router.push('/summary')
  }, [router])

  const handleLogout = useCallback(async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }) } catch {}
    router.push('/')
  }, [router])

  // 🔥 处理账单数据变化（仅保存时间数据）
  const handleBillDataChange = useCallback((data: any) => {
    // 🔥 只保存需要的时间数据，减少内存占用
    setBillData(data?.billStartTime || data?.billEndTime ? {
      billStartTime: data.billStartTime,
      billEndTime: data.billEndTime
    } : null)
  }, [])

  const showCompact = !chatId

  if (!mounted) {
    return null
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto px-4 py-6 max-w-[95%]">
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
          billStartTime={billData?.billStartTime}
          billEndTime={billData?.billEndTime}
        />

        {showCompact ? (
          <div className="mt-6 space-y-6">
            {/* 移除全局JSON配置，改为按机器人配置的弹窗UI */}
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
                          // 记录为手动添加
                          addManualAdded(chatId)
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
                      onChange={(e) => setCreateForm(f => ({ ...f, token: e.target.value }))}
                    />
                  </div>
                  <div className="text-xs text-slate-500">系统将自动识别Token并创建机器人，自动使用 @username 作为名称。</div>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={createForm.enabled} onChange={(e) => setCreateForm(f => ({ ...f, enabled: e.target.checked }))} />
                    <span>创建后立即启用</span>
                  </label>
                  <div>
                    <button
                      className="px-3 py-1.5 text-sm border rounded-md hover:bg-slate-50 disabled:opacity-50"
                      disabled={!createForm.token.trim()}
                      onClick={async () => {
                        if (!createForm.token.trim()) { toast({ title: '提示', description: '请先填写 Token', variant: 'destructive' }); return }
                        
                        // 🔥 自动识别并创建（合并为一个操作）
                        try {
                          // 先识别Token
                          const introspectRes = await fetch('/api/bots/introspect', { 
                            method: 'POST', 
                            headers: { 'Content-Type': 'application/json' }, 
                            body: JSON.stringify({ token: createForm.token }) 
                          })
                          
                          if (!introspectRes.ok) {
                            const msg = await introspectRes.json().catch(() => ({}))
                            toast({ title: '错误', description: `识别失败：${msg?.error || '请检查 Token'}`, variant: 'destructive' })
                            return
                          }
                          
                          const me = await introspectRes.json()
                          const name = me.username ? `@${me.username}` : (me.first_name || '新机器人')
                          
                          // 直接创建
                          const payload = { name, token: createForm.token, enabled: createForm.enabled }
                          const createRes = await fetch('/api/bots', { 
                            method: 'POST', 
                            headers: { 'Content-Type': 'application/json' }, 
                            body: JSON.stringify(payload) 
                          })
                          
                          if (createRes.ok) {
                            try {
                              const botsRes2 = await fetch('/api/bots')
                              if (botsRes2.ok) {
                                const data2 = await botsRes2.json()
                                const items2 = Array.isArray(data2?.items) ? data2.items : []
                                setBots(items2.map((x: any) => ({ id: x.id, name: x.name, enabled: !!x.enabled, realName: x.realName || null })))
                              }
                            } catch {}
                            setCreateForm({ token: '', enabled: true })
                            setShowCreateBot(false)
                            toast({ title: '成功', description: `机器人 ${name} 创建成功` })
                          } else {
                            toast({ title: '错误', description: '创建失败', variant: 'destructive' })
                          }
                        } catch {
                          toast({ title: '错误', description: '创建失败，请检查网络和Token', variant: 'destructive' })
                        }
                      }}
                    >创建机器人</button>
                  </div>
                </div>
              )}

              {bots.length === 0 ? (
                <div className="text-sm text-slate-500">暂无机器人，请先创建。</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
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
                                toast({ title: '成功', description: `机器人已${enabled ? '启用' : '停用'}` })
                              } else {
                                toast({ title: '错误', description: '更新启用状态失败', variant: 'destructive' })
                              }
                            }}
                          />
                          <span>{bot.enabled ? '已启用' : '未启用'}</span>
                        </label>
                      </div>
                      {bot.realName && (
                        <div className="text-xs text-slate-500">{bot.realName}</div>
                      )}
                      <div className="flex items-center gap-2">
                        <button
                          className="px-3 py-1.5 text-xs border rounded-md hover:bg-slate-50"
                          onClick={() => {
                            setBroadcastDrafts((prev) => {
                              const current = prev[bot.id] || { open: false, message: '' }
                              return {
                                ...prev,
                                [bot.id]: { ...current, open: !current.open }
                              }
                            })
                          }}
                        >{broadcastDrafts[bot.id]?.open ? '收起群发' : '群发通知'}</button>
                        {isAdmin && (
                          <>
                            <button
                              className="px-3 py-1.5 text-xs border rounded-md hover:bg-slate-50"
                              onClick={() => openAliasDialog(bot.id)}
                            >命令别名配置</button>
                            <button
                              className="px-3 py-1.5 text-xs border rounded-md hover:bg-slate-50"
                              onClick={() => router.push(`/admin/custom-commands?botId=${encodeURIComponent(bot.id)}`)}
                            >自定义指令</button>
                          </>
                        )}
                        <button
                          className="px-3 py-1.5 text-xs border rounded-md hover:bg-red-50 text-red-600"
                          onClick={async () => {
                            if (!confirm('确认删除该机器人？此操作不可恢复')) return
                            try {
                              const res = await fetch(`/api/bots/${encodeURIComponent(bot.id)}`, { method: 'DELETE' })
                              if (res.status === 204) {
                                setBots((prev) => prev.filter((b) => b.id !== bot.id))
                                toast({ title: '成功', description: '机器人删除成功' })
                              } else {
                                const msg = await res.text().catch(() => '')
                                toast({ title: '错误', description: `删除失败：${msg || 'Server error'}`, variant: 'destructive' })
                              }
                            } catch {
                              toast({ title: '错误', description: '删除失败：网络错误', variant: 'destructive' })
                            }
                          }}
                        >删除机器人</button>
                      </div>
                      {broadcastDrafts[bot.id]?.open && (
                        <div className="space-y-2 text-sm">
                          {/* Tab */}
                          <div className="flex items-center gap-2 text-xs">
                            {(['chats','groups'] as const).map(tab => (
                              <button
                                key={tab}
                                className={`px-2 py-1 border rounded ${ (((broadcastDrafts as any)[bot.id]?.tab) || 'chats') === tab ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                                onClick={() => setBroadcastDrafts(prev => ({ ...prev, [bot.id]: { ...(prev[bot.id]||{open:true}), open:true, tab } }))}
                              >{tab === 'chats' ? '选择群组' : '分组发送'}</button>
                            ))}
                          </div>
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
                          {/* 选择群组（可选） */}
                          { (((broadcastDrafts as any)[bot.id]?.tab) || 'chats') === 'chats' && (
                          <div className="border rounded-md p-2 bg-slate-50">
                            <div className="flex items-center justify-between">
                              <div className="text-xs text-slate-600">可选：只向勾选的群组发送（不选择则默认向该机器人全部已允许群组发送）</div>
                              <div className="flex items-center gap-2">
                                <button
                                  className="px-2 py-1 text-xs border rounded hover:bg-white disabled:opacity-50"
                                  disabled={((broadcastDrafts as any)[bot.id]?.loading)}
                                  onClick={async () => {
                                    const current = (broadcastDrafts as any)[bot.id] || { open: true }
                                    // 若已加载则折叠/展开
                                    if (Array.isArray(current.groups) && current.groups.length > 0) {
                                      setBroadcastDrafts((prev) => ({
                                        ...prev,
                                        [bot.id]: { ...current, selectOpen: !current.selectOpen }
                                      }))
                                      return
                                    }
                                    // 否则加载
                                    setBroadcastDrafts((prev) => ({ ...prev, [bot.id]: { ...current, loading: true, selectOpen: true } }))
                                    try {
                                      const res = await fetch(`/api/chats?botId=${encodeURIComponent(bot.id)}`)
                                      const json = res.ok ? await res.json().catch(() => ({})) : {}
                                      const all = Array.isArray(json?.items) ? json.items : []
                                      // 仅群聊且已批准
                                      const groupsList = all.filter((it: any) => String(it.id || '').startsWith('-') && ((it.status as any) === 'APPROVED' || it.allowed === true))
                                        .map((it: any) => ({ id: String(it.id), title: String(it.title || it.id) }))
                                      setBroadcastDrafts((prev) => ({
                                        ...prev,
                                        [bot.id]: { ...current, groups: groupsList, loading: false, selected: new Set<string>(), selectOpen: true }
                                      }))
                                    } catch {
                                      setBroadcastDrafts((prev) => ({ ...prev, [bot.id]: { ...current, loading: false, error: '加载群组失败' } }))
                                    }
                                  }}
                                >{((broadcastDrafts as any)[bot.id]?.selectOpen) ? '收起群组' : '选择群组'}</button>
                              </div>
                            </div>
                            {((broadcastDrafts as any)[bot.id]?.selectOpen) && (
                              <div className="mt-2 max-h-48 overflow-auto bg-white border rounded">
                                {((broadcastDrafts as any)[bot.id]?.loading) ? (
                                  <div className="p-2 text-xs text-slate-500">加载中...</div>
                                ) : (
                                  <div className="p-2 space-y-2">
                                    <label className="inline-flex items-center gap-2 text-xs">
                                      <input
                                        type="checkbox"
                                        checked={Array.isArray(((broadcastDrafts as any)[bot.id]?.groups)) && ((broadcastDrafts as any)[bot.id]?.groups.length > 0) && ((((broadcastDrafts as any)[bot.id]?.selected)?.size || 0) === ((((broadcastDrafts as any)[bot.id]?.groups)?.length) || 0))}
                                        onChange={(e) => {
                                          const cur: any = (broadcastDrafts as any)[bot.id]
                                          const all = Array.isArray(cur?.groups) ? cur.groups : []
                                          const nextSel = new Set<string>()
                                          if (e.target.checked) {
                                            all.forEach((g: any) => nextSel.add(g.id))
                                          }
                                          setBroadcastDrafts((prev) => ({ ...prev, [bot.id]: { ...cur, selected: nextSel } }))
                                        }}
                                      /> 全选/取消全选
                                    </label>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                      {((((broadcastDrafts as any)[bot.id]?.groups) || []) as any[]).map((g: any) => (
                                        <label key={g.id} className="inline-flex items-center gap-2 text-xs border rounded px-2 py-1 hover:bg-slate-50">
                                          <input
                                            type="checkbox"
                                            checked={!!(((broadcastDrafts as any)[bot.id]?.selected)?.has(g.id))}
                                            onChange={(e) => {
                                              const cur: any = (broadcastDrafts as any)[bot.id]
                                              const set = new Set<string>(Array.from(cur?.selected || []))
                                              if (e.target.checked) set.add(g.id); else set.delete(g.id)
                                              setBroadcastDrafts((prev) => ({ ...prev, [bot.id]: { ...cur, selected: set } }))
                                            }}
                                          />
                                          <span className="truncate" title={`${g.title} (${g.id})`}>{g.title}</span>
                                          <span className="text-slate-400">({g.id})</span>
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          )}

                          {/* 分组发送 */}
                          { (((broadcastDrafts as any)[bot.id]?.tab) || 'chats') === 'groups' && (
                            <div className="border rounded-md p-2 bg-slate-50">
                              <div className="flex items-center justify-between">
                                <div className="text-xs text-slate-600">选择要发送的分组，可创建/重命名/删除分组，并维护分组内的群组</div>
                                <div className="flex items-center gap-2">
                                  <button
                                    className="px-2 py-1 text-xs border rounded hover:bg-white disabled:opacity-50"
                                    onClick={async () => {
                                      const cur: any = (broadcastDrafts as any)[bot.id] || { open: true, tab: 'groups' }
                                      try {
                                        const res = await fetch(`/api/bots/${encodeURIComponent(bot.id)}/broadcast-groups?withChats=1`, { cache: 'no-store' })
                                        const json = res.ok ? await res.json().catch(()=>({})) : {}
                                        const items = Array.isArray(json?.items) ? json.items : []
                                        setBroadcastDrafts(prev => ({ ...prev, [bot.id]: { ...cur, grpList: items, grpSelected: new Set<string>() } }))
                                      } catch {
                                        // ignore
                                      }
                                    }}
                                  >刷新分组</button>
                                  <button
                                    className="px-2 py-1 text-xs border rounded hover:bg-white"
                                    onClick={async () => {
                                      const name = prompt('请输入分组名称')?.trim()
                                      if (!name) return
                                      try {
                                        const res = await fetch(`/api/bots/${encodeURIComponent(bot.id)}/broadcast-groups`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ name }) })
                                        if (res.ok) {
                                          const cur: any = (broadcastDrafts as any)[bot.id] || { open: true, tab: 'groups' }
                                          const listRes = await fetch(`/api/bots/${encodeURIComponent(bot.id)}/broadcast-groups?withChats=1`, { cache:'no-store' })
                                          const json = listRes.ok ? await listRes.json().catch(()=>({})) : {}
                                          const items = Array.isArray(json?.items) ? json.items : []
                                          setBroadcastDrafts(prev => ({ ...prev, [bot.id]: { ...cur, grpList: items, grpSelected: new Set<string>() } }))
                                        }
                                      } catch {}
                                    }}
                                  >新建分组</button>
                                </div>
                              </div>
                              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {((((broadcastDrafts as any)[bot.id]?.grpList) || []) as any[]).map((g: any) => (
                                  <div key={g.id} className="border rounded p-2 bg-white">
                                    <div className="flex items-center justify-between gap-2">
                                      <label className="inline-flex items-center gap-2 text-xs">
                                        <input type="checkbox" checked={!!(((broadcastDrafts as any)[bot.id]?.grpSelected)?.has(g.id))} onChange={(e)=>{
                                          const cur: any = (broadcastDrafts as any)[bot.id]
                                          const set = new Set<string>(Array.from(cur?.grpSelected || []))
                                          if (e.target.checked) set.add(g.id); else set.delete(g.id)
                                          setBroadcastDrafts(prev => ({ ...prev, [bot.id]: { ...cur, grpSelected: set } }))
                                        }} />
                                        <span className="font-medium">{g.name}</span>
                                        <span className="text-slate-400">({g.count || (g.chats?.length||0)}群)</span>
                                      </label>
                                      <div className="flex items-center gap-2">
                                        <button className="px-2 py-0.5 text-xs border rounded" onClick={async()=>{
                                          const nn = prompt('重命名分组', g.name)?.trim(); if(!nn) return
                                          try {
                                            await fetch(`/api/bots/${encodeURIComponent(bot.id)}/broadcast-groups/${encodeURIComponent(g.id)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: nn }) })
                                            const listRes = await fetch(`/api/bots/${encodeURIComponent(bot.id)}/broadcast-groups?withChats=1`, { cache:'no-store' })
                                            const json = listRes.ok ? await listRes.json().catch(()=>({})) : {}
                                            const items = Array.isArray(json?.items) ? json.items : []
                                            setBroadcastDrafts(prev => ({ ...prev, [bot.id]: { ...(prev[bot.id]||{} as any), grpList: items } }))
                                          } catch {}
                                        }}>重命名</button>
                                        <button className="px-2 py-0.5 text-xs border rounded text-red-600" onClick={async()=>{
                                          if(!confirm('确认删除该分组？')) return
                                          try {
                                            await fetch(`/api/bots/${encodeURIComponent(bot.id)}/broadcast-groups/${encodeURIComponent(g.id)}`, { method: 'DELETE' })
                                            const listRes = await fetch(`/api/bots/${encodeURIComponent(bot.id)}/broadcast-groups?withChats=1`, { cache:'no-store' })
                                            const json = listRes.ok ? await listRes.json().catch(()=>({})) : {}
                                            const items = Array.isArray(json?.items) ? json.items : []
                                            setBroadcastDrafts(prev => ({ ...prev, [bot.id]: { ...(prev[bot.id]||{}), grpList: items } }))
                                          } catch {}
                                        }}>删除</button>
                                      </div>
                                    </div>
                                    <div className="mt-2 text-xs text-slate-600">{(g.chats||[]).slice(0,6).map((c:any)=>c.title).join('、')}{(g.count||g.chats?.length||0)>6?'…':''}</div>
                                    <div className="mt-2 flex items-center gap-2 text-xs">
                                      <button className="px-2 py-0.5 border rounded" onClick={async()=>{
                                        try {
                                          setGrpMemberDlg({ open: true, loading: true, saving: false, botId: bot.id, groupId: g.id, groupName: g.name, items: [], selected: new Set<string>(), origSelected: new Set<string>(), filter: '' })
                                          const res = await fetch(`/api/chats?botId=${encodeURIComponent(bot.id)}`, { cache: 'no-store' })
                                          const json = res.ok ? await res.json().catch(()=>({})) : {}
                                          const all = Array.isArray((json as any)?.items) ? (json as any).items : []
                                          const list = all.filter((it: any) => String(it.id || '').startsWith('-') && (((it as any).status as any) === 'APPROVED' || (it as any).allowed === true))
                                            .map((it: any) => ({ id: String(it.id), title: String(it.title || it.id) }))
                                          const currentIds = new Set<string>(((g?.chats||[]) as any[]).map((c:any)=>String(c.chatId || c.id || c)))
                                          setGrpMemberDlg({ open: true, loading: false, saving: false, botId: bot.id, groupId: g.id, groupName: g.name, items: list, selected: new Set<string>(Array.from(currentIds)), origSelected: new Set<string>(Array.from(currentIds)), filter: '' })
                                        } catch {
                                          setGrpMemberDlg({ open: false })
                                        }
                                      }}>管理成员</button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              {grpMemberDlg.open && (
                                <Dialog open={(grpMemberDlg as any).open} onOpenChange={(o)=> setGrpMemberDlg((prev)=>({ ...(prev as any), open: o }))}>
                                  <DialogContent className="sm:max-w-[640px]">
                                    <DialogHeader>
                                      <DialogTitle>管理分组成员 - {String((grpMemberDlg as any).groupName || '')}</DialogTitle>
                                      <DialogDescription>选择要包含在此分组内的群组</DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-2">
                                      <input
                                        className="w-full border rounded px-2 py-1 text-sm"
                                        placeholder="搜索群名或ID"
                                        value={String((grpMemberDlg as any).filter || '')}
                                        onChange={(e)=> setGrpMemberDlg((prev)=>({ ...(prev as any), filter: e.target.value }))}
                                      />
                                      <div className="flex items-center gap-2">
                                        <button className="px-2 py-1 text-xs border rounded" onClick={()=>{
                                          const items = ((grpMemberDlg as any).items || []) as Array<{id:string;title:string}>
                                          const f = String((grpMemberDlg as any).filter || '').toLowerCase()
                                          const filtered = items.filter(it=> it.id.toLowerCase().includes(f) || (it.title||'').toLowerCase().includes(f))
                                          setGrpMemberDlg((prev)=>({ ...(prev as any), selected: new Set<string>(filtered.map(it=>it.id)) }))
                                        }}>全选</button>
                                        <button className="px-2 py-1 text-xs border rounded" onClick={()=>{
                                          setGrpMemberDlg((prev)=>({ ...(prev as any), selected: new Set<string>() }))
                                        }}>全不选</button>
                                      </div>
                                      <div className="max-h-72 overflow-auto border rounded">
                                        <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                          {(((grpMemberDlg as any).items)||[] as Array<{id:string;title:string}>).filter((it: any)=>{
                                            const f = String((grpMemberDlg as any).filter || '').toLowerCase()
                                            return it.id.toLowerCase().includes(f) || (it.title||'').toLowerCase().includes(f)
                                          }).map((it: any)=> (
                                            <label key={it.id} className="flex items-center gap-2 text-xs border rounded px-2 py-1">
                                              <input
                                                type="checkbox"
                                                checked={Boolean(((grpMemberDlg as any).selected as Set<string>)?.has(it.id))}
                                                onChange={(e)=>{
                                                  const cur = (grpMemberDlg as any)
                                                  const set = new Set<string>(Array.from((cur.selected as Set<string>) || new Set()))
                                                  if (e.target.checked) set.add(it.id); else set.delete(it.id)
                                                  setGrpMemberDlg({ ...(cur as any), selected: set })
                                                }}
                                              />
                                              <span className="truncate" title={`${it.title} (${it.id})`}>{it.title}</span>
                                              <span className="text-slate-400">({it.id})</span>
                                            </label>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex justify-end gap-2">
                                      <button className="px-3 py-1.5 text-xs border rounded" onClick={()=> setGrpMemberDlg({ open: false })}>取消</button>
                                      <button
                                        className="px-3 py-1.5 text-xs border rounded disabled:opacity-50"
                                        disabled={Boolean((grpMemberDlg as any).saving)}
                                        onClick={async()=>{
                                          try {
                                            const cur: any = grpMemberDlg
                                            const sel = Array.from((cur.selected as Set<string>) || new Set())
                                            const orig = new Set<string>(Array.from((cur.origSelected as Set<string>) || new Set()))
                                            const add = sel.filter((id)=> !orig.has(id))
                                            const remove = Array.from(orig).filter((id)=> !(cur.selected as Set<string>).has(id))
                                            if (add.length === 0 && remove.length === 0) { setGrpMemberDlg({ open: false }); toast({ title: '已保存', description: '无变更' }); return }
                                            setGrpMemberDlg((prev)=>({ ...(prev as any), saving: true }))
                                            await fetch(`/api/bots/${encodeURIComponent(String(cur.botId))}/broadcast-groups/${encodeURIComponent(String(cur.groupId))}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ addChatIds: add, removeChatIds: remove }) })
                                            const listRes = await fetch(`/api/bots/${encodeURIComponent(String(cur.botId))}/broadcast-groups?withChats=1`, { cache:'no-store' })
                                            const json = listRes.ok ? await listRes.json().catch(()=>({})) : {}
                                            const items = Array.isArray((json as any)?.items) ? (json as any).items : []
                                            setBroadcastDrafts((prev)=> ({ ...prev, [String(cur.botId)]: { ...((prev as any)[String(cur.botId)]||{}), grpList: items } }))
                                            toast({ title: '成功', description: '已保存分组成员' })
                                            setGrpMemberDlg({ open: false })
                                          } catch (e) {
                                            toast({ title: '错误', description: '保存失败', variant: 'destructive' })
                                            setGrpMemberDlg((prev)=>({ ...(prev as any), saving: false }))
                                          }
                                        }}
                                      >保存</button>
                                    </div>
                                  </DialogContent>
                                </Dialog>
                              )}
                            </div>
                          )}
                          <div className="flex justify-end gap-3">
                            <button
                              className="px-3 py-1.5 text-xs border rounded-md hover:bg-slate-50"
                              onClick={() => setBroadcastDrafts((prev) => ({ ...prev, [bot.id]: { open: false, message: '', sending: false } }))}
                            >取消</button>
                            <button
                              className="px-3 py-1.5 text-xs border rounded-md hover:bg-slate-50 disabled:opacity-50"
                              disabled={!broadcastDrafts[bot.id]?.message?.trim() || broadcastDrafts[bot.id]?.sending}
                              onClick={async () => {
                                const current: any = (broadcastDrafts as any)[bot.id]
                                if (!current?.message?.trim()) return
                                setBroadcastDrafts((prev) => ({ ...prev, [bot.id]: { ...current, sending: true } }))
                                try {
                                  const res = await fetch(`/api/bots/${encodeURIComponent(bot.id)}/broadcast`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      message: current.message,
                                      ...(current?.selected && (current.selected as Set<string>).size > 0 ? { chatIds: Array.from(current.selected as Set<string>) } : {}),
                                      ...(current?.grpSelected && (current.grpSelected as Set<string>).size > 0 ? { groupIds: Array.from(current.grpSelected as Set<string>) } : {}),
                                    }),
                                  })
                                  if (res.ok) {
                                    const json = await res.json().catch(() => null)
                                    const sent = Number(json?.sent || 0)
                                    const total = Number(json?.total || 0)
                                    const tried = Number(json?.tried || 0)
                                    const failed = Array.isArray(json?.failedIds) ? json.failedIds.length : Math.max(0, tried - sent)
                                    toast({ title: '成功', description: `已发送：${sent} / ${total}（尝试：${tried}，失败：${failed}）` })
                                    setBroadcastDrafts((prev) => ({ ...prev, [bot.id]: { open: false, message: '', sending: false } }))
                                  } else {
                                    const err = await res.json().catch(() => ({}))
                                    toast({ title: '错误', description: `发送失败：${err?.error || '请检查网络'}`, variant: 'destructive' })
                                    setBroadcastDrafts((prev) => ({ ...prev, [bot.id]: { ...current, sending: false } }))
                                  }
                                } catch (e) {
                                  toast({ title: '错误', description: '发送失败：网络错误', variant: 'destructive' })
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

            {/* 命令别名配置弹窗（按机器人） */}
            {isAdmin && bots.map((bot) => {
              const dlg = aliasDialogs[bot.id]
              if (!dlg) return null
              return (
                <Dialog key={`alias-${bot.id}`} open={!!dlg.open} onOpenChange={(open) => open ? openAliasDialog(bot.id) : closeAliasDialog(bot.id)}>
                  <DialogContent className="w-[98vw] max-w-none sm:max-w-none max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>⚙️ 命令别名配置 - {bot.name}</DialogTitle>
                      <DialogDescription>
                        说明：
                        <br />
                        - 整句映射：当消息与左侧“别名”完全一致时，替换为右侧“规范命令”。
                      </DialogDescription>
                    </DialogHeader>

                    {/* 基于命令清单逐项配置 */}
                    <div className="mt-2">
                      <div className="text-sm font-medium mb-2">基于命令清单逐项配置</div>
                      {dlg.loading ? (
                        <div className="text-sm text-slate-500">加载中...</div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
                          {(dlg.commands || []).map((c, i) => {
                            const isExact = c.type === 'exact'
                            const aliases = isExact ? (dlg.mappedExact?.[c.key] || []) : (dlg.mappedPrefix?.[c.key] || [])
                            const draft = isExact ? (dlg.draftsExact?.[c.key] || '') : (dlg.draftsPrefix?.[c.key] || '')
                            // 计算当前“替换指令”目标：即在哪个目标命令下包含了本命令key作为别名
                            const findReplacementTarget = () => {
                              const map = isExact ? (dlg.mappedExact || {}) : (dlg.mappedPrefix || {})
                              for (const [target, list] of Object.entries(map)) {
                                if (target === c.key) continue
                                if ((list || []).includes(c.key)) return target
                              }
                              return ''
                            }
                            const currentReplacement = findReplacementTarget()
                            const currentMode = (isExact ? dlg.modesExact?.[c.key] : dlg.modesPrefix?.[c.key]) || (currentReplacement ? 'replace' : 'alias')
                            const setReplacement = (nextTarget: string) => {
                              setAliasDialogs(m => {
                                const cur = m[bot.id]
                                const map = isExact ? { ...(cur.mappedExact || {}) } : { ...(cur.mappedPrefix || {}) }
                                // 移除所有目标下的本命令key
                                Object.keys(map).forEach((t) => {
                                  const list = Array.from(map[t] || [])
                                  map[t] = list.filter(x => x !== c.key)
                                })
                                if (nextTarget) {
                                  const list = Array.from(map[nextTarget] || [])
                                  if (!list.includes(c.key)) list.push(c.key)
                                  map[nextTarget] = list
                                }
                                if (isExact) {
                                  return { ...m, [bot.id]: { ...cur, mappedExact: map } }
                                } else {
                                  return { ...m, [bot.id]: { ...cur, mappedPrefix: map } }
                                }
                              })
                            }
                            return (
                              <div key={`cmd-${i}`} className="border rounded p-3">
                                <div className="text-sm font-medium">{c.title || c.key}</div>
                                {c.desc && <div className="text-xs text-slate-600 mt-0.5">{c.desc}</div>}
                                {Array.isArray(c.examples) && c.examples.length > 0 && (
                                  <div className="text-xs text-slate-500 mt-1">示例：{c.examples.join('，')}</div>
                                )}
                                <div className="mt-2 flex items-center gap-4">
                                  <label className="text-xs flex items-center gap-1">
                                    <input
                                      type="radio"
                                      name={`mode-${bot.id}-${c.key}`}
                                      checked={currentMode === 'alias'}
                                      onChange={() => {
                                        // 切到“增加别名”，需要清除替换关系
                                        setReplacement('')
                                        setAliasDialogs(m => {
                                          const cur = m[bot.id]
                                          if (isExact) {
                                            return { ...m, [bot.id]: { ...cur, modesExact: { ...(cur.modesExact || {}), [c.key]: 'alias' } } }
                                          }
                                          return { ...m, [bot.id]: { ...cur, modesPrefix: { ...(cur.modesPrefix || {}), [c.key]: 'alias' } } }
                                        })
                                      }}
                                    /> 增加别名
                                  </label>
                                  <label className="text-xs flex items-center gap-1">
                                    <input
                                      type="radio"
                                      name={`mode-${bot.id}-${c.key}`}
                                      checked={currentMode === 'replace'}
                                      onChange={() => {
                                        setAliasDialogs(m => {
                                          const cur = m[bot.id]
                                          if (isExact) {
                                            return { ...m, [bot.id]: { ...cur, modesExact: { ...(cur.modesExact || {}), [c.key]: 'replace' } } }
                                          }
                                          return { ...m, [bot.id]: { ...cur, modesPrefix: { ...(cur.modesPrefix || {}), [c.key]: 'replace' } } }
                                        })
                                      }}
                                    /> 替换指令
                                  </label>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2 items-center">
                                  {aliases.map((a, idx) => (
                                    <span key={`tag-${i}-${idx}`} className="inline-flex items-center gap-1 text-xs bg-slate-100 border rounded px-2 py-0.5">
                                      {a}
                                      <button
                                        className="text-red-600"
                                        onClick={() => {
                                          setAliasDialogs(m => {
                                            const cur = m[bot.id]
                                            if (isExact) {
                                              const next = { ...(cur.mappedExact || {}) }
                                              const list = Array.from(next[c.key] || [])
                                              next[c.key] = list.filter(x => x !== a)
                                              return { ...m, [bot.id]: { ...cur, mappedExact: next } }
                                            } else {
                                              const next = { ...(cur.mappedPrefix || {}) }
                                              const list = Array.from(next[c.key] || [])
                                              next[c.key] = list.filter(x => x !== a)
                                              return { ...m, [bot.id]: { ...cur, mappedPrefix: next } }
                                            }
                                          })
                                        }}
                                      >×</button>
                                    </span>
                                  ))}
                                </div>
                                <div className="mt-2 flex gap-2">
                                  <input
                                    className="border rounded px-2 py-1 text-sm flex-1"
                                    placeholder={isExact ? (currentMode === 'replace' ? '输入要替换为本指令的整句' : '新增别名（整句）') : (currentMode === 'replace' ? '输入要替换为本指令的前缀' : '新增前缀')}
                                    value={draft}
                                    onChange={e => setAliasDialogs(m => ({
                                      ...m,
                                      [bot.id]: {
                                        ...m[bot.id],
                                        ...(isExact
                                          ? { draftsExact: { ...(m[bot.id].draftsExact || {}), [c.key]: e.target.value } }
                                          : { draftsPrefix: { ...(m[bot.id].draftsPrefix || {}), [c.key]: e.target.value } }
                                        )
                                      }
                                    }))}
                                  />
                                  <button
                                    className="text-xs border rounded px-2 py-1 hover:bg-slate-50"
                                    onClick={() => {
                                      const val = (draft || '').trim()
                                      if (!val) {
                                        toast({ title: '提示', description: '请输入要添加的内容', variant: 'destructive' })
                                        return
                                      }
                                      if (val.length > 100) {
                                        toast({ title: '提示', description: '输入过长（最多100个字符）', variant: 'destructive' })
                                        return
                                      }
                                      setAliasDialogs(m => {
                                        const cur = m[bot.id]
                                        if (isExact) {
                                          const next = { ...(cur.mappedExact || {}) }
                                          if (currentMode === 'replace') {
                                            // 从所有 exact 目标中移除该短语
                                            Object.keys(next).forEach(t => {
                                              next[t] = (next[t] || []).filter(x => x !== val)
                                            })
                                          } else {
                                            if ((next[c.key] || []).includes(val)) {
                                              toast({ title: '提示', description: '该别名已存在', variant: 'destructive' })
                                              return m
                                            }
                                          }
                                          const list = Array.from(next[c.key] || [])
                                          if (!list.includes(val)) list.push(val)
                                          next[c.key] = list
                                          const nd = { ...(cur.draftsExact || {}) }
                                          nd[c.key] = ''
                                          return { ...m, [bot.id]: { ...cur, mappedExact: next, draftsExact: nd } }
                                        } else {
                                          const next = { ...(cur.mappedPrefix || {}) }
                                          if (currentMode === 'replace') {
                                            // 从所有 prefix 目标中移除该前缀
                                            Object.keys(next).forEach(t => {
                                              next[t] = (next[t] || []).filter(x => x !== val)
                                            })
                                          } else {
                                            if ((next[c.key] || []).includes(val)) {
                                              toast({ title: '提示', description: '该前缀已存在', variant: 'destructive' })
                                              return m
                                            }
                                          }
                                          const list = Array.from(next[c.key] || [])
                                          if (!list.includes(val)) list.push(val)
                                          next[c.key] = list
                                          const nd = { ...(cur.draftsPrefix || {}) }
                                          nd[c.key] = ''
                                          return { ...m, [bot.id]: { ...cur, mappedPrefix: next, draftsPrefix: nd } }
                                        }
                                      })
                                    }}
                                  >添加</button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    

                    <div className="mt-4 flex justify-end gap-2">
                      <button className="px-3 py-1.5 text-sm border rounded-md hover:bg-slate-50" onClick={() => closeAliasDialog(bot.id)}>取消</button>
                      <button className="px-3 py-1.5 text-sm border rounded-md hover:bg-slate-50 disabled:opacity-50" disabled={!!dlg.saving} onClick={() => saveAliasDialog(bot.id)}>
                        {dlg.saving ? '保存中...' : '保存'}
                      </button>
                    </div>
                  </DialogContent>
                </Dialog>
              )
            })}

            {/* 群组管理卡片 */}
            <div className="bg-white border rounded-lg p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-lg font-semibold text-slate-900">群组管理</div>
                    <Dialog>
                      <DialogTrigger asChild>
                        <button className="text-blue-600 hover:text-blue-700 text-sm font-medium">
                          ℹ️ 说明
                        </button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>群组管理说明</DialogTitle>
                          <DialogDescription className="space-y-4 pt-4">
                            <div>
                              <h3 className="font-semibold text-slate-900 mb-2">📥 自动添加群组</h3>
                              <p className="text-sm text-slate-600 mb-2">
                                当机器人被邀请加入群组时，系统会自动在群组管理中创建该群组的记录，并显示邀请人信息。
                              </p>
                              <p className="text-sm text-slate-600">
                                如果邀请人在白名单中，该群组将自动被授权使用（无需手动批准）。
                              </p>
                            </div>
                            
                            <div>
                              <h3 className="font-semibold text-slate-900 mb-2">📤 自动删除群组</h3>
                              <p className="text-sm text-slate-600">
                                当机器人被踢出群组或离开群组时，系统会自动删除该群组的记录及相关数据。
                              </p>
                            </div>
                            
                            <div>
                              <h3 className="font-semibold text-slate-900 mb-2">🔄 数据刷新说明</h3>
                              <p className="text-sm text-slate-600 mb-2">
                                如果数据没有更新（如新添加的群组、邀请人信息等），请刷新页面：
                              </p>
                              <ul className="list-disc list-inside text-sm text-slate-600 space-y-1 mb-2">
                                <li>按 F5 或 Ctrl+R（Windows/Linux）刷新页面</li>
                                <li>按 Cmd+R（Mac）刷新页面</li>
                                <li>或点击浏览器的刷新按钮</li>
                              </ul>
                              <p className="text-sm text-slate-600">
                                系统会自动刷新群组列表（每30秒），但如果邀请人信息未显示，仍需要手动刷新页面。
                              </p>
                            </div>
                            
                            <div>
                              <h3 className="font-semibold text-slate-900 mb-2">🗑️ 删除功能</h3>
                              <p className="text-sm text-slate-600 mb-2">
                                <strong>单个删除：</strong>点击群组行右侧的 🗑️ 按钮，可以删除该群组及其所有相关数据（包括账单、设置、操作员等）。此操作不可恢复。
                              </p>
                              <p className="text-sm text-slate-600">
                                <strong>批量删除：</strong>勾选多个群组前的复选框，然后点击"删除选中"按钮，可以批量删除选中的群组。此操作不可恢复。
                              </p>
                            </div>
                            
                            <div>
                              <h3 className="font-semibold text-slate-900 mb-2">⚙️ 快捷设置</h3>
                              <p className="text-sm text-slate-600 mb-2">
                                点击群组行左侧的展开按钮（▶），可以展开该群组的快捷设置，包括：
                              </p>
                              <ul className="list-disc list-inside text-sm text-slate-600 space-y-1">
                                <li><strong>功能开关：</strong>基础记账等功能的启用/禁用</li>
                                <li><strong>地址验证：</strong>启用后检测钱包地址变更并提醒</li>
                                <li><strong>删除账单确认：</strong>启用后删除账单需要二次确认</li>
                                <li><strong>计算器：</strong>启用后支持数学计算功能（如288-32、288*2等）</li>
                              </ul>
                              <p className="text-sm text-slate-600 mt-2">
                                快捷设置与群组设置页面的设置保持同步，修改后会立即生效。
                              </p>
                            </div>
                            
                            <div>
                              <h3 className="font-semibold text-slate-900 mb-2">➕ 手动添加群组</h3>
                              <p className="text-sm text-slate-600 mb-2">
                                如果机器人已经在群组中，但群组管理中没有显示，可以使用"手动添加群"功能：
                              </p>
                              <ol className="list-decimal list-inside text-sm text-slate-600 space-y-1">
                                <li>点击"手动添加群"按钮</li>
                                <li>输入群组的 Chat ID（格式：-1001234567890）</li>
                                <li>选择要绑定的机器人</li>
                                <li>点击"确定添加"</li>
                              </ol>
                              <p className="text-sm text-slate-600 mt-2">
                                手动添加的群组，邀请人/方式会显示为"手动"。
                              </p>
                            </div>
                            
                            <div>
                              <h3 className="font-semibold text-slate-900 mb-2">👤 邀请人/方式</h3>
                              <p className="text-sm text-slate-600 mb-2">
                                此列显示将机器人邀请到群组的用户信息：
                              </p>
                              <ul className="list-disc list-inside text-sm text-slate-600 space-y-1">
                                <li>如果显示用户名（如 @Thy1cc），表示该用户邀请的机器人</li>
                                <li>如果显示"手动"，表示该群组是通过"手动添加群"功能添加的</li>
                                <li>如果显示"-"，表示无法获取邀请人信息（可能是旧数据或机器人被踢出后重新加入）</li>
                              </ul>
                            </div>
                          </DialogDescription>
                        </DialogHeader>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <div className="text-sm text-slate-600 mt-1">{groupsCount === 0 ? '暂无群组' : (groupsCount == null ? '加载中...' : `共 ${groupsCount} 个群组`)}</div>
                </div>
                <div className="flex gap-2">
                  {selectedGroups.size > 0 && (
                    <button
                      className="px-3 py-1.5 text-sm border rounded-md hover:bg-red-50 text-red-600 font-medium"
                      onClick={() => {
                        showConfirm(
                          '批量删除群组',
                          `确认删除选中的 ${selectedGroups.size} 个群组及其相关数据？此操作不可恢复`,
                          async () => {
                            let successCount = 0
                            let failCount = 0
                            
                            for (const chatId of selectedGroups) {
                              try {
                                const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' })
                                if (res.status === 204) {
                                  successCount++
                                } else {
                                  failCount++
                                }
                              } catch {
                                failCount++
                              }
                            }
                            
                            setSelectedGroups(new Set())
                            toast({ title: '批量删除完成', description: `成功：${successCount} 个，失败：${failCount} 个` })
                            
                            // 重新加载群列表
                            setTimeout(() => window.location.reload(), 500)
                          }
                        )
                      }}
                    >🗑️ 删除选中 ({selectedGroups.size})</button>
                  )}
                  <button
                    className="px-3 py-1.5 text-sm border rounded-md hover:bg-blue-50 text-blue-600 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={batchSaving || groups.length === 0}
                    onClick={() => {
                      showConfirm(
                        '批量保存设置',
                        `确认保存所有 ${groups.length} 个群组的设置？`,
                        async () => {
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
                          toast({ title: '批量保存完成', description: `成功：${successCount} 个，失败：${failCount} 个` })
                          
                          // 清除缓存，重新加载
                          if (typeof window !== 'undefined') {
                            localStorage.removeItem('dashboard_cache_groups')
                            localStorage.removeItem('dashboard_cache_bots')
                          }
                          setTimeout(() => window.location.reload(), 1000)
                        }
                      )
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
                <>
                  {/* 🔥 新增：邀请人筛选下拉框 */}
                  <div className="mb-4 flex items-center gap-3">
                    <label className="text-sm font-medium text-slate-700">按邀请人筛选：</label>
                    <select
                      className="border rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[150px]"
                      value={inviterFilter}
                      onChange={(e) => setInviterFilter(e.target.value)}
                    >
                      <option value="全部">全部</option>
                      {inviterOptions.map(username => (
                        <option key={username} value={username}>{username}</option>
                      ))}
                    </select>
                    <span className="text-sm text-slate-500">
                      （显示 {filteredGroups.length} 个群组）
                    </span>
                  </div>
                  
                  <div className="w-full">
                    <table className="w-full border-collapse">
                    <thead className="bg-slate-50">
                      <tr className="border-b-2 border-slate-200">
                        <th className="text-center py-3 px-3 text-sm font-semibold text-slate-700 w-[4%]">
                          <input
                            type="checkbox"
                            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                            checked={filteredGroups.length > 0 && selectedGroups.size === filteredGroups.length}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedGroups(new Set(filteredGroups.map(g => g.id)))
                              } else {
                                setSelectedGroups(new Set())
                              }
                            }}
                          />
                        </th>
                        <th className="text-left py-3 px-3 text-sm font-semibold text-slate-700 w-[11%]">Chat ID</th>
                        <th className="text-left py-3 px-3 text-sm font-semibold text-slate-700 w-[15%]">群组名称</th>
                        <th className="text-left py-3 px-3 text-sm font-semibold text-slate-700 w-[15%]">绑定机器人</th>
                        <th className="text-left py-3 px-3 text-sm font-semibold text-slate-700 w-[12%]">邀请人/方式</th>
                        <th className="text-center py-3 px-3 text-sm font-semibold text-slate-700 w-[10%]">允许使用</th>
                        <th className="text-left py-3 px-3 text-sm font-semibold text-slate-700 w-[16%]">创建时间</th>
                        <th className="text-center py-3 px-3 text-sm font-semibold text-slate-700 w-[20%]">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGroups.map((it, idx) => {
                          const draft = drafts[it.id] || { status: 'PENDING', botId: it.botId ?? null, allowed: !!it.allowed }
                          // 🔥 使用数据库返回的邀请人信息，优先使用 invitedByUsername，如果没有则使用手动添加标记
                          const inviterLabel = it.invitedByUsername || (manualAddedSet.has(it.id) ? '手动' : '-')
                        return (
                          <Fragment key={it.id}>
                            <tr className={`border-b hover:bg-slate-50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-25'}`}>
                              <td className="py-3 px-3 text-center">
                                <input
                                  type="checkbox"
                                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                  checked={selectedGroups.has(it.id)}
                                  onChange={(e) => {
                                    const newSelected = new Set(selectedGroups)
                                    if (e.target.checked) {
                                      newSelected.add(it.id)
                                    } else {
                                      newSelected.delete(it.id)
                                    }
                                    setSelectedGroups(newSelected)
                                  }}
                                />
                              </td>
                              <td className="py-3 px-3 text-sm text-slate-900 font-mono truncate" title={it.id}>{it.id}</td>
                              <td className="py-3 px-3 text-sm text-slate-900 font-medium truncate" title={it.title || '-'}>{it.title || '-'}</td>
                              <td className="py-3 px-3">
                                <select
                                  className="border rounded-md px-2 py-1.5 text-xs w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                              <td className="py-3 px-3 text-sm text-slate-900 truncate" title={inviterLabel}>{inviterLabel}</td>
                              <td className="py-3 px-3 text-center">
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
                              </td>
                              <td className="py-3 px-3 text-xs text-slate-600">{new Date(it.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                              <td className="py-3 px-3">
                                <div className="flex items-center justify-center gap-1 flex-wrap">
                                  <button
                                    className="px-2.5 py-1 text-xs border rounded hover:bg-slate-50 whitespace-nowrap"
                                    onClick={() => router.push(`/dashboard?chatId=${encodeURIComponent(it.id)}`)}
                                  >📊 账单</button>
                                  <button
                                    className="px-2.5 py-1 text-xs border rounded hover:bg-slate-50 whitespace-nowrap"
                                    onClick={async () => {
                                      setExpandedRows((r) => ({ ...r, [it.id]: !r[it.id] }))
                                      const chatId = it.id
                                      // 总是重新拉取，避免命令操作与UI不同步
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
                                      // 同步拉取快捷设置（计算器等）
                                      setQuickSettingsCache((c) => ({ ...c, [chatId]: { addressVerificationEnabled: false, deleteBillConfirm: false, calculatorEnabled: true, loading: true } }))
                                      try {
                                        const sres = await fetch(`/api/chats/${encodeURIComponent(chatId)}/settings`)
                                        if (sres.ok) {
                                          const json = await sres.json()
                                          const settings = json?.settings || {}
                                          setQuickSettingsCache((c) => ({ ...c, [chatId]: {
                                            addressVerificationEnabled: settings.addressVerificationEnabled ?? false,
                                            deleteBillConfirm: settings.deleteBillConfirm ?? false,
                                            calculatorEnabled: settings.calculatorEnabled ?? true,
                                            loading: false
                                          }}))
                                        } else {
                                          setQuickSettingsCache((c) => ({ ...c, [chatId]: { addressVerificationEnabled: false, deleteBillConfirm: false, calculatorEnabled: true, loading: false } }))
                                        }
                                      } catch {
                                        setQuickSettingsCache((c) => ({ ...c, [chatId]: { addressVerificationEnabled: false, deleteBillConfirm: false, calculatorEnabled: true, loading: false } }))
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
                                        toast({ title: '成功', description: '保存成功' })
                                      } catch (e) {
                                        toast({ title: '错误', description: `保存失败：${(e as Error).message}`, variant: 'destructive' })
                                      } finally {
                                        setSaving((s) => ({ ...s, [it.id]: false }))
                                      }
                                    }}
                                  >{saving[it.id] ? '⏳' : '💾'}</button>
                                  <button
                                    className="px-2.5 py-1 text-xs border rounded hover:bg-red-50 text-red-600 whitespace-nowrap"
                                    onClick={() => {
                                      showConfirm(
                                        '删除群组',
                                        '确认删除该群组及其相关数据？此操作不可恢复',
                                        async () => {
                                          try {
                                            const res = await fetch(`/api/chats/${encodeURIComponent(it.id)}`, { method: 'DELETE' })
                                            if (res.status === 204) {
                                              setGroups((prev) => prev.filter((g) => g.id !== it.id))
                                              const n = (groupsCount || 0) - 1
                                              setGroupsCount(n < 0 ? 0 : n)
                                              toast({ title: '成功', description: '删除成功' })
                                            } else {
                                              const msg = await res.text().catch(() => '')
                                              toast({ title: '错误', description: `删除失败：${msg || 'Server error'}`, variant: 'destructive' })
                                            }
                                          } catch {
                                            toast({ title: '错误', description: '删除失败：网络错误', variant: 'destructive' })
                                          }
                                        }
                                      )
                                    }}
                                  >🗑️</button>
                                </div>
                              </td>
                            </tr>
                            {expandedRows[it.id] && (
                              <tr>
                                <td colSpan={7} className="bg-slate-50 p-3">
                                  <div className="space-y-4">
                                    {/* 功能开关 */}
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
                                              const fres = await fetch(`/api/chats/${encodeURIComponent(chatId)}/features`)
                                              if (fres.ok) {
                                                const json = await fres.json().catch(() => ({}))
                                                const items = Array.isArray(json?.items) ? json.items : []
                                                setFeatureCache((c) => ({ ...c, [chatId]: { items } }))
                                              }
                                              toast({ title: '成功', description: '已保存功能开关' })
                                            } catch (e) {
                                              toast({ title: '错误', description: (e as Error).message, variant: 'destructive' })
                                            } finally {
                                              setFeatureSaving((s) => ({ ...s, [chatId]: false }))
                                            }
                                          }}
                                        >{featureSaving[it.id] ? '保存中...' : '保存功能'}</button>
                                      </div>
                                    </div>
                                    
                                    {/* 🔥 快捷设置 */}
                                    <div>
                                      <div className="text-sm text-slate-700 mb-2">快捷设置</div>
                                      <div className="flex flex-wrap gap-4 items-center">
                                        <label className="inline-flex items-center gap-2 text-sm">
                                          <input
                                            type="checkbox"
                                            checked={quickSettingsCache[it.id]?.addressVerificationEnabled ?? false}
                                            onChange={(e) => {
                                              const chatId = it.id
                                              setQuickSettingsCache((c) => ({
                                                ...c,
                                                [chatId]: { ...(c[chatId] || { addressVerificationEnabled: false, deleteBillConfirm: false, calculatorEnabled: true }), addressVerificationEnabled: e.target.checked }
                                              }))
                                            }}
                                          />
                                          <span>地址验证</span>
                                        </label>
                                        <label className="inline-flex items-center gap-2 text-sm">
                                          <input
                                            type="checkbox"
                                            checked={quickSettingsCache[it.id]?.deleteBillConfirm ?? false}
                                            onChange={(e) => {
                                              const chatId = it.id
                                              setQuickSettingsCache((c) => ({
                                                ...c,
                                                [chatId]: { ...(c[chatId] || { addressVerificationEnabled: false, deleteBillConfirm: false, calculatorEnabled: true }), deleteBillConfirm: e.target.checked }
                                              }))
                                            }}
                                          />
                                          <span>删除账单确认</span>
                                        </label>
                                        <label className="inline-flex items-center gap-2 text-sm">
                                          <input
                                            type="checkbox"
                                            checked={quickSettingsCache[it.id]?.calculatorEnabled ?? true}
                                            onChange={(e) => {
                                              const chatId = it.id
                                              setQuickSettingsCache((c) => ({
                                                ...c,
                                                [chatId]: { ...(c[chatId] || { addressVerificationEnabled: false, deleteBillConfirm: false, calculatorEnabled: true }), calculatorEnabled: e.target.checked }
                                              }))
                                            }}
                                          />
                                          <span>计算器</span>
                                        </label>
                                        <button
                                          className="px-3 py-1.5 text-sm border rounded-md hover:bg-slate-50 disabled:opacity-50"
                                          disabled={quickSettingsSaving[it.id]}
                                          onClick={async () => {
                                            const chatId = it.id
                                            const settings = quickSettingsCache[chatId]
                                            if (!settings) return
                                            setQuickSettingsSaving((s) => ({ ...s, [chatId]: true }))
                                            try {
                                              const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/settings`, {
                                                method: 'PATCH',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                  addressVerificationEnabled: settings.addressVerificationEnabled,
                                                  deleteBillConfirm: settings.deleteBillConfirm,
                                                  calculatorEnabled: settings.calculatorEnabled
                                                })
                                              })
                                              if (!res.ok) {
                                                const msg = await res.text().catch(() => '')
                                                throw new Error(msg || '保存快捷设置失败')
                                              }
                                              toast({ title: '成功', description: '已保存快捷设置' })
                                            } catch (e) {
                                              toast({ title: '错误', description: (e as Error).message, variant: 'destructive' })
                                            } finally {
                                              setQuickSettingsSaving((s) => ({ ...s, [chatId]: false }))
                                            }
                                          }}
                                        >{quickSettingsSaving[it.id] ? '保存中...' : '保存设置'}</button>
                                      </div>
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
              </>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6 mt-6">
            <StatisticsCards 
              currentDate={currentDate} 
              chatId={chatId}
              onBillDataChange={handleBillDataChange}
            />
            <TransactionTables currentDate={currentDate} chatId={chatId} />
            <CategoryStats currentDate={currentDate} chatId={chatId} />
          </div>
        )}
      </div>
      
      {/* 🔥 确认对话框 */}
      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmDialog(prev => ({ ...prev, open: false }))}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirmDialog.onConfirm()
                setConfirmDialog(prev => ({ ...prev, open: false }))
              }}
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

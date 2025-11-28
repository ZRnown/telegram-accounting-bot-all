"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useEffect, useState, useMemo, useCallback, useRef } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { formatDateString } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

interface StatisticsCardsProps {
  currentDate: Date
  chatId?: string
  onBillDataChange?: (data: any) => void // 🔥 传递账单数据给父组件
}

export function StatisticsCards({ currentDate, chatId, onBillDataChange }: StatisticsCardsProps) {
  const [data, setData] = useState<any | null>(null)
  const [pick, setPick] = useState<number | ''>('')
  const [settings, setSettings] = useState<any>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const { toast } = useToast()
  // 🔥 使用 useRef 保存回调，避免依赖变化导致重新渲染
  const onBillDataChangeRef = useRef(onBillDataChange)
  useEffect(() => {
    onBillDataChangeRef.current = onBillDataChange
  }, [onBillDataChange])
  
  // 🔥 从URL参数读取账单索引（累计模式）
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const billParam = params.get('bill')
    if (billParam) {
      const billIndex = Number(billParam)
      if (!isNaN(billIndex) && billIndex > 0) {
        setPick(billIndex)
      }
    }
  }, [])

  // 🔥 加载群组设置（判断是否累计模式）- 使用useMemo缓存结果
  useEffect(() => {
    if (!chatId) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/settings`)
        if (res.ok && !cancelled) {
          const json = await res.json()
          setSettings(json.settings)
        }
      } catch (e) {
        if (!cancelled) console.error('加载设置失败', e)
      }
    }
    load()
    return () => { cancelled = true }
  }, [chatId])

  // 🔥 使用 useMemo 优化日期字符串计算
  const dateStr = useMemo(() => formatDateString(currentDate), [currentDate])

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const params = new URLSearchParams()
        params.set('date', dateStr)
        if (pick) params.set('bill', String(pick))
        if (chatId) params.set('chatId', chatId)
        const res = await fetch(`/api/stats/today?${params.toString()}`, { signal: controller.signal })
        if (!res.ok) throw new Error('failed')
        const json = await res.json()
        setData(json)
        // 🔥 传递账单时间数据给父组件（仅传递必要数据）
        if (onBillDataChangeRef.current) {
          onBillDataChangeRef.current(json)
        }
        // 🔥 性能优化：只在没有选择时才自动选择，避免不必要的状态更新
        if (!pick) {
          if (json?.selectedBillIndex) {
            setPick(json.selectedBillIndex)
          } else if (json?.billNumber > 0) {
            setPick(json.billNumber)
          } else {
            setPick('')
          }
        }
      } catch (e) {
        if ((e as any).name !== 'AbortError') console.error('加载数据失败', e)
      }
    }
    load()
    return () => controller.abort()
  }, [dateStr, pick, chatId]) // 🔥 移除 onBillDataChange 依赖，使用 useRef 或直接调用

  // 🔥 使用 useMemo 优化计算结果
  const isCumulativeMode = useMemo(() => settings?.accountingMode === 'CARRY_OVER', [settings?.accountingMode])
  const hasCarryOver = useMemo(() => Boolean(data?.carryOver && data.carryOver > 0), [data?.carryOver])

  const view = useMemo(() => {
    if (!data) return null as any
    const list = Array.isArray(data.bills) ? data.bills : []
    if (!list.length) return data
    const idx = pick ? (Number(pick) - 1) : (list.length - 1)
    const b = list[idx]
    if (!b) return data
    // 🔥 性能优化：避免创建新对象，直接合并
    return { ...data, ...b }
  }, [data, pick])

  // 🔥 使用 useCallback 优化事件处理
  const handleBillChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = Number(e.target.value)
    setPick(v)
    if (v > 0) {
      window.dispatchEvent(new CustomEvent('goto-bill', { detail: { type: 'income', index: v } }))
    }
  }, [])

  // 🔥 删除当前账单
  const handleDeleteBill = useCallback(async () => {
    if (!data?.selectedBillId || !pick) {
      toast({ title: '错误', description: '请先选择要删除的账单', variant: 'destructive' })
      return
    }
    
    setDeleteDialogOpen(true)
  }, [data, pick, toast])
  
  // 🔥 确认删除
  const handleConfirmDelete = useCallback(async () => {
    if (!data?.selectedBillId) return
    
    setDeleting(true)
    setDeleteDialogOpen(false)
    try {
      const res = await fetch(`/api/bills/${encodeURIComponent(data.selectedBillId)}`, { method: 'DELETE' })
      if (res.status === 204) {
        toast({ title: '成功', description: '账单已删除' })
        // 🔥 刷新数据
        window.location.reload()
      } else {
        const msg = await res.text().catch(() => '')
        toast({ title: '错误', description: `删除失败：${msg || 'Server error'}`, variant: 'destructive' })
      }
    } catch (e) {
      toast({ title: '错误', description: '删除失败：网络错误', variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }, [data, toast])

  if (!data || !view) return null
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          今日账单统计
          {/* 🔥 累计模式提醒 */}
          {isCumulativeMode && (
            <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
              累计模式
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
            <span className="text-sm text-slate-600">第</span>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-slate-900">{(data.billNumber ?? 0)} 笔账单</span>
              {data.billNumber > 0 && (
                <>
                  <select
                    className="text-xs border border-slate-300 rounded px-2 py-1"
                    value={pick as any}
                    onChange={handleBillChange}
                  >
                    <option value="">选择第几笔</option>
                    {Array.from({ length: data.billNumber }, (_, i) => {
                      const n = i + 1
                      const label = Array.isArray(data.billLabels) && data.billLabels[i] 
                        ? data.billLabels[i] 
                        : `第 ${n} 笔`
                      return (
                        <option key={n} value={n}>{label}</option>
                      )
                    })}
                  </select>
                  {pick && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleDeleteBill}
                      disabled={deleting}
                      className="text-xs h-7 px-2"
                    >
                      {deleting ? '删除中...' : '删除当前账单'}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
            <span className="text-sm text-slate-600">总入款金额</span>
            <span className="text-lg font-semibold text-green-600">{(view.totalIncome ?? 0).toLocaleString()}</span>
          </div>

          <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
            <span className="text-sm text-slate-600">汇率</span>
            <span className="text-lg font-semibold text-slate-900">{view.exchangeRate ?? 0}</span>
          </div>

          <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
            <span className="text-sm text-slate-600">费率</span>
            <span className="text-lg font-semibold text-slate-900">{view.feeRate ?? 0}%</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <div className="p-3 bg-blue-50 rounded-lg">
            <div className="text-xs text-slate-600 mb-1">应下发</div>
            <div className="font-semibold text-slate-900">{(view.shouldDispatch ?? 0).toLocaleString()}</div>
            <div className="text-sm text-blue-600">{(view.shouldDispatchUSDT ?? 0).toFixed(2)} USDT</div>
          </div>

          <div className="p-3 bg-green-50 rounded-lg">
            <div className="text-xs text-slate-600 mb-1">已下发</div>
            <div className="font-semibold text-slate-900">{(view.dispatched ?? 0).toLocaleString()}</div>
            <div className="text-sm text-green-600">{(view.dispatchedUSDT ?? 0).toFixed(2)} USDT</div>
          </div>

          <div className="p-3 bg-orange-50 rounded-lg">
            <div className="text-xs text-slate-600 mb-1">未下发</div>
            <div className="font-semibold text-slate-900">{(view.notDispatched ?? 0).toLocaleString()}</div>
            <div className="text-sm text-orange-600">{(view.notDispatchedUSDT ?? 0).toFixed(2)} USDT</div>
          </div>
        </div>
        
      </CardContent>
      
      {/* 🔥 删除确认对话框 */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除当前账单吗？此操作不可恢复！
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDialogOpen(false)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={deleting}>
              {deleting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

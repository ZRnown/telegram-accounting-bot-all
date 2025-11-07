"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useEffect, useState, useMemo, useCallback } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { formatDateString } from "@/lib/utils"

interface StatisticsCardsProps {
  currentDate: Date
  chatId?: string
}

export function StatisticsCards({ currentDate, chatId }: StatisticsCardsProps) {
  const [data, setData] = useState<any | null>(null)
  const [pick, setPick] = useState<number | ''>('')
  const [settings, setSettings] = useState<any>(null)

  // 🔥 加载群组设置（判断是否累计模式）
  useEffect(() => {
    if (!chatId) return
    const load = async () => {
      try {
        const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/settings`)
        if (res.ok) {
          const json = await res.json()
          setSettings(json.settings)
        }
      } catch (e) {
        console.error('加载设置失败', e)
      }
    }
    load()
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
        // default select latest bill if any (respect existing pick)
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
        if ((e as any).name !== 'AbortError') console.error(e)
      }
    }
    load()
    return () => controller.abort()
  }, [dateStr, pick, chatId])

  // 🔥 使用 useMemo 优化计算结果
  const isCumulativeMode = useMemo(() => settings?.accountingMode === 'CARRY_OVER', [settings?.accountingMode])
  const hasCarryOver = useMemo(() => data?.carryOver && data.carryOver > 0, [data?.carryOver])

  const view = useMemo(() => {
    if (!data) return null as any
    const list = Array.isArray(data.bills) ? data.bills : []
    if (!list.length) return data
    const idx = pick ? (Number(pick) - 1) : (list.length - 1)
    const b = list[idx]
    if (!b) return data
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
        {/* 🔥 累计模式提醒 */}
        {isCumulativeMode && hasCarryOver && (
          <Alert className="bg-amber-50 border-amber-200">
            <AlertDescription className="text-sm text-amber-800">
              📊 当前为累计模式，账单包含历史未下发金额。查看下方"账单拆解"了解详情。
            </AlertDescription>
          </Alert>
        )}
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
            <span className="text-sm text-slate-600">当日第</span>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-slate-900">{data.billNumber} 笔账单</span>
              {data.billNumber > 0 && (
                <select
                  className="text-xs border border-slate-300 rounded px-2 py-1"
                  value={pick as any}
                  onChange={handleBillChange}
                >
                  <option value="">选择第几笔</option>
                  {Array.from({ length: data.billNumber }, (_, i) => i + 1).map((n) => {
                    const label = Array.isArray(data.billLabels) && data.billLabels[n - 1] 
                      ? data.billLabels[n - 1] 
                      : `第 ${n} 笔`
                    return (
                      <option key={n} value={n}>{label}</option>
                    )
                  })}
                </select>
              )}
            </div>
          </div>

          <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
            <span className="text-sm text-slate-600">总入款金额</span>
            <span className="text-lg font-semibold text-green-600">{view.totalIncome.toLocaleString()}</span>
          </div>

          <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
            <span className="text-sm text-slate-600">汇率</span>
            <span className="text-lg font-semibold text-slate-900">{view.exchangeRate}</span>
          </div>

          <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
            <span className="text-sm text-slate-600">费率</span>
            <span className="text-lg font-semibold text-slate-900">{view.feeRate}%</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <div className="p-3 bg-blue-50 rounded-lg">
            <div className="text-xs text-slate-600 mb-1">应下发</div>
            <div className="font-semibold text-slate-900">{view.shouldDispatch.toLocaleString()}</div>
            <div className="text-sm text-blue-600">{view.shouldDispatchUSDT.toFixed(2)} USDT</div>
          </div>

          <div className="p-3 bg-green-50 rounded-lg">
            <div className="text-xs text-slate-600 mb-1">已下发</div>
            <div className="font-semibold text-slate-900">{view.dispatched.toLocaleString()}</div>
            <div className="text-sm text-green-600">{view.dispatchedUSDT.toFixed(2)} USDT</div>
          </div>

          <div className="p-3 bg-orange-50 rounded-lg">
            <div className="text-xs text-slate-600 mb-1">未下发</div>
            <div className="font-semibold text-slate-900">{view.notDispatched.toLocaleString()}</div>
            <div className="text-sm text-orange-600">{view.notDispatchedUSDT.toFixed(2)} USDT</div>
          </div>
        </div>
        
        {/* 🔥 累计模式账单拆解 - 只显示历史未下发（如果有） */}
        {isCumulativeMode && hasCarryOver && (
          <div className="pt-2 border-t border-slate-200">
            <div className="text-sm font-medium text-slate-700 mb-2">📊 账单拆解（累计模式）</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                <div className="text-xs text-slate-600 mb-1">历史未下发</div>
                <div className="font-semibold text-slate-900">{(data.carryOver || 0).toLocaleString()}</div>
                <div className="text-xs text-amber-600">昨天及之前累计的未下发</div>
              </div>
            </div>
            <div className="mt-2 p-2 bg-blue-50 rounded text-xs text-blue-700">
              💡 提示：应下发 = 当前账单入款（扣除费率后）{hasCarryOver ? ' + 历史未下发' : ''}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

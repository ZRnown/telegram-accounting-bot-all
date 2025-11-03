"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useEffect, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"

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

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const params = new URLSearchParams()
        params.set('date', currentDate.toISOString().slice(0, 10))
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
  }, [currentDate, pick, chatId])

  // 🔥 性能优化：移除无用的 effect

  if (!data) return null
  
  // 🔥 判断是否累计模式
  const isCumulativeMode = settings?.accountingMode === 'CARRY_OVER'
  const hasCarryOver = data.carryOver && data.carryOver > 0

  const view = (() => {
    if (!data) return null as any
    const list = Array.isArray(data.bills) ? data.bills : []
    if (!list.length) return data
    const idx = pick ? (Number(pick) - 1) : (list.length - 1)
    const b = list[idx]
    if (!b) return data
    return { ...data, ...b }
  })()

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
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setPick(v)
                    if (v > 0) {
                      window.dispatchEvent(new CustomEvent('goto-bill', { detail: { type: 'income', index: v } }))
                    }
                  }}
                >
                  <option value="">选择第几笔</option>
                  {Array.from({ length: data.billNumber }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{`第 ${n} 笔`}</option>
                  ))}
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
        
        {/* 🔥 累计模式账单拆解 */}
        {isCumulativeMode && hasCarryOver && (
          <div className="pt-2 border-t border-slate-200">
            <div className="text-sm font-medium text-slate-700 mb-2">📊 账单拆解（累计模式）</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                <div className="text-xs text-slate-600 mb-1">今日入款</div>
                <div className="font-semibold text-slate-900">{view.totalIncome.toLocaleString()}</div>
                <div className="text-xs text-green-600">当天新增的入款金额</div>
              </div>
              
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                <div className="text-xs text-slate-600 mb-1">历史未下发</div>
                <div className="font-semibold text-slate-900">{(data.carryOver || 0).toLocaleString()}</div>
                <div className="text-xs text-amber-600">昨天及之前累计的未下发</div>
              </div>
            </div>
            <div className="mt-2 p-2 bg-blue-50 rounded text-xs text-blue-700">
              💡 提示：应下发 = 今日入款 + 历史未下发
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

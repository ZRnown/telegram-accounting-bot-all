"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useEffect, useState, useMemo } from "react"
import { formatDateString } from "@/lib/utils"

interface CategoryStatsProps {
  currentDate: Date
  chatId?: string
}

export function CategoryStats({ currentDate, chatId }: CategoryStatsProps) {
  const [data, setData] = useState<any | null>(null)

  // 🔥 使用 useMemo 优化日期字符串计算
  const dateStr = useMemo(() => formatDateString(currentDate), [currentDate])

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const params = new URLSearchParams()
        params.set('date', dateStr)
        if (chatId) params.set('chatId', chatId)
        const res = await fetch(`/api/stats/today?${params.toString()}`, { signal: controller.signal })
        if (!res.ok) throw new Error('failed')
        const json = await res.json()
        setData(json)
      } catch (e) {
        if ((e as any).name !== 'AbortError') console.error(e)
      }
    }
    load()
    return () => controller.abort()
  }, [dateStr, chatId])

  if (!data) return null

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">入款回复人分类</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(data.incomeByReplier).map(([name, amount]) => (
              <div key={name} className="flex justify-between items-center p-2 bg-slate-50 rounded">
                <span className="text-sm text-slate-600">{name}</span>
                <span className="text-sm font-semibold text-slate-900">{(amount as number).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">入款操作人分类</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(data.incomeByOperator).map(([name, amount]) => (
              <div key={name} className="flex justify-between items-center p-2 bg-slate-50 rounded">
                <span className="text-sm text-slate-600">{name}</span>
                <span className="text-sm font-semibold text-slate-900">{(amount as number).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">入款汇率分类</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(data.incomeByRate).map(([rate, amount]) => (
              <div key={rate} className="flex justify-between items-center p-2 bg-slate-50 rounded">
                <span className="text-sm text-slate-600">汇率 {rate}</span>
                <span className="text-sm font-semibold text-slate-900">{(amount as number).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">下发操作人分类</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(data.dispatchByOperator || {}).length > 0 ? (
              Object.entries(data.dispatchByOperator).map(([name, amount]) => (
                <div key={name} className="flex justify-between items-center p-2 bg-slate-50 rounded">
                  <span className="text-sm text-slate-600">{name}</span>
                  <span className="text-sm font-semibold text-slate-900">{(amount as number).toLocaleString()}</span>
                </div>
              ))
            ) : (
              <div className="text-sm text-slate-500 text-center py-4">暂无数据</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

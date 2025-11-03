"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useEffect, useState } from "react"

interface TransactionTablesProps {
  currentDate: Date
  chatId?: string
}

export function TransactionTables({ currentDate, chatId }: TransactionTablesProps) {
  const [data, setData] = useState<any | null>(null)
  const [pick, setPick] = useState<number | ''>('')
  // 🔥 删除无用的 incomeRefs，不再需要高亮功能

  // 🔥 格式化本地日期字符串（避免时区问题）
  const formatDateString = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  // 🔥 判断是否是今天（使用本地日期比较）
  const isToday = (date: Date) => {
    const today = new Date()
    return formatDateString(date) === formatDateString(today)
  }

  // 🔥 修复：监听账单选择事件，确保与 StatisticsCards 组件同步
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { type?: string; index?: number }
      if (detail?.index && detail.index > 0) {
        // 🔥 立即更新 pick 状态，触发数据重新加载
        setPick(detail.index)
      }
    }
    window.addEventListener('goto-bill', handler as any)
    return () => window.removeEventListener('goto-bill', handler as any)
  }, [])
  
  // 🔥 修复：当日期变化时，重置 pick 状态，避免使用旧的账单索引
  useEffect(() => {
    setPick('')
  }, [currentDate, chatId])

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const params = new URLSearchParams()
        params.set('date', formatDateString(currentDate))
        if (pick) params.set('bill', String(pick))
        if (chatId) params.set('chatId', chatId)
        const res = await fetch(`/api/stats/today?${params.toString()}`, { signal: controller.signal })
        if (!res.ok) throw new Error('failed')
        const json = await res.json()
        setData(json)
        // 🔥 修复：只在没有主动选择账单时才设置默认值
        if (!pick && json?.selectedBillIndex) {
          setPick(json.selectedBillIndex)
        }
      } catch (e) {
        if ((e as any).name !== 'AbortError') console.error(e)
      }
    }
    load()
    
    // 🔥 优化：添加轮询机制，每5秒自动刷新数据（仅当日期是今天时）
    const isTodayDate = isToday(currentDate)
    let intervalId: NodeJS.Timeout | null = null
    if (isTodayDate) {
      intervalId = setInterval(() => {
        if (!controller.signal.aborted) {
          load().catch((e) => {
            if ((e as any).name !== 'AbortError') console.error(e)
          })
        }
      }, 5000) // 每5秒刷新一次
    }
    
    return () => {
      controller.abort()
      if (intervalId) clearInterval(intervalId)
    }
  }, [currentDate, pick, chatId])

  // 🔥 删除高亮闪烁的无用逻辑

  if (!data) return null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">入款记录</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>金额</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead>回复人</TableHead>
                  <TableHead>操作人</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.incomeRecords.length > 0 ? (
                  data.incomeRecords.map((record: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell className="text-xs">{record.time}</TableCell>
                      <TableCell className="text-xs font-medium">{record.amount}</TableCell>
                      <TableCell className="text-xs text-slate-500">{record.remark || '-'}</TableCell>
                      <TableCell className="text-xs">{record.replier}</TableCell>
                      <TableCell className="text-xs">{record.operator}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500">
                      暂无数据
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">下发记录</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>金额</TableHead>
                  <TableHead>回复人</TableHead>
                  <TableHead>操作人</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.dispatchRecords.length > 0 ? (
                  data.dispatchRecords.map((record: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell className="text-xs">{record.time}</TableCell>
                      <TableCell className="text-xs font-medium">{record.amount}</TableCell>
                      <TableCell className="text-xs">{record.replier}</TableCell>
                      <TableCell className="text-xs">{record.operator}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-slate-500">
                      暂无数据
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

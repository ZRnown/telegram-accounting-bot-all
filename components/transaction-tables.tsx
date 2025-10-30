"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useEffect, useRef, useState } from "react"

interface TransactionTablesProps {
  currentDate: Date
  chatId?: string
}

export function TransactionTables({ currentDate, chatId }: TransactionTablesProps) {
  const [data, setData] = useState<any | null>(null)
  const [pick, setPick] = useState<number | ''>('')
  const incomeRefs = useRef<HTMLTableRowElement[]>([])

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
        if (!pick && json?.selectedBillIndex) setPick(json.selectedBillIndex)
      } catch (e) {
        if ((e as any).name !== 'AbortError') console.error(e)
      }
    }
    load()
    return () => controller.abort()
  }, [currentDate, pick, chatId])

  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { type: 'income'|'dispatch'; index: number }
      if (!detail) return
      // 切换账单选择并高亮对应行（若存在）
      if (detail.index > 0) setPick(detail.index)
      if (detail.type === 'income') {
        const idx = detail.index - 1
        const row = incomeRefs.current[idx]
        if (row) {
          row.scrollIntoView({ behavior: 'smooth', block: 'center' })
          row.classList.add('bg-yellow-50')
          setTimeout(() => row.classList.remove('bg-yellow-50'), 1500)
        }
      }
    }
    window.addEventListener('goto-bill', handler as any)
    return () => window.removeEventListener('goto-bill', handler as any)
  }, [])

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
                  <TableHead>回复人</TableHead>
                  <TableHead>操作人</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.incomeRecords.length > 0 ? (
                  data.incomeRecords.map((record: any, index: number) => (
                    <TableRow key={index} ref={(el) => { if (el) incomeRefs.current[index] = el }}>
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

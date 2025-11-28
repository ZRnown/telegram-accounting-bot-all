"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { useEffect, useState, useMemo, useCallback } from "react"
import { formatDateString } from "@/lib/utils"

interface TransactionTablesProps {
  currentDate: Date
  chatId?: string
}

export function TransactionTables({ currentDate, chatId }: TransactionTablesProps) {
  const [data, setData] = useState<any | null>(null)
  const [pick, setPick] = useState<number | ''>('')
  const [incomePaged, setIncomePaged] = useState(true) // 🔥 入款记录是否分页
  const [dispatchPaged, setDispatchPaged] = useState(true) // 🔥 下发记录是否分页
  const [incomePage, setIncomePage] = useState(1) // 🔥 入款记录当前页
  const [dispatchPage, setDispatchPage] = useState(1) // 🔥 下发记录当前页
  const PAGE_SIZE = 10 // 🔥 每页10条记录
  // 🔥 删除无用的 incomeRefs，不再需要高亮功能

  // 🔥 使用 useMemo 优化日期字符串和是否今天的判断
  const dateStr = useMemo(() => formatDateString(currentDate), [currentDate])
  const isTodayDate = useMemo(() => {
    const today = new Date()
    return dateStr === formatDateString(today)
  }, [dateStr])

  // 🔥 使用 useCallback 优化事件处理
  const handleBillEvent = useCallback((ev: Event) => {
    const detail = (ev as CustomEvent).detail as { type?: string; index?: number }
    if (detail?.index && detail.index > 0) {
      setPick(detail.index)
    }
  }, [])

  // 🔥 修复：监听账单选择事件，确保与 StatisticsCards 组件同步
  useEffect(() => {
    window.addEventListener('goto-bill', handleBillEvent as any)
    return () => window.removeEventListener('goto-bill', handleBillEvent as any)
  }, [handleBillEvent])
  
  // 🔥 修复：当日期变化时，重置 pick 状态，避免使用旧的账单索引
  useEffect(() => {
    setPick('')
  }, [currentDate, chatId])

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
  }, [dateStr, pick, chatId, isTodayDate])

  // 🔥 删除高亮闪烁的无用逻辑

  if (!data) return null

  // 🔥 计算分页数据
  const incomeRecords = data.incomeRecords || []
  const dispatchRecords = data.dispatchRecords || []
  const incomeTotalPages = Math.ceil(incomeRecords.length / PAGE_SIZE)
  const dispatchTotalPages = Math.ceil(dispatchRecords.length / PAGE_SIZE)
  const incomeDisplayRecords = incomePaged 
    ? incomeRecords.slice((incomePage - 1) * PAGE_SIZE, incomePage * PAGE_SIZE)
    : incomeRecords
  const dispatchDisplayRecords = dispatchPaged
    ? dispatchRecords.slice((dispatchPage - 1) * PAGE_SIZE, dispatchPage * PAGE_SIZE)
    : dispatchRecords

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-lg">入款记录</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIncomePaged(!incomePaged)
                setIncomePage(1)
              }}
              className="text-xs h-7"
            >
              {incomePaged ? '取消分页' : '启用分页'}
            </Button>
          </div>
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
                {incomeDisplayRecords.length > 0 ? (
                  incomeDisplayRecords.map((record: any, index: number) => (
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
            {incomePaged && incomeTotalPages > 1 && (
              <div className="flex justify-between items-center mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIncomePage(p => Math.max(1, p - 1))}
                  disabled={incomePage === 1}
                  className="text-xs h-7"
                >
                  上一页
                </Button>
                <span className="text-xs text-slate-600">
                  第 {incomePage} / {incomeTotalPages} 页（共 {incomeRecords.length} 条）
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIncomePage(p => Math.min(incomeTotalPages, p + 1))}
                  disabled={incomePage === incomeTotalPages}
                  className="text-xs h-7"
                >
                  下一页
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-lg">下发记录</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDispatchPaged(!dispatchPaged)
                setDispatchPage(1)
              }}
              className="text-xs h-7"
            >
              {dispatchPaged ? '取消分页' : '启用分页'}
            </Button>
          </div>
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
                {dispatchDisplayRecords.length > 0 ? (
                  dispatchDisplayRecords.map((record: any, index: number) => (
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
            {dispatchPaged && dispatchTotalPages > 1 && (
              <div className="flex justify-between items-center mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDispatchPage(p => Math.max(1, p - 1))}
                  disabled={dispatchPage === 1}
                  className="text-xs h-7"
                >
                  上一页
                </Button>
                <span className="text-xs text-slate-600">
                  第 {dispatchPage} / {dispatchTotalPages} 页（共 {dispatchRecords.length} 条）
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDispatchPage(p => Math.min(dispatchTotalPages, p + 1))}
                  disabled={dispatchPage === dispatchTotalPages}
                  className="text-xs h-7"
                >
                  下一页
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

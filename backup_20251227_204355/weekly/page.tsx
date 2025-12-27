"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react"

export default function WeeklyPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/summary')
  }, [router])
  return null
  const [mounted, setMounted] = useState(false)
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(new Date())
  const [summary, setSummary] = useState<any | null>(null)

  useEffect(() => {
    setMounted(true)
    const token = localStorage.getItem("auth_token")
    if (!token) {
      router.push("/")
      return
    }

    // Set to start of current week (Monday)
    const today = new Date()
    const dayOfWeek = today.getDay()
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek // Adjust when day is Sunday
    const monday = new Date(today)
    monday.setDate(today.getDate() + diff)
    monday.setHours(0, 0, 0, 0)
    setCurrentWeekStart(monday)
  }, [router])

  if (!mounted) {
    return null
  }

  const handlePreviousWeek = () => {
    const newDate = new Date(currentWeekStart)
    newDate.setDate(newDate.getDate() - 7)
    setCurrentWeekStart(newDate)
  }

  const handleNextWeek = () => {
    const newDate = new Date(currentWeekStart)
    newDate.setDate(newDate.getDate() + 7)
    setCurrentWeekStart(newDate)
  }

  const weekEnd = new Date(currentWeekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
  }

  useEffect(() => {
    if (!mounted) return
    const controller = new AbortController()
    const load = async () => {
      try {
        const params = new URLSearchParams()
        params.set('start', currentWeekStart.toISOString().slice(0,10))
        const res = await fetch(`/api/stats/weekly?${params.toString()}`, { signal: controller.signal })
        if (!res.ok) throw new Error('failed')
        const json = await res.json()
        setSummary(json)
      } catch (e) {
        if ((e as any).name !== 'AbortError') console.error(e)
      }
    }
    load()
    return () => controller.abort()
  }, [mounted, currentWeekStart])

  if (!summary) return null

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <CardTitle className="text-2xl font-bold">周账单汇总</CardTitle>
              <Button variant="outline" onClick={() => router.back()}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                返回
              </Button>
            </div>
            <div className="flex items-center gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={handlePreviousWeek}>
                <ChevronLeft className="w-4 h-4 mr-1" />
                上一周
              </Button>
              <div className="text-sm font-medium text-slate-700 px-4 py-2 bg-slate-100 rounded-md">
                {formatDate(currentWeekStart)} - {formatDate(weekEnd)}
              </div>
              <Button variant="outline" size="sm" onClick={handleNextWeek}>
                下一周
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </CardHeader>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">总入款金额</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600">{summary.totalIncome.toLocaleString()}</div>
              <div className="text-sm text-slate-500 mt-2">{summary.totalIncomeUSDT.toFixed(2)} USDT</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">总下发金额</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-600">{summary.totalDispatch.toLocaleString()}</div>
              <div className="text-sm text-slate-500 mt-2">{summary.totalDispatchUSDT.toFixed(2)} USDT</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">总账单数</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">{summary.totalBills}</div>
              <div className="text-sm text-slate-500 mt-2">笔账单</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">平均汇率</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">{summary.averageRate.toFixed(2)}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">平均费率</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">{summary.averageFee.toFixed(1)}%</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">未下发金额</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-orange-600">{summary.notDispatched.toLocaleString()}</div>
              <div className="text-sm text-slate-500 mt-2">{summary.notDispatchedUSDT.toFixed(2)} USDT</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>每日明细</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium text-slate-700">日期</th>
                    <th className="text-right py-3 px-4 font-medium text-slate-700">入款金额</th>
                    <th className="text-right py-3 px-4 font-medium text-slate-700">下发金额</th>
                    <th className="text-right py-3 px-4 font-medium text-slate-700">账单数</th>
                    <th className="text-right py-3 px-4 font-medium text-slate-700">平均汇率</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.dailyBreakdown.map((day: any, index: number) => (
                    <tr key={index} className="border-b hover:bg-slate-50">
                      <td className="py-3 px-4">{day.date}</td>
                      <td className="text-right py-3 px-4 text-green-600 font-medium">{day.income.toLocaleString()}</td>
                      <td className="text-right py-3 px-4 text-blue-600 font-medium">
                        {day.dispatch.toLocaleString()}
                      </td>
                      <td className="text-right py-3 px-4">{day.bills}</td>
                      <td className="text-right py-3 px-4">{day.rate.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft } from "lucide-react"

export default function SummaryPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [summary, setSummary] = useState<any | null>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!mounted) return
    const controller = new AbortController()
    const load = async () => {
      try {
        const res = await fetch(`/api/stats/30d`, { signal: controller.signal })
        if (!res.ok) throw new Error('failed')
        const json = await res.json()
        setSummary(json)
      } catch (e) {
        if ((e as any).name !== 'AbortError') console.error(e)
      }
    }
    load()
    return () => controller.abort()
  }, [mounted])

  if (!mounted) {
    return null
  }

  if (!summary) return null

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-2xl font-bold">最近30天汇总</CardTitle>
              <Button variant="outline" onClick={() => router.back()}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                返回
              </Button>
            </div>
          </CardHeader>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
      </div>
    </div>
  )
}

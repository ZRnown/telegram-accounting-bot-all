"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ChevronLeft, ChevronRight, Download, LogOut, Calendar } from "lucide-react"
import { exportToExcel } from "@/lib/export-excel"
import { useRouter } from "next/navigation"

interface DashboardHeaderProps {
  currentDate: Date
  onPreviousDay: () => void
  onNextDay: () => void
  onViewSummary: () => void
  onLogout: () => void
  onDateChange: (date: Date) => void
  chatId?: string
  chatTitle?: string
  compact?: boolean // when true, hide date/export controls
  hideLogout?: boolean
  hideGroupButton?: boolean
  showBackHome?: boolean
  isAdmin?: boolean
}

export function DashboardHeader({
  currentDate,
  onPreviousDay,
  onNextDay,
  onViewSummary,
  onLogout,
  onDateChange,
  chatId,
  chatTitle,
  compact,
  hideLogout,
  hideGroupButton,
  showBackHome,
  isAdmin,
}: DashboardHeaderProps) {
  const router = useRouter()

  const formatDateTime = (date: Date) => {
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
  }

  const startDate = new Date(currentDate)
  startDate.setHours(0, 0, 0, 0)

  const endDate = new Date(currentDate)
  endDate.setDate(endDate.getDate() + 1)
  endDate.setHours(0, 0, 0, 0)

  const handleExport = () => {
    exportToExcel(currentDate, chatId)
  }

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = new Date(e.target.value)
    if (!isNaN(newDate.getTime())) {
      onDateChange(newDate)
    }
  }

  const formatDateForInput = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  return (
    <Card className="p-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">记账机器人后台</h1>
            {chatTitle && (
              <div className="text-sm text-slate-600 mt-1">群组：{chatTitle}</div>
            )}
          </div>
          <div className="flex gap-2">
            {showBackHome && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push('/dashboard')}
                title="返回主页"
              >返回主页</Button>
            )}
            {!compact && (
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="w-4 h-4 mr-2" />
                下载 Excel
              </Button>
            )}
            {isAdmin && compact && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => router.push('/security')}
                title="修改密码"
              >
                🔐 修改密码
              </Button>
            )}
            {!hideLogout && (
              <Button variant="outline" size="sm" onClick={onLogout}>
                <LogOut className="w-4 h-4 mr-2" />
                退出登录
              </Button>
            )}
          </div>
        </div>

        {!compact && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={onPreviousDay}>
                <ChevronLeft className="w-4 h-4 mr-1" />
                上一天
              </Button>

              <div className="relative">
                <input
                  type="date"
                  value={formatDateForInput(currentDate)}
                  onChange={handleDateChange}
                  className="text-sm font-medium text-slate-700 px-3 py-2 bg-slate-100 rounded-md border border-slate-200 hover:bg-slate-200 transition-colors cursor-pointer"
                />
              </div>

              <Button variant="outline" size="sm" onClick={onNextDay}>
                下一天
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>

            <div className="text-sm text-slate-600 bg-slate-50 px-3 py-2 rounded-md">
              数据范围: {formatDateTime(startDate)} — {formatDateTime(endDate)}
            </div>

            <div className="flex gap-2">
              <Button variant="default" size="sm" onClick={onViewSummary}>
                查看最近30天汇总
              </Button>
              {!hideGroupButton && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (chatId) {
                      router.push(`/chats?chatId=${encodeURIComponent(chatId)}`)
                    } else {
                      router.push("/chats")
                    }
                  }}
                > 
                  群组管理
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

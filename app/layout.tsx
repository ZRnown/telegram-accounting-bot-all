import type React from "react"
import type { Metadata } from "next"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { ErrorBoundary } from "@/components/error-boundary"

// 使用系统字体，避免构建时从 Google 拉取字体导致失败

export const metadata: Metadata = {
  title: "星空记账机器人后台",
  description: "Telegram 记账机器人后台管理系统",
  generator: 'v0.app'
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN" className={`antialiased`}>
      <body className="font-sans">
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
        <Toaster />
      </body>
    </html>
  )
}

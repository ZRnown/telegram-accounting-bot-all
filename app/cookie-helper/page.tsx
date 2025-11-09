"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"

export default function CookieHelperPage() {
  const [cookieString, setCookieString] = useState("")
  const [parsedCookies, setParsedCookies] = useState<Record<string, string>>({})
  const [error, setError] = useState("")

  const parseCookies = () => {
    try {
      setError("")
      if (!cookieString.trim()) {
        setError("请输入 Cookie 字符串")
        return
      }

      const cookies: Record<string, string> = {}
      const parts = cookieString.split(";")
      
      for (const part of parts) {
        const [key, value] = part.trim().split("=").map(s => s.trim())
        if (key && value) {
          cookies[key] = value
        }
      }

      setParsedCookies(cookies)
    } catch (e: any) {
      setError(`解析失败: ${e.message}`)
    }
  }

  const checkRequiredCookies = () => {
    const required = ["stel_ssid", "stel_dt", "stel_ton_token"]
    const missing = required.filter(key => !parsedCookies[key])
    return missing
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    alert("已复制到剪贴板")
  }

  const missingCookies = checkRequiredCookies()

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle>Telegram Fragment API Cookie 助手</CardTitle>
          <CardDescription>
            帮助您查看和设置 Telegram Fragment API 所需的 Cookie
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <AlertDescription>
              <strong>如何获取 Cookie：</strong>
              <ol className="list-decimal list-inside mt-2 space-y-1">
                <li>打开浏览器，访问 <code className="bg-slate-100 px-1 rounded">https://web.telegram.org</code></li>
                <li>登录您的 Telegram 账号</li>
                <li>打开开发者工具（F12 或右键 → 检查）</li>
                <li>在 Console 中执行：<code className="bg-slate-100 px-1 rounded">document.cookie</code></li>
                <li>复制输出的 Cookie 字符串并粘贴到下方</li>
              </ol>
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="cookie-input">Cookie 字符串</Label>
            <textarea
              id="cookie-input"
              className="w-full min-h-[120px] p-3 border rounded-md font-mono text-sm"
              placeholder="粘贴完整的 Cookie 字符串，例如：stel_ssid=xxx; stel_dt=xxx; stel_ton_token=xxx; ..."
              value={cookieString}
              onChange={(e) => setCookieString(e.target.value)}
            />
            <Button onClick={parseCookies}>解析 Cookie</Button>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {Object.keys(parsedCookies).length > 0 && (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold mb-2">解析结果：</h3>
                {missingCookies.length > 0 && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertDescription>
                      <strong>缺少必需的 Cookie：</strong> {missingCookies.join(", ")}
                    </AlertDescription>
                  </Alert>
                )}
                {missingCookies.length === 0 && (
                  <Alert className="mb-4 bg-green-50 border-green-200">
                    <AlertDescription className="text-green-800">
                      ✅ 所有必需的 Cookie 都已找到
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="font-medium">必需的 Cookie：</h4>
                {["stel_ssid", "stel_dt", "stel_ton_token"].map((key) => {
                  const value = parsedCookies[key]
                  const exists = !!value
                  return (
                    <div key={key} className="p-3 border rounded-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold">{key}</span>
                          {exists ? (
                            <span className="text-xs text-green-600">✓ 已找到</span>
                          ) : (
                            <span className="text-xs text-red-600">✗ 缺失</span>
                          )}
                        </div>
                        {exists && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => copyToClipboard(value)}
                          >
                            复制
                          </Button>
                        )}
                      </div>
                      {exists && (
                        <div className="mt-2">
                          <code className="text-xs bg-slate-100 p-2 rounded block break-all">
                            {value.length > 100 ? `${value.substring(0, 100)}... (${value.length} 字符)` : value}
                          </code>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="space-y-2">
                <h4 className="font-medium">其他 Cookie：</h4>
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {Object.entries(parsedCookies)
                    .filter(([key]) => !["stel_ssid", "stel_dt", "stel_ton_token"].includes(key))
                    .map(([key, value]) => (
                      <div key={key} className="p-2 border rounded text-sm">
                        <span className="font-mono font-semibold">{key}:</span>{" "}
                        <span className="text-slate-600">
                          {value.length > 50 ? `${value.substring(0, 50)}...` : value}
                        </span>
                      </div>
                    ))}
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-medium">环境变量设置：</h4>
                <Alert>
                  <AlertDescription>
                    <p className="mb-2">将以下内容添加到您的 <code className="bg-slate-100 px-1 rounded">.env</code> 文件中：</p>
                    <div className="bg-slate-900 text-green-400 p-4 rounded font-mono text-sm space-y-1">
                      <div>
                        FRAGMENT_COOKIE={cookieString}
                      </div>
                      {parsedCookies.stel_ton_token && (
                        <div>
                          FRAGMENT_HASH={parsedCookies.stel_ton_token.substring(0, 16)}
                        </div>
                      )}
                    </div>
                    <Button
                      className="mt-2"
                      onClick={() => {
                        let envContent = `FRAGMENT_COOKIE=${cookieString}\n`
                        if (parsedCookies.stel_ton_token) {
                          envContent += `FRAGMENT_HASH=${parsedCookies.stel_ton_token.substring(0, 16)}\n`
                        }
                        copyToClipboard(envContent)
                      }}
                    >
                      复制环境变量配置
                    </Button>
                  </AlertDescription>
                </Alert>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}


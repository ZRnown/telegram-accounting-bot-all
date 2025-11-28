"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

export default function SecurityPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [username, setUsername] = useState("")
  const [oldPassword, setOldPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [ok, setOk] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setMounted(true)
    const token = localStorage.getItem("auth_token")
    if (!token) {
      router.push("/")
      return
    }
    const u = localStorage.getItem("auth_user") || "admin"
    setUsername(u)
  }, [router])

  if (!mounted) return null

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto px-4 py-6 max-w-xl">
        <div className="bg-white border rounded-lg p-6">
          <div className="text-lg font-semibold mb-4">安全设置</div>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-slate-600 mb-1">用户名</label>
              <input
                className="w-full border rounded px-3 py-2 text-sm"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">原密码</label>
              <input
                type="password"
                className="w-full border rounded px-3 py-2 text-sm"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="请输入原密码"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">新密码</label>
              <input
                type="password"
                className="w-full border rounded px-3 py-2 text-sm"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="请输入新密码（至少6位）"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">确认新密码</label>
              <input
                type="password"
                className="w-full border rounded px-3 py-2 text-sm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="请再次输入新密码"
              />
            </div>
            {error && <div className="text-sm text-red-600">{error}</div>}
            {ok && <div className="text-sm text-green-600">{ok}</div>}
            <div className="flex items-center gap-3">
              <button
                className="px-3 py-2 text-sm border rounded-md hover:bg-slate-50 disabled:opacity-50"
                disabled={loading}
                onClick={async () => {
                  setError("")
                  setOk("")
                  if (!username.trim()) { setError("用户名不能为空"); return }
                  if (!oldPassword || !newPassword) { setError("请填写完整"); return }
                  if (newPassword !== confirm) { setError("两次输入的新密码不一致"); return }
                  setLoading(true)
                  try {
                    const res = await fetch('/api/auth/change-password', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ username, oldPassword, newPassword })
                    })
                    if (res.status === 204) {
                      setOk("修改成功，请使用新密码重新登录")
                      // 退出重新登录
                      localStorage.removeItem('auth_token')
                      localStorage.setItem('auth_user', username)
                      setTimeout(() => router.push('/'), 1200)
                    } else {
                      const text = await res.text().catch(() => '')
                      setError(text || '修改失败')
                    }
                  } catch {
                    setError('网络错误，请稍后重试')
                  } finally {
                    setLoading(false)
                  }
                }}
              >{loading ? '提交中...' : '保存修改'}</button>
              <button
                className="px-3 py-2 text-sm border rounded-md hover:bg-slate-50"
                onClick={() => router.push('/dashboard')}
              >返回</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

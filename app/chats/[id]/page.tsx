"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"

type AccountingMode = 'DAILY_RESET' | 'CARRY_OVER'

interface ChatSettings {
  chat: {
    id: string
    title: string
  }
  settings: {
    accountingMode: AccountingMode
    featureWarningMode?: string
  }
}

interface Operator {
  id: string
  username: string
  chatId: string
}

export default function ChatSettingsPage() {
  const router = useRouter()
  const params = useParams()
  const chatId = params?.id as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [chatSettings, setChatSettings] = useState<ChatSettings | null>(null)
  const [operators, setOperators] = useState<Operator[]>([])
  
  // 设置表单状态
  const [accountingMode, setAccountingMode] = useState<AccountingMode>('DAILY_RESET')
  const [featureWarningMode, setFeatureWarningMode] = useState<string>('always')
  
  // 操作人管理状态
  const [newOperator, setNewOperator] = useState('')
  const [addingOperator, setAddingOperator] = useState(false)
  const [deletingOperator, setDeletingOperator] = useState<string | null>(null)

  // 加载设置和操作人
  useEffect(() => {
    if (!chatId) return
    loadSettings()
    loadOperators()
  }, [chatId])

  const loadSettings = async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/settings`)
      if (res.ok) {
        const data: ChatSettings = await res.json()
        setChatSettings(data)
        
        // 初始化表单
        setAccountingMode(data.settings.accountingMode)
        setFeatureWarningMode(data.settings.featureWarningMode || 'always')
      } else {
        alert('加载设置失败')
      }
    } catch (e) {
      console.error(e)
      alert('加载设置失败')
    } finally {
      setLoading(false)
    }
  }

  const loadOperators = async () => {
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/operators`)
      if (res.ok) {
        const data = await res.json()
        setOperators(data.items || [])
      }
    } catch (e) {
      console.error(e)
    }
  }

  // 保存设置
  const handleSaveSettings = async () => {
    try {
      setSaving(true)
      
      const payload = {
        accountingMode,
        featureWarningMode,
      }

      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        alert('✅ 设置保存成功')
        await loadSettings()
      } else {
        alert('❌ 保存失败')
      }
    } catch (e) {
      console.error(e)
      alert('❌ 保存失败')
    } finally {
      setSaving(false)
    }
  }

  // 添加操作人
  const handleAddOperator = async () => {
    if (!newOperator.trim()) {
      alert('请输入用户名')
      return
    }

    try {
      setAddingOperator(true)
      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/operators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newOperator })
      })

      if (res.ok) {
        const data = await res.json()
        setOperators(data.items || [])
        setNewOperator('')
        alert('✅ 添加成功')
      } else {
        alert('❌ 添加失败')
      }
    } catch (e) {
      console.error(e)
      alert('❌ 添加失败')
    } finally {
      setAddingOperator(false)
    }
  }

  // 删除操作人
  const handleDeleteOperator = async (username: string) => {
    if (!confirm(`确定删除操作人 ${username} 吗？`)) return

    try {
      setDeletingOperator(username)
      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/operators`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      })

      if (res.ok) {
        const data = await res.json()
        setOperators(data.items || [])
        alert('✅ 删除成功')
      } else {
        alert('❌ 删除失败')
      }
    } catch (e) {
      console.error(e)
      alert('❌ 删除失败')
    } finally {
      setDeletingOperator(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">加载中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        {/* 头部 */}
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="mb-4 px-3 py-1 text-sm border rounded hover:bg-gray-100"
          >
            ← 返回
          </button>
          <h1 className="text-2xl font-bold text-gray-900">
            群组设置
          </h1>
          {chatSettings && (
            <p className="text-gray-600 mt-1">
              {chatSettings.chat.title || chatSettings.chat.id}
            </p>
          )}
        </div>

        <div className="space-y-6">
          {/* 功能提示频率设置 */}
          <div className="bg-white border rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-1">🔔 功能提示设置</h2>
            <p className="text-sm text-gray-600 mb-4">控制未开通功能的提示频率（适合多机器人群组）</p>
            
            <div className="space-y-3">
              <label className="flex items-start space-x-3 p-4 border rounded cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="featureWarningMode"
                  value="always"
                  checked={featureWarningMode === 'always'}
                  onChange={(e) => setFeatureWarningMode(e.target.value)}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">🔁 每次提示</div>
                  <div className="text-sm text-gray-600 mt-1">
                    每次使用未开通的功能都会提示（默认）
                  </div>
                </div>
              </label>

              <label className="flex items-start space-x-3 p-4 border rounded cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="featureWarningMode"
                  value="daily"
                  checked={featureWarningMode === 'daily'}
                  onChange={(e) => setFeatureWarningMode(e.target.value)}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">📅 每天一次</div>
                  <div className="text-sm text-gray-600 mt-1">
                    每个功能每天只提示一次，减少打扰
                  </div>
                </div>
              </label>

              <label className="flex items-start space-x-3 p-4 border rounded cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="featureWarningMode"
                  value="once"
                  checked={featureWarningMode === 'once'}
                  onChange={(e) => setFeatureWarningMode(e.target.value)}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">1️⃣ 只提示一次</div>
                  <div className="text-sm text-gray-600 mt-1">
                    每个功能只在第一次使用时提示
                  </div>
                </div>
              </label>

              <label className="flex items-start space-x-3 p-4 border rounded cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="featureWarningMode"
                  value="silent"
                  checked={featureWarningMode === 'silent'}
                  onChange={(e) => setFeatureWarningMode(e.target.value)}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">🔇 静默模式</div>
                  <div className="text-sm text-gray-600 mt-1">
                    不提示任何未开通功能的消息（适合多机器人协作）
                  </div>
                </div>
              </label>
            </div>

            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm">
              💡 提示：如果群内有多个机器人分工协作（如本机器人负责禁言公告，其他机器人负责记账），建议设置为"静默模式"避免频繁提示
            </div>
          </div>

          {/* 记账模式设置 */}
          <div className="bg-white border rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-1">📊 记账模式</h2>
            <p className="text-sm text-gray-600 mb-4">选择每日记账数据是清零还是累计</p>
            
            <div className="space-y-3">
              <label className="flex items-start space-x-3 p-4 border rounded cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="accountingMode"
                  value="DAILY_RESET"
                  checked={accountingMode === 'DAILY_RESET'}
                  onChange={(e) => setAccountingMode(e.target.value as AccountingMode)}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">🔄 每日清零模式</div>
                  <div className="text-sm text-gray-600 mt-1">
                    每天零点自动清零账单数据，适合每日独立结算的场景
                  </div>
                </div>
              </label>

              <label className="flex items-start space-x-3 p-4 border rounded cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="accountingMode"
                  value="CARRY_OVER"
                  checked={accountingMode === 'CARRY_OVER'}
                  onChange={(e) => setAccountingMode(e.target.value as AccountingMode)}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">📈 累计模式</div>
                  <div className="text-sm text-gray-600 mt-1">
                    账单数据持续累计，不会自动清零，需要手动结算
                  </div>
                </div>
              </label>
            </div>

            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm">
              当前模式：
              <span className="ml-2 font-medium">
                {accountingMode === 'DAILY_RESET' ? '🔄 每日清零' : '📈 累计模式'}
              </span>
            </div>
          </div>

          {/* 操作人管理 */}
          <div className="bg-white border rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-1">👥 操作人管理</h2>
            <p className="text-sm text-gray-600 mb-4">管理有权限进行记账操作的用户（与群内自动同步）</p>
            
            {/* 添加操作人 */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="输入用户名（如：@username 或 username）"
                value={newOperator}
                onChange={(e) => setNewOperator(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleAddOperator()
                  }
                }}
                className="flex-1 px-3 py-2 border rounded"
              />
              <button
                onClick={handleAddOperator}
                disabled={addingOperator || !newOperator.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {addingOperator ? '添加中...' : '➕ 添加'}
              </button>
            </div>

            {/* 操作人列表 */}
            <div className="border rounded overflow-hidden">
              {operators.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  暂无操作人，请添加
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">
                        用户名
                      </th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {operators.map((op) => (
                      <tr key={op.id} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-4 text-sm">
                          <span className="font-mono">{op.username}</span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleDeleteOperator(op.username)}
                            disabled={deletingOperator === op.username}
                            className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                          >
                            {deletingOperator === op.username ? '删除中...' : '删除'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm space-y-1">
              <div>💡 提示：</div>
              <div>• 操作人可以执行记账、结算等操作</div>
              <div>• 在群内通过"设置操作人 @username"添加后，刷新此页面即可看到</div>
              <div>• 在此页面添加的操作人，群内也会立即生效</div>
              <div>• 用户名格式支持 @username 或 username</div>
            </div>
          </div>

          {/* 保存按钮 */}
          <div className="flex justify-end gap-3">
            <button
              onClick={() => router.back()}
              className="px-4 py-2 border rounded hover:bg-gray-100"
            >
              取消
            </button>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '保存中...' : '💾 保存设置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
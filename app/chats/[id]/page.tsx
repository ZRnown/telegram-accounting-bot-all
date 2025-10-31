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
    addressVerificationEnabled?: boolean
    dailyCutoffHour?: number
    hideHelpButton?: boolean
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
  const [addressVerificationEnabled, setAddressVerificationEnabled] = useState<boolean>(false)
  const [dailyCutoffHour, setDailyCutoffHour] = useState<number>(0)
  const [hideHelpButton, setHideHelpButton] = useState<boolean>(false)
  
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
        setAddressVerificationEnabled(data.settings.addressVerificationEnabled || false)
        setDailyCutoffHour(data.settings.dailyCutoffHour ?? 0)
        setHideHelpButton(data.settings.hideHelpButton ?? false)
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
        addressVerificationEnabled,
        dailyCutoffHour,
        hideHelpButton,
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
      <div className="max-w-6xl mx-auto p-4 md:p-6">
        {/* 头部 */}
        <div className="mb-4">
          <button
            onClick={() => router.back()}
            className="mb-3 px-3 py-1 text-sm border rounded hover:bg-gray-100"
          >
            ← 返回
          </button>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">
            群组设置
          </h1>
          {chatSettings && (
            <p className="text-sm md:text-base text-gray-600 mt-1">
              {chatSettings.chat.title || chatSettings.chat.id}
            </p>
          )}
        </div>

        {/* 🔥 优化的简洁界面：使用网格布局，所有选项一目了然 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* 记账模式 */}
          <div className="bg-white border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">📊 记账模式</h3>
              <span className={`text-xs px-2 py-1 rounded ${accountingMode === 'DAILY_RESET' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                {accountingMode === 'DAILY_RESET' ? '每日清零' : '累计模式'}
              </span>
            </div>
            <div className="space-y-2">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="accountingMode"
                  value="DAILY_RESET"
                  checked={accountingMode === 'DAILY_RESET'}
                  onChange={(e) => setAccountingMode(e.target.value as AccountingMode)}
                  className="w-4 h-4"
                />
                <span className="text-sm">🔄 每日清零（每日独立结算）</span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="accountingMode"
                  value="CARRY_OVER"
                  checked={accountingMode === 'CARRY_OVER'}
                  onChange={(e) => setAccountingMode(e.target.value as AccountingMode)}
                  className="w-4 h-4"
                />
                <span className="text-sm">📈 累计模式（持续累计未下发）</span>
              </label>
            </div>
          </div>

          {/* 功能提示频率 */}
          <div className="bg-white border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">🔔 功能提示</h3>
              <span className="text-xs text-gray-500">
                {featureWarningMode === 'always' ? '每次' : featureWarningMode === 'daily' ? '每天一次' : featureWarningMode === 'once' ? '只一次' : '静默'}
              </span>
            </div>
            <select
              value={featureWarningMode}
              onChange={(e) => setFeatureWarningMode(e.target.value)}
              className="w-full p-2 text-sm border rounded"
            >
              <option value="always">🔁 每次提示（默认）</option>
              <option value="daily">📅 每天一次</option>
              <option value="once">1️⃣ 只提示一次</option>
              <option value="silent">🔇 静默模式（多机器人协作）</option>
            </select>
            <p className="text-xs text-gray-500 mt-2">💡 适合多机器人群组，减少打扰</p>
          </div>

          {/* 日切时间 */}
          <div className="bg-white border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">⏰ 日切时间</h3>
              <span className="text-xs font-mono">{dailyCutoffHour.toString().padStart(2, '0')}:00</span>
            </div>
            <select
              value={dailyCutoffHour}
              onChange={(e) => setDailyCutoffHour(Number(e.target.value))}
              className="w-full p-2 text-sm border rounded"
            >
              {Array.from({ length: 13 }, (_, i) => (
                <option key={i} value={i}>
                  {i.toString().padStart(2, '0')}:00 {i === 0 ? '（默认）' : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-2">💡 设置每天结算的起始时间点</p>
          </div>

          {/* 地址验证 */}
          <div className="bg-white border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">🔐 地址验证</h3>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={addressVerificationEnabled}
                  onChange={(e) => setAddressVerificationEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <p className="text-xs text-gray-600">自动识别和验证群内发送的钱包地址，防止地址被篡改</p>
          </div>

          {/* 界面设置 */}
          <div className="bg-white border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">🎨 隐藏使用说明</h3>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideHelpButton}
                  onChange={(e) => setHideHelpButton(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <p className="text-xs text-gray-600">隐藏账单消息中的"使用说明"按钮（"查看完整订单"按钮仍显示）</p>
          </div>
        </div>

        {/* 操作人管理 */}
        <div className="bg-white border rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">👥 操作人管理</h3>
            <span className="text-xs text-gray-500">共 {operators.length} 人</span>
          </div>
          
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
              className="flex-1 px-3 py-2 text-sm border rounded focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleAddOperator}
              disabled={addingOperator || !newOperator.trim()}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {addingOperator ? '添加中...' : '➕'}
            </button>
          </div>

          {/* 操作人列表 */}
          <div className="border rounded overflow-hidden">
            {operators.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500">
                暂无操作人，请添加
              </div>
            ) : (
              <div className="divide-y">
                {operators.map((op) => (
                  <div key={op.id} className="flex items-center justify-between p-3 hover:bg-gray-50">
                    <span className="text-sm font-mono">{op.username}</span>
                    <button
                      onClick={() => handleDeleteOperator(op.username)}
                      disabled={deletingOperator === op.username}
                      className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                    >
                      {deletingOperator === op.username ? '删除中...' : '删除'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-3">💡 操作人可以执行记账、结算等操作。在群内添加后会自动同步。</p>
        </div>

        {/* 保存按钮 */}
        <div className="flex justify-end gap-3">
          <button
            onClick={() => router.back()}
            className="px-4 py-2 text-sm border rounded hover:bg-gray-100"
          >
            取消
          </button>
          <button
            onClick={handleSaveSettings}
            disabled={saving}
            className="px-6 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            {saving ? '保存中...' : '💾 保存设置'}
          </button>
        </div>
      </div>
    </div>
  )
}

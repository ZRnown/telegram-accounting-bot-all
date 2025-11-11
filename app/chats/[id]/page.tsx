"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { useToast } from "@/hooks/use-toast"

type AccountingMode = 'DAILY_RESET' | 'CARRY_OVER' | 'SINGLE_BILL_PER_DAY'

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
    hideOrderButton?: boolean
    deleteBillConfirm?: boolean // 🔥 删除账单确认功能
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
  const { toast } = useToast()

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
  const [hideOrderButton, setHideOrderButton] = useState<boolean>(false)
  const [deleteBillConfirm, setDeleteBillConfirm] = useState<boolean>(false) // 🔥 删除账单确认功能
  
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
        setHideOrderButton(data.settings.hideOrderButton ?? false)
        setDeleteBillConfirm(data.settings.deleteBillConfirm ?? false)
      } else {
        toast({
          variant: "destructive",
          title: "加载失败",
          description: "无法加载群组设置，请刷新页面重试",
        })
      }
    } catch (e) {
      console.error(e)
      toast({
        variant: "destructive",
        title: "加载失败",
        description: "网络错误，请检查连接后重试",
      })
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

  // 保存设置（优化：保存成功后不重新加载，只更新本地状态）
  const handleSaveSettings = async () => {
    try {
      setSaving(true)
      
      const payload = {
        accountingMode,
        featureWarningMode,
        addressVerificationEnabled,
        dailyCutoffHour,
        hideHelpButton,
        hideOrderButton,
        deleteBillConfirm,
      }

      // 🔥 添加超时控制，避免长时间等待
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10秒超时

      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (res.ok) {
        // 🔥 保存成功后不重新加载，只更新本地状态，提升响应速度
        try {
          const data = await res.json()
          // API返回的格式是 { ok: true, settings: {...} }
          if (data.ok && data.settings) {
            setChatSettings(prev => prev ? {
              ...prev,
              settings: {
                ...prev.settings,
                accountingMode: data.settings.accountingMode || accountingMode,
                featureWarningMode: data.settings.featureWarningMode || featureWarningMode,
                addressVerificationEnabled: data.settings.addressVerificationEnabled ?? addressVerificationEnabled,
                dailyCutoffHour: data.settings.dailyCutoffHour ?? dailyCutoffHour,
                hideHelpButton: data.settings.hideHelpButton ?? hideHelpButton,
                hideOrderButton: data.settings.hideOrderButton ?? hideOrderButton,
              }
            } : prev)
          }
        } catch (parseError) {
          console.error('解析响应失败', parseError)
          // 即使解析失败，也认为保存成功（因为res.ok为true）
        }
        
        toast({
          title: "保存成功",
          description: "设置已保存",
        })
      } else {
        const errorText = await res.text().catch(() => '保存失败')
        toast({
          title: "保存失败",
          description: errorText || "请稍后重试",
        })
      }
    } catch (e: any) {
      console.error(e)
      if (e.name === 'AbortError') {
        toast({
          title: "请求超时",
          description: "保存请求超时，请检查网络连接后重试",
        })
      } else {
        toast({
          title: "保存失败",
          description: e.message || "网络错误，请稍后重试",
        })
      }
    } finally {
      setSaving(false)
    }
  }

  // 添加操作人
  const handleAddOperator = async () => {
    if (!newOperator.trim()) {
      toast({
        variant: "destructive",
        title: "输入错误",
        description: "请输入用户名",
      })
      return
    }

    try {
      setAddingOperator(true)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8000)
      
      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/operators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newOperator }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (res.ok) {
        const data = await res.json()
        const addedUsername = newOperator // 保存用户名，因为后面会清空
        setOperators(data.items || [])
        setNewOperator('')
        toast({
          title: "添加成功",
          description: `已添加操作人 ${addedUsername}`,
        })
      } else {
        const errorText = await res.text().catch(() => '添加失败')
        toast({
          variant: "destructive",
          title: "添加失败",
          description: errorText || "请稍后重试",
        })
      }
    } catch (e: any) {
      console.error(e)
      if (e.name === 'AbortError') {
        toast({
          variant: "destructive",
          title: "请求超时",
          description: "请检查网络连接后重试",
        })
      } else {
        toast({
          variant: "destructive",
          title: "添加失败",
          description: e.message || "网络错误，请稍后重试",
        })
      }
    } finally {
      setAddingOperator(false)
    }
  }

  // 删除操作人
  const handleDeleteOperator = async (username: string) => {
    // 🔥 使用toast确认对话框替代confirm
    const confirmed = window.confirm(`确定删除操作人 ${username} 吗？`)
    if (!confirmed) return

    try {
      setDeletingOperator(username)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8000)
      
      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/operators`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (res.ok) {
        const data = await res.json()
        setOperators(data.items || [])
        toast({
          title: "删除成功",
          description: `已删除操作人 ${username}`,
        })
      } else {
        const errorText = await res.text().catch(() => '删除失败')
        toast({
          variant: "destructive",
          title: "删除失败",
          description: errorText || "请稍后重试",
        })
      }
    } catch (e: any) {
      console.error(e)
      if (e.name === 'AbortError') {
        toast({
          variant: "destructive",
          title: "请求超时",
          description: "请检查网络连接后重试",
        })
      } else {
        toast({
          variant: "destructive",
          title: "删除失败",
          description: e.message || "网络错误，请稍后重试",
        })
      }
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
              <span className={`text-xs px-2 py-1 rounded ${
                accountingMode === 'DAILY_RESET' ? 'bg-blue-100 text-blue-700' : 
                accountingMode === 'CARRY_OVER' ? 'bg-green-100 text-green-700' : 
                'bg-purple-100 text-purple-700'
              }`}>
                {accountingMode === 'DAILY_RESET' ? '每日清零' : 
                 accountingMode === 'CARRY_OVER' ? '累计模式' : 
                 '单笔订单'}
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
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="accountingMode"
                  value="SINGLE_BILL_PER_DAY"
                  checked={accountingMode === 'SINGLE_BILL_PER_DAY'}
                  onChange={(e) => setAccountingMode(e.target.value as AccountingMode)}
                  className="w-4 h-4"
                />
                <span className="text-sm">📋 单笔订单（每天只有一笔，不支持保存）</span>
              </label>
              <div className="mt-3 space-y-2 text-xs text-slate-600 leading-relaxed">
                <p>💡 <strong>每日清零：</strong> 每个日切周期都会生成全新的账单，历史账单不会参与当日计算，也不会累计未下发金额。支持设置日切时间。</p>
                <p>💡 <strong>累计模式：</strong> 当前账单会自动叠加所有更早账单的未下发金额；删除账单时会同步删除该账单的全部流水，后续账单的历史数据也会随之回收。不支持设置日切时间，账单按保存时间自动创建。</p>
                <p>💡 <strong>单笔订单：</strong> 每天只有一笔订单，不支持保存账单，但支持删除账单。日切时会自动关闭昨天的账单，每天单独记账。支持设置日切时间。</p>
              </div>
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
            <p className="text-xs text-gray-500 mt-2">
              💡 控制功能关闭时的提醒频率。例如：计算器关闭、记账暂停等功能提示的显示方式。
              <br />
              • 每次提示：每次使用都会提醒
              <br />
              • 每天一次：每天只提醒一次
              <br />
              • 只提示一次：只提醒一次，之后不再提醒
              <br />
              • 静默模式：不提醒，适合多机器人群组
            </p>
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
              disabled={accountingMode === 'CARRY_OVER'}
              className={`w-full p-2 text-sm border rounded ${accountingMode === 'CARRY_OVER' ? 'bg-gray-100 cursor-not-allowed opacity-60' : ''}`}
            >
              {Array.from({ length: 13 }, (_, i) => (
                <option key={i} value={i}>
                  {i.toString().padStart(2, '0')}:00 {i === 0 ? '（默认）' : ''}
                </option>
              ))}
            </select>
            {accountingMode === 'CARRY_OVER' ? (
              <p className="text-xs text-amber-600 mt-2">⚠️ 累计模式下不支持设置日切时间，账单按保存时间自动创建</p>
            ) : (
              <p className="text-xs text-gray-500 mt-2">💡 设置每天结算的起始时间点</p>
            )}
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
          <div className="bg-white border rounded-lg p-4 space-y-4">
            <h3 className="text-base font-semibold mb-3">🎨 按钮显示设置</h3>
            
            {/* 隐藏使用说明按钮 */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">隐藏使用说明按钮</div>
                <p className="text-xs text-gray-500 mt-1">隐藏账单消息中的"使用说明"按钮</p>
              </div>
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
            
            {/* 隐藏查看完整订单按钮 */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">隐藏查看完整订单按钮</div>
                <p className="text-xs text-gray-500 mt-1">隐藏账单消息中的"查看完整订单"按钮</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideOrderButton}
                  onChange={(e) => setHideOrderButton(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>
          
          {/* 🔥 安全设置 */}
          <div className="bg-white border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">🔒 安全设置</h3>
            </div>
            
            {/* 删除账单确认 */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">删除账单确认</div>
                <p className="text-xs text-gray-500 mt-1">发送"删除账单"后需要二次确认，防止误删除</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteBillConfirm}
                  onChange={(e) => setDeleteBillConfirm(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
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

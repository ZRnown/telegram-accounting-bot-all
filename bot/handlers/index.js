// 统一注册所有命令处理器
import {
  registerStartAccounting,
  registerStopAccounting,
  registerIncome,
  registerDispatch,
  registerIncomeWithRemark,
  registerIncomeWithTarget,
  registerDispatchWithTarget
} from './accounting.js'
import {
  registerSetFee,
  registerSetRate,
  registerSetRealtimeRate,
  registerRefreshRate,
  registerShowRate,
  registerSetCurrency,
  registerShowCurrency,
  registerSetDailyCutoff,
  registerOverDepositLimit,
  registerCalculatorToggle,
  registerSetHeader
} from './settings.js'
import {
  registerShowBill,
  registerSaveBill,
  registerDeleteBill,
  registerDeleteAllBills,
  registerShowHistory,
  registerShowIncomeHistory,
  registerShowDispatchHistory,
  registerUndo,
  registerUndoIncome,
  registerUndoDispatch,
  registerUserBill,
  registerMyBill,
  registerAllBill
} from './bill.js'
import { registerZ0, registerLZ, registerLW, registerLK, registerZAmountU, registerZAmount } from './okx.js'
import { registerCustomCommandHandlers } from './custom-command-handler.js'
import { registerDisplayMode, registerAccountingModes, registerCommissionMode } from './modes.js'
import { registerBotLeave, registerQueryRate, registerAdminInfo, registerListGroups } from './admin.js'
import { registerStart, registerHelp, registerHelpCommand, registerDashboard, registerCommandMenuAction, registerViewBill, registerPersonalCenter, registerContactSupport } from './core.js'
import { registerCheckUSDT, registerBroadcast, registerGroupBroadcast, registerBroadcastButtons, registerGroupManagement, registerGroupManagementButtons, registerGroupManagementText, registerGroupList, registerFeatureToggles } from './extended.js'
import { registerMessageHandlers } from './message-handler.js'
import { registerUserSettings } from './user-settings.js'
import { registerUsdtMonitorHandler, initUsdtMonitor } from './usdt-monitor-handler.js'
import { registerSalespeopleHandler } from './salespeople-handler.js'

/**
 * 注册所有命令处理器
 */
export function registerAllHandlers(bot, ensureChat) {
  // 核心命令
  registerStart(bot, ensureChat)
  registerHelp(bot)
  registerHelpCommand(bot, ensureChat) // 🔥 使用说明命令
  registerDashboard(bot)
  registerCommandMenuAction(bot)
  registerViewBill(bot, ensureChat)
  registerPersonalCenter(bot) // 🔥 个人中心
  registerContactSupport(bot) // 🔥 联系客服
  registerSalespeopleHandler(bot) // 🔥 业务员管理
  // 自定义指令（文本+图片）
  registerCustomCommandHandlers(bot) // 🔥 自定义指令处理器
  
  // 记账相关
  registerStartAccounting(bot, ensureChat)
  registerStopAccounting(bot, ensureChat)
  // 🔥 先注册备注入账和指定入账（这些需要更严格的匹配）
  registerIncomeWithRemark(bot, ensureChat)
  registerIncomeWithTarget(bot, ensureChat)
  registerIncome(bot, ensureChat) // 最后注册普通入账（匹配范围更广）
  // 🔥 先注册指定下发
  registerDispatchWithTarget(bot, ensureChat)
  registerDispatch(bot, ensureChat) // 最后注册普通下发
  
  // 账单相关
  registerShowBill(bot, ensureChat)
  registerSaveBill(bot, ensureChat)
  registerDeleteBill(bot, ensureChat)
  registerDeleteAllBills(bot, ensureChat)
  registerShowHistory(bot, ensureChat)
  registerShowIncomeHistory(bot, ensureChat) // 🔥 查看入款历史（最多500条）
  registerShowDispatchHistory(bot, ensureChat) // 🔥 查看下发历史（最多500条）
  registerUndo(bot, ensureChat) // 🔥 通用撤销功能（回复消息说"撤销"）
  registerUndoIncome(bot, ensureChat)
  registerUndoDispatch(bot, ensureChat)
  registerUserBill(bot, ensureChat) // 🔥 指定账单：回复消息查看指定人记录
  registerMyBill(bot, ensureChat)
  registerAllBill(bot, ensureChat) // 🔥 全部账单：总
  
  // 设置相关
  registerSetFee(bot, ensureChat)
  registerSetRate(bot, ensureChat)
  registerSetRealtimeRate(bot, ensureChat)
  registerRefreshRate(bot, ensureChat)
  registerShowRate(bot, ensureChat)
  registerSetCurrency(bot, ensureChat)
  registerShowCurrency(bot, ensureChat)
  registerSetDailyCutoff(bot, ensureChat)
  registerSetHeader(bot, ensureChat)
  // registerGlobalCutoff - 已删除，改为后台设置
  registerOverDepositLimit(bot, ensureChat)
  registerCalculatorToggle(bot, ensureChat)
  // 模式相关
  registerDisplayMode(bot, ensureChat)
  registerAccountingModes(bot, ensureChat)
  registerCommissionMode(bot, ensureChat)
  
  // OKX相关
  registerZ0(bot)
  registerZAmountU(bot) // z600u 命令（必须在 z0 之后注册，避免冲突）
  registerZAmount(bot) // z600 命令（必须在 z0 之后注册，避免冲突）
  registerLZ(bot)
  registerLW(bot)
  registerLK(bot)
  
  // 管理员相关
  registerBotLeave(bot)
  registerQueryRate(bot, ensureChat)
  registerAdminInfo(bot)
  registerListGroups(bot)

  // 扩展功能
  registerCheckUSDT(bot, ensureChat)
  registerBroadcast(bot)
  registerGroupBroadcast(bot)
  registerBroadcastButtons(bot)
  registerGroupManagement(bot)
  registerGroupManagementButtons(bot)
  registerGroupManagementText(bot)
  registerGroupList(bot)
  registerFeatureToggles(bot, ensureChat) // 🔥 功能开关处理器

  // 用户设置（私聊）
  registerUserSettings(bot) // 🔥 功能设置菜单

  // USDT监听
  registerUsdtMonitorHandler(bot) // 🔥 USDT监听处理器

  // 消息处理器（地址验证、白名单检测等）
  registerMessageHandlers(bot)

  // 初始化USDT监听服务
  initUsdtMonitor().catch(e => {
    console.error('[USDT Monitor] 初始化失败:', e.message)
  })
}

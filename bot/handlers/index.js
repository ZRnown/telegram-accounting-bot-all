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
  registerCalculatorToggle
} from './settings.js'
import {
  registerShowBill,
  registerSaveBill,
  registerDeleteBill,
  registerDeleteAllBills,
  registerShowHistory,
  registerUndoIncome,
  registerUndoDispatch,
  registerMyBill,
  registerAllBill
} from './bill.js'
import { registerZ0, registerLZ, registerLW, registerLK } from './okx.js'
import { registerCustomCommands } from './custom.js'
import { registerDisplayMode, registerAccountingModes, registerCommissionMode } from './modes.js'
import { registerBotLeave, registerQueryRate, registerAdminInfo, registerListGroups } from './admin.js'
import { registerStart, registerHelp, registerHelpCommand, registerDashboard, registerCommandMenuAction, registerViewBill } from './core.js'

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
  // 自定义指令（文本+图片）
  registerCustomCommands(bot, ensureChat)
  
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
  registerUndoIncome(bot, ensureChat)
  registerUndoDispatch(bot, ensureChat)
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
  // registerGlobalCutoff - 已删除，改为后台设置
  registerOverDepositLimit(bot, ensureChat)
  registerCalculatorToggle(bot, ensureChat)
  // 模式相关
  registerDisplayMode(bot, ensureChat)
  registerAccountingModes(bot, ensureChat)
  registerCommissionMode(bot, ensureChat)
  
  // OKX相关
  registerZ0(bot)
  registerLZ(bot)
  registerLW(bot)
  registerLK(bot)
  
  // 管理员相关
  registerBotLeave(bot)
  registerQueryRate(bot, ensureChat)
  registerAdminInfo(bot)
  registerListGroups(bot)
}


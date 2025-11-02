// 统一注册所有命令处理器
import { registerStartAccounting, registerIncome, registerDispatch } from './accounting.js'
import { 
  registerSetFee, 
  registerSetRate, 
  registerSetRealtimeRate,
  registerRefreshRate,
  registerShowRate,
  registerGlobalCutoff,
  registerOverDepositLimit
} from './settings.js'
import {
  registerShowBill,
  registerSaveBill,
  registerDeleteBill,
  registerDeleteAllBills,
  registerShowHistory,
  registerUndoIncome,
  registerUndoDispatch,
  registerMyBill
} from './bill.js'
import { registerZ0 } from './okx.js'
import { registerBotLeave, registerQueryRate, registerAdminInfo } from './admin.js'
import { registerStart, registerMyId, registerHelp, registerDashboard, registerStartAccountingAction } from './core.js'

/**
 * 注册所有命令处理器
 */
export function registerAllHandlers(bot, ensureChat) {
  // 核心命令
  registerStart(bot, ensureChat)
  registerMyId(bot)
  registerHelp(bot)
  registerDashboard(bot)
  registerStartAccountingAction(bot)
  
  // 记账相关
  registerStartAccounting(bot, ensureChat)
  registerIncome(bot, ensureChat)
  registerDispatch(bot, ensureChat)
  
  // 账单相关
  registerShowBill(bot, ensureChat)
  registerSaveBill(bot, ensureChat)
  registerDeleteBill(bot, ensureChat)
  registerDeleteAllBills(bot, ensureChat)
  registerShowHistory(bot, ensureChat)
  registerUndoIncome(bot, ensureChat)
  registerUndoDispatch(bot, ensureChat)
  registerMyBill(bot, ensureChat)
  
  // 设置相关
  registerSetFee(bot, ensureChat)
  registerSetRate(bot, ensureChat)
  registerSetRealtimeRate(bot, ensureChat)
  registerRefreshRate(bot, ensureChat)
  registerShowRate(bot, ensureChat)
  registerGlobalCutoff(bot)
  registerOverDepositLimit(bot, ensureChat)
  
  // OKX相关
  registerZ0(bot)
  
  // 管理员相关
  registerBotLeave(bot)
  registerQueryRate(bot, ensureChat)
  registerAdminInfo(bot)
}


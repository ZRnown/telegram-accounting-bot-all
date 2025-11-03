// 统一注册所有命令处理器
import { registerStartAccounting, registerIncome, registerDispatch } from './accounting.js'
import { 
  registerSetFee, 
  registerSetRate, 
  registerSetRealtimeRate,
  registerRefreshRate,
  registerShowRate,
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
import { registerStart, registerHelp, registerDashboard, registerStartAccountingAction, registerViewBill } from './core.js'

/**
 * 注册所有命令处理器
 */
export function registerAllHandlers(bot, ensureChat) {
  // 核心命令
  registerStart(bot, ensureChat)
  registerHelp(bot)
  registerDashboard(bot)
  registerStartAccountingAction(bot)
  registerViewBill(bot, ensureChat)
  
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
  // registerGlobalCutoff - 已删除，改为后台设置
  registerOverDepositLimit(bot, ensureChat)
  
  // OKX相关
  registerZ0(bot)
  
  // 管理员相关
  registerBotLeave(bot)
  registerQueryRate(bot, ensureChat)
  registerAdminInfo(bot)
}


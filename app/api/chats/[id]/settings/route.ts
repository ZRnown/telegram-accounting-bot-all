import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { assertAdmin } from '@/app/api/_auth'

const ACCOUNTING_MODE_VALUES = new Set(['DAILY_RESET', 'CARRY_OVER', 'SINGLE_BILL_PER_DAY'])
const getChatAccountingModeKey = (chatId: string) => `chat_accounting_mode:${chatId}`

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    // 🔥 安全检查：只有管理员才能查看特定群组的设置
    const unauth = assertAdmin(req)
    if (unauth) return unauth

    const { id: chatId } = await context.params
    const chat = await prisma.chat.findUnique({ where: { id: chatId }, select: { id: true, title: true } })
    if (!chat) return new Response('Not Found', { status: 404 })

    const setting = await prisma.setting.findUnique({ where: { chatId } })
    return Response.json({
      chat: { id: chat.id, title: chat.title },
      settings: {
        headerText: setting?.headerText ?? '',
        fixedRate: setting?.fixedRate ?? null,
        realtimeRate: setting?.realtimeRate ?? null,
        feePercent: setting?.feePercent ?? 0,
        accountingMode: setting?.accountingMode ?? 'DAILY_RESET',
        featureWarningMode: setting?.featureWarningMode ?? 'always',
        addressVerificationEnabled: setting?.addressVerificationEnabled ?? false,
        dailyCutoffHour: setting?.dailyCutoffHour ?? 0,
        hideHelpButton: setting?.hideHelpButton ?? false,
        hideOrderButton: setting?.hideOrderButton ?? false,
        deleteBillConfirm: setting?.deleteBillConfirm ?? false, // 🔥 删除账单确认功能
        calculatorEnabled: setting?.calculatorEnabled ?? true, // 🔥 计算器功能开关
        showAuthPrompt: setting?.showAuthPrompt ?? true, // 🔥 显示授权提示开关
        welcomeMessage: setting?.welcomeMessage ?? '', // 🔥 拉群欢迎消息
        authPromptMessage: setting?.authPromptMessage ?? '', // 🔥 未授权提示消息
        nonWhitelistWelcomeMessage: setting?.nonWhitelistWelcomeMessage ?? '', // 🔥 非白名单欢迎消息
      },
    })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    // 🔥 安全检查：只有管理员才能修改特定群组的设置
    const unauth = assertAdmin(req)
    if (unauth) return unauth

    const { id: chatId } = await context.params
    const body = (await req.json().catch(() => ({}))) as {
      title?: string
      headerText?: string | null
      fixedRate?: number | null
      realtimeRate?: number | null
      feePercent?: number | null
      accountingMode?: 'DAILY_RESET' | 'CARRY_OVER' | 'SINGLE_BILL_PER_DAY'
      featureWarningMode?: string
      addressVerificationEnabled?: boolean
      dailyCutoffHour?: number
      hideHelpButton?: boolean
      hideOrderButton?: boolean
      deleteBillConfirm?: boolean // 🔥 删除账单确认功能
      calculatorEnabled?: boolean // 🔥 计算器功能开关
      showAuthPrompt?: boolean // 🔥 显示授权提示开关
      welcomeMessage?: string | null // 🔥 拉群欢迎消息
      authPromptMessage?: string | null // 🔥 未授权提示消息
      nonWhitelistWelcomeMessage?: string | null // 🔥 非白名单欢迎消息
    }

    // Update Chat.title if provided
    if (typeof body.title === 'string') {
      await prisma.chat.update({ where: { id: chatId }, data: { title: body.title } })
    }

    // Normalize mutually exclusive fixedRate/realtimeRate
    let fixedRate: number | null | undefined = body.fixedRate
    let realtimeRate: number | null | undefined = body.realtimeRate
    if (fixedRate != null) {
      realtimeRate = null
    } else if (realtimeRate != null) {
      fixedRate = null
    }

    const patchData: any = {}
    // 🔥 优化：只要有字段传入就处理，即使值为默认值也允许保存
    if (typeof body.headerText === 'string') patchData.headerText = body.headerText
    if (fixedRate !== undefined) patchData.fixedRate = fixedRate
    if (realtimeRate !== undefined) patchData.realtimeRate = realtimeRate
    if (typeof body.feePercent === 'number') patchData.feePercent = body.feePercent
    const hasAccountingMode = typeof body.accountingMode === 'string' && ACCOUNTING_MODE_VALUES.has(body.accountingMode)
    if (hasAccountingMode) {
      patchData.accountingMode = body.accountingMode
    }
    if (body.featureWarningMode && ['always', 'once', 'daily', 'silent'].includes(body.featureWarningMode)) patchData.featureWarningMode = body.featureWarningMode
    // 🔥 修复：boolean字段即使是false也要添加到patchData中
    if (typeof body.addressVerificationEnabled === 'boolean') patchData.addressVerificationEnabled = body.addressVerificationEnabled
    if (typeof body.dailyCutoffHour === 'number' && body.dailyCutoffHour >= 0 && body.dailyCutoffHour <= 23) patchData.dailyCutoffHour = body.dailyCutoffHour
    if (typeof body.hideHelpButton === 'boolean') patchData.hideHelpButton = body.hideHelpButton
    if (typeof body.hideOrderButton === 'boolean') patchData.hideOrderButton = body.hideOrderButton
    if (typeof body.deleteBillConfirm === 'boolean') patchData.deleteBillConfirm = body.deleteBillConfirm // 🔥 删除账单确认功能
    if (typeof body.calculatorEnabled === 'boolean') patchData.calculatorEnabled = body.calculatorEnabled // 🔥 计算器功能开关
    if (typeof body.showAuthPrompt === 'boolean') patchData.showAuthPrompt = body.showAuthPrompt // 🔥 显示授权提示开关
    if (body.welcomeMessage !== undefined) patchData.welcomeMessage = body.welcomeMessage // 🔥 拉群欢迎消息
    if (body.authPromptMessage !== undefined) patchData.authPromptMessage = body.authPromptMessage // 🔥 未授权提示消息
    if (body.nonWhitelistWelcomeMessage !== undefined) patchData.nonWhitelistWelcomeMessage = body.nonWhitelistWelcomeMessage // 🔥 非白名单欢迎消息

    // 🔥 优化：只要有传入任何设置字段就允许保存（即使值为默认值）
    // 如果patchData为空但传入了设置字段，仍然允许保存（可能是保存默认值）
    const hasSettingsFields = [
      'accountingMode',
      'featureWarningMode',
      'addressVerificationEnabled',
      'dailyCutoffHour',
      'hideHelpButton',
      'hideOrderButton',
      'deleteBillConfirm',
      'calculatorEnabled',
      'showAuthPrompt',
      'welcomeMessage',
      'authPromptMessage',
      'nonWhitelistWelcomeMessage',
      'feePercent',
      'fixedRate',
      'realtimeRate',
      'headerText'
    ].some(key => key in body)

    if (Object.keys(patchData).length === 0 && !hasSettingsFields && !body.title) {
      return new Response('Bad Request: No valid fields to update', { status: 400 })
    }
    
    // 🔥 如果patchData为空但有传入字段，说明可能是保存默认值，仍然执行upsert

    if (hasAccountingMode) {
      await prisma.$transaction([
        prisma.setting.upsert({
          where: { chatId },
          update: patchData,
          create: { chatId, ...patchData },
        }),
        prisma.globalConfig.upsert({
          where: { key: getChatAccountingModeKey(chatId) },
          create: {
            key: getChatAccountingModeKey(chatId),
            value: String(body.accountingMode),
            description: '群组记账模式覆盖',
            updatedBy: 'dashboard'
          },
          update: {
            value: String(body.accountingMode),
            updatedBy: 'dashboard'
          }
        })
      ])
    } else {
      await prisma.setting.upsert({
        where: { chatId },
        update: patchData,
        create: { chatId, ...patchData },
      })
    }

    // 🔥 如果更新了featureWarningMode，清除相关的警告记录，确保新设置立即生效
    if (body.featureWarningMode && ['always', 'once', 'daily', 'silent'].includes(body.featureWarningMode)) {
      // 清除所有相关功能的警告记录，让新设置立即生效
      await prisma.featureWarningLog.deleteMany({
        where: { chatId }
      }).catch(() => {})
    }

    const updated = await prisma.setting.findUnique({ where: { chatId } })
    return Response.json({ ok: true, settings: updated })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}

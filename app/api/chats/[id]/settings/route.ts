import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
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
      },
    })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: chatId } = await context.params
    const body = (await req.json().catch(() => ({}))) as {
      title?: string
      headerText?: string | null
      fixedRate?: number | null
      realtimeRate?: number | null
      feePercent?: number | null
      accountingMode?: 'DAILY_RESET' | 'CARRY_OVER'
      featureWarningMode?: string
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
    if (typeof body.headerText === 'string') patchData.headerText = body.headerText
    if (fixedRate !== undefined) patchData.fixedRate = fixedRate
    if (realtimeRate !== undefined) patchData.realtimeRate = realtimeRate
    if (typeof body.feePercent === 'number') patchData.feePercent = body.feePercent
    if (body.accountingMode === 'DAILY_RESET' || body.accountingMode === 'CARRY_OVER') patchData.accountingMode = body.accountingMode
    if (body.featureWarningMode && ['always', 'once', 'daily', 'silent'].includes(body.featureWarningMode)) patchData.featureWarningMode = body.featureWarningMode

    if (Object.keys(patchData).length === 0) return new Response('Bad Request', { status: 400 })

    await prisma.setting.upsert({
      where: { chatId },
      update: patchData,
      create: { chatId, ...patchData },
    })

    const updated = await prisma.setting.findUnique({ where: { chatId } })
    return Response.json({ ok: true, settings: updated })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}


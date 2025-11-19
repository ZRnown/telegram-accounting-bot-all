import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertAdmin, rateLimit } from '@/app/api/_auth'

function normalizeUsername(u?: string | null) {
  const x = (u || '').trim()
  if (!x) return ''
  return x.startsWith('@') ? x : `@${x}`
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'chat_ops_del', 30, 60 * 1000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })
    const { id: chatId } = await context.params
    const body = await req.json().catch(() => ({})) as { username?: string }
    const username = normalizeUsername(body.username)
    if (!username) return new NextResponse('Bad Request', { status: 400 })

    await prisma.operator.delete({ where: { chatId_username: { chatId, username } } }).catch(() => {})
    const items = await prisma.operator.findMany({ where: { chatId }, orderBy: { username: 'asc' } })
    return NextResponse.json({ ok: true, items })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const { id: chatId } = await context.params
    const ops = await prisma.operator.findMany({ where: { chatId }, orderBy: { username: 'asc' } })
    return NextResponse.json({ items: ops })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'chat_ops_post', 30, 60 * 1000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })
    const { id: chatId } = await context.params
    const body = await req.json().catch(() => ({})) as { username?: string }
    const username = normalizeUsername(body.username)
    if (!username || username.length < 2) return new NextResponse('Bad Request', { status: 400 })

    // ensure chat exists
    const chat = await prisma.chat.findUnique({ where: { id: chatId } })
    if (!chat) return new NextResponse('Not Found', { status: 404 })

    // upsert operator
    await prisma.operator.upsert({
      where: { chatId_username: { chatId, username } },
      update: {},
      create: { chatId, username },
    })

    const items = await prisma.operator.findMany({ where: { chatId }, orderBy: { username: 'asc' } })
    return NextResponse.json({ ok: true, items })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

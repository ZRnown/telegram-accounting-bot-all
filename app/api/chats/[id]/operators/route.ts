import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

function normalizeUsername(u?: string | null) {
  const x = (u || '').trim()
  if (!x) return ''
  return x.startsWith('@') ? x : `@${x}`
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: chatId } = await context.params
    const body = await req.json().catch(() => ({})) as { username?: string }
    const username = normalizeUsername(body.username)
    if (!username) return new Response('Bad Request', { status: 400 })

    await prisma.operator.delete({ where: { chatId_username: { chatId, username } } }).catch(() => {})
    const items = await prisma.operator.findMany({ where: { chatId }, orderBy: { username: 'asc' } })
    return Response.json({ ok: true, items })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: chatId } = await context.params
    const ops = await prisma.operator.findMany({ where: { chatId }, orderBy: { username: 'asc' } })
    return Response.json({ items: ops })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: chatId } = await context.params
    const body = await req.json().catch(() => ({})) as { username?: string }
    const username = normalizeUsername(body.username)
    if (!username || username.length < 2) return new Response('Bad Request', { status: 400 })

    // ensure chat exists
    const chat = await prisma.chat.findUnique({ where: { id: chatId } })
    if (!chat) return new Response('Not Found', { status: 404 })

    // upsert operator
    await prisma.operator.upsert({
      where: { chatId_username: { chatId, username } },
      update: {},
      create: { chatId, username },
    })

    const items = await prisma.operator.findMany({ where: { chatId }, orderBy: { username: 'asc' } })
    return Response.json({ ok: true, items })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}

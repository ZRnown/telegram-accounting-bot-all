import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db.js'
import { assertAdmin, rateLimit } from '@/app/api/_auth'

function normalizeName(name: string) {
  return (name || '').trim().toLowerCase()
}

function buildKey(botId: string) {
  return `customcmds:bot:${botId}`
}

export async function GET(req: NextRequest) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'cc_get', 60, 60 * 1000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })
    const { searchParams } = new URL(req.url)
    const botId = (searchParams.get('botId') || '').trim()
    if (!botId) return NextResponse.json({ error: 'botId is required' }, { status: 400 })

    const cfg = await prisma.globalConfig.findUnique({ where: { key: buildKey(botId) } })
    let items: Array<{ name: string; text?: string; imageUrl?: string; updatedAt?: string; updatedBy?: string }> = []
    if (cfg?.value) {
      try {
        const map = JSON.parse(String(cfg.value) || '{}') as Record<string, any>
        items = Object.entries(map).map(([k, v]: any) => ({ name: k, text: v?.text || '', imageUrl: v?.imageUrl || undefined, updatedAt: v?.updatedAt, updatedBy: v?.updatedBy }))
      } catch {}
    }
    return NextResponse.json({ items })
  } catch (e) {
    console.error('[custom-commands][GET]', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'cc_post', 30, 60 * 1000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })
    const body = await req.json().catch(() => ({}))
    const botId = String(body.botId || '').trim()
    const rawName = String(body.name || '')
    const text = typeof body.text === 'string' ? body.text : ''
    if (!botId || !rawName) return NextResponse.json({ error: 'botId and name are required' }, { status: 400 })
    const name = normalizeName(rawName)

    const key = buildKey(botId)
    const cfg = await prisma.globalConfig.findUnique({ where: { key } })
    let map: Record<string, any> = {}
    if (cfg?.value) {
      try { map = JSON.parse(String(cfg.value) || '{}') } catch {}
    }
    const prev = map[name] || {}
    map[name] = { ...prev, text, updatedAt: new Date().toISOString(), updatedBy: 'admin' }

    await prisma.globalConfig.upsert({
      where: { key },
      update: { value: JSON.stringify(map), description: `Custom commands for bot ${botId}`, updatedBy: 'admin', updatedAt: new Date() },
      create: { key, value: JSON.stringify(map), description: `Custom commands for bot ${botId}`, updatedBy: 'admin' }
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[custom-commands][POST]', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'cc_del', 30, 60 * 1000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })
    const body = await req.json().catch(() => ({}))
    const botId = String(body.botId || '').trim()
    const rawName = String(body.name || '')
    if (!botId || !rawName) return NextResponse.json({ error: 'botId and name are required' }, { status: 400 })
    const name = normalizeName(rawName)

    const key = buildKey(botId)
    const cfg = await prisma.globalConfig.findUnique({ where: { key } })
    let map: Record<string, any> = {}
    if (cfg?.value) {
      try { map = JSON.parse(String(cfg.value) || '{}') } catch {}
    }
    if (!map[name]) return NextResponse.json({ error: 'not found' }, { status: 404 })
    delete map[name]

    if (Object.keys(map).length === 0) {
      await prisma.globalConfig.delete({ where: { key } }).catch(() => {})
      return NextResponse.json({ ok: true })
    }

    await prisma.globalConfig.upsert({
      where: { key },
      update: { value: JSON.stringify(map), updatedBy: 'admin', updatedAt: new Date() },
      create: { key, value: JSON.stringify(map), description: `Custom commands for bot ${botId}`, updatedBy: 'admin' }
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[custom-commands][DELETE]', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

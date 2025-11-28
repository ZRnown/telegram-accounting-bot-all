import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db.js'
import { assertAdmin, rateLimit } from '@/app/api/_auth'

function normalizeName(name: string) {
  return (name || '').trim().toLowerCase()
}

function buildKey(botId: string) {
  return `customcmds:bot:${botId}`
}

function isValidImageUrl(url?: string) {
  if (!url) return false
  // allow site-relative uploads path
  if (url.startsWith('/uploads/')) return true
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export async function PUT(req: NextRequest) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'cc_img_put', 30, 60 * 1000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })
    const body = await req.json().catch(() => ({}))
    const botId = String(body.botId || '').trim()
    const rawName = String(body.name || '')
    const imageUrlRaw = body.imageUrl == null ? null : String(body.imageUrl)
    if (!botId || !rawName) return NextResponse.json({ error: 'botId and name are required' }, { status: 400 })
    const name = normalizeName(rawName)

    const key = buildKey(botId)
    const cfg = await prisma.globalConfig.findUnique({ where: { key } })
    let map: Record<string, any> = {}
    if (cfg?.value) {
      try { map = JSON.parse(String(cfg.value) || '{}') } catch {}
    }
    if (!map[name]) map[name] = {}

    if (imageUrlRaw === null || imageUrlRaw === '') {
      delete map[name].imageUrl
    } else {
      if (!isValidImageUrl(imageUrlRaw)) {
        return NextResponse.json({ error: 'invalid imageUrl' }, { status: 400 })
      }
      map[name].imageUrl = imageUrlRaw
    }
    map[name].updatedAt = new Date().toISOString()
    map[name].updatedBy = 'admin'

    await prisma.globalConfig.upsert({
      where: { key },
      update: { value: JSON.stringify(map), description: `Custom commands for bot ${botId}`, updatedBy: 'admin', updatedAt: new Date() },
      create: { key, value: JSON.stringify(map), description: `Custom commands for bot ${botId}`, updatedBy: 'admin' }
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[custom-commands:image][PUT]', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertAdmin, rateLimit } from '@/app/api/_auth'

// 简易内存缓存：key=chatId，值为 { expires, items }
type EligibleItem = { id: string; name: string }
const cache = new Map<string, { expires: number; items: EligibleItem[] }>()
const TTL_MS = 5 * 60_000 // 🔥 增加到5分钟缓存，减少验证频率
const CONCURRENCY = 3 // 🔥 适度增加并发数，提升速度
const REQUEST_TIMEOUT_MS = 1000 // 🔥 1秒超时，快速失败

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'eligible_bots', 60, 60 * 1000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })
    const { id } = await params
    const now = Date.now()
    const hit = cache.get(id)
    if (hit && hit.expires > now) {
      return NextResponse.json({ items: hit.items })
    }
    // 仅考虑启用中的机器人
    const bots = await prisma.bot.findMany({
      where: { enabled: true },
      select: { id: true, name: true, token: true },
    }) as Array<{ id: string; name: string; token: string | null }>
    const eligible: Array<{ id: string; name: string }> = []

    // 并发限制执行器
    let index = 0
    async function worker() {
      while (index < bots.length) {
        const b: { id: string; name: string; token: string | null } = bots[index++]
        if (!b?.token) continue
        try {
          const url = `https://api.telegram.org/bot${encodeURIComponent(b.token)}/getChat?chat_id=${encodeURIComponent(id)}`
          const resp = await fetch(url, { 
            method: 'GET',
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) // 🔥 快速超时
          })
          if (!resp.ok) continue
          const j = await resp.json().catch(() => null)
          if (j && j.ok) eligible.push({ id: b.id, name: b.name })
        } catch {
          // 超时或失败时跳过，继续下一个
        }
      }
    }
    const workers = Array.from({ length: Math.min(CONCURRENCY, Math.max(1, bots.length)) }, () => worker())
    await Promise.all(workers)

    // 若未探测到任何可绑定机器人，则回退返回所有启用中的机器人（由 PATCH 端严格校验）
    const result = eligible.length > 0 ? eligible : bots.map((b: { id: string; name: string }) => ({ id: b.id, name: b.name }))

    // 仅当结果非空且为“已探测列表”时缓存，避免把空结果缓存导致前端长期看不到选项
    if (eligible.length > 0) {
      cache.set(id, { expires: now + TTL_MS, items: result })
    }

    return NextResponse.json({ items: result })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

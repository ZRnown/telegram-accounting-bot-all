import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertAdmin } from '@/app/api/_auth'

function ok(data: any) {
  return NextResponse.json(data)
}
function bad(msg = 'Bad Request', code = 400) {
  return NextResponse.json({ error: msg }, { status: code })
}

const DEFAULT_VALUE = { exact_map: {}, prefix_map: {} }

export async function GET() {
  try {
    const row = await prisma.globalConfig.findUnique({ where: { key: 'command_alias_map' } })
    if (!row) return ok(DEFAULT_VALUE)
    try {
      const obj = JSON.parse(row.value || '{}')
      const exact_map = obj && typeof obj.exact_map === 'object' ? obj.exact_map : {}
      const prefix_map = obj && typeof obj.prefix_map === 'object' ? obj.prefix_map : {}
      return ok({ exact_map, prefix_map })
    } catch {
      return ok(DEFAULT_VALUE)
    }
  } catch (e) {
    console.error('[GET /api/global-config/commands]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const body = await req.json().catch(() => ({})) as any
    const exact_map = body?.exact_map
    const prefix_map = body?.prefix_map

    if (exact_map && typeof exact_map !== 'object') return bad('exact_map must be object')
    if (prefix_map && typeof prefix_map !== 'object') return bad('prefix_map must be object')

    // 简单配额限制，避免超长配置
    const sanitize = (obj: any) => {
      const out: Record<string, string> = {}
      if (!obj || typeof obj !== 'object') return out
      const entries = Object.entries(obj).slice(0, 200)
      for (const [k, v] of entries) {
        const kk = String(k || '').trim()
        const vv = String(v || '').trim()
        if (!kk || !vv) continue
        if (kk.length > 100 || vv.length > 100) continue
        out[kk] = vv
      }
      return out
    }

    const valueObj = {
      exact_map: sanitize(exact_map || {}),
      prefix_map: sanitize(prefix_map || {}),
    }

    await prisma.globalConfig.upsert({
      where: { key: 'command_alias_map' },
      create: { key: 'command_alias_map', value: JSON.stringify(valueObj), description: 'Global command alias map', updatedBy: 'admin' },
      update: { value: JSON.stringify(valueObj), description: 'Global command alias map', updatedBy: 'admin' },
    })

    return ok(valueObj)
  } catch (e) {
    console.error('[POST /api/global-config/commands]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

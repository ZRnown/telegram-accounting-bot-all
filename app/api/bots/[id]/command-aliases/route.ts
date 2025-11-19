import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

function ok(data: any) { return Response.json(data) }
function bad(msg = 'Bad Request', code = 400) { return new Response(msg, { status: code }) }
function isAdmin(req: NextRequest) { return (req.headers.get('x-auth-token') || '') === 'authenticated' }

const def = { exact_map: {}, prefix_map: {} }

function sanitize(obj: any) {
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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const p = await params
    const botId = p?.id
    if (!botId) return bad('Missing bot id', 400)
    const key = `command_alias_map:${botId}`
    const row = await prisma.globalConfig.findUnique({ where: { key } })
    if (!row) return ok(def)
    try {
      const obj = JSON.parse(row.value || '{}')
      const exact_map = obj && typeof obj.exact_map === 'object' ? obj.exact_map : {}
      const prefix_map = obj && typeof obj.prefix_map === 'object' ? obj.prefix_map : {}
      return ok({ exact_map, prefix_map })
    } catch {
      return ok(def)
    }
  } catch (e) {
    console.error('[GET /api/bots/[id]/command-aliases]', e)
    return new Response('Server error', { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!isAdmin(req)) return bad('Unauthorized', 401)
    const p = await params
    const botId = p?.id
    if (!botId) return bad('Missing bot id', 400)
    const body = await req.json().catch(() => ({})) as any
    const exact_map = body?.exact_map
    const prefix_map = body?.prefix_map

    if (exact_map && typeof exact_map !== 'object') return bad('exact_map must be object')
    if (prefix_map && typeof prefix_map !== 'object') return bad('prefix_map must be object')

    const valueObj = {
      exact_map: sanitize(exact_map || {}),
      prefix_map: sanitize(prefix_map || {}),
    }

    const key = `command_alias_map:${botId}`
    await prisma.globalConfig.upsert({
      where: { key },
      create: { key, value: JSON.stringify(valueObj), description: `Command alias map for bot ${botId}`, updatedBy: 'admin' },
      update: { value: JSON.stringify(valueObj), description: `Command alias map for bot ${botId}`, updatedBy: 'admin' },
    })

    return ok(valueObj)
  } catch (e) {
    console.error('[POST /api/bots/[id]/command-aliases]', e)
    return new Response('Server error', { status: 500 })
  }
}

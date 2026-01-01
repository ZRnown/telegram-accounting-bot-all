import { NextRequest } from 'next/server'
import { assertAdmin } from '@/app/api/_auth'

function ok(data: any) { return Response.json(data) }
function bad(msg = 'Bad Request', code = 400) { return new Response(msg, { status: code }) }

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const p = await params
    const botId = p?.id
    if (!botId) return bad('Missing bot id', 400)

    // 动态导入本地命令清单（JS模块）
    const mod = await import('../../../../../bot/commands-registry.js')
    const commands = Array.isArray((mod as any).commandsRegistry) ? (mod as any).commandsRegistry : []

    // 基本清洗与限制，防止异常膨胀
    const limited = commands.slice(0, 500).map((c: any) => ({
      type: String(c.type || ''),
      key: String(c.key || ''),
      title: String(c.title || ''),
      desc: String(c.desc || ''),
      examples: Array.isArray(c.examples) ? c.examples.slice(0, 5).map((x: any) => String(x)) : [],
      group: String(c.group || ''),
    }))

    return ok({ commands: limited })
  } catch (e) {
    console.error('[GET /api/bots/[id]/commands]', e)
    return new Response('Server error', { status: 500 })
  }
}

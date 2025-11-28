import { NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { token?: string }
    const token = (body.token || '').trim()
    if (!token) return Response.json({ error: 'Missing token' }, { status: 400 })

    const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const resp = await fetch(url, { method: 'GET', signal: controller.signal })

    clearTimeout(timeout)
    if (!resp.ok) {
      return Response.json({ error: `Telegram getMe failed: ${resp.status}` }, { status: 400 })
    }
    const data = await resp.json()
    if (!data?.ok) {
      return Response.json({ error: 'Telegram getMe returned not ok' }, { status: 400 })
    }
    const me = data.result || {}
    return Response.json({
      id: me.id,
      is_bot: me.is_bot,
      first_name: me.first_name,
      username: me.username,
      can_join_groups: me.can_join_groups,
      can_read_all_group_messages: me.can_read_all_group_messages,
      supports_inline_queries: me.supports_inline_queries,
    })
  } catch (e) {
    console.error(e)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}

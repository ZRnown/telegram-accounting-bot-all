import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { assertAdmin, rateLimit } from '@/app/api/_auth'

export async function POST(req: NextRequest) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'upload', 3, 60 * 1000)
    if (!rl.ok) return NextResponse.json({ error: `Too many uploads. Retry after ${rl.retryAfter}s` }, { status: 429 })
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 })

    // Size limit: 3MB
    const MAX_SIZE = 3 * 1024 * 1024
    const arrayBuffer = await file.arrayBuffer()
    if (arrayBuffer.byteLength > MAX_SIZE) {
      return NextResponse.json({ error: 'File too large (max 3MB)' }, { status: 413 })
    }
    const buffer = Buffer.from(arrayBuffer)

    // MIME & extension whitelist
    const allowedExt = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
    const ext = path.extname(file.name || '').toLowerCase()
    const mime = (file.type || '').toLowerCase()
    if (!allowedExt.has(ext) || !mime.startsWith('image/')) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
    }

    // Basic magic number check
    const sig = buffer.subarray(0, 12)
    const isPng = sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4e && sig[3] === 0x47
    const isJpeg = sig[0] === 0xff && sig[1] === 0xd8 && sig[2] === 0xff
    const isGif = sig[0] === 0x47 && sig[1] === 0x49 && sig[2] === 0x46 // GIF
    const isWebp = sig.toString('utf8', 0, 4) === 'RIFF' && sig.toString('utf8', 8, 12) === 'WEBP'
    if (!(isPng || isJpeg || isGif || isWebp)) {
      return NextResponse.json({ error: 'Invalid image signature' }, { status: 400 })
    }

    const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
    await fs.mkdir(uploadsDir, { recursive: true })

    const ts = Date.now()
    const safeName = (file.name || 'image').replace(/[^a-zA-Z0-9._-]/g, '_')
    const filename = `${ts}_${Math.random().toString(36).slice(2,8)}_${safeName}`
    const filepath = path.join(uploadsDir, filename)

    await fs.writeFile(filepath, buffer)

    const url = `/uploads/${filename}`
    return NextResponse.json({ url })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
  }
}

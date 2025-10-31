import { NextRequest, NextResponse } from 'next/server'
import { getMarkPrice } from '@/lib/okx-api'

/**
 * 获取OKX标记价格
 * GET /api/okx/mark-price?instType=SWAP&instId=BTC-USDT-SWAP
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const instType = searchParams.get('instType')
    const instFamily = searchParams.get('instFamily')
    const instId = searchParams.get('instId')

    if (!instType) {
      return NextResponse.json(
        { error: 'instType参数是必需的' },
        { status: 400 }
      )
    }

    const params: { instType: string; instFamily?: string; instId?: string } = { instType }
    if (instFamily) params.instFamily = instFamily
    if (instId) params.instId = instId

    const prices = await getMarkPrice(params)

    return NextResponse.json({
      success: true,
      data: prices,
      count: prices.length,
    })
  } catch (error: any) {
    console.error('[OKX Mark Price API] 错误:', error)
    return NextResponse.json(
      {
        error: '获取标记价格失败',
        message: error.message || 'Unknown error',
      },
      { status: 500 }
    )
  }
}


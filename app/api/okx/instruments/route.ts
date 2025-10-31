import { NextRequest, NextResponse } from 'next/server'
import { getInstruments } from '@/lib/okx-api'

/**
 * 获取OKX交易产品基础信息
 * GET /api/okx/instruments?instType=SPOT&instId=BTC-USDT
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

    const instruments = await getInstruments(params)

    return NextResponse.json({
      success: true,
      data: instruments,
      count: instruments.length,
    })
  } catch (error: any) {
    console.error('[OKX Instruments API] 错误:', error)
    return NextResponse.json(
      {
        error: '获取产品信息失败',
        message: error.message || 'Unknown error',
      },
      { status: 500 }
    )
  }
}


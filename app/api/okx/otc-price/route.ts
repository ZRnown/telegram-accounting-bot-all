import { NextRequest, NextResponse } from 'next/server'
import { getOKXOTCPrice } from '@/lib/okx-api'

/**
 * 获取OKX OTC价格（z0标识）
 * GET /api/okx/otc-price?instType=SPOT
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const instType = (searchParams.get('instType') || 'SPOT') as 'SPOT' | 'SWAP'

    const priceData = await getOKXOTCPrice(instType)

    if (!priceData) {
      return NextResponse.json(
        { error: '无法获取OKX OTC价格', source: 'z0' },
        { status: 503 }
      )
    }

    return NextResponse.json({
      success: true,
      ...priceData,
      formattedPrice: priceData.price.toFixed(2),
      formattedTime: new Date(priceData.timestamp).toISOString(),
    })
  } catch (error: any) {
    console.error('[OKX OTC Price API] 错误:', error)
    return NextResponse.json(
      {
        error: '获取OKX OTC价格失败',
        message: error.message || 'Unknown error',
        source: 'z0',
      },
      { status: 500 }
    )
  }
}


import { NextRequest } from 'next/server'

interface BinanceP2POrder {
  adv: {
    price: string
    minSingleTransAmount: string
    maxSingleTransAmount: string
    tradeMethods?: Array<{
      tradeMethodName: string
    }>
  }
}

interface BinanceP2PResponse {
  data: BinanceP2POrder[]
}

interface OTCPriceData {
  avg: number
  min: number
  max: number
  prices: number[]
  orders: BinanceP2POrder[]
  count: number
}

/**
 * 获取CoinGecko汇率
 */
async function fetchCoinGeckoRateUSDTtoCNY(): Promise<number | null> {
  try {
    const resp = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=cny',
      { method: 'GET' }
    )
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const rate = Number(data?.tether?.cny)
    if (!rate || !Number.isFinite(rate)) throw new Error('Invalid CoinGecko rate')
    return Number(rate.toFixed(2))
  } catch (e) {
    console.error('[CoinGecko汇率获取失败]', e)
    return null
  }
}

/**
 * 获取ExchangeRate Host的USD到CNY汇率（作为最后备用）
 */
async function fetchExchangeRateHostUSDToCNY(): Promise<number | null> {
  try {
    const resp = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=CNY', {
      method: 'GET',
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const rate = Number(data?.rates?.CNY)
    if (!rate || !Number.isFinite(rate)) throw new Error('Invalid exchangerate.host rate')
    return Number(rate.toFixed(2))
  } catch (e) {
    console.error('[exchangerate.host汇率获取失败]', e)
    return null
  }
}

/**
 * 获取实时汇率（备用数据源）
 * 优先级：币安P2P > CoinGecko > ExchangeRate Host
 */
async function fetchRealtimeRateUSDTtoCNY(): Promise<number | null> {
  // 先尝试从币安P2P获取（使用SELL价格作为参考）
  const p2pData = await fetchBinanceP2PDetailed('SELL', 10)
  if (p2pData) {
    return Number(p2pData.avg.toFixed(2))
  }

  // 备用方案1：CoinGecko
  const coinGeckoRate = await fetchCoinGeckoRateUSDTtoCNY()
  if (coinGeckoRate) {
    return coinGeckoRate
  }

  // 备用方案2：ExchangeRate Host (USD/CNY，作为最后备用)
  const exchangeRate = await fetchExchangeRateHostUSDToCNY()
  return exchangeRate
}

/**
 * 获取币安P2P详细价格信息（OTC价格）
 * @param tradeType - 'SELL' 或 'BUY'
 * @param rows - 获取的订单数量，默认20
 * @param timeout - 超时时间（毫秒），默认8000
 */
async function fetchBinanceP2PDetailed(
  tradeType: 'SELL' | 'BUY' = 'SELL',
  rows: number = 20,
  timeout: number = 8000
): Promise<OTCPriceData | null> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const resp = await fetch('https://p2p.binance.com/bapi/c2c/v2/public/c2c/adv/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        page: 1,
        rows: rows,
        payTypes: [],
        asset: 'USDT',
        tradeType: tradeType,
        fiat: 'CNY',
        publisherType: null,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data: BinanceP2PResponse = await resp.json()
    const orders = Array.isArray(data?.data) ? data.data : []
    const prices = orders
      .map((item) => Number(item?.adv?.price))
      .filter((p) => Number.isFinite(p) && p > 0)

    if (!prices.length) throw new Error('No valid price from Binance P2P')

    // 计算统计数据
    const sortedPrices = [...prices].sort((a, b) => a - b)
    const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length
    const min = sortedPrices[0]
    const max = sortedPrices[sortedPrices.length - 1]

    return {
      avg: Number(avg.toFixed(4)),
      min: Number(min.toFixed(4)),
      max: Number(max.toFixed(4)),
      prices: sortedPrices,
      orders: orders.slice(0, 10), // 只返回前10个订单详情
      count: prices.length,
    }
  } catch (e) {
    console.error(`[Binance P2P ${tradeType}] 获取失败`, e)
    return null
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const detailed = searchParams.get('detailed') === 'true'
    const rows = Math.min(100, Math.max(1, Number(searchParams.get('rows') || '20')))

    // 并行获取买价和卖价
    const [buyData, sellData] = await Promise.all([
      fetchBinanceP2PDetailed('BUY', rows),
      fetchBinanceP2PDetailed('SELL', rows),
    ])

    // 🔥 如果币安P2P不可用，尝试使用备用数据源
    if (!buyData && !sellData) {
      const fallbackRate = await fetchRealtimeRateUSDTtoCNY()
      if (fallbackRate) {
        // 返回备用汇率格式（单价格）
        return Response.json({
          success: true,
          timestamp: new Date().toISOString(),
          fallback: true,
          source: 'backup',
          message: '币安P2P暂时不可用，使用备用汇率',
          rate: fallbackRate,
          buy: null,
          sell: null,
          spread: null,
        })
      }

      // 所有数据源都失败
      return Response.json(
        {
          success: false,
          error: '无法获取OTC价格信息',
          message: '所有数据源均不可用，请稍后重试',
        },
        { status: 503 }
      )
    }

    // 计算价差
    let spread: { value: number; percent: string } | null = null
    if (buyData && sellData) {
      const spreadValue = buyData.avg - sellData.avg
      const spreadPercent = ((spreadValue / sellData.avg) * 100).toFixed(2)
      spread = {
        value: Number(spreadValue.toFixed(4)),
        percent: spreadPercent,
      }
    }

    const response: {
      success: true
      timestamp: string
      fallback?: boolean
      source?: string
      buy?: OTCPriceData
      sell?: OTCPriceData
      spread?: { value: number; percent: string }
    } = {
      success: true,
      timestamp: new Date().toISOString(),
      source: 'binance_p2p',
    }

    if (buyData) {
      if (detailed) {
        response.buy = buyData
      } else {
        // 简化版本，不包含详细订单列表
        response.buy = {
          avg: buyData.avg,
          min: buyData.min,
          max: buyData.max,
          prices: buyData.prices,
          orders: [],
          count: buyData.count,
        }
      }
    }

    if (sellData) {
      if (detailed) {
        response.sell = sellData
      } else {
        // 简化版本，不包含详细订单列表
        response.sell = {
          avg: sellData.avg,
          min: sellData.min,
          max: sellData.max,
          prices: sellData.prices,
          orders: [],
          count: sellData.count,
        }
      }
    }

    if (spread) {
      response.spread = spread
    }

    return Response.json(response)
  } catch (e) {
    console.error('[OTC价格API错误]', e)
    return Response.json(
      {
        success: false,
        error: '服务器错误',
        message: e instanceof Error ? e.message : '未知错误',
      },
      { status: 500 }
    )
  }
}


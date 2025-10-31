/**
 * OKX API 客户端
 * 支持调用OKX公共REST API接口
 */

const OKX_BASE_URL = 'https://www.okx.com'

export interface OKXApiResponse<T> {
  code: string
  msg: string
  data: T[]
}

export interface OKXInstrument {
  instType: string
  instId: string
  baseCcy?: string
  quoteCcy?: string
  settleCcy?: string
  tickSz?: string
  lotSz?: string
  minSz?: string
  lever?: string
  state?: string
  [key: string]: any
}

export interface OKXMarkPrice {
  instType: string
  instId: string
  markPx: string
  ts: string
}

export interface OKXPriceLimit {
  instType: string
  instId: string
  buyLmt: string
  sellLmt: string
  ts: string
  enabled: boolean
}

export interface OKXFundingRate {
  instType: string
  instId: string
  fundingRate: string
  fundingTime: string
  nextFundingTime: string
  ts: string
  [key: string]: any
}

/**
 * 调用OKX API
 */
async function callOKXApi<T>(
  endpoint: string,
  params?: Record<string, string>
): Promise<OKXApiResponse<T>> {
  const url = new URL(`${OKX_BASE_URL}${endpoint}`)
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value) {
        url.searchParams.append(key, value)
      }
    })
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000) // 10秒超时

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`OKX API error: HTTP ${response.status}`)
    }

    const data: OKXApiResponse<T> = await response.json()

    if (data.code !== '0') {
      throw new Error(`OKX API error: ${data.msg || data.code}`)
    }

    return data
  } catch (error: any) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error('OKX API request timeout')
    }
    throw error
  }
}

/**
 * 获取交易产品基础信息
 */
export async function getInstruments(params: {
  instType: string
  instFamily?: string
  instId?: string
}): Promise<OKXInstrument[]> {
  const response = await callOKXApi<OKXInstrument>('/api/v5/public/instruments', params)
  return response.data
}

/**
 * 获取标记价格（可用于OTC价格参考）
 */
export async function getMarkPrice(params: {
  instType: string
  instFamily?: string
  instId?: string
}): Promise<OKXMarkPrice[]> {
  const response = await callOKXApi<OKXMarkPrice>('/api/v5/public/mark-price', params)
  return response.data
}

/**
 * 获取限价
 */
export async function getPriceLimit(instId: string): Promise<OKXPriceLimit[]> {
  const response = await callOKXApi<OKXPriceLimit>('/api/v5/public/price-limit', { instId })
  return response.data
}

/**
 * 获取永续合约当前资金费率
 */
export async function getFundingRate(instId: string): Promise<OKXFundingRate[]> {
  const response = await callOKXApi<OKXFundingRate>('/api/v5/public/funding-rate', { instId })
  return response.data
}

/**
 * 获取USDT到CNY的OTC价格（使用z0标识）
 * 优先使用指数价格接口获取USDT-CNY价格
 */
export async function getOKXOTCPrice(
  instType: 'SPOT' | 'SWAP' = 'SPOT'
): Promise<{ price: number; instId: string; timestamp: number; source: 'z0' } | null> {
  let lastError: any = null
  
  // 方法1: 优先获取USDT-CNY指数价格（最准确）
  try {
    const url = new URL(`${OKX_BASE_URL}/api/v5/market/index-tickers`)
    url.searchParams.append('instId', 'USDT-CNY')
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      signal: controller.signal,
    })
    
    clearTimeout(timeoutId)
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`指数价格接口 HTTP ${response.status}: ${errorText}`)
    }
    
    const data: OKXApiResponse<any> = await response.json()
    
    if (data.code !== '0') {
      throw new Error(`指数价格接口错误: code=${data.code}, msg=${data.msg || '未知错误'}`)
    }
    
    if (Array.isArray(data.data) && data.data.length > 0) {
      const idxPx = parseFloat(data.data[0].idxPx || '0')
      if (idxPx > 0) {
        console.log('[OKX API] 成功获取USDT-CNY指数价格:', idxPx)
        return {
          price: idxPx,
          instId: data.data[0].instId || 'USDT-CNY',
          timestamp: parseInt(data.data[0].ts || '0'),
          source: 'z0',
        }
      }
    }
    
    throw new Error('指数价格数据为空或无效')
  } catch (error: any) {
    lastError = error
    console.error('[OKX API] 获取指数价格失败:', {
      error: error.message,
      stack: error.stack
    })
  }
  
  // 注意：不返回BTC价格，只返回USDT-CNY价格用于实时汇率
  // 如果无法获取USDT-CNY价格，返回null，让其他备用方案处理
  
  // 所有方法都失败
  console.error('[OKX API] 获取OTC价格完全失败，最后错误:', {
    lastError: lastError?.message,
    stack: lastError?.stack
  })
  
  return null
}

/**
 * 获取多个产品的标记价格
 */
export async function getMultipleMarkPrices(
  instIds: string[],
  instType: 'SPOT' | 'SWAP' | 'FUTURES' = 'SPOT'
): Promise<Record<string, OKXMarkPrice>> {
  const results: Record<string, OKXMarkPrice> = {}

  try {
    // 并发获取所有产品的标记价格
    const promises = instIds.map(async (instId) => {
      try {
        const prices = await getMarkPrice({ instType, instId })
        if (prices.length > 0) {
          results[instId] = prices[0]
        }
      } catch (error) {
        console.error(`[OKX API] 获取 ${instId} 标记价格失败:`, error)
      }
    })

    await Promise.all(promises)
  } catch (error) {
    console.error('[OKX API] 批量获取标记价格失败:', error)
  }

  return results
}


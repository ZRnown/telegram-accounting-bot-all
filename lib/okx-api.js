/**
 * OKX C2C API 客户端
 * 仅支持获取C2C挂单数据
 */
/**
 * 获取OKX C2C挂单数据
 * @param paymentMethod - 支付方式 ('all', 'alipay', 'wxPay', 'bank')
 * @returns 返回处理过的卖家列表（按价格从低到高排序）
 */
export async function getOKXC2CSellers(paymentMethod = 'all') {
    const BASE_URL = 'https://www.okx.com/v3/c2c/tradingOrders/books';
    // 构建请求参数（根据用户提供的真实API格式）
    // 注意：API参数需要使用小写的 alipay，但返回数据中支付方式是 aliPay
    const params = new URLSearchParams({
        quoteCurrency: 'CNY',
        baseCurrency: 'USDT',
        paymentMethod: paymentMethod,
        showTrade: 'false',
        receivingAds: 'false',
        isAbleFilter: 'false',
        showFollow: 'false',
        showAlreadyTraded: 'false',
        side: 'sell',
        userType: 'all',
        t: Date.now().toString(), // 使用当前时间戳防止缓存
    });
    if (process.env.DEBUG_BOT === 'true') {
        console.log('[OKX C2C API] 请求URL:', `${BASE_URL}?${params.toString()}`);
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
    try {
        const response = await fetch(`${BASE_URL}?${params.toString()}`, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json',
            },
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
            throw new Error(`OKX C2C API HTTP ${response.status}`);
        }
        const data = await response.json();
        // 数据校验：code 可能是数字 0 或字符串 '0'
        if (data && (data.code === 0 || data.code === '0') && Array.isArray(data.data?.sell)) {
            // 提取、处理和排序数据
            const sellers = data.data.sell.map((seller) => ({
                nickName: seller.nickName || '未知商家',
                price: parseFloat(seller.price || '0'),
                paymentMethods: Array.isArray(seller.paymentMethods) ? seller.paymentMethods : [],
                availableAmount: parseFloat(seller.availableAmount || '0'),
                quoteMinAmountPerOrder: parseFloat(seller.quoteMinAmountPerOrder || '0'),
                quoteMaxAmountPerOrder: parseFloat(seller.quoteMaxAmountPerOrder || '0'),
            }));
            // 按价格从低到高排序
            sellers.sort((a, b) => a.price - b.price);
            return sellers;
        }
        else {
            console.error('[OKX C2C API] 返回数据格式不正确:', {
                code: data?.code,
                msg: data?.msg || data?.error_message || '未知错误',
                hasData: !!data?.data,
                hasSell: !!data?.data?.sell,
                sellIsArray: Array.isArray(data?.data?.sell)
            });
            return [];
        }
    }
    catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('OKX C2C API 请求超时');
        }
        console.error('[OKX C2C API] 请求失败:', error);
        throw error;
    }
}

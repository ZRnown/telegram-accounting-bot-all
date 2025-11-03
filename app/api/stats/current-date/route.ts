import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * 获取当前应该查看的日期（基于日切时间）
 * 如果现在是4号1:12，日切是2点，返回3号的日期字符串
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const chatIdParam = searchParams.get('chatId')
    
    // 获取chatId
    let chatId = chatIdParam || ''
    if (!chatId) {
      const latestBill = await prisma.bill.findFirst({ orderBy: { savedAt: 'desc' } })
      chatId = latestBill?.chatId || ''
    }
    
    if (!chatId) {
      // 如果没有chatId，返回今天的日期
      const today = new Date()
      const year = today.getFullYear()
      const month = String(today.getMonth() + 1).padStart(2, '0')
      const day = String(today.getDate()).padStart(2, '0')
      return Response.json({ date: `${year}-${month}-${day}` })
    }

    // 🔥 获取日切时间设置
    const settings = await prisma.setting.findUnique({
      where: { chatId },
      select: { dailyCutoffHour: true }
    })

    // 🔥 使用日切时间计算当前应该查看的日期
    let cutoffHour = 0 // 默认值
    if (settings?.dailyCutoffHour != null && settings.dailyCutoffHour >= 0 && settings.dailyCutoffHour <= 23) {
      cutoffHour = settings.dailyCutoffHour
    } else {
      // 🔥 查询全局配置获取默认日切时间
      try {
        const globalConfig = await prisma.globalConfig.findUnique({
          where: { key: 'daily_cutoff_hour' },
          select: { value: true }
        })
        if (globalConfig?.value) {
          const hour = parseInt(globalConfig.value, 10)
          if (!isNaN(hour) && hour >= 0 && hour <= 23) {
            cutoffHour = hour
          }
        }
      } catch (e) {
        // 查询失败时使用默认值0
        console.error('[stats/current-date] 查询全局日切时间失败:', e)
      }
    }

    // 计算当前应该查看的日期
    const now = new Date()
    const todayCutoff = new Date()
    todayCutoff.setFullYear(now.getFullYear(), now.getMonth(), now.getDate())
    todayCutoff.setHours(cutoffHour, 0, 0, 0)
    
    let targetDate: Date
    if (now >= todayCutoff) {
      // 当前时间 >= 今天的日切时间，应该查看今天
      targetDate = now
    } else {
      // 当前时间 < 今天的日切时间，应该查看昨天
      targetDate = new Date(todayCutoff)
      targetDate.setDate(targetDate.getDate() - 1)
    }
    
    // 格式化日期字符串
    const year = targetDate.getFullYear()
    const month = String(targetDate.getMonth() + 1).padStart(2, '0')
    const day = String(targetDate.getDate()).padStart(2, '0')
    
    return Response.json({ date: `${year}-${month}-${day}` })
  } catch (e) {
    console.error('[stats/current-date] 错误:', e)
    // 出错时返回今天的日期
    const today = new Date()
    const year = today.getFullYear()
    const month = String(today.getMonth() + 1).padStart(2, '0')
    const day = String(today.getDate()).padStart(2, '0')
    return Response.json({ date: `${year}-${month}-${day}` })
  }
}

import type { PrismaClient } from '@prisma/client'

// 功能开关的默认配置（统一管理，避免重复）
// ⚠️ 注意：这里只定义功能名称，创建时会全部设为 enabled: true
export const DEFAULT_FEATURES = [
  'realtime_rate',
  'fixed_rate',
  'fee_setting',
  'rmb_mode',
  'commission_mode',
  'display_modes',
  'show_mode_compact',
  'show_mode_full',
  'class_mute',
  'operators_bypass_mute',
  'accounting_basic',
  'title_setting',
]

/**
 * 为群组创建默认功能开关（全部启用）
 * @param chatId - 群组ID
 * @param prisma - Prisma 客户端
 * @returns Promise<boolean> - 是否创建成功
 */
export async function ensureDefaultFeatures(chatId: string, prisma: PrismaClient): Promise<boolean> {
  try {
    const existingFlags = await prisma.chatFeatureFlag.count({ where: { chatId } })
    
    if (existingFlags === 0) {
      const features = DEFAULT_FEATURES.map(feature => ({
        chatId,
        feature,
        enabled: true
      }))
      
      await prisma.chatFeatureFlag.createMany({
        data: features,
        skipDuplicates: true
      })
      
      console.log('[ensureDefaultFeatures] ✅', { chatId, count: features.length })
      return true
    }
    
    console.log('[ensureDefaultFeatures] ⏭️  已存在', { chatId, count: existingFlags })
    return false
  } catch (e) {
    console.error('[ensureDefaultFeatures] ❌', { chatId, error: (e as Error).message })
    return false
  }
}


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
 * @param force - 是否强制更新（即使已有功能开关）
 * @returns Promise<boolean> - 是否创建/更新成功
 */
export async function ensureDefaultFeatures(chatId: string, prisma: any, force: boolean = false): Promise<boolean> {
  try {
    const existingFlags = await prisma.chatFeatureFlag.findMany({ 
      where: { chatId },
      select: { feature: true, enabled: true, id: true }
    })
    
    // 🔥 如果没有功能开关，或者强制更新，则创建/更新所有功能
    if (existingFlags.length === 0 || force) {
      // 🔥 如果强制更新，先删除所有现有的功能开关
      if (force && existingFlags.length > 0) {
        await prisma.chatFeatureFlag.deleteMany({ where: { chatId } })
        console.log('[ensureDefaultFeatures] 🗑️  删除旧功能开关', { chatId, count: existingFlags.length })
        // 等待删除完成
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      
      // 🔥 创建所有功能开关，全部设置为 enabled: true
      const features = DEFAULT_FEATURES.map(feature => ({
        chatId,
        feature,
        enabled: true
      }))
      
      // 使用 upsert 确保每个功能都被创建或更新为 enabled=true
      for (const feature of features) {
        await prisma.chatFeatureFlag.upsert({
          where: {
            chatId_feature: {
              chatId: feature.chatId,
              feature: feature.feature
            }
          },
          update: {
            enabled: true  // 🔥 确保更新为启用状态
          },
          create: {
            chatId: feature.chatId,
            feature: feature.feature,
            enabled: true
          }
        })
      }
      
      // 🔥 验证所有功能都已创建并启用
      const verifyFlags = await prisma.chatFeatureFlag.findMany({
        where: { chatId },
        select: { feature: true, enabled: true }
      })
      
      const allEnabled = verifyFlags.length === DEFAULT_FEATURES.length && 
                         verifyFlags.every((f: any) => f.enabled === true)
      
      if (!allEnabled) {
        // 🔥 如果验证失败，强制更新所有功能为启用状态
        await prisma.chatFeatureFlag.updateMany({
          where: { chatId },
          data: { enabled: true }
        })
        console.log('[ensureDefaultFeatures] ⚠️  验证失败，强制启用所有功能', { chatId })
      }
      
      console.log('[ensureDefaultFeatures] ✅', { 
        chatId, 
        count: verifyFlags.length, 
        expected: DEFAULT_FEATURES.length,
        allEnabled,
        force 
      })
      return true
    }
    
    // 🔥 如果已有功能开关但不完整，补充缺失的功能
    const existingFeatures = new Set(existingFlags.map((f: any) => f.feature))
    const missingFeatures = DEFAULT_FEATURES.filter((f: string) => !existingFeatures.has(f))
    
    if (missingFeatures.length > 0) {
      for (const feature of missingFeatures) {
        await prisma.chatFeatureFlag.upsert({
          where: {
            chatId_feature: {
              chatId,
              feature
            }
          },
          update: {
            enabled: true  // 🔥 确保更新为启用状态
          },
          create: {
            chatId,
            feature,
            enabled: true
          }
        })
      }
      
      console.log('[ensureDefaultFeatures] ➕ 补充缺失功能', { chatId, added: missingFeatures.length, features: missingFeatures })
      return true
    }
    
    // 🔥 检查是否有功能被禁用，如果有则启用
    const disabledFeatures = existingFlags.filter((f: any) => !f.enabled)
    if (disabledFeatures.length > 0) {
      await prisma.chatFeatureFlag.updateMany({
        where: { 
          chatId,
          feature: { in: disabledFeatures.map((f: any) => f.feature) }
        },
        data: { enabled: true }
      })
      console.log('[ensureDefaultFeatures] 🔄 启用被禁用的功能', { chatId, count: disabledFeatures.length })
      return true
    }
    
    console.log('[ensureDefaultFeatures] ⏭️  已存在且完整', { chatId, count: existingFlags.length })
    return false
  } catch (e) {
    console.error('[ensureDefaultFeatures] ❌', { chatId, error: (e as Error).message })
    return false
  }
}


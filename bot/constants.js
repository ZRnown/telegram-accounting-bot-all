// 功能开关的默认配置（统一管理，避免重复）
// ⚠️ 注意：这里只定义功能名称，创建时会全部设为 enabled: true
// 🔥 简化权限系统：只保留基础记账功能开关，其他功能直接可用
export const DEFAULT_FEATURES = [
  'accounting_basic',      // 基础记账（唯一需要权限控制的功能）
]

/**
 * 为群组创建默认功能开关（全部启用）
 * @param {string} chatId - 群组ID
 * @param {any} prisma - Prisma 客户端
 * @param {boolean} [force=false] - 是否强制更新（即使已有功能开关）
 * @returns {Promise<boolean>} - 是否创建/更新成功
 */
export async function ensureDefaultFeatures(chatId, prisma, force = false) {
  try {
    const existingFlags = await prisma.chatFeatureFlag.findMany({ 
      where: { chatId },
      select: { feature: true, enabled: true, id: true }
    })
    
    if (existingFlags.length === 0 || force) {
      if (force && existingFlags.length > 0) {
        await prisma.chatFeatureFlag.deleteMany({ where: { chatId } })
        console.log('[ensureDefaultFeatures] 🗑️  删除旧功能开关', { chatId, count: existingFlags.length })
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      const features = DEFAULT_FEATURES.map(feature => ({ chatId, feature, enabled: true }))
      for (const feature of features) {
        await prisma.chatFeatureFlag.upsert({
          where: { chatId_feature: { chatId: feature.chatId, feature: feature.feature } },
          update: { enabled: true },
          create: { chatId: feature.chatId, feature: feature.feature, enabled: true }
        })
      }
      const verifyFlags = await prisma.chatFeatureFlag.findMany({ where: { chatId }, select: { feature: true, enabled: true } })
      const allEnabled = verifyFlags.length === DEFAULT_FEATURES.length && verifyFlags.every((f) => f.enabled === true)
      if (!allEnabled) {
        await prisma.chatFeatureFlag.updateMany({ where: { chatId }, data: { enabled: true } })
        console.log('[ensureDefaultFeatures] ⚠️  验证失败，强制启用所有功能', { chatId })
      }
      console.log('[ensureDefaultFeatures] ✅', { chatId, count: verifyFlags.length, expected: DEFAULT_FEATURES.length, allEnabled, force })
      return true
    }

    const existingFeatures = new Set(existingFlags.map((f) => f.feature))
    const missingFeatures = DEFAULT_FEATURES.filter((f) => !existingFeatures.has(f))
    if (missingFeatures.length > 0) {
      for (const feature of missingFeatures) {
        await prisma.chatFeatureFlag.upsert({
          where: { chatId_feature: { chatId, feature } },
          update: { enabled: true },
          create: { chatId, feature, enabled: true }
        })
      }
      console.log('[ensureDefaultFeatures] ➕ 补充缺失功能', { chatId, added: missingFeatures.length, features: missingFeatures })
      return true
    }

    console.log('[ensureDefaultFeatures] ⏭️  已存在且完整', { chatId, count: existingFlags.length })
    return false
  } catch (e) {
    console.error('[ensureDefaultFeatures] ❌', { chatId, error: e.message })
    return false
  }
}

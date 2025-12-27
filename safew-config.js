// SafeW平台适配配置
export const SAFE_CONFIG = {
  API_BASE: process.env.SAFEW_API_BASE || 'https://api.safew.org',
  PLATFORM_NAME: 'SafeW',

  // SafeW支持的特性
  FEATURES: {
    WEBHOOK: true,
    POLLING: true,
    INLINE_KEYBOARD: true,
    CALLBACK_QUERIES: true,
    MEDIA_UPLOAD: true,
    CHAT_PERMISSIONS: true,
    ADMIN_RIGHTS: true
  },

  // API限制
  LIMITS: {
    MAX_MESSAGE_LENGTH: 4096,
    MAX_CAPTION_LENGTH: 1024,
    MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
    RATE_LIMIT: 30 // requests per second
  }
}

export function getSafeApiUrl(token, method) {
  return `${SAFE_CONFIG.API_BASE}/bot${token}/${method}`
}

export function isFeatureSupported(feature) {
  return SAFE_CONFIG.FEATURES[feature] || false
}

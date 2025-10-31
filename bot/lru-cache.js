/**
 * 简单的 LRU (Least Recently Used) 缓存实现
 * 用于限制内存占用
 */
export class LRUCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize
    this.cache = new Map()
  }

  get(key) {
    if (!this.cache.has(key)) return undefined
    
    // 将访问的项移到最后（最近使用）
    const value = this.cache.get(key)
    this.cache.delete(key)
    this.cache.set(key, value)
    
    return value
  }

  set(key, value) {
    // 如果已存在，先删除旧的
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }
    
    // 如果超过容量，删除最旧的（第一个）
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    
    this.cache.set(key, value)
  }

  has(key) {
    return this.cache.has(key)
  }

  delete(key) {
    return this.cache.delete(key)
  }

  clear() {
    this.cache.clear()
  }

  get size() {
    return this.cache.size
  }
}

/**
 * 限制 Map 大小的工具函数
 */
export function limitMapSize(map, maxSize) {
  if (map.size > maxSize) {
    const keysToDelete = []
    let count = 0
    for (const key of map.keys()) {
      keysToDelete.push(key)
      count++
      if (count >= map.size - maxSize) break
    }
    keysToDelete.forEach(k => map.delete(k))
  }
}

/**
 * 限制数组大小的工具函数
 */
export function limitArraySize(arr, maxSize) {
  if (arr.length > maxSize) {
    return arr.slice(-maxSize)
  }
  return arr
}


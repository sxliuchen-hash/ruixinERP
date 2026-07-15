/**
 * 只接受不携带用户名密码的绝对 HTTP(S) 地址，避免配置错误形成脚本跳转。
 */
export function normalizeExternalHttpUrl(rawUrl, fallbackUrl = '') {
  for (const candidate of [rawUrl, fallbackUrl]) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue
    try {
      const url = new URL(candidate.trim())
      if (!['http:', 'https:'].includes(url.protocol)) continue
      if (url.username || url.password) continue
      return url.href
    } catch {
      // 继续尝试 fallback。
    }
  }
  return ''
}

export function assignExternalHttpUrl(rawUrl, fallbackUrl = '') {
  const target = normalizeExternalHttpUrl(rawUrl, fallbackUrl)
  if (!target) return false
  window.location.assign(target)
  return true
}

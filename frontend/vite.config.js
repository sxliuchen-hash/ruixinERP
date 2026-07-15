import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

function assertProductionMainSystemOrigin(rawValue) {
  const value = typeof rawValue === 'string' ? rawValue.trim() : ''
  if (!value) {
    throw new Error('生产构建缺少 VITE_MAIN_SYSTEM_URL')
  }

  try {
    const url = new URL(value)
    const placeholderHost = /(?:^|[.-])(?:example|placeholder|changeme|your-domain)(?:[.-]|$)/i
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol')
    if (url.username || url.password || url.search || url.hash) throw new Error('extra fields')
    if (url.pathname !== '/') throw new Error('path')
    if (placeholderHost.test(url.hostname)) throw new Error('placeholder')
  } catch {
    throw new Error('VITE_MAIN_SYSTEM_URL 必须是非占位的 HTTP(S) Origin')
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  if (mode === 'production') {
    assertProductionMainSystemOrigin(
      process.env.VITE_MAIN_SYSTEM_URL || env.VITE_MAIN_SYSTEM_URL
    )
  }

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    },
    server: {
      port: 5174,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true
        }
      }
    }
  }
})

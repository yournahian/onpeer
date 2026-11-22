import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

function readWranglerViteVars(): Record<string, string> {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, './wrangler.jsonc'), 'utf8')
    const parsed = JSON.parse(raw) as { vars?: Record<string, unknown> }
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed.vars ?? {})) {
      if (k.startsWith('VITE_') && typeof v === 'string' && v.trim()) {
        out[k] = v.trim()
      }
    }
    return out
  } catch {
    return {}
  }
}

export default defineConfig(({ mode }) => {
  // Ensure Cloudflare GitHub Auto-Builds (where .env is gitignored) inherit public VITE_* vars from wrangler.jsonc,
  // while keeping Vitest runtime env overrides mutable for unit tests.
  if (!process.env.VITEST) {
    const fileEnv = loadEnv(mode, __dirname, 'VITE_')
    const wranglerVars = readWranglerViteVars()
    for (const [k, v] of Object.entries(wranglerVars)) {
      if (!process.env[k] && !fileEnv[k]) {
        process.env[k] = v
      }
    }
  }

  return {
    plugins: [react(), nodePolyfills()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        '@tanstack/react-query',
        'wagmi',
        'wagmi/chains',
        'wagmi/connectors',
        'viem',
        'viem/chains',
        'connectkit',
        'framer-motion',
        'lucide-react',
        'sonner',
        '@circle-fin/app-kit',
        '@circle-fin/adapter-viem-v2',
        '@web3icons/react',
        'clsx',
        'tailwind-merge',
        'vite-plugin-node-polyfills/shims/buffer',
        'vite-plugin-node-polyfills/shims/global',
        'vite-plugin-node-polyfills/shims/process',
      ],
    },
    server: {
      allowedHosts: true,
      cors: true,
      // Cloudflare Worker backend (npx wrangler dev on :8787). Keep /api prefix intact.
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
      },
    },
  }
})

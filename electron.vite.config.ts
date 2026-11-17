import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // 构建期剥离测试 harness：__POLARIS_HARNESS__ 在编译期定死为字面量，
    // 生产构建（不带 POLARIS_HARNESS=1）里所有 `if (__POLARIS_HARNESS__)`
    // 分支连同 harness 的动态 import 一起被 DCE 消除——删库级冒烟代码
    // 不再靠运行时 env 判断隔离，而是根本不进生产包。
    // dev 同理：要在 dev 里跑冒烟/截图，用 POLARIS_HARNESS=1 npm run dev。
    define: {
      __POLARIS_HARNESS__: process.env.POLARIS_HARNESS === '1' ? 'true' : 'false'
    },
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        // 双入口：主应用 index.html + 启动页 splash.html（独立小窗加载）。
        input: {
          index: resolve('src/renderer/index.html'),
          splash: resolve('src/renderer/splash.html')
        }
      }
    }
  }
})
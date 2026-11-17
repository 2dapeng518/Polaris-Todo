// Node 自定义模块解析钩子：让 plain Node 能直接 import 仓库里的 TS 纯函数模块。
// 解决两类解析缺口（type-stripping 本身 Node 23.6+ 已内置，这里只补路径解析）：
//   1. `@shared/*` 路径别名 —— tsconfig / electron-vite 认识，plain Node 不认识；
//   2. 无扩展名 / 目录式相对 import（如 './i18n'、'./common'）—— 打包器按
//      Bundler 语义解析到 .ts / index.ts，Node ESM 要求显式文件路径。
// 用法：在 verify 脚本顶部 `register('./ts-resolve-hooks.mjs', import.meta.url)`，
// 之后用动态 import 加载被测 TS 模块（静态 import 会被提升到 register 之前，绕过钩子）。
// 只对解析失败的相对路径做 .ts / index.ts 回退，且先确认文件存在，
// 不改变 node_modules 包与已带扩展名路径的默认解析行为。
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 只认文件不认目录：目录式 import 必须落到 index.ts，否则 Node 报 ERR_UNSUPPORTED_DIR_IMPORT
const exists = (href) => {
  try {
    return statSync(fileURLToPath(href)).isFile()
  } catch {
    return false
  }
}

export async function resolve(specifier, context, nextResolve) {
  // @shared/* → src/shared/*（相对本脚本所在 scripts/ 目录定位，不依赖 cwd）
  if (specifier.startsWith('@shared/')) {
    const base = new URL('../src/shared/' + specifier.slice('@shared/'.length), import.meta.url)
    for (const candidate of [base.href, base.href + '.ts', base.href + '/index.ts']) {
      if (exists(candidate)) return nextResolve(candidate, context)
    }
  }
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    // 相对路径解析失败时补 .ts 扩展名或目录 index.ts（Bundler 语义的最小复刻）
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      context.parentURL &&
      context.parentURL.startsWith('file:')
    ) {
      const base = new URL(specifier, context.parentURL)
      for (const candidate of [base.href + '.ts', base.href + '/index.ts']) {
        if (exists(candidate)) return nextResolve(candidate, context)
      }
    }
    throw error
  }
}
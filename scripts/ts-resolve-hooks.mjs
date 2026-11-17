// Node 自定义模块解析钩子：让 plain Node 能直接 import 仓库里的 TS 纯函数模块。
// 解决两类解析缺口（type-stripping 本身 Node 23.6+ 已内置，这里只补路径解析）：
//   1. `@shared/*` 路径别名 —— tsconfig / electron-vite 认识，plain Node 不认识；
//   2. 无扩展名 / 目录式相对 import（如 './i18n'、'./common'）—— 打包器按
//      Bundler 语义解析到 .ts / index.ts，Node ESM 要求显式文件路径。
//   3. rrule 包 —— main 入口是 webpack 打的 CJS  bundle，Node 的 named-export
//      探测认不出 `RRule`；与打包器同语义改走 module 字段的 ESM 构建
//      （dist/esm），其内部无扩展名相对 import 由 .js 回退接住，
//      格式由下方 load 钩子强制为 module（包没有 "type": "module"）。
// 用法：在 verify 脚本顶部 `register('./ts-resolve-hooks.mjs', import.meta.url)`，
// 之后用动态 import 加载被测 TS 模块（静态 import 会被提升到 register 之前，绕过钩子）。
// 只对解析失败的相对路径做 .ts / index.ts（rrule ESM 内为 .js / index.js）回退，
// 且先确认文件存在，不改变其他 node_modules 包与已带扩展名路径的默认解析行为。
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

// rrule 的 ESM 构建目录：resolve 特判与 load 强制格式都只认这个前缀。
const RRULE_ESM = new URL('../node_modules/rrule/dist/esm/', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
  // @shared/* → src/shared/*（相对本脚本所在 scripts/ 目录定位，不依赖 cwd）
  if (specifier.startsWith('@shared/')) {
    const base = new URL('../src/shared/' + specifier.slice('@shared/'.length), import.meta.url)
    for (const candidate of [base.href, base.href + '.ts', base.href + '/index.ts']) {
      if (exists(candidate)) return nextResolve(candidate, context)
    }
  }
  // rrule → ESM 构建入口（打包器按 module 字段取的同一份代码）
  if (specifier === 'rrule' && exists(RRULE_ESM + 'index.js')) {
    return nextResolve(RRULE_ESM + 'index.js', context)
  }
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    // 相对路径解析失败时补扩展名或目录 index（Bundler 语义的最小复刻）：
    // 仓库 TS 模块补 .ts / index.ts；rrule ESM 构建内部补 .js / index.js。
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      context.parentURL &&
      context.parentURL.startsWith('file:')
    ) {
      const base = new URL(specifier, context.parentURL)
      const candidates = context.parentURL.startsWith(RRULE_ESM)
        ? [base.href + '.js', base.href + '/index.js']
        : [base.href + '.ts', base.href + '/index.ts']
      for (const candidate of candidates) {
        if (exists(candidate)) return nextResolve(candidate, context)
      }
    }
    throw error
  }
}

// rrule 的 dist/esm/*.js 是 ESM 语法，但包没有 "type": "module"，
// Node 默认按 CJS 解释会直接语法报错——这里强制按 module 加载。
export async function load(url, context, nextLoad) {
  if (url.startsWith(RRULE_ESM) && url.endsWith('.js')) {
    return nextLoad(url, { ...context, format: 'module' })
  }
  return nextLoad(url, context)
}
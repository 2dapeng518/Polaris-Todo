#!/usr/bin/env node
// 让 git 使用仓库内的 .githooks（pre-push 品牌词守卫）。
// 在 npm install 的 prepare 阶段自动执行；不在 git 工作树中时静默跳过。

import { execFileSync } from 'node:child_process'

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' })
  console.log('已安装本地钩子：core.hooksPath = .githooks')
} catch {
  // 非 git 工作树（例如从源码包安装）时跳过
}
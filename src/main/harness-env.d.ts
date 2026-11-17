// 构建期常量：electron.vite.config.ts 的 main.define 注入
// `__POLARIS_HARNESS__ = process.env.POLARIS_HARNESS === '1'`。
// 生产构建恒为 false，所有 `if (__POLARIS_HARNESS__)` 分支（含 harness 的
// 动态 import 与测试 env 读取）被 DCE 整体消除；harness 构建恒为 true。
// 只声明在 main 侧（tsconfig.node 覆盖 src/main），渲染层/preload 不使用。
declare const __POLARIS_HARNESS__: boolean
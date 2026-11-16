import { common } from './common'
import { nav } from './nav'
import { views } from './views'
import { detail } from './detail'
import { quickAdd } from './quickAdd'
import { settings } from './settings'
import { dialogs } from './dialogs'
import { main } from './main'
import { features } from './features'

// 中文是母本：所有键与占位符以此为准，英文词典用 typeof zhCN 约束，
// 漏翻或多键都会在 typecheck 阶段报错。
export const zhCN = {
  ...common,
  ...nav,
  ...views,
  ...detail,
  ...quickAdd,
  ...settings,
  ...dialogs,
  ...main,
  ...features
}

export type Messages = typeof zhCN
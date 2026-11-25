// 农历/节气标签（日历套件 P3.1）。lunar-typescript 是唯一的农历数据来源，
// 本模块是它进入应用的唯一入口——其他文件只认 lunarLabel，不直接 import
// lunar-*，方便将来换库或裁剪。纯函数：本地日 → 显示标签，不碰 store/DOM。
//
// 月格副标签的优先级：节气 > 农历节日（春节/端午/除夕…）> 初一显月名 >
// 农历日名。同一密度下节气最稀罕（一年 24 个）、节日次之、月名锚定月初。

import { Lunar, Solar } from 'lunar-typescript'

export function lunarLabel(date: Date): string {
  const lunar = Solar.fromDate(date).getLunar()
  const jieQi = lunar.getJieQi()
  if (jieQi) return jieQi
  const festivals = lunar.getFestivals()
  if (festivals.length > 0) return festivals[0]
  const day = lunar.getDayInChinese()
  if (day === '初一') return `${lunar.getMonthInChinese()}月`
  return day
}

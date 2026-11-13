// 中文字体按需分片下载。
// 整包 Noto Sans SC 解包后几十 MB，不可能全下。做法是：读 fontsource 的 index.css，
// 解析每个 @font-face 的 unicode-range，只下载「覆盖我们试排文字」的那几片。
// 这与浏览器实际的行为一致——unicode-range 分片本来就是按需加载的。
//
// 用法：node docs/asset-atlas/tools/fetch-cjk.mjs

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const FONT_DIR = resolve(ROOT, 'fonts')
const DATA_DIR = resolve(ROOT, 'data')
const CDN = 'https://cdn.jsdelivr.net/npm'

// 图鉴里所有会出现的中文字符，取并集。超出这个集合的字会回退到系统字体，
// 页面上会如实标注「按需分片，仅覆盖试排用字」。
const SAMPLE = [
  '北极星素材图鉴开源字体图标动效特效许可',
  '把今天交给一颗星',
  '中文回退测试提醒',
  '夜阑昼白暮蓝暖砂天蓝护眼绿',
  '完成删除重复项目日期设置主题',
  '工作周报整理收件箱预约牙医',
  '该交了每周一今天明天已完成',
  '年月日时分秒星期',
  '把六套主题的对比图补进给安装包一份声明',
  '中文字体子集化压住体积确认的许可冲突',
  '真字体试排台描边一致性对比可重播实验零运行时纹理与光',
  '全部素材可搜筛排序打进意味着什么落到这个仓库的真实文件',
  '结论先行保持现状组合已经成立本轮没有找到换了明显更好的理由',
  '真正该补的是合规与体积仓库目前没文件而四套字体随安装包再分发',
  '未子集化是安装包体积的最大头动效自己写就够了',
  '个配方里是的纯引入都会带来许可或体积问题且循环播放违反设计约束',
  '三个许可陷阱上游登记与声明冲突是必须署名的包标但字体本体走自定义',
  '尺寸描边粗细色调继承信号弱化提醒字号字重字样内容',
  '极光强度颗粒圆角缩放动效速度减弱恢复默认参数导出清单生成',
  '现有四套无衬线等宽全部',
  '数据来源本页所有事实字段由下的抓取脚本生成',
  '字体来自的包许可证与版本来自图标与集合许可来自官方与上游登记表',
  '抓取结果原始存放在可复现',
  '字体文件仅供本页预览不建议提交进应用运行时的正确引入方式是包',
  '风险署名自定义协议存疑保留现状建议采纳值得考虑备选建议避开',
  '许可来源推荐用途集成方式契合度建议类别名称',
  '上游许可网格描边可调是否真描边填充轮廓需换字重变体官网选型判断',
  '下载体积分片实测整包解包后含全部字重与分片可变轴非可变单字重分片数用途判断来源仓库',
  '复制安装命令看试排这一条',
  '显示条排序',
  '，。、：；？！（）「」·—…％'
].join('')

const CHARS = Array.from(new Set(Array.from(SAMPLE))).map((c) => c.codePointAt(0))

const PACKAGES = [
  { id: 'noto-sans-sc', pkg: '@fontsource-variable/noto-sans-sc', label: 'Noto Sans SC', role: 'current', note: '现有中文字体。OFL-1.1，Google/Adobe 思源体系的简体子集。' },
  { id: 'chiron-hei-hk', pkg: '@fontsource-variable/chiron-hei-hk', label: 'Chiron Hei HK 昭源黑体', role: 'candidate', note: '基于思源黑体改造的港式黑体，可变。字形略窄，简体覆盖需确认。' },
  { id: 'noto-serif-sc', pkg: '@fontsource-variable/noto-serif-sc', label: 'Noto Serif SC', role: 'contrast', note: '衬线对照项。Polaris 全站无衬线，这里只作对比，不建议引入。' }
]

async function getJson(url, tries = 3) {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json()
    } catch (e) { last = e; if (i < tries - 1) await new Promise((r) => setTimeout(r, 900 * (i + 1))) }
  }
  throw last
}
async function getText(url, tries = 3) {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text()
    } catch (e) { last = e; if (i < tries - 1) await new Promise((r) => setTimeout(r, 900 * (i + 1))) }
  }
  throw last
}

// "U+4e00-9fff, U+3000-303f" → [[0x4e00,0x9fff],[0x3000,0x303f]]
function parseRange(spec) {
  return spec.split(',').map((part) => {
    const m = /U\+([0-9a-fA-F]+)(?:-([0-9a-fA-F]+))?/.exec(part.trim())
    if (!m) return null
    const lo = parseInt(m[1], 16)
    const hi = m[2] ? parseInt(m[2], 16) : lo
    return [lo, hi]
  }).filter(Boolean)
}

function facesFrom(css, baseUrl) {
  return [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => {
    const body = m[1]
    const url = /url\(([^)]+\.woff2)\)/.exec(body)?.[1]?.replace(/["']/g, '')
    const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim()
    const style = /font-style:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? 'normal'
    const weight = /font-weight:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? '400'
    const family = /font-family:\s*'([^']+)'/.exec(body)?.[1] ?? ''
    if (!url || !range || style !== 'normal') return null
    return { url: url.startsWith('.') ? new URL(url, baseUrl).href : url, range, weight, family, ranges: parseRange(range) }
  }).filter(Boolean)
}

await mkdir(FONT_DIR, { recursive: true })
await mkdir(DATA_DIR, { recursive: true })

const out = []
for (const p of PACKAGES) {
  const rec = { ...p, shards: [], ok: false }
  try {
    const meta = await getJson(`https://registry.npmjs.org/${p.pkg.replace('/', '%2F')}/latest`)
    rec.version = meta.version
    rec.license = meta.license ?? '(未声明)'
    rec.unpackedSize = meta.dist?.unpackedSize ?? null
    rec.repository = typeof meta.repository === 'string' ? meta.repository : (meta.repository?.url ?? '')
    rec.homepage = meta.homepage ?? ''

    const cssUrl = `${CDN}/${p.pkg}@${meta.version}/index.css`
    const css = await getText(cssUrl)
    rec.cssUrl = cssUrl
    const faces = facesFrom(css, cssUrl)
    rec.totalShards = faces.length
    rec.family = faces[0]?.family ?? p.label

    // 只取覆盖试排字符的分片
    const needed = faces.filter((f) => CHARS.some((cp) => f.ranges.some(([lo, hi]) => cp >= lo && cp <= hi)))
    const covered = new Set()
    let bytes = 0
    for (let i = 0; i < needed.length; i++) {
      const f = needed[i]
      const res = await fetch(f.url)
      if (!res.ok) { rec.shards.push({ url: f.url, ok: false, error: `HTTP ${res.status}` }); continue }
      const buf = Buffer.from(await res.arrayBuffer())
      const file = `${p.id}-${i}.woff2`
      await writeFile(resolve(FONT_DIR, file), buf)
      bytes += buf.length
      f.ranges.forEach(([lo, hi]) => { CHARS.forEach((cp) => { if (cp >= lo && cp <= hi) covered.add(cp) }) })
      rec.shards.push({ url: f.url, ok: true, localFile: `fonts/${file}`, bytes: buf.length, range: f.range, weight: f.weight })
    }
    rec.bytes = bytes
    rec.coveredCount = covered.size
    rec.requestedCount = CHARS.length
    rec.missing = CHARS.filter((cp) => !covered.has(cp)).map((cp) => String.fromCodePoint(cp)).join('')
    rec.ok = rec.shards.some((s) => s.ok)
    console.log(`✓ ${p.label.padEnd(24)} ${rec.shards.filter((s) => s.ok).length}/${rec.totalShards} 片  ${(bytes / 1024).toFixed(0)} KB  覆盖 ${covered.size}/${CHARS.length} 字  ${rec.license}`)
    if (rec.missing) console.log(`    未覆盖: ${rec.missing.slice(0, 40)}`)
  } catch (err) {
    rec.error = String(err.message ?? err)
    console.log(`✗ ${p.label}: ${rec.error}`)
  }
  out.push(rec)
}

await writeFile(resolve(DATA_DIR, 'cjk-facts.json'), JSON.stringify({ sample: SAMPLE, fonts: out }, null, 2), 'utf8')
console.log('\n写入 docs/asset-atlas/data/cjk-facts.json')

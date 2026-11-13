// 把后台调研 workflow 的 journal 拆成可读文件，存进 data/research/ 作为溯源材料。
// 用法：node docs/asset-atlas/tools/extract-research.mjs <journal.jsonl 路径>
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '..', 'data', 'research')
await mkdir(OUT, { recursive: true })

const journal = process.argv[2]
if (!journal) { console.error('需要传 journal.jsonl 路径'); process.exit(1) }

const lines = (await readFile(journal, 'utf8')).trim().split('\n')
const labels = new Map()
const results = []
for (const l of lines) {
  let j
  try { j = JSON.parse(l) } catch { continue }
  if (j.type === 'started') labels.set(j.key, j.label)
  if (j.type === 'result') results.push({ label: labels.get(j.key) ?? j.agentId, result: j.result, tools: j.toolsUsed })
}

const slug = (s) => s.replace(/[^\w一-龥-]+/g, '_')
const index = []

for (const r of results) {
  const name = slug(r.label)
  const isText = typeof r.result === 'string'
  const file = name + (isText ? '.md' : '.json')
  const body = isText ? r.result : JSON.stringify(r.result, null, 2)
  await writeFile(resolve(OUT, file), body, 'utf8')
  index.push({ label: r.label, file, chars: body.length, tools: r.tools?.length ?? 0 })
  console.log(`${r.label.padEnd(22)} ${String(body.length).padStart(7)} chars → ${file}`)
}

await writeFile(resolve(OUT, 'index.json'), JSON.stringify(index, null, 2), 'utf8')

// 单独汇总核验阶段的「修正」与「驳回」，这是最需要并进图鉴的部分。
const corrections = []
for (const r of results) {
  if (!r.label.startsWith('核验:') || typeof r.result !== 'object' || !r.result) continue
  for (const c of r.result.checked ?? []) {
    if (c.verdict !== 'pass' || (c.riskLevel && c.riskLevel !== 'none')) {
      corrections.push({
        category: r.result.category, name: c.name, verdict: c.verdict,
        license: c.finalLicenseSpdx, licenseUrl: c.finalLicenseUrl,
        risk: c.riskLevel, corrections: c.corrections,
        failedUrls: (c.urlChecks ?? []).filter((u) => !u.ok).map((u) => u.url + ' — ' + (u.note ?? ''))
      })
    }
  }
}
await writeFile(resolve(OUT, '_corrections.json'), JSON.stringify(corrections, null, 2), 'utf8')
console.log(`\n需修正/留意条目：${corrections.length} → _corrections.json`)

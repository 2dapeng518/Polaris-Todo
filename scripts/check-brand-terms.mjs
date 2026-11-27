#!/usr/bin/env node
// 受保护品牌词守卫：扫描已跟踪文件、全部提交说明、tag 说明与历史 blob。
// 命中即非零退出。关键词以 Base64 存放，避免守卫脚本自身成为新的泄漏点。
//
// 用法：node scripts/check-brand-terms.mjs
// 安装本地钩子：npm run hooks:install（pre-push 自动调用本脚本）

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const TERMS = JSON.parse(Buffer.from('WyLmu7TnrZQiLCLlmIDll5IiLCJ0aWNrdGljayIsInRpY2sgdGljayIsImRpZGEzNjUiLCJ0b2RvaXN0Iiwi5b6u6L2v5b6F5YqeIiwibWljcm9zb2Z0IHRvIGRvIiwibWljcm9zb2Z0IHRvZG8iLCJ3dW5kZXJsaXN0Iiwib21uaWZvY3VzIiwidGhpbmdzIDMiLCJ0aGluZ3MzIiwi56ue5ZOBIl0=', 'base64').toString('utf8'))
const LOWER = TERMS.map((term) => term.toLowerCase())

const hits = []
const addHit = (where, term, text) => {
  hits.push({ where, term, text: String(text).trim().replace(/\s+/g, ' ').slice(0, 140) })
}

const git = (args, options = {}) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...options })

const scanText = (where, text) => {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].toLowerCase()
    for (let j = 0; j < LOWER.length; j += 1) {
      if (line.includes(LOWER[j])) addHit(`${where}:${i + 1}`, TERMS[j], lines[i])
    }
  }
}

// 1) 工作树中的已跟踪文件
const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean)
for (const file of tracked) {
  let buf
  try {
    buf = readFileSync(file)
  } catch {
    continue
  }
  if (buf.includes(0)) continue // 二进制文件跳过
  scanText(file, buf.toString('utf8'))
}

// 2) 全部提交说明（标题与正文）
const log = git(['log', '--all', '--format=%H%x1f%B%x1e'])
for (const record of log.split('\x1e')) {
  const sep = record.indexOf('\x1f')
  if (sep === -1) continue
  const sha = record.slice(0, sep).trim()
  if (!sha) continue
  scanText(`commit ${sha.slice(0, 12)}`, record.slice(sep + 1))
}

// 3) tag 说明
const tags = git(['for-each-ref', 'refs/tags', '--format=%(refname:short)%x1f%(contents)%x1e'])
for (const record of tags.split('\x1e')) {
  const sep = record.indexOf('\x1f')
  if (sep === -1) continue
  scanText(`tag ${record.slice(0, sep).trim()}`, record.slice(sep + 1))
}

// 4) 历史 blob（含已删除文件）：分批交给 git grep，避免命令过长
const commits = git(['rev-list', '--all']).split(/\r?\n/).filter(Boolean)
const pattern = TERMS.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
const CHUNK = 80
for (let i = 0; i < commits.length; i += CHUNK) {
  const chunk = commits.slice(i, i + CHUNK)
  let out = ''
  try {
    out = git(['grep', '-i', '-I', '-n', '-E', '-e', pattern, ...chunk])
  } catch (error) {
    if (error.status === 1) continue // 1 = 本批无命中
    throw error
  }
  for (const line of out.split(/\r?\n/)) {
    if (!line) continue
    const match = line.match(/^([0-9a-f]{7,40}):(.*?):(\d+):(.*)$/i)
    if (match) addHit(`${match[1].slice(0, 12)}:${match[2]}:${match[3]}`, '(history)', match[4])
    else addHit('history', '(history)', line)
  }
}

if (hits.length > 0) {
  console.error(`受保护品牌词命中 ${hits.length} 处：`)
  for (const hit of hits.slice(0, 50)) {
    console.error(`  ${hit.where} [${hit.term}] ${hit.text}`)
  }
  if (hits.length > 50) console.error(`  …另有 ${hits.length - 50} 处`)
  process.exit(1)
}

console.log(
  `品牌词守卫通过：${tracked.length} 个已跟踪文件、${commits.length} 个提交、${TERMS.length} 个关键词，零命中。`
)
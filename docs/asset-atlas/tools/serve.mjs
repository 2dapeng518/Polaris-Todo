// 图鉴预览用的静态服务器。只用 Node 内置模块，不装任何依赖。
// 用法：node docs/asset-atlas/tools/serve.mjs [port]
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const PORT = Number(process.argv[2] ?? 4321)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
    let rel = decodeURIComponent(url.pathname)
    if (rel === '/') rel = '/index.html'
    const target = resolve(join(ROOT, normalize(rel)))
    // 目录穿越防护：解析后必须仍在 ROOT 内。
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      res.writeHead(403).end('Forbidden')
      return
    }
    const info = await stat(target)
    if (info.isDirectory()) {
      res.writeHead(403).end('Directory listing disabled')
      return
    }
    const body = await readFile(target)
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache'
    })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404')
  }
}).listen(PORT, () => {
  console.log(`Polaris 素材图鉴 → http://localhost:${PORT}`)
})

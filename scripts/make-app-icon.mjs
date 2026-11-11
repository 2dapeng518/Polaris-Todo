import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const SRC = 512
const SAMPLES = 4

function lerp(a, b, t) {
  return a + (b - a) * t
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function pointInPolygon(x, y, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false
  const cx = clamp(x, left + radius, right - radius)
  const cy = clamp(y, top + radius, bottom - radius)
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const scale = size / SRC
  const left = 24 * scale
  const top = 24 * scale
  const right = 488 * scale
  const bottom = 488 * scale
  const radius = 128 * scale
  const star = [
    [256, 68],
    [306, 206],
    [444, 256],
    [306, 306],
    [256, 444],
    [206, 306],
    [68, 256],
    [206, 206]
  ].map(([x, y]) => [x * scale, y * scale])
  const centerX = 256 * scale
  const centerY = 256 * scale
  const dotRadius = 16 * scale

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0
      let g = 0
      let b = 0
      let covered = 0

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = px + (sx + 0.5) / SAMPLES
          const y = py + (sy + 0.5) / SAMPLES

          if (!insideRoundedRect(x, y, left, top, right, bottom, radius)) continue
          covered += 1

          const bgT = y / size
          let cr = lerp(10, 20, bgT)
          let cg = lerp(13, 25, bgT)
          let cb = lerp(20, 36, bgT)

          if (pointInPolygon(x, y, star)) {
            const t = clamp((x - left + (y - top)) / (right - left + (bottom - top)), 0, 1)
            cr = lerp(94, 167, t)
            cg = lerp(234, 139, t)
            cb = lerp(212, 250, t)

            if ((x - centerX) ** 2 + (y - centerY) ** 2 <= dotRadius ** 2) {
              cr = 10
              cg = 13
              cb = 20
            }
          }

          r += cr
          g += cg
          b += cb
        }
      }

      if (covered === 0) continue

      const offset = (py * size + px) * 4
      rgba[offset] = Math.round(r / covered)
      rgba[offset + 1] = Math.round(g / covered)
      rgba[offset + 2] = Math.round(b / covered)
      rgba[offset + 3] = Math.round((covered / (SAMPLES * SAMPLES)) * 255)
    }
  }

  return rgba
}

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n += 1) {
  let c = n
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  crcTable[n] = c >>> 0
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, checksum])
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  header[10] = 0
  header[11] = 0
  header[12] = 0

  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function pngForSize(size) {
  return encodePng(size, render(size))
}

function buildIco(sizes) {
  const pngs = sizes.map((size) => pngForSize(size))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)

  const entries = Buffer.alloc(16 * sizes.length)
  let offset = 6 + entries.length

  pngs.forEach((png, index) => {
    const size = sizes[index]
    const entry = index * 16
    entries[entry] = size >= 256 ? 0 : size
    entries[entry + 1] = size >= 256 ? 0 : size
    entries[entry + 2] = 0
    entries[entry + 3] = 0
    entries.writeUInt16LE(1, entry + 4)
    entries.writeUInt16LE(32, entry + 6)
    entries.writeUInt32LE(png.length, entry + 8)
    entries.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })

  return Buffer.concat([header, entries, ...pngs])
}

mkdirSync('build', { recursive: true })

const iconPng = pngForSize(512)
writeFileSync('build/icon.png', iconPng)

const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const iconIco = buildIco(icoSizes)
writeFileSync('build/icon.ico', iconIco)

console.log(`icon.png: ${iconPng.length} bytes`)
console.log(`icon.ico: ${iconIco.length} bytes (${icoSizes.join(', ')})`)
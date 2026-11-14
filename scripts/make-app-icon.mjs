import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const STAR = [
  [716, 252], [739, 308], [794, 330], [739, 351],
  [716, 408], [693, 351], [638, 330], [693, 308]
]
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value))
const mix = (a, b, t) => a.map((channel, i) => channel + (b[i] - channel) * t)

function roundedRectDistance(x, y, left, top, width, height, radius) {
  const qx = Math.abs(x - left - width / 2) - (width / 2 - radius)
  const qy = Math.abs(y - top - height / 2) - (height / 2 - radius)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
}

function polygonDistance(x, y, points = STAR) {
  let distanceSquared = Infinity
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i]
    const [bx, by] = points[j]
    const dx = bx - ax, dy = by - ay
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))
    distanceSquared = Math.min(distanceSquared, (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2)
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside
  }
  const distance = Math.sqrt(distanceSquared)
  return inside ? -distance : distance
}

function lineDistance(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const t = clamp(((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy))
  return Math.hypot(x - x1 - t * dx, y - y1 - t * dy)
}

function blend(base, over, alpha = 1) {
  return mix(base, over, clamp(alpha))
}

function colorAt(x, y) {
  const roundness = roundedRectDistance(x, y, 24, 24, 976, 976, 226)
  if (roundness > 0) return [0, 0, 0, 0]

  const aura = Math.exp(-(((x - 512) / 520) ** 2 + ((y - 500) / 590) ** 2) * 1.6) * 0.4
  const bg = mix(mix([23, 35, 46], [8, 10, 15], clamp((y - 24) / 976)), [26, 73, 73], aura)

  const cardShadow = roundedRectDistance(x, y - 14, 190, 160, 644, 704, 86)
  let color = blend(bg, [2, 5, 10], cardShadow < 0 ? 0.42 : 0.32 * Math.exp(-(cardShadow ** 2) / (2 * 25 ** 2)))

  const card = roundedRectDistance(x, y, 190, 160, 644, 704, 86)
  if (card <= 0) {
    const paperT = clamp((y - 160) / 704)
    color = mix([252, 250, 244], [231, 229, 222], paperT)
  }
  if (Math.abs(card) < 1.8) color = blend(color, [255, 253, 248], 0.4)

  // Quiet header rules on the paper surface.
  if (lineDistance(x, y, 298, 310, 533, 310) < 6) color = [213, 211, 204]
  if (lineDistance(x, y, 298, 350, 465, 350) < 4) color = [226, 224, 217]

  // Small medallion and the Polaris four-point mark.
  const medallionDistance = Math.hypot(x - 716, y - 330) - 69
  const medallionShadow = Math.hypot(x - 716, y - 340) - 69
  color = blend(color, [9, 14, 19], medallionShadow < 0 ? 0.12 : 0.1 * Math.exp(-(medallionShadow ** 2) / (2 * 15 ** 2)))
  if (medallionDistance <= 0) color = [245, 242, 234]
  if (Math.abs(medallionDistance) < 1) color = [215, 212, 202]

  const starDistance = polygonDistance(x, y)
  color = blend(color, [2, 5, 10], starDistance < 0 ? 0.1 : 0.08 * Math.exp(-(starDistance ** 2) / (2 * 14 ** 2)))
  if (starDistance <= 0) {
    const t = clamp((x - 638) / 156)
    color = mix([81, 220, 201], [152, 130, 232], t)
    const facet = [[716, 260], [737, 312], [716, 330], [695, 312]]
    if (polygonDistance(x, y, facet) <= 0) color = blend(color, [239, 253, 248], 0.3)
  }

  // Three task rows; one quiet teal completion signal.
  const boxes = [
    { x: 286, y: 452, active: true },
    { x: 286, y: 603, active: false },
    { x: 286, y: 754, active: false }
  ]
  for (const box of boxes) {
    const d = roundedRectDistance(x, y, box.x, box.y, 70, 70, 22)
    if (d <= 0) color = box.active ? [15, 118, 110] : [247, 245, 239]
    if (!box.active && Math.abs(d) < 2) color = [184, 183, 176]
  }

  if (lineDistance(x, y, 305, 487, 321, 503) < 4.5 || lineDistance(x, y, 321, 503, 340, 478) < 4.5) color = [245, 255, 252]

  const bars = [
    [397, 479, 708, 479, 8, [54, 58, 58]], [397, 504, 616, 504, 4, [182, 181, 175]],
    [397, 630, 676, 630, 8, [70, 73, 72]], [397, 655, 574, 655, 4, [197, 195, 188]],
    [397, 781, 645, 781, 8, [116, 118, 111]], [397, 806, 558, 806, 4, [206, 204, 197]]
  ]
  for (const [x1, y1, x2, y2, width, ink] of bars) {
    if (lineDistance(x, y, x1, y1, x2, y2) <= width) color = ink
  }

  return [...color, 255]
}

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, checksum])
}

function renderPng(size) {
  const samples = size >= 128 ? 3 : 4
  const rgba = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let red = 0, green = 0, blue = 0, alpha = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const color = colorAt((px + (sx + 0.5) / samples) * 1024 / size, (py + (sy + 0.5) / samples) * 1024 / size)
          red += color[0]; green += color[1]; blue += color[2]; alpha += color[3] / 255
        }
      }
      if (!alpha) continue
      const offset = (py * size + px) * 4
      rgba[offset] = Math.round(red / alpha)
      rgba[offset + 1] = Math.round(green / alpha)
      rgba[offset + 2] = Math.round(blue / alpha)
      rgba[offset + 3] = Math.round(alpha * 255 / (samples * samples))
    }
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  const scanlines = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) rgba.copy(scanlines, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

writeFileSync('build/icon.png', renderPng(1024))

const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = sizes.map(renderPng)
const directory = Buffer.alloc(6 + sizes.length * 16)
directory.writeUInt16LE(0, 0)
directory.writeUInt16LE(1, 2)
directory.writeUInt16LE(sizes.length, 4)
let offset = directory.length
for (let i = 0; i < sizes.length; i++) {
  const entry = 6 + i * 16
  directory[entry] = sizes[i] === 256 ? 0 : sizes[i]
  directory[entry + 1] = sizes[i] === 256 ? 0 : sizes[i]
  directory.writeUInt16LE(1, entry + 4)
  directory.writeUInt16LE(32, entry + 6)
  directory.writeUInt32LE(images[i].length, entry + 8)
  directory.writeUInt32LE(offset, entry + 12)
  offset += images[i].length
}
writeFileSync('build/icon.ico', Buffer.concat([directory, ...images]))
console.log('Wrote build/icon.png (1024×1024) and build/icon.ico (16–256px)')

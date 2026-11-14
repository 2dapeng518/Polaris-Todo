import { deflateSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const STAR = [
  [512, 136], [612, 412], [888, 512], [612, 612],
  [512, 888], [412, 612], [136, 512], [412, 412]
]
const corners = STAR.map((point, index) => {
  const previous = STAR[(index + STAR.length - 1) % STAR.length]
  const next = STAR[(index + 1) % STAR.length]
  const toPrevious = [previous[0] - point[0], previous[1] - point[1]]
  const toNext = [next[0] - point[0], next[1] - point[1]]
  const previousLength = Math.hypot(...toPrevious)
  const nextLength = Math.hypot(...toNext)
  const cosine = (toPrevious[0] * toNext[0] + toPrevious[1] * toNext[1]) / (previousLength * nextLength)
  const angle = Math.acos(Math.max(-1, Math.min(1, cosine)))
  const distance = Math.min(12 / Math.tan(angle / 2), previousLength * 0.4, nextLength * 0.4)
  return {
    point,
    before: [point[0] + toPrevious[0] / previousLength * distance, point[1] + toPrevious[1] / previousLength * distance],
    after: [point[0] + toNext[0] / nextLength * distance, point[1] + toNext[1] / nextLength * distance]
  }
})
const ROUNDED_STAR = corners.flatMap(({ point, before, after }) =>
  Array.from({ length: 6 }, (_, step) => {
    const t = step / 5
    const inverse = 1 - t
    return [
      inverse * inverse * before[0] + 2 * inverse * t * point[0] + t * t * after[0],
      inverse * inverse * before[1] + 2 * inverse * t * point[1] + t * t * after[1]
    ]
  })
)
const starPath = [
  `M ${corners[0].before[0]} ${corners[0].before[1]}`,
  ...corners.flatMap((corner, index) => [
    `Q ${corner.point[0]} ${corner.point[1]} ${corner.after[0]} ${corner.after[1]}`,
    `L ${corners[(index + 1) % corners.length].before[0]} ${corners[(index + 1) % corners.length].before[1]}`
  ]),
  'Z'
].join(' ')
let svgSource = readFileSync('build/icon.svg', 'utf8')
const clipStart = '<clipPath id="star-clip"><path d="'
const clipEnd = '"/></clipPath>'
const clipOffset = svgSource.indexOf(clipStart)
const clipEndOffset = svgSource.indexOf(clipEnd, clipOffset)
svgSource = svgSource.slice(0, clipOffset + clipStart.length) + starPath + svgSource.slice(clipEndOffset)
const markStart = '<path id="star" d="'
const markOffset = svgSource.indexOf(markStart)
const markEndOffset = svgSource.indexOf('"/>', markOffset)
svgSource = svgSource.slice(0, markOffset + markStart.length) + starPath + svgSource.slice(markEndOffset)
writeFileSync('build/icon.svg', svgSource)

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value))
const lerp = (a, b, t) => a + (b - a) * t
const mix = (a, b, t) => a.map((channel, i) => lerp(channel, b[i], clamp(t)))

function superellipseValue(x, y, left, top, right, bottom) {
  const nx = Math.abs((x - (left + right) / 2) / ((right - left) / 2))
  const ny = Math.abs((y - (top + bottom) / 2) / ((bottom - top) / 2))
  return nx ** 4 + ny ** 4
}

function polygonDistance(x, y, points = ROUNDED_STAR) {
  let distanceSquared = Infinity
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i]
    const [bx, by] = points[j]
    const dx = bx - ax
    const dy = by - ay
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))
    distanceSquared = Math.min(distanceSquared, (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2)
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside
  }
  const distance = Math.sqrt(distanceSquared)
  return inside ? -distance : distance
}

function pointInPolygon(x, y, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function colorAt(x, y) {
  if (superellipseValue(x, y, 24, 24, 1000, 1000) > 1) return [0, 0, 0, 0]

  const vertical = clamp((y - 24) / 976)
  let color = mix([255, 255, 255], [242, 245, 251], vertical)
  const aura = Math.exp(-(((x - 474) / 450) ** 2 + ((y - 488) / 500) ** 2) * 1.3)
  color = mix(color, [231, 235, 252], aura * 0.18)
  const blush = Math.exp(-(((x - 292) / 360) ** 2 + ((y - 294) / 360) ** 2) * 1.5)
  color = mix(color, [255, 222, 228], blush * 0.13)
  const blueGlow = Math.exp(-(((x - 790) / 390) ** 2 + ((y - 764) / 400) ** 2) * 1.5)
  color = mix(color, [215, 231, 252], blueGlow * 0.16)
  const sheen = Math.exp(-(((x - 380) / 490) ** 2 + ((y - 90) / 220) ** 2) * 1.3)
  color = mix(color, [255, 255, 255], sheen * 0.16)

  const shadowDistance = polygonDistance(x, y - 16)
  const shadowAlpha = shadowDistance < 0 ? 0.1 : 0.14 * Math.exp(-(shadowDistance ** 2) / (2 * 14 ** 2))
  color = mix(color, [104, 106, 128], shadowAlpha)

  // Slightly extruded lower edge, visible only beyond the original silhouette.
  const sideDistance = polygonDistance(x, y - 8)
  const faceDistance = polygonDistance(x, y)
  if (sideDistance <= 0 && faceDistance > 0) {
    const sideT = clamp((x - 136) / 752)
    color = mix([77, 183, 168], [120, 101, 186], sideT)
  }

  if (faceDistance <= 0) {
    const t = clamp((x - 136) / 752)
    color = t < 0.5
      ? mix([64, 207, 184], [104, 193, 230], t * 2)
      : mix([104, 193, 230], [159, 132, 230], (t - 0.5) * 2)
    const topGlow = Math.exp(-(((x - 512) / 245) ** 2 + ((y - 165) / 320) ** 2) * 1.2) * 0.32
    color = mix(color, [255, 228, 190], topGlow)
    const greenGlow = Math.exp(-(((x - 505) / 285) ** 2 + ((y - 500) / 280) ** 2) * 1.2) * 0.08
    color = mix(color, [70, 218, 183], greenGlow)
    const violetGlow = Math.exp(-(((x - 514) / 300) ** 2 + ((y - 868) / 325) ** 2) * 1.2) * 0.28
    color = mix(color, [154, 124, 230], violetGlow)

    // Soft top-plane reflection and gentle lower falloff add a glazed ceramic sheen.
    const topLight = clamp(1 - (y - 136) / 460) * 0.27
    color = mix(color, [255, 255, 255], topLight)
    const lowerShade = clamp((y - 480) / 408) * 0.06
    color = mix(color, [80, 73, 135], lowerShade)

    const facet = [[512, 150], [606, 410], [512, 504], [418, 410]]
    if (pointInPolygon(x, y, facet)) color = mix(color, [255, 255, 255], 0.05)

    const edge = Math.abs(faceDistance)
    if (edge < 4) color = mix(color, [255, 255, 255], (1 - edge / 4) * 0.42)
  }

  const centerRadius = Math.hypot(x - 512, y - 512)
  if (centerRadius < 43) {
    color = mix(color, [136, 148, 168], 0.16)
    if (centerRadius < 38) color = mix(color, [250, 252, 255], 0.84)
    if (centerRadius < 30) {
      const orbT = clamp(centerRadius / 30)
      color = mix([36, 51, 72], [7, 11, 19], orbT * 0.72)
    }
    if (centerRadius < 28) color = mix(color, [7, 11, 19], 0.78)
    const glint = Math.exp(-(((x - 502) / 14) ** 2 + ((y - 493) / 7) ** 2) * 1.2)
    color = mix(color, [220, 247, 249], glint * 0.2)
  }

  const rim = Math.abs(superellipseValue(x, y, 38, 38, 986, 986) - 1) * 488
  if (rim < 2) color = mix(color, [162, 175, 195], 0.22)
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

function pngChunk(type, data) {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, checksum])
}

function renderPng(size) {
  const samples = size >= 512 ? 2 : 4
  const rgba = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let red = 0, green = 0, blue = 0, coverage = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) * 1024 / size
          const y = (py + (sy + 0.5) / samples) * 1024 / size
          const [r, g, b, a] = colorAt(x, y)
          red += r * a / 255
          green += g * a / 255
          blue += b * a / 255
          coverage += a / 255
        }
      }
      if (!coverage) continue
      const offset = (py * size + px) * 4
      rgba[offset] = Math.round(red / coverage)
      rgba[offset + 1] = Math.round(green / coverage)
      rgba[offset + 2] = Math.round(blue / coverage)
      rgba[offset + 3] = Math.round(coverage * 255 / (samples * samples))
    }
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  const scanlines = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    rgba.copy(scanlines, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

writeFileSync('build/icon.png', renderPng(1024))
const iconSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const iconPngs = new Map(iconSizes.map((size) => [size, renderPng(size)]))

const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icoImages = icoSizes.map((size) => iconPngs.get(size))
const icoDirectory = Buffer.alloc(6 + icoSizes.length * 16)
icoDirectory.writeUInt16LE(0, 0)
icoDirectory.writeUInt16LE(1, 2)
icoDirectory.writeUInt16LE(icoSizes.length, 4)
let icoOffset = icoDirectory.length
for (let i = 0; i < icoSizes.length; i++) {
  const entry = 6 + i * 16
  const size = icoSizes[i]
  icoDirectory[entry] = size === 256 ? 0 : size
  icoDirectory[entry + 1] = size === 256 ? 0 : size
  icoDirectory.writeUInt16LE(1, entry + 4)
  icoDirectory.writeUInt16LE(32, entry + 6)
  icoDirectory.writeUInt32LE(icoImages[i].length, entry + 8)
  icoDirectory.writeUInt32LE(icoOffset, entry + 12)
  icoOffset += icoImages[i].length
}
writeFileSync('build/icon.ico', Buffer.concat([icoDirectory, ...icoImages]))

const iconsetDir = 'build/Polaris.iconset'
mkdirSync(iconsetDir, { recursive: true })
const iconsetEntries = [
  [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png']
]
for (const [size, name] of iconsetEntries) writeFileSync(`${iconsetDir}/${name}`, iconPngs.get(size))

const icnsTypes = [[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']]
const chunks = icnsTypes.map(([size, type]) => {
  const payload = iconPngs.get(size)
  const header = Buffer.alloc(8)
  header.write(type, 0, 4, 'ascii')
  header.writeUInt32BE(payload.length + 8, 4)
  return Buffer.concat([header, payload])
})
const icns = Buffer.alloc(8)
icns.write('icns', 0, 4, 'ascii')
icns.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4)
writeFileSync('build/icon.icns', Buffer.concat([icns, ...chunks]))

const trayDataUrl = `data:image/png;base64,${iconPngs.get(32).toString('base64')}`
writeFileSync('src/main/tray-icon.ts', `// Generated by scripts/make-app-icon.mjs\nexport const TRAY_ICON_DATA_URL =\n  '${trayDataUrl}'\n`)
console.log('Wrote SVG/PNG, Windows ICO, macOS ICNS and @2x iconset; refreshed tray/window icon data')

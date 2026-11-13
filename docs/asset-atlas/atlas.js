/* Polaris 素材图鉴 — 交互层。
   无框架、无构建、无外部运行时。所有素材数据来自 atlas-data.js（由抓取脚本生成）。 */
(function () {
  'use strict'

  const A = window.ATLAS
  if (!A) { document.body.innerHTML = '<p style="padding:40px">atlas-data.js 未加载，请先运行 node docs/asset-atlas/tools/build-data.mjs</p>'; return }

  const $ = (sel, root) => (root || document).querySelector(sel)
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel))
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const kb = (n) => (n / 1024).toFixed(n < 102400 ? 1 : 0) + ' KB'

  const DEFAULTS = {
    theme: 'dark', iconSize: 22, iconStroke: 1.75, iconTone: 'inherit',
    specSize: 30, specWeight: 500, specText: 'mixed', customText: '',
    aurora: 1, grain: 1, radius: 1, speed: 1, reduce: false, fontFilter: 'all'
  }
  const state = Object.assign({}, DEFAULTS)
  const manifestState = { q: '', category: '', verdict: '', risk: '', sort: 'fit', dir: -1, selected: null }

  const SAMPLES = {
    mixed: '北极星 Polaris 0123',
    zh: '把今天交给一颗星',
    num: '0O1lI 08:45 · 2026-11-13'
  }

  const VERDICT_LABEL = { keep: '保留现状', adopt: '建议采纳', consider: '值得考虑', alternative: '备选', avoid: '建议避开' }
  const RISK_LABEL = { none: '无风险', 'attribution-required': '需署名', 'custom-eula': '自定义协议', unclear: '存疑' }

  // ── 样式注入：主题令牌 + 本地字体 ────────────────────────────────────────
  function themeBlock(t, sel) {
    return sel + '{' +
      'color-scheme:' + t.family + ';' +
      '--bg:' + t.bg + ';--bg-soft:' + t.bgSoft + ';--panel-bg:' + t.panelBg + ';' +
      '--text:' + t.text + ';--text-secondary:' + t.textSecondary + ';--text-tertiary:' + t.textTertiary + ';' +
      '--line:' + t.line + ';--line-strong:' + t.lineStrong + ';' +
      '--accent:' + t.accent + ';--accent-rgb:' + t.accentRgb + ';' +
      '--accent-2:' + t.accent2 + ';--accent-2-rgb:' + t.accent2Rgb + ';' +
      '--on-accent:' + t.onAccent + ';--warning:' + t.warning + ';--danger:' + t.danger + ';' +
      '--danger-rgb:' + hexRgb(t.danger) + ';--priority-mid-rgb:' + hexRgb(t.warning) + ';' +
      '--surface-1:' + t.surface1 + ';--surface-2:' + t.surface2 + ';' +
      '--hover:' + t.hover + ';--hover-strong:' + t.hover + ';--selected:' + t.selected + ';' +
      '--input-bg:' + t.surface2 + ';--drawer-bg:' + t.drawerBg + ';' +
      '--inner-highlight:' + t.innerHighlight + ';' +
      '--aurora-opacity:' + t.auroraOpacity + ';--noise-opacity:' + t.noiseOpacity + ';' +
      '--aurora-c-rgb:' + t.auroraC + ';--shadow-rgb:' + t.shadowRgb + ';' +
      '--mark-a:' + t.accent + ';--mark-b:' + t.accent2 + ';' +
      '--ring-track:' + t.line + ';--check-border:' + t.lineStrong + ';' +
      '--check-mark:' + t.onAccent + ';--done-line:' + t.lineStrong + ';' +
      '--scrollbar:' + t.lineStrong + ';--scrollbar-hover:' + t.textTertiary + ';' +
      '--card-gradient:linear-gradient(180deg,' + t.surface2 + ',' + t.surface1 + ');' +
      '--sidebar-bg:linear-gradient(180deg,' + t.panelBg + ',' + t.bg + ');' +
      '--command-bg:linear-gradient(180deg,' + t.panelBg + ',' + t.bgSoft + ');' +
      '--command-overlay:rgba(' + t.shadowRgb + ',0.42);' +
      '}'
  }
  function hexRgb(hex) {
    const h = hex.replace('#', '')
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',')
  }

  function injectStyles() {
    const css = []
    css.push(themeBlock(A.themes[0], ':root'))
    for (const t of A.themes) css.push(themeBlock(t, '[data-theme="' + t.id + '"]'))
    for (const f of A.fonts) {
      css.push('@font-face{font-family:"' + f.family + '";src:url("' + f.localFile + '") format("woff2");' +
        'font-weight:' + (f.weightRange || '400') + ';font-style:normal;font-display:swap;' +
        (f.unicodeRange ? 'unicode-range:' + f.unicodeRange + ';' : '') + '}')
    }
    // 中文字体：每套由多个 unicode-range 分片组成，浏览器只解码命中的那几片。
    for (const f of (A.cjkFonts || [])) {
      if (!f.shipped) continue
      for (const s of f.shards) {
        css.push('@font-face{font-family:"' + f.family + '";src:url("' + s.localFile + '") format("woff2");' +
          'font-weight:' + (s.weight || '100 900') + ';font-style:normal;font-display:swap;' +
          'unicode-range:' + s.range + ';}')
      }
    }
    const style = document.createElement('style')
    style.id = 'atlas-tokens'
    style.textContent = css.join('\n')
    document.head.appendChild(style)
  }

  // ── 图标渲染 ────────────────────────────────────────────────────────────
  // Iconify 返回的 body 自带 stroke-width，真描边的库可以就地替换；
  // 填充轮廓的库没有这个属性，滑块自然无效——这正是页面上要展示的选型差异。
  function iconMarkup(lib, entry, opts) {
    const o = opts || {}
    let body = entry.body
    if (lib.strokeBased && o.stroke != null) {
      body = body.replace(/stroke-width="[\d.]+"/g, 'stroke-width="' + o.stroke + '"')
    }
    const size = o.size || null
    return '<svg viewBox="0 0 ' + entry.width + ' ' + entry.height + '"' +
      (size ? ' width="' + size + '" height="' + size + '"' : '') +
      ' aria-hidden="true" focusable="false">' + body + '</svg>'
  }
  function findIcon(prefix, sem) {
    const lib = A.iconLibs.find((l) => l.prefix === prefix)
    return lib ? { lib, entry: lib.icons[sem] } : null
  }

  // ── 通用 UI ─────────────────────────────────────────────────────────────
  let toastTimer = null
  function toast(msg) {
    const host = $('#toastHost')
    host.innerHTML = '<div class="toast"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>' + esc(msg) + '</div>'
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { host.innerHTML = '' }, 2200)
  }

  async function copyText(text, label) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
      }
      toast((label || '内容') + ' 已复制')
    } catch {
      toast('复制失败，请手动选择')
    }
  }

  function download(name, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
    toast(name + ' 已下载')
  }

  // ── 导航 / 主题 ─────────────────────────────────────────────────────────
  const SECTIONS = [
    { id: 'sec-overview', label: '概览', icon: 'M12 2.5l2.6 7.9 7.9 2.6-7.9 2.6-2.6 7.9-2.6-7.9L1.5 13l7.9-2.6z' },
    { id: 'sec-icons', label: '图标对比', icon: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0' },
    { id: 'sec-fonts', label: '字体试排', icon: 'M4 7V5h16v2M9 19h6M12 5v14' },
    { id: 'sec-motion', label: '动效实验', icon: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5' },
    { id: 'sec-effects', label: '特效纹理', icon: 'M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0' },
    { id: 'sec-manifest', label: '交付清单', icon: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' },
    { id: 'sec-overturned', label: '核验修正', icon: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0' },
    { id: 'sec-compliance', label: '许可合规', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10' },
    { id: 'sec-integration', label: '集成方案', icon: 'm8 6-6 6 6 6M16 6l6 6-6 6' }
  ]

  function renderNav() {
    $('#nav').innerHTML = SECTIONS.map((s) => {
      const count = s.id === 'sec-manifest' ? A.stats.total
        : s.id === 'sec-icons' ? A.stats.iconLibs
        : s.id === 'sec-fonts' ? A.stats.fontsDownloaded
        : s.id === 'sec-motion' ? A.stats.motionRecipes
        : s.id === 'sec-effects' ? A.stats.effectRecipes : ''
      return '<a class="nav__item" href="#' + s.id + '" data-sec="' + s.id + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + s.icon + '"/></svg>' +
        esc(s.label) + (count ? '<span class="nav__count">' + count + '</span>' : '') + '</a>'
    }).join('')
  }

  function renderThemes() {
    $('#themes').innerHTML = A.themes.map((t) =>
      '<button class="theme-btn" data-theme-id="' + t.id + '" aria-pressed="' + (t.id === state.theme) + '" title="' + esc(t.desc) + '">' +
      '<span class="theme-btn__dots">' +
      '<span class="theme-btn__dot" style="background:' + t.bg + '"></span>' +
      '<span class="theme-btn__dot" style="background:' + t.panelBg + '"></span>' +
      '<span class="theme-btn__dot" style="background:' + t.accent + '"></span>' +
      '</span>' + esc(t.label) + '</button>'
    ).join('')
    $$('#themes .theme-btn').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themeId)))
  }

  // View Transitions 的两个坑（实测）：
  //   1) 新过渡发起时，旧过渡的 updateCallback 会被**整个跳过**（updateCallbackDone 仍 fulfilled），
  //      排队的回调乱序落地会把主题覆盖成旧值；
  //   2) 被 skip 时 ready 会 reject AbortError，不 catch 就是未处理异常。
  // 对策：state.theme 是唯一真相，回调读它而不是捕获的 id；过渡进行中再点就同步落地（放弃这次的淡变，
  // 但保证结果正确）；过渡结束后再断言一次。ready 与 finished 都 catch。
  let themeBusy = false
  function setTheme(id) {
    state.theme = id
    $$('#themes .theme-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeId === id)))
    const commit = () => { document.documentElement.dataset.theme = state.theme }
    const reduce = state.reduce || matchMedia('(prefers-reduced-motion: reduce)').matches
    // 文档不可见时 startViewTransition 会以 InvalidStateError 中止，直接走同步路径。
    if (!document.startViewTransition || reduce || themeBusy || document.hidden) { commit(); return }
    themeBusy = true
    const t = document.startViewTransition(commit)
    const swallow = () => { /* 被跳过/中止是正常路径，不是错误 */ }
    // 三个 promise 都要 catch：只接 finished 会漏掉 ready 与 updateCallbackDone 的 rejection。
    t.ready.catch(swallow)
    t.updateCallbackDone.catch(swallow)
    t.finished.catch(swallow).then(() => { themeBusy = false; commit() })
  }

  // ── 概览 ────────────────────────────────────────────────────────────────
  function renderHero() {
    $('#heroMeta').innerHTML = [
      ['chip chip--accent', A.project.stack],
      ['chip', '运行时离线'],
      ['chip', '六套主题'],
      ['chip chip--violet', 'teal 信号色']
    ].map(([c, t]) => '<span class="' + c + '">' + esc(t) + '</span>').join('')

    const s = A.stats
    $('#stats').innerHTML = [
      [s.total, '清单条目'],
      [s.fontsDownloaded, '套字体已下载'],
      [kb(s.fontBytes), '字体实际体积'],
      [s.iconsFetched, '枚真实 SVG'],
      [s.motionRecipes + s.effectRecipes, '个可跑配方'],
      [s.avoid, '条建议避开']
    ].map(([n, l]) => '<div class="stat"><div class="stat__n">' + esc(n) + '</div><div class="stat__l">' + esc(l) + '</div></div>').join('')

    $('#verdicts').innerHTML = [
      ['keep', '图标与字体<b>保持现状</b>', 'Lucide（ISC）+ Inter / Manrope / Geist Mono / Noto Sans SC（OFL-1.1）这套组合已经成立。本轮没有找到「换了明显更好」的理由。'],
      ['add', '真正该补的是<b>合规与体积</b>', '仓库目前没有 NOTICE 文件，而四套 OFL 字体 + Lucide 已经在随安装包再分发。中文字体未子集化，是安装包体积的最大头。'],
      ['add', '动效<b>自己写就够了</b>', '本页 10 个动效配方里 7 个是 0 KB 的纯 CSS/SVG。引入 GSAP / Lottie / Rive 都会带来许可或体积问题，且循环播放违反设计约束。'],
      ['avoid', '三个<b>许可陷阱</b>', 'Remix Icon 的上游登记与 npm 声明冲突；Solar 是 CC-BY-4.0 必须署名；MiSans 的 npm 包标 Apache-2.0 但字体本体走自定义 EULA。']
    ].map(([tag, title, body]) =>
      '<li><span class="verdict-tag verdict-tag--' + tag + '">' + (tag === 'keep' ? '保留' : tag === 'add' ? '补上' : '避开') + '</span>' +
      '<span>' + title + '<br>' + esc(body) + '</span></li>'
    ).join('')
  }

  // ── 图标区 ──────────────────────────────────────────────────────────────
  const SEM_ORDER = ['check', 'bell', 'star', 'fourStar', 'repeat', 'folder', 'calendar', 'trash']

  function renderIconToolbar() {
    const strokeLibs = A.iconLibs.filter((l) => l.strokeBased).length
    $('#iconToolbar').innerHTML =
      '<span class="chip chip--accent">' + A.iconLibs.length + ' 个图标库</span>' +
      '<span class="chip">' + strokeLibs + ' 个真描边（滑块生效）</span>' +
      '<span class="chip chip--warn">' + (A.iconLibs.length - strokeLibs) + ' 个填充轮廓（滑块无效）</span>' +
      '<span class="chip">当前 ' + state.iconSize + 'px / 描边 ' + state.iconStroke.toFixed(2) + '</span>'
  }

  function renderIconGrid() {
    const sems = SEM_ORDER.filter((k) => A.semantics[k])
    const grid = $('#iconGrid')
    grid.style.setProperty('--cols', sems.length)
    let html = '<div class="icon-grid__row icon-grid__row--head"><div class="icon-grid__head">图标库 / 许可</div>' +
      sems.map((k) => '<div class="icon-grid__head">' + esc(A.semantics[k].label) + '</div>').join('') + '</div>'

    for (const lib of A.iconLibs) {
      const lic = lib.upstreamLicense !== '(未取得)' ? lib.upstreamLicense : lib.npmLicense
      const riskBadge = lib.risk === 'none' ? '' :
        ' <span class="badge badge--' + (lib.risk === 'attribution-required' ? 'warn' : 'bad') + '">' + RISK_LABEL[lib.risk] + '</span>'
      html += '<div class="icon-grid__row"><div class="icon-lib">' +
        '<span class="icon-lib__name">' + esc(lib.name) +
        (lib.strokeBased ? '' : ' <span class="stroke-note">填充</span>') + '</span>' +
        '<span class="icon-lib__meta"><span>' + esc(lic) + '</span><span>' + (lib.total ?? '?') + ' 枚</span>' + riskBadge + '</span>' +
        '</div>'
      for (const k of sems) {
        const entry = lib.icons[k]
        if (!entry) { html += '<div class="icon-grid__cell"><span class="icon-missing" title="该库无此语义或名称不匹配">—</span></div>'; continue }
        html += '<div class="icon-grid__cell"><button class="icon-cell-btn" data-tone="' + state.iconTone + '"' +
          ' data-lib="' + lib.prefix + '" data-sem="' + k + '"' +
          ' aria-label="' + esc(lib.name + ' 的' + A.semantics[k].label + '图标，查看详情') + '">' +
          iconMarkup(lib, entry, { stroke: state.iconStroke }) + '</button></div>'
      }
      html += '</div>'
    }
    grid.innerHTML = html
    $$('.icon-cell-btn', grid).forEach((b) => b.addEventListener('click', () => openIconDrawer(b.dataset.lib, b.dataset.sem)))
    renderIconToolbar()
  }

  function refreshIconStrokes() {
    $$('.icon-cell-btn').forEach((b) => {
      const lib = A.iconLibs.find((l) => l.prefix === b.dataset.lib)
      const entry = lib && lib.icons[b.dataset.sem]
      if (!lib || !entry) return
      b.innerHTML = iconMarkup(lib, entry, { stroke: state.iconStroke })
      b.dataset.tone = state.iconTone
    })
    renderIconToolbar()
  }

  const DEMO_TASKS = [
    { title: '把六套主题的对比图补进 README', meta: '今天 18:00', done: false, bell: true, repeat: true },
    { title: '给安装包补一份 NOTICE 声明', meta: '明天 09:30', done: false, bell: true, repeat: false },
    { title: '中文字体子集化，压住体积', meta: '每周一', done: false, bell: false, repeat: true },
    { title: '确认 Remix Icon 的许可冲突', meta: '已完成', done: true, bell: false, repeat: false }
  ]

  function renderContextDemo() {
    const host = $('#contextDemo')
    const picks = [
      { prefix: 'lucide', label: 'Lucide · 现有方案' },
      { prefix: 'ph', label: 'Phosphor · 六字重' },
      { prefix: 'tabler', label: 'Tabler · 覆盖最广' }
    ]
    host.innerHTML = picks.map((p) => {
      const lib = A.iconLibs.find((l) => l.prefix === p.prefix)
      if (!lib) return ''
      const rows = DEMO_TASKS.map((t, i) => {
        const check = lib.icons.check
        const bell = lib.icons.bell
        const rep = lib.icons.repeat
        const cal = lib.icons.calendar
        const del = lib.icons.trash
        return '<div class="task-row" data-done="' + t.done + '" data-idx="' + i + '">' +
          '<button class="task-check" role="checkbox" aria-checked="' + t.done + '" aria-label="标记完成：' + esc(t.title) + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="check-mark" d="m5 13 4 4L19 7"/></svg>' +
          '</button>' +
          '<div class="task-body"><div class="task-title">' + esc(t.title) + '</div>' +
          '<div class="task-meta">' + (cal ? iconMarkup(lib, cal, { stroke: 1.75 }) : '') + esc(t.meta) + '</div></div>' +
          '<div class="task-icons">' +
          (t.bell && bell ? iconMarkup(lib, bell, { stroke: 1.75 }) : '') +
          (t.repeat && rep ? iconMarkup(lib, rep, { stroke: 1.75 }) : '') +
          (del ? iconMarkup(lib, del, { stroke: 1.75 }) : '') +
          '</div></div>'
      }).join('')
      return '<div class="task-panel"><div class="task-panel__head">' +
        '<span class="task-panel__title">' + esc(p.label) + '</span>' +
        '<span class="chip">' + esc(lib.upstreamLicense) + '</span></div>' + rows + '</div>'
    }).join('')

    $$('.task-check', host).forEach((btn) => {
      btn.addEventListener('click', () => {
        const on = btn.getAttribute('aria-checked') !== 'true'
        btn.setAttribute('aria-checked', String(on))
        btn.closest('.task-row').dataset.done = String(on)
      })
    })
  }

  // ── 字体区 ──────────────────────────────────────────────────────────────
  function specText() {
    if (state.customText.trim()) return state.customText
    return SAMPLES[state.specText]
  }

  function renderFonts() {
    const list = A.fonts.filter((f) => {
      if (state.fontFilter === 'current') return f.role === 'current'
      if (state.fontFilter === 'mono') return f.use.includes('mono')
      if (state.fontFilter === 'sans') return !f.use.includes('mono')
      return true
    })
    const text = specText()
    $('#specimens').innerHTML = list.map((f) => {
      const roleTag = f.role === 'current' ? '<span class="badge badge--ok">现有</span>' : ''
      const varTag = f.isVariableFace ? '<span class="badge">可变 ' + esc(f.weightRange) + '</span>' : '<span class="badge badge--warn">单字重 ' + esc(f.weightRange) + '</span>'
      return '<article class="spec" data-role="' + f.role + '" data-font="' + f.id + '" tabindex="0" role="button" aria-label="' + esc(f.family + '，查看详情') + '">' +
        '<div class="spec__fit" style="opacity:' + (f.fit / 14).toFixed(2) + '"></div>' +
        '<div class="spec__head"><div><div class="spec__name">' + esc(f.family) + '</div>' +
        '<div class="spec__meta"><span>' + esc(f.license) + '</span><span>' + kb(f.bytes) + '</span><span>v' + esc(f.version) + '</span></div></div>' +
        '<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">' + roleTag + varTag + '</div></div>' +
        '<div class="spec__sample" style="font-family:\'' + esc(f.family) + '\',var(--font-ui)">' + esc(text) + '</div>' +
        '<div class="spec__nums" style="font-family:\'' + esc(f.family) + '\',var(--font-mono)">0O1lI · 08:45 · 1,234 · 2026-11-13</div>' +
        '<div class="spec__cjk"><span style="font-family:\'' + esc(f.family) + '\',\'Noto Sans SC Variable\',var(--font-ui)">中文混排：把今天交给一颗星，08:45 提醒。</span></div>' +
        '<div class="spec__note">' + esc(f.note) + '</div>' +
        '</article>'
    }).join('')
    $$('#specimens .spec').forEach((card) => {
      card.addEventListener('click', () => openFontDrawer(card.dataset.font))
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFontDrawer(card.dataset.font) } })
    })
  }

  const CJK_SAMPLE = '把今天交给一颗星，08:45 提醒。夜阑 昼白 暮蓝 暖砂 天蓝 护眼绿'

  function renderCjk() {
    const host = $('#cjkPanel')
    if (!host) return
    const list = A.cjkFonts || []
    host.innerHTML = '<div class="specimens">' + list.map((f) => {
      const shipped = f.shipped
      const fam = shipped ? "'" + f.family + "'," : ''
      return '<article class="spec" data-role="' + (f.role === 'current' ? 'current' : '') + '">' +
        '<div class="spec__head"><div><div class="spec__name">' + esc(f.label) + '</div>' +
        '<div class="spec__meta"><span>' + esc(f.license) + '</span><span>v' + esc(f.version) + '</span>' +
        (shipped ? '<span>' + kb(f.bytes) + '</span>' : '') + '</div></div>' +
        '<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">' +
        (f.role === 'current' ? '<span class="badge badge--ok">现有</span>' : '') +
        (shipped ? '<span class="badge badge--ok">已下载</span>' : '<span class="badge badge--bad">未分发</span>') +
        '</div></div>' +
        '<div class="spec__sample" style="font-family:' + fam + 'var(--font-ui);font-size:22px;line-height:1.6">' +
        esc(shipped ? CJK_SAMPLE : '（未随预览页分发，下方为系统回退）') + '</div>' +
        '<div class="spec__cjk" style="font-family:' + fam + 'var(--font-ui)">' +
        '小字号 11px 测试：每周一 09:30 · 项目「工作」· 优先级 高' + '</div>' +
        '<div class="spec__note">' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
        '<span class="chip chip--accent">' + f.shardCount + ' / ' + f.totalShards + ' 片命中</span>' +
        '<span class="chip">' + kb(f.bytes) + '</span>' +
        '<span class="chip">覆盖 ' + f.coveredCount + '/' + f.requestedCount + ' 字</span>' +
        (f.unpackedSize ? '<span class="chip">整包 ' + kb(f.unpackedSize) + '</span>' : '') +
        '</div>' + esc(f.note) + (f.shippedNote ? '<br><span style="color:var(--danger)">' + esc(f.shippedNote) + '</span>' : '') +
        '</div></article>'
    }).join('') + '</div>'
  }

  function refreshSpecText() {
    const text = specText()
    $$('#specimens .spec__sample').forEach((n) => { n.textContent = text })
  }

  // ── 动效区 ──────────────────────────────────────────────────────────────
  const running = new Map()

  function anim(el, frames, opts) {
    if (!el) return null
    if (state.reduce || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const last = frames[frames.length - 1]
      Object.assign(el.style, last)
      return null
    }
    const a = el.animate(frames, Object.assign({ easing: 'cubic-bezier(0.22,1,0.36,1)', fill: 'both' }, opts))
    return a
  }

  function track(id, a) {
    const prev = running.get(id)
    if (prev) prev.forEach((x) => { try { x.cancel() } catch { /* 已取消 */ } })
    running.set(id, (a ? [].concat(a) : []).filter(Boolean))
  }

  const DEMOS = {
    'check-draw': {
      build: () => '<div class="demo-check" data-on="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="check-mark" d="m5 13 4 4L19 7"/></svg></div>',
      play: (stage, speed) => {
        const box = $('.demo-check', stage)
        box.dataset.on = 'false'
        void box.offsetWidth
        const t = setTimeout(() => { box.dataset.on = 'true' }, 60)
        return { cancel: () => clearTimeout(t) }
      }
    },
    'row-enter': {
      build: () => '<div class="demo-row"><span style="width:14px;height:14px;border:1.5px solid var(--check-border);border-radius:5px"></span>给安装包补 NOTICE</div>',
      play: (stage, speed) => anim($('.demo-row', stage), [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 200 * speed })
    },
    'undo-toast': {
      build: () => '<div class="demo-toast"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M10 11v6m4-6v6m5-11v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18"/></svg>已删除 · 撤销<span class="demo-toast__bar"></span></div>',
      play: (stage, speed) => {
        const t = $('.demo-toast', stage), bar = $('.demo-toast__bar', stage)
        return [
          anim(t, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 320 * speed }),
          anim(bar, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: 3000 * speed, easing: 'linear' })
        ]
      }
    },
    'palette-in': {
      build: () => '<div class="demo-palette"><div class="demo-palette__row" data-sel="true">新建任务</div><div class="demo-palette__row">切换项目</div><div class="demo-palette__row">打开设置</div></div>',
      play: (stage, speed) => anim($('.demo-palette', stage), [{ opacity: 0, transform: 'scale(0.98)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 200 * speed })
    },
    'star-ignite': {
      build: () => '<svg class="demo-star" viewBox="0 0 256 256" aria-hidden="true"><path d="M240 128a15.79 15.79 0 0 1-10.5 15l-63.44 23.07L143 229.5a16 16 0 0 1-30 0l-23.06-63.44L26.5 143a16 16 0 0 1 0-30l63.44-23.06L113 26.5a16 16 0 0 1 30 0l23.07 63.44L229.5 113a15.79 15.79 0 0 1 10.5 15"/></svg>',
      play: (stage, speed) => anim($('.demo-star', stage), [{ opacity: 0, transform: 'scale(0.9) rotate(-12deg)' }, { opacity: 1, transform: 'scale(1) rotate(0deg)' }], { duration: 320 * speed })
    },
    'reminder-in': {
      build: () => '<div class="demo-reminder"><div class="demo-reminder__t">该交周报了</div><div class="demo-reminder__s">18:00 · 工作</div></div>',
      play: (stage, speed) => anim($('.demo-reminder', stage), [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 320 * speed })
    },
    'chip-in': {
      build: () => '<span class="demo-chip">明天 18:00</span>',
      play: (stage, speed) => anim($('.demo-chip', stage), [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 120 * speed })
    },
    'theme-cross': {
      build: () => '<div class="demo-swatch" id="themeSwatch">主题交叉淡入</div>',
      play: (stage, speed) => {
        const sw = $('.demo-swatch', stage)
        const other = A.themes[(A.themes.findIndex((t) => t.id === state.theme) + 1) % A.themes.length]
        const cur = A.themes.find((t) => t.id === state.theme)
        sw.style.background = cur.bgSoft
        sw.style.color = cur.text
        const a = anim(sw, [{ opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }], { duration: 200 * speed })
        const t = setTimeout(() => {
          sw.style.background = other.bgSoft
          sw.style.color = other.text
          sw.textContent = cur.label + ' → ' + other.label
        }, 100 * speed)
        return [a, { cancel: () => clearTimeout(t) }]
      }
    },
    'progress-ring': {
      build: () => '<svg class="demo-ring" viewBox="0 0 68 68" aria-hidden="true"><circle class="demo-ring__track" cx="34" cy="34" r="28"/><circle class="demo-ring__value" cx="34" cy="34" r="28" stroke-dasharray="175.9" stroke-dashoffset="175.9"/></svg>',
      play: (stage, speed) => {
        const c = $('.demo-ring__value', stage)
        c.style.strokeDashoffset = '175.9'
        void c.getBoundingClientRect()
        const t = setTimeout(() => { c.style.strokeDashoffset = String(175.9 * (1 - 0.62)) }, 60)
        return { cancel: () => clearTimeout(t) }
      }
    },
    'auto-animate': {
      build: () => '<div style="display:flex;flex-direction:column;gap:6px;width:100%;max-width:250px" class="aa-list">' +
        ['整理收件箱', '写周报', '预约牙医'].map((t) => '<div class="demo-row aa-item">' + esc(t) + '</div>').join('') + '</div>',
      play: (stage, speed) => {
        const items = $$('.aa-item', stage)
        items.forEach((i) => { i.style.display = ''; i.style.opacity = '1'; i.style.transform = 'none' })
        const mid = items[1]
        if (!mid) return null
        return anim(mid, [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(-14px)' }], { duration: 250 * speed })
      }
    }
  }

  function renderMotion() {
    $('#motionGrid').innerHTML = A.motion.map((m) => {
      const d = DEMOS[m.id]
      return '<article class="motion-card" data-motion="' + m.id + '">' +
        '<div class="motion-card__head"><div><div class="motion-card__name">' + esc(m.name) + '</div>' +
        '<div class="motion-card__spec">' + m.ms + 'ms · ' + esc(m.bytes) + '</div></div>' +
        '<button class="btn btn--sm btn--ghost" data-replay="' + m.id + '">重播</button></div>' +
        '<div class="motion-stage">' + (d ? d.build() : '') + '</div>' +
        '<div class="motion-card__foot">' + esc(m.why) + '<br><code>' + esc(m.target) + '</code><br>' +
        '<span style="color:var(--accent)">减弱动效：</span>' + esc(m.reduced) + '</div>' +
        '</article>'
    }).join('')
    $$('[data-replay]').forEach((b) => b.addEventListener('click', () => playDemo(b.dataset.replay)))
    A.motion.forEach((m) => playDemo(m.id))
  }

  function playDemo(id) {
    const card = $('[data-motion="' + id + '"]')
    const d = DEMOS[id]
    if (!card || !d) return
    const stage = $('.motion-stage', card)
    stage.innerHTML = d.build()
    track(id, d.play(stage, state.reduce ? 0.001 : state.speed))
  }

  // ── 特效区 ──────────────────────────────────────────────────────────────
  const FX_STAGE = {
    grain: () => '<div class="fx-layer fx-grain" style="opacity:0.85"></div><div class="fx-grain-split"></div>' +
      '<div class="fx-layer fx-grain" style="opacity:0.85;clip-path:inset(0 0 0 50%)"></div>' +
      '<span class="fx-stage__label">左：无 · 右：有（预览已放大）</span>',
    aurora: () => '<div class="fx-layer fx-aurora"></div><span class="fx-stage__label">三层 radial-gradient</span>',
    dotgrid: () => '<div class="fx-layer fx-dots"></div><span class="fx-stage__label">24px 点阵</span>',
    hairline: () => '<div class="fx-layer fx-hairline"></div><span class="fx-stage__label">两端渐隐 1px</span>',
    starfield: () => '<div class="fx-layer fx-starfield"></div><span class="fx-stage__label">SVG pattern 平铺</span>',
    bevel: () => '<div style="display:flex;gap:12px;position:relative;z-index:2"><div class="fx-bevel-good">玻璃面 ✓</div><div class="fx-bevel-bad">accent ✗</div></div>',
    'focus-ring': () => '<div class="fx-focus" style="position:relative;z-index:2"><button class="fx-focus__btn">普通控件</button><button class="fx-focus__btn fx-focus__btn--accent">accent 控件</button></div>'
  }

  function renderEffects() {
    $('#fxGrid').innerHTML = A.effects.map((e) =>
      '<article class="fx-card" data-effect="' + e.id + '">' +
      '<div class="fx-stage">' + (FX_STAGE[e.id] ? FX_STAGE[e.id]() : '') + '</div>' +
      '<div class="fx-card__body"><div class="fx-card__name">' + esc(e.name) +
      '<button class="btn btn--sm btn--ghost" data-copy-fx="' + e.id + '">复制 CSS</button></div>' +
      '<div class="fx-card__why">' + esc(e.why) + '</div>' +
      '<div class="fx-card__map">' + esc(e.mapping) + '</div>' +
      '<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">' +
      '<span class="chip">' + esc(e.runtime) + '</span><span class="chip">' + esc(e.license) + '</span></div>' +
      '</div></article>'
    ).join('')
    $$('[data-copy-fx]').forEach((b) => b.addEventListener('click', () => {
      const e = A.effects.find((x) => x.id === b.dataset.copyFx)
      copyText(e.code, e.name + ' CSS')
    }))
    $$('.fx-focus__btn').forEach((b) => b.addEventListener('click', () => b.focus()))
  }

  // ── 清单表 ──────────────────────────────────────────────────────────────
  function filteredManifest() {
    const q = manifestState.q.trim().toLowerCase()
    let rows = A.manifest.filter((m) => {
      if (manifestState.category && m.category !== manifestState.category) return false
      if (manifestState.verdict && m.verdict !== manifestState.verdict) return false
      if (manifestState.risk && m.risk !== manifestState.risk) return false
      if (!q) return true
      return [m.name, m.use, m.license, m.category, m.integration].join(' ').toLowerCase().includes(q)
    })
    const k = manifestState.sort
    rows = rows.slice().sort((a, b) => {
      const av = a[k], bv = b[k]
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * manifestState.dir
      return String(av).localeCompare(String(bv), 'zh-CN') * manifestState.dir
    })
    return rows
  }

  function renderManifestFilters() {
    const cats = Array.from(new Set(A.manifest.map((m) => m.category)))
    $('#mCategory').innerHTML = '<option value="">全部类别</option>' +
      cats.map((c) => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('')
  }

  function renderManifest() {
    const rows = filteredManifest()
    const body = $('#mBody')
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="table-empty">没有匹配的素材。试试清空搜索或筛选。</td></tr>'
    } else {
      body.innerHTML = rows.map((m) => {
        const riskCls = m.risk === 'none' ? 'ok' : (m.risk === 'attribution-required' ? 'warn' : 'bad')
        return '<tr data-id="' + esc(m.id) + '" tabindex="0" aria-selected="' + (manifestState.selected === m.id) + '">' +
          '<td class="name">' + esc(m.name) + (m.version ? '<br><span style="font-weight:400;color:var(--text-tertiary);font-family:var(--font-mono);font-size:10px">v' + esc(m.version) + '</span>' : '') + '</td>' +
          '<td>' + esc(m.category) + '</td>' +
          '<td><span class="badge badge--' + riskCls + '">' + esc(m.license) + '</span>' +
          '<br><span style="font-size:10px;color:var(--text-tertiary)">' + esc(m.licenseSource) + '</span></td>' +
          '<td class="use">' + esc(m.use) + '</td>' +
          '<td><code style="font-family:var(--font-mono);font-size:11px">' + esc(m.integration) + '</code></td>' +
          '<td><span class="fit-bar"><span class="fit-bar__track"><span class="fit-bar__fill" style="width:' + (m.fit * 10) + '%"></span></span>' + m.fit.toFixed(1) + '</span></td>' +
          '<td><span class="badge badge--' + (m.verdict === 'avoid' ? 'bad' : m.verdict === 'consider' || m.verdict === 'alternative' ? 'warn' : 'ok') + '">' + VERDICT_LABEL[m.verdict] + '</span></td>' +
          '</tr>'
      }).join('')
      $$('#mBody tr').forEach((tr) => {
        tr.addEventListener('click', () => openManifestDrawer(tr.dataset.id))
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') openManifestDrawer(tr.dataset.id) })
      })
    }
    $('#mCount').textContent = '显示 ' + rows.length + ' / ' + A.manifest.length + ' 条 · 排序：' +
      ({ fit: '契合度', name: '名称', category: '类别', license: '许可证' }[manifestState.sort]) +
      (manifestState.dir < 0 ? ' ↓' : ' ↑')
  }

  // ── 合规 / 集成 ─────────────────────────────────────────────────────────
  function renderOverturned() {
    const host = $('#overturnedGrid')
    if (!host) return
    host.innerHTML = (A.overturned || []).map((o) =>
      '<article class="ov-card">' +
      '<div class="ov-card__title">' + esc(o.title) + '</div>' +
      '<div class="ov-row ov-row--before"><span class="ov-tag">初版</span><span>' + esc(o.before) + '</span></div>' +
      '<div class="ov-row ov-row--after"><span class="ov-tag">核验后</span><span>' + esc(o.after) + '</span></div>' +
      '<div class="ov-impact">' + esc(o.impact) + '</div>' +
      '<div class="ov-evidence">' + esc(o.evidence) + '</div>' +
      '</article>'
    ).join('')

    const na = $('#noAssetGrid')
    if (!na) return
    na.innerHTML = (A.noAssetConclusions || []).map((n) =>
      '<article class="na-card">' +
      '<div class="na-card__cat">' + esc(n.category) + '</div>' +
      '<div class="na-card__verdict">' + esc(n.conclusion) + '</div>' +
      '<div class="na-card__why">' + esc(n.why) + '</div>' +
      '<div class="na-card__alt"><b>替代</b>' + esc(n.alternative) + '</div>' +
      '<div class="na-card__honest">' + esc(n.honest) + '</div>' +
      '</article>'
    ).join('')
  }

  function renderCompliance() {
    $('#complianceGrid').innerHTML = A.compliance.map((c) =>
      '<article class="comp-card" data-risk="' + c.risk + '">' +
      '<div class="comp-card__topic">' + esc(c.topic) + '</div>' +
      '<div class="comp-card__verdict">' + esc(c.verdict) + '</div>' +
      '<div class="comp-card__detail">' + esc(c.detail) + '</div>' +
      '<div class="comp-card__action">' + esc(c.action) + '</div></article>'
    ).join('')
  }

  function renderIntegration() {
    $('#integrationBlocks').innerHTML = A.integration.map((b) =>
      '<div class="code-block"><div class="code-block__head">' +
      '<div><div class="code-block__title">' + esc(b.title) + '</div>' +
      '<div class="code-block__path">' + esc(b.path) + '</div></div>' +
      '<button class="btn btn--sm" data-copy-code="' + esc(b.id) + '">复制</button></div>' +
      '<div class="code-block__note">' + esc(b.note) + '</div>' +
      '<pre><code>' + esc(b.code) + '</code></pre></div>'
    ).join('')
    $$('[data-copy-code]').forEach((btn) => btn.addEventListener('click', () => {
      const b = A.integration.find((x) => x.id === btn.dataset.copyCode)
      copyText(b.code, b.title)
    }))

    $('#phaseGrid').innerHTML = A.phases.map((p) =>
      '<article class="phase" data-tier="' + p.tier + '">' +
      '<div class="phase__tier">' + p.tier + ' · 风险' + esc(p.risk) + '</div>' +
      '<div class="phase__title">' + esc(p.title) + '</div>' +
      '<ul>' + p.items.map((i) => '<li>' + esc(i) + '</li>').join('') + '</ul>' +
      '<div class="phase__verify">' + esc(p.verify) + '</div></article>'
    ).join('')
  }

  // ── 抽屉 ────────────────────────────────────────────────────────────────
  let lastFocus = null
  function openDrawer(title, sub, html) {
    lastFocus = document.activeElement
    $('#drawerTitle').textContent = title
    $('#drawerSub').textContent = sub
    $('#drawerBody').innerHTML = html
    $('#drawer').dataset.open = 'true'
    $('#drawer').setAttribute('aria-hidden', 'false')
    $('#scrim').dataset.open = 'true'
    $('#drawerClose').focus()
  }
  function closeDrawer() {
    $('#drawer').dataset.open = 'false'
    $('#drawer').setAttribute('aria-hidden', 'true')
    $('#scrim').dataset.open = 'false'
    if (lastFocus && lastFocus.focus) lastFocus.focus()
  }
  function row(k, v) { return '<div class="drawer__row"><span class="drawer__k">' + esc(k) + '</span><span class="drawer__v">' + v + '</span></div>' }
  function link(url, text) { return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(text || url) + '</a>' : '—' }

  function openIconDrawer(prefix, sem) {
    const lib = A.iconLibs.find((l) => l.prefix === prefix)
    const entry = lib && lib.icons[sem]
    if (!lib || !entry) return
    const full = iconMarkup(lib, entry, { stroke: state.iconStroke })
    const standalone = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + entry.width + ' ' + entry.height + '" width="24" height="24">' +
      (lib.strokeBased ? entry.body.replace(/stroke-width="[\d.]+"/g, 'stroke-width="' + state.iconStroke + '"') : entry.body) + '</svg>'
    openDrawer(lib.name + ' · ' + A.semantics[sem].label, prefix + ':' + entry.name,
      '<div class="drawer__preview">' + full + '</div>' +
      row('上游许可', '<span class="badge badge--' + (lib.risk === 'none' ? 'ok' : lib.risk === 'attribution-required' ? 'warn' : 'bad') + '">' + esc(lib.upstreamLicense) + '</span> ' + link(lib.upstreamLicenseUrl, '许可原文')) +
      row('npm 许可', esc(lib.npmLicense) + (lib.npmLicense !== lib.upstreamLicense && lib.upstreamLicense !== '(未取得)' ? ' <span class="badge badge--bad">与上游不一致</span>' : '')) +
      row('包 / 版本', esc(lib.npm) + (lib.npmVersion ? ' @ ' + esc(lib.npmVersion) : '')) +
      row('图标总数', String(lib.total ?? '?')) +
      row('网格', entry.width + ' × ' + entry.height) +
      row('描边可调', lib.strokeBased ? '<span class="badge badge--ok">是 · 真描边</span>' : '<span class="badge badge--warn">否 · 填充轮廓，需换字重变体</span>') +
      row('官网', link(lib.site)) +
      row('选型判断', esc(lib.note)) +
      '<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn btn--sm btn--accent" id="dCopySvg">复制 SVG</button>' +
      '<button class="btn btn--sm" id="dCopyInstall">复制安装命令</button></div>' +
      '<div class="code-block" style="margin-top:16px"><pre><code>' + esc(standalone) + '</code></pre></div>'
    )
    $('#dCopySvg').addEventListener('click', () => copyText(standalone, 'SVG'))
    $('#dCopyInstall').addEventListener('click', () => copyText('npm i ' + lib.npm, '安装命令'))
  }

  function openFontDrawer(id) {
    const f = A.fonts.find((x) => x.id === id)
    if (!f) return
    const face = '@font-face {\n  font-family: \'' + f.family + '\';\n  src: url(\'' + f.localFile + '\') format(\'woff2\');\n  font-weight: ' + f.weightRange + ';\n  font-style: normal;\n  font-display: swap;\n}'
    openDrawer(f.family, f.pkg + '@' + f.version,
      '<div class="drawer__preview" style="height:auto;padding:24px"><div style="font-family:\'' + esc(f.family) + '\',var(--font-ui);font-size:34px;font-weight:' + state.specWeight + ';text-align:center">' + esc(specText()) + '</div></div>' +
      row('许可证', '<span class="badge badge--ok">' + esc(f.license) + '</span>（npm registry 字段）') +
      row('下载体积', kb(f.bytes) + '（latin 分片实测）') +
      row('整包体积', f.unpackedSize ? kb(f.unpackedSize) + '（解包后，含全部字重与分片）' : '—') +
      row('可变轴', f.isVariableFace ? esc(f.weightRange) : '非可变，单字重 ' + esc(f.weightRange)) +
      row('分片数', String(f.faceCount)) +
      row('用途', esc(f.use)) +
      row('判断', esc(f.note)) +
      row('来源', link(f.sourceUrl, 'woff2 直链')) +
      row('仓库', link(f.repository)) +
      '<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn btn--sm btn--accent" id="dCopyFace">复制 @font-face</button>' +
      '<button class="btn btn--sm" id="dCopyPkg">复制安装命令</button></div>' +
      '<div class="code-block" style="margin-top:16px"><pre><code>' + esc(face) + '</code></pre></div>'
    )
    $('#dCopyFace').addEventListener('click', () => copyText(face, '@font-face'))
    $('#dCopyPkg').addEventListener('click', () => copyText('npm i ' + f.pkg, '安装命令'))
  }

  function openManifestDrawer(id) {
    const m = A.manifest.find((x) => x.id === id)
    if (!m) return
    manifestState.selected = id
    renderManifest()
    const riskCls = m.risk === 'none' ? 'ok' : m.risk === 'attribution-required' ? 'warn' : 'bad'
    openDrawer(m.name, m.category + (m.version ? ' · v' + m.version : ''),
      row('许可证', '<span class="badge badge--' + riskCls + '">' + esc(m.license) + '</span>') +
      row('许可来源', esc(m.licenseSource)) +
      row('许可原文', link(m.licenseUrl)) +
      row('预览', link(m.preview)) +
      (m.npmLicense ? row('npm 声明', esc(m.npmLicense)) : '') +
      row('风险', '<span class="badge badge--' + riskCls + '">' + RISK_LABEL[m.risk] + '</span>') +
      row('契合度', m.fit.toFixed(1) + ' / 10') +
      row('建议', VERDICT_LABEL[m.verdict]) +
      row('推荐用途', esc(m.use)) +
      row('集成方式', '<code style="font-family:var(--font-mono)">' + esc(m.integration) + '</code>') +
      (m.size ? row('实测体积', kb(m.size)) : '') +
      '<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn btn--sm btn--accent" id="dCopyRow">复制这一条</button>' +
      (m.detail && m.detail.kind === 'font' ? '<button class="btn btn--sm" id="dGoFont">看试排</button>' : '') +
      '</div>'
    )
    $('#dCopyRow').addEventListener('click', () => copyText(
      '| ' + m.category + ' | ' + m.name + ' | ' + m.preview + ' | ' + m.license + ' | ' + m.use + ' | ' + m.integration + ' |', '清单行'))
    const go = $('#dGoFont')
    if (go) go.addEventListener('click', () => { closeDrawer(); document.getElementById('sec-fonts').scrollIntoView({ behavior: 'smooth' }) })
  }

  // ── 导出 ────────────────────────────────────────────────────────────────
  function exportMarkdown() {
    const rows = filteredManifest()
    const lines = []
    lines.push('# Polaris 开源素材交付清单', '')
    lines.push('> 由素材图鉴导出。事实字段来自 npm registry 与 Iconify 上游登记表，字体与 SVG 已实际下载核验。', '')
    lines.push('## 结论先行', '')
    lines.push('- **图标与字体保持现状**：Lucide（ISC）+ Inter / Manrope / Geist Mono / Noto Sans SC（OFL-1.1）已经成立。')
    lines.push('- **真正该补的是合规与体积**：补 NOTICE 文件；中文字体子集化。')
    lines.push('- **动效自己写**：10 个配方里 7 个是 0 KB 纯 CSS/SVG。')
    lines.push('- **许可陷阱比想象的多**：MiSans 的 EULA 只授权 use、明文禁止再分发，不能进安装包；' +
      'HarmonyOS Sans 允许原样嵌入但禁止任何修改（子集化封死）且许可可撤销；Remix Icon 上游登记与 npm 声明冲突；' +
      'Solar 是 CC-BY-4.0 需署名；Tabbied 的 MIT 只在子目录。')
    lines.push('- **有两类压根没有可采纳的开源件**：装饰性特效与一次性确认动画。本文这两类配方全部自绘或浏览器内置，' +
      '零第三方分发物、零许可义务。这是结论，不是遗漏。', '')
    lines.push('## 交付清单（' + rows.length + ' 条）', '')
    lines.push('| 类别 | 名称 | 预览 | 许可证 | 许可来源 | 推荐用途 | 集成方式 | 契合度 | 建议 |')
    lines.push('|---|---|---|---|---|---|---|---|---|')
    for (const m of rows) {
      lines.push('| ' + [m.category, m.name, m.preview || '—', m.license, m.licenseSource, m.use, m.integration, m.fit.toFixed(1), VERDICT_LABEL[m.verdict]]
        .map((x) => String(x).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |')
    }
    lines.push('', '## 对抗式核验：推翻了哪些判断', '')
    lines.push('初版清单交给 ' + A.stats.researchAgents + ' 个 agent 做了两轮独立核验。下面包括推翻本文初版自己的判断。', '')
    for (const o of (A.overturned || [])) {
      lines.push('### ' + o.title, '', '- **初版**：~~' + o.before + '~~', '- **核验后**：' + o.after,
        '- **影响**：' + o.impact, '- **证据**：' + o.evidence, '')
    }
    lines.push('## 哪些类别根本没找到合适的开源素材', '', '这是结论，不是遗漏。', '')
    for (const n of (A.noAssetConclusions || [])) {
      lines.push('### ' + n.category, '', '**' + n.conclusion + '**', '', n.why, '',
        '**替代**：' + n.alternative, '', '> ' + n.honest, '')
    }
    lines.push('## 许可证与合规', '')
    for (const c of A.compliance) lines.push('### ' + c.topic, '', '**' + c.verdict + '**', '', c.detail, '', '> ' + c.action, '')
    lines.push('## 集成方案', '')
    for (const b of A.integration) lines.push('### ' + b.title, '', '`' + b.path + '`', '', b.note, '', '```' + b.lang, b.code, '```', '')
    lines.push('## 分阶段落地', '')
    for (const p of A.phases) {
      lines.push('### ' + p.tier + ' · ' + p.title + '（风险' + p.risk + '）', '')
      p.items.forEach((i) => lines.push('- ' + i))
      lines.push('', '验证：`' + p.verify + '`', '')
    }
    download('polaris-素材清单.md', lines.join('\n'), 'text/markdown')
  }

  function exportJson() {
    download('polaris-素材清单.json', JSON.stringify({
      exportedFor: 'Polaris v' + A.project.version,
      filters: manifestState,
      stats: A.stats,
      manifest: filteredManifest(),
      compliance: A.compliance,
      phases: A.phases
    }, null, 2), 'application/json')
  }

  function exportNotice() {
    const rows = filteredManifest().filter((m) => m.verdict !== 'avoid' && m.license && !m.license.startsWith('自绘') && m.license !== '项目自有' && m.license !== '随所用库')
    const groups = new Map()
    for (const m of rows) {
      const key = m.license
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(m)
    }
    const lines = ['Polaris — 第三方素材声明（NOTICE）', '生成自 Polaris 素材图鉴', '']
    lines.push('本软件随安装包分发以下第三方素材。各素材的许可原文见 licenses/ 目录。', '')
    for (const [lic, items] of Array.from(groups.entries()).sort()) {
      lines.push('════════════════════════════════════════════', lic, '════════════════════════════════════════════', '')
      for (const m of items) {
        lines.push('  ' + m.name + (m.version ? ' v' + m.version : ''))
        if (m.licenseUrl) lines.push('    ' + m.licenseUrl)
        if (m.risk === 'attribution-required') lines.push('    ⚠ 该素材要求署名，请在此补上作者与修改说明')
        lines.push('')
      }
    }
    lines.push('────────────────────────────────────────────', '')
    lines.push('注意：OFL-1.1 字体若做过子集化且原字体声明了 Reserved Font Name，')
    lines.push('必须为修改后的字体改名。请在打包前逐个确认。')
    download('NOTICE.txt', lines.join('\n'))
  }

  // ── 控制台绑定 ──────────────────────────────────────────────────────────
  function bindRange(id, key, label, fmt, after) {
    const input = $('#' + id), out = $('#' + label)
    const apply = () => {
      state[key] = Number(input.value)
      out.textContent = fmt(state[key])
      document.documentElement.style.setProperty('--' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), String(state[key]))
      if (after) after()
    }
    input.addEventListener('input', apply)
    apply()
  }

  function bindSeg(id, key, after) {
    $$('#' + id + ' .seg__btn').forEach((b) => {
      b.addEventListener('click', () => {
        const val = b.dataset.tone || b.dataset.text || b.dataset.filter
        state[key] = val
        $$('#' + id + ' .seg__btn').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
        if (after) after()
      })
    })
  }

  function applyCssVars() {
    const r = document.documentElement.style
    r.setProperty('--icon-size', state.iconSize + 'px')
    r.setProperty('--spec-size', state.specSize + 'px')
    r.setProperty('--spec-weight', String(state.specWeight))
    r.setProperty('--aurora-level', String(state.aurora))
    r.setProperty('--grain-level', String(state.grain))
    r.setProperty('--radius-scale', String(state.radius))
    r.setProperty('--speed', String(state.speed))
    document.body.dataset.reduce = String(state.reduce)
    $('#motionState').textContent = '动效：' + (state.reduce ? '已减弱（直接渲染终态）' : '开 · ' + state.speed.toFixed(1) + '×')
  }

  function bindControls() {
    bindRange('cIconSize', 'iconSize', 'vIconSize', (v) => v + 'px', () => { applyCssVars(); renderIconToolbar() })
    bindRange('cIconStroke', 'iconStroke', 'vIconStroke', (v) => v.toFixed(2), () => { refreshIconStrokes() })
    bindRange('cSpecSize', 'specSize', 'vSpecSize', (v) => v + 'px', applyCssVars)
    bindRange('cSpecWeight', 'specWeight', 'vSpecWeight', (v) => String(v), applyCssVars)
    bindRange('cAurora', 'aurora', 'vAurora', (v) => v.toFixed(1) + '×', applyCssVars)
    bindRange('cGrain', 'grain', 'vGrain', (v) => v.toFixed(1) + '×', applyCssVars)
    bindRange('cRadius', 'radius', 'vRadius', (v) => v.toFixed(2) + '×', applyCssVars)
    bindRange('cSpeed', 'speed', 'vSpeed', (v) => v.toFixed(1) + '×', applyCssVars)

    bindSeg('cIconTone', 'iconTone', refreshIconStrokes)
    bindSeg('cSpecText', 'specText', refreshSpecText)
    bindSeg('fontFilter', 'fontFilter', renderFonts)

    $('#cReduce').addEventListener('change', (e) => {
      state.reduce = e.target.checked
      applyCssVars()
      A.motion.forEach((m) => playDemo(m.id))
    })

    $('#specText').addEventListener('input', (e) => { state.customText = e.target.value; refreshSpecText() })

    $('#replayAll').addEventListener('click', () => { A.motion.forEach((m) => playDemo(m.id)); toast('已重播全部动效') })
    $('#expMd').addEventListener('click', exportMarkdown)
    $('#expJson').addEventListener('click', exportJson)
    $('#expNotice').addEventListener('click', exportNotice)

    $('#resetAll').addEventListener('click', () => {
      Object.assign(state, DEFAULTS)
      $('#cIconSize').value = DEFAULTS.iconSize
      $('#cIconStroke').value = DEFAULTS.iconStroke
      $('#cSpecSize').value = DEFAULTS.specSize
      $('#cSpecWeight').value = DEFAULTS.specWeight
      $('#cAurora').value = DEFAULTS.aurora
      $('#cGrain').value = DEFAULTS.grain
      $('#cRadius').value = DEFAULTS.radius
      $('#cSpeed').value = DEFAULTS.speed
      $('#cReduce').checked = false
      $('#specText').value = ''
      $('#vIconSize').textContent = DEFAULTS.iconSize + 'px'
      $('#vIconStroke').textContent = DEFAULTS.iconStroke.toFixed(2)
      $('#vSpecSize').textContent = DEFAULTS.specSize + 'px'
      $('#vSpecWeight').textContent = String(DEFAULTS.specWeight)
      $('#vAurora').textContent = '1.0×'
      $('#vGrain').textContent = '1.0×'
      $('#vRadius').textContent = '1.00×'
      $('#vSpeed').textContent = '1.0×'
      $$('#cIconTone .seg__btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tone === 'inherit')))
      $$('#cSpecText .seg__btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.text === 'mixed')))
      $$('#fontFilter .seg__btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === 'all')))
      applyCssVars(); renderFonts(); refreshIconStrokes(); renderContextDemo()
      A.motion.forEach((m) => playDemo(m.id))
      toast('参数已恢复默认')
    })

    // 清单筛选
    $('#mSearch').addEventListener('input', (e) => { manifestState.q = e.target.value; renderManifest() })
    $('#mCategory').addEventListener('change', (e) => { manifestState.category = e.target.value; renderManifest() })
    $('#mVerdict').addEventListener('change', (e) => { manifestState.verdict = e.target.value; renderManifest() })
    $('#mRisk').addEventListener('change', (e) => { manifestState.risk = e.target.value; renderManifest() })
    $$('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      const k = th.dataset.sort
      if (manifestState.sort === k) manifestState.dir *= -1
      else { manifestState.sort = k; manifestState.dir = k === 'fit' ? -1 : 1 }
      renderManifest()
    }))

    // 抽屉
    $('#drawerClose').addEventListener('click', closeDrawer)
    $('#scrim').addEventListener('click', closeDrawer)

    // 移动端控制台
    const rail = $('#rail'), toggle = $('#railToggle'), railClose = $('#railClose')
    const setRail = (open) => {
      rail.dataset.open = String(open)
      document.body.dataset.railOpen = String(open)
      toggle.setAttribute('aria-expanded', String(open))
      if (open) railClose.focus()
      else toggle.focus()
    }
    toggle.addEventListener('click', () => setRail(rail.dataset.open !== 'true'))
    railClose.addEventListener('click', () => setRail(false))
    $$('#nav .nav__item').forEach((a) => a.addEventListener('click', () => {
      if (window.innerWidth <= 860) setRail(false)
    }))
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && rail.dataset.open === 'true' && window.innerWidth <= 860) setRail(false)
    })
  }

  // ── 键盘与滚动 ──────────────────────────────────────────────────────────
  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#drawer').dataset.open === 'true') { e.preventDefault(); closeDrawer(); return }
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        e.preventDefault(); $('#mSearch').focus(); $('#mSearch').select()
      }
      if (e.key === 'Tab' && $('#drawer').dataset.open === 'true') {
        const f = $$('#drawer button, #drawer a[href], #drawer input, #drawer [tabindex="0"]')
        if (!f.length) return
        const first = f[0], last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    })
  }

  function bindScrollSpy() {
    const links = new Map($$('#nav .nav__item').map((a) => [a.dataset.sec, a]))
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return
        links.forEach((a) => a.setAttribute('aria-current', 'false'))
        const a = links.get(en.target.id)
        if (a) a.setAttribute('aria-current', 'true')
      })
    }, { rootMargin: '-15% 0px -70% 0px', threshold: 0 })
    SECTIONS.forEach((s) => { const el = document.getElementById(s.id); if (el) obs.observe(el) })
  }

  function bindPointer() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    window.addEventListener('pointermove', (e) => {
      if (state.reduce || raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const x = (e.clientX / window.innerWidth - 0.5) * 2
        const y = (e.clientY / window.innerHeight - 0.5) * 2
        const r = document.documentElement.style
        r.setProperty('--px', x.toFixed(3))
        r.setProperty('--py', y.toFixed(3))
      })
    }, { passive: true })
  }

  // ── 启动 ────────────────────────────────────────────────────────────────
  function init() {
    injectStyles()
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { state.reduce = true; $('#cReduce').checked = true }
    renderNav()
    renderThemes()
    renderHero()
    renderIconGrid()
    renderContextDemo()
    renderFonts()
    renderCjk()
    renderMotion()
    renderEffects()
    renderManifestFilters()
    renderManifest()
    renderOverturned()
    renderCompliance()
    renderIntegration()
    bindControls()
    bindKeyboard()
    bindScrollSpy()
    bindPointer()
    applyCssVars()
    document.documentElement.dataset.theme = state.theme
    $('.hero').classList.add('reveal')
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()

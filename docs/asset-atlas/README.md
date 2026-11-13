# Polaris 素材图鉴

为 Polaris 调研并**实际下载核验**的开源素材清单，做成一个可交互的本地网页。
不是链接列表——字体是真的 woff2，图标是真的 SVG，许可证来自机器可读的权威字段。

## 打开

```bash
node docs/asset-atlas/tools/serve.mjs
```

然后访问 http://localhost:4321 。也可以直接双击 `index.html`（数据以 `<script>` 内联，不依赖 fetch，`file://` 下同样能跑）。

## 里面有什么

| 区块 | 内容 |
|---|---|
| 概览 | 结论先行 + 实测统计 |
| 图标对比 | 10 个图标库 × 8 个语义的真实 SVG，可调尺寸/描边/色调，点开看源码与许可 |
| 字体试排 | 23 套已下载的拉丁可变字体 + 3 套中文分片，可调字号/字重/字样 |
| 动效实验 | 10 个可重播配方，全部一次性播放，尊重 reduced motion |
| 特效纹理 | 7 个零运行时配方，含 `--inner-highlight` 陷阱的真实复现 |
| 交付清单 | 91 条，可搜索/筛选/排序，点开看详情 |
| 核验修正 | 9 条被对抗式核验推翻或补强的结论，含推翻本图鉴初版自己的判断 |
| 无素材结论 | 4 类「压根没有可采纳开源件」的明确结论与替代方案 |
| 许可合规 | 逐条说明打进 NSIS 安装包触发哪些义务 |
| 集成方案 | 12 段落到本仓库真实文件的代码 + P0/P1/P2 落地顺序 |

左侧控制台常驻，12 个参数实时生效；六套主题随时切换。
导出按钮产出 Markdown 清单、JSON 清单、以及可直接用的 `NOTICE.txt`。

## 数据来源与复现

所有事实字段由 `tools/` 下的脚本抓取，原始结果留在 `data/`：

```bash
node docs/asset-atlas/tools/fetch-assets.mjs        # 拉丁字体 woff2 + npm license/version
node docs/asset-atlas/tools/probe-names.mjs         # 核对包名，取更多 license 字段
node docs/asset-atlas/tools/fetch-icons.mjs         # Iconify 官方 API 的原始 SVG
node docs/asset-atlas/tools/fetch-icon-licenses.mjs # 上游 icon-sets 登记表的集合许可
node docs/asset-atlas/tools/fetch-cjk.mjs           # 中文字体按 unicode-range 按需分片
node docs/asset-atlas/tools/build-data.mjs          # 合成 atlas-data.js
```

`tools/curated.mjs` 是人工策划的部分（动效配方、特效配方、集成代码、合规结论）；
事实性字段不写在那里，由 `build-data.mjs` 从 `data/*.json` 注入。

`tools/verified.mjs` 是 19 个 agent 两轮对抗式核验的结论，会**覆盖** `curated.mjs` 里的同项判断。
原始记录（每个 agent 的完整返回）在 `data/research/`，可用下面的命令从 workflow journal 重新提取：

```bash
node docs/asset-atlas/tools/extract-research.mjs <journal.jsonl 路径>
```

其中 `_corrections.json` 汇总了全部 69 条需修正/留意的条目。

## 关于 fonts/

`fonts/` 是**预览缓存**，约 4 MB，仅供本页渲染，**不建议提交进 git**。
应用运行时的正确引入方式是 npm 的 `@fontsource-variable/*` 包，见集成方案。

建议加进 `.gitignore`：

```
docs/asset-atlas/fonts/
```

## 已知边界

- 中文分片只覆盖图鉴里用到的 332 个汉字，超出范围的字会回退到系统字体。这是 `unicode-range` 的正常行为，页面上已标注。
- 昭源黑体实测需要 45 片 / 10 MB，过重，已测量但不随预览页分发；结论保留在清单里。
- 部分素材站点在本轮抓取时不可达，清单里如实标为「未验证」，没有编造链接。
- 图标 MCP 服务本轮多次报错，改走 Iconify 官方 API；两条路的差别是 MCP 会给描边元素注入 `fill`，导致线性图标渲染成实心。

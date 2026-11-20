# Polaris 多设备同步设计（网盘同步文件夹 · Joplin 模式）

日期：2026-11-20 · 状态：用户拍板只做 L0 单设备云端镜像（§15）；全量同步 §1-14 挂起为未来参考 · 目标版本：0.17.0

## 1. 背景与意图

用户需求（2026-11-20 原话归纳）：1 台以上设备、可能同时使用，自定义任务文件到网盘同步，实现多设备同步。

调研结论（2026-11-19 备份咨询 + 2026-11-20 本次讨论）：
- 搬活库 / 网盘同步活库文件是死路：文件级粒度 + WAL 三文件 + 整文件后写盖先写，原理上给不了多设备同步，且必撕库。
- 备份交换不等于同步：importBackup 按 ID 跳过已存在行（db.ts:892），编辑与删除不过去。
- 可行路 = Joplin 模式：活库留本地，网盘文件夹只存条目级文件，客户端做记录级对账。已对照 Joplin 官方同步规格核实（offline-first / 条目文件 / file-api 四哑操作 / sync_items.sync_time 基线 / 改动秒级上传 + 分钟级轮询 / 删除传播 / info.json / 可选 E2EE / 专门同步锁规格）。

意图：不要服务器、不要账号、不破 local-first，让同一份任务清单在 ≥2 台 Windows 设备间最终收敛；网盘只当哑通道。

## 2. 目标 / 非目标 / 反目标

目标：
- 最终收敛：任一设备改动后，其他设备在「同步间隔 + 网盘传播延迟」内（分钟级）跟上。
- 离线优先：文件夹不可用时应用全功能；同步是附加层不是依赖。
- 冲突安全：同任务同时改有确定性裁决，输的一方被告知（默认策略待拍板 D1）。
- 通用性：任何带「本地同步文件夹」的网盘均可（OneDrive / 坚果云 / 群晖 Drive 等）；v1 不对接任何网盘 API。
- 数据全覆盖：tasks（含子任务、标签关联）/ projects / tags。

非目标：实时协作、移动端、服务器/账号、活库迁移、网盘 API 直连（WebDAV 等留后）、E2EE（v2，见 §9）。

反目标（技术上跑通也算失败）：
- 静默丢改动；已删任务复活；同步 bug 伤及本地活库；
- 离线时应用因同步依赖而功能受损；
- 破坏设置页一屏契约（settingsNoScroll* / settingsFitsCompact）；
- 网盘明文内容未向用户明示（隐私披露必须）；
- 第二台设备的教学演示数据污染共享清单（审查问题 1，见 §6 Bootstrap）。

## 3. 决策状态

用户已拍板（2026-11-20）：≥2 台设备；可能同时使用；自定义网盘同步文件夹；条目级文件同步。

待拍板（默认值是我的选择，非用户已同意）：
- D1 冲突裁决：默认「取新者 + 状态栏提醒」。备选：静默取新 / Joplin 式两版都留。
- D2 加密时机：默认「v1 明文 + 明示披露，E2EE 作为 v2」。备选：起步即 E2EE（密钥管理是独立子系统，工期显著拉长）。
- D3 主力网盘：未定；设计按提供商无关做，OneDrive「按需文件」占位需专门处理（§7）。

我的设计决定（builder 审查后补全，用户读文档时可逐条否决）：
- C1 任务聚合文件：子任务 + tagIds 内嵌任务文件；子任务/关联变更经触发器 bump 父任务 updatedAt。代价：两台设备改同一任务的不同子任务 = 整任务 LWW，输方子任务改动丢失（有提醒）。待办场景可接受。
- C2 墓碑文件代替删远程文件；保留 ≥90 天后清理。
- C3 演示数据隔离（审查问题 1）：迁移 8 给 tasks/projects 加 is_demo 列，种子行置 1；AFTER UPDATE 触发器任何用户编辑自动置 0（零应用层埋点）；is_demo=1 的行永不推送。启用同步时若远端已有数据且本机仍有未动过的演示行 → 对话框确认「清除本机演示数据，以云端为准」（只清 is_demo=1，用户动过的已被触发器摘标，安全）。
- C4 标签身份 = 名字（审查问题 2）：tags.name UNIQUE NOCASE 已宣告名字即身份。同名不同 id 相遇 → 确定性赢家 = id 字典序较小者；输家本地行并入赢家（task_tags 重映射、输家行删除），别名记入本地 sync_tag_aliases 表；应用远端任务文件时 tagIds 经别名表重映射，悬空才剔除。双方设备独立算出同一赢家，无需协商。墓碑与活标签同名：updatedAt 新者赢。
- C5 项目/标签删除保持本地硬删 UX（审查问题 3）：不进回收站、listProjects/listTags 不加过滤、createTag 同名复用不撞墓碑（本地行已删，墓碑只在文件夹）。deleted_at 列只为远端格式存在，本地恒空。硬删门控先写墓碑文件（或入待补队列，C6）。
- C6 离线硬删 = 待补墓碑队列（审查问题 4）：迁移 8 新增 pending_tombstones 本地表；文件夹暂停期间的硬删照常立即执行（回收站 30 天语义不破），墓碑载荷入队；文件夹恢复后引擎优先补写队列再跑正常轮次。残余边缘：补写前其他设备可能重推该任务 → 短暂复活，补写后 LWW 删除版本赢回（删除时间戳新于重推的旧编辑）。记录于 §10。
- C7 重复任务离线双完成 = 已知边缘（审查问题 5）：两台设备离线各完成同一重复任务 → 两个不同 id 的下一实例并集后双双存活。v1 接受（去重需因果标记 + 格式升级，收益不抵复杂度），§10 + README 明示；用户手动删一条即可，删除会正常传播。
- C8 提醒按设备各自响（审查问题 6）：remindedAt 排除出同步载荷（本地字段），markTaskReminded 不 bump updatedAt、不触发同步。任务完成状态会同步，已完成的任务别台自然不弹。避免「一台弹过全家静音」的意外压制。
- C9 设置单行 + 独立 SyncDialog；CustomEvent polaris:sync-applied 刷新，不加第二条 push 通道。
- C10 条目文件携带 lastWriter（写入者 deviceId），平局裁决用远端文件的 lastWriter 字典序，双方确定性一致。

## 4. 总体架构

```text
<网盘同步文件夹>/PolarisSync/
├── info.json                  # formatVersion / appMinVersion / createdAt
├── lock.json                  # 同步锁 {deviceId, acquiredAt, expiresAt}
├── devices/<deviceId>.json    # 设备心跳 {name, lastSeen}（各设备只写自己的）
├── projects/<id>.json
├── tags/<id>.json
└── tasks/<id>.json            # 任务聚合：任务字段 + subtasks[] + tagIds[]
```

- 活库仍在 userData/polaris.db，一字节不挪；同步文件夹是唯一共享面。
- 一条目一文件：两台设备改不同任务永不碰同一文件；同任务冲突按 updatedAt 裁决（§6）。
- 任务文件示例（字段形状复用备份 v3 的 zod 子 schema；remindedAt 不同步，见 C8）：

```json
{
  "id": "a1b2", "title": "交季度总结", "notes": "", "completed": false,
  "dueAt": null, "remindAt": null,
  "recurrenceRule": null, "projectId": null, "priority": 0,
  "createdAt": "2026-11-20T01:00:00.000Z", "updatedAt": "2026-11-20T01:30:00.000Z",
  "completedAt": null, "deletedAt": null, "lastWriter": "device-uuid",
  "subtasks": [{"id": "s1", "title": "列提纲", "completed": false, "sortOrder": 0, "createdAt": "2026-11-20T01:00:00.000Z"}],
  "tagIds": ["t1"]
}
```

- 时间戳一律 ISO UTC（现有约定）；deletedAt 非空 = 墓碑，文件保留不删。
- 原子写复用 writeFileAtomic（同目录临时文件 + rename）。

## 5. 数据模型变更（迁移 8，只追加不改已发布块）

- projects ADD deleted_at TEXT、ADD is_demo INTEGER NOT NULL DEFAULT 0。
- tasks ADD is_demo INTEGER NOT NULL DEFAULT 0。
- tags ADD updated_at TEXT（以 created_at 回填）、ADD deleted_at TEXT。
- 新触发器：
  - subtasks / task_tags 的 AFTER INSERT/UPDATE/DELETE → UPDATE tasks SET updated_at = 当前时间 WHERE id = 父任务（聚合语义，C1）。
  - tasks / projects 的 AFTER UPDATE → NEW.is_demo = 0 时把 is_demo 置 0（用户编辑摘标，C3；种子插入走 INSERT 不触发）。
  - 与迁移 7 修订号触发器共存，单调性不变，应用层零埋点。
- 新表（仅本地，不同步不进备份）：
  - sync_items(item_type, item_id, sync_time, remote_updated_at, PRIMARY KEY(item_type, item_id))——对账基线。
  - sync_tag_aliases(loser_id PRIMARY KEY, winner_id, name, created_at)——标签身份重映射（C4）。
  - pending_tombstones(item_type, item_id, payload, queued_at, PRIMARY KEY(item_type, item_id))——离线硬删待补队列（C6）。
- meta 新键（仅本地）：sync_enabled / sync_folder / sync_device_id / sync_last_run / sync_error。
- 硬删路径门控（deleteForever / emptyTrash / purgeExpiredDeleted / deleteProject / deleteTag）：同步启用时先写墓碑文件到同步文件夹（文件夹可用）或入 pending_tombstones（暂停中）再删本地行；本地回收站语义与 UX 完全不变。同步未启用时行为与今天一致。
- subtasks / task_tags 本身不加时间戳列——聚合文件吸收。
- 备份格式不变（schemaVersion 3）；同步与备份是两条独立出口；is_demo / lastWriter 不进备份。

## 6. 同步协议

三方比较纯函数 resolveSyncAction(local, remote, baseline) → push / pull / skip / conflict：
- 无 remote、local 新于基线 → push
- 无 local、remote 存在 → pull
- remote.updatedAt 新于基线记录且 local 自基线未变 → pull
- local.updatedAt 新于基线且 remote 未变 → push
- 双方都变 → conflict → D1 策略（默认 updatedAt 新者赢；平局比 lastWriter deviceId 字典序，C10；提醒 + 日志）
- 双方未变 → skip
- is_demo=1 的本地行永不进入 push 集合（C3）
真值表进 verify-pure 与 harness 双份（现有铁律：两份同更）。

标签身份重映射（C4）：拉取远端标签时若名字（NOCASE）命中本地不同 id → 赢家 = min(id)；本地是输家则并入（task_tags 重映射 + 删输家行 + 记别名 + 受影响任务文件重写推送）；应用远端任务文件时 tagIds 先经 sync_tag_aliases 重映射再剔除悬空。

锁：lock.json TTL 120s。获取 = 读 → 缺席/过期则原子写自己 → 回读验证；他人持有 → 本轮跳过；释放 = 验证是自己再删；崩溃靠 TTL 过期；长轮次（>60s）中途续期一次。本地文件系统尽力 CAS；网盘传播窗口内理论上可能同秒双持——LWW 下一轮自愈，记录为已知边缘。（Joplin 锁规格细节今日未拉取，机制意图一致，标待验证。）

墓碑与清理：删除 = deletedAt 版本参与 LWW（较新的删除赢过较旧的编辑）；墓碑文件保留 ≥90 天（SYNC_TOMBSTONE_RETENTION，builder 可调）后从文件夹清理；离线超窗口的设备可能复活已删项——记录为已知边缘，v1 接受。

Bootstrap（C3）：首次启用 → 推送全部非演示行；远端已有数据（第二台设备）→ 按 ID 并集 + LWW 合并，绝不破坏性覆盖；本机仍有未动过的演示行且远端有数据 → 对话框确认清除本机演示行（只清 is_demo=1）。换同步文件夹 = 基线重置（sync_items 清空）+ 重新 bootstrap，旧文件夹文件不动。

info.json 门禁：formatVersion=1、appMinVersion="0.17.0"；客户端版本低于远端要求 → 拒绝同步 + 状态报错（老客户端不得写新格式）。

远端文件 = 不可信输入：逐文件 zod 校验 + 单文件 1MB 上限 + 文件名白名单正则（id 形状门禁，backupNames 同哲学，拒绝路径穿越）；校验失败 → 改名 <name>.bad-<ts> 隔离跳过，绝不应用（DB 损坏隔离同哲学）。

应用顺序：projects → tags（含身份重映射）→ tasks（悬空 projectId / tagIds 剔除，镜像 FK SET NULL / CASCADE）；整轮单事务，失败回滚本地无损；触发器天然 bump write_revision。

## 7. 引擎生命周期

- src/main/sync.ts 唯一 owner，镜像 mcp.ts 意图/状态分离：meta sync_enabled 记意图，running 记实际，error 中文文案；initSync() 在 whenReady，disposeSync() 在 will-quit。
- 轮次触发：启用即跑（bootstrap）；窗口 focus（≥30s 节流，wakeCheck 同形）；每 5 分钟；本地 write_revision 变化去抖 3s（廉价探针：单行 SELECT）。
- 每轮开始先_flush pending_tombstones（C6）：文件夹恢复后优先补写离线期间的墓碑，再跑正常对账。
- 文件夹不可用（盘离线 / 同步客户端未跑 / 路径被删）：静默暂停 + 状态「已暂停」，应用全功能；硬删走待补队列；绝不把数据迁去别处，绝不静默重建空内容。
- OneDrive 按需文件：占位文件可能读不出 → 读失败按「本轮跳过该文件」处理，并提示用户把文件夹设为「始终保留在此设备上」；对话框 + README 双提示。
- 应用后若主窗口聚焦：executeJavaScript 派发 CustomEvent polaris:sync-applied → store refreshOnFocus()（修订号已变，自然拉取）；不加第二条 push 通道。
- electron-log 里程碑：同步启用 / bootstrap 完成 / 轮次摘要（push/pull/conflict 计数）/ 隔离 / 暂停 / 队列补写；错误进 main.log。

## 8. UI（zh/en 全走 i18n 字典）

- 设置页数据进出列：单行「多设备同步」= 标题 + 开关 + 「配置…」按钮（与现有行同高，零条件行，一屏契约不破）。
- SyncDialog（独立对话框，UpdateDialog 同形）：文件夹选择（native dialog）、设备列表（devices/ 心跳）、上次同步 / 下次轮次、冲突记录（最近 N 条）、暂停原因、bootstrap 演示数据清除确认（C3）、关闭同步（确认：本地数据保留、文件夹文件保留）。
- 状态栏 .view-footer：同步状态小标识（已同步 / 同步中 / 已暂停 / 错误），高度不变，mainFooterPinned / fade 契约不破。
- 冲突提醒（D1 默认）：状态栏瞬态行「任务『X』已保留较新版本」+ 日志；不模态打断。

## 9. 安全与隐私

- v1 明文：任务标题 / 笔记明文进入用户自己的网盘文件夹，网盘服务商可读——设置对话框 + README 明示（D2 待拍板）。
- E2EE v2 草图（不实现）：上传前条目级加密（Joplin 式主密钥 + 密码），info.json 记 e2ee 状态；密钥管理独立子系统，届时另立项。
- 信任边界：同步文件夹内容 = 不可信输入（§6 校验）；lock / devices 文件同样校验；无 eval，白名单外路径不 join。
- devices 心跳含机器名（os.hostname()）——只进用户自己的网盘，对话框披露。

## 10. 失败模式矩阵

| 场景 | 行为 |
|---|---|
| 文件夹不可达 | 暂停 + 状态提示，应用正常；硬删入待补队列 |
| 单文件损坏 / 同步半截 | 隔离 .bad 跳过，下轮重推自愈 |
| 双设备同秒双持锁（传播窗口） | LWW 下轮自愈 + 冲突提醒 |
| 时钟偏移 | 依赖 OS 对时；平局 lastWriter；记录为已知限制 |
| 老客户端接新格式 | info 门禁拒绝 |
| 离线 >90 天重连 | 可能复活已删项（已知边缘） |
| 网盘生成冲突副本文件 | 非白名单文件名忽略；规范文件 LWW 重推自愈 |
| 应用中崩溃 | 事务回滚本地无损；锁 TTL 过期 |
| 第二台设备首启演示数据 | is_demo 永不推送 + 启用时确认清除（C3） |
| 两设备离线各建同名标签 | 名字即身份，确定性赢家 + 别名重映射（C4） |
| 暂停期间硬删、恢复前别台重推 | 短暂复活，队列补写后删除版本赢回（C6 残余边缘） |
| 两设备离线各完成同一重复任务 | 下一实例双存活，已知边缘，手动删一条即传播（C7） |

## 11. 测试与验收

- verify-pure 新真值表（harness 双份同更）：resolveSyncAction 全表 / 锁过期与续期 / 墓碑保留 / info 版本门禁 / 文件名白名单 / 标签赢家裁决与重映射 / 演示行过滤。
- smoke 新具名 checks（进 checks map + failed 门控）：syncBootstrapUnion / syncConvergeTwoDevices / syncConcurrentLWW / syncDeletePropagates / syncTombstoneNoResurrect / syncLockSkips / syncOfflinePause / syncMalformedQuarantine / syncSettingsFits / syncStatusBar / syncDemoNotPushed / syncDemoClearedOnEnable / syncTagNameMerge / syncOfflinePurgeQueue / syncRemindedAtLocal / syncRecurringDuplicateEdge。双设备 = 同进程两个临时 DB + 共享临时同步文件夹（引擎注入 db/folder/clock），不需要第二个 Electron；temp-profile 守卫现有。
- 现有契约全绿：typecheck / verify:themes / verify:datetime / verify:pure / smoke（166 + 新增）；设置一屏 × 五档 × 中英；plain build grep 触发词 = 0（JSDoc 避开）。
- 期望值写字面量，不经被测代码反算（现有铁律）。
- 迁移 8 回归重点：子任务/标签关联变更开始 bump 父任务 updatedAt（C1 触发器），现有冒烟全链需复跑确认无副作用。

## 12. Rollout 切片

- S1：迁移 8（is_demo / deleted_at / updated_at 列 + 三组触发器 + sync_items / sync_tag_aliases / pending_tombstones 三表）+ 纯同步核心（resolve/lock/retention/gate/标签重映射）+ verify-pure 双份；无 UI，现有行为不变。
- S2：sync.ts 引擎 + 文件夹驱动 + 待补队列 + 双 DB smoke checks。
- S3：设置行 + SyncDialog（含演示清除确认）+ 状态栏 + i18n + 契约守卫。
- S4：硬化（OneDrive 占位 / 冲突副本边缘 / 保留清理）+ CLAUDE.md / README 同步 + 发布 0.17.0。
- 版本：当前 0.16.6；0.16.7 留给无关补丁；同步作为新功能按 0.17.0 发（semver minor，开发期惯例）。

## 13. Builder 自由

模块内部拆分、去抖/节流/间隔常数（§7 给定默认值内）、单文件与扫描大小上限、冲突记录保留条数、墓碑保留天数（默认 ≥90）、测试夹具设计、对话框内部布局（一屏契约为边界）、锁续期时机、触发器写入顺序细节。

## 14. 参考证据

- Joplin 同步规格：github.com/laurent22/joplin/blob/dev/readme/dev/spec/sync.md（2026-11-20 拉取核实）
- Joplin 同步锁规格：同目录 sync_lock.md（链接实锤，内容今日未拉取，标待验证）
- 本仓库：db.ts（schema/迁移/触发器/硬删路径/seedIfNeeded/markTaskReminded）、index.ts（backupSchema / writeFileAtomic / meta 设置 / 启动链）、CLAUDE.md（契约与文化）
- 2026-11-19 备份调研结论：不做自定义活库路径；市场调研无人做活库同步
- builder 审查（2026-11-20）：六问 = 演示数据污染 / 标签撞名 / 项目标签删除语义 / 离线硬删分支 / 重复任务双完成 / 提醒跨设备语义；对应 C3-C8 已补入文档

## 15. 当前落地：L0 单设备云端镜像（用户 2026-11-20 11:31 拍板「我只要单设备同步到网盘」）

全量同步（§1-14）挂起为未来参考；当前只做 L0。单写入者下完整协议本会退化为只推不拉，L0 直接取该退化态的最简实现。

范围：
- 设置页数据进出列加「云端镜像」单行：开关 + 文件夹选择（native openDirectory）+ 状态槽（一屏契约不破，MCP 行同形）。文件夹对话框预填 %OneDrive%\PolarisSync（环境变量存在时），用户确认即可；无 OneDrive 则空起始自选。选择一次记入 meta，重启沿用；重装后重新指定即触发恢复检测。
- 开启后：启动写一份 + write_revision 变化去抖 30s 写一份 <folder>/latest.json（滚动单文件，网盘自带版本历史）。载荷复用 buildBackupPayload（schemaVersion 3），原子写复用 writeFileAtomic。
- 零上传代码：应用只往本地同步文件夹写文件，上传 / 传播 / 版本历史全由网盘客户端自动完成，应用无任何网络代码。活库 polaris.db 仍在 userData 当本地真相源（优先本地缓存），不进同步文件夹——WAL 三文件被网盘逐文件同步必撕库（§1 死路）；进文件夹的是原子写出的单文件 JSON 快照，同步安全。
- 文件夹不可用：静默暂停 + 状态提示，应用全功能；只写不读，OneDrive 按需占位无碍。
- 恢复 / 重装流：重装后本机是全新库 → 镜像文件夹指回网盘路径 → 「从云端导入」一键恢复（现有 importBackup additive 语义，全量恢复成立）→ 镜像续跑。增强：启用镜像时若本机为全新库（仅演示种子）且文件夹已有 latest.json → 主动提示「检测到云端备份，一键导入恢复」（顺带清演示种子），让重装 ≈ 指回路径 + 确认。
- OneDrive 适配：写 latest.json 不受「按需文件」影响（写即落地）；恢复导入需读文件，云端-only 占位会触发 OneDrive 下载（需在线或设「始终保留在此设备上」）。个人版 / 商业版均有本地同步文件夹，通用；坚果云等同理。建议专用子文件夹 PolarisSync，勿放网盘根目录。
- 隐私：明文进用户自己的网盘，设置描述 + README 明示。
- i18n zh/en 全走字典。

不做：多设备、条目文件、对账协议、锁、墓碑、迁移 8。零数据库迁移。

纯函数与测试：
- shouldMirror 去抖门控纯函数 → verify-pure + harness 双份真值表。
- smoke：cloudMirrorWrites（启用→建任务→去抖后 latest.json 存在且含该任务）/ cloudMirrorPause（文件夹移除→暂停态应用正常）/ cloudMirrorSettingsFits（一屏 × 五档 × 中英）。
- 现有契约全绿；plain build grep 触发词 = 0。

meta 新键（仅本地）：cloud_mirror_enabled / cloud_mirror_folder / cloud_mirror_last / cloud_mirror_error。

切片：S1 镜像引擎 + 纯函数双份 + smoke；S2 设置行 + 从云端导入 + i18n + 契约守卫；S3 README/CLAUDE.md 同步 + 发布。
版本：新功能按 0.17.0 发（或作备份延伸 0.16.7，发布时定）。

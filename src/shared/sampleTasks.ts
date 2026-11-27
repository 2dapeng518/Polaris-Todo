// 示例任务数据集（首启种子与「载入示例任务」共用的唯一来源）。
// 纯数据模块：双语字段（zh/en）、固定 ID、相对日期偏移——真正的时刻由
// 调用方注入 now 换算，入库与断言都不在这里。
//
// 固定 ID 是幂等键：loadSampleTasks 按它跳过已存在的任务，扩充示例集后
// 再载入只会补新增的条目，绝不覆盖现有数据。项目不设固定 ID：示例项目
// 按**名称**复用（老库里的种子项目是随机 UUID，按名复用才不会重名重建）。

export type SampleLang = { title: string; notes: string; subtasks?: string[] }

export type SampleTask = {
  /** 幂等键（sample-task-N，跨版本稳定）。 */
  id: string
  zh: SampleLang
  en: SampleLang
  /** 相对今天的日偏移；null = 无日期任务。 */
  dayOffset: number | null
  /** 截止时刻（本地墙钟）。 */
  hour: number
  minute?: number
  /** 计划时间段：相对同一天的起止钟点（与 due 同日）。 */
  startHour?: number
  startMinute?: number
  endHour?: number
  endMinute?: number
  /** 全天标记（展示忽略钟点）。 */
  allDay?: boolean
  /** 跨天全天/时间段的结束日偏移（相对今天）。 */
  endDayOffset?: number
  remind?: { dayOffset: number; hour: number; minute?: number }
  recurrenceRule?: string
  /** 'polaris' | 'personal' —— 示例项目键，入库时按名称解析/创建。 */
  project: 'polaris' | 'personal'
  priority: 0 | 1 | 2 | 3
  tags?: { zh: string; en: string }[]
  completed?: boolean
}

export type SampleProject = { key: 'polaris' | 'personal'; color: string; sortOrder: number }

export const SAMPLE_PROJECTS: Record<SampleProject['key'], { zh: string; en: string } & SampleProject> = {
  polaris: { key: 'polaris', zh: 'Polaris', en: 'Polaris', color: '#5EEAD4', sortOrder: 0 },
  personal: { key: 'personal', zh: '个人', en: 'Personal', color: '#A78BFA', sortOrder: 1 }
}

export const SAMPLE_TASKS: readonly SampleTask[] = [
  {
    id: 'sample-task-1',
    zh: {
      title: '欢迎使用 Polaris，点我看看',
      notes:
        '点击任务打开详情：备注、截止、提醒、重复都在那里设置。\n顶部输入框随时添加任务；在任何程序里按 Ctrl+Alt+P 都能唤起 Polaris 快速添加。\n这组示例任务只是演示，随时可以删掉。'
    },
    en: {
      title: 'Welcome to Polaris — open me',
      notes:
        'Click a task to open its details: notes, due date, reminder and recurrence all live there.\nUse the input at the top to add tasks anytime; press Ctrl+Alt+P in any app to bring up Polaris quick add.\nThese sample tasks are just a demo — delete them whenever you like.'
    },
    dayOffset: null,
    hour: 12,
    project: 'polaris',
    priority: 0
  },
  {
    id: 'sample-task-2',
    zh: {
      title: '试试快速添加：明天下午3点 交报告 #个人 !高',
      notes:
        '把标题这句话原样敲进顶部输入框再回车：时间、#项目、!优先级 会自动识别成输入框下方的芯片。\n英文同样支持，例如 Submit report tomorrow 3pm #Personal !high。\n时间段也能识别：输入「3点到5点 写周报」会记下 15:00–17:00 的计划区间。'
    },
    en: {
      title: 'Try quick add: Submit report tomorrow 3pm #Personal !high',
      notes:
        'Type the title above into the top input and press Enter: the date, #project and !priority are recognized as chips below the input.\nChinese syntax works too, e.g. 明天下午3点 交报告 #个人 !高.\nTime ranges work as well: "3点到5点 写周报" records a 15:00–17:00 planned window.'
    },
    dayOffset: null,
    hour: 12,
    project: 'personal',
    priority: 0
  },
  {
    id: 'sample-task-3',
    zh: {
      title: '子任务：把大事拆成小步',
      notes: '打开详情，在「子任务」里添加检查项，逐项打勾；任务行会显示完成进度。',
      subtasks: ['打开详情面板', '添加一条自己的子任务', '勾掉一项，看进度变化']
    },
    en: {
      title: 'Subtasks: break big work into small steps',
      notes:
        'Open the details and add checklist items under Subtasks, then tick them off one by one; the task row shows the progress.',
      subtasks: ['Open the detail panel', 'Add a subtask of your own', 'Tick one off and watch the progress']
    },
    dayOffset: 0,
    hour: 18,
    project: 'polaris',
    priority: 2
  },
  {
    id: 'sample-task-4',
    zh: {
      title: '标签：跨项目归类',
      notes:
        '一条任务可以贴多个标签；点侧栏标签就能跨项目筛选。\n在详情的「标签」行输入名字即可新建。',
      subtasks: undefined
    },
    en: {
      title: 'Tags: organize across projects',
      notes:
        'A task can carry several tags; click a tag in the sidebar to filter across projects.\nType a name in the Tags row of the details to create a new one.'
    },
    dayOffset: 1,
    hour: 12,
    project: 'personal',
    priority: 2,
    tags: [
      { zh: '示例', en: 'sample' },
      { zh: '入门', en: 'getting-started' }
    ]
  },
  {
    id: 'sample-task-5',
    zh: {
      title: '每周回顾任务清单',
      notes:
        '这是一条重复任务：勾选完成后自动生成下一次，截止顺延一周。\n子任务和标签也会继承到下一次。'
    },
    en: {
      title: 'Review the task list weekly',
      notes:
        'This is a repeating task: completing it automatically spawns the next occurrence one week later.\nSubtasks and tags carry over to the next one.'
    },
    dayOffset: 0,
    hour: 20,
    recurrenceRule: 'FREQ=WEEKLY',
    project: 'personal',
    priority: 1
  },
  {
    id: 'sample-task-6',
    zh: {
      title: '提醒：到点弹窗不怕忘',
      notes:
        '这条任务设了明天 09:00 的提醒，到点会弹出提醒窗口。\n任何任务都能在详情的「提醒」行设置。'
    },
    en: {
      title: 'Reminders: a popup right on time',
      notes:
        'This task has a reminder set for tomorrow 09:00 — a reminder window will pop up then.\nAny task can get one via the Remind row in the details.'
    },
    dayOffset: 1,
    hour: 9,
    remind: { dayOffset: 1, hour: 9 },
    project: 'personal',
    priority: 0
  },
  {
    id: 'sample-task-7',
    zh: {
      title: '四象限：重要又紧急的排最前',
      notes:
        '打开「四象限」视图看看：重要 = 中/高优先级，紧急 = 今天到期或已逾期。\n这条任务会落在「立即做」象限。'
    },
    en: {
      title: 'Matrix: important & urgent comes first',
      notes:
        'Open the Matrix view: important = medium/high priority, urgent = due today or overdue.\nThis task lands in the "Do now" quadrant.'
    },
    dayOffset: 0,
    hour: 17,
    project: 'polaris',
    priority: 3
  },
  {
    id: 'sample-task-8',
    zh: {
      title: '已完成的任务收在这里',
      notes: '完成区默认折叠成一行计数，点开可以回顾，切换视图后自动收起。'
    },
    en: {
      title: 'Completed tasks fold away here',
      notes:
        'The completed section collapses into a single count row; expand it to review, and it folds back when you switch views.'
    },
    dayOffset: 0,
    hour: 12,
    project: 'personal',
    priority: 0,
    completed: true
  },
  {
    id: 'sample-task-9',
    zh: {
      title: '时间段：在日历时间轴上看块',
      notes:
        '这条任务设了今天 10:00–11:30 的计划时间段：切到日历的「周 / 日」视图，它会摆成带项目色的块。\n空白处拖拽即创建、拖块移动、拖下缘改时长；详情的「时间」行可精修，全天开关也在那里。'
    },
    en: {
      title: 'Time window: see it as a block on the time grid',
      notes:
        'This task has a planned window today 10:00–11:30: switch to the calendar week/day view and it renders as a project-tinted block.\nDrag empty space to create, drag blocks to move, drag the bottom edge to resize; the detail "Time" row fine-tunes, with the all-day toggle there too.'
    },
    dayOffset: 0,
    hour: 11,
    minute: 30,
    startHour: 10,
    startMinute: 0,
    endHour: 11,
    endMinute: 30,
    project: 'polaris',
    priority: 2
  },
  {
    id: 'sample-task-10',
    zh: {
      title: '全天任务：住在日历顶部的全天行',
      notes:
        '全天任务只看日期、忽略钟点：切到日历「周」视图，它住在顶部全天行；列表里显示「全天」。'
    },
    en: {
      title: 'All-day task: lives in the calendar all-day row',
      notes:
        'All-day tasks look at dates only: in the calendar week view it sits in the all-day row on top; lists show it as "All day".'
    },
    dayOffset: 0,
    hour: 0,
    allDay: true,
    project: 'personal',
    priority: 0
  },
  {
    id: 'sample-task-11',
    zh: {
      title: '跨天全天：外出两天',
      notes:
        '全天任务也能跨多天：明天到后天，日历月格两天都亮、周视图全天行横跨两天。'
    },
    en: {
      title: 'Multi-day all-day: two days away',
      notes:
        'All-day tasks can span days: tomorrow through the day after, lit on both month cells and spanning the all-day row in the week view.'
    },
    dayOffset: 1,
    hour: 0,
    allDay: true,
    endDayOffset: 2,
    project: 'polaris',
    priority: 0
  },
  {
    id: 'sample-task-12',
    zh: {
      title: '在时间轴里拖拽试试',
      notes:
        '这条任务排在后天 14:00–15:00：去日历「周」视图，拖它改时间、拖下缘改时长。'
    },
    en: {
      title: 'Try dragging on the time grid',
      notes:
        'This task sits at 14:00–15:00 the day after tomorrow: in the calendar week view, drag it to reschedule, drag its bottom edge to resize.'
    },
    dayOffset: 2,
    hour: 15,
    startHour: 14,
    startMinute: 0,
    endHour: 15,
    endMinute: 0,
    project: 'personal',
    priority: 1
  },
  {
    id: 'sample-task-13',
    zh: {
      title: '日历信息层：农历、节假日与周数',
      notes:
        '日历工具栏的「显示设置」里可开农历与节气、法定节假日休/班角标和 ISO 周数列；开关即时生效并记住。工具栏还能搜索与按项目/标签筛选。'
    },
    en: {
      title: 'Calendar info layer: lunar dates, holidays and week numbers',
      notes:
        'Open "Display settings" on the calendar toolbar for lunar dates with solar terms, statutory holiday badges (Off/Work) and the ISO week-number column; toggles apply instantly and are remembered. The toolbar also searches and filters by project/tag.'
    },
    dayOffset: null,
    hour: 12,
    project: 'polaris',
    priority: 0
  },
  {
    id: 'sample-task-14',
    zh: {
      title: '打印一份日历',
      notes:
        '日历工具栏的打印机按钮一键打印当前视图：打印前自动切亮色主题（省墨），界面壳自动退场，纸面只留日历本体。'
    },
    en: {
      title: 'Print a calendar',
      notes:
        'The printer button on the calendar toolbar prints the current view: the theme switches to light automatically before printing (ink-friendly), the app shell steps out, and the paper keeps only the calendar itself.'
    },
    dayOffset: null,
    hour: 12,
    project: 'personal',
    priority: 0
  }
]

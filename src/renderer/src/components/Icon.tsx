// 图标适配层：全应用 lucide 图标的唯一入口。组件从这里导入而非直接依赖
// lucide-react，日后换库或统一管控只需改这一处。描边粗细由 globals.css 的
// .lucide 规则统一（--icon-stroke / --icon-stroke-strong），组件侧 strokeWidth
// prop 是 presentation attribute，优先级低于作者 CSS，实际不生效。
export {
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  CornerDownLeft,
  Flag,
  FolderPlus,
  HardDrive,
  ListTodo,
  Minus,
  Moon,
  Pencil,
  Plus,
  Repeat2,
  RotateCcw,
  Search,
  Settings2,
  Sun,
  Trash2,
  TriangleAlert,
  X
} from 'lucide-react'

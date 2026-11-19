// 主进程：托盘、更新气泡、原生文件对话框。
export const main = {
  'tray.open': '打开 Polaris',
  'tray.settings': '设置',
  'tray.checkUpdates': '检查更新',
  'tray.quit': '退出',
  'updater.unsupported': '当前环境不提供在线更新',
  'updater.checking': '正在检查更新，请稍候',
  'updater.available': '发现新版本 v{version}，正在后台下载',
  'updater.downloading': '新版本 v{version} 下载中（{percent}%）',
  'updater.downloaded': '新版本 v{version} 已就绪，重启即可安装',
  'updater.upToDate': '已是最新版本 v{version}',
  'updater.error': '检查更新失败：{error}',
  'updater.unknownError': '未知错误',
  'updater.unknown': '更新状态未知，请稍后再试',
  'updater.notReady': '更新尚未就绪，无法安装',
  'native.exportTitle': '导出备份',
  'native.importTitle': '导入备份',
  'native.csvFilter': 'CSV 文件',
  'native.csvExportTitle': '导出 CSV（Csv 格式）',
  'native.jsonFilter': 'Polaris 备份',
  // 启动灾难恢复与启动失败兜底（主进程原生对话框，locale 可能未就绪，双语并列展示）。
  'native.dbCorruptTitle': '数据库文件损坏，已隔离',
  'native.dbCorruptDetail':
    '原数据库文件已损坏，已改名隔离保留为：\n{path}\n\n应用已从空库启动，原文件未被删除，可供取证或人工恢复。如有备份，可在「设置 → 数据备份」中导入恢复。',
  'native.startupFailedTitle': 'Polaris 启动失败',
  'native.startupFailedDetail': '应用初始化时发生错误，即将退出：\n{error}',
  // 导入文件大小上限（readFile 前的 stat 检查）。
  'native.importTooLarge': '备份文件超过 {limit} MB 上限，已拒绝读取。',
  'native.invalidBackupName': '非法的备份文件名，已拒绝。',

}
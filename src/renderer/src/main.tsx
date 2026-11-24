import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans-sc'
import '@fontsource-variable/manrope'
import '@fontsource-variable/geist-mono'
import App from './App'
import { ReminderView } from './components/ReminderView'
import { SettingsWindow } from './components/settings/SettingsWindow'
import './styles/globals.css'

// 三个渲染入口共用这一份页面：主应用 / 提醒窗（#/reminder/<id>）/
// 设置窗口（#/settings/<分类>）。没有路由库，按 hash 分流。
const reminderMatch = window.location.hash.match(/^#\/?reminder\/(.+)$/)
const reminderTaskId = reminderMatch ? decodeURIComponent(reminderMatch[1]) : null
const isSettings = /^#\/?settings(\/|$)/.test(window.location.hash)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {reminderTaskId ? <ReminderView taskId={reminderTaskId} /> : isSettings ? <SettingsWindow /> : <App />}
  </React.StrictMode>
)

import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans-sc'
import '@fontsource-variable/manrope'
import '@fontsource-variable/geist-mono'
import App from './App'
import { ReminderView } from './components/ReminderView'
import './styles/globals.css'

const reminderMatch = window.location.hash.match(/^#\/?reminder\/(.+)$/)
const reminderTaskId = reminderMatch ? decodeURIComponent(reminderMatch[1]) : null

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {reminderTaskId ? <ReminderView taskId={reminderTaskId} /> : <App />}
  </React.StrictMode>
)
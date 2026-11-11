import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { RealtimeProvider } from './context/RealtimeContext'
import { CallProvider } from './context/CallContext'
import { ActiveChatProvider } from './context/ActiveChatContext'
import { ChatListProvider } from './context/ChatListContext'
import NotificationManager from './components/NotificationManager'
import { applyTheme, getTheme } from './lib/theme'
import './index.css'

applyTheme(getTheme())
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (getTheme() === 'system') applyTheme('system')
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <RealtimeProvider>
          <CallProvider>
            <ActiveChatProvider>
              <ChatListProvider>
                <NotificationManager />
                <App />
              </ChatListProvider>
            </ActiveChatProvider>
          </CallProvider>
        </RealtimeProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)

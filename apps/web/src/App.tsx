// Providers above the router: the chat store (and its open stream) survives navigation, and auth
// is known before any route renders. Routes: /login, / (a new conversation) and /c/:sessionId.
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import ChatPanel from './components/Chat/ChatPanel'
import ChatProvider from './components/Chat/ChatProvider'
import AppShell from './components/Layout/AppShell'
import ProtectedRoute from './components/Layout/ProtectedRoute'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import LoginPage from './pages/LoginPage'

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <ChatProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<ProtectedRoute />}>
                <Route
                  path="/"
                  element={
                    <AppShell>
                      <ChatPanel />
                    </AppShell>
                  }
                />
                <Route
                  path="/c/:sessionId"
                  element={
                    <AppShell>
                      <ChatPanel />
                    </AppShell>
                  }
                />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </ChatProvider>
      </AuthProvider>
    </ToastProvider>
  )
}

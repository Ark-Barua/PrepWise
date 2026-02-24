import { useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import PublicOnlyRoute from './components/PublicOnlyRoute'
import AppShell from './layouts/AppShell'
import { readAppSettings } from './lib/userPreferences'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import PracticePage from './pages/PracticePage'
import QuestionAnswerPage from './pages/QuestionAnswerPage'
import PracticeSessionPage from './pages/PracticeSessionPage'
import ProgressPage from './pages/ProgressPage'
import ProfilePage from './pages/ProfilePage'
import SettingsPage from './pages/SettingsPage'
import BillingPage from './pages/BillingPage'
import MockInterviewPage from './pages/MockInterviewPage'
import NotFoundPage from './pages/NotFoundPage'

function applyInterfaceClasses() {
  const settings = readAppSettings()
  const interfaceSettings = settings.interface || {}

  document.body.classList.toggle('app-compact', Boolean(interfaceSettings.compactMode))
  document.body.classList.toggle('app-reduced-motion', Boolean(interfaceSettings.reducedMotion))
  document.body.classList.toggle('app-dark', Boolean(interfaceSettings.darkMode))
}

function App() {
  useEffect(() => {
    function syncSettingsClasses() {
      applyInterfaceClasses()
    }

    function syncFromStorage(event) {
      if (event.key && event.key !== 'prepwise.app.settings') {
        return
      }
      applyInterfaceClasses()
    }

    applyInterfaceClasses()
    window.addEventListener('storage', syncFromStorage)
    window.addEventListener('prepwise:settings-updated', syncSettingsClasses)

    return () => {
      window.removeEventListener('storage', syncFromStorage)
      window.removeEventListener('prepwise:settings-updated', syncSettingsClasses)
    }
  }, [])

  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        }
      />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="practice" element={<PracticePage />} />
          <Route path="practice/sessions/:sessionId" element={<PracticeSessionPage />} />
          <Route path="practice/questions/:questionId" element={<QuestionAnswerPage />} />
          <Route path="progress" element={<ProgressPage />} />
          <Route path="mock-interview" element={<MockInterviewPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}

export default App

import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  FiAlertTriangle,
  FiBell,
  FiCreditCard,
  FiDownload,
  FiKey,
  FiLock,
  FiMoon,
  FiRefreshCcw,
  FiSave,
  FiSettings,
  FiSliders,
  FiSun,
  FiTarget,
  FiTrash2,
  FiZap,
} from 'react-icons/fi'
import useAuth from '../auth/useAuth'
import NebulaLoader from '../components/NebulaLoader'
import {
  createBillingCheckoutSession,
  createBillingPortalSession,
  deleteUserAccount,
  fetchQuestions,
} from '../lib/api'
import { readAppSettings, resetAppSettings, saveAppSettings } from '../lib/userPreferences'

function toPercent(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return 0
  }
  return Math.max(0, Math.min(100, numeric))
}

function getPlanLimits(planTier) {
  if (planTier === 'pro') {
    return {
      attemptsPerMonth: 600,
      practiceSessionsPerMonth: 120,
      maxQuestionsPerSession: 50,
    }
  }

  return {
    attemptsPerMonth: 40,
    practiceSessionsPerMonth: 8,
    maxQuestionsPerSession: 10,
  }
}

function getLocalBillingSummary(user) {
  const planTier = String(user?.planTier || 'free').trim().toLowerCase() === 'pro' ? 'pro' : 'free'
  const limits = getPlanLimits(planTier)

  return {
    user: {
      id: user?.email || '',
      email: user?.email || '',
      name: user?.name || 'Learner',
      planTier,
      billingStatus:
        user?.billingStatus || (planTier === 'pro' ? 'active' : 'inactive'),
    },
    plan: {
      id: planTier,
      name: planTier === 'pro' ? 'Pro' : 'Free',
      limits,
    },
    usage: {
      attemptsUsed: 0,
      practiceSessionsUsed: 0,
    },
    usagePercent: {
      attempts: 0,
      practiceSessions: 0,
    },
  }
}

function SettingsPage() {
  const { user, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [summary, setSummary] = useState(() => getLocalBillingSummary(user))
  const [generationMeta, setGenerationMeta] = useState(null)
  const [availableCategories, setAvailableCategories] = useState([])
  const [settings, setSettings] = useState(() => readAppSettings())
  const [isDirty, setIsDirty] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isUpgrading, setIsUpgrading] = useState(false)
  const [isOpeningPortal, setIsOpeningPortal] = useState(false)
  const [isDeletePanelOpen, setIsDeletePanelOpen] = useState(false)
  const [deleteConfirmationValue, setDeleteConfirmationValue] = useState('')
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [infoMessage, setInfoMessage] = useState('')

  useEffect(() => {
    let isCancelled = false

    async function loadSettings() {
      setIsLoading(true)
      setErrorMessage('')

      setSummary(getLocalBillingSummary(user))

      const [questionsResponse] = await Promise.allSettled([fetchQuestions({})])

      if (isCancelled) {
        return
      }

      let nextError = ''

      if (questionsResponse.status === 'fulfilled') {
        setGenerationMeta(questionsResponse.value?.meta?.generation || null)
        const categories = questionsResponse.value?.meta?.filters?.categories || []
        setAvailableCategories(Array.isArray(categories) ? categories : [])
      } else {
        setGenerationMeta(null)
        setAvailableCategories([])
        nextError = nextError
          ? `${nextError} Question metadata is unavailable.`
          : 'Question metadata is unavailable.'
      }

      setErrorMessage(nextError)
      setIsLoading(false)
    }

    void loadSettings()

    return () => {
      isCancelled = true
    }
  }, [user])

  useEffect(() => {
    const checkoutStatus = new URLSearchParams(location.search).get('checkout')
    if (checkoutStatus === 'success') {
      setInfoMessage(
        'Checkout completed. Billing status will refresh once webhook confirmation is processed.',
      )
    } else if (checkoutStatus === 'cancel') {
      setInfoMessage('Checkout canceled. You can retry upgrade any time.')
    }
  }, [location.search])

  useEffect(() => {
    document.body.classList.toggle('app-compact', settings.interface.compactMode)
    document.body.classList.toggle('app-reduced-motion', settings.interface.reducedMotion)
    document.body.classList.toggle('app-dark', settings.interface.darkMode)

    return () => {
      const persisted = readAppSettings()
      document.body.classList.toggle('app-compact', persisted.interface.compactMode)
      document.body.classList.toggle('app-reduced-motion', persisted.interface.reducedMotion)
      document.body.classList.toggle('app-dark', persisted.interface.darkMode)
    }
  }, [
    settings.interface.compactMode,
    settings.interface.darkMode,
    settings.interface.reducedMotion,
  ])

  async function handleUpgrade() {
    setErrorMessage('')
    setInfoMessage('')
    setIsUpgrading(true)
    try {
      const response = await createBillingCheckoutSession({
        userId: user.email,
        planTier: 'pro',
      })
      const url = response?.data?.url
      if (!url) {
        throw new Error('Checkout URL is unavailable.')
      }
      window.location.assign(url)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to start upgrade flow.',
      )
      setIsUpgrading(false)
    }
  }

  async function handleOpenPortal() {
    setErrorMessage('')
    setInfoMessage('')
    setIsOpeningPortal(true)

    try {
      const response = await createBillingPortalSession({
        userId: user.email,
      })
      const url = response?.data?.url
      if (!url) {
        throw new Error('Billing portal URL is unavailable.')
      }
      window.location.assign(url)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to open billing portal.',
      )
    } finally {
      setIsOpeningPortal(false)
    }
  }

  function toggleSetting(section, key) {
    setSettings((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [key]: !current[section][key],
      },
    }))
    setIsDirty(true)
    setInfoMessage('')
  }

  function updateSetting(section, key, value) {
    setSettings((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [key]: value,
      },
    }))
    setIsDirty(true)
    setInfoMessage('')
  }

  function saveWorkspaceSettings() {
    const normalized = saveAppSettings(settings)
    setSettings(normalized)
    setIsDirty(false)
    setInfoMessage('Workspace settings saved.')
  }

  function resetWorkspaceSettings() {
    const defaults = resetAppSettings()
    setSettings(defaults)
    setIsDirty(false)
    setInfoMessage('Settings reset to default values.')
  }

  function exportWorkspaceSettings() {
    const blob = new Blob([JSON.stringify(settings, null, 2)], {
      type: 'application/json',
    })
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'prepwise-settings.json'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.URL.revokeObjectURL(url)
    setInfoMessage('Settings exported as prepwise-settings.json.')
  }

  async function handleDeleteAccount() {
    const expectedValue = String(user?.email || '').trim().toLowerCase()
    const normalizedConfirmation = deleteConfirmationValue.trim().toLowerCase()

    if (!expectedValue) {
      setErrorMessage('Unable to resolve account email for deletion.')
      return
    }

    if (normalizedConfirmation !== expectedValue) {
      setErrorMessage('Type your exact account email to confirm deletion.')
      return
    }

    setErrorMessage('')
    setInfoMessage('')
    setIsDeletingAccount(true)

    try {
      await deleteUserAccount(user.email)
      await signOut()
      navigate('/login', { replace: true })
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to delete account right now.',
      )
      setIsDeletingAccount(false)
    }
  }

  const attemptsUsed = summary?.usage?.attemptsUsed || 0
  const attemptsLimit = summary?.plan?.limits?.attemptsPerMonth ?? null
  const sessionsUsed = summary?.usage?.practiceSessionsUsed || 0
  const sessionsLimit = summary?.plan?.limits?.practiceSessionsPerMonth ?? null
  const categoryOptions = useMemo(
    () => ['all', ...availableCategories],
    [availableCategories],
  )

  return (
    <section className="page page--experience page--settings">
      <div className="experience-hero experience-hero--settings">
        <div className="experience-hero__content">
          <p className="experience-hero__eyebrow">Control Center</p>
          <h2 className="experience-hero__title">Settings Command</h2>
          <p className="experience-hero__description">
            Configure your workspace behavior, default practice strategy, automation, and billing posture from one screen.
          </p>
          <div className="experience-hero__actions">
            <button
              type="button"
              className="shell__button shell__button--primary"
              onClick={saveWorkspaceSettings}
              disabled={!isDirty}
            >
              <FiSave size={14} /> Save changes
            </button>
            <button type="button" className="shell__button" onClick={resetWorkspaceSettings}>
              <FiRefreshCcw size={14} /> Reset defaults
            </button>
          </div>
        </div>
        <div className="experience-hero__snapshot">
          <article className="hero-pill">
            <p>Current Plan</p>
            <strong>{summary?.plan?.name || 'Free'}</strong>
          </article>
          <article className="hero-pill">
            <p>Generator</p>
            <strong>{generationMeta?.provider || 'template'}</strong>
          </article>
          <article className="hero-pill">
            <p>Unsaved Changes</p>
            <strong>{isDirty ? 'Yes' : 'No'}</strong>
          </article>
        </div>
        <span className="experience-hero__flare experience-hero__flare--one" />
        <span className="experience-hero__flare experience-hero__flare--two" />
      </div>

      {isLoading ? <NebulaLoader label="Loading settings..." /> : null}
      {errorMessage ? <p className="auth-error">{errorMessage}</p> : null}
      {infoMessage ? <p className="billing-message">{infoMessage}</p> : null}

      {!isLoading ? (
        <div className="settings-workspace-grid">
          <article className="card card--elevated settings-card">
            <p className="card__value">
              <FiSliders size={15} /> Experience and Interface
            </p>

            <div className="settings-toggles">
              <button
                type="button"
                className={settings.interface.compactMode ? 'settings-toggle settings-toggle--on' : 'settings-toggle'}
                onClick={() => toggleSetting('interface', 'compactMode')}
              >
                <span>
                  <FiSettings size={14} /> Compact card spacing
                </span>
                <strong>{settings.interface.compactMode ? 'On' : 'Off'}</strong>
              </button>
              <button
                type="button"
                className={settings.interface.reducedMotion ? 'settings-toggle settings-toggle--on' : 'settings-toggle'}
                onClick={() => toggleSetting('interface', 'reducedMotion')}
              >
                <span>
                  <FiZap size={14} /> Reduced animations
                </span>
                <strong>{settings.interface.reducedMotion ? 'On' : 'Off'}</strong>
              </button>
              <button
                type="button"
                className={settings.interface.darkMode ? 'settings-toggle settings-toggle--on' : 'settings-toggle'}
                onClick={() => toggleSetting('interface', 'darkMode')}
              >
                <span>
                  {settings.interface.darkMode ? <FiMoon size={14} /> : <FiSun size={14} />}
                  Dark mode
                </span>
                <strong>{settings.interface.darkMode ? 'On' : 'Off'}</strong>
              </button>
            </div>

            <label className="form-field">
              Default landing page after login
              <select
                value={settings.interface.startPage}
                onChange={(event) => updateSetting('interface', 'startPage', event.target.value)}
              >
                <option value="/">Overview</option>
                <option value="/practice">Practice</option>
                <option value="/progress">Progress</option>
                <option value="/mock-interview">Mock interview</option>
              </select>
            </label>
          </article>

          <article className="card card--elevated settings-card">
            <p className="card__value">
              <FiTarget size={15} /> Practice Defaults
            </p>
            <p className="card__label">
              These defaults preload your Practice page so session setup is faster.
            </p>

            <label className="form-field">
              Default category
              <select
                value={settings.practiceDefaults.category}
                onChange={(event) => updateSetting('practiceDefaults', 'category', event.target.value)}
              >
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category === 'all' ? 'All categories' : category}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field">
              Default difficulty
              <select
                value={settings.practiceDefaults.difficulty}
                onChange={(event) => updateSetting('practiceDefaults', 'difficulty', event.target.value)}
              >
                <option value="all">All levels</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </label>

            <div className="settings-inline-grid">
              <label className="form-field">
                Session questions
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={settings.practiceDefaults.sessionQuestionCount}
                  onChange={(event) =>
                    updateSetting('practiceDefaults', 'sessionQuestionCount', event.target.value)
                  }
                />
              </label>
              <label className="form-field">
                Generator batch
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={settings.practiceDefaults.generateCount}
                  onChange={(event) =>
                    updateSetting('practiceDefaults', 'generateCount', event.target.value)
                  }
                />
              </label>
            </div>
          </article>

          <article className="card card--elevated settings-card">
            <p className="card__value">
              <FiBell size={15} /> Notification Automation
            </p>
            <div className="settings-toggles">
              <button
                type="button"
                className={settings.notifications.reminders ? 'settings-toggle settings-toggle--on' : 'settings-toggle'}
                onClick={() => toggleSetting('notifications', 'reminders')}
              >
                <span>
                  <FiBell size={14} /> Daily practice reminder
                </span>
                <strong>{settings.notifications.reminders ? 'On' : 'Off'}</strong>
              </button>
              <button
                type="button"
                className={settings.notifications.weeklyDigest ? 'settings-toggle settings-toggle--on' : 'settings-toggle'}
                onClick={() => toggleSetting('notifications', 'weeklyDigest')}
              >
                <span>
                  <FiRefreshCcw size={14} /> Weekly progress digest
                </span>
                <strong>{settings.notifications.weeklyDigest ? 'On' : 'Off'}</strong>
              </button>
              <button
                type="button"
                className={settings.notifications.streakAlerts ? 'settings-toggle settings-toggle--on' : 'settings-toggle'}
                onClick={() => toggleSetting('notifications', 'streakAlerts')}
              >
                <span>
                  <FiZap size={14} /> Streak risk alerts
                </span>
                <strong>{settings.notifications.streakAlerts ? 'On' : 'Off'}</strong>
              </button>
            </div>
          </article>

          <article className="card card--elevated settings-card">
            <p className="card__value">
              <FiCreditCard size={15} /> Billing
            </p>
            <p className="card__label">
              Plan: {summary?.plan?.name || 'Free'} | Status:{' '}
              {summary?.user?.billingStatus || 'inactive'}
            </p>

            <div className="quota-meter" aria-hidden="true">
              <span
                className="quota-meter__fill"
                style={{ width: `${toPercent(summary?.usagePercent?.attempts)}%` }}
              />
            </div>
            <p className="card__label">
              Attempts used: {attemptsUsed}/{attemptsLimit ?? 'unlimited'}
            </p>

            <div className="quota-meter" aria-hidden="true">
              <span
                className="quota-meter__fill"
                style={{ width: `${toPercent(summary?.usagePercent?.practiceSessions)}%` }}
              />
            </div>
            <p className="card__label">
              Sessions used: {sessionsUsed}/{sessionsLimit ?? 'unlimited'}
            </p>

            <div className="answer-form__actions">
              <button
                type="button"
                className="shell__button shell__button--primary"
                onClick={handleUpgrade}
                disabled={isUpgrading || summary?.user?.planTier === 'pro'}
              >
                {summary?.user?.planTier === 'pro'
                  ? 'Already on Pro'
                  : isUpgrading
                    ? 'Redirecting...'
                    : 'Upgrade to Pro'}
              </button>
              <button
                type="button"
                className="shell__button"
                onClick={handleOpenPortal}
                disabled={isOpeningPortal}
              >
                {isOpeningPortal ? 'Opening...' : 'Manage billing'}
              </button>
              <Link to="/billing" className="shell__button">
                Full billing page
              </Link>
            </div>
          </article>

          <article className="card card--elevated settings-card">
            <p className="card__value">
              <FiLock size={15} /> Data and Security
            </p>
            <p className="card__label">Signed in as: {user?.email}</p>
            <div className="settings-keyline">
              <FiKey size={13} />
              <span>Credentials are verified server-side during sign in.</span>
            </div>
            <div className="settings-keyline">
              <FiSettings size={13} />
              <span>Billing status sync is handled by webhook updates.</span>
            </div>

            <div className="answer-form__actions">
              <button type="button" className="shell__button" onClick={exportWorkspaceSettings}>
                <FiDownload size={14} /> Export settings
              </button>
              <button type="button" className="shell__button" onClick={resetWorkspaceSettings}>
                <FiTrash2 size={14} /> Reset local settings
              </button>
            </div>
          </article>

          <article className="card card--elevated settings-card settings-danger-card">
            <div className="settings-danger-zone">
              <p className="settings-danger-zone__title">
                <FiAlertTriangle size={14} /> Danger zone
              </p>
              <p className="card__label">
                Deleting your account permanently removes profile, attempts, sessions, and
                mock-interview history.
              </p>

              {!isDeletePanelOpen ? (
                <button
                  type="button"
                  className="shell__button settings-danger-zone__trigger"
                  onClick={() => {
                    setIsDeletePanelOpen(true)
                    setDeleteConfirmationValue('')
                    setInfoMessage('')
                  }}
                >
                  <FiTrash2 size={14} /> Delete account
                </button>
              ) : (
                <div className="settings-danger-zone__panel">
                  <label className="form-field">
                    Type your account email to confirm
                    <input
                      type="text"
                      value={deleteConfirmationValue}
                      onChange={(event) => setDeleteConfirmationValue(event.target.value)}
                      placeholder={user?.email || 'email@domain.com'}
                    />
                  </label>
                  <div className="settings-danger-zone__actions">
                    <button
                      type="button"
                      className="shell__button settings-danger-zone__delete"
                      onClick={handleDeleteAccount}
                      disabled={isDeletingAccount}
                    >
                      <FiTrash2 size={14} />
                      {isDeletingAccount ? 'Deleting account...' : 'Permanently delete'}
                    </button>
                    <button
                      type="button"
                      className="shell__button"
                      onClick={() => {
                        setIsDeletePanelOpen(false)
                        setDeleteConfirmationValue('')
                      }}
                      disabled={isDeletingAccount}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </article>
        </div>
      ) : null}
    </section>
  )
}

export default SettingsPage

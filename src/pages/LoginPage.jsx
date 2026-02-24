import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import useAuth from '../auth/useAuth'
import { readAppSettings } from '../lib/userPreferences'

const spotlightLines = [
  'Adaptive prep flow for interview readiness.',
  'Track your performance with actionable feedback.',
  'Build momentum with streak-aware practice.',
]

function evaluatePasswordStrength(password) {
  const value = String(password || '')
  let score = 0

  if (value.length >= 8) {
    score += 1
  }
  if (/[A-Z]/.test(value)) {
    score += 1
  }
  if (/[0-9]/.test(value)) {
    score += 1
  }
  if (/[^A-Za-z0-9]/.test(value)) {
    score += 1
  }

  if (score <= 1) {
    return { score, label: 'Weak' }
  }
  if (score <= 3) {
    return { score, label: 'Moderate' }
  }
  return { score, label: 'Strong' }
}

function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signIn, signUp, isBusy } = useAuth()
  const [mode, setMode] = useState('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [lineIndex, setLineIndex] = useState(0)

  const preferredStartPage = useMemo(
    () => readAppSettings().interface.startPage || '/',
    [],
  )
  const redirectPath = location.state?.from?.pathname || preferredStartPage
  const passwordStrength = useMemo(
    () => evaluatePasswordStrength(password),
    [password],
  )

  useEffect(() => {
    const intervalId = setInterval(() => {
      setLineIndex((current) => (current + 1) % spotlightLines.length)
    }, 3200)

    return () => {
      clearInterval(intervalId)
    }
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    setErrorMessage('')

    try {
      if (mode === 'signup') {
        const normalizedName = name.trim()
        if (normalizedName.length < 2) {
          throw new Error('Please enter your full name.')
        }
        if (password.length < 8) {
          throw new Error('Password must be at least 8 characters long.')
        }
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.')
        }

        await signUp({
          email,
          name: normalizedName,
          password,
        })
      } else {
        await signIn({ email, password })
      }

      navigate(redirectPath, { replace: true })
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to authenticate right now.',
      )
    }
  }

  return (
    <section className="auth-page">
      <div className="auth-layout">
        <aside className="auth-showcase">
          <p className="auth-showcase__eyebrow">PrepWise Auth Studio</p>
          <h1 className="auth-showcase__title">Sign in and keep your prep streak alive.</h1>
          <p className="auth-showcase__subtitle">{spotlightLines[lineIndex]}</p>
          <div className="auth-showcase__chips">
            <span className="chip">Secure SQLite accounts</span>
            <span className="chip chip--subtle">Realtime progress signals</span>
            <span className="chip chip--subtle">Rule-based answer insights</span>
          </div>
          <div className="auth-kpi-grid">
            <article className="auth-kpi">
              <p className="auth-kpi__label">Flow</p>
              <p className="auth-kpi__value">Unified</p>
            </article>
            <article className="auth-kpi">
              <p className="auth-kpi__label">Security</p>
              <p className="auth-kpi__value">Hashed</p>
            </article>
            <article className="auth-kpi">
              <p className="auth-kpi__label">Experience</p>
              <p className="auth-kpi__value">Animated</p>
            </article>
          </div>
          <div className="auth-showcase__orb auth-showcase__orb--one" />
          <div className="auth-showcase__orb auth-showcase__orb--two" />
        </aside>

        <article className="auth-card auth-card--vibrant">
          <div className="auth-tabs">
            <button
              type="button"
              className={mode === 'signin' ? 'auth-tab auth-tab--active' : 'auth-tab'}
              onClick={() => {
                setMode('signin')
                setErrorMessage('')
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              className={mode === 'signup' ? 'auth-tab auth-tab--active' : 'auth-tab'}
              onClick={() => {
                setMode('signup')
                setErrorMessage('')
              }}
            >
              Sign up
            </button>
          </div>

          <p className="shell__eyebrow">Secure access</p>
          <h2 className="page__title">
            {mode === 'signup' ? 'Create your PrepWise account' : 'Welcome back'}
          </h2>
          <p className="page__description">
            {mode === 'signup'
              ? 'One account unlocks practice tracking, score analytics, and streak monitoring.'
              : 'Use your account to resume practice exactly where you left off.'}
          </p>

          <form className="auth-form" onSubmit={handleSubmit}>
            {mode === 'signup' ? (
              <label className="form-field" htmlFor="name">
                Full name
                <input
                  id="name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Alex Morgan"
                  required
                />
              </label>
            ) : null}

            <label className="form-field" htmlFor="email">
              Email
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>

            <label className="form-field" htmlFor="password">
              Password
              <div className="password-input">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={
                    mode === 'signup' ? 'new-password' : 'current-password'
                  }
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter password"
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>

            {mode === 'signup' ? (
              <>
                <label className="form-field" htmlFor="confirmPassword">
                  Confirm password
                  <div className="password-input">
                    <input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Re-enter password"
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowConfirmPassword((current) => !current)}
                    >
                      {showConfirmPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </label>
                <div className="strength-meter">
                  <div
                    className="strength-meter__bar"
                    style={{ width: `${Math.max(8, passwordStrength.score * 25)}%` }}
                  />
                </div>
                <p className="card__label">Password strength: {passwordStrength.label}</p>
              </>
            ) : null}

            {errorMessage ? <p className="auth-error">{errorMessage}</p> : null}

            <button
              className="shell__button shell__button--primary auth-submit"
              disabled={isBusy}
              type="submit"
            >
              {isBusy
                ? mode === 'signup'
                  ? 'Creating account...'
                  : 'Signing in...'
                : mode === 'signup'
                  ? 'Create account'
                  : 'Sign in'}
            </button>
          </form>
        </article>
      </div>
    </section>
  )
}

export default LoginPage

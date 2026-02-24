import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FiActivity,
  FiAward,
  FiCamera,
  FiClock,
  FiCode,
  FiEdit3,
  FiFileText,
  FiLock,
  FiMail,
  FiSave,
  FiShield,
  FiStar,
  FiTarget,
  FiTrash2,
  FiTrendingUp,
  FiUpload,
  FiUser,
} from 'react-icons/fi'
import useAuth from '../auth/useAuth'
import NebulaLoader from '../components/NebulaLoader'
import { ensureUserProfile, fetchAttemptSummary } from '../lib/api'
import { readProfilePreferences, saveProfilePreferences } from '../lib/userPreferences'

const EMPTY_SUMMARY = {
  totalAttempts: 0,
  averageScore: 0,
  bestScore: 0,
  totalTimeSeconds: 0,
  categoryPerformance: [],
  activityByDay: [],
  streak: {
    currentDays: 0,
    longestDays: 0,
    activeDays: 0,
    lastActiveDate: null,
    status: 'inactive',
  },
}

const EXPERIENCE_LEVEL_OPTIONS = [
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid-level' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead / Staff' },
]

const TIMEZONE_OPTIONS = [
  'UTC-08:00',
  'UTC-07:00',
  'UTC-06:00',
  'UTC-05:00',
  'UTC',
  'UTC+01:00',
  'UTC+05:30',
]

const COMPLIANCE_DOCUMENTS = [
  {
    id: 'terms',
    title: 'Terms and Conditions',
    intro:
      'By using PrepWise, you agree to use the platform for lawful interview preparation and not for misuse, abuse, or disruption.',
    points: [
      'Use the service for personal or professional prep activities.',
      'Do not attempt to reverse engineer, attack, or overload the platform.',
      'Generated feedback is advisory and should be validated with real interview practice.',
      'Plan limits and account policies are applied according to your active tier.',
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy and Data Usage',
    intro:
      'PrepWise stores account profile data and attempt history to power analytics, progress tracking, and personalized recommendations.',
    points: [
      'Core account data includes name, email, and optional profile avatar.',
      'Practice attempts, scores, and session history are used for reporting features.',
      'Your data is not sold for advertising purposes within this application.',
      'You can request deletion by using the account deletion flow in Settings.',
    ],
  },
  {
    id: 'security',
    title: 'Security Practices',
    intro:
      'The platform uses basic security controls for credentials, account access, and data integrity.',
    points: [
      'User passwords are hashed before storage.',
      'API writes are validated server-side before persistence.',
      'Destructive operations require explicit user confirmation.',
      'Security-sensitive changes are reviewed and logged in version updates.',
    ],
  },
  {
    id: 'retention',
    title: 'Data Retention and Deletion',
    intro:
      'Account deletion is permanent and removes linked records such as attempts, sessions, and related analytics.',
    points: [
      'Deleted accounts cannot be recovered from the application UI.',
      'Deletion cascades through dependent practice records in the database.',
      'Local settings in browser storage may remain until cleared by the user.',
      'Export important settings before deletion if needed.',
    ],
  },
]

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0)
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

function toStreakStatus(streak) {
  const status = streak?.status
  if (status === 'active') {
    return 'Active today'
  }
  if (status === 'at-risk') {
    return 'At risk today'
  }
  if (status === 'broken') {
    return 'Restart available'
  }
  return 'No streak yet'
}

function calculateProfileCompletion(profileForm) {
  const checkpoints = [
    Boolean(profileForm.displayName?.trim()),
    Boolean(profileForm.targetRole?.trim()),
    Boolean(profileForm.primaryStack?.trim()),
    Boolean(profileForm.bio?.trim()),
  ]
  const completed = checkpoints.filter(Boolean).length
  return Math.round((completed / checkpoints.length) * 100)
}

function toUserInitials(name, email) {
  const source = String(name || email || 'PW').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Unable to read file.'))
    reader.readAsDataURL(file)
  })
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unable to process image.'))
    image.src = url
  })
}

async function normalizeAvatarImage(file) {
  const rawDataUrl = await readFileAsDataUrl(file)
  const image = await loadImage(rawDataUrl)
  const canvas = document.createElement('canvas')
  const targetSize = 256
  canvas.width = targetSize
  canvas.height = targetSize

  const context = canvas.getContext('2d')
  if (!context) {
    return rawDataUrl
  }

  const sourceSize = Math.min(image.width, image.height)
  const sourceX = Math.floor((image.width - sourceSize) / 2)
  const sourceY = Math.floor((image.height - sourceSize) / 2)
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    targetSize,
    targetSize,
  )

  return canvas.toDataURL('image/jpeg', 0.86)
}

function ProfilePage() {
  const { user, updateUserProfile } = useAuth()
  const initialProfile = useMemo(() => {
    const stored = readProfilePreferences()
    return {
      ...stored,
      displayName: stored.displayName || user?.name || '',
      avatarUrl: user?.avatarUrl || stored.avatarUrl || '',
    }
  }, [user?.avatarUrl, user?.name])

  const [summary, setSummary] = useState(EMPTY_SUMMARY)
  const [profileForm, setProfileForm] = useState(initialProfile)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [avatarMessage, setAvatarMessage] = useState('')
  const avatarInputRef = useRef(null)

  useEffect(() => {
    setProfileForm((current) => ({
      ...current,
      displayName: current.displayName || user?.name || '',
      avatarUrl: current.avatarUrl || user?.avatarUrl || '',
    }))
  }, [user?.avatarUrl, user?.name])

  useEffect(() => {
    let isCancelled = false

    async function loadProfile() {
      setIsLoading(true)
      setErrorMessage('')

      const [summaryResponse] = await Promise.allSettled([
        fetchAttemptSummary(user.email),
      ])

      if (isCancelled) {
        return
      }

      let nextError = ''

      if (summaryResponse.status === 'fulfilled') {
        setSummary({
          ...EMPTY_SUMMARY,
          ...(summaryResponse.value?.data || {}),
        })
      } else {
        setSummary(EMPTY_SUMMARY)
        nextError = 'Analytics are partially unavailable right now.'
      }

      setErrorMessage(nextError)
      setIsLoading(false)
    }

    void loadProfile()

    return () => {
      isCancelled = true
    }
  }, [user.email])

  const billing = useMemo(() => {
    const tier = String(user?.planTier || 'free').trim().toLowerCase()
    const planName = tier === 'pro' ? 'Pro' : 'Free'
    return {
      plan: {
        name: planName,
      },
      user: {
        planTier: tier,
        billingStatus: user?.billingStatus || (tier === 'pro' ? 'active' : 'inactive'),
      },
    }
  }, [user?.billingStatus, user?.planTier])

  function updateProfileField(key, value) {
    setProfileForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function resetProfileForm() {
    const resetValue = {
      ...readProfilePreferences(),
      displayName: user?.name || '',
      avatarUrl: user?.avatarUrl || '',
    }
    setProfileForm(resetValue)
    setSaveMessage('')
    setAvatarMessage('')
  }

  async function handleAvatarFileChange(event) {
    setErrorMessage('')
    setAvatarMessage('')
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      setErrorMessage('Please select an image file.')
      return
    }

    if (file.size > 4 * 1024 * 1024) {
      setErrorMessage('Profile picture must be under 4MB.')
      return
    }

    try {
      const dataUrl = await normalizeAvatarImage(file)
      setProfileForm((current) => ({
        ...current,
        avatarUrl: dataUrl,
      }))
      setAvatarMessage('Picture updated locally. Save profile to sync.')
    } catch {
      setErrorMessage('Unable to process selected image.')
    }
  }

  function handleRemoveAvatar() {
    setProfileForm((current) => ({
      ...current,
      avatarUrl: '',
    }))
    if (avatarInputRef.current) {
      avatarInputRef.current.value = ''
    }
    setAvatarMessage('Profile picture removed locally. Save profile to sync.')
  }

  async function handleSaveProfile(event) {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage('')
    setSaveMessage('')

    const nextProfile = {
      displayName: String(profileForm.displayName || '').trim(),
      avatarUrl: String(profileForm.avatarUrl || '').trim(),
      targetRole: String(profileForm.targetRole || '').trim(),
      experienceLevel: String(profileForm.experienceLevel || 'mid').trim().toLowerCase(),
      primaryStack: String(profileForm.primaryStack || '').trim(),
      timezone: String(profileForm.timezone || 'UTC-05:00').trim(),
      bio: String(profileForm.bio || '').trim(),
    }

    if (!nextProfile.displayName) {
      setErrorMessage('Display name is required.')
      setIsSaving(false)
      return
    }

    saveProfilePreferences(nextProfile)
    setProfileForm(nextProfile)
    updateUserProfile({
      name: nextProfile.displayName,
      avatarUrl: nextProfile.avatarUrl || null,
    })

    try {
      await ensureUserProfile({
        email: user.email,
        name: nextProfile.displayName,
        avatarUrl: nextProfile.avatarUrl || null,
      })
      setSaveMessage('Profile changes saved and synced.')
    } catch {
      setSaveMessage('Profile saved locally. API sync is currently unavailable.')
    } finally {
      setIsSaving(false)
    }
  }

  const profileCompletion = calculateProfileCompletion(profileForm)

  const statCards = [
    {
      label: 'Total Attempts',
      value: summary?.totalAttempts || 0,
      hint: 'All-time submissions',
      icon: FiActivity,
    },
    {
      label: 'Average Score',
      value: summary?.averageScore || 0,
      hint: `Best score ${summary?.bestScore || 0}`,
      icon: FiTrendingUp,
    },
    {
      label: 'Practice Time',
      value: formatDuration(summary?.totalTimeSeconds || 0),
      hint: 'Focused practice duration',
      icon: FiClock,
    },
    {
      label: 'Current Streak',
      value: `${summary?.streak?.currentDays || 0} days`,
      hint: toStreakStatus(summary?.streak),
      icon: FiStar,
    },
  ]
  const avatarInitials = toUserInitials(profileForm.displayName, user?.email)

  return (
    <section className="page page--experience page--profile">
      <div className="experience-hero experience-hero--profile">
        <div className="experience-hero__content">
          <p className="experience-hero__eyebrow">Professional Identity</p>
          <h2 className="experience-hero__title">Profile Workspace</h2>
          <p className="experience-hero__description">
            Define your interview target, maintain a polished identity, and review legal/security policies in one workspace.
          </p>
          <div className="experience-hero__actions">
            <Link className="shell__button shell__button--primary" to="/practice">
              Continue practice
            </Link>
            <Link className="shell__button" to="/settings">
              Open settings
            </Link>
          </div>
        </div>
        <div className="experience-hero__snapshot">
          <article className="hero-pill">
            <p>Display Name</p>
            <strong>{profileForm.displayName || 'Learner'}</strong>
          </article>
          <article className="hero-pill">
            <p>Plan</p>
            <strong>{billing?.plan?.name || 'Free'}</strong>
          </article>
          <article className="hero-pill">
            <p>Profile Completion</p>
            <strong>{profileCompletion}%</strong>
          </article>
        </div>
        <span className="experience-hero__flare experience-hero__flare--one" />
        <span className="experience-hero__flare experience-hero__flare--two" />
      </div>

      {isLoading ? <NebulaLoader label="Loading profile..." /> : null}
      {errorMessage ? <p className="auth-error">{errorMessage}</p> : null}
      {saveMessage ? <p className="billing-message">{saveMessage}</p> : null}

      {!isLoading ? (
        <>
          <div className="profile-metric-grid">
            {statCards.map((card) => {
              const Icon = card.icon
              return (
                <article key={card.label} className="metric-card">
                  <p className="card__label">
                    <Icon size={14} /> {card.label}
                  </p>
                  <p className="metric-card__value">{card.value}</p>
                  <p className="metric-card__hint">{card.hint}</p>
                </article>
              )
            })}
          </div>

          <article className="card card--elevated profile-bio-display">
            <p className="card__value">
              <FiEdit3 size={15} /> Bio Display
            </p>
            <p className="profile-bio-display__text">
              {profileForm.bio?.trim()
                ? profileForm.bio.trim()
                : 'No bio added yet. Add a concise professional summary to personalize your workspace.'}
            </p>
          </article>

          <div className="profile-workspace-grid profile-workspace-grid--aligned">
            <article className="card card--elevated profile-editor-card profile-editor-card--primary">
              <div className="profile-section__head">
                <p className="card__value">
                  <FiEdit3 size={15} /> Professional Profile
                </p>
                <span className="chip chip--subtle">{profileCompletion}% complete</span>
              </div>

              <form className="profile-form" onSubmit={handleSaveProfile}>
                <div className="profile-avatar-editor">
                  <div className="profile-avatar-editor__preview-wrap">
                    <span
                      className={
                        profileForm.avatarUrl
                          ? 'profile-avatar profile-avatar--image'
                          : 'profile-avatar'
                      }
                    >
                      {profileForm.avatarUrl ? (
                        <img src={profileForm.avatarUrl} alt="Profile preview" loading="lazy" />
                      ) : (
                        avatarInitials
                      )}
                    </span>
                    <div>
                      <p className="card__value">
                        <FiCamera size={14} /> Profile Picture
                      </p>
                      <p className="card__label">
                        Upload a square-style image for best results.
                      </p>
                    </div>
                  </div>
                  <div className="profile-avatar-editor__actions">
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="profile-avatar-editor__input"
                      onChange={handleAvatarFileChange}
                    />
                    <button
                      type="button"
                      className="shell__button"
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      <FiUpload size={14} /> Upload image
                    </button>
                    <button
                      type="button"
                      className="shell__button"
                      onClick={handleRemoveAvatar}
                      disabled={!profileForm.avatarUrl}
                    >
                      <FiTrash2 size={14} /> Remove
                    </button>
                  </div>
                  {avatarMessage ? <p className="card__label">{avatarMessage}</p> : null}
                </div>

                <div className="profile-form__grid">
                  <label className="form-field">
                    <FiUser size={13} /> Display name
                    <input
                      type="text"
                      value={profileForm.displayName}
                      onChange={(event) => updateProfileField('displayName', event.target.value)}
                      maxLength={60}
                    />
                  </label>
                  <label className="form-field">
                    <FiMail size={13} /> Account email
                    <input type="text" value={user?.email || ''} disabled />
                  </label>
                  <label className="form-field">
                    <FiTarget size={13} /> Target role
                    <input
                      type="text"
                      value={profileForm.targetRole}
                      onChange={(event) => updateProfileField('targetRole', event.target.value)}
                      placeholder="Frontend Engineer"
                      maxLength={80}
                    />
                  </label>
                  <label className="form-field">
                    <FiAward size={13} /> Experience
                    <select
                      value={profileForm.experienceLevel}
                      onChange={(event) => updateProfileField('experienceLevel', event.target.value)}
                    >
                      {EXPERIENCE_LEVEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    <FiCode size={13} /> Primary stack
                    <input
                      type="text"
                      value={profileForm.primaryStack}
                      onChange={(event) => updateProfileField('primaryStack', event.target.value)}
                      placeholder="React, Node.js, PostgreSQL"
                      maxLength={120}
                    />
                  </label>
                  <label className="form-field">
                    <FiClock size={13} /> Timezone
                    <select
                      value={profileForm.timezone}
                      onChange={(event) => updateProfileField('timezone', event.target.value)}
                    >
                      {TIMEZONE_OPTIONS.map((timezone) => (
                        <option key={timezone} value={timezone}>
                          {timezone}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="form-field">
                  <FiEdit3 size={13} /> Bio
                  <textarea
                    value={profileForm.bio}
                    onChange={(event) => updateProfileField('bio', event.target.value)}
                    placeholder="Summarize your interview focus and the type of roles you are targeting."
                    maxLength={300}
                  />
                </label>

                <div className="profile-form__actions">
                  <button
                    type="submit"
                    className="shell__button shell__button--primary"
                    disabled={isSaving}
                  >
                    <FiSave size={14} /> {isSaving ? 'Saving...' : 'Save profile'}
                  </button>
                  <button type="button" className="shell__button" onClick={resetProfileForm}>
                    Reset
                  </button>
                </div>
              </form>
            </article>

            <article className="card card--elevated profile-docs-card">
              <div className="profile-section__head">
                <p className="card__value">
                  <FiFileText size={15} /> Terms, Security, and Policies
                </p>
                <span className="chip chip--subtle">Reference docs</span>
              </div>
              <p className="card__label">
                Review platform terms, privacy usage, security practices, and data-retention commitments.
              </p>
              <div className="profile-docs-list">
                {COMPLIANCE_DOCUMENTS.map((documentItem, index) => (
                  <details
                    key={documentItem.id}
                    className="profile-doc-item"
                    open={index === 0}
                  >
                    <summary>
                      <span>{documentItem.title}</span>
                    </summary>
                    <p className="card__label">{documentItem.intro}</p>
                    <ul className="profile-doc-item__list">
                      {documentItem.points.map((point) => (
                        <li key={`${documentItem.id}-${point}`}>{point}</li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </article>

            <article className="card card--elevated profile-security-card">
              <p className="card__value">
                <FiShield size={15} /> Account Security Checklist
              </p>
              <p className="card__label">
                Signed in as {user?.email || 'user'} | Plan {billing?.plan?.name || 'Free'}
              </p>
              <ul className="profile-security-list">
                <li>
                  <FiLock size={13} /> Passwords are hashed and verified server-side.
                </li>
                <li>
                  <FiShield size={13} /> Sensitive account changes require explicit confirmation.
                </li>
                <li>
                  <FiTrash2 size={13} /> Permanent account deletion is available in Settings.
                </li>
              </ul>
              <div className="profile-form__actions">
                <Link className="shell__button" to="/settings">
                  Open account controls
                </Link>
              </div>
            </article>
          </div>
        </>
      ) : null}
    </section>
  )
}

export default ProfilePage

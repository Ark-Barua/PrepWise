import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import {
  FiBookOpen,
  FiChevronDown,
  FiHome,
  FiLogOut,
  FiMessageSquare,
  FiSettings,
  FiTrendingUp,
  FiUser,
} from 'react-icons/fi'
import useAuth from '../auth/useAuth'
import logoImage from '../assets/logo.png'
import { readProfilePreferences } from '../lib/userPreferences'

const navItems = [
  { to: '/', label: 'Overview', meta: 'Command', icon: FiHome, end: true },
  { to: '/practice', label: 'Practice', meta: 'Drills', icon: FiBookOpen },
  { to: '/progress', label: 'Progress', meta: 'Metrics', icon: FiTrendingUp },
  { to: '/mock-interview', label: 'Mock AI', meta: 'Studio', icon: FiMessageSquare },
]

function toUserInitials(name, email) {
  const source = String(name || email || 'PW').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

function AppShell() {
  const { user, signOut, isBusy } = useAuth()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [profileBio, setProfileBio] = useState(() =>
    String(readProfilePreferences().bio || '').trim(),
  )
  const accountMenuRef = useRef(null)
  const avatarUrl =
    typeof user?.avatarUrl === 'string' && user.avatarUrl.trim().length > 0
      ? user.avatarUrl.trim()
      : ''

  useEffect(() => {
    function handleOutsidePointerDown(event) {
      if (!accountMenuRef.current) {
        return
      }

      if (!accountMenuRef.current.contains(event.target)) {
        setIsMenuOpen(false)
      }
    }

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setIsMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsidePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleOutsidePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  useEffect(() => {
    function syncProfileBio(event) {
      if (event?.type === 'storage' && event.key && event.key !== 'prepwise.profile.preferences') {
        return
      }
      const nextBio = String(readProfilePreferences().bio || '').trim()
      setProfileBio(nextBio)
    }

    syncProfileBio()
    window.addEventListener('storage', syncProfileBio)
    window.addEventListener('prepwise:profile-updated', syncProfileBio)

    return () => {
      window.removeEventListener('storage', syncProfileBio)
      window.removeEventListener('prepwise:profile-updated', syncProfileBio)
    }
  }, [])

  async function handleSignOut() {
    setIsMenuOpen(false)
    await signOut()
  }

  return (
    <div className="shell">
      <header className="shell__topbar">
        <div className="shell__brand-block">
          <div className="shell__brand-mark" aria-hidden="true">
            <img src={logoImage} alt="" className="shell__brand-logo" loading="lazy" />
          </div>
          <div>
            <p className="shell__eyebrow">Interview Workspace</p>
            <h1 className="shell__brand">PrepWise</h1>
          </div>
        </div>

        <nav className="shell__nav shell__nav--pro" aria-label="Primary">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setIsMenuOpen(false)}
                className={({ isActive }) =>
                  isActive ? 'shell__link shell__link--pro shell__link--active' : 'shell__link shell__link--pro'
                }
              >
                <span className="shell__link-icon" aria-hidden="true">
                  <Icon size={14} />
                </span>
                <span className="shell__link-copy">
                  <span className="shell__link-label">{item.label}</span>
                  <span className="shell__link-meta">{item.meta}</span>
                </span>
              </NavLink>
            )
          })}
        </nav>

        <div className="shell__account" ref={accountMenuRef}>
          <button
            type="button"
            className={isMenuOpen ? 'account-trigger account-trigger--open' : 'account-trigger'}
            onClick={() => setIsMenuOpen((current) => !current)}
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
          >
            <span
              className={
                avatarUrl
                  ? 'account-trigger__avatar account-trigger__avatar--image'
                  : 'account-trigger__avatar'
              }
              aria-hidden="true"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="" loading="lazy" />
              ) : (
                toUserInitials(user?.name, user?.email)
              )}
            </span>
            <span className="account-trigger__label">{user?.name || 'Account'}</span>
            <FiChevronDown size={14} className="account-trigger__caret" />
          </button>

          {isMenuOpen ? (
            <div className="account-menu" role="menu" aria-label="Account">
              <div className="account-menu__head">
                <span
                  className={
                    avatarUrl
                      ? 'account-trigger__avatar account-trigger__avatar--image account-menu__avatar'
                      : 'account-trigger__avatar account-menu__avatar'
                  }
                  aria-hidden="true"
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" loading="lazy" />
                  ) : (
                    toUserInitials(user?.name, user?.email)
                  )}
                </span>
                <div className="account-menu__identity">
                  <p className="account-menu__name">{user?.name || 'Learner'}</p>
                  <p className="account-menu__email">{user?.email || 'No email'}</p>
                  <p className="account-menu__bio">
                    {profileBio || 'Add a short professional bio from your profile page.'}
                  </p>
                </div>
              </div>

              <Link to="/profile" className="account-menu__item" onClick={() => setIsMenuOpen(false)}>
                <FiUser size={14} /> Profile
              </Link>
              <Link to="/settings" className="account-menu__item" onClick={() => setIsMenuOpen(false)}>
                <FiSettings size={14} /> Settings
              </Link>
              <button
                type="button"
                className="account-menu__item account-menu__item--danger"
                onClick={handleSignOut}
                disabled={isBusy}
              >
                <FiLogOut size={14} /> {isBusy ? 'Signing out...' : 'Sign out'}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <main className="shell__main">
        <Outlet />
      </main>

      <footer className="shell__footer">
        Keep momentum with short, focused prep blocks.
      </footer>
    </div>
  )
}

export default AppShell

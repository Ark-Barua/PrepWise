import { useCallback, useMemo, useState } from 'react'
import AuthContext from './auth-context'
import { signInRequest, signUpRequest } from '../lib/api'

const AUTH_STORAGE_KEY = 'prepwise.auth.user'

function readStoredUser() {
  try {
    const value = localStorage.getItem(AUTH_STORAGE_KEY)
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

function writeStoredUser(user) {
  if (!user) {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    return
  }

  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user))
}

function formatNameFromEmail(email) {
  const [rawName = 'Learner'] = email.split('@')
  return rawName
    .replace(/[._-]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser)
  const [isBusy, setIsBusy] = useState(false)

  const signIn = useCallback(async ({ email, password }) => {
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedPassword = String(password || '')

    if (!normalizedEmail || !normalizedPassword) {
      throw new Error('Email and password are required.')
    }

    setIsBusy(true)
    try {
      const response = await signInRequest({
        email: normalizedEmail,
        password: normalizedPassword,
      })
      const nextUser = response?.data || {
        id: normalizedEmail,
        email: normalizedEmail,
        name: formatNameFromEmail(normalizedEmail),
      }

      writeStoredUser(nextUser)
      setUser(nextUser)
      return nextUser
    } finally {
      setIsBusy(false)
    }
  }, [])

  const signUp = useCallback(async ({ email, name, password }) => {
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedPassword = String(password || '')
    const normalizedName = String(name || '').trim()

    if (!normalizedEmail || !normalizedPassword) {
      throw new Error('Email and password are required.')
    }

    setIsBusy(true)
    try {
      const response = await signUpRequest({
        email: normalizedEmail,
        name: normalizedName || formatNameFromEmail(normalizedEmail),
        password: normalizedPassword,
      })

      const nextUser = response?.data || {
        id: normalizedEmail,
        email: normalizedEmail,
        name: normalizedName || formatNameFromEmail(normalizedEmail),
      }

      writeStoredUser(nextUser)
      setUser(nextUser)
      return nextUser
    } finally {
      setIsBusy(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    setIsBusy(true)
    try {
      writeStoredUser(null)
      setUser(null)
    } finally {
      setIsBusy(false)
    }
  }, [])

  const updateUserProfile = useCallback((updates) => {
    setUser((currentUser) => {
      if (!currentUser) {
        return currentUser
      }

      const nextUser = {
        ...currentUser,
        ...updates,
      }

      writeStoredUser(nextUser)
      return nextUser
    })
  }, [])

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isBusy,
      signIn,
      signUp,
      signOut,
      updateUserProfile,
    }),
    [isBusy, signIn, signOut, signUp, updateUserProfile, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

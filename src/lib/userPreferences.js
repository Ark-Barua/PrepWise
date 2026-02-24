const PROFILE_STORAGE_KEY = 'prepwise.profile.preferences'
const SETTINGS_STORAGE_KEY = 'prepwise.app.settings'

const defaultProfilePreferences = {
  displayName: '',
  avatarUrl: '',
  targetRole: 'Software Engineer',
  experienceLevel: 'mid',
  primaryStack: '',
  timezone: 'UTC-05:00',
  bio: '',
  weeklyAttemptGoal: 14,
  weeklyMinutesGoal: 120,
}

const defaultAppSettings = {
  notifications: {
    reminders: true,
    weeklyDigest: true,
    streakAlerts: true,
  },
  interface: {
    compactMode: false,
    reducedMotion: false,
    darkMode: false,
    startPage: '/practice',
  },
  practiceDefaults: {
    category: 'all',
    difficulty: 'all',
    sessionQuestionCount: 5,
    generateCount: 6,
  },
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function readStorage(storageKey, fallbackValue) {
  if (typeof window === 'undefined') {
    return clone(fallbackValue)
  }

  try {
    const rawValue = window.localStorage.getItem(storageKey)
    if (!rawValue) {
      return clone(fallbackValue)
    }

    const parsed = JSON.parse(rawValue)
    if (!parsed || typeof parsed !== 'object') {
      return clone(fallbackValue)
    }

    return {
      ...clone(fallbackValue),
      ...parsed,
    }
  } catch {
    return clone(fallbackValue)
  }
}

function writeStorage(storageKey, value) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(storageKey, JSON.stringify(value))
}

function emitClientEvent(name) {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent(name))
}

function clampInt(value, min, max, fallbackValue) {
  const numeric = Number.parseInt(value, 10)
  if (Number.isNaN(numeric)) {
    return fallbackValue
  }
  return Math.min(max, Math.max(min, numeric))
}

export function getDefaultProfilePreferences() {
  return clone(defaultProfilePreferences)
}

export function readProfilePreferences() {
  const value = readStorage(PROFILE_STORAGE_KEY, defaultProfilePreferences)

  return {
    ...defaultProfilePreferences,
    ...value,
    avatarUrl:
      typeof value.avatarUrl === 'string'
        ? value.avatarUrl
        : defaultProfilePreferences.avatarUrl,
    weeklyAttemptGoal: clampInt(
      value.weeklyAttemptGoal,
      1,
      100,
      defaultProfilePreferences.weeklyAttemptGoal,
    ),
    weeklyMinutesGoal: clampInt(
      value.weeklyMinutesGoal,
      15,
      600,
      defaultProfilePreferences.weeklyMinutesGoal,
    ),
  }
}

export function saveProfilePreferences(payload) {
  const current = readProfilePreferences()
  const nextValue = {
    ...current,
    ...payload,
    weeklyAttemptGoal: clampInt(
      payload.weeklyAttemptGoal ?? current.weeklyAttemptGoal,
      1,
      100,
      defaultProfilePreferences.weeklyAttemptGoal,
    ),
    weeklyMinutesGoal: clampInt(
      payload.weeklyMinutesGoal ?? current.weeklyMinutesGoal,
      15,
      600,
      defaultProfilePreferences.weeklyMinutesGoal,
    ),
  }

  writeStorage(PROFILE_STORAGE_KEY, nextValue)
  emitClientEvent('prepwise:profile-updated')
  return nextValue
}

export function getDefaultAppSettings() {
  return clone(defaultAppSettings)
}

export function readAppSettings() {
  const value = readStorage(SETTINGS_STORAGE_KEY, defaultAppSettings)
  const notifications = value.notifications || {}
  const interfaceSettings = value.interface || {}
  const practiceDefaults = value.practiceDefaults || {}

  return {
    notifications: {
      reminders: Boolean(notifications.reminders ?? defaultAppSettings.notifications.reminders),
      weeklyDigest: Boolean(notifications.weeklyDigest ?? defaultAppSettings.notifications.weeklyDigest),
      streakAlerts: Boolean(notifications.streakAlerts ?? defaultAppSettings.notifications.streakAlerts),
    },
    interface: {
      compactMode: Boolean(interfaceSettings.compactMode ?? defaultAppSettings.interface.compactMode),
      reducedMotion: Boolean(interfaceSettings.reducedMotion ?? defaultAppSettings.interface.reducedMotion),
      darkMode: Boolean(interfaceSettings.darkMode ?? defaultAppSettings.interface.darkMode),
      startPage: typeof interfaceSettings.startPage === 'string'
        ? interfaceSettings.startPage
        : defaultAppSettings.interface.startPage,
    },
    practiceDefaults: {
      category: typeof practiceDefaults.category === 'string'
        ? practiceDefaults.category
        : defaultAppSettings.practiceDefaults.category,
      difficulty: typeof practiceDefaults.difficulty === 'string'
        ? practiceDefaults.difficulty
        : defaultAppSettings.practiceDefaults.difficulty,
      sessionQuestionCount: clampInt(
        practiceDefaults.sessionQuestionCount,
        1,
        20,
        defaultAppSettings.practiceDefaults.sessionQuestionCount,
      ),
      generateCount: clampInt(
        practiceDefaults.generateCount,
        1,
        25,
        defaultAppSettings.practiceDefaults.generateCount,
      ),
    },
  }
}

export function saveAppSettings(payload) {
  const current = readAppSettings()
  const nextValue = {
    notifications: {
      ...current.notifications,
      ...(payload.notifications || {}),
    },
    interface: {
      ...current.interface,
      ...(payload.interface || {}),
    },
    practiceDefaults: {
      ...current.practiceDefaults,
      ...(payload.practiceDefaults || {}),
    },
  }

  const normalized = readAppSettingsFromObject(nextValue)
  writeStorage(SETTINGS_STORAGE_KEY, normalized)
  emitClientEvent('prepwise:settings-updated')
  return normalized
}

function readAppSettingsFromObject(raw) {
  const notifications = raw.notifications || {}
  const interfaceSettings = raw.interface || {}
  const practiceDefaults = raw.practiceDefaults || {}

  return {
    notifications: {
      reminders: Boolean(notifications.reminders),
      weeklyDigest: Boolean(notifications.weeklyDigest),
      streakAlerts: Boolean(notifications.streakAlerts),
    },
    interface: {
      compactMode: Boolean(interfaceSettings.compactMode),
      reducedMotion: Boolean(interfaceSettings.reducedMotion),
      darkMode: Boolean(interfaceSettings.darkMode),
      startPage:
        typeof interfaceSettings.startPage === 'string'
          ? interfaceSettings.startPage
          : defaultAppSettings.interface.startPage,
    },
    practiceDefaults: {
      category:
        typeof practiceDefaults.category === 'string'
          ? practiceDefaults.category
          : defaultAppSettings.practiceDefaults.category,
      difficulty:
        typeof practiceDefaults.difficulty === 'string'
          ? practiceDefaults.difficulty
          : defaultAppSettings.practiceDefaults.difficulty,
      sessionQuestionCount: clampInt(
        practiceDefaults.sessionQuestionCount,
        1,
        20,
        defaultAppSettings.practiceDefaults.sessionQuestionCount,
      ),
      generateCount: clampInt(
        practiceDefaults.generateCount,
        1,
        25,
        defaultAppSettings.practiceDefaults.generateCount,
      ),
    },
  }
}

export function resetAppSettings() {
  const defaults = getDefaultAppSettings()
  writeStorage(SETTINGS_STORAGE_KEY, defaults)
  emitClientEvent('prepwise:settings-updated')
  return defaults
}

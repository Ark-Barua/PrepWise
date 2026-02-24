import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import sqlite3 from 'sqlite3'

const databaseDirectory = path.join(process.cwd(), 'data')
const databasePath =
  process.env.DB_PATH || path.join(databaseDirectory, 'prepwise.sqlite')

export const sessionStatuses = ['planned', 'completed', 'skipped']
const sessionStatusSet = new Set(sessionStatuses)
const questionDifficulties = ['easy', 'medium', 'hard']
const questionDifficultySet = new Set(questionDifficulties)
export const billingStatuses = [
  'inactive',
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'canceled',
]
const billingStatusSet = new Set(billingStatuses)
const billingPlanCatalog = Object.freeze({
  free: {
    id: 'free',
    name: 'Free',
    description: 'Core interview practice with monthly limits.',
    monthlyPriceCents: 0,
    limits: {
      attemptsPerMonth: 40,
      practiceSessionsPerMonth: 8,
      maxQuestionsPerSession: 10,
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    description: 'Expanded quotas and advanced practice capacity.',
    monthlyPriceCents: 1900,
    limits: {
      attemptsPerMonth: 600,
      practiceSessionsPerMonth: 120,
      maxQuestionsPerSession: 50,
    },
  },
})
export const billingPlanTiers = Object.freeze(Object.keys(billingPlanCatalog))
const billingPlanTierSet = new Set(billingPlanTiers)
const questionGenerationProvider = (
  process.env.QUESTION_GEN_PROVIDER || 'template'
)
  .trim()
  .toLowerCase()
const questionGenerationApiKey = process.env.QUESTION_GEN_API_KEY || ''
const questionGenerationModel =
  process.env.QUESTION_GEN_MODEL || 'HuggingFaceH4/zephyr-7b-beta'
const questionGenerationEndpoint =
  process.env.QUESTION_GEN_ENDPOINT || 'https://api-inference.huggingface.co/models'
const scrypt = promisify(scryptCallback)
const MAX_AVATAR_URL_LENGTH = 250000

let db = null

function ensureDatabase() {
  if (!db) {
    throw new Error('Database is not initialized.')
  }
}

function execute(sql) {
  ensureDatabase()
  return new Promise((resolve, reject) => {
    db.exec(sql, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function run(sql, params = []) {
  ensureDatabase()
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error)
        return
      }

      resolve({ changes: this.changes, lastID: this.lastID })
    })
  })
}

function get(sql, params = []) {
  ensureDatabase()
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error)
        return
      }

      resolve(row || null)
    })
  })
}

function all(sql, params = []) {
  ensureDatabase()
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error)
        return
      }

      resolve(rows || [])
    })
  })
}

function sanitizeText(value) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function sanitizeNullableText(value) {
  if (value === null || value === undefined) {
    return null
  }

  return sanitizeText(value)
}

function sanitizeOptionalText(value, fallback = '') {
  const text = sanitizeText(value)
  return text || fallback
}

function sanitizeAvatarUrl(value) {
  if (value === undefined) {
    return undefined
  }

  if (value === null) {
    return null
  }

  const text = sanitizeText(value)
  if (!text) {
    return null
  }

  if (text.length > MAX_AVATAR_URL_LENGTH) {
    throw new Error('`avatarUrl` exceeds the allowed size.')
  }

  return text
}

function normalizeUserId(value) {
  return String(value).trim().toLowerCase()
}

function normalizeStatus(value, fallback = 'planned') {
  const candidate = sanitizeText(value)?.toLowerCase() || fallback
  if (!sessionStatusSet.has(candidate)) {
    throw new Error(
      `Invalid status "${candidate}". Expected one of: ${sessionStatuses.join(', ')}`,
    )
  }

  return candidate
}

function normalizeDifficulty(value) {
  const candidate = sanitizeText(value)?.toLowerCase()
  if (!candidate || !questionDifficultySet.has(candidate)) {
    throw new Error(
      `Invalid difficulty "${candidate}". Expected one of: ${questionDifficulties.join(', ')}`,
    )
  }

  return candidate
}

function normalizeBillingStatus(value, fallback = 'inactive') {
  const candidate = sanitizeText(value)?.toLowerCase() || fallback
  if (!billingStatusSet.has(candidate)) {
    throw new Error(
      `Invalid billing status "${candidate}". Expected one of: ${billingStatuses.join(', ')}`,
    )
  }

  return candidate
}

function normalizePlanTier(value, fallback = 'free') {
  const candidate = sanitizeText(value)?.toLowerCase() || fallback
  if (!billingPlanTierSet.has(candidate)) {
    throw new Error(
      `Invalid plan tier "${candidate}". Expected one of: ${billingPlanTiers.join(', ')}`,
    )
  }

  return candidate
}

function getPlanCatalogItem(planTier) {
  const normalizedPlanTier = billingPlanTierSet.has(planTier)
    ? planTier
    : 'free'
  return billingPlanCatalog[normalizedPlanTier]
}

function mapPlanForClient(planTier) {
  const plan = getPlanCatalogItem(planTier)
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    monthlyPriceCents: plan.monthlyPriceCents,
    limits: {
      attemptsPerMonth: plan.limits.attemptsPerMonth,
      practiceSessionsPerMonth: plan.limits.practiceSessionsPerMonth,
      maxQuestionsPerSession: plan.limits.maxQuestionsPerSession,
    },
  }
}

function safePositiveLimit(value) {
  if (!Number.isFinite(value)) {
    return null
  }

  const numericValue = Math.round(value)
  if (numericValue < 0) {
    return null
  }

  return numericValue
}

async function hashPassword(password) {
  const normalizedPassword = String(password || '')
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(normalizedPassword, salt, 64)
  return `${salt}:${Buffer.from(derived).toString('hex')}`
}

async function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') {
    return false
  }

  const [salt, existingHash] = storedHash.split(':')
  if (!salt || !existingHash) {
    return false
  }

  const derived = await scrypt(String(password || ''), salt, 64)
  const existingBuffer = Buffer.from(existingHash, 'hex')
  const derivedBuffer = Buffer.from(derived)
  if (existingBuffer.length !== derivedBuffer.length) {
    return false
  }

  return timingSafeEqual(existingBuffer, derivedBuffer)
}

function asSessionRow(row) {
  if (!row) {
    return null
  }

  return {
    id: row.id,
    userId: row.userId,
    topic: row.topic,
    durationMinutes: row.durationMinutes,
    status: row.status,
    scheduledFor: row.scheduledFor,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function asUserRow(row) {
  if (!row) {
    return null
  }

  const normalizedPlanTier = billingPlanTierSet.has(row.planTier)
    ? row.planTier
    : 'free'

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl || null,
    planTier: normalizedPlanTier,
    billingStatus: row.billingStatus || 'inactive',
    billingPeriodEnd: row.billingPeriodEnd || null,
    createdAt: row.createdAt,
  }
}

function asUserBillingRow(row) {
  const user = asUserRow(row)
  if (!user) {
    return null
  }

  return {
    ...user,
    stripeCustomerId: row.stripeCustomerId || null,
    stripeSubscriptionId: row.stripeSubscriptionId || null,
  }
}

function asQuestionRow(row) {
  if (!row) {
    return null
  }

  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    category: row.category,
    difficulty: row.difficulty,
    idealSeconds: row.idealSeconds,
    createdAt: row.createdAt,
  }
}

function asAttemptRow(row) {
  if (!row) {
    return null
  }

  return {
    id: row.id,
    questionId: row.questionId,
    userId: row.userId,
    answerText: row.answerText,
    timeSpentSeconds: row.timeSpentSeconds,
    score: row.score,
    feedback: row.feedback,
    keywordHits: row.keywordHits,
    keywordTarget: row.keywordTarget,
    createdAt: row.createdAt,
    questionTitle: row.questionTitle,
    questionCategory: row.questionCategory,
    questionDifficulty: row.questionDifficulty,
  }
}

function asPracticeSessionRow(row) {
  if (!row) {
    return null
  }

  let sourceFilters = {}
  try {
    sourceFilters = row.sourceFilters ? JSON.parse(row.sourceFilters) : {}
  } catch {
    sourceFilters = {}
  }

  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    status: row.status,
    sourceFilters,
    totalQuestions: row.totalQuestions,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  }
}

function shuffleArray(values) {
  const output = [...values]
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = output[index]
    output[index] = output[swapIndex]
    output[swapIndex] = current
  }

  return output
}

function normalizeTextForMatching(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function evaluateAttempt({ answerText, expectedAnswer, keywordList, idealSeconds, timeSpentSeconds }) {
  const normalizedAnswer = normalizeTextForMatching(answerText)
  const answerWords = normalizedAnswer ? normalizedAnswer.split(' ') : []
  const normalizedExpected = normalizeTextForMatching(expectedAnswer)

  const keywordHits = keywordList.filter((keyword) => {
    const normalizedKeyword = normalizeTextForMatching(keyword)
    return normalizedKeyword && normalizedAnswer.includes(normalizedKeyword)
  }).length
  const keywordTarget = keywordList.length

  const keywordScore =
    keywordTarget > 0 ? Math.round((keywordHits / keywordTarget) * 70) : 0
  const depthScore = Math.min(20, Math.round((answerWords.length / 60) * 20))

  const expectedTerms = normalizedExpected
    .split(' ')
    .filter(Boolean)
    .slice(0, 12)
  const expectedTermHits = expectedTerms.filter((term) =>
    normalizedAnswer.includes(term),
  ).length
  const expectedScore =
    expectedTerms.length > 0
      ? Math.round((expectedTermHits / expectedTerms.length) * 10)
      : 0

  const score = Math.max(0, Math.min(100, keywordScore + depthScore + expectedScore))

  let paceFeedback = 'Pace was on target for this question.'
  if (typeof idealSeconds === 'number' && idealSeconds > 0) {
    if (timeSpentSeconds < idealSeconds * 0.6) {
      paceFeedback = 'You moved fast; consider adding more detail.'
    } else if (timeSpentSeconds > idealSeconds * 1.5) {
      paceFeedback = 'You spent longer than ideal; tighten your structure.'
    }
  }

  const missingKeywords = keywordList.filter((keyword) => {
    const normalizedKeyword = normalizeTextForMatching(keyword)
    return normalizedKeyword && !normalizedAnswer.includes(normalizedKeyword)
  })

  let qualitativeFeedback = 'Strong answer with relevant coverage.'
  if (score < 80 && score >= 60) {
    qualitativeFeedback =
      'Good attempt. Expand with concrete examples and tighter structure.'
  } else if (score < 60) {
    qualitativeFeedback =
      'Core points are missing. Focus on fundamentals before adding detail.'
  }

  const missingFeedback =
    missingKeywords.length > 0
      ? `Missing concepts: ${missingKeywords.slice(0, 4).join(', ')}.`
      : 'You covered all expected concepts.'

  return {
    score,
    feedback: `${qualitativeFeedback} ${paceFeedback} ${missingFeedback}`.trim(),
    keywordHits,
    keywordTarget,
  }
}

function scoreBand(score) {
  const numericScore = Number(score) || 0
  if (numericScore >= 90) {
    return 'Excellent'
  }
  if (numericScore >= 75) {
    return 'Strong'
  }
  if (numericScore >= 60) {
    return 'Developing'
  }
  return 'Needs Work'
}

function parseDateKey(dateKey) {
  if (!dateKey || typeof dateKey !== 'string') {
    return null
  }

  const parts = dateKey.split('-').map((value) => Number.parseInt(value, 10))
  if (parts.length !== 3 || parts.some((value) => Number.isNaN(value))) {
    return null
  }

  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
}

function formatUtcDateKey(date) {
  return date.toISOString().slice(0, 10)
}

function differenceInUtcDays(laterDateKey, earlierDateKey) {
  const laterDate = parseDateKey(laterDateKey)
  const earlierDate = parseDateKey(earlierDateKey)
  if (!laterDate || !earlierDate) {
    return 0
  }

  return Math.round((laterDate - earlierDate) / 86400000)
}

function calculateStreakData(activityByDayRows) {
  const dateKeys = Array.from(
    new Set((activityByDayRows || []).map((item) => item.date).filter(Boolean)),
  ).sort((a, b) => b.localeCompare(a))

  if (dateKeys.length === 0) {
    return {
      currentDays: 0,
      longestDays: 0,
      activeDays: 0,
      lastActiveDate: null,
      status: 'inactive',
    }
  }

  const todayKey = formatUtcDateKey(new Date())
  const lastActiveDate = dateKeys[0]
  const daysSinceLastActive = differenceInUtcDays(todayKey, lastActiveDate)

  let currentDays = 0
  let status = 'broken'
  if (daysSinceLastActive === 0 || daysSinceLastActive === 1) {
    currentDays = 1
    status = daysSinceLastActive === 0 ? 'active' : 'at-risk'

    for (let index = 1; index < dateKeys.length; index += 1) {
      if (differenceInUtcDays(dateKeys[index - 1], dateKeys[index]) === 1) {
        currentDays += 1
      } else {
        break
      }
    }
  }

  let longestDays = 1
  let runningStreak = 1
  for (let index = 1; index < dateKeys.length; index += 1) {
    if (differenceInUtcDays(dateKeys[index - 1], dateKeys[index]) === 1) {
      runningStreak += 1
    } else {
      runningStreak = 1
    }

    if (runningStreak > longestDays) {
      longestDays = runningStreak
    }
  }

  return {
    currentDays,
    longestDays,
    activeDays: dateKeys.length,
    lastActiveDate,
    status,
  }
}

const generatedCategoryBlueprints = Object.freeze({
  DSA: {
    themes: ['arrays', 'graphs', 'trees', 'hashing', 'dynamic programming', 'strings'],
    contexts: ['real-time feed ranking', 'payment reconciliation', 'log analytics', 'recommendation preprocessing'],
    keywords: ['time complexity', 'space complexity', 'edge cases', 'trade-offs'],
    expectedFocus:
      'Explain brute force, optimized approach, complexity, and at least one tricky edge case.',
  },
  'System Design': {
    themes: ['notification platform', 'rate limiter', 'search service', 'job scheduler', 'event ingestion'],
    contexts: ['global scale', 'high write traffic', 'strict latency SLO', 'multi-region failover'],
    keywords: ['scalability', 'consistency', 'caching', 'partitioning', 'observability'],
    expectedFocus:
      'Cover APIs, data model, bottlenecks, scaling strategy, and resilience plan.',
  },
  Behavioral: {
    themes: ['stakeholder alignment', 'conflict resolution', 'ownership under pressure', 'delivery trade-offs'],
    contexts: ['tight deadline', 'cross-functional team', 'production incident', 'ambiguous requirements'],
    keywords: ['STAR', 'communication', 'impact', 'reflection'],
    expectedFocus:
      'Use STAR format with measurable outcome and lessons learned.',
  },
  DevOps: {
    themes: ['incident response', 'deployment strategy', 'pipeline optimization', 'infrastructure hardening'],
    contexts: ['Kubernetes', 'CI/CD', 'cloud outage', 'cost spike'],
    keywords: ['rollback', 'monitoring', 'root cause', 'automation', 'runbook'],
    expectedFocus:
      'Describe detection, containment, remediation, and prevention steps.',
  },
  Databases: {
    themes: ['query optimization', 'schema evolution', 'index strategy', 'replication lag'],
    contexts: ['OLTP workload', 'reporting workload', 'multi-tenant system', 'audit-heavy system'],
    keywords: ['indexes', 'execution plan', 'transactions', 'consistency', 'partitioning'],
    expectedFocus:
      'Discuss diagnosis method, tuning strategy, and correctness considerations.',
  },
  Frontend: {
    themes: ['performance tuning', 'state architecture', 'accessibility', 'error handling UX'],
    contexts: ['React dashboard', 'mobile web app', 'large form workflow', 'real-time updates'],
    keywords: ['rendering', 'memoization', 'accessibility', 'testing', 'user experience'],
    expectedFocus:
      'Balance architecture decisions with UX impact and maintainability.',
  },
  Backend: {
    themes: ['API design', 'idempotency', 'concurrency control', 'distributed tracing'],
    contexts: ['microservices', 'event-driven platform', 'high throughput API', 'B2B integration'],
    keywords: ['latency', 'retries', 'idempotency', 'contracts', 'monitoring'],
    expectedFocus:
      'Define the API contract, failure handling, and observability approach.',
  },
  Security: {
    themes: ['auth hardening', 'secrets management', 'threat modeling', 'incident triage'],
    contexts: ['public API', 'internal admin panel', 'multi-tenant SaaS', 'compliance audit'],
    keywords: ['least privilege', 'encryption', 'audit logs', 'rotation', 'mitigation'],
    expectedFocus:
      'Identify threats, mitigation controls, and verification steps.',
  },
  Cloud: {
    themes: ['cost optimization', 'multi-region deployment', 'autoscaling', 'disaster recovery'],
    contexts: ['AWS', 'Azure', 'GCP', 'hybrid cloud'],
    keywords: ['SLA', 'autoscaling', 'resilience', 'cost controls', 'networking'],
    expectedFocus:
      'Explain architecture choices, trade-offs, and operational safeguards.',
  },
  'Machine Learning': {
    themes: ['model evaluation', 'feature engineering', 'drift detection', 'serving strategy'],
    contexts: ['recommendation engine', 'fraud detection', 'NLP classification', 'forecasting'],
    keywords: ['precision', 'recall', 'drift', 'feature store', 'monitoring'],
    expectedFocus:
      'Describe pipeline, evaluation metrics, and production monitoring strategy.',
  },
})

const generatedDefaultCategories = Object.freeze(
  Object.keys(generatedCategoryBlueprints),
)

const generatedDifficultyConfigs = Object.freeze({
  easy: {
    idealSecondsRange: [180, 300],
    scope: 'single-service or focused algorithmic scope',
  },
  medium: {
    idealSecondsRange: [300, 480],
    scope: 'multi-step implementation with clear trade-offs',
  },
  hard: {
    idealSecondsRange: [480, 720],
    scope: 'distributed/system-level complexity with constraints',
  },
})

function randomIntInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pickRandomItem(values, fallback = '') {
  if (!Array.isArray(values) || values.length === 0) {
    return fallback
  }

  return values[Math.floor(Math.random() * values.length)]
}

function normalizeGeneratedDifficulty(value) {
  const candidate = sanitizeText(value)?.toLowerCase()
  if (candidate && questionDifficultySet.has(candidate)) {
    return candidate
  }

  return pickRandomItem(questionDifficulties, 'medium')
}

function normalizeGeneratedCategory(value) {
  const candidate = sanitizeText(value)
  if (candidate) {
    return candidate
  }

  return pickRandomItem(generatedDefaultCategories, 'Backend')
}

function extractJsonObject(rawValue) {
  if (typeof rawValue !== 'string') {
    return null
  }

  const startIndex = rawValue.indexOf('{')
  const endIndex = rawValue.lastIndexOf('}')
  if (startIndex < 0 || endIndex <= startIndex) {
    return null
  }

  const jsonSlice = rawValue.slice(startIndex, endIndex + 1)
  try {
    return JSON.parse(jsonSlice)
  } catch {
    return null
  }
}

function asKeywordList(value, fallback = []) {
  if (!Array.isArray(value)) {
    return fallback
  }

  const normalized = value
    .map((item) => sanitizeText(item))
    .filter(Boolean)
    .slice(0, 8)

  return normalized.length > 0 ? normalized : fallback
}

function buildTemplateGeneratedQuestion({ category, difficulty, topicHint }) {
  const resolvedCategory = normalizeGeneratedCategory(category)
  const resolvedDifficulty = normalizeGeneratedDifficulty(difficulty)
  const blueprint =
    generatedCategoryBlueprints[resolvedCategory] ||
    generatedCategoryBlueprints[pickRandomItem(generatedDefaultCategories, 'Backend')]
  const difficultyConfig =
    generatedDifficultyConfigs[resolvedDifficulty] ||
    generatedDifficultyConfigs.medium

  const theme = topicHint || pickRandomItem(blueprint.themes, 'core concepts')
  const context = pickRandomItem(blueprint.contexts, 'production workload')
  const challengeVerb = pickRandomItem(
    ['design', 'optimize', 'debug', 'scale', 'stabilize', 'refactor'],
    'design',
  )
  const uniqueId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()
  const title = `${resolvedCategory}: ${theme} ${challengeVerb} challenge ${uniqueId}`
  const prompt = `You are handling ${theme} in a ${context} scenario. Create a structured response that addresses ${difficultyConfig.scope}, outlines key decisions, and explains why your approach is reliable under realistic constraints. Include assumptions and failure handling.`

  const fallbackKeywords = [
    theme,
    challengeVerb,
    ...blueprint.keywords.slice(0, 4),
  ]

  const expectedAnswer = `${blueprint.expectedFocus} Include practical implementation details for ${theme} and explain how you would validate the solution in ${context}.`
  const idealSeconds = randomIntInRange(
    difficultyConfig.idealSecondsRange[0],
    difficultyConfig.idealSecondsRange[1],
  )

  return {
    title,
    prompt,
    category: resolvedCategory,
    difficulty: resolvedDifficulty,
    expectedAnswer,
    keywordList: asKeywordList(fallbackKeywords, blueprint.keywords.slice(0, 5)),
    idealSeconds,
  }
}

async function generateQuestionViaHuggingFace({ category, difficulty, topicHint }) {
  if (!questionGenerationApiKey) {
    return null
  }

  const resolvedCategory = normalizeGeneratedCategory(category)
  const resolvedDifficulty = normalizeGeneratedDifficulty(difficulty)
  const themeHint = sanitizeText(topicHint) || 'interview scenario'
  const prompt = `Generate one interview practice question in strict JSON.
Return only a single JSON object with keys:
title, prompt, expectedAnswer, keywordList, idealSeconds.
Constraints:
- category: ${resolvedCategory}
- difficulty: ${resolvedDifficulty}
- topic hint: ${themeHint}
- keywordList must have 4 to 7 short strings
- idealSeconds must be an integer between 180 and 720
- prompt should demand structured reasoning and trade-offs`

  const endpoint = `${questionGenerationEndpoint.replace(/\/$/, '')}/${encodeURIComponent(questionGenerationModel)}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 9000)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${questionGenerationApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: 320,
          temperature: 0.85,
          return_full_text: false,
        },
        options: {
          wait_for_model: true,
          use_cache: false,
        },
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      return null
    }

    const payload = await response.json().catch(() => null)
    const generatedText = Array.isArray(payload)
      ? payload[0]?.generated_text
      : payload?.generated_text

    const parsedObject = extractJsonObject(generatedText)
    if (!parsedObject) {
      return null
    }

    const fallback = buildTemplateGeneratedQuestion({
      category: resolvedCategory,
      difficulty: resolvedDifficulty,
      topicHint: themeHint,
    })

    return {
      title: sanitizeText(parsedObject.title) || fallback.title,
      prompt: sanitizeText(parsedObject.prompt) || fallback.prompt,
      category: resolvedCategory,
      difficulty: normalizeGeneratedDifficulty(parsedObject.difficulty || resolvedDifficulty),
      expectedAnswer: sanitizeText(parsedObject.expectedAnswer) || fallback.expectedAnswer,
      keywordList: asKeywordList(parsedObject.keywordList, fallback.keywordList),
      idealSeconds:
        normalizePositiveInt(parsedObject.idealSeconds) || fallback.idealSeconds,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

async function insertQuestionRecord(question) {
  const insertResult = await run(
    `
      INSERT INTO questions (
        title,
        prompt,
        category,
        difficulty,
        expected_answer,
        keyword_list,
        ideal_seconds
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      sanitizeOptionalText(question.title),
      sanitizeOptionalText(question.prompt),
      sanitizeOptionalText(question.category),
      normalizeDifficulty(question.difficulty),
      sanitizeOptionalText(question.expectedAnswer),
      JSON.stringify(question.keywordList || []),
      normalizePositiveInt(question.idealSeconds) || 300,
    ],
  )

  return getQuestionById(insertResult.lastID)
}

function canUseExternalQuestionGenerator() {
  return (
    (questionGenerationProvider === 'huggingface' ||
      questionGenerationProvider === 'auto') &&
    Boolean(questionGenerationApiKey)
  )
}

export function getQuestionGenerationCapabilities() {
  return {
    provider: questionGenerationProvider,
    llmEnabled: canUseExternalQuestionGenerator(),
    model: questionGenerationModel,
  }
}

const questionSeedData = [
  {
    title: 'Two Sum',
    prompt:
      'Given an array of integers and a target, return indices of two numbers that add up to the target. Explain your approach and complexity.',
    category: 'DSA',
    difficulty: 'easy',
    expectedAnswer:
      'Use a hash map to store value to index while scanning once. For each value, compute complement and check map. Time O(n), space O(n).',
    keywordList: ['hash map', 'complement', 'one pass', 'o(n)', 'space'],
    idealSeconds: 300,
  },
  {
    title: 'Design URL Shortener',
    prompt:
      'Design a URL shortening service. Describe APIs, storage model, key generation, and high-level scaling approach.',
    category: 'System Design',
    difficulty: 'medium',
    expectedAnswer:
      'Cover create and redirect APIs, unique key generation, database mapping short key to long URL, caching, rate limiting, and replication.',
    keywordList: ['api', 'key generation', 'database', 'cache', 'rate limiting', 'replication'],
    idealSeconds: 480,
  },
  {
    title: 'Behavioral: Conflict Resolution',
    prompt:
      'Tell me about a time you had a conflict with a teammate and how you resolved it. Structure your response clearly.',
    category: 'Behavioral',
    difficulty: 'medium',
    expectedAnswer:
      'Use STAR format: situation, task, action, result. Emphasize communication, empathy, and measurable outcome.',
    keywordList: ['star', 'situation', 'action', 'result', 'communication', 'outcome'],
    idealSeconds: 240,
  },
  {
    title: 'Kubernetes Rollout Failure',
    prompt:
      'A new deployment causes pod crash loops in production. Walk through your incident response and remediation steps.',
    category: 'DevOps',
    difficulty: 'hard',
    expectedAnswer:
      'Triage logs and metrics, rollback quickly, identify root cause, add canary checks, and document preventive controls.',
    keywordList: ['logs', 'metrics', 'rollback', 'root cause', 'canary', 'postmortem'],
    idealSeconds: 420,
  },
  {
    title: 'SQL Query Optimization',
    prompt:
      'A report query is slow on a large table. Explain how you would diagnose and improve performance.',
    category: 'Databases',
    difficulty: 'medium',
    expectedAnswer:
      'Use execution plan, identify full scans, add indexes, reduce selected columns, consider partitioning and caching.',
    keywordList: ['execution plan', 'index', 'scan', 'partition', 'cache'],
    idealSeconds: 360,
  },
  {
    title: 'React Rendering Performance',
    prompt:
      'A React page becomes sluggish as data grows. Describe how you would investigate and optimize rendering.',
    category: 'Frontend',
    difficulty: 'medium',
    expectedAnswer:
      'Profile renders, memoize expensive components, normalize state updates, virtualize long lists, and avoid unnecessary re-renders.',
    keywordList: ['profile', 'memo', 'virtualize', 'state updates', 're-render'],
    idealSeconds: 360,
  },
]

async function seedQuestionsIfEmpty() {
  const countRow = await get('SELECT COUNT(*) AS count FROM questions')
  if ((countRow?.count || 0) > 0) {
    return
  }

  for (const question of questionSeedData) {
    await insertQuestionRecord(question)
  }
}

async function ensureUsersPasswordColumn() {
  const tableInfo = await all("PRAGMA table_info('users')")
  const hasPasswordHashColumn = tableInfo.some((column) => column.name === 'password_hash')
  if (!hasPasswordHashColumn) {
    await execute('ALTER TABLE users ADD COLUMN password_hash TEXT')
  }
}

async function ensureUsersBillingColumns() {
  const tableInfo = await all("PRAGMA table_info('users')")
  const columns = new Set(tableInfo.map((column) => column.name))

  if (!columns.has('plan_tier')) {
    await execute(
      "ALTER TABLE users ADD COLUMN plan_tier TEXT NOT NULL DEFAULT 'free'",
    )
  }

  if (!columns.has('billing_status')) {
    await execute(
      "ALTER TABLE users ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'inactive'",
    )
  }

  if (!columns.has('billing_period_end')) {
    await execute('ALTER TABLE users ADD COLUMN billing_period_end TEXT')
  }

  if (!columns.has('stripe_customer_id')) {
    await execute('ALTER TABLE users ADD COLUMN stripe_customer_id TEXT')
  }

  if (!columns.has('stripe_subscription_id')) {
    await execute('ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT')
  }

  await run(
    "UPDATE users SET plan_tier = 'free' WHERE plan_tier IS NULL OR TRIM(plan_tier) = ''",
  )
  await run(
    "UPDATE users SET billing_status = 'inactive' WHERE billing_status IS NULL OR TRIM(billing_status) = ''",
  )
}

async function ensureUsersProfileColumns() {
  const tableInfo = await all("PRAGMA table_info('users')")
  const columns = new Set(tableInfo.map((column) => column.name))

  if (!columns.has('avatar_url')) {
    await execute('ALTER TABLE users ADD COLUMN avatar_url TEXT')
  }
}

export async function initDatabase() {
  await fs.mkdir(databaseDirectory, { recursive: true })

  await new Promise((resolve, reject) => {
    db = new sqlite3.Database(databasePath, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })

  await execute('PRAGMA foreign_keys = ON;')
  await execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS study_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
      status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'completed', 'skipped')),
      scheduled_for TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      category TEXT NOT NULL,
      difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
      expected_answer TEXT NOT NULL,
      keyword_list TEXT NOT NULL,
      ideal_seconds INTEGER NOT NULL DEFAULT 300 CHECK (ideal_seconds > 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS question_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      answer_text TEXT NOT NULL,
      time_spent_seconds INTEGER NOT NULL CHECK (time_spent_seconds >= 0),
      score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
      feedback TEXT NOT NULL,
      keyword_hits INTEGER NOT NULL DEFAULT 0,
      keyword_target INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS practice_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
      source_filters TEXT NOT NULL DEFAULT '{}',
      total_questions INTEGER NOT NULL CHECK (total_questions > 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS practice_session_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      sequence_index INTEGER NOT NULL CHECK (sequence_index >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, sequence_index),
      UNIQUE(session_id, question_id),
      FOREIGN KEY (session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS practice_session_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      session_item_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      attempt_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_item_id, user_id),
      FOREIGN KEY (session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (session_item_id) REFERENCES practice_session_items(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (attempt_id) REFERENCES question_attempts(id) ON DELETE CASCADE
    );
  `)

  await ensureUsersPasswordColumn()
  await ensureUsersBillingColumns()
  await ensureUsersProfileColumns()
  await seedQuestionsIfEmpty()
}

export async function closeDatabase() {
  if (!db) {
    return
  }

  await new Promise((resolve, reject) => {
    db.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })

  db = null
}

export async function listUsers() {
  const rows = await all(
    `
      SELECT
        id,
        email,
        name,
        avatar_url AS avatarUrl,
        plan_tier AS planTier,
        billing_status AS billingStatus,
        billing_period_end AS billingPeriodEnd,
        created_at AS createdAt
      FROM users
      ORDER BY created_at DESC
    `,
  )

  return rows.map(asUserRow)
}

export async function getUserById(userId) {
  const row = await get(
    `
      SELECT
        id,
        email,
        name,
        avatar_url AS avatarUrl,
        plan_tier AS planTier,
        billing_status AS billingStatus,
        billing_period_end AS billingPeriodEnd,
        created_at AS createdAt
      FROM users
      WHERE id = ?
    `,
    [normalizeUserId(userId)],
  )

  return asUserRow(row)
}

export async function deleteUserById(userId) {
  const result = await run(
    `
      DELETE FROM users
      WHERE id = ?
    `,
    [normalizeUserId(userId)],
  )

  return result.changes > 0
}

async function getUserAuthById(userId) {
  const row = await get(
    `
      SELECT
        id,
        email,
        name,
        avatar_url AS avatarUrl,
        plan_tier AS planTier,
        billing_status AS billingStatus,
        billing_period_end AS billingPeriodEnd,
        stripe_customer_id AS stripeCustomerId,
        stripe_subscription_id AS stripeSubscriptionId,
        created_at AS createdAt,
        password_hash AS passwordHash
      FROM users
      WHERE id = ?
    `,
    [normalizeUserId(userId)],
  )

  return row
}

export function listBillingPlans() {
  return billingPlanTiers.map((planTier) => mapPlanForClient(planTier))
}

async function getCurrentMonthlyUsage(userId) {
  const normalizedUserId = normalizeUserId(userId)

  const [attemptsRow, practiceSessionsRow] = await Promise.all([
    get(
      `
        SELECT COUNT(*) AS count
        FROM question_attempts
        WHERE
          user_id = ?
          AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
      `,
      [normalizedUserId],
    ),
    get(
      `
        SELECT COUNT(*) AS count
        FROM practice_sessions
        WHERE
          user_id = ?
          AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
      `,
      [normalizedUserId],
    ),
  ])

  return {
    attemptsUsed: attemptsRow?.count || 0,
    practiceSessionsUsed: practiceSessionsRow?.count || 0,
  }
}

function buildRemainingLimit(limit, used) {
  const normalizedLimit = safePositiveLimit(limit)
  if (normalizedLimit === null) {
    return null
  }

  return Math.max(0, normalizedLimit - (Number(used) || 0))
}

function buildUsagePercentage(limit, used) {
  const normalizedLimit = safePositiveLimit(limit)
  if (normalizedLimit === null || normalizedLimit <= 0) {
    return null
  }

  return Number(
    Math.min(100, ((Number(used) || 0) / normalizedLimit) * 100).toFixed(1),
  )
}

function createQuotaError({
  metric,
  limit,
  used,
  requested,
  planTier,
  metricLabel,
}) {
  const remaining = buildRemainingLimit(limit, used)
  const message =
    metric === 'maxQuestionsPerSession'
      ? `Your ${planTier} plan allows up to ${limit} questions per session.`
      : `Monthly ${metricLabel} quota reached for the ${planTier} plan (${used}/${limit}). Upgrade to continue.`

  const error = new Error(message)
  error.code = 'QUOTA_EXCEEDED'
  error.details = {
    metric,
    limit,
    used,
    requested,
    remaining,
    planTier,
  }
  return error
}

async function enforceUsageQuota({ userId, metric, requested = 1 }) {
  const normalizedUserId = normalizeUserId(userId)
  const user = await getUserById(normalizedUserId)
  if (!user) {
    const error = new Error('User not found.')
    error.code = 'USER_NOT_FOUND'
    throw error
  }

  const plan = getPlanCatalogItem(user.planTier)
  const usage = await getCurrentMonthlyUsage(normalizedUserId)

  if (metric === 'attempts') {
    const limit = safePositiveLimit(plan.limits.attemptsPerMonth)
    const used = usage.attemptsUsed
    if (limit !== null && used + requested > limit) {
      throw createQuotaError({
        metric: 'attempts',
        limit,
        used,
        requested,
        planTier: plan.id,
        metricLabel: 'answer attempts',
      })
    }
  } else if (metric === 'practiceSessions') {
    const limit = safePositiveLimit(plan.limits.practiceSessionsPerMonth)
    const used = usage.practiceSessionsUsed
    if (limit !== null && used + requested > limit) {
      throw createQuotaError({
        metric: 'practiceSessions',
        limit,
        used,
        requested,
        planTier: plan.id,
        metricLabel: 'practice sessions',
      })
    }
  } else if (metric === 'maxQuestionsPerSession') {
    const limit = safePositiveLimit(plan.limits.maxQuestionsPerSession)
    if (limit !== null && requested > limit) {
      throw createQuotaError({
        metric: 'maxQuestionsPerSession',
        limit,
        used: requested,
        requested,
        planTier: plan.id,
        metricLabel: 'questions per session',
      })
    }
  }

  return {
    user,
    plan,
    usage,
  }
}

export async function getBillingSummary(userId) {
  const user = await getUserById(userId)
  if (!user) {
    return null
  }

  const plan = getPlanCatalogItem(user.planTier)
  const usage = await getCurrentMonthlyUsage(user.id)
  const limits = {
    attemptsPerMonth: safePositiveLimit(plan.limits.attemptsPerMonth),
    practiceSessionsPerMonth: safePositiveLimit(plan.limits.practiceSessionsPerMonth),
    maxQuestionsPerSession: safePositiveLimit(plan.limits.maxQuestionsPerSession),
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      planTier: user.planTier,
      billingStatus: user.billingStatus,
      billingPeriodEnd: user.billingPeriodEnd,
    },
    plan: mapPlanForClient(plan.id),
    usage: {
      attemptsUsed: usage.attemptsUsed,
      practiceSessionsUsed: usage.practiceSessionsUsed,
    },
    remaining: {
      attempts: buildRemainingLimit(limits.attemptsPerMonth, usage.attemptsUsed),
      practiceSessions: buildRemainingLimit(
        limits.practiceSessionsPerMonth,
        usage.practiceSessionsUsed,
      ),
    },
    usagePercent: {
      attempts: buildUsagePercentage(limits.attemptsPerMonth, usage.attemptsUsed),
      practiceSessions: buildUsagePercentage(
        limits.practiceSessionsPerMonth,
        usage.practiceSessionsUsed,
      ),
    },
    plans: listBillingPlans(),
  }
}

export async function getUserBillingProfile(userId) {
  const row = await get(
    `
      SELECT
        id,
        email,
        name,
        avatar_url AS avatarUrl,
        plan_tier AS planTier,
        billing_status AS billingStatus,
        billing_period_end AS billingPeriodEnd,
        stripe_customer_id AS stripeCustomerId,
        stripe_subscription_id AS stripeSubscriptionId,
        created_at AS createdAt
      FROM users
      WHERE id = ?
    `,
    [normalizeUserId(userId)],
  )

  return asUserBillingRow(row)
}

export async function getUserByStripeCustomerId(stripeCustomerId) {
  const normalizedCustomerId = sanitizeText(stripeCustomerId)
  if (!normalizedCustomerId) {
    return null
  }

  const row = await get(
    `
      SELECT
        id,
        email,
        name,
        avatar_url AS avatarUrl,
        plan_tier AS planTier,
        billing_status AS billingStatus,
        billing_period_end AS billingPeriodEnd,
        stripe_customer_id AS stripeCustomerId,
        stripe_subscription_id AS stripeSubscriptionId,
        created_at AS createdAt
      FROM users
      WHERE stripe_customer_id = ?
    `,
    [normalizedCustomerId],
  )

  return asUserBillingRow(row)
}

export async function updateUserBillingProfile(userId, updates = {}) {
  const normalizedUserId = normalizeUserId(userId)
  const existingUser = await getUserBillingProfile(normalizedUserId)
  if (!existingUser) {
    return null
  }

  const assignments = []
  const params = []

  if (Object.hasOwn(updates, 'planTier')) {
    assignments.push('plan_tier = ?')
    params.push(normalizePlanTier(updates.planTier))
  }

  if (Object.hasOwn(updates, 'billingStatus')) {
    assignments.push('billing_status = ?')
    params.push(normalizeBillingStatus(updates.billingStatus))
  }

  if (Object.hasOwn(updates, 'billingPeriodEnd')) {
    const billingPeriodEnd = updates.billingPeriodEnd
    if (billingPeriodEnd !== null && typeof billingPeriodEnd !== 'string') {
      throw new Error('`billingPeriodEnd` must be a string or null.')
    }
    assignments.push('billing_period_end = ?')
    params.push(billingPeriodEnd ? billingPeriodEnd.trim() : null)
  }

  if (Object.hasOwn(updates, 'stripeCustomerId')) {
    const stripeCustomerId = updates.stripeCustomerId
    if (stripeCustomerId !== null && typeof stripeCustomerId !== 'string') {
      throw new Error('`stripeCustomerId` must be a string or null.')
    }
    assignments.push('stripe_customer_id = ?')
    params.push(stripeCustomerId ? stripeCustomerId.trim() : null)
  }

  if (Object.hasOwn(updates, 'stripeSubscriptionId')) {
    const stripeSubscriptionId = updates.stripeSubscriptionId
    if (stripeSubscriptionId !== null && typeof stripeSubscriptionId !== 'string') {
      throw new Error('`stripeSubscriptionId` must be a string or null.')
    }
    assignments.push('stripe_subscription_id = ?')
    params.push(stripeSubscriptionId ? stripeSubscriptionId.trim() : null)
  }

  if (assignments.length > 0) {
    params.push(normalizedUserId)
    await run(
      `
        UPDATE users
        SET ${assignments.join(', ')}
        WHERE id = ?
      `,
      params,
    )
  }

  return getUserById(normalizedUserId)
}

export async function upsertUser({ email, name, avatarUrl }) {
  const normalizedEmail = normalizeUserId(email)
  const displayName =
    sanitizeText(name) || normalizedEmail.split('@')[0] || 'Learner'
  const existingUser = await getUserById(normalizedEmail)
  const normalizedAvatarUrl = sanitizeAvatarUrl(avatarUrl)
  const resolvedAvatarUrl =
    normalizedAvatarUrl === undefined
      ? existingUser?.avatarUrl || null
      : normalizedAvatarUrl

  await run(
    `
      INSERT INTO users (id, email, name, avatar_url)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        avatar_url = excluded.avatar_url
    `,
    [normalizedEmail, normalizedEmail, displayName, resolvedAvatarUrl],
  )

  return getUserById(normalizedEmail)
}

export async function createUserWithPassword({ email, name, password }) {
  const normalizedEmail = normalizeUserId(email)
  const displayName =
    sanitizeText(name) || normalizedEmail.split('@')[0] || 'Learner'
  const passwordHash = await hashPassword(password)

  const existingUser = await getUserAuthById(normalizedEmail)
  if (existingUser?.passwordHash) {
    const error = new Error('User already exists. Please sign in.')
    error.code = 'USER_EXISTS'
    throw error
  }

  if (existingUser && !existingUser.passwordHash) {
    await run(
      `
        UPDATE users
        SET
          name = ?,
          password_hash = ?
        WHERE id = ?
      `,
      [displayName, passwordHash, normalizedEmail],
    )

    return getUserById(normalizedEmail)
  }

  await run(
    `
      INSERT INTO users (id, email, name, password_hash)
      VALUES (?, ?, ?, ?)
    `,
    [normalizedEmail, normalizedEmail, displayName, passwordHash],
  )

  return getUserById(normalizedEmail)
}

export async function authenticateUser({ email, password }) {
  const normalizedEmail = normalizeUserId(email)
  const user = await getUserAuthById(normalizedEmail)
  if (!user?.passwordHash) {
    return null
  }

  const validPassword = await verifyPassword(password, user.passwordHash)
  if (!validPassword) {
    return null
  }

  return getUserById(normalizedEmail)
}

export async function getStudySessionById(sessionId) {
  const row = await get(
    `
      SELECT
        id,
        user_id AS userId,
        topic,
        duration_minutes AS durationMinutes,
        status,
        scheduled_for AS scheduledFor,
        notes,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM study_sessions
      WHERE id = ?
    `,
    [sessionId],
  )

  return asSessionRow(row)
}

export async function listStudySessions({ userId, status }) {
  const whereClauses = ['user_id = ?']
  const params = [normalizeUserId(userId)]

  if (status) {
    whereClauses.push('status = ?')
    params.push(normalizeStatus(status))
  }

  const rows = await all(
    `
      SELECT
        id,
        user_id AS userId,
        topic,
        duration_minutes AS durationMinutes,
        status,
        scheduled_for AS scheduledFor,
        notes,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM study_sessions
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY created_at DESC, id DESC
    `,
    params,
  )

  return rows.map(asSessionRow)
}

export async function createStudySession({
  userId,
  topic,
  durationMinutes,
  status,
  scheduledFor,
  notes,
}) {
  const result = await run(
    `
      INSERT INTO study_sessions (
        user_id,
        topic,
        duration_minutes,
        status,
        scheduled_for,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      normalizeUserId(userId),
      sanitizeText(topic),
      durationMinutes,
      normalizeStatus(status),
      sanitizeText(scheduledFor),
      sanitizeText(notes),
    ],
  )

  return getStudySessionById(result.lastID)
}

export async function updateStudySession(sessionId, updates) {
  const assignments = []
  const params = []

  if (Object.hasOwn(updates, 'topic')) {
    const topic = sanitizeText(updates.topic)
    if (!topic) {
      throw new Error('`topic` must be a non-empty string.')
    }
    assignments.push('topic = ?')
    params.push(topic)
  }

  if (Object.hasOwn(updates, 'durationMinutes')) {
    assignments.push('duration_minutes = ?')
    params.push(updates.durationMinutes)
  }

  if (Object.hasOwn(updates, 'status')) {
    assignments.push('status = ?')
    params.push(normalizeStatus(updates.status))
  }

  if (Object.hasOwn(updates, 'scheduledFor')) {
    assignments.push('scheduled_for = ?')
    params.push(sanitizeText(updates.scheduledFor))
  }

  if (Object.hasOwn(updates, 'notes')) {
    assignments.push('notes = ?')
    params.push(sanitizeText(updates.notes))
  }

  if (assignments.length === 0) {
    return getStudySessionById(sessionId)
  }

  assignments.push("updated_at = datetime('now')")
  params.push(sessionId)

  await run(
    `
      UPDATE study_sessions
      SET ${assignments.join(', ')}
      WHERE id = ?
    `,
    params,
  )

  return getStudySessionById(sessionId)
}

export async function deleteStudySession(sessionId) {
  const result = await run(
    `
      DELETE FROM study_sessions
      WHERE id = ?
    `,
    [sessionId],
  )

  return result.changes > 0
}

export async function getStudySummary(userId) {
  const row = await get(
    `
      SELECT
        COUNT(*) AS totalSessions,
        COALESCE(SUM(duration_minutes), 0) AS totalMinutes,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completedSessions,
        COALESCE(SUM(CASE WHEN status = 'planned' THEN 1 ELSE 0 END), 0) AS plannedSessions,
        COALESCE(SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END), 0) AS skippedSessions
      FROM study_sessions
      WHERE user_id = ?
    `,
    [normalizeUserId(userId)],
  )

  const totalSessions = row?.totalSessions || 0
  const completedSessions = row?.completedSessions || 0
  const completionRate =
    totalSessions > 0 ? Number(((completedSessions / totalSessions) * 100).toFixed(1)) : 0

  return {
    totalSessions,
    totalMinutes: row?.totalMinutes || 0,
    completedSessions,
    plannedSessions: row?.plannedSessions || 0,
    skippedSessions: row?.skippedSessions || 0,
    completionRate,
  }
}

export async function listQuestions({ category, difficulty, search }) {
  const whereClauses = ['1 = 1']
  const params = []

  const normalizedCategory = sanitizeText(category)
  if (normalizedCategory) {
    whereClauses.push('LOWER(category) = LOWER(?)')
    params.push(normalizedCategory)
  }

  const normalizedDifficulty = sanitizeText(difficulty)?.toLowerCase()
  if (normalizedDifficulty) {
    whereClauses.push('difficulty = ?')
    params.push(normalizeDifficulty(normalizedDifficulty))
  }

  const normalizedSearch = sanitizeText(search)
  if (normalizedSearch) {
    whereClauses.push('(title LIKE ? OR prompt LIKE ? OR category LIKE ?)')
    const pattern = `%${normalizedSearch}%`
    params.push(pattern, pattern, pattern)
  }

  const rows = await all(
    `
      SELECT
        id,
        title,
        prompt,
        category,
        difficulty,
        ideal_seconds AS idealSeconds,
        created_at AS createdAt
      FROM questions
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY id ASC
    `,
    params,
  )

  return rows.map(asQuestionRow)
}

export async function getQuestionById(questionId) {
  const row = await get(
    `
      SELECT
        id,
        title,
        prompt,
        category,
        difficulty,
        ideal_seconds AS idealSeconds,
        created_at AS createdAt
      FROM questions
      WHERE id = ?
    `,
    [questionId],
  )

  return asQuestionRow(row)
}

export async function listQuestionCategories() {
  const rows = await all(
    `
      SELECT DISTINCT category
      FROM questions
      ORDER BY category ASC
    `,
  )

  return rows.map((row) => row.category)
}

export async function generatePracticeQuestions({
  count = 5,
  category,
  difficulty,
  topicHint,
}) {
  const normalizedCount = Math.min(25, Math.max(1, normalizePositiveInt(count) || 5))
  const normalizedCategory = sanitizeText(category)
  const normalizedDifficultyCandidate = sanitizeText(difficulty)?.toLowerCase()
  let normalizedDifficulty = null
  if (normalizedDifficultyCandidate) {
    normalizedDifficulty = normalizeDifficulty(normalizedDifficultyCandidate)
  }

  const existingCategories = await listQuestionCategories()
  const categoryPool = Array.from(
    new Set([...generatedDefaultCategories, ...existingCategories]),
  )

  const generatedRows = []
  for (let index = 0; index < normalizedCount; index += 1) {
    const selectedCategory =
      normalizedCategory || pickRandomItem(categoryPool, 'Backend')
    const selectedDifficulty =
      normalizedDifficulty || pickRandomItem(questionDifficulties, 'medium')

    let candidateQuestion = null
    if (canUseExternalQuestionGenerator()) {
      candidateQuestion = await generateQuestionViaHuggingFace({
        category: selectedCategory,
        difficulty: selectedDifficulty,
        topicHint,
      })
    }

    if (!candidateQuestion) {
      candidateQuestion = buildTemplateGeneratedQuestion({
        category: selectedCategory,
        difficulty: selectedDifficulty,
        topicHint,
      })
    }

    const row = await insertQuestionRecord(candidateQuestion)
    if (row) {
      generatedRows.push(row)
    }
  }

  return generatedRows
}

async function getQuestionForEvaluation(questionId) {
  return get(
    `
      SELECT
        id,
        expected_answer AS expectedAnswer,
        keyword_list AS keywordList,
        ideal_seconds AS idealSeconds
      FROM questions
      WHERE id = ?
    `,
    [questionId],
  )
}

export async function createQuestionAttempt({
  questionId,
  userId,
  answerText,
  timeSpentSeconds,
}) {
  const normalizedUserId = normalizeUserId(userId)
  const normalizedAnswer = sanitizeText(answerText)

  if (!normalizedAnswer) {
    throw new Error('`answerText` must be a non-empty string.')
  }

  await enforceUsageQuota({
    userId: normalizedUserId,
    metric: 'attempts',
    requested: 1,
  })

  const question = await getQuestionForEvaluation(questionId)
  if (!question) {
    return null
  }

  const keywordList = (() => {
    try {
      const parsed = JSON.parse(question.keywordList)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })()

  const evaluation = evaluateAttempt({
    answerText: normalizedAnswer,
    expectedAnswer: question.expectedAnswer,
    keywordList,
    idealSeconds: question.idealSeconds,
    timeSpentSeconds,
  })

  const result = await run(
    `
      INSERT INTO question_attempts (
        question_id,
        user_id,
        answer_text,
        time_spent_seconds,
        score,
        feedback,
        keyword_hits,
        keyword_target
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      questionId,
      normalizedUserId,
      normalizedAnswer,
      timeSpentSeconds,
      evaluation.score,
      evaluation.feedback,
      evaluation.keywordHits,
      evaluation.keywordTarget,
    ],
  )

  return getQuestionAttemptById(result.lastID)
}

export async function getQuestionAttemptById(attemptId) {
  const row = await get(
    `
      SELECT
        qa.id,
        qa.question_id AS questionId,
        qa.user_id AS userId,
        qa.answer_text AS answerText,
        qa.time_spent_seconds AS timeSpentSeconds,
        qa.score,
        qa.feedback,
        qa.keyword_hits AS keywordHits,
        qa.keyword_target AS keywordTarget,
        qa.created_at AS createdAt,
        q.title AS questionTitle,
        q.category AS questionCategory,
        q.difficulty AS questionDifficulty
      FROM question_attempts qa
      JOIN questions q ON q.id = qa.question_id
      WHERE qa.id = ?
    `,
    [attemptId],
  )

  return asAttemptRow(row)
}

export async function listQuestionAttempts({ userId, questionId, limit = 50 }) {
  const whereClauses = ['qa.user_id = ?']
  const params = [normalizeUserId(userId)]

  if (questionId) {
    whereClauses.push('qa.question_id = ?')
    params.push(questionId)
  }

  params.push(limit)

  const rows = await all(
    `
      SELECT
        qa.id,
        qa.question_id AS questionId,
        qa.user_id AS userId,
        qa.answer_text AS answerText,
        qa.time_spent_seconds AS timeSpentSeconds,
        qa.score,
        qa.feedback,
        qa.keyword_hits AS keywordHits,
        qa.keyword_target AS keywordTarget,
        qa.created_at AS createdAt,
        q.title AS questionTitle,
        q.category AS questionCategory,
        q.difficulty AS questionDifficulty
      FROM question_attempts qa
      JOIN questions q ON q.id = qa.question_id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY qa.created_at DESC, qa.id DESC
      LIMIT ?
    `,
    params,
  )

  return rows.map(asAttemptRow)
}

async function getPracticeSessionRow({ sessionId, userId }) {
  const row = await get(
    `
      SELECT
        id,
        user_id AS userId,
        title,
        status,
        source_filters AS sourceFilters,
        total_questions AS totalQuestions,
        created_at AS createdAt,
        updated_at AS updatedAt,
        completed_at AS completedAt
      FROM practice_sessions
      WHERE id = ? AND user_id = ?
    `,
    [sessionId, normalizeUserId(userId)],
  )

  return asPracticeSessionRow(row)
}

async function markPracticeSessionCompleted(sessionId) {
  await run(
    `
      UPDATE practice_sessions
      SET
        status = 'completed',
        completed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ? AND status = 'active'
    `,
    [sessionId],
  )
}

export async function getPracticeSessionWithProgress({ sessionId, userId }) {
  const session = await getPracticeSessionRow({ sessionId, userId })
  if (!session) {
    return null
  }

  const rows = await all(
    `
      SELECT
        psi.id AS sessionItemId,
        psi.sequence_index AS sequenceIndex,
        q.id AS questionId,
        q.title AS title,
        q.prompt AS prompt,
        q.category AS category,
        q.difficulty AS difficulty,
        q.ideal_seconds AS idealSeconds,
        qa.id AS attemptId,
        qa.score AS score,
        qa.feedback AS feedback,
        qa.time_spent_seconds AS timeSpentSeconds,
        qa.keyword_hits AS keywordHits,
        qa.keyword_target AS keywordTarget,
        qa.answer_text AS answerText,
        qa.created_at AS answeredAt
      FROM practice_session_items psi
      JOIN questions q ON q.id = psi.question_id
      LEFT JOIN practice_session_responses psr
        ON psr.session_item_id = psi.id
        AND psr.user_id = ?
      LEFT JOIN question_attempts qa ON qa.id = psr.attempt_id
      WHERE psi.session_id = ?
      ORDER BY psi.sequence_index ASC
    `,
    [normalizeUserId(userId), session.id],
  )

  const items = rows.map((row) => {
    const attempt = row.attemptId
      ? {
          id: row.attemptId,
          score: row.score,
          feedback: row.feedback,
          timeSpentSeconds: row.timeSpentSeconds,
          keywordHits: row.keywordHits,
          keywordTarget: row.keywordTarget,
          answerText: row.answerText,
          answeredAt: row.answeredAt,
        }
      : null

    return {
      sessionItemId: row.sessionItemId,
      sequenceIndex: row.sequenceIndex,
      questionId: row.questionId,
      title: row.title,
      prompt: row.prompt,
      category: row.category,
      difficulty: row.difficulty,
      idealSeconds: row.idealSeconds,
      answered: Boolean(attempt),
      attempt,
    }
  })

  const answeredQuestions = items.filter((item) => item.answered).length
  const nextQuestionIndex = items.findIndex((item) => !item.answered)
  const isCompleted =
    session.totalQuestions > 0 && answeredQuestions >= session.totalQuestions
  const progressPercent =
    session.totalQuestions > 0
      ? Number(((answeredQuestions / session.totalQuestions) * 100).toFixed(1))
      : 0

  let status = session.status
  if (isCompleted && session.status !== 'completed') {
    await markPracticeSessionCompleted(session.id)
    status = 'completed'
  }

  return {
    ...session,
    status,
    answeredQuestions,
    progressPercent,
    isCompleted,
    nextQuestionIndex: nextQuestionIndex === -1 ? null : nextQuestionIndex,
    items,
  }
}

export async function createPracticeSession({
  userId,
  title,
  questionCount,
  filters = {},
}) {
  const normalizedUserId = normalizeUserId(userId)
  const normalizedCount = normalizePositiveInt(questionCount) || 5

  await enforceUsageQuota({
    userId: normalizedUserId,
    metric: 'practiceSessions',
    requested: 1,
  })
  await enforceUsageQuota({
    userId: normalizedUserId,
    metric: 'maxQuestionsPerSession',
    requested: normalizedCount,
  })

  const normalizedFilters = {
    category: sanitizeCategory(filters.category),
    difficulty: sanitizeDifficulty(filters.difficulty),
    search: sanitizeNullableText(filters.search),
  }

  let availableQuestions = await listQuestions({
    category: normalizedFilters.category,
    difficulty: normalizedFilters.difficulty,
    search: normalizedFilters.search,
  })

  if (availableQuestions.length < normalizedCount) {
    const generationTarget = Math.max(
      1,
      normalizedCount - availableQuestions.length,
    )
    await generatePracticeQuestions({
      count: generationTarget,
      category: normalizedFilters.category,
      difficulty: normalizedFilters.difficulty,
      topicHint: normalizedFilters.search,
    })

    availableQuestions = await listQuestions({
      category: normalizedFilters.category,
      difficulty: normalizedFilters.difficulty,
      search: normalizedFilters.search,
    })
  }

  if (availableQuestions.length === 0) {
    const error = new Error('No questions found and auto-generation failed.')
    error.code = 'NO_QUESTIONS'
    throw error
  }

  const selectedQuestions = shuffleArray(availableQuestions).slice(
    0,
    Math.min(normalizedCount, availableQuestions.length),
  )

  if (selectedQuestions.length === 0) {
    const error = new Error('Unable to generate session with zero questions.')
    error.code = 'NO_QUESTIONS'
    throw error
  }

  const sessionTitle =
    sanitizeText(title) ||
    `Practice Session (${selectedQuestions.length} questions)`

  const sourceFilters = JSON.stringify({
    ...normalizedFilters,
    requestedCount: normalizedCount,
    generatedCount: selectedQuestions.length,
  })

  let sessionId = null
  await execute('BEGIN')
  try {
    const sessionResult = await run(
      `
        INSERT INTO practice_sessions (
          user_id,
          title,
          status,
          source_filters,
          total_questions
        )
        VALUES (?, ?, 'active', ?, ?)
      `,
      [normalizedUserId, sessionTitle, sourceFilters, selectedQuestions.length],
    )

    sessionId = sessionResult.lastID

    for (let index = 0; index < selectedQuestions.length; index += 1) {
      const question = selectedQuestions[index]
      await run(
        `
          INSERT INTO practice_session_items (
            session_id,
            question_id,
            sequence_index
          )
          VALUES (?, ?, ?)
        `,
        [sessionId, question.id, index],
      )
    }

    await execute('COMMIT')
  } catch (error) {
    await execute('ROLLBACK')
    throw error
  }

  return getPracticeSessionWithProgress({
    sessionId,
    userId: normalizedUserId,
  })
}

export async function submitPracticeSessionAttempt({
  sessionId,
  userId,
  questionId,
  answerText,
  timeSpentSeconds,
}) {
  const normalizedUserId = normalizeUserId(userId)
  const session = await getPracticeSessionWithProgress({
    sessionId,
    userId: normalizedUserId,
  })

  if (!session) {
    return null
  }

  if (session.isCompleted) {
    const error = new Error('This session is already completed.')
    error.code = 'SESSION_COMPLETED'
    throw error
  }

  const nextQuestion = session.items.find((item) => !item.answered)
  if (!nextQuestion) {
    const error = new Error('No remaining questions in this session.')
    error.code = 'SESSION_COMPLETED'
    throw error
  }

  if (Number(questionId) !== nextQuestion.questionId) {
    const error = new Error(
      `Answer questions in order. Next question id is ${nextQuestion.questionId}.`,
    )
    error.code = 'OUT_OF_SEQUENCE'
    throw error
  }

  const attempt = await createQuestionAttempt({
    questionId: nextQuestion.questionId,
    userId: normalizedUserId,
    answerText,
    timeSpentSeconds,
  })

  if (!attempt) {
    const error = new Error('Question not found.')
    error.code = 'QUESTION_NOT_FOUND'
    throw error
  }

  try {
    await run(
      `
        INSERT INTO practice_session_responses (
          session_id,
          session_item_id,
          user_id,
          attempt_id
        )
        VALUES (?, ?, ?, ?)
      `,
      [session.id, nextQuestion.sessionItemId, normalizedUserId, attempt.id],
    )
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      const duplicateError = new Error('This question has already been answered.')
      duplicateError.code = 'ALREADY_ANSWERED'
      throw duplicateError
    }
    throw error
  }

  await run(
    `
      UPDATE practice_sessions
      SET updated_at = datetime('now')
      WHERE id = ?
    `,
    [session.id],
  )

  const updatedSession = await getPracticeSessionWithProgress({
    sessionId: session.id,
    userId: normalizedUserId,
  })

  const report = updatedSession?.isCompleted
    ? await getPracticeSessionReport({
        sessionId: session.id,
        userId: normalizedUserId,
      })
    : null

  return {
    attempt,
    session: updatedSession,
    report,
  }
}

export async function getPracticeSessionReport({ sessionId, userId }) {
  const session = await getPracticeSessionWithProgress({ sessionId, userId })
  if (!session) {
    return null
  }

  const answeredItems = session.items.filter((item) => item.answered && item.attempt)
  const completionRate =
    session.totalQuestions > 0
      ? Number(((answeredItems.length / session.totalQuestions) * 100).toFixed(1))
      : 0

  if (answeredItems.length === 0) {
    return {
      sessionId: session.id,
      title: session.title,
      status: session.status,
      isFinal: session.isCompleted,
      totalQuestions: session.totalQuestions,
      answeredQuestions: 0,
      completionRate,
      overallScore: 0,
      scoreBand: scoreBand(0),
      totalTimeSeconds: 0,
      overallKeywordCoverage: 0,
      strengths: [],
      weaknesses: ['No answered questions yet. Submit at least one response.'],
      strongestCategory: null,
      weakestCategory: null,
      categoryPerformance: [],
      questionBreakdown: session.items.map((item) => ({
        sequenceIndex: item.sequenceIndex,
        questionId: item.questionId,
        title: item.title,
        category: item.category,
        difficulty: item.difficulty,
        answered: false,
      })),
    }
  }

  const totalScore = answeredItems.reduce(
    (sum, item) => sum + (Number(item.attempt.score) || 0),
    0,
  )
  const totalTimeSeconds = answeredItems.reduce(
    (sum, item) => sum + (Number(item.attempt.timeSpentSeconds) || 0),
    0,
  )

  const keywordCoverages = answeredItems.map((item) => {
    const hits = Number(item.attempt.keywordHits) || 0
    const target = Number(item.attempt.keywordTarget) || 0
    if (target <= 0) {
      return 100
    }
    return (hits / target) * 100
  })

  const categoryAccumulator = new Map()
  let overPaceCount = 0
  let underPaceCount = 0

  for (const item of answeredItems) {
    const score = Number(item.attempt.score) || 0
    const timeSpent = Number(item.attempt.timeSpentSeconds) || 0
    const keywordCoverage =
      Number(item.attempt.keywordTarget) > 0
        ? ((Number(item.attempt.keywordHits) || 0) /
            (Number(item.attempt.keywordTarget) || 1)) *
          100
        : 100

    const existing = categoryAccumulator.get(item.category) || {
      category: item.category,
      attempts: 0,
      totalScore: 0,
      totalTimeSeconds: 0,
      totalKeywordCoverage: 0,
      lowScoreCount: 0,
    }

    existing.attempts += 1
    existing.totalScore += score
    existing.totalTimeSeconds += timeSpent
    existing.totalKeywordCoverage += keywordCoverage
    if (score < 65) {
      existing.lowScoreCount += 1
    }
    categoryAccumulator.set(item.category, existing)

    if (item.idealSeconds > 0) {
      if (timeSpent > item.idealSeconds * 1.3) {
        overPaceCount += 1
      } else if (timeSpent < item.idealSeconds * 0.6) {
        underPaceCount += 1
      }
    }
  }

  const categoryPerformance = Array.from(categoryAccumulator.values())
    .map((item) => ({
      category: item.category,
      attempts: item.attempts,
      averageScore: Number((item.totalScore / item.attempts).toFixed(1)),
      averageTimeSeconds: Number((item.totalTimeSeconds / item.attempts).toFixed(1)),
      keywordCoverage: Number((item.totalKeywordCoverage / item.attempts).toFixed(1)),
      lowScoreCount: item.lowScoreCount,
    }))
    .sort((a, b) => b.averageScore - a.averageScore || b.attempts - a.attempts)

  const strongestCategory = categoryPerformance[0] || null
  const weakestCategory =
    categoryPerformance.length > 1
      ? categoryPerformance[categoryPerformance.length - 1]
      : categoryPerformance[0] || null

  const overallScore = Number((totalScore / answeredItems.length).toFixed(1))
  const overallKeywordCoverage = Number(
    (
      keywordCoverages.reduce((sum, value) => sum + value, 0) /
      keywordCoverages.length
    ).toFixed(1),
  )

  const lowQuestionBreakdown = [...answeredItems]
    .sort(
      (a, b) =>
        (Number(a.attempt.score) || 0) - (Number(b.attempt.score) || 0),
    )
    .slice(0, 3)

  const strengths = []
  if (overallScore >= 75) {
    strengths.push(`Overall session score is ${overallScore}, which is above target.`)
  }
  if (strongestCategory && strongestCategory.averageScore >= 75) {
    strengths.push(
      `${strongestCategory.category} is a strong area (${strongestCategory.averageScore} avg).`,
    )
  }
  if (overallKeywordCoverage >= 75) {
    strengths.push(
      `Concept coverage is solid (${overallKeywordCoverage}% keyword coverage).`,
    )
  }

  const weaknesses = []
  if (weakestCategory && weakestCategory.averageScore < 70) {
    weaknesses.push(
      `${weakestCategory.category} is the weakest category (${weakestCategory.averageScore} avg).`,
    )
  }
  if (overallKeywordCoverage < 65) {
    weaknesses.push(
      `Keyword coverage is low (${overallKeywordCoverage}%). Add more core concepts in responses.`,
    )
  }
  if (overPaceCount > answeredItems.length / 2) {
    weaknesses.push('Most answers exceeded ideal time. Focus on tighter response structure.')
  }
  if (underPaceCount > answeredItems.length / 2) {
    weaknesses.push('Most answers were too brief. Add depth and examples.')
  }
  if (lowQuestionBreakdown[0] && (Number(lowQuestionBreakdown[0].attempt.score) || 0) < 60) {
    const weakTitles = lowQuestionBreakdown
      .filter((item) => (Number(item.attempt.score) || 0) < 60)
      .map((item) => item.title)
      .slice(0, 2)
    if (weakTitles.length > 0) {
      weaknesses.push(`Revisit low-scoring questions: ${weakTitles.join(', ')}.`)
    }
  }
  if (weaknesses.length === 0) {
    weaknesses.push('No major weaknesses detected. Keep practicing for consistency.')
  }

  return {
    sessionId: session.id,
    title: session.title,
    status: session.status,
    isFinal: session.isCompleted,
    totalQuestions: session.totalQuestions,
    answeredQuestions: answeredItems.length,
    completionRate,
    overallScore,
    scoreBand: scoreBand(overallScore),
    totalTimeSeconds,
    overallKeywordCoverage,
    strongestCategory: strongestCategory
      ? {
          category: strongestCategory.category,
          averageScore: strongestCategory.averageScore,
        }
      : null,
    weakestCategory: weakestCategory
      ? {
          category: weakestCategory.category,
          averageScore: weakestCategory.averageScore,
        }
      : null,
    strengths,
    weaknesses,
    categoryPerformance,
    questionBreakdown: session.items.map((item) => ({
      sequenceIndex: item.sequenceIndex,
      questionId: item.questionId,
      title: item.title,
      category: item.category,
      difficulty: item.difficulty,
      answered: item.answered,
      score: item.attempt?.score ?? null,
      timeSpentSeconds: item.attempt?.timeSpentSeconds ?? null,
      keywordCoverage:
        item.attempt && Number(item.attempt.keywordTarget) > 0
          ? Number(
              (
                ((Number(item.attempt.keywordHits) || 0) /
                  Number(item.attempt.keywordTarget)) *
                100
              ).toFixed(1),
            )
          : item.answered
            ? 100
            : null,
      feedback: item.attempt?.feedback ?? null,
    })),
  }
}

export async function getQuestionAttemptSummary(userId) {
  const normalizedUserId = normalizeUserId(userId)
  const row = await get(
    `
      SELECT
        COUNT(*) AS totalAttempts,
        COALESCE(AVG(score), 0) AS averageScore,
        COALESCE(MAX(score), 0) AS bestScore,
        COALESCE(SUM(time_spent_seconds), 0) AS totalTimeSeconds
      FROM question_attempts
      WHERE user_id = ?
    `,
    [normalizedUserId],
  )

  const difficultyBreakdownRows = await all(
    `
      SELECT
        q.difficulty AS difficulty,
        COUNT(*) AS attempts,
        COALESCE(ROUND(AVG(qa.score), 1), 0) AS averageScore
      FROM question_attempts qa
      JOIN questions q ON q.id = qa.question_id
      WHERE qa.user_id = ?
      GROUP BY q.difficulty
      ORDER BY
        CASE q.difficulty
          WHEN 'easy' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'hard' THEN 3
          ELSE 4
        END
    `,
    [normalizedUserId],
  )

  const categoryBreakdownRows = await all(
    `
      SELECT
        q.category AS category,
        COUNT(*) AS attempts
      FROM question_attempts qa
      JOIN questions q ON q.id = qa.question_id
      WHERE qa.user_id = ?
      GROUP BY q.category
      ORDER BY attempts DESC, q.category ASC
      LIMIT 6
    `,
    [normalizedUserId],
  )

  const categoryPerformanceRows = await all(
    `
      SELECT
        q.category AS category,
        COUNT(*) AS attempts,
        COALESCE(ROUND(AVG(qa.score), 1), 0) AS averageScore,
        COALESCE(MAX(qa.score), 0) AS bestScore,
        COALESCE(ROUND(AVG(qa.time_spent_seconds), 1), 0) AS averageTimeSeconds
      FROM question_attempts qa
      JOIN questions q ON q.id = qa.question_id
      WHERE qa.user_id = ?
      GROUP BY q.category
      ORDER BY averageScore DESC, attempts DESC, q.category ASC
    `,
    [normalizedUserId],
  )

  const scoreTrendRows = await all(
    `
      SELECT
        qa.id AS attemptId,
        qa.score AS score,
        qa.created_at AS createdAt,
        q.title AS questionTitle
      FROM question_attempts qa
      JOIN questions q ON q.id = qa.question_id
      WHERE qa.user_id = ?
      ORDER BY qa.created_at DESC, qa.id DESC
      LIMIT 12
    `,
    [normalizedUserId],
  )

  const activityByDayRows = await all(
    `
      SELECT
        DATE(qa.created_at) AS date,
        COUNT(*) AS attempts,
        COALESCE(ROUND(AVG(qa.score), 1), 0) AS averageScore
      FROM question_attempts qa
      WHERE qa.user_id = ?
      GROUP BY DATE(qa.created_at)
      ORDER BY date DESC
      LIMIT 30
    `,
    [normalizedUserId],
  )

  const streak = calculateStreakData(activityByDayRows)
  const scoreTrend = [...scoreTrendRows].reverse()
  const activityByDay = [...activityByDayRows].reverse()

  return {
    totalAttempts: row?.totalAttempts || 0,
    averageScore: Number(Number(row?.averageScore || 0).toFixed(1)),
    bestScore: row?.bestScore || 0,
    totalTimeSeconds: row?.totalTimeSeconds || 0,
    difficultyBreakdown: difficultyBreakdownRows.map((item) => ({
      difficulty: item.difficulty,
      attempts: item.attempts,
      averageScore: item.averageScore,
    })),
    categoryBreakdown: categoryBreakdownRows.map((item) => ({
      category: item.category,
      attempts: item.attempts,
    })),
    categoryPerformance: categoryPerformanceRows.map((item) => ({
      category: item.category,
      attempts: item.attempts,
      averageScore: item.averageScore,
      bestScore: item.bestScore,
      averageTimeSeconds: item.averageTimeSeconds,
    })),
    scoreTrend: scoreTrend.map((item) => ({
      attemptId: item.attemptId,
      score: item.score,
      createdAt: item.createdAt,
      questionTitle: item.questionTitle,
    })),
    activityByDay: activityByDay.map((item) => ({
      date: item.date,
      attempts: item.attempts,
      averageScore: item.averageScore,
    })),
    streak,
  }
}

export async function ensureUserExists({ userId, name }) {
  const normalizedUserId = normalizeUserId(userId)
  const existingUser = await getUserById(normalizedUserId)

  if (existingUser) {
    return existingUser
  }

  return upsertUser({ email: normalizedUserId, name })
}

export function normalizeSeconds(value) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null
  }

  return parsed
}

export function normalizePositiveInt(value) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

export function sanitizeCategory(value) {
  return sanitizeNullableText(value)
}

export function sanitizeDifficulty(value) {
  const normalizedDifficulty = sanitizeNullableText(value)?.toLowerCase()
  if (!normalizedDifficulty) {
    return null
  }

  return normalizeDifficulty(normalizedDifficulty)
}

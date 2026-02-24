import cors from 'cors'
import express from 'express'
import {
  authenticateUser,
  billingPlanTiers,
  closeDatabase,
  createPracticeSession,
  createUserWithPassword,
  createQuestionAttempt,
  createStudySession,
  deleteUserById,
  deleteStudySession,
  ensureUserExists,
  getPracticeSessionReport,
  getPracticeSessionWithProgress,
  getQuestionGenerationCapabilities,
  getQuestionAttemptSummary,
  getQuestionById,
  getBillingSummary,
  getStudySessionById,
  getStudySummary,
  getUserBillingProfile,
  getUserByStripeCustomerId,
  getUserById,
  initDatabase,
  listBillingPlans,
  listQuestionAttempts,
  listQuestionCategories,
  listQuestions,
  generatePracticeQuestions,
  listStudySessions,
  listUsers,
  normalizePositiveInt,
  normalizeSeconds,
  sanitizeCategory,
  sanitizeDifficulty,
  sessionStatuses,
  submitPracticeSessionAttempt,
  updateUserBillingProfile,
  updateStudySession,
  upsertUser,
} from './db.js'

const app = express()
const port = Number(process.env.PORT || 4000)
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173'
const appBaseUrl = process.env.APP_BASE_URL || 'http://localhost:5173'
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || ''
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || ''
const stripePriceByPlan = {
  pro: process.env.STRIPE_PRICE_PRO_MONTHLY || '',
}

let server = null
let stripeClientPromise = null

function asyncHandler(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next)
  }
}

function parsePositiveInt(value) {
  return normalizePositiveInt(value)
}

function asOptionalString(value) {
  if (value === null || value === undefined) {
    return undefined
  }

  return typeof value === 'string' ? value : undefined
}

function asOptionalNullableString(value) {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return null
  }

  return typeof value === 'string' ? value : undefined
}

function requiredTrimmedString(value) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readPassword(value) {
  if (typeof value !== 'string') {
    return null
  }

  return value
}

function isSupportedStatus(status) {
  return sessionStatuses.includes(status)
}

function isSupportedPlanTier(value) {
  return billingPlanTiers.includes(value)
}

function toIsoFromUnixTimestamp(value) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null
  }
  return new Date(numericValue * 1000).toISOString()
}

function mapStripeSubscriptionStatus(status) {
  const normalizedStatus = String(status || '').trim().toLowerCase()
  if (
    normalizedStatus === 'active' ||
    normalizedStatus === 'trialing' ||
    normalizedStatus === 'past_due' ||
    normalizedStatus === 'unpaid' ||
    normalizedStatus === 'canceled'
  ) {
    return normalizedStatus
  }

  return 'inactive'
}

function resolvePlanTierFromPriceId(priceId) {
  if (!priceId) {
    return null
  }

  const normalizedPriceId = String(priceId)
  const matchedPlanTier = Object.entries(stripePriceByPlan).find(
    ([, knownPriceId]) => knownPriceId && knownPriceId === normalizedPriceId,
  )?.[0]

  return matchedPlanTier || null
}

function resolveStripePriceForPlan(planTier) {
  if (!isSupportedPlanTier(planTier)) {
    return null
  }
  return stripePriceByPlan[planTier] || null
}

function normalizeAssistantText(value) {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim()
}

function tokenizeAssistantKeywords(value) {
  const stopWords = new Set([
    'the',
    'and',
    'with',
    'that',
    'this',
    'from',
    'your',
    'have',
    'will',
    'for',
    'you',
    'our',
    'their',
    'about',
    'into',
    'through',
    'using',
    'while',
    'when',
    'where',
    'which',
    'should',
    'could',
    'would',
    'able',
    'team',
    'work',
    'role',
    'year',
    'years',
  ])

  const normalized = normalizeAssistantText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
  const words = normalized
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word))

  return Array.from(new Set(words))
}

function createResumeChecklistItems(resumeText) {
  const normalizedResume = normalizeAssistantText(resumeText).toLowerCase()
  const sections = [
    { id: 'summary', label: 'Professional summary' },
    { id: 'experience', label: 'Experience with impact bullets' },
    { id: 'projects', label: 'Projects aligned to role' },
    { id: 'skills', label: 'Skills stack section' },
    { id: 'education', label: 'Education / certifications' },
  ]

  return sections.map((item) => ({
    label: item.label,
    done: normalizedResume.includes(item.id),
  }))
}

function createResumeBulletRewrite(resumeText, missingKeywords) {
  const lines = normalizeAssistantText(resumeText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const bullet =
    lines.find((line) => /^[-*•]\s+/.test(line)) ||
    lines.find((line) => line.split(' ').length > 8) ||
    ''

  if (!bullet) {
    return ''
  }

  const cleaned = bullet.replace(/^[-*•]\s+/, '').replace(/[.]+$/, '')
  const keyword = missingKeywords[0] || 'business outcomes'
  return `Led ${cleaned} by applying ${keyword}, improving [metric] by [X%] in [timeframe].`
}

function buildResumeAssistantData({
  message,
  targetRole,
  jobDescription,
  resumeText,
}) {
  const normalizedMessage = normalizeAssistantText(message).toLowerCase()
  const normalizedTargetRole = normalizeAssistantText(targetRole)
  const normalizedJobDescription = normalizeAssistantText(jobDescription)
  const normalizedResumeText = normalizeAssistantText(resumeText)
  const checklist = createResumeChecklistItems(normalizedResumeText)

  if (!normalizedResumeText) {
    return {
      reply:
        'Paste your resume text and I will tune it section-by-section, rewrite bullets, and align it with your target role.',
      atsMatchScore: 0,
      matchedKeywords: [],
      missingKeywords: tokenizeAssistantKeywords(
        `${normalizedTargetRole} ${normalizedJobDescription}`,
      ).slice(0, 8),
      checklist,
      rewrittenBullet: '',
      summaryDraft: '',
      nextSteps: [
        'Add a one-line target role summary.',
        'Use bullets with measurable outcomes.',
        'Mirror key terms from the JD in Experience and Skills.',
      ],
    }
  }

  const sourceKeywords = tokenizeAssistantKeywords(
    `${normalizedTargetRole} ${normalizedJobDescription}`,
  )
  const resumeKeywords = tokenizeAssistantKeywords(normalizedResumeText)
  const resumeKeywordSet = new Set(resumeKeywords)
  const matchedKeywords = sourceKeywords.filter((keyword) =>
    resumeKeywordSet.has(keyword),
  )
  const missingKeywords = sourceKeywords
    .filter((keyword) => !resumeKeywordSet.has(keyword))
    .slice(0, 8)
  const atsMatchScore = sourceKeywords.length
    ? Math.max(
        18,
        Math.min(99, Math.round((matchedKeywords.length / sourceKeywords.length) * 100)),
      )
    : Math.max(42, Math.min(92, 52 + Math.round(Math.min(25, resumeKeywords.length))))
  const rewrittenBullet = createResumeBulletRewrite(normalizedResumeText, missingKeywords)
  const quantifiedBulletCount = normalizedResumeText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*•]\s+/.test(line) && /(\d+%|\d+x|\$\d+)/i.test(line)).length
  const pendingChecklistItems = checklist.filter((item) => !item.done)
  const nextSteps = [
    missingKeywords.length
      ? `Inject missing JD keywords: ${missingKeywords.slice(0, 4).join(', ')}.`
      : 'Keyword alignment looks strong. Focus on clarity and impact ordering.',
    quantifiedBulletCount > 0
      ? 'Expand quantified bullets into top two projects for stronger credibility.'
      : 'Add metrics to at least 3 bullets (%, cost, speed, or scale).',
    pendingChecklistItems.length
      ? `Complete core sections: ${pendingChecklistItems
          .map((item) => item.label)
          .slice(0, 2)
          .join(', ')}.`
      : 'Core structure is complete. Refine phrasing and keep bullets concise.',
  ]
  const asksForSummary =
    normalizedMessage.includes('summary') || normalizedMessage.includes('about me')
  const summaryDraft = asksForSummary
    ? `Results-driven ${normalizedTargetRole || 'candidate'} with experience in ${matchedKeywords
        .slice(0, 3)
        .join(', ') || 'software delivery'}, focused on measurable outcomes and cross-functional execution.`
    : ''
  const replyParts = [
    `Estimated ATS match is ${atsMatchScore}%.`,
    missingKeywords.length
      ? `Top missing keywords: ${missingKeywords.slice(0, 5).join(', ')}.`
      : 'Keyword alignment is solid for this target context.',
    summaryDraft ? `Suggested summary: ${summaryDraft}` : '',
    rewrittenBullet ? `Sample bullet rewrite: ${rewrittenBullet}` : '',
  ].filter(Boolean)

  return {
    reply: replyParts.join(' '),
    atsMatchScore,
    matchedKeywords: matchedKeywords.slice(0, 10),
    missingKeywords,
    checklist,
    rewrittenBullet,
    summaryDraft,
    nextSteps,
  }
}

async function getStripeClient() {
  if (!stripeSecretKey) {
    return null
  }

  if (!stripeClientPromise) {
    stripeClientPromise = import('stripe')
      .then((module) => {
        const Stripe = module.default
        return new Stripe(stripeSecretKey)
      })
      .catch((error) => {
        const wrappedError = new Error(
          'Stripe SDK is not installed. Run `npm install stripe` before enabling billing.',
        )
        wrappedError.code = 'STRIPE_SDK_MISSING'
        wrappedError.cause = error
        throw wrappedError
      })
  }

  return stripeClientPromise
}

app.use(cors({ origin: corsOrigin }))
app.use(
  express.json({
    verify: (request, response, buffer) => {
      if (request.originalUrl === '/api/billing/webhook') {
        request.rawBody = Buffer.from(buffer)
      }
    },
  }),
)

app.get('/', (request, response) => {
  response.json({
    service: 'PrepWise API',
    status: 'ok',
    docs: {
      health: '/api/health',
      note: 'Frontend runs on http://localhost:5173 during development.',
    },
  })
})

app.get('/.well-known/appspecific/com.chrome.devtools.json', (request, response) => {
  // Chrome devtools probes this path; return an empty JSON payload to avoid noisy 404/CSP errors.
  response.json({})
})

app.get('/favicon.ico', (request, response) => {
  // Browser default favicon probe for API origin; return no content to avoid 404 noise.
  response.status(204).end()
})

app.get(
  '/api/health',
  asyncHandler(async (request, response) => {
    const users = await listUsers()
    response.json({
      status: 'ok',
      database: 'connected',
      userCount: users.length,
      timestamp: new Date().toISOString(),
    })
  }),
)

app.get(
  '/api/users',
  asyncHandler(async (request, response) => {
    const users = await listUsers()
    response.json({ data: users })
  }),
)

app.get(
  '/api/users/:userId',
  asyncHandler(async (request, response) => {
    const user = await getUserById(request.params.userId)
    if (!user) {
      response.status(404).json({ message: 'User not found.' })
      return
    }

    response.json({ data: user })
  }),
)

app.delete(
  '/api/users/:userId',
  asyncHandler(async (request, response) => {
    const userId = requiredTrimmedString(request.params.userId)
    if (!userId) {
      response.status(400).json({ message: 'Invalid user id.' })
      return
    }

    const deleted = await deleteUserById(userId)
    if (!deleted) {
      response.status(404).json({ message: 'User not found.' })
      return
    }

    response.status(204).send()
  }),
)

app.post(
  '/api/users',
  asyncHandler(async (request, response) => {
    const email = requiredTrimmedString(request.body?.email)
    const name = asOptionalString(request.body?.name)
    const hasAvatarField = Object.hasOwn(request.body || {}, 'avatarUrl')
    const avatarUrl = hasAvatarField
      ? asOptionalNullableString(request.body?.avatarUrl)
      : undefined

    if (!email) {
      response.status(400).json({ message: '`email` is required.' })
      return
    }

    if (hasAvatarField && avatarUrl === undefined) {
      response.status(400).json({
        message: '`avatarUrl` must be a string or null.',
      })
      return
    }

    const existingUser = await getUserById(email)
    const user = await upsertUser({ email, name, avatarUrl })
    response.status(existingUser ? 200 : 201).json({ data: user })
  }),
)

app.post(
  '/api/auth/signup',
  asyncHandler(async (request, response) => {
    const email = requiredTrimmedString(request.body?.email)
    const name = asOptionalString(request.body?.name)
    const password = readPassword(request.body?.password)

    if (!email || !password) {
      response.status(400).json({
        message: '`email` and `password` are required.',
      })
      return
    }

    if (password.length < 8) {
      response.status(400).json({
        message: 'Password must be at least 8 characters long.',
      })
      return
    }

    try {
      const user = await createUserWithPassword({ email, name, password })
      response.status(201).json({ data: user })
    } catch (error) {
      if (error?.code === 'USER_EXISTS') {
        response.status(409).json({ message: error.message })
        return
      }
      throw error
    }
  }),
)

app.post(
  '/api/auth/signin',
  asyncHandler(async (request, response) => {
    const email = requiredTrimmedString(request.body?.email)
    const password = readPassword(request.body?.password)

    if (!email || !password) {
      response.status(400).json({
        message: '`email` and `password` are required.',
      })
      return
    }

    const user = await authenticateUser({ email, password })
    if (!user) {
      response.status(401).json({ message: 'Invalid email or password.' })
      return
    }

    response.json({ data: user })
  }),
)

app.get(
  '/api/billing/plans',
  asyncHandler(async (request, response) => {
    response.json({
      data: listBillingPlans(),
      meta: {
        stripeConfigured: Boolean(stripeSecretKey),
      },
    })
  }),
)

app.get(
  '/api/billing/summary/:userId',
  asyncHandler(async (request, response) => {
    const userId = requiredTrimmedString(request.params.userId)
    if (!userId) {
      response.status(400).json({ message: 'Invalid user id.' })
      return
    }

    await ensureUserExists({
      userId,
      name: userId.split('@')[0] || 'Learner',
    })

    const summary = await getBillingSummary(userId)
    if (!summary) {
      response.status(404).json({ message: 'User not found.' })
      return
    }

    response.json({
      data: summary,
      meta: {
        stripeConfigured: Boolean(stripeSecretKey),
      },
    })
  }),
)

app.post(
  '/api/billing/checkout',
  asyncHandler(async (request, response) => {
    const userId = requiredTrimmedString(request.body?.userId)
    const requestedPlanTier =
      asOptionalString(request.body?.planTier)?.trim().toLowerCase() || 'pro'

    if (!userId) {
      response.status(400).json({ message: '`userId` is required.' })
      return
    }

    if (!isSupportedPlanTier(requestedPlanTier) || requestedPlanTier === 'free') {
      response.status(400).json({
        message: 'Only paid plan upgrades can be started through checkout.',
      })
      return
    }

    const stripe = await getStripeClient()
    if (!stripe) {
      response.status(503).json({
        message:
          'Stripe is not configured. Set STRIPE_SECRET_KEY and price IDs to enable checkout.',
      })
      return
    }

    const stripePriceId = resolveStripePriceForPlan(requestedPlanTier)
    if (!stripePriceId) {
      response.status(503).json({
        message: `Missing Stripe price id for "${requestedPlanTier}" plan.`,
      })
      return
    }

    const user = await getUserBillingProfile(userId)
    if (!user) {
      response.status(404).json({ message: 'User not found.' })
      return
    }

    let stripeCustomerId = user.stripeCustomerId
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: {
          userId: user.id,
        },
      })

      stripeCustomerId = customer.id
      await updateUserBillingProfile(user.id, {
        stripeCustomerId,
      })
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [
        {
          price: stripePriceId,
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      client_reference_id: user.id,
      metadata: {
        userId: user.id,
        planTier: requestedPlanTier,
      },
      subscription_data: {
        metadata: {
          userId: user.id,
          planTier: requestedPlanTier,
        },
      },
      success_url: `${appBaseUrl}/settings?checkout=success`,
      cancel_url: `${appBaseUrl}/settings?checkout=cancel`,
    })

    response.status(201).json({
      data: {
        id: checkoutSession.id,
        url: checkoutSession.url,
      },
    })
  }),
)

app.post(
  '/api/billing/portal',
  asyncHandler(async (request, response) => {
    const userId = requiredTrimmedString(request.body?.userId)
    if (!userId) {
      response.status(400).json({ message: '`userId` is required.' })
      return
    }

    const stripe = await getStripeClient()
    if (!stripe) {
      response.status(503).json({
        message:
          'Stripe is not configured. Set STRIPE_SECRET_KEY to enable customer portal.',
      })
      return
    }

    const user = await getUserBillingProfile(userId)
    if (!user) {
      response.status(404).json({ message: 'User not found.' })
      return
    }

    if (!user.stripeCustomerId) {
      response.status(409).json({
        message:
          'No Stripe customer found for this account. Start checkout before opening the billing portal.',
      })
      return
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${appBaseUrl}/settings`,
    })

    response.status(201).json({
      data: {
        url: portalSession.url,
      },
    })
  }),
)

app.post(
  '/api/billing/webhook',
  asyncHandler(async (request, response) => {
    const stripe = await getStripeClient()
    if (!stripe) {
      response.status(503).json({
        message:
          'Stripe is not configured. Set STRIPE_SECRET_KEY before using webhooks.',
      })
      return
    }

    let event = request.body
    if (stripeWebhookSecret) {
      const signature = request.headers['stripe-signature']
      if (!signature || !request.rawBody) {
        response.status(400).json({
          message: 'Missing Stripe signature or raw payload.',
        })
        return
      }

      try {
        event = stripe.webhooks.constructEvent(
          request.rawBody,
          signature,
          stripeWebhookSecret,
        )
      } catch {
        response.status(400).json({
          message: 'Invalid Stripe webhook signature.',
        })
        return
      }
    }

    const payload = event?.data?.object
    if (!payload) {
      response.status(400).json({
        message: 'Webhook payload is missing event data.',
      })
      return
    }

    if (event.type === 'checkout.session.completed') {
      const userIdFromSession = payload.client_reference_id || payload.metadata?.userId
      const planTierFromSession = payload.metadata?.planTier || 'pro'
      const normalizedPlanTier = isSupportedPlanTier(planTierFromSession)
        ? planTierFromSession
        : 'pro'

      if (userIdFromSession) {
        await updateUserBillingProfile(userIdFromSession, {
          planTier: normalizedPlanTier,
          billingStatus: 'active',
          stripeCustomerId: payload.customer || null,
          stripeSubscriptionId: payload.subscription || null,
        })
      }
    } else if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const stripeCustomerId = payload.customer || null
      const user = stripeCustomerId
        ? await getUserByStripeCustomerId(stripeCustomerId)
        : null

      if (user) {
        const itemPriceId = payload.items?.data?.[0]?.price?.id
        const mappedPlanTier = resolvePlanTierFromPriceId(itemPriceId)
        const subscriptionStatus = mapStripeSubscriptionStatus(payload.status)
        const shouldBeFreePlan =
          event.type === 'customer.subscription.deleted' ||
          subscriptionStatus === 'canceled'

        await updateUserBillingProfile(user.id, {
          planTier: shouldBeFreePlan ? 'free' : mappedPlanTier || user.planTier,
          billingStatus: shouldBeFreePlan ? 'inactive' : subscriptionStatus,
          stripeCustomerId: stripeCustomerId || user.stripeCustomerId || null,
          stripeSubscriptionId: shouldBeFreePlan ? null : payload.id || null,
          billingPeriodEnd: toIsoFromUnixTimestamp(payload.current_period_end),
        })
      }
    }

    response.json({ received: true })
  }),
)

app.get(
  '/api/questions',
  asyncHandler(async (request, response) => {
    const category = sanitizeCategory(request.query.category)
    let difficulty = null
    try {
      difficulty = sanitizeDifficulty(request.query.difficulty)
    } catch {
      response.status(400).json({
        message: 'Invalid `difficulty` filter. Use one of: easy, medium, hard.',
      })
      return
    }
    const search = asOptionalString(request.query.search)
    const questions = await listQuestions({ category, difficulty, search })
    const categories = await listQuestionCategories()

    response.json({
      data: questions,
      meta: {
        filters: {
          categories,
          difficulties: ['easy', 'medium', 'hard'],
        },
        generation: getQuestionGenerationCapabilities(),
      },
    })
  }),
)

app.post(
  '/api/questions/generate',
  asyncHandler(async (request, response) => {
    const userId = requiredTrimmedString(request.body?.userId)
    const userName = asOptionalString(request.body?.userName)
    const count = request.body?.count ? parsePositiveInt(request.body.count) : 5
    const category = sanitizeCategory(request.body?.category)
    const topicHint = asOptionalString(request.body?.topicHint)

    let difficulty = null
    try {
      difficulty = sanitizeDifficulty(request.body?.difficulty)
    } catch {
      response.status(400).json({
        message: 'Invalid `difficulty` value. Use one of: easy, medium, hard.',
      })
      return
    }

    if (!userId) {
      response.status(400).json({ message: '`userId` is required.' })
      return
    }

    const safeCount = Math.min(count || 5, 25)
    if (!safeCount) {
      response.status(400).json({ message: 'Invalid `count` value.' })
      return
    }

    await ensureUserExists({
      userId,
      name: userName || userId.split('@')[0],
    })

    const generatedQuestions = await generatePracticeQuestions({
      count: safeCount,
      category,
      difficulty,
      topicHint,
    })

    const categories = await listQuestionCategories()

    response.status(201).json({
      data: generatedQuestions,
      meta: {
        generatedCount: generatedQuestions.length,
        filters: {
          categories,
          difficulties: ['easy', 'medium', 'hard'],
        },
        generation: getQuestionGenerationCapabilities(),
      },
    })
  }),
)

app.post(
  '/api/mock-interview/session',
  asyncHandler(async (request, response) => {
    const userId = requiredTrimmedString(request.body?.userId)
    const userName = asOptionalString(request.body?.userName)
    const role = asOptionalString(request.body?.role)
    const jobDescription = requiredTrimmedString(request.body?.jobDescription)
    const resumeText = asOptionalString(request.body?.resumeText)
    const count = request.body?.count ? parsePositiveInt(request.body.count) : 6

    let difficulty = null
    try {
      difficulty = sanitizeDifficulty(request.body?.difficulty)
    } catch {
      response.status(400).json({
        message: 'Invalid `difficulty` value. Use one of: easy, medium, hard.',
      })
      return
    }

    if (!userId || !jobDescription) {
      response.status(400).json({
        message: '`userId` and `jobDescription` are required.',
      })
      return
    }

    const safeCount = Math.min(count || 6, 15)
    if (!safeCount) {
      response.status(400).json({ message: 'Invalid `count` value.' })
      return
    }

    await ensureUserExists({
      userId,
      name: userName || userId.split('@')[0],
    })

    const user = await getUserById(userId)
    if (!user) {
      response.status(404).json({ message: 'User not found.' })
      return
    }

    const normalizedResumeText = requiredTrimmedString(resumeText)
    const isProPlan = user.planTier === 'pro'
    if (normalizedResumeText && !isProPlan) {
      response.status(403).json({
        message:
          'CV-based mock interview customization is available on the Pro plan.',
      })
      return
    }

    const promptBlocks = []
    const normalizedRole = requiredTrimmedString(role)
    if (normalizedRole) {
      promptBlocks.push(`Target role: ${normalizedRole}`)
    }
    promptBlocks.push(`Job description:\n${jobDescription.slice(0, 2200)}`)
    if (normalizedResumeText && isProPlan) {
      promptBlocks.push(`Candidate CV:\n${normalizedResumeText.slice(0, 2200)}`)
    }

    const generatedQuestions = await generatePracticeQuestions({
      count: safeCount,
      category: 'Mock Interview',
      difficulty,
      topicHint: promptBlocks.join('\n\n'),
    })

    response.status(201).json({
      data: generatedQuestions,
      meta: {
        generatedCount: generatedQuestions.length,
        planTier: user.planTier,
        resumeAllowed: isProPlan,
        includesResume: Boolean(normalizedResumeText && isProPlan),
      },
    })
  }),
)

app.post(
  '/api/resume-assistant/chat',
  asyncHandler(async (request, response) => {
    const userId = requiredTrimmedString(request.body?.userId)
    const userName = asOptionalString(request.body?.userName)
    const message = requiredTrimmedString(request.body?.message)
    const targetRole = asOptionalString(request.body?.targetRole)
    const jobDescription = asOptionalString(request.body?.jobDescription)
    const resumeText = asOptionalString(request.body?.resumeText)

    if (!userId || !message) {
      response.status(400).json({
        message: '`userId` and `message` are required.',
      })
      return
    }

    await ensureUserExists({
      userId,
      name: userName || userId.split('@')[0],
    })

    const assistantData = buildResumeAssistantData({
      message,
      targetRole,
      jobDescription,
      resumeText,
    })

    response.json({
      data: assistantData,
      meta: {
        generation: getQuestionGenerationCapabilities(),
      },
    })
  }),
)

app.get(
  '/api/questions/:questionId',
  asyncHandler(async (request, response) => {
    const questionId = parsePositiveInt(request.params.questionId)
    if (!questionId) {
      response.status(400).json({ message: 'Invalid question id.' })
      return
    }

    const question = await getQuestionById(questionId)
    if (!question) {
      response.status(404).json({ message: 'Question not found.' })
      return
    }

    response.json({ data: question })
  }),
)

app.post(
  '/api/practice-sessions',
  asyncHandler(async (request, response) => {
    const userId = requiredTrimmedString(request.body?.userId)
    const userName = asOptionalString(request.body?.userName)
    const title = asOptionalString(request.body?.title)
    const questionCount = request.body?.questionCount
      ? parsePositiveInt(request.body.questionCount)
      : 5
    const category = sanitizeCategory(request.body?.category)
    const search = asOptionalString(request.body?.search)

    let difficulty = null
    try {
      difficulty = sanitizeDifficulty(request.body?.difficulty)
    } catch {
      response.status(400).json({
        message: 'Invalid `difficulty` value. Use one of: easy, medium, hard.',
      })
      return
    }

    if (!userId || !questionCount) {
      response.status(400).json({
        message: '`userId` and valid `questionCount` are required.',
      })
      return
    }

    await ensureUserExists({
      userId,
      name: userName || userId.split('@')[0],
    })

    try {
      const session = await createPracticeSession({
        userId,
        title,
        questionCount,
        filters: {
          category,
          difficulty,
          search,
        },
      })

      response.status(201).json({ data: session })
    } catch (error) {
      if (error?.code === 'NO_QUESTIONS') {
        response.status(404).json({ message: error.message })
        return
      }
      if (error?.code === 'QUOTA_EXCEEDED') {
        response.status(429).json({
          message: error.message,
          details: error.details,
        })
        return
      }
      throw error
    }
  }),
)

app.get(
  '/api/practice-sessions/:sessionId',
  asyncHandler(async (request, response) => {
    const sessionId = parsePositiveInt(request.params.sessionId)
    const userId = requiredTrimmedString(request.query.userId)

    if (!sessionId || !userId) {
      response.status(400).json({
        message: 'Valid `sessionId` and `userId` are required.',
      })
      return
    }

    const session = await getPracticeSessionWithProgress({
      sessionId,
      userId,
    })

    if (!session) {
      response.status(404).json({ message: 'Practice session not found.' })
      return
    }

    response.json({ data: session })
  }),
)

app.post(
  '/api/practice-sessions/:sessionId/attempts',
  asyncHandler(async (request, response) => {
    const sessionId = parsePositiveInt(request.params.sessionId)
    const userId = requiredTrimmedString(request.body?.userId)
    const userName = asOptionalString(request.body?.userName)
    const questionId = parsePositiveInt(request.body?.questionId)
    const answerText = requiredTrimmedString(request.body?.answerText)
    const timeSpentSeconds = normalizeSeconds(request.body?.timeSpentSeconds)

    if (
      !sessionId ||
      !userId ||
      !questionId ||
      !answerText ||
      timeSpentSeconds === null
    ) {
      response.status(400).json({
        message:
          '`sessionId`, `userId`, `questionId`, `answerText`, and `timeSpentSeconds` are required.',
      })
      return
    }

    await ensureUserExists({
      userId,
      name: userName || userId.split('@')[0],
    })

    try {
      const submission = await submitPracticeSessionAttempt({
        sessionId,
        userId,
        questionId,
        answerText,
        timeSpentSeconds,
      })

      if (!submission) {
        response.status(404).json({ message: 'Practice session not found.' })
        return
      }

      response.status(201).json({ data: submission })
    } catch (error) {
      if (
        error?.code === 'SESSION_COMPLETED' ||
        error?.code === 'OUT_OF_SEQUENCE' ||
        error?.code === 'ALREADY_ANSWERED'
      ) {
        response.status(409).json({ message: error.message })
        return
      }
      if (error?.code === 'QUESTION_NOT_FOUND') {
        response.status(404).json({ message: error.message })
        return
      }
      if (error?.code === 'QUOTA_EXCEEDED') {
        response.status(429).json({
          message: error.message,
          details: error.details,
        })
        return
      }
      throw error
    }
  }),
)

app.get(
  '/api/practice-sessions/:sessionId/report',
  asyncHandler(async (request, response) => {
    const sessionId = parsePositiveInt(request.params.sessionId)
    const userId = requiredTrimmedString(request.query.userId)

    if (!sessionId || !userId) {
      response.status(400).json({
        message: 'Valid `sessionId` and `userId` are required.',
      })
      return
    }

    const report = await getPracticeSessionReport({
      sessionId,
      userId,
    })

    if (!report) {
      response.status(404).json({ message: 'Practice session report not found.' })
      return
    }

    response.json({ data: report })
  }),
)

app.get(
  '/api/attempts',
  asyncHandler(async (request, response) => {
    const userId = requiredTrimmedString(request.query.userId)
    const questionId = request.query.questionId
      ? parsePositiveInt(request.query.questionId)
      : null
    const limit = request.query.limit ? parsePositiveInt(request.query.limit) : 50

    if (!userId) {
      response
        .status(400)
        .json({ message: '`userId` query parameter is required.' })
      return
    }

    if (request.query.questionId && !questionId) {
      response.status(400).json({ message: 'Invalid `questionId` query parameter.' })
      return
    }

    if (request.query.limit && !limit) {
      response.status(400).json({ message: 'Invalid `limit` query parameter.' })
      return
    }

    const attempts = await listQuestionAttempts({
      userId,
      questionId,
      limit: Math.min(limit || 50, 200),
    })

    response.json({ data: attempts })
  }),
)

app.get(
  '/api/attempts/summary/:userId',
  asyncHandler(async (request, response) => {
    const userId = requiredTrimmedString(request.params.userId)
    if (!userId) {
      response.status(400).json({ message: 'Invalid user id.' })
      return
    }

    const summary = await getQuestionAttemptSummary(userId)
    response.json({ data: summary })
  }),
)

app.post(
  '/api/attempts',
  asyncHandler(async (request, response) => {
    const userId = requiredTrimmedString(request.body?.userId)
    const userName = asOptionalString(request.body?.userName)
    const questionId = parsePositiveInt(request.body?.questionId)
    const answerText = requiredTrimmedString(request.body?.answerText)
    const timeSpentSeconds = normalizeSeconds(request.body?.timeSpentSeconds)

    if (!userId || !questionId || !answerText || timeSpentSeconds === null) {
      response.status(400).json({
        message:
          '`userId`, `questionId`, `answerText`, and `timeSpentSeconds` are required.',
      })
      return
    }

    const question = await getQuestionById(questionId)
    if (!question) {
      response.status(404).json({ message: 'Question not found.' })
      return
    }

    await ensureUserExists({
      userId,
      name: userName || userId.split('@')[0],
    })

    let attempt = null
    try {
      attempt = await createQuestionAttempt({
        userId,
        questionId,
        answerText,
        timeSpentSeconds,
      })
    } catch (error) {
      if (error?.code === 'QUOTA_EXCEEDED') {
        response.status(429).json({
          message: error.message,
          details: error.details,
        })
        return
      }
      throw error
    }

    response.status(201).json({ data: attempt })
  }),
)

app.get(
  '/api/sessions',
  asyncHandler(async (request, response) => {
    const userId = requiredTrimmedString(request.query.userId)
    const status = asOptionalString(request.query.status)?.trim().toLowerCase()

    if (!userId) {
      response
        .status(400)
        .json({ message: '`userId` query parameter is required.' })
      return
    }

    if (status && !isSupportedStatus(status)) {
      response.status(400).json({
        message: `Invalid \`status\` value. Use one of: ${sessionStatuses.join(', ')}.`,
      })
      return
    }

    const sessions = await listStudySessions({ userId, status })
    response.json({ data: sessions })
  }),
)

app.post(
  '/api/sessions',
  asyncHandler(async (request, response) => {
    const userId = requiredTrimmedString(request.body?.userId)
    const topic = requiredTrimmedString(request.body?.topic)
    const durationMinutes = parsePositiveInt(request.body?.durationMinutes)
    const status = asOptionalString(request.body?.status)?.trim().toLowerCase()
    const scheduledFor = asOptionalString(request.body?.scheduledFor)
    const notes = asOptionalString(request.body?.notes)

    if (!userId || !topic || !durationMinutes) {
      response.status(400).json({
        message:
          '`userId`, `topic`, and `durationMinutes` (positive integer) are required.',
      })
      return
    }

    if (status && !isSupportedStatus(status)) {
      response.status(400).json({
        message: `Invalid \`status\` value. Use one of: ${sessionStatuses.join(', ')}.`,
      })
      return
    }

    const user = await getUserById(userId)
    if (!user) {
      response
        .status(404)
        .json({ message: 'User not found. Create a user before adding sessions.' })
      return
    }

    const session = await createStudySession({
      userId,
      topic,
      durationMinutes,
      status,
      scheduledFor,
      notes,
    })

    response.status(201).json({ data: session })
  }),
)

app.patch(
  '/api/sessions/:sessionId',
  asyncHandler(async (request, response) => {
    const body = request.body ?? {}
    const sessionId = parsePositiveInt(request.params.sessionId)

    if (!sessionId) {
      response.status(400).json({ message: 'Invalid session id.' })
      return
    }

    const existingSession = await getStudySessionById(sessionId)
    if (!existingSession) {
      response.status(404).json({ message: 'Session not found.' })
      return
    }

    const updates = {}

    if (Object.hasOwn(body, 'topic')) {
      const topic = requiredTrimmedString(body.topic)
      if (!topic) {
        response.status(400).json({ message: '`topic` must be a non-empty string.' })
        return
      }
      updates.topic = topic
    }

    if (Object.hasOwn(body, 'durationMinutes')) {
      const durationMinutes = parsePositiveInt(body.durationMinutes)
      if (!durationMinutes) {
        response
          .status(400)
          .json({ message: '`durationMinutes` must be a positive integer.' })
        return
      }
      updates.durationMinutes = durationMinutes
    }

    if (Object.hasOwn(body, 'status')) {
      const status = asOptionalString(body.status)?.trim().toLowerCase()
      if (!status || !isSupportedStatus(status)) {
        response.status(400).json({
          message: `Invalid \`status\` value. Use one of: ${sessionStatuses.join(', ')}.`,
        })
        return
      }
      updates.status = status
    }

    if (Object.hasOwn(body, 'scheduledFor')) {
      const scheduledFor = body.scheduledFor
      if (scheduledFor !== null && typeof scheduledFor !== 'string') {
        response
          .status(400)
          .json({ message: '`scheduledFor` must be a string or null.' })
        return
      }
      updates.scheduledFor = scheduledFor
    }

    if (Object.hasOwn(body, 'notes')) {
      const notes = body.notes
      if (notes !== null && typeof notes !== 'string') {
        response.status(400).json({ message: '`notes` must be a string or null.' })
        return
      }
      updates.notes = notes
    }

    if (Object.keys(updates).length === 0) {
      response.status(400).json({ message: 'At least one field is required to update.' })
      return
    }

    const updatedSession = await updateStudySession(sessionId, updates)
    response.json({ data: updatedSession })
  }),
)

app.delete(
  '/api/sessions/:sessionId',
  asyncHandler(async (request, response) => {
    const sessionId = parsePositiveInt(request.params.sessionId)

    if (!sessionId) {
      response.status(400).json({ message: 'Invalid session id.' })
      return
    }

    const deleted = await deleteStudySession(sessionId)
    if (!deleted) {
      response.status(404).json({ message: 'Session not found.' })
      return
    }

    response.status(204).send()
  }),
)

app.get(
  '/api/summary/:userId',
  asyncHandler(async (request, response) => {
    const user = await getUserById(request.params.userId)
    if (!user) {
      response.status(404).json({ message: 'User not found.' })
      return
    }

    const summary = await getStudySummary(request.params.userId)
    response.json({ data: summary })
  }),
)

app.use((error, request, response, next) => {
  if (response.headersSent) {
    next(error)
    return
  }

  if (error?.code === 'STRIPE_SDK_MISSING') {
    response.status(503).json({
      message: error.message,
    })
    return
  }

  console.error(error)

  response.status(500).json({
    message: 'Unexpected server error.',
  })
})

async function startServer() {
  await initDatabase()

  server = app.listen(port, () => {
    console.log(`PrepWise API running on http://localhost:${port}`)
  })
}

async function shutdown(signal) {
  console.log(`${signal} received. Shutting down API server...`)

  if (server) {
    await new Promise((resolve) => {
      server.close(() => resolve())
    })
  }

  await closeDatabase()
  process.exit(0)
}

startServer().catch((error) => {
  console.error('Failed to start API server.', error)
  process.exit(1)
})

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})

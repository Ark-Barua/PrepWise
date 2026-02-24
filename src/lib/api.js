async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.message || 'Request failed.')
  }

  return payload
}

export async function ensureUserProfile({ email, name, avatarUrl }) {
  return request('/api/users', {
    method: 'POST',
    body: JSON.stringify({ email, name, avatarUrl }),
  })
}

export async function deleteUserAccount(userId) {
  return request(`/api/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  })
}

export async function signUpRequest({ email, name, password }) {
  return request('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, name, password }),
  })
}

export async function signInRequest({ email, password }) {
  return request('/api/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function fetchQuestions(filters = {}) {
  const params = new URLSearchParams()

  if (filters.category && filters.category !== 'all') {
    params.set('category', filters.category)
  }

  if (filters.difficulty && filters.difficulty !== 'all') {
    params.set('difficulty', filters.difficulty)
  }

  if (filters.search) {
    params.set('search', filters.search.trim())
  }

  const query = params.toString()
  const url = query ? `/api/questions?${query}` : '/api/questions'
  return request(url)
}

export async function fetchQuestion(questionId) {
  return request(`/api/questions/${questionId}`)
}

export async function generateQuestions(payload) {
  return request('/api/questions/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function createPracticeSession(payload) {
  return request('/api/practice-sessions', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchPracticeSession(sessionId, userId) {
  const params = new URLSearchParams()
  params.set('userId', userId)
  return request(`/api/practice-sessions/${sessionId}?${params.toString()}`)
}

export async function submitPracticeSessionAttempt(sessionId, payload) {
  return request(`/api/practice-sessions/${sessionId}/attempts`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchPracticeSessionReport(sessionId, userId) {
  const params = new URLSearchParams()
  params.set('userId', userId)
  return request(`/api/practice-sessions/${sessionId}/report?${params.toString()}`)
}

export async function submitAttempt(payload) {
  return request('/api/attempts', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchAttempts({ userId, questionId, limit = 50 }) {
  const params = new URLSearchParams()
  params.set('userId', userId)
  params.set('limit', String(limit))

  if (questionId) {
    params.set('questionId', String(questionId))
  }

  return request(`/api/attempts?${params.toString()}`)
}

export async function fetchAttemptSummary(userId) {
  return request(`/api/attempts/summary/${encodeURIComponent(userId)}`)
}

export async function fetchBillingPlans() {
  return request('/api/billing/plans')
}

export async function fetchBillingSummary(userId) {
  return request(`/api/billing/summary/${encodeURIComponent(userId)}`)
}

export async function createBillingCheckoutSession(payload) {
  return request('/api/billing/checkout', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function createBillingPortalSession(payload) {
  return request('/api/billing/portal', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function createMockInterviewSession(payload) {
  try {
    return await request('/api/mock-interview/session', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to create mock interview.'
    const missingEndpoint =
      message.includes('Cannot POST /api/mock-interview/session') ||
      message.toLowerCase().includes('not found')

    if (!missingEndpoint) {
      throw error
    }

    const role = typeof payload?.role === 'string' ? payload.role.trim() : ''
    const jobDescription =
      typeof payload?.jobDescription === 'string'
        ? payload.jobDescription.trim()
        : ''
    const resumeText =
      typeof payload?.resumeText === 'string' ? payload.resumeText.trim() : ''
    const promptParts = []

    if (role) {
      promptParts.push(`Target role: ${role}`)
    }
    if (jobDescription) {
      promptParts.push(`Job description:\n${jobDescription}`)
    }
    if (resumeText) {
      promptParts.push(`Candidate CV:\n${resumeText}`)
    }

    const fallbackResponse = await request('/api/questions/generate', {
      method: 'POST',
      body: JSON.stringify({
        userId: payload?.userId,
        userName: payload?.userName,
        count: payload?.count,
        category: 'Mock Interview',
        difficulty: payload?.difficulty,
        topicHint: promptParts.join('\n\n') || null,
      }),
    })

    return {
      data: fallbackResponse?.data || [],
      meta: {
        generatedCount: fallbackResponse?.meta?.generatedCount || 0,
        planTier: 'free',
        resumeAllowed: false,
        includesResume: Boolean(resumeText),
        fallback: 'questions_generate',
      },
    }
  }
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function extractKeywords(value) {
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
  const words = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word))
  return Array.from(new Set(words))
}

function createResumeChecklist(resumeText) {
  const normalizedResume = normalizeText(resumeText).toLowerCase()
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

function rewriteResumeBullet(resumeText, missingKeywords) {
  const lines = normalizeText(resumeText)
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

function buildResumeAssistantFallback(payload) {
  const message = normalizeText(payload?.message)
  const targetRole = normalizeText(payload?.targetRole)
  const jobDescription = normalizeText(payload?.jobDescription)
  const resumeText = normalizeText(payload?.resumeText)
  const checklist = createResumeChecklist(resumeText)

  if (!resumeText) {
    return {
      reply:
        'Paste your resume text and I will tune it section-by-section, rewrite bullets, and align it with your target role.',
      atsMatchScore: 0,
      matchedKeywords: [],
      missingKeywords: extractKeywords(`${targetRole} ${jobDescription}`).slice(0, 8),
      checklist,
      rewrittenBullet: '',
      nextSteps: [
        'Add a one-line target role summary.',
        'Use bullets with measurable outcomes.',
        'Mirror key terms from the JD in Experience and Skills.',
      ],
    }
  }

  const sourceKeywords = extractKeywords(`${targetRole} ${jobDescription}`)
  const resumeKeywords = extractKeywords(resumeText)
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

  const rewrittenBullet = rewriteResumeBullet(resumeText, missingKeywords)
  const quantitativeBulletCount = normalizeText(resumeText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*•]\s+/.test(line) && /(\d+%|\d+x|\$\d+)/i.test(line)).length
  const nextSteps = [
    missingKeywords.length
      ? `Inject missing JD keywords: ${missingKeywords.slice(0, 4).join(', ')}.`
      : 'Keyword alignment looks strong. Focus on clarity and impact ordering.',
    quantitativeBulletCount > 0
      ? 'Expand quantified bullets into top two projects for stronger credibility.'
      : 'Add metrics to at least 3 bullets (%, cost, speed, or scale).',
    checklist.some((item) => !item.done)
      ? `Complete core sections: ${checklist
          .filter((item) => !item.done)
          .map((item) => item.label)
          .slice(0, 2)
          .join(', ')}.`
      : 'Core structure is complete. Refine phrasing and keep bullets concise.',
  ]

  const userAskedForSummary =
    message.includes('summary') || message.includes('about me')
  const summaryDraft = userAskedForSummary
    ? `Results-driven ${targetRole || 'candidate'} with experience in ${matchedKeywords
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

export async function chatWithResumeAssistant(payload) {
  try {
    return await request('/api/resume-assistant/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to reach resume assistant.'
    const missingEndpoint =
      message.includes('Cannot POST /api/resume-assistant/chat') ||
      message.toLowerCase().includes('not found')

    if (!missingEndpoint) {
      throw error
    }

    return {
      data: buildResumeAssistantFallback(payload),
      meta: {
        fallback: 'client-template',
      },
    }
  }
}

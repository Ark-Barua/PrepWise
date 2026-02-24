import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FiActivity,
  FiArrowRight,
  FiBarChart2,
  FiCalendar,
  FiCheckCircle,
  FiFlag,
  FiMessageSquare,
  FiSend,
  FiTarget,
  FiTrendingUp,
  FiZap,
} from 'react-icons/fi'
import useAuth from '../auth/useAuth'
import {
  chatWithResumeAssistant,
  fetchAttempts,
  fetchAttemptSummary,
} from '../lib/api'
import NebulaLoader from '../components/NebulaLoader'

function formatDateLabel(dateKey) {
  if (!dateKey) {
    return '-'
  }

  const date = new Date(`${dateKey}T00:00:00Z`)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0)
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

function average(values) {
  if (!values.length) {
    return 0
  }
  return values.reduce((total, value) => total + value, 0) / values.length
}

function standardDeviation(values) {
  if (values.length < 2) {
    return 0
  }
  const mean = average(values)
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function summarizeFeedbackSignals(attempts) {
  const counters = {
    pace: 0,
    structure: 0,
    detail: 0,
    keywords: 0,
  }

  for (const attempt of attempts || []) {
    const feedback = String(attempt?.feedback || '').toLowerCase()
    if (!feedback) {
      continue
    }
    if (
      feedback.includes('pace') ||
      feedback.includes('fast') ||
      feedback.includes('longer') ||
      feedback.includes('time')
    ) {
      counters.pace += 1
    }
    if (feedback.includes('structure') || feedback.includes('star')) {
      counters.structure += 1
    }
    if (
      feedback.includes('detail') ||
      feedback.includes('brief') ||
      feedback.includes('depth')
    ) {
      counters.detail += 1
    }
    if (feedback.includes('keyword') || feedback.includes('missing concept')) {
      counters.keywords += 1
    }
  }

  return [
    {
      id: 'pace',
      label: 'Pace control',
      count: counters.pace,
    },
    {
      id: 'structure',
      label: 'Answer structure',
      count: counters.structure,
    },
    {
      id: 'detail',
      label: 'Depth and detail',
      count: counters.detail,
    },
    {
      id: 'keywords',
      label: 'Keyword relevance',
      count: counters.keywords,
    },
  ]
    .sort((left, right) => right.count - left.count)
    .slice(0, 3)
}

function messageId(prefix) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}`
}

function HomePage() {
  const { user } = useAuth()
  const [summary, setSummary] = useState({
    totalAttempts: 0,
    averageScore: 0,
    bestScore: 0,
    totalTimeSeconds: 0,
    categoryPerformance: [],
    scoreTrend: [],
    activityByDay: [],
    streak: {
      currentDays: 0,
      longestDays: 0,
      activeDays: 0,
      lastActiveDate: null,
      status: 'inactive',
    },
  })
  const [recentAttempts, setRecentAttempts] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  const [copilotOpen, setCopilotOpen] = useState(false)
  const [copilotRole, setCopilotRole] = useState('')
  const [copilotJd, setCopilotJd] = useState('')
  const [copilotResume, setCopilotResume] = useState('')
  const [copilotInput, setCopilotInput] = useState('')
  const [copilotSending, setCopilotSending] = useState(false)
  const [copilotError, setCopilotError] = useState('')
  const [copilotMessages, setCopilotMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      text:
        'Resume Copilot ready. Add role + JD + resume and ask for ATS alignment, summary draft, or bullet rewrite.',
    },
  ])
  const copilotTailRef = useRef(null)

  useEffect(() => {
    let isCancelled = false

    async function loadDashboard() {
      setIsLoading(true)
      setErrorMessage('')

      try {
        const [summaryResponse, attemptsResponse] = await Promise.all([
          fetchAttemptSummary(user.email),
          fetchAttempts({ userId: user.email, limit: 4 }),
        ])

        if (isCancelled) {
          return
        }

        setSummary(summaryResponse?.data || {})
        setRecentAttempts(attemptsResponse?.data || [])
      } catch (error) {
        if (!isCancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Unable to load dashboard data.',
          )
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadDashboard()

    return () => {
      isCancelled = true
    }
  }, [user.email])

  useEffect(() => {
    if (!copilotOpen || !copilotTailRef.current) {
      return
    }
    copilotTailRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [copilotMessages, copilotOpen, copilotSending])

  const scoreTrend = useMemo(() => summary.scoreTrend || [], [summary.scoreTrend])
  const activityByDay = useMemo(
    () => (summary.activityByDay || []).slice(-10),
    [summary.activityByDay],
  )
  const weeklyAttempts = useMemo(
    () =>
      (summary.activityByDay || [])
        .slice(-7)
        .reduce((total, item) => total + (Number(item.attempts) || 0), 0),
    [summary.activityByDay],
  )
  const maxDailyAttempts = Math.max(
    1,
    ...activityByDay.map((item) => Number(item.attempts) || 0),
  )
  const categoryPerformance = useMemo(
    () => summary.categoryPerformance || [],
    [summary.categoryPerformance],
  )
  const weakestCategory = useMemo(() => {
    const rows = categoryPerformance
    if (!rows.length) {
      return null
    }
    return [...rows].sort(
      (left, right) =>
        (Number(left.averageScore) || 0) - (Number(right.averageScore) || 0),
    )[0]
  }, [categoryPerformance])
  const strongestCategory = useMemo(() => {
    const rows = categoryPerformance
    if (!rows.length) {
      return null
    }
    return [...rows].sort(
      (left, right) =>
        (Number(right.averageScore) || 0) - (Number(left.averageScore) || 0),
    )[0]
  }, [categoryPerformance])
  const recoveryQueue = useMemo(() => {
    return [...categoryPerformance]
      .sort(
        (left, right) =>
          (Number(left.averageScore) || 0) - (Number(right.averageScore) || 0),
      )
      .slice(0, 3)
  }, [categoryPerformance])
  const readinessScore = useMemo(() => {
    const avg = Number(summary.averageScore) || 0
    const streak = Number(summary.streak?.currentDays) || 0
    const attempts = Number(summary.totalAttempts) || 0
    const depth = categoryPerformance.length
    return Math.max(
      0,
      Math.min(100, Math.round(avg * 0.72 + Math.min(14, streak * 2) + Math.min(12, attempts * 0.4) + depth * 2)),
    )
  }, [categoryPerformance.length, summary])
  const weeklyGoal = 12
  const weeklyPercent = Math.min(100, Math.round((weeklyAttempts / weeklyGoal) * 100))
  const weeklyGap = Math.max(0, weeklyGoal - weeklyAttempts)
  const recentScores = useMemo(
    () =>
      scoreTrend
        .map((item) => Number(item.score) || 0)
        .filter((value) => Number.isFinite(value)),
    [scoreTrend],
  )
  const momentumDelta = useMemo(() => {
    if (recentScores.length < 6) {
      return 0
    }
    const latest = average(recentScores.slice(-3))
    const previous = average(recentScores.slice(-6, -3))
    return Number((latest - previous).toFixed(1))
  }, [recentScores])
  const consistencyScore = useMemo(() => {
    if (recentScores.length < 2) {
      return 0
    }
    const deviation = standardDeviation(recentScores.slice(-8))
    return Math.max(0, Math.min(100, Math.round(100 - deviation * 2.4)))
  }, [recentScores])
  const qualitySignals = useMemo(
    () => summarizeFeedbackSignals(recentAttempts),
    [recentAttempts],
  )
  const activeDaysInWeek = useMemo(
    () =>
      (summary.activityByDay || [])
        .slice(-7)
        .filter((item) => (Number(item.attempts) || 0) > 0).length,
    [summary.activityByDay],
  )
  const dailyRunRate = weeklyAttempts > 0 ? weeklyAttempts / Math.max(1, activeDaysInWeek) : 0
  const projectedWeeklyAttempts = Math.round(dailyRunRate * 7)
  const projectionLabel =
    projectedWeeklyAttempts >= weeklyGoal
      ? 'On track to hit weekly target.'
      : 'Below target pace. Add one short session today.'
  const averageAttemptMinutes = useMemo(() => {
    const totalAttempts = Number(summary.totalAttempts) || 0
    const totalSeconds = Number(summary.totalTimeSeconds) || 0
    if (!totalAttempts || !totalSeconds) {
      return 0
    }
    return Math.max(1, Math.round(totalSeconds / totalAttempts / 60))
  }, [summary.totalAttempts, summary.totalTimeSeconds])
  const executionLane = useMemo(() => {
    const steps = []
    if (recoveryQueue[0]?.category) {
      steps.push(
        `Run ${recoveryQueue[0].category} medium drills (${Math.max(
          3,
          Math.min(6, Math.round(weeklyGap / 2) || 3),
        )} questions).`,
      )
    }
    if (weeklyGap > 0) {
      steps.push(
        `Close weekly gap with ${weeklyGap} attempts in ${Math.max(
          2,
          Math.ceil(weeklyGap / 2),
        )} focused blocks.`,
      )
    } else {
      steps.push('Weekly attempt goal met. Push one hard difficulty stretch set.')
    }
    if (momentumDelta < 0) {
      steps.push('Momentum dipped. Revisit one low-score question and re-answer with structure.')
    } else {
      steps.push('Momentum stable. Keep cadence and refine concise, high-signal answers.')
    }
    return steps.slice(0, 3)
  }, [momentumDelta, recoveryQueue, weeklyGap])
  const streakStatusText =
    summary.streak?.status === 'active'
      ? 'Active today'
      : summary.streak?.status === 'at-risk'
        ? 'At risk, practice today'
        : summary.streak?.status === 'broken'
          ? 'Restart streak'
          : 'No streak yet'

  const metricCards = [
    {
      label: 'Current Streak',
      value: `${summary.streak?.currentDays || 0} days`,
      hint: streakStatusText,
      tone: 'sun',
    },
    {
      label: 'Longest Streak',
      value: `${summary.streak?.longestDays || 0} days`,
      hint: `Active days: ${summary.streak?.activeDays || 0}`,
      tone: 'mint',
    },
    {
      label: 'Average Score',
      value: summary.averageScore || 0,
      hint: `Best: ${summary.bestScore || 0}`,
      tone: 'sky',
    },
    {
      label: 'Total Attempts',
      value: summary.totalAttempts || 0,
      hint: `Practice time: ${formatDuration(summary.totalTimeSeconds || 0)}`,
      tone: 'violet',
    },
  ]

  const quickPrompts = [
    'Scan my resume for ATS and missing keywords.',
    'Rewrite one weak bullet with measurable impact.',
    'Generate a professional summary for my target role.',
  ]

  async function sendCopilotMessage(rawMessage) {
    const message = String(rawMessage || '').trim()
    if (!message || copilotSending) {
      return
    }

    setCopilotInput('')
    setCopilotError('')
    setCopilotMessages((current) => [
      ...current,
      { id: messageId('user'), role: 'user', text: message },
    ])
    setCopilotSending(true)

    try {
      const response = await chatWithResumeAssistant({
        userId: user.email,
        userName: user.name,
        message,
        targetRole: copilotRole,
        jobDescription: copilotJd,
        resumeText: copilotResume,
      })
      const payload = response?.data || {}
      const atsText =
        Number.isFinite(Number(payload.atsMatchScore)) && Number(payload.atsMatchScore) >= 0
          ? ` ATS match estimate: ${Math.round(Number(payload.atsMatchScore))}%.`
          : ''
      const tipText = Array.isArray(payload.nextSteps)
        ? payload.nextSteps.slice(0, 2).join(' ')
        : ''
      const text =
        (typeof payload.reply === 'string' ? payload.reply : 'Resume analysis complete.') +
        atsText +
        (tipText ? ` ${tipText}` : '')

      setCopilotMessages((current) => [
        ...current,
        { id: messageId('assistant'), role: 'assistant', text },
      ])
    } catch (error) {
      setCopilotError(error instanceof Error ? error.message : 'Resume Copilot unavailable.')
    } finally {
      setCopilotSending(false)
    }
  }

  function handleCopilotSubmit(event) {
    event.preventDefault()
    void sendCopilotMessage(copilotInput)
  }

  return (
    <section className="page page--experience page--overview">
      <div className="experience-hero experience-hero--overview">
        <div className="experience-hero__content">
          <p className="experience-hero__eyebrow">Performance Cockpit</p>
          <h2 className="experience-hero__title">Overview</h2>
          <p className="experience-hero__description">
            Track streaks, score momentum, category depth, and resume readiness from one cockpit.
          </p>
          <div className="experience-hero__actions">
            <Link className="shell__button shell__button--primary" to="/practice">
              Practice now
            </Link>
            <Link className="shell__button" to="/progress">
              Full analytics
            </Link>
          </div>
        </div>
        <div className="experience-hero__snapshot">
          <article className="hero-pill">
            <p>Streak Status</p>
            <strong>{streakStatusText}</strong>
          </article>
          <article className="hero-pill">
            <p>Last Active</p>
            <strong>{formatDateLabel(summary.streak?.lastActiveDate)}</strong>
          </article>
          <article className="hero-pill">
            <p>Readiness</p>
            <strong>{readinessScore}/100</strong>
          </article>
        </div>
        <span className="experience-hero__flare experience-hero__flare--one" />
        <span className="experience-hero__flare experience-hero__flare--two" />
      </div>

      {isLoading ? <NebulaLoader label="Loading dashboard..." /> : null}
      {errorMessage ? <p className="auth-error">{errorMessage}</p> : null}

      {!isLoading && !errorMessage ? (
        <>
          <div className="dashboard-metric-grid dashboard-metric-grid--animated">
            {metricCards.map((card, index) => (
              <article
                key={card.label}
                className={`metric-card metric-card--${card.tone}`}
                style={{ '--stagger': `${index * 80}ms` }}
              >
                <p className="card__label">{card.label}</p>
                <p className="metric-card__value">{card.value}</p>
                <p className="metric-card__hint">{card.hint}</p>
              </article>
            ))}
          </div>

          <div className="dashboard-panels dashboard-panels--animated">
            <article className="panel-card panel-card--score">
              <p className="card__value">Score trend</p>
              {scoreTrend.length === 0 ? (
                <p className="card__label">No attempts yet.</p>
              ) : (
                <div className="mini-chart">
                  {scoreTrend.map((point, index) => (
                    <div key={point.attemptId} className="mini-chart__item">
                      <div
                        className="mini-chart__bar"
                        style={{
                          height: `${Math.max(8, Number(point.score) || 0)}%`,
                          '--bar-delay': `${index * 40}ms`,
                        }}
                        title={`${point.questionTitle}: ${point.score}`}
                      />
                      <span className="mini-chart__label">{point.score}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="panel-card panel-card--activity">
              <p className="card__value">Daily activity</p>
              {activityByDay.length === 0 ? (
                <p className="card__label">No activity history yet.</p>
              ) : (
                <div className="mini-chart mini-chart--activity">
                  {activityByDay.map((day, index) => (
                    <div key={day.date} className="mini-chart__item">
                      <div
                        className="mini-chart__bar mini-chart__bar--activity"
                        style={{
                          height: `${Math.max(
                            10,
                            Math.round(((Number(day.attempts) || 0) / maxDailyAttempts) * 100),
                          )}%`,
                          '--bar-delay': `${index * 35}ms`,
                        }}
                        title={`${formatDateLabel(day.date)}: ${day.attempts} attempts`}
                      />
                      <span className="mini-chart__label">{formatDateLabel(day.date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="panel-card panel-card--feedback">
              <p className="card__value">Recent feedback</p>
              {recentAttempts.length === 0 ? (
                <p className="card__label">Submit your first attempt to see feedback.</p>
              ) : (
                <div className="attempt-list">
                  {recentAttempts.map((attempt) => (
                    <article key={attempt.id} className="attempt-list__item">
                      <div>
                        <p className="card__value">
                          {attempt.questionTitle} | {attempt.score}
                        </p>
                        <p className="card__label">{attempt.feedback}</p>
                      </div>
                      <Link className="shell__button" to={`/practice/questions/${attempt.questionId}`}>
                        Retry
                      </Link>
                    </article>
                  ))}
                </div>
              )}
            </article>
          </div>

          <div className="overview-bonus-grid">
            <article className="card card--elevated overview-bonus-card">
              <p className="card__value">
                <FiBarChart2 size={15} /> Readiness Compass
              </p>
              <p className="card__label">
                Weighted from score + streak + category coverage. Use it as your weekly control metric.
              </p>
              <div className="overview-readiness-meter" aria-hidden="true">
                <span style={{ width: `${readinessScore}%` }} />
              </div>
              <p className="card__label">
                Score {readinessScore}/100 | Strongest: {strongestCategory?.category || 'N/A'} | Weakest:{' '}
                {weakestCategory?.category || 'N/A'}
              </p>
            </article>

            <article className="card card--elevated overview-bonus-card">
              <p className="card__value">
                <FiActivity size={15} /> Weekly Mission
              </p>
              <p className="card__label">
                Keep at least {weeklyGoal} attempts per week for stable interview confidence.
              </p>
              <div className="overview-readiness-meter" aria-hidden="true">
                <span style={{ width: `${weeklyPercent}%` }} />
              </div>
              <p className="card__label">
                {weeklyAttempts}/{weeklyGoal} attempts completed
              </p>
              <div className="overview-bonus-actions">
                <Link className="shell__button shell__button--muted" to="/practice">
                  <FiTarget size={14} /> Continue practice
                </Link>
                <button
                  type="button"
                  className="shell__button shell__button--muted"
                  onClick={() => {
                    setCopilotOpen(true)
                    void sendCopilotMessage(
                      'Suggest resume improvements for my current target role.',
                    )
                  }}
                >
                  <FiZap size={14} /> Use Resume AI
                </button>
              </div>
            </article>

            <article className="card card--elevated overview-bonus-card">
              <p className="card__value">
                <FiTarget size={15} /> Recovery Queue
              </p>
              <p className="card__label">
                Priority categories to recover before your next mock round.
              </p>
              {recoveryQueue.length === 0 ? (
                <p className="card__label">Complete a few attempts to unlock category queue.</p>
              ) : (
                <div className="overview-focus-list">
                  {recoveryQueue.map((item) => (
                    <article key={item.category} className="overview-focus-item">
                      <p className="card__value">{item.category}</p>
                      <p className="card__label">
                        Avg {item.averageScore} | {item.attempts} attempts
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </article>

            <article className="card card--elevated overview-bonus-card">
              <p className="card__value">
                <FiCalendar size={15} /> Goal Projection Engine
              </p>
              <p className="card__label">{projectionLabel}</p>
              <div className="overview-kpi-grid">
                <article className="overview-kpi">
                  <p>Run Rate</p>
                  <strong>{dailyRunRate.toFixed(1)} attempts/day</strong>
                </article>
                <article className="overview-kpi">
                  <p>Projected Week</p>
                  <strong>{projectedWeeklyAttempts} attempts</strong>
                </article>
                <article className="overview-kpi">
                  <p>Gap</p>
                  <strong>{weeklyGap}</strong>
                </article>
                <article className="overview-kpi">
                  <p>Avg Attempt</p>
                  <strong>{averageAttemptMinutes} mins</strong>
                </article>
              </div>
            </article>

            <article className="card card--elevated overview-bonus-card">
              <p className="card__value">
                <FiTrendingUp size={15} /> Quality Signals
              </p>
              <p className="card__label">
                Consistency and feedback themes from your latest attempts.
              </p>
              <div className="overview-readiness-meter" aria-hidden="true">
                <span style={{ width: `${consistencyScore}%` }} />
              </div>
              <p className="card__label">
                Consistency {consistencyScore}/100 | Momentum {momentumDelta > 0 ? '+' : ''}
                {momentumDelta}
              </p>
              <div className="overview-signal-list">
                {qualitySignals.map((signal) => (
                  <span key={signal.id} className="overview-signal-chip">
                    {signal.label}: {signal.count}
                  </span>
                ))}
              </div>
            </article>

            <article className="card card--elevated overview-bonus-card overview-bonus-card--wide">
              <p className="card__value">
                <FiFlag size={15} /> 3-Step Execution Lane
              </p>
              <p className="card__label">
                Adaptive next actions generated from weak categories, run rate, and momentum.
              </p>
              <div className="overview-execution-list">
                {executionLane.map((step, index) => (
                  <p key={`${step}-${index}`} className="overview-execution-item">
                    <FiCheckCircle size={13} /> {step}
                  </p>
                ))}
              </div>
              <div className="overview-bonus-actions">
                <Link className="shell__button shell__button--primary" to="/practice">
                  <FiArrowRight size={14} /> Start execution
                </Link>
                <Link className="shell__button" to="/progress">
                  Deep analytics
                </Link>
              </div>
            </article>
          </div>
        </>
      ) : null}

      <section className={copilotOpen ? 'resume-dock resume-dock--open' : 'resume-dock'}>
        <header className="resume-dock__bar">
          <div>
            <p className="resume-dock__eyebrow">AI Copilot</p>
            <p className="resume-dock__title">
              <FiMessageSquare size={16} /> Resume AI Studio
            </p>
          </div>
          <button
            type="button"
            className="shell__button shell__button--primary resume-dock__toggle"
            onClick={() => setCopilotOpen((current) => !current)}
          >
            {copilotOpen ? 'Hide Studio' : 'Launch Resume AI'}
          </button>
        </header>

        {copilotOpen ? (
          <div className="resume-dock__layout">
            <article className="resume-dock__column">
              <p className="resume-dock__section-title">Context Setup</p>
              <div className="resume-dock__context">
                <label className="form-field">
                  Target role
                  <input
                    type="text"
                    value={copilotRole}
                    onChange={(event) => setCopilotRole(event.target.value)}
                    placeholder="Product Engineer"
                  />
                </label>
                <label className="form-field">
                  Job description
                  <textarea
                    value={copilotJd}
                    onChange={(event) => setCopilotJd(event.target.value)}
                    placeholder="Paste JD"
                  />
                </label>
                <label className="form-field">
                  Resume text
                  <textarea
                    value={copilotResume}
                    onChange={(event) => setCopilotResume(event.target.value)}
                    placeholder="Paste resume"
                  />
                </label>
              </div>

              <p className="resume-dock__section-title">Quick Prompts</p>
              <div className="resume-dock__quick">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="shell__button shell__button--muted"
                    onClick={() => void sendCopilotMessage(prompt)}
                    disabled={copilotSending}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </article>

            <article className="resume-dock__column">
              <p className="resume-dock__section-title">Live Chat</p>
              <div className="resume-dock__messages">
                {copilotMessages.map((item) => (
                  <article
                    key={item.id}
                    className={item.role === 'assistant' ? 'resume-msg resume-msg--assistant' : 'resume-msg resume-msg--user'}
                  >
                    <p>{item.text}</p>
                  </article>
                ))}
                {copilotSending ? (
                  <p className="resume-dock__typing">
                    <FiTrendingUp size={13} /> Analyzing...
                  </p>
                ) : null}
                <div ref={copilotTailRef} />
              </div>

              {copilotError ? <p className="auth-error">{copilotError}</p> : null}

              <form className="resume-dock__composer" onSubmit={handleCopilotSubmit}>
                <input
                  type="text"
                  value={copilotInput}
                  onChange={(event) => setCopilotInput(event.target.value)}
                  placeholder="Ask resume AI..."
                  maxLength={360}
                />
                <button
                  type="submit"
                  className="shell__button shell__button--primary"
                  disabled={copilotSending || !copilotInput.trim()}
                >
                  <FiSend size={14} />
                </button>
              </form>
            </article>
          </div>
        ) : (
          <p className="card__label resume-dock__collapsed-note">
            Launch Resume AI Studio to audit ATS alignment, rewrite weak bullets, and generate role-focused summaries.
          </p>
        )}
      </section>
    </section>
  )
}

export default HomePage

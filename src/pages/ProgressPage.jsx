import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FiActivity,
  FiAlertCircle,
  FiAward,
  FiBarChart2,
  FiCheckCircle,
  FiClock,
  FiTarget,
  FiTrendingDown,
  FiTrendingUp,
  FiZap,
} from 'react-icons/fi'
import useAuth from '../auth/useAuth'
import NebulaLoader from '../components/NebulaLoader'
import { fetchAttempts, fetchAttemptSummary } from '../lib/api'

const expectedSecondsByDifficulty = {
  easy: 180,
  medium: 300,
  hard: 480,
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

function formatDifficultyLabel(value) {
  if (!value) {
    return 'Unknown'
  }

  return value.charAt(0).toUpperCase() + value.slice(1)
}

function average(values) {
  if (!values.length) {
    return 0
  }

  return values.reduce((total, item) => total + item, 0) / values.length
}

function standardDeviation(values) {
  if (!values.length) {
    return 0
  }

  const mean = average(values)
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function buildActivityHeatmap(activityByDay, totalDays = 14) {
  const today = new Date()
  const dayMap = new Map(
    (activityByDay || []).map((item) => [item.date, Number(item.attempts) || 0]),
  )

  const rows = []
  for (let offset = totalDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset),
    )
    const dateKey = date.toISOString().slice(0, 10)
    const attempts = dayMap.get(dateKey) || 0
    const level =
      attempts >= 4 ? 4 : attempts >= 3 ? 3 : attempts >= 2 ? 2 : attempts >= 1 ? 1 : 0

    rows.push({
      date: dateKey,
      label: formatDateLabel(dateKey),
      attempts,
      level,
    })
  }

  return rows
}

function getPaceInsight(avgSeconds, expectedSeconds) {
  if (!avgSeconds || !expectedSeconds) {
    return { label: 'No pace data', tone: 'muted' }
  }

  if (avgSeconds < expectedSeconds * 0.65) {
    return { label: 'Too fast', tone: 'warn' }
  }
  if (avgSeconds > expectedSeconds * 1.35) {
    return { label: 'Too slow', tone: 'risk' }
  }
  return { label: 'Balanced', tone: 'good' }
}

function ProgressPage() {
  const { user } = useAuth()
  const [summary, setSummary] = useState({
    totalAttempts: 0,
    averageScore: 0,
    bestScore: 0,
    totalTimeSeconds: 0,
    difficultyBreakdown: [],
    categoryBreakdown: [],
    categoryPerformance: [],
    activityByDay: [],
    streak: {
      currentDays: 0,
      longestDays: 0,
      activeDays: 0,
      lastActiveDate: null,
      status: 'inactive',
    },
  })
  const [attempts, setAttempts] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  const streakStatus =
    summary.streak?.status === 'active'
      ? 'Active today'
      : summary.streak?.status === 'at-risk'
        ? 'At risk'
        : summary.streak?.status === 'broken'
          ? 'Restart now'
          : 'No streak yet'

  const metricCards = [
    {
      label: 'Current Streak',
      value: `${summary.streak?.currentDays || 0} days`,
      hint: streakStatus,
      tone: 'sun',
    },
    {
      label: 'Longest Streak',
      value: `${summary.streak?.longestDays || 0} days`,
      hint: `Active days: ${summary.streak?.activeDays || 0}`,
      tone: 'mint',
    },
    {
      label: 'Total Attempts',
      value: summary.totalAttempts || 0,
      hint: `Practice time: ${formatDuration(summary.totalTimeSeconds || 0)}`,
      tone: 'sky',
    },
    {
      label: 'Average Score',
      value: summary.averageScore || 0,
      hint: `Best: ${summary.bestScore || 0}`,
      tone: 'violet',
    },
  ]

  useEffect(() => {
    let isCancelled = false

    async function loadProgress() {
      setIsLoading(true)
      setErrorMessage('')

      try {
        const [summaryResponse, attemptsResponse] = await Promise.all([
          fetchAttemptSummary(user.email),
          fetchAttempts({ userId: user.email, limit: 18 }),
        ])

        if (isCancelled) {
          return
        }

        setSummary(summaryResponse?.data || {})
        setAttempts(attemptsResponse?.data || [])
      } catch (error) {
        if (!isCancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Unable to load progress analytics.',
          )
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadProgress()

    return () => {
      isCancelled = true
    }
  }, [user.email])

  const trendInsight = useMemo(() => {
    const scores = attempts
      .map((item) => Number(item.score) || 0)
      .filter((value) => Number.isFinite(value))

    if (scores.length < 4) {
      return {
        delta: 0,
        direction: 'flat',
        label: 'Need more attempts to calculate momentum.',
      }
    }

    const windowSize = Math.min(4, Math.floor(scores.length / 2))
    const latestAvg = average(scores.slice(0, windowSize))
    const previousAvg = average(scores.slice(windowSize, windowSize * 2))
    const delta = Number((latestAvg - previousAvg).toFixed(1))

    if (delta >= 3) {
      return {
        delta,
        direction: 'up',
        label: `Momentum rising (+${delta}). Keep current practice cadence.`,
      }
    }
    if (delta <= -3) {
      return {
        delta,
        direction: 'down',
        label: `Momentum dipped (${delta}). Shift to focused revision for weak lanes.`,
      }
    }
    return {
      delta,
      direction: 'flat',
      label: 'Momentum is stable. Increase difficulty or pace for growth.',
    }
  }, [attempts])

  const consistencyInsight = useMemo(() => {
    const scores = attempts.map((item) => Number(item.score) || 0)
    if (scores.length < 3) {
      return {
        score: 0,
        label: 'Needs more data',
      }
    }

    const deviation = standardDeviation(scores)
    const consistency = Math.max(0, Math.min(100, Math.round(100 - deviation * 2.1)))
    const label =
      consistency >= 80
        ? 'Highly consistent'
        : consistency >= 65
          ? 'Moderately consistent'
          : 'Volatile performance'
    return {
      score: consistency,
      label,
    }
  }, [attempts])

  const activityHeatmap = useMemo(
    () => buildActivityHeatmap(summary.activityByDay || []),
    [summary.activityByDay],
  )

  const strongestCategory = useMemo(() => {
    const rows = summary.categoryPerformance || []
    if (!rows.length) {
      return null
    }
    return [...rows].sort(
      (left, right) =>
        (Number(right.averageScore) || 0) - (Number(left.averageScore) || 0),
    )[0]
  }, [summary.categoryPerformance])

  const weakCategories = useMemo(() => {
    const rows = summary.categoryPerformance || []
    return [...rows]
      .sort(
        (left, right) =>
          (Number(left.averageScore) || 0) - (Number(right.averageScore) || 0),
      )
      .slice(0, 3)
  }, [summary.categoryPerformance])

  const difficultyInsights = useMemo(() => {
    const recentByDifficulty = attempts.reduce((accumulator, attempt) => {
      const key = String(attempt.questionDifficulty || '').toLowerCase()
      if (!key) {
        return accumulator
      }
      if (!accumulator[key]) {
        accumulator[key] = []
      }
      accumulator[key].push(Number(attempt.timeSpentSeconds) || 0)
      return accumulator
    }, {})

    const breakdownRows = summary.difficultyBreakdown || []
    const order = ['easy', 'medium', 'hard']

    return order.map((difficulty) => {
      const breakdown = breakdownRows.find((item) => item.difficulty === difficulty) || {
        difficulty,
        attempts: 0,
        averageScore: 0,
      }
      const recentTimes = recentByDifficulty[difficulty] || []
      const averageRecentTime = recentTimes.length
        ? Math.round(average(recentTimes))
        : 0
      const expected = expectedSecondsByDifficulty[difficulty]
      const pace = getPaceInsight(averageRecentTime, expected)
      return {
        ...breakdown,
        averageRecentTime,
        pace,
        expected,
      }
    })
  }, [attempts, summary.difficultyBreakdown])

  const milestoneRows = useMemo(() => {
    const totalAttempts = Number(summary.totalAttempts) || 0
    const averageScore = Number(summary.averageScore) || 0
    const bestScore = Number(summary.bestScore) || 0
    const currentStreak = Number(summary.streak?.currentDays) || 0
    const activeDays = Number(summary.streak?.activeDays) || 0

    return [
      {
        label: '10 total attempts',
        done: totalAttempts >= 10,
      },
      {
        label: '25 total attempts',
        done: totalAttempts >= 25,
      },
      {
        label: 'Average score 70+',
        done: averageScore >= 70,
      },
      {
        label: 'Best score 90+',
        done: bestScore >= 90,
      },
      {
        label: '7-day active streak',
        done: currentStreak >= 7,
      },
      {
        label: '14 active practice days',
        done: activeDays >= 14,
      },
    ]
  }, [summary])

  const nextSessionPlan = useMemo(() => {
    const focusCategory = weakCategories[0]?.category || 'General'
    const mediumScore =
      difficultyInsights.find((item) => item.difficulty === 'medium')?.averageScore || 0
    const hardScore =
      difficultyInsights.find((item) => item.difficulty === 'hard')?.averageScore || 0
    const easyScore =
      difficultyInsights.find((item) => item.difficulty === 'easy')?.averageScore || 0

    let recommendedDifficulty = 'medium'
    if (mediumScore < 65 && easyScore >= 55) {
      recommendedDifficulty = 'easy'
    } else if (mediumScore >= 75 && hardScore >= 55) {
      recommendedDifficulty = 'hard'
    }

    const questionCount =
      recommendedDifficulty === 'hard' ? 6 : recommendedDifficulty === 'medium' ? 8 : 10
    const targetMinutes =
      recommendedDifficulty === 'hard'
        ? 30
        : recommendedDifficulty === 'medium'
          ? 28
          : 24

    return {
      focusCategory,
      recommendedDifficulty,
      questionCount,
      targetMinutes,
    }
  }, [difficultyInsights, weakCategories])

  return (
    <section className="page page--experience page--progress">
      <div className="experience-hero experience-hero--progress">
        <div className="experience-hero__content">
          <p className="experience-hero__eyebrow">Analytics Studio</p>
          <h2 className="experience-hero__title">Progress</h2>
          <p className="experience-hero__description">
            Measure category strength, streak reliability, pace quality, and momentum trends
            across your recent attempts.
          </p>
          <div className="experience-hero__actions">
            <Link className="shell__button shell__button--primary" to="/practice">
              Start another attempt
            </Link>
            <Link className="shell__button" to="/mock-interview">
              Mock interview
            </Link>
          </div>
        </div>
        <div className="experience-hero__snapshot">
          <article className="hero-pill">
            <p>Streak</p>
            <strong>{streakStatus}</strong>
          </article>
          <article className="hero-pill">
            <p>Last Active</p>
            <strong>{formatDateLabel(summary.streak?.lastActiveDate)}</strong>
          </article>
          <article className="hero-pill">
            <p>Top Score</p>
            <strong>{summary.bestScore || 0}</strong>
          </article>
        </div>
        <span className="experience-hero__flare experience-hero__flare--one" />
        <span className="experience-hero__flare experience-hero__flare--two" />
      </div>

      {isLoading ? <NebulaLoader label="Loading progress..." /> : null}
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

          <div className="breakdown-grid breakdown-grid--animated">
            <article className="card card--elevated">
              <p className="card__value">Category-wise performance summary</p>
              <div className="performance-list">
                {(summary.categoryPerformance || []).length === 0 ? (
                  <p className="card__label">No category performance yet.</p>
                ) : (
                  (summary.categoryPerformance || []).map((item, index) => (
                    <div key={item.category} className="performance-list__item">
                      <div className="performance-list__head">
                        <span className="card__label">{item.category}</span>
                        <span className="card__label">
                          Avg {item.averageScore} | Best {item.bestScore}
                        </span>
                      </div>
                      <div className="performance-list__track">
                        <span
                          className="performance-list__fill"
                          style={{
                            width: `${Math.max(6, Number(item.averageScore) || 0)}%`,
                            '--bar-delay': `${index * 55}ms`,
                          }}
                        />
                      </div>
                      <p className="card__label">
                        {item.attempts} attempts | Avg time{' '}
                        {formatDuration(item.averageTimeSeconds || 0)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="card card--elevated">
              <p className="card__value">Streak tracking</p>
              <p className="card__label">
                Status: {summary.streak?.status || 'inactive'} | Last active:{' '}
                {formatDateLabel(summary.streak?.lastActiveDate)}
              </p>
              {(summary.activityByDay || []).length === 0 ? (
                <p className="card__label">No activity trend yet.</p>
              ) : (
                <div className="mini-chart mini-chart--activity">
                  {(summary.activityByDay || []).slice(-12).map((day, index) => (
                    <div key={day.date} className="mini-chart__item">
                      <div
                        className="mini-chart__bar mini-chart__bar--activity"
                        style={{
                          height: `${Math.max(
                            12,
                            Math.min(100, (Number(day.attempts) || 0) * 20),
                          )}%`,
                          '--bar-delay': `${index * 35}ms`,
                        }}
                        title={`${day.attempts} attempts on ${day.date}`}
                      />
                      <span className="mini-chart__label">{formatDateLabel(day.date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="card card--elevated progress-difficulty-card">
              <p className="card__value">Difficulty mastery</p>
              <div className="progress-difficulty-list">
                {difficultyInsights.map((item) => (
                  <article key={item.difficulty} className="progress-difficulty-row">
                    <div className="progress-difficulty-row__head">
                      <span className="card__label">
                        {formatDifficultyLabel(item.difficulty)}
                      </span>
                      <span className="card__label">
                        Avg {item.averageScore || 0} | {item.attempts || 0} attempts
                      </span>
                    </div>
                    <div className="progress-difficulty-track" aria-hidden="true">
                      <span
                        className="progress-difficulty-fill"
                        style={{ width: `${Math.max(6, Number(item.averageScore) || 0)}%` }}
                      />
                    </div>
                    <p className="card__label">
                      Recent pace: {item.averageRecentTime ? formatDuration(item.averageRecentTime) : '-'} |{' '}
                      <span
                        className={`progress-tone progress-tone--${item.pace.tone}`}
                      >
                        {item.pace.label}
                      </span>
                    </p>
                  </article>
                ))}
              </div>
            </article>
          </div>

          <section className="progress-intelligence-grid">
            <article className="card card--elevated progress-intelligence-card">
              <p className="card__value">
                <FiBarChart2 size={15} /> Momentum + Consistency
              </p>
              <p className="card__label">{trendInsight.label}</p>
              <div className="progress-kpi-grid">
                <article className="progress-kpi">
                  <p>Momentum Delta</p>
                  <strong>
                    {trendInsight.direction === 'up' ? (
                      <FiTrendingUp size={13} />
                    ) : trendInsight.direction === 'down' ? (
                      <FiTrendingDown size={13} />
                    ) : (
                      <FiActivity size={13} />
                    )}{' '}
                    {trendInsight.delta > 0 ? '+' : ''}
                    {trendInsight.delta}
                  </strong>
                </article>
                <article className="progress-kpi">
                  <p>Consistency</p>
                  <strong>{consistencyInsight.score}/100</strong>
                </article>
              </div>
              <p className="card__label">{consistencyInsight.label}</p>
            </article>

            <article className="card card--elevated progress-intelligence-card">
              <p className="card__value">
                <FiTarget size={15} /> Weakness Radar
              </p>
              {weakCategories.length === 0 ? (
                <p className="card__label">Complete more attempts to unlock weak-lane detection.</p>
              ) : (
                <div className="progress-focus-list">
                  {weakCategories.map((item) => {
                    const scoreGap = strongestCategory
                      ? Math.max(
                          0,
                          Number(strongestCategory.averageScore || 0) -
                            Number(item.averageScore || 0),
                        ).toFixed(1)
                      : '0'
                    return (
                      <article key={item.category} className="progress-focus-item">
                        <div>
                          <p className="card__value">{item.category}</p>
                          <p className="card__label">
                            Avg {item.averageScore} | Gap to best {scoreGap}
                          </p>
                        </div>
                        <span className="progress-chip">{item.attempts} attempts</span>
                      </article>
                    )
                  })}
                </div>
              )}
            </article>

            <article className="card card--elevated progress-intelligence-card">
              <p className="card__value">
                <FiActivity size={15} /> 14-Day Activity Heat
              </p>
              <p className="card__label">
                Darker cells mean higher daily attempt volume. Keep chain continuity.
              </p>
              <div className="progress-heatmap" aria-label="14 day activity heatmap">
                {activityHeatmap.map((cell) => (
                  <span
                    key={cell.date}
                    className={`progress-heat-cell progress-heat-cell--${cell.level}`}
                    title={`${cell.label}: ${cell.attempts} attempts`}
                  />
                ))}
              </div>
              <p className="card__label">
                Last 14 days total:{' '}
                {activityHeatmap.reduce((total, item) => total + item.attempts, 0)} attempts
              </p>
            </article>

            <article className="card card--elevated progress-intelligence-card">
              <p className="card__value">
                <FiAward size={15} /> Milestones
              </p>
              <div className="progress-milestone-list">
                {milestoneRows.map((item) => (
                  <p key={item.label} className="progress-milestone-item">
                    {item.done ? <FiCheckCircle size={13} /> : <FiClock size={13} />}
                    {item.label}
                  </p>
                ))}
              </div>
            </article>

            <article className="card card--elevated progress-blueprint-card">
              <p className="card__value">
                <FiZap size={15} /> Smart Next Session Blueprint
              </p>
              <p className="card__label">
                Suggested from your weak categories, difficulty mastery, and momentum trend.
              </p>
              <div className="progress-blueprint-grid">
                <article className="progress-blueprint-tile">
                  <p>Focus Category</p>
                  <strong>{nextSessionPlan.focusCategory}</strong>
                </article>
                <article className="progress-blueprint-tile">
                  <p>Difficulty</p>
                  <strong>{formatDifficultyLabel(nextSessionPlan.recommendedDifficulty)}</strong>
                </article>
                <article className="progress-blueprint-tile">
                  <p>Question Count</p>
                  <strong>{nextSessionPlan.questionCount}</strong>
                </article>
                <article className="progress-blueprint-tile">
                  <p>Target Time</p>
                  <strong>{nextSessionPlan.targetMinutes} mins</strong>
                </article>
              </div>
              <div className="progress-blueprint-actions">
                <Link className="shell__button shell__button--primary" to="/practice">
                  Start planned session
                </Link>
                <Link className="shell__button" to="/mock-interview">
                  Validate in mock round
                </Link>
              </div>
            </article>
          </section>

          <section className="attempts-panel attempts-panel--animated">
            <h3 className="card__value">Recent attempts</h3>
            {attempts.length === 0 ? (
              <p className="card__label">
                No submissions yet. Start with a question from Practice.
              </p>
            ) : (
              <div className="attempt-list">
                {attempts.map((attempt) => (
                  <article key={attempt.id} className="attempt-list__item">
                    <div>
                      <p className="card__value">
                        {attempt.questionTitle} | Score {attempt.score}
                      </p>
                      <p className="card__label">
                        {attempt.questionCategory} | {attempt.questionDifficulty} |{' '}
                        {formatDuration(attempt.timeSpentSeconds)}
                      </p>
                      <p className="card__label">{attempt.feedback}</p>
                    </div>
                    <Link
                      className="shell__button"
                      to={`/practice/questions/${attempt.questionId}`}
                    >
                      Retry
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}

      {!isLoading && !errorMessage && attempts.length === 0 ? (
        <article className="card card--elevated progress-empty-guide">
          <p className="card__value">
            <FiAlertCircle size={15} /> Progress data unlock guide
          </p>
          <p className="card__label">
            Complete 3 attempts to enable momentum and consistency insights. Complete 10 attempts
            for stronger category and difficulty recommendations.
          </p>
        </article>
      ) : null}
    </section>
  )
}

export default ProgressPage

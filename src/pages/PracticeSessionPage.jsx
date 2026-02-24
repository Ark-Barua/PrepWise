import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import useAuth from '../auth/useAuth'
import NebulaLoader from '../components/NebulaLoader'
import {
  fetchPracticeSession,
  fetchPracticeSessionReport,
  submitPracticeSessionAttempt,
} from '../lib/api'

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0)
  const minutes = Math.floor(safeSeconds / 60)
    .toString()
    .padStart(2, '0')
  const seconds = (safeSeconds % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

function formatDurationCompact(totalSeconds) {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0)
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

function difficultyLabel(value) {
  if (!value) {
    return 'Unknown'
  }
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function normalizePercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0))
}

function PracticeSessionPage() {
  const { sessionId } = useParams()
  const { user } = useAuth()
  const [session, setSession] = useState(null)
  const [report, setReport] = useState(null)
  const [answerText, setAnswerText] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isReportLoading, setIsReportLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [submissionError, setSubmissionError] = useState('')
  const [timerSeconds, setTimerSeconds] = useState(0)
  const [isTimerRunning, setIsTimerRunning] = useState(true)
  const [latestAttempt, setLatestAttempt] = useState(null)

  const currentItem = useMemo(() => {
    if (!session || session.nextQuestionIndex === null || session.nextQuestionIndex < 0) {
      return null
    }

    return session.items?.[session.nextQuestionIndex] || null
  }, [session])
  const currentItemId = currentItem?.sessionItemId || null

  useEffect(() => {
    let isCancelled = false

    async function loadSession() {
      setIsLoading(true)
      setErrorMessage('')
      setReport(null)

      try {
        const sessionResponse = await fetchPracticeSession(sessionId, user.email)
        if (isCancelled) {
          return
        }

        const loadedSession = sessionResponse?.data || null
        setSession(loadedSession)

        if (loadedSession?.isCompleted) {
          setIsReportLoading(true)
          const reportResponse = await fetchPracticeSessionReport(
            sessionId,
            user.email,
          )
          if (!isCancelled) {
            setReport(reportResponse?.data || null)
          }
        }
      } catch (error) {
        if (!isCancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Unable to load practice session.',
          )
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
          setIsReportLoading(false)
        }
      }
    }

    void loadSession()

    return () => {
      isCancelled = true
    }
  }, [sessionId, user.email])

  useEffect(() => {
    setAnswerText('')
    setSubmissionError('')
    setTimerSeconds(0)
    setIsTimerRunning(currentItemId !== null)
  }, [currentItemId])

  useEffect(() => {
    if (!isTimerRunning || !currentItem) {
      return undefined
    }

    const intervalId = setInterval(() => {
      setTimerSeconds((currentValue) => currentValue + 1)
    }, 1000)

    return () => {
      clearInterval(intervalId)
    }
  }, [isTimerRunning, currentItem])

  useEffect(() => {
    let isCancelled = false

    async function loadReportIfNeeded() {
      if (!session?.isCompleted || report) {
        return
      }

      setIsReportLoading(true)
      try {
        const reportResponse = await fetchPracticeSessionReport(session.id, user.email)
        if (!isCancelled) {
          setReport(reportResponse?.data || null)
        }
      } catch (error) {
        if (!isCancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Unable to load final report.',
          )
        }
      } finally {
        if (!isCancelled) {
          setIsReportLoading(false)
        }
      }
    }

    void loadReportIfNeeded()

    return () => {
      isCancelled = true
    }
  }, [report, session, user.email])

  async function handleSubmit(event) {
    event.preventDefault()

    if (!session || !currentItem) {
      return
    }

    setIsSubmitting(true)
    setSubmissionError('')

    try {
      const response = await submitPracticeSessionAttempt(session.id, {
        userId: user.email,
        userName: user.name,
        questionId: currentItem.questionId,
        answerText,
        timeSpentSeconds: timerSeconds,
      })

      const payload = response?.data || {}
      setLatestAttempt(payload.attempt || null)

      if (payload.session) {
        setSession(payload.session)
      }

      if (payload.report) {
        setReport(payload.report)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to submit answer.'
      setSubmissionError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const progressPercent = normalizePercent(session?.progressPercent)
  const answeredCount = session?.answeredQuestions || 0
  const totalQuestions = session?.totalQuestions || 0
  const currentQuestionNumber = currentItem ? currentItem.sequenceIndex + 1 : totalQuestions

  if (isLoading) {
    return (
      <section className="page">
        <NebulaLoader label="Loading practice session..." />
      </section>
    )
  }

  if (errorMessage || !session) {
    return (
      <section className="page">
        <h2 className="page__title">Session unavailable</h2>
        <p className="auth-error">{errorMessage || 'Unable to find this session.'}</p>
        <Link className="shell__button" to="/practice">
          Back to practice
        </Link>
      </section>
    )
  }

  return (
    <section className="page page--experience page--practice-session">
      <header className="session-head session-head--animated">
        <div className="session-head__content">
          <p className="experience-hero__eyebrow">Sequential Session</p>
          <h2 className="experience-hero__title">{session.title}</h2>
          <p className="experience-hero__description">
            Answer each question in order. Progress updates automatically after every
            submission.
          </p>
        </div>
        <div className="session-head__stats">
          <article className="hero-pill">
            <p>Answered</p>
            <strong>
              {answeredCount}/{totalQuestions}
            </strong>
          </article>
          <article className="hero-pill">
            <p>Status</p>
            <strong>{session.isCompleted ? 'Completed' : 'In progress'}</strong>
          </article>
          <article className="hero-pill">
            <p>Progress</p>
            <strong>{progressPercent}%</strong>
          </article>
        </div>
        <div className="session-progress">
          <div className="session-progress__track" aria-hidden="true">
            <span
              className="session-progress__fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="session-progress__label">
            Question {Math.max(1, currentQuestionNumber)} of {Math.max(1, totalQuestions)}
          </p>
        </div>
      </header>

      <div className="session-stepper" aria-label="Session question progress">
        {session.items.map((item) => {
          const isCurrent = currentItem?.sessionItemId === item.sessionItemId
          const itemClassName = item.answered
            ? 'session-stepper__item session-stepper__item--done'
            : isCurrent
              ? 'session-stepper__item session-stepper__item--active'
              : 'session-stepper__item'
          return (
            <span key={item.sessionItemId} className={itemClassName}>
              {item.sequenceIndex + 1}
            </span>
          )
        })}
      </div>

      {!session.isCompleted && currentItem ? (
        <article className="session-question session-question--animated">
          <div className="answer-head">
            <div>
              <h3 className="page__title">{currentItem.title}</h3>
              <p className="page__description">{currentItem.prompt}</p>
              <div className="question-card__meta">
                <span className="chip">{currentItem.category}</span>
                <span className="chip chip--subtle">
                  {difficultyLabel(currentItem.difficulty)}
                </span>
              </div>
            </div>
            <div className="timer-card timer-card--session">
              <p className="timer-card__label">Live timer</p>
              <p className="timer-card__value">{formatDuration(timerSeconds)}</p>
              <p className="timer-card__meta">
                Ideal: {formatDuration(currentItem.idealSeconds)}
              </p>
            </div>
          </div>

          <form className="answer-form" onSubmit={handleSubmit}>
            <label className="form-field" htmlFor="sessionAnswerText">
              Your answer
              <textarea
                id="sessionAnswerText"
                value={answerText}
                onChange={(event) => setAnswerText(event.target.value)}
                rows={10}
                placeholder="Write a structured answer..."
                required
              />
            </label>

            {submissionError ? <p className="auth-error">{submissionError}</p> : null}

            <div className="answer-form__actions">
              <button
                type="submit"
                className="shell__button shell__button--primary"
                disabled={isSubmitting || !answerText.trim()}
              >
                {isSubmitting ? 'Submitting...' : 'Submit and continue'}
              </button>
              <button
                type="button"
                className="shell__button"
                onClick={() => setAnswerText('')}
              >
                Clear answer
              </button>
              <Link className="shell__button" to="/practice">
                Exit session
              </Link>
            </div>
          </form>
        </article>
      ) : null}

      {latestAttempt ? (
        <article className="feedback-card feedback-card--session">
          <p className="shell__eyebrow">Latest submission</p>
          <h3 className="card__value">Score: {latestAttempt.score}/100</h3>
          <p className="card__label">{latestAttempt.feedback}</p>
          <div className="question-card__meta">
            <span className="chip chip--subtle">
              Keywords: {latestAttempt.keywordHits}/{latestAttempt.keywordTarget}
            </span>
            <span className="chip chip--subtle">
              Time: {formatDuration(latestAttempt.timeSpentSeconds)}
            </span>
          </div>
        </article>
      ) : null}

      {session.isCompleted ? (
        <section className="session-report session-report--animated">
          <div className="session-report__head">
            <div>
              <p className="shell__eyebrow">Final Report</p>
              <h3 className="page__title">Session complete</h3>
              <p className="card__label">
                Summary of score quality, category breakdown, and targeted improvement
                areas.
              </p>
            </div>
            <div className="answer-form__actions">
              <Link className="shell__button shell__button--primary" to="/practice">
                Start new session
              </Link>
              <Link className="shell__button" to="/progress">
                View overall progress
              </Link>
            </div>
          </div>

          {isReportLoading ? (
            <NebulaLoader label="Loading report..." />
          ) : report ? (
            <>
              <div className="session-report__grid">
                <article className="card card--elevated">
                  <p className="card__label">Overall score</p>
                  <p className="card__value">{report.overallScore}</p>
                  <p className="card__label">Band: {report.scoreBand}</p>
                </article>
                <article className="card card--elevated">
                  <p className="card__label">Completion</p>
                  <p className="card__value">
                    {report.answeredQuestions}/{report.totalQuestions}
                  </p>
                  <p className="card__label">{report.completionRate}% complete</p>
                </article>
                <article className="card card--elevated">
                  <p className="card__label">Keyword coverage</p>
                  <p className="card__value">{report.overallKeywordCoverage}%</p>
                  <p className="card__label">
                    Total time: {formatDurationCompact(report.totalTimeSeconds)}
                  </p>
                </article>
                <article className="card card--elevated">
                  <p className="card__label">Weakest category</p>
                  <p className="card__value">
                    {report.weakestCategory?.category || '-'}
                  </p>
                  <p className="card__label">
                    Avg {report.weakestCategory?.averageScore ?? '-'}
                  </p>
                </article>
              </div>

              <div className="session-report__lists">
                <article className="card card--elevated">
                  <p className="card__value">Strengths</p>
                  {report.strengths?.length ? (
                    <ul className="session-report__list">
                      {report.strengths.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="card__label">No strengths logged yet.</p>
                  )}
                </article>
                <article className="card card--elevated">
                  <p className="card__value">Weaknesses to improve</p>
                  {report.weaknesses?.length ? (
                    <ul className="session-report__list">
                      {report.weaknesses.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="card__label">No weaknesses detected.</p>
                  )}
                </article>
              </div>

              <article className="card card--elevated">
                <p className="card__value">Category performance</p>
                {(report.categoryPerformance || []).length === 0 ? (
                  <p className="card__label">No category data available.</p>
                ) : (
                  <div className="performance-list">
                    {report.categoryPerformance.map((item, index) => (
                      <div key={item.category} className="performance-list__item">
                        <div className="performance-list__head">
                          <span className="card__label">{item.category}</span>
                          <span className="card__label">
                            Avg {item.averageScore} | {item.attempts} attempts
                          </span>
                        </div>
                        <div className="performance-list__track">
                          <span
                            className="performance-list__fill"
                            style={{
                              width: `${Math.max(6, normalizePercent(item.averageScore))}%`,
                              '--bar-delay': `${index * 45}ms`,
                            }}
                          />
                        </div>
                        <p className="card__label">
                          Keyword coverage: {item.keywordCoverage}% | Avg time:{' '}
                          {formatDurationCompact(item.averageTimeSeconds)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </article>

              <article className="card card--elevated">
                <p className="card__value">Question-by-question breakdown</p>
                <div className="attempt-list">
                  {report.questionBreakdown.map((item) => (
                    <article key={item.questionId} className="attempt-list__item">
                      <div>
                        <p className="card__value">
                          Q{item.sequenceIndex + 1}: {item.title}
                        </p>
                        <p className="card__label">
                          {item.category} | {difficultyLabel(item.difficulty)}
                        </p>
                        <p className="card__label">
                          {item.answered
                            ? `Score ${item.score} | Coverage ${item.keywordCoverage}%`
                            : 'Not answered'}
                        </p>
                      </div>
                      <span className="badge">
                        {item.answered ? 'Answered' : 'Pending'}
                      </span>
                    </article>
                  ))}
                </div>
              </article>
            </>
          ) : (
            <p className="card__label">Final report is not available yet.</p>
          )}
        </section>
      ) : null}
    </section>
  )
}

export default PracticeSessionPage

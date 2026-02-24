import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import useAuth from '../auth/useAuth'
import NebulaLoader from '../components/NebulaLoader'
import { fetchAttempts, fetchQuestion, submitAttempt } from '../lib/api'

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0)
  const minutes = Math.floor(safeSeconds / 60)
    .toString()
    .padStart(2, '0')
  const seconds = (safeSeconds % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

function QuestionAnswerPage() {
  const { questionId } = useParams()
  const { user } = useAuth()
  const [question, setQuestion] = useState(null)
  const [answerText, setAnswerText] = useState('')
  const [attemptHistory, setAttemptHistory] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [submissionError, setSubmissionError] = useState('')
  const [latestAttempt, setLatestAttempt] = useState(null)
  const [timerSeconds, setTimerSeconds] = useState(0)
  const [isTimerRunning, setIsTimerRunning] = useState(true)

  useEffect(() => {
    let isCancelled = false

    async function loadData() {
      setIsLoading(true)
      setErrorMessage('')
      setLatestAttempt(null)
      setAnswerText('')
      setTimerSeconds(0)
      setIsTimerRunning(true)

      try {
        const [questionResponse, attemptsResponse] = await Promise.all([
          fetchQuestion(questionId),
          fetchAttempts({
            userId: user?.email || '',
            questionId,
            limit: 5,
          }),
        ])

        if (isCancelled) {
          return
        }

        setQuestion(questionResponse?.data || null)
        setAttemptHistory(attemptsResponse?.data || [])
      } catch (error) {
        if (!isCancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Unable to load question data.',
          )
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadData()

    return () => {
      isCancelled = true
    }
  }, [questionId, user?.email])

  useEffect(() => {
    if (!isTimerRunning || isLoading) {
      return undefined
    }

    const intervalId = setInterval(() => {
      setTimerSeconds((current) => current + 1)
    }, 1000)

    return () => {
      clearInterval(intervalId)
    }
  }, [isLoading, isTimerRunning])

  const paceStatus = useMemo(() => {
    const idealSeconds = question?.idealSeconds || 0
    if (!idealSeconds) {
      return 'No pace target'
    }

    if (timerSeconds < idealSeconds * 0.7) {
      return 'Pace: fast'
    }

    if (timerSeconds > idealSeconds * 1.2) {
      return 'Pace: over target'
    }

    return 'Pace: on target'
  }, [question?.idealSeconds, timerSeconds])

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmissionError('')
    setIsSubmitting(true)

    try {
      const response = await submitAttempt({
        userId: user?.email,
        userName: user?.name,
        questionId: Number(questionId),
        answerText,
        timeSpentSeconds: timerSeconds,
      })

      const createdAttempt = response?.data || null
      setLatestAttempt(createdAttempt)
      setAttemptHistory((current) =>
        createdAttempt ? [createdAttempt, ...current].slice(0, 5) : current,
      )
      setIsTimerRunning(false)
    } catch (error) {
      setSubmissionError(
        error instanceof Error ? error.message : 'Failed to submit attempt.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  function resetAttempt() {
    setAnswerText('')
    setLatestAttempt(null)
    setSubmissionError('')
    setTimerSeconds(0)
    setIsTimerRunning(true)
  }

  if (isLoading) {
    return (
      <section className="page">
        <NebulaLoader label="Loading question..." />
      </section>
    )
  }

  if (errorMessage || !question) {
    return (
      <section className="page">
        <h2 className="page__title">Question unavailable</h2>
        <p className="auth-error">{errorMessage || 'Unable to find this question.'}</p>
        <Link className="shell__button" to="/practice">
          Back to question list
        </Link>
      </section>
    )
  }

  return (
    <section className="page">
      <div className="answer-head">
        <div>
          <h2 className="page__title">{question.title}</h2>
          <p className="page__description">{question.prompt}</p>
          <div className="question-card__meta">
            <span className="chip">{question.category}</span>
            <span className="chip chip--subtle">{question.difficulty}</span>
          </div>
        </div>
        <div className="timer-card">
          <p className="timer-card__label">Timer</p>
          <p className="timer-card__value">{formatDuration(timerSeconds)}</p>
          <p className="timer-card__meta">
            Ideal: {formatDuration(question.idealSeconds)} | {paceStatus}
          </p>
        </div>
      </div>

      <form className="answer-form" onSubmit={handleSubmit}>
        <label className="form-field" htmlFor="answerText">
          Your answer
          <textarea
            id="answerText"
            value={answerText}
            onChange={(event) => setAnswerText(event.target.value)}
            rows={10}
            placeholder="Write your structured response here..."
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
            {isSubmitting ? 'Submitting...' : 'Submit attempt'}
          </button>
          <button type="button" className="shell__button" onClick={resetAttempt}>
            Reset and retry
          </button>
          <Link className="shell__button" to="/practice">
            Back to list
          </Link>
        </div>
      </form>

      {latestAttempt ? (
        <article className="feedback-card">
          <p className="shell__eyebrow">Latest feedback</p>
          <h3 className="card__value">
            Score: {latestAttempt.score}/100
          </h3>
          <p className="page__description">{latestAttempt.feedback}</p>
          <div className="question-card__meta">
            <span className="chip chip--subtle">
              Keyword coverage: {latestAttempt.keywordHits}/{latestAttempt.keywordTarget}
            </span>
            <span className="chip chip--subtle">
              Time: {formatDuration(latestAttempt.timeSpentSeconds)}
            </span>
          </div>
        </article>
      ) : null}

      <section className="attempts-panel">
        <h3 className="card__value">Recent attempts on this question</h3>
        {attemptHistory.length === 0 ? (
          <p className="card__label">No attempts yet. Submit your first answer.</p>
        ) : (
          <div className="attempt-list">
            {attemptHistory.map((attempt) => (
              <article key={attempt.id} className="attempt-list__item">
                <p className="card__value">
                  Score {attempt.score} | {formatDuration(attempt.timeSpentSeconds)}
                </p>
                <p className="card__label">{attempt.feedback}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  )
}

export default QuestionAnswerPage

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FiBriefcase,
  FiCamera,
  FiCameraOff,
  FiFileText,
  FiLock,
  FiMessageSquare,
  FiMic,
  FiMicOff,
  FiPlayCircle,
  FiRepeat,
  FiTarget,
  FiTrendingUp,
  FiUserCheck,
  FiZap,
} from 'react-icons/fi'
import useAuth from '../auth/useAuth'
import {
  createMockInterviewSession,
  submitAttempt,
} from '../lib/api'

function clampQuestionCount(value) {
  const numeric = Number.parseInt(value, 10)
  if (Number.isNaN(numeric)) {
    return 6
  }
  return Math.max(3, Math.min(15, numeric))
}

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
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60
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

function toAverage(values) {
  if (!values.length) {
    return 0
  }
  const sum = values.reduce((total, item) => total + item, 0)
  return sum / values.length
}

function shuffleQuestions(questions) {
  const shuffled = [...questions]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    const current = shuffled[index]
    shuffled[index] = shuffled[randomIndex]
    shuffled[randomIndex] = current
  }
  return shuffled
}

function MockInterviewPage() {
  const { user } = useAuth()
  const [resolvedPlanTier, setResolvedPlanTier] = useState(
    String(user?.planTier || 'free').toLowerCase(),
  )
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [infoMessage, setInfoMessage] = useState('')
  const [videoError, setVideoError] = useState('')
  const [isVideoLoading, setIsVideoLoading] = useState(false)
  const [isVideoEnabled, setIsVideoEnabled] = useState(false)
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true)
  const [generationMeta, setGenerationMeta] = useState(null)
  const [interviewQuestions, setInterviewQuestions] = useState([])
  const [attemptResults, setAttemptResults] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answerText, setAnswerText] = useState('')
  const [latestAttempt, setLatestAttempt] = useState(null)
  const [timerSeconds, setTimerSeconds] = useState(0)
  const [isTimerRunning, setIsTimerRunning] = useState(false)
  const [isInterviewStarted, setIsInterviewStarted] = useState(false)
  const [isInterviewCompleted, setIsInterviewCompleted] = useState(false)
  const [form, setForm] = useState({
    role: '',
    jobDescription: '',
    resumeText: '',
    difficulty: 'medium',
    count: 6,
  })

  const videoRef = useRef(null)
  const mediaStreamRef = useRef(null)

  const canUseSpeech =
    typeof window !== 'undefined' && 'speechSynthesis' in window
  const canUseVideoApi =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)

  const isProUser = resolvedPlanTier === 'pro'
  const activePlanLabel = isProUser ? 'Pro' : 'Free'
  const resumeAccessLabel = isProUser ? 'Unlocked' : 'Locked on Free'

  const totalQuestions = interviewQuestions.length
  const answeredCount = attemptResults.length
  const progressPercent = totalQuestions
    ? Math.round((answeredCount / totalQuestions) * 100)
    : 0
  const currentQuestion = interviewQuestions[currentIndex] || null
  const questionNumber = Math.min(currentIndex + 1, Math.max(1, totalQuestions))

  const promptPreview = useMemo(() => {
    if (!form.jobDescription.trim()) {
      return 'Paste a job description to generate role-specific interview questions.'
    }

    const preview = form.jobDescription.trim().replace(/\s+/g, ' ')
    return preview.length > 200 ? `${preview.slice(0, 200)}...` : preview
  }, [form.jobDescription])

  const report = useMemo(() => {
    if (!isInterviewCompleted || attemptResults.length === 0) {
      return null
    }

    const overallScore = Math.round(toAverage(attemptResults.map((item) => item.score || 0)))
    const averageCoverage = Math.round(
      toAverage(
        attemptResults.map((item) => {
          const target = Math.max(1, item.keywordTarget || 0)
          return Math.round(((item.keywordHits || 0) / target) * 100)
        }),
      ),
    )
    const averageTimeSeconds = Math.round(
      toAverage(attemptResults.map((item) => item.timeSpentSeconds || 0)),
    )
    const averageIdealSeconds = Math.round(
      toAverage(attemptResults.map((item) => item.idealSeconds || 0)),
    )

    const strongest = [...attemptResults]
      .sort((left, right) => (right.score || 0) - (left.score || 0))
      .slice(0, 3)
    const weakest = [...attemptResults]
      .sort((left, right) => (left.score || 0) - (right.score || 0))
      .slice(0, 3)

    const suggestions = []
    if (overallScore < 70) {
      suggestions.push(
        'Use STAR structure consistently: Situation, Task, Action, and measurable Result.',
      )
    }
    if (averageCoverage < 55) {
      suggestions.push(
        generationMeta?.includesResume
          ? 'Connect each answer to a concrete CV achievement and mirror JD keywords directly.'
          : 'Increase keyword relevance by explicitly reflecting JD language in each response.',
      )
    }
    if (averageIdealSeconds > 0 && averageTimeSeconds > averageIdealSeconds * 1.25) {
      suggestions.push(
        'Responses are running long. Target concise 60-120 second answers with one clear takeaway.',
      )
    }
    if (weakest.length > 0) {
      suggestions.push(
        `Rehearse weaker topics: ${weakest.map((item) => item.title).join(', ')}.`,
      )
    }
    if (generationMeta?.includesResume) {
      suggestions.push(
        'Keep examples tightly aligned to CV projects and quantified outcomes for stronger credibility.',
      )
    } else if (!isProUser) {
      suggestions.push(
        'Upgrade to Pro to include CV context and receive CV-aligned interview suggestions.',
      )
    }

    return {
      overallScore,
      averageCoverage,
      averageTimeSeconds,
      strengths: strongest,
      weaknesses: weakest,
      suggestions: suggestions.slice(0, 5),
      alignmentMode: generationMeta?.includesResume ? 'JD + CV aligned' : 'JD aligned',
    }
  }, [attemptResults, generationMeta, isInterviewCompleted, isProUser])

  const stopVideoStream = useCallback(() => {
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop()
      }
      mediaStreamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setIsVideoEnabled(false)
  }, [])

  const speakQuestion = useCallback(
    (question) => {
      if (!canUseSpeech || !question) {
        return
      }

      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(
        `${question.title}. ${question.prompt}`,
      )
      utterance.rate = 0.95
      utterance.pitch = 1
      window.speechSynthesis.speak(utterance)
    },
    [canUseSpeech],
  )

  useEffect(() => {
    const nextTier = String(user?.planTier || 'free').toLowerCase()
    setResolvedPlanTier(nextTier === 'pro' ? 'pro' : 'free')
  }, [user?.planTier])

  useEffect(() => {
    if (!isTimerRunning || !isInterviewStarted || isInterviewCompleted) {
      return undefined
    }

    const intervalId = setInterval(() => {
      setTimerSeconds((currentValue) => currentValue + 1)
    }, 1000)

    return () => {
      clearInterval(intervalId)
    }
  }, [isInterviewCompleted, isInterviewStarted, isTimerRunning])

  useEffect(() => {
    if (
      !isInterviewStarted ||
      isInterviewCompleted ||
      !isVoiceEnabled ||
      !currentQuestion
    ) {
      return
    }

    speakQuestion(currentQuestion)
  }, [
    currentQuestion,
    isInterviewCompleted,
    isInterviewStarted,
    isVoiceEnabled,
    speakQuestion,
  ])

  useEffect(() => {
    return () => {
      stopVideoStream()
      if (canUseSpeech) {
        window.speechSynthesis.cancel()
      }
    }
  }, [canUseSpeech, stopVideoStream])

  function updateField(key, value) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function resetWorkspace() {
    setForm({
      role: '',
      jobDescription: '',
      resumeText: '',
      difficulty: 'medium',
      count: 6,
    })
    setGenerationMeta(null)
    setInterviewQuestions([])
    setAttemptResults([])
    setCurrentIndex(0)
    setAnswerText('')
    setLatestAttempt(null)
    setTimerSeconds(0)
    setIsTimerRunning(false)
    setIsInterviewStarted(false)
    setIsInterviewCompleted(false)
    setErrorMessage('')
    setInfoMessage('')
    stopVideoStream()
    if (canUseSpeech) {
      window.speechSynthesis.cancel()
    }
  }

  async function enableVideo() {
    setVideoError('')
    if (!canUseVideoApi) {
      setVideoError('Camera access is not supported in this browser.')
      return
    }

    setIsVideoLoading(true)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      })
      mediaStreamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setIsVideoEnabled(true)
    } catch {
      setVideoError('Unable to access camera. Please allow camera permission.')
      setIsVideoEnabled(false)
    } finally {
      setIsVideoLoading(false)
    }
  }

  function handleVideoToggle() {
    if (isVideoEnabled) {
      stopVideoStream()
      return
    }

    void enableVideo()
  }

  function restartInterview() {
    setInterviewQuestions((current) => shuffleQuestions(current))
    setAttemptResults([])
    setCurrentIndex(0)
    setAnswerText('')
    setTimerSeconds(0)
    setLatestAttempt(null)
    setIsInterviewCompleted(false)
    setIsTimerRunning(true)
    setInfoMessage('Interview restarted with a new random order.')
  }

  async function handleGenerate(event) {
    event.preventDefault()
    setErrorMessage('')
    setInfoMessage('')

    const normalizedJd = String(form.jobDescription || '').trim()
    if (!normalizedJd) {
      setErrorMessage('Job description is required for mock interview generation.')
      return
    }

    setIsGenerating(true)

    try {
      const response = await createMockInterviewSession({
        userId: user.email,
        userName: user.name,
        role: String(form.role || '').trim() || null,
        jobDescription: normalizedJd,
        resumeText: isProUser ? String(form.resumeText || '').trim() || null : null,
        difficulty: form.difficulty,
        count: clampQuestionCount(form.count),
      })

      const generatedQuestions = response?.data || []
      if (!generatedQuestions.length) {
        throw new Error('No questions generated for this input.')
      }

      const randomized = shuffleQuestions(generatedQuestions)
      setGenerationMeta(response?.meta || null)
      setInterviewQuestions(randomized)
      setAttemptResults([])
      setCurrentIndex(0)
      setAnswerText('')
      setLatestAttempt(null)
      setTimerSeconds(0)
      setIsInterviewStarted(true)
      setIsInterviewCompleted(false)
      setIsTimerRunning(true)
      setInfoMessage(
        `${randomized.length} random interview questions generated. Interview started.`,
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to generate mock interview right now.',
      )
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleSubmitAnswer(event) {
    event.preventDefault()
    if (!currentQuestion) {
      return
    }

    const normalizedAnswer = answerText.trim()
    if (!normalizedAnswer) {
      setErrorMessage('Answer is required before submitting.')
      return
    }

    setErrorMessage('')
    setIsSubmitting(true)
    setIsTimerRunning(false)

    try {
      const response = await submitAttempt({
        userId: user.email,
        userName: user.name,
        questionId: Number(currentQuestion.id),
        answerText: normalizedAnswer,
        timeSpentSeconds: timerSeconds,
      })

      const attempt = response?.data || {}
      const normalizedResult = {
        questionId: Number(currentQuestion.id),
        title: currentQuestion.title,
        prompt: currentQuestion.prompt,
        category: currentQuestion.category,
        difficulty: currentQuestion.difficulty,
        idealSeconds: currentQuestion.idealSeconds,
        score: attempt.score || 0,
        feedback: attempt.feedback || 'Feedback unavailable.',
        keywordHits: attempt.keywordHits || 0,
        keywordTarget: attempt.keywordTarget || 0,
        timeSpentSeconds: attempt.timeSpentSeconds || timerSeconds,
      }

      setAttemptResults((current) => [...current, normalizedResult])
      setLatestAttempt(normalizedResult)

      const nextIndex = currentIndex + 1
      if (nextIndex >= interviewQuestions.length) {
        setCurrentIndex(nextIndex)
        setAnswerText('')
        setTimerSeconds(0)
        setIsInterviewCompleted(true)
        setIsTimerRunning(false)
        setInfoMessage('Mock interview completed. Final report is ready.')
        if (canUseSpeech) {
          window.speechSynthesis.cancel()
        }
      } else {
        setCurrentIndex(nextIndex)
        setAnswerText('')
        setTimerSeconds(0)
        setIsTimerRunning(true)
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Failed to submit answer for scoring.',
      )
      setIsTimerRunning(true)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="page page--experience page--mock-interview">
      <div className="experience-hero experience-hero--mock">
        <div className="experience-hero__content">
          <p className="experience-hero__eyebrow">Interview Simulator</p>
          <h2 className="experience-hero__title">Mock Interview</h2>
          <p className="experience-hero__description">
            Structured mock interview experience with random JD-based questioning, live progress, and AI-style feedback.
          </p>
          <div className="experience-hero__actions">
            {!isProUser ? (
              <Link className="shell__button shell__button--primary" to="/billing">
                Unlock CV mode
              </Link>
            ) : null}
            <button type="button" className="shell__button" onClick={resetWorkspace}>
              Reset workspace
            </button>
          </div>
        </div>
        <div className="experience-hero__snapshot">
          <article className="hero-pill">
            <p>Current Plan</p>
            <strong>{activePlanLabel}</strong>
          </article>
          <article className="hero-pill">
            <p>CV Access</p>
            <strong>{resumeAccessLabel}</strong>
          </article>
          <article className="hero-pill">
            <p>Interview State</p>
            <strong>{isInterviewCompleted ? 'Completed' : isInterviewStarted ? 'Running' : 'Ready'}</strong>
          </article>
        </div>
        <span className="experience-hero__flare experience-hero__flare--one" />
        <span className="experience-hero__flare experience-hero__flare--two" />
      </div>

      {errorMessage ? <p className="auth-error">{errorMessage}</p> : null}
      {infoMessage ? <p className="billing-message">{infoMessage}</p> : null}

      <div className="mock-layout">
        <article className="card card--elevated mock-panel mock-panel--config">
          <div className="mock-panel__head">
            <p className="card__value">
              <FiMessageSquare size={15} /> Interview Configuration
            </p>
            <p className="card__label">Questions are generated from your context and shuffled for realism.</p>
          </div>

          <form className="mock-config-form" onSubmit={handleGenerate}>
            <label className="form-field">
              <FiBriefcase size={13} /> Target role (optional)
              <input
                type="text"
                value={form.role}
                onChange={(event) => updateField('role', event.target.value)}
                placeholder="Frontend Engineer"
                maxLength={100}
              />
            </label>

            <label className="form-field">
              <FiFileText size={13} /> Job description
              <textarea
                value={form.jobDescription}
                onChange={(event) => updateField('jobDescription', event.target.value)}
                placeholder="Paste the JD here. This is mandatory."
                required
                minLength={60}
              />
            </label>

            <label className="form-field">
              <FiUserCheck size={13} /> CV / resume context
              <textarea
                value={form.resumeText}
                onChange={(event) => updateField('resumeText', event.target.value)}
                placeholder={
                  isProUser
                    ? 'Add CV highlights, projects, and measurable outcomes.'
                    : 'Upgrade to Pro to include CV alignment.'
                }
                disabled={!isProUser}
              />
            </label>

            {!isProUser ? (
              <p className="mock-gate">
                <FiLock size={13} /> Free trial supports JD-only mock interview.
              </p>
            ) : null}

            <div className="mock-config-grid">
              <label className="form-field">
                Difficulty
                <select
                  value={form.difficulty}
                  onChange={(event) => updateField('difficulty', event.target.value)}
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </label>
              <label className="form-field">
                Questions
                <input
                  type="number"
                  min={3}
                  max={15}
                  value={form.count}
                  onChange={(event) => updateField('count', event.target.value)}
                />
              </label>
            </div>

            <div className="mock-config-actions">
              <button
                type="submit"
                className="shell__button shell__button--primary"
                disabled={isGenerating}
              >
                <FiZap size={14} /> {isGenerating ? 'Generating...' : 'Generate Interview'}
              </button>
            </div>
          </form>
        </article>

        <article className="card card--elevated mock-panel mock-panel--studio">
          <div className="mock-panel__head">
            <p className="card__value">
              <FiPlayCircle size={15} /> Interview Studio
            </p>
            <p className="card__label">Control voice/video and monitor readiness before and during the session.</p>
          </div>

          <div className="mock-studio-actions">
            <button
              type="button"
              className="shell__button"
              onClick={() => setIsVoiceEnabled((current) => !current)}
            >
              {isVoiceEnabled ? <FiMic size={14} /> : <FiMicOff size={14} />}
              {isVoiceEnabled ? 'Voice On' : 'Voice Off'}
            </button>
            <button
              type="button"
              className="shell__button"
              onClick={handleVideoToggle}
              disabled={isVideoLoading}
            >
              {isVideoEnabled ? <FiCameraOff size={14} /> : <FiCamera size={14} />}
              {isVideoLoading
                ? 'Loading Camera...'
                : isVideoEnabled
                  ? 'Disable Video'
                  : 'Enable Video'}
            </button>
          </div>

          {videoError ? <p className="auth-error">{videoError}</p> : null}

          <div className={isVideoEnabled ? 'mock-video-shell mock-video-shell--active' : 'mock-video-shell'}>
            {isVideoEnabled ? (
              <video ref={videoRef} className="mock-video" autoPlay muted playsInline />
            ) : (
              <p className="mock-video-empty">
                {canUseVideoApi
                  ? 'Video preview is disabled.'
                  : 'Camera API not available in this browser.'}
              </p>
            )}
          </div>

          <div className="mock-studio-meta">
            <article className="mock-meta-tile">
              <p>Prompt Preview</p>
              <strong>{promptPreview}</strong>
            </article>
            <article className="mock-meta-tile">
              <p>Current Progress</p>
              <strong>{progressPercent}%</strong>
            </article>
          </div>
        </article>
      </div>

      {isInterviewStarted ? (
        <div className="mock-session-layout">
          <article className="card card--elevated mock-session-main">
            <div className="mock-session-main__head">
              <div>
                <p className="shell__eyebrow">Live Interview</p>
                <h3 className="page__title">
                  Question {questionNumber} of {Math.max(1, totalQuestions)}
                </h3>
              </div>
              <article className="mock-timer-pill">
                <p>Timer</p>
                <strong>{formatDuration(timerSeconds)}</strong>
              </article>
            </div>

            <div className="mock-stepper" aria-label="Interview progress">
              {interviewQuestions.map((question, index) => {
                const isDone = index < answeredCount
                const isActive = !isInterviewCompleted && index === currentIndex
                const className = isDone
                  ? 'mock-stepper__item mock-stepper__item--done'
                  : isActive
                    ? 'mock-stepper__item mock-stepper__item--active'
                    : 'mock-stepper__item'
                return (
                  <span key={`${question.id}-${index}`} className={className}>
                    {index + 1}
                  </span>
                )
              })}
            </div>

            {!isInterviewCompleted && currentQuestion ? (
              <>
                <h4 className="mock-question-title">{currentQuestion.title}</h4>
                <p className="page__description">{currentQuestion.prompt}</p>
                <div className="question-card__meta">
                  <span className="chip">{currentQuestion.category}</span>
                  <span className="chip chip--subtle">
                    {difficultyLabel(currentQuestion.difficulty)}
                  </span>
                  <span className="chip chip--subtle">
                    Ideal: {formatDuration(currentQuestion.idealSeconds || 0)}
                  </span>
                </div>

                <form className="answer-form" onSubmit={handleSubmitAnswer}>
                  <label className="form-field" htmlFor="mockInterviewAnswer">
                    Your answer
                    <textarea
                      id="mockInterviewAnswer"
                      value={answerText}
                      onChange={(event) => setAnswerText(event.target.value)}
                      rows={10}
                      placeholder="Answer like a real interview response with clear structure."
                      required
                    />
                  </label>

                  <div className="answer-form__actions">
                    <button
                      type="submit"
                      className="shell__button shell__button--primary"
                      disabled={isSubmitting || !answerText.trim()}
                    >
                      {isSubmitting ? 'Submitting...' : 'Submit Answer'}
                    </button>
                    <button
                      type="button"
                      className="shell__button"
                      onClick={() => speakQuestion(currentQuestion)}
                      disabled={!canUseSpeech}
                    >
                      <FiRepeat size={14} /> Ask Again
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <p className="card__label">Interview completed. Review your final report below.</p>
            )}
          </article>

          <aside className="mock-session-side">
            <article className="card card--elevated mock-progress-card">
              <p className="card__value">
                <FiTarget size={15} /> Progress
              </p>
              <div className="mock-progress-track" aria-hidden="true">
                <span className="mock-progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>
              <p className="card__label">
                {answeredCount}/{totalQuestions} answered | {progressPercent}% complete
              </p>
              <p className="card__label">
                Alignment: {generationMeta?.includesResume ? 'JD + CV' : 'JD only'}
              </p>
            </article>

            {latestAttempt ? (
              <article className="card card--elevated mock-feedback-card">
                <p className="card__value">
                  <FiTrendingUp size={15} /> Latest Feedback
                </p>
                <p className="card__label">Score: {latestAttempt.score}/100</p>
                <p className="card__label">{latestAttempt.feedback}</p>
                <div className="question-card__meta">
                  <span className="chip chip--subtle">
                    Keywords {latestAttempt.keywordHits}/{latestAttempt.keywordTarget}
                  </span>
                  <span className="chip chip--subtle">
                    Time {formatDuration(latestAttempt.timeSpentSeconds)}
                  </span>
                </div>
              </article>
            ) : null}
          </aside>
        </div>
      ) : null}

      {isInterviewCompleted && report ? (
        <section className="mock-report-shell">
          <article className="card card--elevated mock-report-top">
            <div className="mock-report-top__head">
              <div>
                <p className="shell__eyebrow">Final Report</p>
                <h3 className="page__title">Interview performance summary</h3>
                <p className="card__label">
                  Suggestions are generated from your scored responses and pacing behavior.
                </p>
              </div>
              <button
                type="button"
                className="shell__button shell__button--primary"
                onClick={restartInterview}
              >
                Restart Interview
              </button>
            </div>

            <div className="mock-report-kpis">
              <article className="mock-kpi">
                <p>Overall Score</p>
                <strong>{report.overallScore}</strong>
              </article>
              <article className="mock-kpi">
                <p>Coverage</p>
                <strong>{report.averageCoverage}%</strong>
              </article>
              <article className="mock-kpi">
                <p>Avg Time</p>
                <strong>{formatDurationCompact(report.averageTimeSeconds)}</strong>
              </article>
              <article className="mock-kpi">
                <p>Mode</p>
                <strong>{report.alignmentMode}</strong>
              </article>
            </div>
          </article>

          <div className="mock-report-columns">
            <article className="card card--elevated">
              <p className="card__value">Strengths</p>
              {report.strengths.length === 0 ? (
                <p className="card__label">No strengths detected yet.</p>
              ) : (
                <ul className="mock-report-list">
                  {report.strengths.map((item) => (
                    <li key={`strength-${item.questionId}`}>
                      {item.title} (Score {item.score})
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="card card--elevated">
              <p className="card__value">Weak Areas</p>
              {report.weaknesses.length === 0 ? (
                <p className="card__label">No major weak areas detected.</p>
              ) : (
                <ul className="mock-report-list">
                  {report.weaknesses.map((item) => (
                    <li key={`weak-${item.questionId}`}>
                      {item.title} (Score {item.score})
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>

          <article className="card card--elevated">
            <p className="card__value">Suggestions</p>
            <ul className="mock-report-list">
              {report.suggestions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>

          <article className="card card--elevated">
            <p className="card__value">Question Breakdown</p>
            <div className="attempt-list">
              {attemptResults.map((item, index) => (
                <article key={`${item.questionId}-${index}`} className="attempt-list__item">
                  <div>
                    <p className="card__value">
                      Q{index + 1}: {item.title}
                    </p>
                    <p className="card__label">
                      {difficultyLabel(item.difficulty)} | Score {item.score} | Time{' '}
                      {formatDurationCompact(item.timeSpentSeconds)}
                    </p>
                    <p className="card__label">{item.feedback}</p>
                  </div>
                  <span className="badge">{item.score >= 70 ? 'Strong' : 'Needs work'}</span>
                </article>
              ))}
            </div>
          </article>
        </section>
      ) : null}
    </section>
  )
}

export default MockInterviewPage

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import useAuth from '../auth/useAuth'
import NebulaLoader from '../components/NebulaLoader'
import { createPracticeSession, fetchQuestions, generateQuestions } from '../lib/api'
import { readAppSettings } from '../lib/userPreferences'

const difficultyOrder = ['all', 'easy', 'medium', 'hard']

function difficultyLabel(value) {
  if (!value) {
    return 'Unknown'
  }

  return value.charAt(0).toUpperCase() + value.slice(1)
}

function readPracticeDefaults() {
  const settings = readAppSettings()
  return settings.practiceDefaults || {}
}

function PracticePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [filters, setFilters] = useState(() => {
    const defaults = readPracticeDefaults()
    return {
      category: defaults.category || 'all',
      difficulty: defaults.difficulty || 'all',
      search: '',
    }
  })
  const [sessionTitle, setSessionTitle] = useState('')
  const [questionCount, setQuestionCount] = useState(() => {
    const defaults = readPracticeDefaults()
    return Number(defaults.sessionQuestionCount) || 5
  })
  const [generateCount, setGenerateCount] = useState(() => {
    const defaults = readPracticeDefaults()
    return Number(defaults.generateCount) || 6
  })
  const [questions, setQuestions] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [builderError, setBuilderError] = useState('')
  const [generationMessage, setGenerationMessage] = useState('')
  const [generationError, setGenerationError] = useState('')
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false)
  const [isBuildingSession, setIsBuildingSession] = useState(false)
  const [availableCategories, setAvailableCategories] = useState([])
  const activeFilterCount =
    (filters.search.trim() ? 1 : 0) +
    (filters.category !== 'all' ? 1 : 0) +
    (filters.difficulty !== 'all' ? 1 : 0)

  useEffect(() => {
    let isCancelled = false
    const debounceId = setTimeout(async () => {
      setIsLoading(true)
      setErrorMessage('')

      try {
        const response = await fetchQuestions(filters)
        if (isCancelled) {
          return
        }

        setQuestions(response?.data || [])
        setAvailableCategories(response?.meta?.filters?.categories || [])
      } catch (error) {
        if (!isCancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Unable to load practice questions.',
          )
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }, 220)

    return () => {
      isCancelled = true
      clearTimeout(debounceId)
    }
  }, [filters])

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  function clearFilters() {
    const defaults = readPracticeDefaults()
    setFilters({
      category: defaults.category || 'all',
      difficulty: defaults.difficulty || 'all',
      search: '',
    })
  }

  async function handleBuildSession(event) {
    event.preventDefault()
    setBuilderError('')
    setGenerationMessage('')
    setIsBuildingSession(true)

    try {
      const response = await createPracticeSession({
        userId: user?.email,
        userName: user?.name,
        title: sessionTitle.trim() || undefined,
        questionCount,
        category: filters.category !== 'all' ? filters.category : null,
        difficulty: filters.difficulty !== 'all' ? filters.difficulty : null,
        search: filters.search.trim() || null,
      })

      const session = response?.data
      if (!session?.id) {
        throw new Error('Unable to create practice session.')
      }

      navigate(`/practice/sessions/${session.id}`)
    } catch (error) {
      setBuilderError(
        error instanceof Error
          ? error.message
          : 'Unable to generate practice session.',
      )
    } finally {
      setIsBuildingSession(false)
    }
  }

  function updateQuestionCount(rawValue) {
    const parsedValue = Number.parseInt(rawValue, 10)
    if (Number.isNaN(parsedValue)) {
      setQuestionCount(1)
      return
    }

    setQuestionCount(Math.min(20, Math.max(1, parsedValue)))
  }

  function updateGenerateCount(rawValue) {
    const parsedValue = Number.parseInt(rawValue, 10)
    if (Number.isNaN(parsedValue)) {
      setGenerateCount(1)
      return
    }

    setGenerateCount(Math.min(25, Math.max(1, parsedValue)))
  }

  async function handleGenerateQuestions(event) {
    event.preventDefault()
    setGenerationError('')
    setGenerationMessage('')
    setIsGeneratingQuestions(true)

    try {
      const generationResponse = await generateQuestions({
        userId: user?.email,
        userName: user?.name,
        count: generateCount,
        category: filters.category !== 'all' ? filters.category : null,
        difficulty: filters.difficulty !== 'all' ? filters.difficulty : null,
        topicHint: filters.search.trim() || null,
      })

      const generatedCount = generationResponse?.meta?.generatedCount || 0
      setGenerationMessage(
        `${generatedCount} new questions generated. Fresh variety added to your bank.`,
      )

      const refreshed = await fetchQuestions(filters)
      setQuestions(refreshed?.data || [])
      setAvailableCategories(refreshed?.meta?.filters?.categories || [])
    } catch (error) {
      setGenerationError(
        error instanceof Error
          ? error.message
          : 'Unable to generate more questions.',
      )
    } finally {
      setIsGeneratingQuestions(false)
    }
  }

  return (
    <section className="page page--experience page--practice">
      <div className="experience-hero experience-hero--practice">
        <div className="experience-hero__content">
          <p className="experience-hero__eyebrow">Precision Practice</p>
          <h2 className="experience-hero__title">Question Bank</h2>
          <p className="experience-hero__description">
            Slice questions by category and difficulty, then launch a timed simulation.
          </p>
          <div className="experience-hero__actions">
            <button
              type="button"
              className="shell__button shell__button--primary"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          </div>
        </div>
        <div className="experience-hero__snapshot">
          <article className="hero-pill">
            <p>Live Filters</p>
            <strong>{activeFilterCount}</strong>
          </article>
          <article className="hero-pill">
            <p>Questions Loaded</p>
            <strong>{questions.length}</strong>
          </article>
          <article className="hero-pill">
            <p>Categories</p>
            <strong>{availableCategories.length || '-'}</strong>
          </article>
        </div>
        <span className="experience-hero__flare experience-hero__flare--one" />
        <span className="experience-hero__flare experience-hero__flare--two" />
      </div>

      <article className="session-builder session-builder--animated">
        <div className="session-builder__header">
          <div>
            <p className="shell__eyebrow">Session Builder</p>
            <h3 className="card__value">Generate a focused question sequence</h3>
            <p className="card__label">
              Uses active filters and shuffles questions into a sequential run with timed
              responses.
            </p>
          </div>
          <div className="session-builder__meta">
            <article className="hero-pill">
              <p>Filtered Pool</p>
              <strong>{questions.length}</strong>
            </article>
            <article className="hero-pill">
              <p>Requested Count</p>
              <strong>{questionCount}</strong>
            </article>
            <article className="hero-pill">
              <p>Active Filters</p>
              <strong>{activeFilterCount}</strong>
            </article>
          </div>
        </div>

        <form className="session-builder__form" onSubmit={handleBuildSession}>
          <label className="form-field">
            Session title
            <input
              type="text"
              value={sessionTitle}
              onChange={(event) => setSessionTitle(event.target.value)}
              placeholder="Sprint: Backend + SQL"
              maxLength={80}
            />
          </label>

          <label className="form-field">
            Questions
            <input
              type="number"
              min={1}
              max={20}
              value={questionCount}
              onChange={(event) => updateQuestionCount(event.target.value)}
            />
          </label>

          <button
            type="submit"
            className="shell__button shell__button--primary"
            disabled={isBuildingSession || isLoading}
          >
            {isBuildingSession ? 'Generating session...' : 'Start sequential session'}
          </button>
        </form>

        <form className="question-generator" onSubmit={handleGenerateQuestions}>
          <label className="form-field">
            Generate
            <input
              type="number"
              min={1}
              max={25}
              value={generateCount}
              onChange={(event) => updateGenerateCount(event.target.value)}
            />
          </label>
          <p className="card__label question-generator__hint">
            Create unlimited new questions using template generation with optional LLM
            enhancement when configured.
          </p>
          <button
            type="submit"
            className="shell__button"
            disabled={isGeneratingQuestions}
          >
            {isGeneratingQuestions ? 'Generating...' : 'Generate more questions'}
          </button>
        </form>

        {builderError ? <p className="auth-error">{builderError}</p> : null}
        {generationError ? <p className="auth-error">{generationError}</p> : null}
        {generationMessage ? <p className="billing-message">{generationMessage}</p> : null}
      </article>

      <div className="filters filters--elevated">
        <label className="form-field">
          Search
          <input
            type="search"
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
            placeholder="Search by title, category, or prompt"
          />
        </label>

        <label className="form-field">
          Category
          <select
            value={filters.category}
            onChange={(event) => updateFilter('category', event.target.value)}
          >
            <option value="all">All categories</option>
            {availableCategories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          Difficulty
          <select
            value={filters.difficulty}
            onChange={(event) => updateFilter('difficulty', event.target.value)}
          >
            {difficultyOrder.map((level) => (
              <option key={level} value={level}>
                {level === 'all' ? 'All levels' : difficultyLabel(level)}
              </option>
            ))}
          </select>
        </label>

        <button type="button" className="shell__button" onClick={clearFilters}>
          Reset
        </button>
      </div>

      {isLoading ? <NebulaLoader label="Loading questions..." /> : null}
      {errorMessage ? <p className="auth-error">{errorMessage}</p> : null}

      {!isLoading && !errorMessage ? (
        <div className="question-grid question-grid--animated">
          {questions.length === 0 ? (
            <article className="card">
              <p className="card__value">No questions found</p>
              <p className="card__label">
                Adjust filters to broaden your search.
              </p>
            </article>
          ) : (
            questions.map((question, index) => (
              <article
                key={question.id}
                className="question-card question-card--interactive"
                style={{ '--stagger': `${index * 65}ms` }}
              >
                <div className="question-card__meta">
                  <span className="chip">{question.category}</span>
                  <span
                    className={`chip chip--subtle chip--difficulty chip--difficulty-${question.difficulty}`}
                  >
                    {difficultyLabel(question.difficulty)}
                  </span>
                  <span className="chip chip--subtle">
                    Ideal: {Math.ceil((question.idealSeconds || 0) / 60)} min
                  </span>
                </div>
                <h3 className="question-card__title">{question.title}</h3>
                <p className="question-card__prompt">{question.prompt}</p>
                <div className="question-card__cta">
                  <Link
                    className="shell__button shell__button--primary"
                    to={`/practice/questions/${question.id}`}
                  >
                    Start timed answer
                  </Link>
                </div>
              </article>
            ))
          )}
        </div>
      ) : null}
    </section>
  )
}

export default PracticePage

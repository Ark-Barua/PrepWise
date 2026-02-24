import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import useAuth from '../auth/useAuth'
import NebulaLoader from '../components/NebulaLoader'
import {
  createBillingCheckoutSession,
  createBillingPortalSession,
} from '../lib/api'

function formatCurrency(cents) {
  const value = Number(cents) || 0
  if (value <= 0) {
    return 'Free'
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}

function formatLimit(limitValue, unitLabel) {
  if (limitValue === null || limitValue === undefined) {
    return `Unlimited ${unitLabel}`
  }
  return `${limitValue} ${unitLabel}`
}

function toPercent(value) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return 0
  }
  return Math.max(0, Math.min(100, numericValue))
}

const LOCAL_PLANS = [
  {
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
  {
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
]

function buildLocalBillingSummary(user) {
  const normalizedPlanTier =
    String(user?.planTier || '').trim().toLowerCase() === 'pro' ? 'pro' : 'free'
  const activePlan = LOCAL_PLANS.find((plan) => plan.id === normalizedPlanTier) || LOCAL_PLANS[0]

  return {
    user: {
      id: user?.email || '',
      email: user?.email || '',
      name: user?.name || 'Learner',
      planTier: normalizedPlanTier,
      billingStatus:
        user?.billingStatus || (normalizedPlanTier === 'pro' ? 'active' : 'inactive'),
      billingPeriodEnd: null,
    },
    plan: activePlan,
    usage: {
      attemptsUsed: 0,
      practiceSessionsUsed: 0,
    },
    remaining: {
      attempts: activePlan.limits.attemptsPerMonth,
      practiceSessions: activePlan.limits.practiceSessionsPerMonth,
    },
    usagePercent: {
      attempts: 0,
      practiceSessions: 0,
    },
    plans: LOCAL_PLANS,
  }
}

function BillingPage() {
  const { user } = useAuth()
  const location = useLocation()
  const [summary, setSummary] = useState(() => buildLocalBillingSummary(user))
  const [plans, setPlans] = useState(LOCAL_PLANS)
  const [isLoading, setIsLoading] = useState(true)
  const [isPortalOpening, setIsPortalOpening] = useState(false)
  const [upgradingPlanTier, setUpgradingPlanTier] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [stripeConfigured] = useState(false)

  useEffect(() => {
    setSummary(buildLocalBillingSummary(user))
    setPlans(LOCAL_PLANS)
    setIsLoading(false)
  }, [user])

  useEffect(() => {
    const checkoutStatus = new URLSearchParams(location.search).get('checkout')
    if (checkoutStatus === 'success') {
      setActionMessage(
        'Checkout completed. Your subscription will update after Stripe webhook confirmation.',
      )
    } else if (checkoutStatus === 'cancel') {
      setActionMessage('Checkout was canceled. You can retry anytime.')
    } else {
      setActionMessage(
        'Local billing mode is active because the current API runtime does not expose billing endpoints.',
      )
    }
  }, [location.search])

  const currentPlanTier = summary?.user?.planTier || 'free'
  const usageItems = useMemo(
    () => [
      {
        id: 'attempts',
        label: 'Attempts this month',
        used: summary?.usage?.attemptsUsed || 0,
        limit: summary?.plan?.limits?.attemptsPerMonth ?? null,
        percent: summary?.usagePercent?.attempts ?? 0,
      },
      {
        id: 'sessions',
        label: 'Practice sessions this month',
        used: summary?.usage?.practiceSessionsUsed || 0,
        limit: summary?.plan?.limits?.practiceSessionsPerMonth ?? null,
        percent: summary?.usagePercent?.practiceSessions ?? 0,
      },
    ],
    [summary],
  )

  async function handleUpgrade(planTier) {
    setErrorMessage('')
    setActionMessage('')
    setUpgradingPlanTier(planTier)

    try {
      const response = await createBillingCheckoutSession({
        userId: user.email,
        planTier,
      })
      const checkoutUrl = response?.data?.url
      if (!checkoutUrl) {
        throw new Error('Checkout URL was not returned by the server.')
      }

      window.location.assign(checkoutUrl)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to start checkout.',
      )
      setUpgradingPlanTier('')
    }
  }

  async function handleOpenPortal() {
    setErrorMessage('')
    setActionMessage('')
    setIsPortalOpening(true)

    try {
      const response = await createBillingPortalSession({
        userId: user.email,
      })
      const portalUrl = response?.data?.url
      if (!portalUrl) {
        throw new Error('Billing portal URL was not returned by the server.')
      }

      window.location.assign(portalUrl)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to open billing portal.',
      )
    } finally {
      setIsPortalOpening(false)
    }
  }

  return (
    <section className="page page--experience page--billing">
      <div className="experience-hero experience-hero--billing">
        <div className="experience-hero__content">
          <p className="experience-hero__eyebrow">Billing & Subscription</p>
          <h2 className="experience-hero__title">Plans and Quotas</h2>
          <p className="experience-hero__description">
            Monitor monthly usage, upgrade your plan, and manage subscription billing.
          </p>
          <div className="experience-hero__actions">
            <button
              type="button"
              className="shell__button shell__button--primary"
              onClick={handleOpenPortal}
              disabled={isPortalOpening || !stripeConfigured}
            >
              {isPortalOpening ? 'Opening portal...' : 'Manage billing'}
            </button>
            <Link className="shell__button" to="/practice">
              Continue practice
            </Link>
          </div>
        </div>
        <div className="experience-hero__snapshot">
          <article className="hero-pill">
            <p>Current Plan</p>
            <strong>{summary?.plan?.name || currentPlanTier}</strong>
          </article>
          <article className="hero-pill">
            <p>Billing Status</p>
            <strong>{summary?.user?.billingStatus || 'inactive'}</strong>
          </article>
          <article className="hero-pill">
            <p>Stripe</p>
            <strong>{stripeConfigured ? 'Configured' : 'Not configured'}</strong>
          </article>
        </div>
        <span className="experience-hero__flare experience-hero__flare--one" />
        <span className="experience-hero__flare experience-hero__flare--two" />
      </div>

      {isLoading ? <NebulaLoader label="Loading billing data..." /> : null}
      {actionMessage ? <p className="billing-message">{actionMessage}</p> : null}
      {errorMessage ? <p className="auth-error">{errorMessage}</p> : null}

      {!isLoading && !errorMessage ? (
        <>
          <div className="billing-usage-grid">
            {usageItems.map((item) => (
              <article key={item.id} className="card card--elevated">
                <p className="card__label">{item.label}</p>
                <p className="card__value">
                  {item.used} / {item.limit ?? 'unlimited'}
                </p>
                <div className="quota-meter" aria-hidden="true">
                  <span
                    className="quota-meter__fill"
                    style={{ width: `${toPercent(item.percent)}%` }}
                  />
                </div>
                <p className="card__label">
                  Remaining: {item.limit === null ? 'Unlimited' : Math.max(0, item.limit - item.used)}
                </p>
              </article>
            ))}

            <article className="card card--elevated">
              <p className="card__label">Per-session limit</p>
              <p className="card__value">
                {formatLimit(summary?.plan?.limits?.maxQuestionsPerSession ?? null, 'questions')}
              </p>
              <p className="card__label">
                Larger sessions are available on higher plans.
              </p>
            </article>
          </div>

          <div className="plan-grid plan-grid--animated">
            {(plans.length > 0 ? plans : summary?.plans || []).map((plan, index) => {
              const isCurrent = currentPlanTier === plan.id
              const isPaidPlan = Number(plan.monthlyPriceCents) > 0
              return (
                <article
                  key={plan.id}
                  className={
                    isCurrent
                      ? 'plan-card plan-card--current'
                      : 'plan-card'
                  }
                  style={{ '--stagger': `${index * 80}ms` }}
                >
                  <p className="shell__eyebrow">{plan.name}</p>
                  <h3 className="plan-card__price">
                    {formatCurrency(plan.monthlyPriceCents)}
                    {isPaidPlan ? '/month' : ''}
                  </h3>
                  <p className="card__label">{plan.description}</p>
                  <ul className="plan-card__features">
                    <li>
                      {formatLimit(plan.limits?.attemptsPerMonth ?? null, 'attempts/month')}
                    </li>
                    <li>
                      {formatLimit(
                        plan.limits?.practiceSessionsPerMonth ?? null,
                        'sessions/month',
                      )}
                    </li>
                    <li>
                      {formatLimit(
                        plan.limits?.maxQuestionsPerSession ?? null,
                        'questions/session',
                      )}
                    </li>
                  </ul>
                  {isCurrent ? (
                    <span className="badge">Current plan</span>
                  ) : (
                    <button
                      type="button"
                      className="shell__button shell__button--primary"
                      disabled={
                        !isPaidPlan ||
                        !stripeConfigured ||
                        upgradingPlanTier === plan.id
                      }
                      onClick={() => handleUpgrade(plan.id)}
                    >
                      {upgradingPlanTier === plan.id
                        ? 'Redirecting...'
                        : `Upgrade to ${plan.name}`}
                    </button>
                  )}
                </article>
              )
            })}
          </div>

          {!stripeConfigured ? (
            <p className="card__label">
              Stripe is not configured yet. Add Stripe environment variables in the API
              server to activate checkout and portal actions.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

export default BillingPage

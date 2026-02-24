import { Link } from 'react-router-dom'

function NotFoundPage() {
  return (
    <section className="page">
      <h2 className="page__title">Page not found</h2>
      <p className="page__description">
        The route you requested does not exist in this shell yet.
      </p>
      <Link to="/" className="shell__link shell__link--active">
        Back to overview
      </Link>
    </section>
  )
}

export default NotFoundPage

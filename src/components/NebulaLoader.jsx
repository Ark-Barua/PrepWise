function NebulaLoader({ label = 'Loading...' }) {
  return (
    <div className="nebula-loader" role="status" aria-live="polite">
      <span className="nebula-loader__spinner" aria-hidden="true">
        <span className="nebula-loader__ring nebula-loader__ring--outer" />
        <span className="nebula-loader__ring nebula-loader__ring--inner" />
        <span className="nebula-loader__core" />
      </span>
      <p className="nebula-loader__label">{label}</p>
    </div>
  )
}

export default NebulaLoader

export default function SettingSection ({
  title,
  description,
  children,
  className = ''
}) {
  return (
    <section className={`sp-card sp-setting-section ${className}`.trim()}>
      <header className='sp-setting-section-header'>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      <div className='sp-setting-section-body'>
        {children}
      </div>
    </section>
  )
}

import styles from './FatalScreen.module.css'

export function FatalScreen({
  title,
  detail,
}: {
  title: string
  detail: string
}) {
  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.eyebrow}>Ice failed to start</div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.detail}>{detail}</p>
        <p className={styles.hint}>
          Logs are being written under <code>~/.ice/diagnostics</code>.
        </p>
      </div>
    </div>
  )
}

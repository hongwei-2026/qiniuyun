import { COMMAND_MANUAL_INTRO, COMMAND_MANUAL_SECTIONS, COMMAND_MANUAL_VOICE_TRIGGERS } from '../data/commandManual'
import { useAppStore } from '../stores/appStore'

export function CommandManual() {
  const open = useAppStore((s) => s.commandManualOpen)
  const setOpen = useAppStore((s) => s.setCommandManualOpen)

  if (!open) return null

  return (
    <div className="manual-overlay" role="dialog" aria-modal="true" aria-label="指令手册">
      <div className="manual-panel card">
        <header className="manual-head">
          <div>
            <h2>指令手册</h2>
            <p className="manual-intro">{COMMAND_MANUAL_INTRO}</p>
          </div>
          <button type="button" className="manual-close" onClick={() => setOpen(false)}>
            关闭
          </button>
        </header>
        <div className="manual-body">
          {COMMAND_MANUAL_SECTIONS.map((section) => (
            <section key={section.title} className="manual-section">
              <h3>{section.title}</h3>
              <ul>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <footer className="manual-foot">
          说「{COMMAND_MANUAL_VOICE_TRIGGERS.join('」「')}」可随时再次打开；说「关闭指令手册」退出
        </footer>
      </div>
    </div>
  )
}

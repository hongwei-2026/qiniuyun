import { MicIcon } from './Icons'
import { COMMAND_MANUAL_VOICE_TRIGGERS } from '../data/commandManual'
import { useAppStore } from '../stores/appStore'

const STATUS_LABEL: Record<string, string> = {
  idle: '待命',
  awaiting_activation: '初始化',
  listening: '聆听中',
  transcribing: '转写中',
  optimizing: 'AI 理解中',
  executing: '执行中',
  speaking: '播报中',
}

const MODE_LABELS = {
  auto: 'Auto',
  'v4-pro': 'V4 Pro',
  flash: 'Flash',
  chat: 'Chat',
} as const

export function VoicePanel() {
  const voiceMode = useAppStore((s) => s.voiceMode)
  const voiceStatus = useAppStore((s) => s.voiceStatus)
  const transcript = useAppStore((s) => s.transcript)
  const lastReply = useAppStore((s) => s.lastReply)
  const deepseekMode = useAppStore((s) => s.deepseekMode)
  const imageProvider = useAppStore((s) => s.imageProvider)
  const asrProvider = useAppStore((s) => s.asrProvider)
  const canvasMode = useAppStore((s) => s.canvasMode)
  const aiGenerating = useAppStore((s) => s.aiGenerating)
  const aiGeneratingMessage = useAppStore((s) => s.aiGeneratingMessage)

  const canvasLabels = { free: '自由画布', ai: 'AI创作', grid: '九宫格', '3d': '3D创作', assets: '资产管理', comic: '漫画创作' }

  const restartListening = () => {
    document.dispatchEvent(new Event('voicecanvas:restart-listening'))
  }

  const switchAsr = (provider: 'browser' | 'xfyun') => {
    document.dispatchEvent(new CustomEvent('voicecanvas:asr-switch', { detail: { provider } }))
  }

  const openManual = () => {
    useAppStore.getState().setCommandManualOpen(true)
  }

  return (
    <aside className="panel card card-voice voice-only">
      <div className="panel-head">
        <h2>语音控制</h2>
        <span className="pill pill-sm">
          {aiGenerating ? 'AI 生图中' : (STATUS_LABEL[voiceStatus] ?? voiceStatus)}
        </span>
      </div>

      <div
        className={`mic-indicator ${voiceStatus === 'listening' || voiceStatus === 'awaiting_activation' ? 'active' : ''}`}
        role="button"
        tabIndex={0}
        onClick={restartListening}
        onKeyDown={(e) => { if (e.key === 'Enter') restartListening() }}
        title="点击重新启动语音识别"
      >
        <div className="mic-ring">
          <MicIcon className="mic-svg" />
        </div>
        <p className="mic-label">
          {voiceStatus === 'awaiting_activation'
            ? '语音初始化中，请说开始聆听'
            : voiceStatus === 'listening'
            ? asrProvider === 'xfyun'
              ? '讯飞录音转写中，请清晰说话'
              : '正在聆听，请说话'
            : voiceStatus === 'executing' && aiGenerating
              ? aiGeneratingMessage || 'AI 图片生成中…'
              : voiceStatus === 'executing'
                ? '正在执行指令…'
                : voiceStatus === 'speaking'
              ? '正在播报，请稍候…'
              : voiceStatus === 'transcribing'
                ? '讯飞转写中…'
                : voiceStatus === 'idle'
                  ? '待命，请说话'
                  : '等待语音指令'}
        </p>
      </div>

      <div className="manual-callout" role="note">
        <strong>不知道说什么？</strong>
        <p>直接说「<em>指令手册</em>」或「<em>查看指令</em>」打开完整指令列表</p>
        <button type="button" className="manual-open-btn" onClick={openManual}>
          打开指令手册
        </button>
      </div>

      <div className="voice-asr-btns">
        <button
          type="button"
          className={asrProvider === 'xfyun' ? 'asr-btn active' : 'asr-btn'}
          onClick={() => switchAsr('xfyun')}
        >
          讯飞识别
        </button>
        <button
          type="button"
          className={asrProvider === 'browser' ? 'asr-btn active' : 'asr-btn'}
          onClick={() => switchAsr('browser')}
        >
          浏览器识别
        </button>
        <button type="button" className="asr-btn" onClick={restartListening}>
          重新聆听
        </button>
      </div>
      <p className="voice-asr-hint">
        {voiceMode === 'continuous' && asrProvider === 'browser'
          ? '浏览器识别会周期性断开，系统会自动重连；失效请点「重新聆听」或换讯飞'
          : voiceMode === 'continuous'
            ? '连续模式：一口气说完约 1～2 秒即执行；句中停顿会自动延长等待'
            : '若无识别结果，请先点「重新聆听」或点一下麦克风区域'}
      </p>

      <section className="panel-section">
        <h3 className="section-title">当前配置</h3>
        <dl className="config-dl">
          <dt>画布</dt><dd>{canvasLabels[canvasMode]}</dd>
          <dt>绘图</dt><dd>{canvasMode === 'grid' ? `九宫格 AI · ${imageProvider === 'minimax' ? 'MiniMax' : '豆包'}` : canvasMode === 'comic' ? `漫画 AI · ${imageProvider === 'minimax' ? 'MiniMax' : '豆包'}` : canvasMode === 'ai' ? `AI · ${imageProvider === 'minimax' ? 'MiniMax' : '豆包'}` : '矢量（默认）'}</dd>
          <dt>采集</dt><dd>{voiceMode === 'continuous' ? '连续断句' : '单次说话'}</dd>
          <dt>LLM</dt><dd>{MODE_LABELS[deepseekMode]}</dd>
          <dt>识别</dt><dd>{asrProvider === 'xfyun' ? '讯飞极速转写' : '浏览器实时识别'}</dd>
        </dl>
      </section>

      <section className="panel-section">
        <h3 className="section-title">识别文本</h3>
        <div className="text-box mono">{transcript || '—'}</div>
      </section>

      <section className="panel-section">
        <h3 className="section-title">语音反馈</h3>
        <div className="text-box text-box-accent mono">
          {lastReply || (voiceStatus === 'awaiting_activation'
            ? '语音系统初始化中，请说开始聆听'
            : '启动后自动聆听；可说「指令手册」查看全部指令')}
        </div>
      </section>

      <section className="panel-section hints">
        <h3 className="section-title">指令速查</h3>
        <p className="hints-manual-tip">
          完整列表：说「{COMMAND_MANUAL_VOICE_TRIGGERS.slice(0, 3).join('」「')}」等
        </p>
        <ul className="hint-list">
          <li><span className="hint-tag">册</span>指令手册 / 查看指令 / 帮助</li>
          <li><span className="hint-tag">绘</span>画红色圆形 / 画星形 / 画波浪线（矢量）</li>
          <li><span className="hint-tag">漫</span>切换到漫画创作 → 生成第一集漫画 / 画角色立绘</li>
          <li><span className="hint-tag">多</span>画圆然后画矩形然后保存 — 自动分步执行</li>
          <li><span className="hint-tag">识</span>切换讯飞识别 / 切换浏览器识别 / 重新聆听</li>
          <li><span className="hint-tag">AI</span>切换到 AI 创作 → 生成赛博朋克城市 / 保存图片</li>
        </ul>
      </section>
    </aside>
  )
}

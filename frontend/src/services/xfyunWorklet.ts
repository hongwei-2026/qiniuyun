const loadedWorkletContexts = new WeakSet<BaseAudioContext>()

/** public/xfyun-pcm-processor.js — 兼容 Vite base 路径 */
export function xfyunWorkletUrl(): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${base.replace(/\/?$/, '/')}xfyun-pcm-processor.js`
}

/** 每个 AudioContext 须单独 addModule，不可跨 context 复用 */
export async function loadXfyunPcmWorklet(context: AudioContext): Promise<void> {
  if (loadedWorkletContexts.has(context)) return
  await context.audioWorklet.addModule(xfyunWorkletUrl())
  loadedWorkletContexts.add(context)
}

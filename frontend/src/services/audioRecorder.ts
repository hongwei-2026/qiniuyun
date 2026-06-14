export class UtteranceRecorder {
  private mediaRecorder: MediaRecorder | null = null
  private chunks: Blob[] = []

  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.chunks = []
    this.mediaRecorder = new MediaRecorder(stream, { mimeType: this.pickMime() })
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.mediaRecorder.start()
  }

  async stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('录音未开始'))
        return
      }
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' })
        this.mediaRecorder?.stream.getTracks().forEach((t) => t.stop())
        this.mediaRecorder = null
        resolve(blob)
      }
      this.mediaRecorder.stop()
    })
  }

  private pickMime(): string {
    if (MediaRecorder.isTypeSupported('audio/wav')) return 'audio/wav'
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
    return 'audio/webm'
  }
}

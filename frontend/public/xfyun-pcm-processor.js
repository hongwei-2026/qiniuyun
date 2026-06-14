class XfyunPcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel && channel.length > 0) {
      // 合并 4 个 quantum（约 512 样本）再发送，减少消息频率
      if (!this._buf) this._buf = []
      this._buf.push(channel.slice(0))
      if (this._buf.length >= 4) {
        const total = this._buf.reduce((n, c) => n + c.length, 0)
        const merged = new Float32Array(total)
        let off = 0
        for (const c of this._buf) {
          merged.set(c, off)
          off += c.length
        }
        this.port.postMessage(merged)
        this._buf = []
      }
    }
    return true
  }
}

registerProcessor('xfyun-pcm-processor', XfyunPcmProcessor)

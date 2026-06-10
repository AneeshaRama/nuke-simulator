// Synthesized nuclear blast audio via WebAudio — no sample files needed.
// Layers: sharp crack, deep boom sweep, sub-bass oscillator, long rumble tail.

let ctx = null

function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

function brownNoiseBuffer(ac, seconds) {
  const len = Math.floor(ac.sampleRate * seconds)
  const buf = ac.createBuffer(1, len, ac.sampleRate)
  const data = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1
    last = (last + 0.02 * white) / 1.02
    data[i] = last * 3.5
  }
  return buf
}

function whiteNoiseBuffer(ac, seconds) {
  const len = Math.floor(ac.sampleRate * seconds)
  const buf = ac.createBuffer(1, len, ac.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return buf
}

export function playExplosion(yieldKt = 100) {
  const ac = audioCtx()
  const t0 = ac.currentTime + 0.05
  // Bigger bombs: longer, deeper rumble.
  const scale = Math.min(2.5, 0.8 + Math.log10(Math.max(yieldKt, 0.01)) * 0.25)

  const master = ac.createDynamicsCompressor()
  master.threshold.value = -18
  master.ratio.value = 14
  const out = ac.createGain()
  out.gain.value = 0.9
  master.connect(out)
  out.connect(ac.destination)

  // 1. Initial crack — bright noise snap
  {
    const src = ac.createBufferSource()
    src.buffer = whiteNoiseBuffer(ac, 0.4)
    const bp = ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 3200
    bp.Q.value = 0.7
    const g = ac.createGain()
    g.gain.setValueAtTime(1.0, t0)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3)
    src.connect(bp).connect(g).connect(master)
    src.start(t0)
  }

  // 2. Main boom — brown noise through a falling lowpass
  {
    const src = ac.createBufferSource()
    src.buffer = brownNoiseBuffer(ac, 8 * scale)
    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(500, t0)
    lp.frequency.exponentialRampToValueAtTime(45, t0 + 4 * scale)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(1.4, t0 + 0.08)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 7 * scale)
    src.connect(lp).connect(g).connect(master)
    src.start(t0)
  }

  // 3. Sub-bass sweep — the gut punch
  {
    const osc = ac.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(70, t0)
    osc.frequency.exponentialRampToValueAtTime(24, t0 + 3.5 * scale)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.9, t0 + 0.1)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 5 * scale)
    osc.connect(g).connect(master)
    osc.start(t0)
    osc.stop(t0 + 5 * scale + 0.1)
  }

  // 4. Long rolling rumble tail with slow amplitude wobble
  {
    const src = ac.createBufferSource()
    src.buffer = brownNoiseBuffer(ac, 14 * scale)
    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 110
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t0 + 0.5)
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 2)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 13 * scale)
    const lfo = ac.createOscillator()
    lfo.frequency.value = 0.7
    const lfoGain = ac.createGain()
    lfoGain.gain.value = 0.18
    lfo.connect(lfoGain).connect(g.gain)
    src.connect(lp).connect(g).connect(master)
    src.start(t0 + 0.5)
    lfo.start(t0 + 0.5)
    lfo.stop(t0 + 14 * scale)
  }
}

// Call once on first user gesture so the context is unlocked before detonation.
export function unlockAudio() {
  audioCtx()
}

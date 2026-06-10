// Three.js mushroom cloud rendered on a transparent canvas above the map.
// Sprites are positioned in screen space each frame: the ground-zero pixel
// comes from map.project(), and meter offsets are converted with the map's
// current meters-per-pixel, so the cloud stays glued to the terrain and is
// drawn at true physical scale (a 1 Mt cloud really towers ~23 km).

import * as THREE from 'three'
import { cloudDims } from './physics'

function softPuffTexture(size = 128) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(c)
  return tex
}

const COL_FIRE_A = new THREE.Color('#fff8e0')
const COL_FIRE_B = new THREE.Color('#ff9b3d')
const COL_FIRE_C = new THREE.Color('#c2451c')
const COL_SMOKE_LIGHT = new THREE.Color('#b0a89e')
const COL_SMOKE_MID = new THREE.Color('#84796d')
const COL_SMOKE_DARK = new THREE.Color('#4f4840')
const COL_DUST = new THREE.Color('#9c8468')

function rand(a, b) {
  return a + Math.random() * (b - a)
}

export class CloudOverlay {
  constructor(map, container) {
    this.map = map
    this.canvas = document.createElement('canvas')
    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: 5,
    })
    this._w = 0
    this._h = 0
    container.appendChild(this.canvas)
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.scene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(0, 1, 0, 1, -2000, 2000)
    this.tex = softPuffTexture()
    this.active = false
    this.puffs = []
    this._raf = null
    this._tmpColor = new THREE.Color()
    if (import.meta.env?.DEV) window.__cloud = this
  }

  detonate(lngLat, yieldKt) {
    this.clear()
    this.lngLat = lngLat
    const dims = cloudDims(yieldKt)
    this.H = dims.top
    this.capR = dims.capRadius
    this.colR = dims.columnRadius
    this.fireR = 90 * Math.pow(yieldKt, 0.4)
    // Bigger yields burn visibly longer — stretches all fire-phase timelines
    this.fireT = Math.min(2.2, Math.max(1, 0.75 + 0.35 * Math.log10(yieldKt)))
    this.t0 = performance.now()
    this.active = true

    const add = (p) => {
      const mat = new THREE.SpriteMaterial({
        map: this.tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: p.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        opacity: 0,
      })
      const sprite = new THREE.Sprite(mat)
      sprite.renderOrder = p.order ?? 0
      this.scene.add(sprite)
      this.puffs.push({ ...p, sprite, mat })
    }

    // Fireball core — additive glow, violent flicker
    for (let i = 0; i < 36; i++) {
      add({
        kind: 'fire',
        additive: true,
        order: 10,
        ang: rand(0, Math.PI * 2),
        r: rand(0, 0.6),
        seed: Math.random(),
      })
    }
    // Flame tongues licking out of the fireball
    for (let i = 0; i < 30; i++) {
      add({
        kind: 'flame',
        additive: true,
        order: 11,
        dir: rand(-1.25, 1.25), // radians from vertical
        speed: rand(0.6, 1.5),
        seed: Math.random(),
      })
    }
    // Ballistic sparks / embers
    for (let i = 0; i < 50; i++) {
      add({
        kind: 'spark',
        additive: true,
        order: 12,
        dir2: rand(-1.35, 1.35),
        v: this.fireR * rand(1.0, 2.8),
        grav: this.fireR * rand(0.35, 0.6),
        life: rand(2, 4.5) * this.fireT,
        delay: rand(0, 0.6),
        seed: Math.random(),
      })
    }
    // Burning core inside the lower column stem
    for (let i = 0; i < 25; i++) {
      add({
        kind: 'colfire',
        additive: true,
        order: 5,
        hf: rand(0.05, 0.6),
        ang: rand(0, Math.PI * 2),
        seed: Math.random(),
      })
    }
    // Pulsing ground-fire glow
    for (let i = 0; i < 2; i++) {
      add({ kind: 'glow', additive: true, order: 1, seed: Math.random() })
    }
    // Ground dust skirt
    for (let i = 0; i < 34; i++) {
      add({
        kind: 'dust',
        order: 2,
        ang: rand(0, Math.PI * 2),
        speed: rand(0.6, 1.3),
        seed: Math.random(),
      })
    }
    // Rising column
    for (let i = 0; i < 70; i++) {
      add({
        kind: 'column',
        order: 4,
        hf: Math.pow(Math.random(), 0.8) * 0.92,
        ang: rand(0, Math.PI * 2),
        rj: rand(0.3, 1.1),
        seed: Math.random(),
      })
    }
    // Mushroom cap — torus of rolling puffs
    for (let i = 0; i < 110; i++) {
      add({
        kind: 'cap',
        order: 6,
        theta: rand(0, Math.PI * 2),
        phi: rand(0, Math.PI * 2),
        roll: rand(0.25, 0.55),
        seed: Math.random(),
      })
    }
    // Glowing cap interior for the first seconds
    for (let i = 0; i < 14; i++) {
      add({
        kind: 'capfire',
        additive: true,
        order: 8,
        theta: rand(0, Math.PI * 2),
        seed: Math.random(),
      })
    }

    this._loop()
  }

  _metersPerPixel() {
    const p = this.map.project(this.lngLat)
    const p2 = this.map.unproject([p.x + 60, p.y])
    const R = 6371008.8
    const dLng = ((p2.lng - this.lngLat[0]) * Math.PI) / 180
    const lat = (this.lngLat[1] * Math.PI) / 180
    const d = Math.abs(dLng) * Math.cos(lat) * R
    return Math.max(d / 60, 0.01)
  }

  _loop = () => {
    if (!this.active) return
    this._raf = requestAnimationFrame(this._loop)

    const w = this.map.getContainer().clientWidth
    const h = this.map.getContainer().clientHeight
    if (this._w !== w || this._h !== h) {
      this.renderer.setSize(w, h, false)
      this._w = w
      this._h = h
    }
    // y-up camera; screen y is flipped when positioning sprites
    this.camera.left = 0
    this.camera.right = w
    this.camera.bottom = 0
    this.camera.top = h
    this.camera.updateProjectionMatrix()

    const t = (performance.now() - this.t0) / 1000
    const base = this.map.project(this.lngLat)
    const mpp = this._metersPerPixel()

    // Cloud rise and cap growth
    const hNow = this.H * (1 - Math.exp(-t / 18))
    const capNow = this.capR * (0.22 + 0.78 * (1 - Math.exp(-t / 26)))
    const globalFade = t > 90 ? Math.max(0, 1 - (t - 90) / 60) : 1
    const ft = t / this.fireT // yield-scaled fire clock
    const tc = this._tmpColor

    for (const p of this.puffs) {
      const s = p.sprite
      let ox = 0, oy = 0, size = 1, op = 0

      if (p.kind === 'fire') {
        const grow = Math.min(1, t / 1.2)
        const pulse = 1 + 0.07 * Math.sin(t * 16 + p.seed * 37)
        const R = this.fireR * (0.4 + 0.6 * grow) * pulse
        ox = Math.cos(p.ang) * p.r * R
        oy = Math.sin(p.ang) * p.r * R * 0.85 + R * 0.3 + t * this.fireR * 0.28
        size = R * (1.0 + p.seed * 0.8)
        const k = Math.min(1, ft / 7)
        const inner = p.r < 0.25 // core stays white-hot longer
        tc.copy(COL_FIRE_A)
          .lerp(COL_FIRE_B, Math.min(1, k * (inner ? 1.0 : 1.8)))
          .lerp(COL_FIRE_C, Math.min(1, Math.max(0, k - (inner ? 0.65 : 0.4)) * 1.6))
        p.mat.color.copy(tc)
        const flick = 0.85 + 0.15 * Math.sin(t * 21 + p.seed * 50)
        if (t < 0.12) op = t / 0.12
        else if (ft < 6.5) op = flick
        else op = Math.max(0, 1 - (ft - 6.5) / 3) * flick * 0.8
      } else if (p.kind === 'flame') {
        const fadeOut = Math.min(1, Math.max(0, (10 - ft) / 3))
        if (fadeOut > 0) {
          const life = 0.85
          const ct = (t + p.seed * life * 3) % life
          const prog = ct / life
          const R0 = this.fireR * (0.5 + 0.5 * Math.min(1, t / 1.2))
          const dist = R0 * (0.6 + p.speed * prog * 1.6)
          ox = Math.sin(p.dir) * dist
          oy = Math.max(0, Math.cos(p.dir)) * dist + t * this.fireR * 0.25
          size = this.fireR * (0.55 - 0.3 * prog) * (0.7 + p.seed * 0.6)
          tc.copy(COL_FIRE_A).lerp(COL_FIRE_B, 0.3 + prog * 0.7)
          p.mat.color.copy(tc)
          op = (1 - prog) * 0.9 * Math.min(1, t / 0.3) * fadeOut
        }
      } else if (p.kind === 'spark') {
        const tt = t - p.delay
        if (tt > 0 && tt < p.life) {
          ox = Math.sin(p.dir2) * p.v * tt
          oy = Math.max(0, Math.cos(p.dir2) * p.v * tt - 0.5 * p.grav * tt * tt)
          size = this.fireR * 0.09 * (0.5 + p.seed)
          tc.copy(COL_FIRE_A).lerp(COL_FIRE_B, p.seed)
          p.mat.color.copy(tc)
          const flick = 0.6 + 0.4 * Math.sin(tt * 30 + p.seed * 80)
          op = Math.max(0, 1 - tt / p.life) * flick
        }
      } else if (p.kind === 'glow') {
        oy = this.fireR * 0.1
        size = this.fireR * (3.2 + 0.3 * Math.sin(t * 9 + p.seed * 10))
        tc.copy(COL_FIRE_B).lerp(COL_FIRE_C, 0.4)
        p.mat.color.copy(tc)
        op =
          Math.max(0, 1 - ft / 16) *
          0.45 *
          Math.min(1, t / 0.2) *
          (0.8 + 0.2 * Math.sin(t * 13 + p.seed * 9))
      } else if (p.kind === 'colfire') {
        oy = p.hf * hNow * 0.97
        ox = Math.cos(p.ang) * this.colR * 0.45 + Math.sin(t * 0.7 + p.seed * 8) * this.colR * 0.15
        size = this.colR * (0.9 + p.seed * 0.7)
        tc.copy(COL_FIRE_B).lerp(COL_FIRE_C, p.hf * 0.9)
        p.mat.color.copy(tc)
        const appear = Math.min(1, Math.max(0, (t - 1) / 1.5))
        const flick = 0.7 + 0.3 * Math.sin(t * 17 + p.seed * 70)
        op = Math.max(0, 1 - ft / 12) * (1 - p.hf * 0.8) * 0.5 * appear * flick
      } else if (p.kind === 'dust') {
        const d = Math.min(1, t / 9)
        const R = this.fireR * 2.6 * d * p.speed
        ox = Math.cos(p.ang) * R
        oy = Math.abs(Math.sin(p.seed * 7)) * this.fireR * 0.35 * d
        size = this.fireR * (0.7 + d * 1.1) * (0.7 + p.seed * 0.6)
        p.mat.color.copy(COL_DUST)
        op = Math.max(0, 0.55 * (1 - d * 0.75)) * (t < 0.5 ? t / 0.5 : 1)
      } else if (p.kind === 'column') {
        const y = p.hf * hNow * 0.97
        const wob = Math.sin(t * 0.5 + p.seed * 9) * this.colR * 0.25
        ox = Math.cos(p.ang) * this.colR * p.rj + wob
        oy = y
        size = this.colR * (1.1 + p.hf * 0.9 + p.seed * 0.5)
        const heat = Math.max(0, 1 - ft / 14) * Math.max(0, 1 - p.hf * 1.4)
        tc.copy(COL_SMOKE_MID).lerp(COL_SMOKE_DARK, p.seed * 0.6).lerp(COL_FIRE_B, heat)
        p.mat.color.copy(tc)
        const appear = Math.min(1, Math.max(0, (t - 0.8) / 2))
        op = 0.62 * appear
      } else if (p.kind === 'cap') {
        const mr = this.capR * 0.4
        const phi = p.phi + t * p.roll
        const rr = capNow + mr * Math.cos(phi) * 0.8
        ox = Math.cos(p.theta) * rr
        oy = hNow + mr * Math.sin(phi) * 0.7 + Math.sin(p.theta * 2) * mr * 0.15
        size = mr * (1.0 + p.seed * 0.8)
        const depth = (Math.sin(p.theta) + 1) / 2
        tc.copy(COL_SMOKE_LIGHT).lerp(COL_SMOKE_DARK, 0.25 + depth * 0.45)
        const heat = Math.max(0, 1 - t / 9)
        tc.lerp(COL_FIRE_C, heat * 0.35 * (1 - depth))
        p.mat.color.copy(tc)
        const appear = Math.min(1, Math.max(0, (t - 1.2) / 2.5))
        op = 0.7 * appear
      } else if (p.kind === 'capfire') {
        ox = Math.cos(p.theta) * capNow * 0.35
        oy = hNow + Math.sin(p.seed * 11) * capNow * 0.2
        size = capNow * (0.35 + p.seed * 0.35) // grows with the cap, not full-size at birth
        tc.copy(COL_FIRE_B).lerp(COL_FIRE_C, Math.min(1, t / 8) * 0.7 + p.seed * 0.2)
        p.mat.color.copy(tc)
        const appear = Math.min(1, Math.max(0, (t - 2.5) / 2.5))
        const flick = 0.8 + 0.2 * Math.sin(t * 14 + p.seed * 60)
        op = Math.max(0, 1 - ft / 16) * 0.55 * appear * flick
      }

      s.position.set(base.x + ox / mpp, h - base.y + oy / mpp, p.order)
      const px = Math.max(size / mpp, 0.5)
      s.scale.set(px, px, 1)
      p.mat.opacity = op * globalFade
    }

    this.renderer.render(this.scene, this.camera)
  }

  clear() {
    if (this._raf) cancelAnimationFrame(this._raf)
    this.active = false
    for (const p of this.puffs) {
      this.scene.remove(p.sprite)
      p.mat.dispose()
    }
    this.puffs = []
    this.renderer.clear()
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.clear()
    this.tex.dispose()
    this.renderer.dispose()
    this.canvas.remove()
  }
}

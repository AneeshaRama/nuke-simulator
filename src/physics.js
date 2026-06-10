// Nuclear effects scaling laws (approximations after Glasstone & Dolan,
// "The Effects of Nuclear Weapons", 1977). W = yield in kilotons.
// Blast radii scale with the cube root of yield; thermal slightly faster;
// prompt radiation scales very weakly (it's absorbed by air).
// Radii returned in meters, for a near-surface burst.

export const EFFECT_DEFS = [
  {
    id: 'fireball',
    label: 'Fireball',
    color: '#fff3b0',
    stroke: '#ffd000',
    radiusM: (W) => 90 * Math.pow(W, 0.4),
    desc: 'Everything inside the fireball is vaporized.',
  },
  {
    id: 'blast20',
    label: 'Heavy blast — 20 psi',
    color: '#ff3b30',
    stroke: '#ff3b30',
    radiusM: (W) => 220 * Math.cbrt(W),
    desc: 'Reinforced concrete buildings demolished. Fatalities approach 100%.',
  },
  {
    id: 'rad500',
    label: 'Radiation — 500 rem',
    color: '#3dd13d',
    stroke: '#2eaf2e',
    radiusM: (W) => 1000 * Math.pow(W, 0.18),
    desc: 'Lethal dose of ionizing radiation without prompt medical care.',
  },
  {
    id: 'blast5',
    label: 'Moderate blast — 5 psi',
    color: '#ff9500',
    stroke: '#ff9500',
    radiusM: (W) => 600 * Math.cbrt(W),
    desc: 'Most residential buildings collapse. Widespread fatalities and injuries.',
  },
  {
    id: 'thermal',
    label: 'Thermal — 3rd-degree burns',
    color: '#ffcc00',
    stroke: '#e6b800',
    radiusM: (W) => 600 * Math.pow(W, 0.41),
    desc: 'Third-degree burns to exposed skin; mass fires ignite across this zone.',
  },
  {
    id: 'blast1',
    label: 'Light blast — 1 psi',
    color: '#5ac8fa',
    stroke: '#5ac8fa',
    radiusM: (W) => 1150 * Math.cbrt(W),
    desc: 'Windows shatter; injuries from flying glass and debris.',
  },
]

export function computeEffects(yieldKt) {
  return EFFECT_DEFS.map((e) => ({ ...e, radius: e.radiusM(yieldKt) }))
    .sort((a, b) => b.radius - a.radius)
}

export function maxRadius(yieldKt) {
  return Math.max(...computeEffects(yieldKt).map((e) => e.radius))
}

// Mushroom cloud dimensions (very approximate). Returns meters.
export function cloudDims(yieldKt) {
  const topM = 5000 * Math.pow(yieldKt, 0.22) // 15 kt ≈ 9 km, 1 Mt ≈ 23 km
  return {
    top: topM,
    capRadius: topM * 0.35,
    columnRadius: topM * 0.07,
  }
}

export const PRESETS = [
  { label: 'Davy Crockett — 0.02 kt', kt: 0.02 },
  { label: 'North Korea 2017 test — 250 kt', kt: 250 },
  { label: 'Hiroshima "Little Boy" — 15 kt', kt: 15 },
  { label: 'Nagasaki "Fat Man" — 21 kt', kt: 21 },
  { label: 'W76 warhead — 100 kt', kt: 100 },
  { label: 'W87 warhead — 300 kt', kt: 300 },
  { label: 'B83 bomb — 1.2 Mt', kt: 1200 },
  { label: 'Castle Bravo — 15 Mt', kt: 15000 },
  { label: 'Tsar Bomba — 50 Mt', kt: 50000 },
]

export function formatYield(kt) {
  if (kt >= 1000) return `${+(kt / 1000).toFixed(2)} Mt`
  if (kt >= 1) return `${+kt.toFixed(1)} kt`
  return `${+(kt * 1000).toFixed(0)} t`
}

export function formatKm(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`
  return `${Math.round(m)} m`
}

// Geodesic circle as a GeoJSON polygon ring.
export function geoCircle([lng, lat], radiusM, steps = 128) {
  const R = 6371008.8
  const latR = (lat * Math.PI) / 180
  const lngR = (lng * Math.PI) / 180
  const d = radiusM / R
  const ring = []
  for (let i = 0; i <= steps; i++) {
    const brg = (i / steps) * 2 * Math.PI
    const lat2 = Math.asin(
      Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d) * Math.cos(brg)
    )
    const lng2 =
      lngR +
      Math.atan2(
        Math.sin(brg) * Math.sin(d) * Math.cos(latR),
        Math.cos(d) - Math.sin(latR) * Math.sin(lat2)
      )
    ring.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI])
  }
  return ring
}

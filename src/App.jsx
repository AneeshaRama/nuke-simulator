import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  computeEffects,
  PRESETS,
  formatYield,
  formatKm,
  geoCircle,
} from './physics'
import { playExplosion, unlockAudio } from './sound'
import { CloudOverlay } from './cloud'

const MAP_STYLE = {
  version: 8,
  projection: { type: 'globe' },
  sources: {
    sat: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        'Imagery © Esri, Maxar, Earthstar Geographics | Labels © CARTO © OpenStreetMap',
    },
    labels: {
      type: 'raster',
      tiles: ['https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  sky: {
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 1, 8, 0],
  },
  layers: [
    { id: 'sat', type: 'raster', source: 'sat' },
    { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.9 } },
  ],
}

const SLIDER_MIN = -2 // 10^-2 kt = 10 t
const SLIDER_MAX = 5 // 10^5 kt = 100 Mt
const ktFromSlider = (v) => Math.pow(10, v)
const sliderFromKt = (kt) => Math.log10(kt)

function zoomForRadius(radiusM, lat, mapEl) {
  const px = Math.min(mapEl.clientWidth, mapEl.clientHeight) * 0.34
  const mpp = (radiusM * 1.15) / px
  const z = Math.log2((40075016.686 * Math.cos((lat * Math.PI) / 180)) / mpp) - 9
  return Math.min(Math.max(z, 3), 15.5)
}

export default function App() {
  const mapRef = useRef(null)
  const mapEl = useRef(null)
  const cloudRef = useRef(null)
  const markerRef = useRef(null)
  const animRef = useRef(null)

  const [target, setTarget] = useState(null) // [lng, lat]
  const [yieldKt, setYieldKt] = useState(15)
  const [preset, setPreset] = useState('Hiroshima "Little Boy" — 15 kt')
  const [phase, setPhase] = useState('idle') // idle | boom | done
  const [flash, setFlash] = useState(false)
  const [results, setResults] = useState(null)
  const phaseRef = useRef('idle')
  phaseRef.current = phase

  useEffect(() => {
    const map = new maplibregl.Map({
      container: mapEl.current,
      style: MAP_STYLE,
      center: [10, 25],
      zoom: 1.8,
      pitch: 0,
      maxPitch: 70,
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.getCanvas().style.cursor = 'crosshair'
    mapRef.current = map
    if (import.meta.env.DEV) window.__map = map
    cloudRef.current = new CloudOverlay(map, mapEl.current)

    map.on('click', (e) => {
      if (phaseRef.current === 'boom') return
      unlockAudio()
      const lngLat = [e.lngLat.lng, e.lngLat.lat]
      setTarget(lngLat)
      if (!markerRef.current) {
        const el = document.createElement('div')
        el.className = 'crosshair'
        el.innerHTML = '<div class="ring"></div><div class="dot"></div>'
        markerRef.current = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map)
      } else {
        markerRef.current.setLngLat(lngLat)
      }
    })

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
      cloudRef.current?.dispose()
      map.remove()
    }
  }, [])

  function clearEffectLayers() {
    const map = mapRef.current
    if (!map || !map.getStyle()) return
    for (const layer of map.getStyle().layers) {
      if (layer.id.startsWith('fx-') || layer.id.startsWith('shock')) {
        if (map.getLayer(layer.id)) map.removeLayer(layer.id)
      }
    }
    for (const sid of Object.keys(map.getStyle().sources)) {
      if (sid.startsWith('fx-') || sid.startsWith('shock')) {
        if (map.getSource(sid)) map.removeSource(sid)
      }
    }
  }

  function detonate() {
    const map = mapRef.current
    if (!map || !target || phase === 'boom') return
    const effects = computeEffects(yieldKt)
    const maxR = effects[0].radius
    setPhase('boom')
    setResults(null)
    clearEffectLayers()
    cloudRef.current.clear()

    const zoom = zoomForRadius(maxR, target[1], mapEl.current)
    map.flyTo({
      center: target,
      zoom,
      pitch: 55,
      bearing: (Math.random() - 0.5) * 60,
      duration: 2400,
      essential: true,
    })

    setTimeout(() => {
      // Flash + sound + cloud + camera shake
      setFlash(true)
      setTimeout(() => setFlash(false), 1600)
      playExplosion(yieldKt)
      cloudRef.current.detonate(target, yieldKt)
      mapEl.current.classList.add('shake')
      setTimeout(() => mapEl.current.classList.remove('shake'), 1400)

      // Expanding shockwave ring, revealing damage rings as it passes them
      map.addSource('shock', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [geoCircle(target, 1)] } },
      })
      map.addLayer({
        id: 'shock-line',
        type: 'line',
        source: 'shock',
        paint: { 'line-color': '#ffffff', 'line-width': 4, 'line-opacity': 0.95, 'line-blur': 2 },
      })

      const revealed = new Set()
      let prevFillId = null
      const T = 8
      const start = performance.now()

      const step = () => {
        const t = (performance.now() - start) / 1000
        const f = Math.min(1, Math.pow(Math.min(t / T, 1), 0.4))
        const R = Math.max(maxR * f, 1)
        map.getSource('shock')?.setData({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [geoCircle(target, R)] },
        })
        if (map.getLayer('shock-line')) {
          map.setPaintProperty('shock-line', 'line-opacity', Math.max(0.95 * (1 - f * 0.85), 0))
          map.setPaintProperty('shock-line', 'line-width', 4 + f * 6)
        }
        // effects is sorted largest-first; reveal smallest first as the wave passes
        for (let i = effects.length - 1; i >= 0; i--) {
          const e = effects[i]
          if (!revealed.has(e.id) && e.radius <= R) {
            revealed.add(e.id)
            map.addSource(`fx-${e.id}`, {
              type: 'geojson',
              data: {
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [geoCircle(target, e.radius)] },
              },
            })
            // Insert each (larger) ring beneath the previous (smaller) one
            map.addLayer(
              {
                id: `fx-${e.id}-fill`,
                type: 'fill',
                source: `fx-${e.id}`,
                paint: { 'fill-color': e.color, 'fill-opacity': 0.13 },
              },
              prevFillId ?? 'shock-line'
            )
            map.addLayer(
              {
                id: `fx-${e.id}-line`,
                type: 'line',
                source: `fx-${e.id}`,
                paint: { 'line-color': e.stroke, 'line-width': 1.6, 'line-opacity': 0.85 },
              },
              'shock-line'
            )
            prevFillId = `fx-${e.id}-fill`
          }
        }
        if (t < T + 0.5) {
          animRef.current = requestAnimationFrame(step)
        } else {
          if (map.getLayer('shock-line')) map.removeLayer('shock-line')
          if (map.getSource('shock')) map.removeSource('shock')
          setResults({ effects, yieldKt, target })
          setPhase('done')
        }
      }
      animRef.current = requestAnimationFrame(step)
    }, 2500)
  }

  function reset() {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    clearEffectLayers()
    cloudRef.current?.clear()
    setResults(null)
    setPhase('idle')
    mapRef.current?.flyTo({ pitch: 0, zoom: Math.min(mapRef.current.getZoom(), 9), duration: 1200 })
  }

  function onPreset(label) {
    setPreset(label)
    const p = PRESETS.find((p) => p.label === label)
    if (p) setYieldKt(p.kt)
  }

  return (
    <div className="app">
      <div ref={mapEl} className="map" />
      {flash && <div className="flash" />}

      <div className="panel">
        <h1>☢ NUCLEAR BLAST SIMULATOR</h1>
        <p className="sub">
          Spin the globe, zoom into a city, click to set ground zero, then detonate.
        </p>

        <label className="lbl">Warhead</label>
        <select value={preset} onChange={(e) => onPreset(e.target.value)}>
          {PRESETS.map((p) => (
            <option key={p.label} value={p.label}>{p.label}</option>
          ))}
          <option value="custom">Custom yield…</option>
        </select>

        <label className="lbl">
          Yield: <span className="yield">{formatYield(yieldKt)}</span>
        </label>
        <input
          type="range"
          min={SLIDER_MIN}
          max={SLIDER_MAX}
          step={0.01}
          value={sliderFromKt(yieldKt)}
          onChange={(e) => {
            setPreset('custom')
            setYieldKt(ktFromSlider(parseFloat(e.target.value)))
          }}
        />

        <div className="coords">
          {target
            ? `Ground zero: ${target[1].toFixed(4)}°, ${target[0].toFixed(4)}°`
            : 'Click anywhere on the map to set ground zero'}
        </div>

        <button
          className={`detonate ${target && phase !== 'boom' ? 'armed' : ''}`}
          disabled={!target || phase === 'boom'}
          onClick={detonate}
        >
          {phase === 'boom' ? 'DETONATING…' : 'DETONATE'}
        </button>
        {phase === 'done' && (
          <button className="reset" onClick={reset}>Reset</button>
        )}
        <p className="note">
          Educational approximation — cube-root scaling per Glasstone &amp; Dolan,
          <i> The Effects of Nuclear Weapons</i> (1977), surface burst.
        </p>
      </div>

      {results && (
        <div className="legend">
          <h2>{formatYield(results.yieldKt)} surface burst</h2>
          {results.effects.map((e) => (
            <div className="row" key={e.id}>
              <span className="chip" style={{ background: e.color }} />
              <div>
                <div className="rl">
                  {e.label} — <b>{formatKm(e.radius)}</b>
                  <span className="area">
                    {' '}({(Math.PI * (e.radius / 1000) ** 2).toFixed(1)} km²)
                  </span>
                </div>
                <div className="rd">{e.desc}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

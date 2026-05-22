'use client'

// This component is loaded with ssr:false, so browser-only imports are safe
import maplibregl from 'maplibre-gl'
import { useEffect, useRef, useCallback } from 'react'
import type { MapPin, MemberLocation } from '@/app/(app)/map/page'

/* ── Per-member color palette (same as chat/calendar) ─────── */
const MEMBER_PALETTES: { bg: string; border: string; fg: string }[] = [
  { bg: '#F3D9C7', border: '#C85A3C', fg: '#6B2A10' },
  { bg: '#C8D8E8', border: '#6B8FA4', fg: '#1A3A5C' },
  { bg: '#C8E0D0', border: '#4A6A52', fg: '#1A4A2C' },
  { bg: '#E8E0C0', border: '#D89020', fg: '#5A4410' },
  { bg: '#D8C8E0', border: '#7A4A5A', fg: '#4A1A5C' },
  { bg: '#F0C8C8', border: '#D86B75', fg: '#6B1A1A' },
  { bg: '#C8E4E4', border: '#4A8A8A', fg: '#1A5050' },
]
function memberColor(uid: string) {
  let h = 5381
  for (let i = 0; i < uid.length; i++) h = (((h << 5) + h) + uid.charCodeAt(i)) >>> 0
  return MEMBER_PALETTES[h % MEMBER_PALETTES.length]
}
function ageLabel(at: number): string {
  const diff = Date.now() - at
  if (diff < 90_000) return 'live'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `vor ${mins} Min.`
  return `vor ${Math.floor(mins / 60)} Std.`
}

/* ── Stars canvas ─────────────────────────────────────────── */
function initStars(canvas: HTMLCanvasElement) {
  const W = canvas.width  = canvas.offsetWidth  * (window.devicePixelRatio || 1)
  const H = canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1)
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, W, H)

  // Generate 320 stars with random sizes and brightnesses
  const stars: { x: number; y: number; r: number; a: number; da: number }[] = []
  for (let i = 0; i < 320; i++) {
    stars.push({
      x:  Math.random() * W,
      y:  Math.random() * H,
      r:  Math.random() * 1.4 + 0.2,
      a:  Math.random(),
      da: (Math.random() * 0.004 + 0.001) * (Math.random() < 0.5 ? 1 : -1),
    })
  }

  let raf: number
  function draw() {
    ctx.clearRect(0, 0, W, H)
    for (const s of stars) {
      s.a += s.da
      if (s.a > 1 || s.a < 0.15) s.da *= -1
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255,255,255,${s.a.toFixed(2)})`
      ctx.fill()
    }
    // Subtle nebula glow at corners
    const g1 = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.45)
    g1.addColorStop(0, 'rgba(30,20,80,0.18)')
    g1.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H)

    const g2 = ctx.createRadialGradient(W, H, 0, W, H, W * 0.5)
    g2.addColorStop(0, 'rgba(10,30,60,0.14)')
    g2.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H)

    raf = requestAnimationFrame(draw)
  }
  draw()
  return () => cancelAnimationFrame(raf)
}

interface Props {
  pins: MapPin[]
  userLocation: { lat: number; lng: number } | null
  memberLocations: MemberLocation[]
  onMapClick: (lat: number, lng: number) => void
  addingMode: boolean
  userId: string | null
  onPinClick: (pin: MapPin) => void
  flyTarget?: { lat: number; lng: number; zoom?: number } | null
}

export default function MapLibreMap({
  pins, userLocation, memberLocations, onMapClick, addingMode, userId, onPinClick, flyTarget,
}: Props) {
  const containerRef     = useRef<HTMLDivElement>(null)
  const starsRef         = useRef<HTMLCanvasElement>(null)
  const mapRef           = useRef<maplibregl.Map | null>(null)
  const pinMarkersRef    = useRef<maplibregl.Marker[]>([])
  const memberMarkersRef = useRef<maplibregl.Marker[]>([])
  const userMarkerRef    = useRef<maplibregl.Marker | null>(null)
  const hasFlewRef       = useRef(false)
  const addingRef        = useRef(addingMode)
  const onClickRef       = useRef(onMapClick)
  const onPinRef         = useRef(onPinClick)
  const memberLocsRef    = useRef(memberLocations)

  useEffect(() => { addingRef.current = addingMode }, [addingMode])
  useEffect(() => { onClickRef.current = onMapClick }, [onMapClick])
  useEffect(() => { onPinRef.current = onPinClick }, [onPinClick])
  useEffect(() => { memberLocsRef.current = memberLocations }, [memberLocations])

  useEffect(() => {
    if (!mapRef.current) return
    try { mapRef.current.getCanvas().style.cursor = addingMode ? 'crosshair' : '' } catch { /* noop */ }
  }, [addingMode])

  // ── Stars canvas ──────────────────────────────────────────
  useEffect(() => {
    if (!starsRef.current) return
    return initStars(starsRef.current)
  }, [])

  // ── Init map ──────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    let cancelled = false

    async function init() {
      // Fetch Carto style, inject globe + transparent background
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let style: any
      try {
        style = await fetch('https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json').then(r => r.json())
      } catch {
        style = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
      }
      if (cancelled) return

      if (typeof style === 'object') {
        // Globe projection
        style.projection = { type: 'globe' }
        // Make the space around the globe transparent so the starfield shows through
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bgIdx = (style.layers as any[]).findIndex((l: any) => l.type === 'background')
        if (bgIdx >= 0) {
          style.layers[bgIdx].paint = {
            ...style.layers[bgIdx].paint,
            'background-color': 'rgba(0,0,0,0)',
            'background-opacity': 0,
          }
        }
      }

      const map = new maplibregl.Map({
        container: el,
        style,
        center: [11, 48],
        zoom: 1.5,
        minZoom: 0,
        maxZoom: 22,
        attributionControl: false,
        // Alpha canvas so the starfield behind shows through the globe's "space" area
        canvasContextAttributes: { alpha: true },
      })

      map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'bottom-right')

      map.scrollZoom.enable()
      map.doubleClickZoom.enable()
      map.touchZoomRotate.enable()
      map.dragPan.enable()
      map.dragRotate.enable()

      map.on('click', (e) => {
        if (addingRef.current) onClickRef.current(e.lngLat.lat, e.lngLat.lng)
      })

      mapRef.current = map
    }

    init()

    return () => {
      cancelled = true
      pinMarkersRef.current.forEach(m => m.remove())
      pinMarkersRef.current = []
      memberMarkersRef.current.forEach(m => m.remove())
      memberMarkersRef.current = []
      if (userMarkerRef.current) { userMarkerRef.current.remove(); userMarkerRef.current = null }
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
      hasFlewRef.current = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pin markers ───────────────────────────────────────────
  const buildPinMarkers = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    pinMarkersRef.current.forEach(m => m.remove())
    pinMarkersRef.current = []
    for (const pin of pins) {
      const isOwn = pin.created_by === userId
      const el = document.createElement('div')
      el.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;user-select:none'
      el.innerHTML = `
        <div style="
          background:${isOwn ? '#C85A3C' : '#FBF6EC'};
          border:2px solid ${isOwn ? '#1E1B16' : 'rgba(30,27,22,0.6)'};
          border-radius:50%;width:38px;height:38px;
          display:flex;align-items:center;justify-content:center;font-size:18px;
          box-shadow:${isOwn ? '3px 3px 0 #1E1B16' : '2px 2px 0 rgba(0,0,0,0.25)'}
        ">${pin.emoji}</div>
        <div style="
          background:rgba(251,246,236,0.96);border:1.5px solid #1E1B16;border-radius:20px;
          padding:2px 8px;font-family:Georgia,serif;font-size:11px;font-weight:700;
          color:#1E1B16;white-space:nowrap;margin-top:3px;box-shadow:1px 1px 0 #1E1B16
        ">${pin.label}</div>
      `
      el.addEventListener('click', e => { e.stopPropagation(); onPinRef.current(pin) })
      pinMarkersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([pin.lng, pin.lat])
          .addTo(map)
      )
    }
  }, [pins, userId])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.isStyleLoaded()) buildPinMarkers()
    else { map.once('load', buildPinMarkers); map.once('style.load', buildPinMarkers) }
  }, [buildPinMarkers])

  // ── Member location markers ───────────────────────────────
  const buildMemberMarkers = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    memberMarkersRef.current.forEach(m => m.remove())
    memberMarkersRef.current = []
    for (const mem of memberLocations) {
      const pal = memberColor(mem.userId)
      const age = ageLabel(mem.at)
      const isLive = age === 'live'
      const initials = mem.name.charAt(0).toUpperCase()
      const el = document.createElement('div')
      el.style.cssText = 'display:flex;flex-direction:column;align-items:center;user-select:none;pointer-events:none'
      el.innerHTML = `
        <div style="
          background:${pal.bg};border:2.5px solid ${pal.border};
          border-radius:50%;width:36px;height:36px;
          display:flex;align-items:center;justify-content:center;
          box-shadow:3px 3px 0 #1E1B16;
          font-family:Georgia,serif;font-style:italic;font-size:15px;font-weight:700;
          color:${pal.fg};flex-shrink:0;
        ">${initials}</div>
        <div style="
          background:rgba(251,246,236,0.97);border:1.5px solid #1E1B16;border-radius:20px;
          padding:3px 9px;margin-top:3px;box-shadow:1px 1px 0 #1E1B16;
          display:flex;flex-direction:column;align-items:center;gap:1px;
        ">
          <div style="font-family:Georgia,serif;font-size:11px;font-weight:700;color:#1E1B16;white-space:nowrap">${mem.name}</div>
          <div style="font-size:9px;font-family:-apple-system,sans-serif;font-weight:${isLive ? 700 : 500};color:${isLive ? '#34C759' : '#8B7D65'};white-space:nowrap">${isLive ? '● live' : age}</div>
        </div>
      `
      memberMarkersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([mem.lng, mem.lat])
          .addTo(map)
      )
    }
  }, [memberLocations])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.isStyleLoaded()) buildMemberMarkers()
    else { map.once('load', buildMemberMarkers); map.once('style.load', buildMemberMarkers) }
  }, [buildMemberMarkers])

  useEffect(() => {
    const t = setInterval(() => {
      if (memberLocsRef.current.length > 0) buildMemberMarkers()
    }, 60_000)
    return () => clearInterval(t)
  }, [buildMemberMarkers])

  // ── Fly to target ─────────────────────────────────────────
  useEffect(() => {
    if (!flyTarget) return
    const map = mapRef.current
    if (!map) return
    const fly = () => map.flyTo({ center: [flyTarget.lng, flyTarget.lat], zoom: flyTarget.zoom ?? 14, duration: 1500, essential: true })
    if (map.isStyleLoaded()) fly()
    else map.once('load', fly)
  }, [flyTarget])

  // ── Own location marker ───────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (userMarkerRef.current) { userMarkerRef.current.remove(); userMarkerRef.current = null }
    if (!userLocation) return

    const el = document.createElement('div')
    el.innerHTML = `
      <style>
        .pm-pulse{animation:pm-anim 2.2s ease-in-out infinite}
        @keyframes pm-anim{0%,100%{transform:scale(1);opacity:.4}50%{transform:scale(2.8);opacity:0}}
      </style>
      <div style="position:relative;width:22px;height:22px">
        <div class="pm-pulse" style="position:absolute;inset:0;border-radius:50%;background:rgba(0,122,255,0.25)"></div>
        <div style="position:absolute;top:4px;left:4px;right:4px;bottom:4px;background:#007AFF;border-radius:50%;border:2.5px solid #fff;box-shadow:0 0 10px rgba(0,122,255,0.5)"></div>
      </div>
    `
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([userLocation.lng, userLocation.lat])
      .addTo(map)
    userMarkerRef.current = marker

    if (!hasFlewRef.current) {
      hasFlewRef.current = true
      const fly = () => map.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 10, duration: 2000, essential: true })
      if (map.isStyleLoaded()) fly()
      else map.once('load', fly)
    }
  }, [userLocation])

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#00010a' }}>
      {/* Starfield canvas — rendered behind the transparent MapLibre canvas */}
      <canvas
        ref={starsRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      />
      {/* MapLibre map — alpha canvas so the space around the globe is transparent */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  )
}

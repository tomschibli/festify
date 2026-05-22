'use client'

import { useEffect, useRef, useCallback } from 'react'
import type { MapPin } from '@/app/(app)/map/page'

interface Props {
  pins: MapPin[]
  userLocation: { lat: number; lng: number } | null
  onGlobeClick: (lat: number, lng: number) => void
  addingMode: boolean
  userId: string | null
  onPinClick: (pin: MapPin) => void
}

export default function GlobeMap({ pins, userLocation, onGlobeClick, addingMode, userId, onPinClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globeRef = useRef<any>(null)
  const addingRef    = useRef(addingMode)
  const onClickRef   = useRef(onGlobeClick)
  const onPinRef     = useRef(onPinClick)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { addingRef.current = addingMode }, [addingMode])
  useEffect(() => { onClickRef.current = onGlobeClick }, [onGlobeClick])
  useEffect(() => { onPinRef.current = onPinClick }, [onPinClick])

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Globe = require('globe.gl').default

    const globe = Globe()(el)
      .width(el.offsetWidth)
      .height(el.offsetHeight)
      .backgroundColor('rgba(0,0,0,0)')
      .showGraticules(false)
      .showAtmosphere(true)
      .atmosphereColor('rgba(160,110,70,0.35)')
      .atmosphereAltitude(0.15)
      // Use a clean OSM-based tile texture for SnapMap feel
      .globeImageUrl('//unpkg.com/three-globe/example/img/earth-day.jpg')

    const controls = globe.controls()
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.5
    controls.enablePan = false
    controls.enableZoom = true
    // Allow zooming all the way to street level (earth radius ≈ 100 units)
    controls.minDistance = 101
    controls.maxDistance = 800
    // No damping — globe.gl doesn't call controls.update() externally,
    // so damping would swallow zoom events without applying them
    controls.enableDamping = false

    // Stop auto-rotate on user interaction, resume after 5s idle
    const resetIdle = () => {
      controls.autoRotate = false
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(() => { controls.autoRotate = true }, 5000)
    }
    controls.addEventListener('start', resetIdle)

    // Globe click → add pin
    globe.onGlobeClick(({ lat, lng }: { lat: number; lng: number }) => {
      if (addingRef.current) {
        onClickRef.current(lat, lng)
        controls.autoRotate = false
      }
    })

    globeRef.current = globe

    // Fly to user or default position
    if (userLocation) {
      globe.pointOfView({ lat: userLocation.lat, lng: userLocation.lng, altitude: 0.5 }, 1500)
    } else {
      globe.pointOfView({ lat: 48, lng: 11, altitude: 2.5 }, 0)
    }

    const handleResize = () => {
      if (el) globe.width(el.offsetWidth).height(el.offsetHeight)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      controls.removeEventListener('start', resetIdle)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      while (el.firstChild) el.removeChild(el.firstChild)
      globeRef.current = null
    }
  }, [])  // eslint-disable-line

  // Update markers when data changes
  const buildMarkers = useCallback(() => {
    const g = globeRef.current
    if (!g) return

    type Pt = MapPin & { _type: 'pin' | 'me' }
    const allPts: Pt[] = [
      ...pins.map(p => ({ ...p, _type: 'pin' as const })),
      ...(userLocation
        ? [{ id: '__me__', lat: userLocation.lat, lng: userLocation.lng, label: 'Ich', emoji: '', _type: 'me' as const, created_by: '', profiles: null }]
        : []),
    ]

    g.htmlElementsData(allPts)
      .htmlLat('lat')
      .htmlLng('lng')
      .htmlAltitude(0.01)
      .htmlElement((d: Pt) => {
        const el = document.createElement('div')
        el.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:all;cursor:pointer'

        if (d._type === 'me') {
          el.innerHTML = `
            <div style="position:relative;width:22px;height:22px">
              <div style="position:absolute;inset:0;border-radius:50%;background:rgba(0,122,255,0.22);animation:pm 2.2s ease-in-out infinite"></div>
              <div style="position:absolute;top:4px;left:4px;right:4px;bottom:4px;background:#007AFF;border-radius:50%;border:2.5px solid #fff;box-shadow:0 0 10px rgba(0,122,255,0.5)"></div>
            </div>
            <div style="font-family:-apple-system,sans-serif;font-size:10px;font-weight:700;color:#fff;background:rgba(0,0,0,0.55);border-radius:8px;padding:1px 5px;margin-top:3px;white-space:nowrap;backdrop-filter:blur(4px)">Ich</div>
          `
        } else {
          const pin = d as MapPin
          const isOwn = pin.created_by === userId
          el.innerHTML = `
            <div style="
              background:${isOwn ? '#C85A3C' : '#FBF6EC'};
              border:2px solid ${isOwn ? '#1E1B16' : 'rgba(30,27,22,0.6)'};
              border-radius:50%;
              width:38px;height:38px;
              display:flex;align-items:center;justify-content:center;
              font-size:18px;
              box-shadow:${isOwn ? '0 3px 12px rgba(200,90,60,0.6)' : '0 2px 8px rgba(0,0,0,0.4)'}
            ">${pin.emoji}</div>
            <div style="
              background:rgba(251,246,236,0.96);
              border:1.5px solid #1E1B16;
              border-radius:20px;
              padding:2px 8px;
              font-family:Georgia,serif;
              font-size:11px;font-weight:700;
              color:#1E1B16;
              white-space:nowrap;
              margin-top:3px;
              box-shadow:1px 1px 0 #1E1B16;
              backdrop-filter:blur(6px)
            ">${pin.label}</div>
          `
          el.addEventListener('click', (e) => { e.stopPropagation(); onPinRef.current(pin) })
        }
        return el
      })
  }, [pins, userLocation, userId])

  useEffect(() => { buildMarkers() }, [buildMarkers])

  return (
    <>
      <style>{`
        @keyframes pm{0%,100%{transform:scale(1);opacity:.5}50%{transform:scale(2.5);opacity:0}}
      `}</style>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, background: '#0D1B2A' }} />
    </>
  )
}

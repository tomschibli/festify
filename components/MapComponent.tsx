'use client'

import { useEffect, useRef } from 'react'
import type { MapPin } from '@/app/(app)/map/page'
import 'leaflet/dist/leaflet.css'

interface Props {
  pins: MapPin[]
  userLocation: { lat: number; lng: number } | null
  onMapClick: (lat: number, lng: number) => void
  addingMode: boolean
  pendingCoords: { lat: number; lng: number } | null
  onDeletePin: (id: string) => void
  userId: string | null
}

export default function MapComponent({ pins, userLocation, onMapClick, addingMode, pendingCoords, onDeletePin, userId }: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingMarkerRef = useRef<any>(null)
  const onMapClickRef = useRef(onMapClick)
  useEffect(() => { onMapClickRef.current = onMapClick }, [onMapClick])

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const L = require('leaflet')

    // Fix default icon paths broken by webpack
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (L.Icon.Default.prototype as any)._getIconUrl
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    })

    const center: [number, number] = userLocation ? [userLocation.lat, userLocation.lng] : [48.1351, 11.582]

    const map = L.map(mapRef.current, {
      center, zoom: userLocation ? 15 : 10,
      zoomControl: true, attributionControl: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap',
    }).addTo(map)

    if (userLocation) {
      const userIcon = L.divIcon({
        html: `<div style="width:14px;height:14px;background:#007AFF;border:2.5px solid #fff;border-radius:50%;box-shadow:0 0 0 5px rgba(0,122,255,0.18),0 2px 6px rgba(0,0,0,0.18)"></div>`,
        className: '', iconSize: [14, 14], iconAnchor: [7, 7],
      })
      L.marker([userLocation.lat, userLocation.lng], { icon: userIcon })
        .bindPopup('<div style="font-size:14px;font-weight:600;color:#007AFF;font-family:-apple-system,sans-serif">Hier bin ich</div>')
        .addTo(map)
    }

    map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
      onMapClickRef.current(e.latlng.lat, e.latlng.lng)
    })

    mapInstanceRef.current = map
    return () => { map.remove(); mapInstanceRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const L = require('leaflet')

    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    pins.forEach(pin => {
      const icon = L.divIcon({
        html: `<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.2))">${pin.emoji}</div>`,
        className: '', iconSize: [32, 32], iconAnchor: [16, 28],
      })
      const isOwn = pin.created_by === userId
      const marker = L.marker([pin.lat, pin.lng], { icon })
        .bindPopup(`
          <div style="font-family:-apple-system,sans-serif;min-width:150px">
            <div style="font-size:15px;font-weight:600;color:#000;margin-bottom:3px">${pin.label}</div>
            <div style="font-size:12px;color:#6C6C70;margin-bottom:${isOwn ? '10px' : '0'}">von ${pin.profiles?.display_name || 'Unbekannt'}</div>
            ${isOwn ? `<button onclick="window._festifyDeletePin('${pin.id}')" style="padding:6px 14px;border-radius:8px;border:none;background:rgba(255,59,48,0.1);color:#FF3B30;cursor:pointer;font-size:13px;font-weight:600;font-family:-apple-system,sans-serif">Löschen</button>` : ''}
          </div>
        `)
        .addTo(map)
      markersRef.current.push(marker)
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any)._festifyDeletePin = (id: string) => { onDeletePin(id); map.closePopup() }
  }, [pins, userId])

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const L = require('leaflet')

    pendingMarkerRef.current?.remove()
    pendingMarkerRef.current = null

    if (pendingCoords) {
      const icon = L.divIcon({
        html: `<div style="font-size:32px;line-height:1;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.25))">📍</div>`,
        className: '', iconSize: [32, 32], iconAnchor: [16, 32],
      })
      pendingMarkerRef.current = L.marker([pendingCoords.lat, pendingCoords.lng], { icon }).addTo(map)
    }
  }, [pendingCoords])

  useEffect(() => {
    if (mapRef.current) mapRef.current.style.cursor = addingMode ? 'crosshair' : ''
  }, [addingMode])

  return <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
}

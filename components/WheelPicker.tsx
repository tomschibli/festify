'use client'

import { useRef, useState, useEffect, useCallback } from 'react'

const H = 48   // item height px
const VIS = 5  // visible items

interface WheelColProps {
  items: string[]
  value: string
  onChange: (v: string) => void
  width?: number
}

export function WheelCol({ items, value, onChange, width = 72 }: WheelColProps) {
  const [baseIdx, setBaseIdx] = useState(() => Math.max(0, items.indexOf(value)))
  const [drag, setDrag]       = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const startYRef    = useRef(0)
  const startIdxRef  = useRef(0)
  const velocityRef  = useRef(0)
  const lastYRef     = useRef(0)
  const lastTRef     = useRef(0)
  const rafRef       = useRef(0)
  const divRef       = useRef<HTMLDivElement>(null)

  // Sync when parent changes value
  useEffect(() => {
    const idx = items.indexOf(value)
    if (idx >= 0 && idx !== baseIdx) setBaseIdx(idx)
  }, [value, items]) // eslint-disable-line react-hooks/exhaustive-deps

  // rawOffset: logical scroll position in px
  // drag is POSITIVE when finger moves DOWN (content moves down = lower index)
  const rawOffset = baseIdx * H - drag
  const clampedOffset = Math.max(0, Math.min(rawOffset, (items.length - 1) * H))
  const centerIdx = clampedOffset / H
  const half  = Math.floor(VIS / 2)
  const first = Math.max(0, Math.floor(centerIdx) - half)
  const last  = Math.min(items.length - 1, Math.ceil(centerIdx) + half)

  function commit(finalOffset: number) {
    const snapped = Math.max(0, Math.min(Math.round(finalOffset / H), items.length - 1))
    setBaseIdx(snapped)
    setDrag(0)
    onChange(items[snapped])
  }

  // Momentum scroll after release
  function startMomentum(velocity: number, startOffset: number) {
    cancelAnimationFrame(rafRef.current)
    let offset = startOffset
    let v = velocity
    const FRICTION = 0.92

    function step() {
      v *= FRICTION
      offset -= v  // velocity is in px/ms, subtract because higher offset = lower index
      const clamped = Math.max(0, Math.min(offset, (items.length - 1) * H))
      const snapped = Math.round(clamped / H)
      // Render the live offset by backing-calculating drag from baseIdx
      // We manage this by just calling commit when velocity is small enough
      if (Math.abs(v) < 0.5) {
        commit(clamped)
        return
      }
      // Update display: set baseIdx to nearest and drag to fine-tune
      setBaseIdx(Math.round(clamped / H))
      setDrag(Math.round(clamped / H) * H - clamped)
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    cancelAnimationFrame(rafRef.current)
    divRef.current?.setPointerCapture(e.pointerId)
    startYRef.current  = e.clientY
    startIdxRef.current = baseIdx
    lastYRef.current   = e.clientY
    lastTRef.current   = e.timeStamp
    velocityRef.current = 0
    setIsDragging(true)
    setDrag(0)
  }, [baseIdx])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return
    // Positive dy = finger moved DOWN = content moves down = lower index
    const dy = e.clientY - startYRef.current
    setDrag(dy)

    // Track velocity (px/ms)
    const dt = e.timeStamp - lastTRef.current
    if (dt > 0) velocityRef.current = (e.clientY - lastYRef.current) / dt
    lastYRef.current = e.clientY
    lastTRef.current = e.timeStamp
  }, [isDragging])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return
    setIsDragging(false)
    const dy = e.clientY - startYRef.current
    const finalOffset = startIdxRef.current * H - dy

    // If fast fling, use momentum
    if (Math.abs(velocityRef.current) > 0.3) {
      startMomentum(-velocityRef.current * 16, finalOffset)
    } else {
      commit(finalOffset)
    }
  }, [isDragging, items, onChange]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  // Mouse wheel: scroll down (deltaY > 0) = lower index (earlier)
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    cancelAnimationFrame(rafRef.current)
    const next = Math.max(0, Math.min(baseIdx - (e.deltaY > 0 ? 1 : -1), items.length - 1))
    setBaseIdx(next)
    setDrag(0)
    onChange(items[next])
  }, [baseIdx, items, onChange])

  const containerH = VIS * H
  const centerPx   = (VIS / 2) * H  // visual center = 2.5 * H = 120 px

  return (
    <div
      ref={divRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      style={{
        position: 'relative',
        width,
        height: containerH,
        overflow: 'hidden',
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      {/* Selection highlight band */}
      <div style={{
        position: 'absolute',
        top: centerPx - H / 2,
        left: 4, right: 4,
        height: H,
        borderRadius: 12,
        background: '#F3D9C7',
        border: '1.5px solid #C85A3C',
        zIndex: 0,
        pointerEvents: 'none',
      }} />

      {/* Items */}
      {Array.from({ length: last - first + 1 }, (_, i) => {
        const idx  = first + i
        const item = items[idx]
        const y    = centerPx + (idx - clampedOffset / H) * H
        const dist = Math.abs(idx - clampedOffset / H)
        const isSelected = dist < 0.6
        const opacity = Math.max(0.25, 1 - dist * 0.35)

        return (
          <div
            key={idx}
            onClick={() => { cancelAnimationFrame(rafRef.current); setBaseIdx(idx); setDrag(0); onChange(item) }}
            style={{
              position: 'absolute',
              left: 0, right: 0,
              height: H,
              top: y - H / 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1,
              cursor: 'pointer',
              opacity,
              transform: `scale(${isSelected ? 1.08 : 1})`,
              transition: isDragging ? 'none' : 'opacity 0.1s, transform 0.15s',
            }}
          >
            <span style={{
              fontFamily: '"Fraunces", Georgia, serif',
              fontStyle: 'italic',
              fontSize: isSelected ? 21 : 18,
              fontWeight: isSelected ? 800 : 500,
              color: isSelected ? '#C85A3C' : '#5D5240',
              lineHeight: 1,
              transition: isDragging ? 'none' : 'all 0.15s',
              pointerEvents: 'none',
            }}>
              {item}
            </span>
          </div>
        )
      })}

      {/* Top fade */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: H * 1.8,
        background: 'linear-gradient(to bottom, #FBF6EC 15%, rgba(251,246,236,0))',
        pointerEvents: 'none', zIndex: 2,
      }} />
      {/* Bottom fade */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: H * 1.8,
        background: 'linear-gradient(to top, #FBF6EC 15%, rgba(251,246,236,0))',
        pointerEvents: 'none', zIndex: 2,
      }} />
    </div>
  )
}

/* ── Full date+time picker ─────────────────────────────────── */
interface DateTimePickerProps {
  date: string
  time: string
  onDateChange: (d: string) => void
  onTimeChange: (t: string) => void
  showTime?: boolean
}

const MONTHS = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']
const DAYS   = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'))
const YEARS  = Array.from({ length: 6 },  (_, i) => String(new Date().getFullYear() + i))
const HOURS  = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINS   = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

const SEP = (
  <span style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontSize: 20, fontWeight: 700, color: '#D4C8AE', userSelect: 'none', flexShrink: 0 }}>·</span>
)

export default function DateTimePicker({ date, time, onDateChange, onTimeChange, showTime = true }: DateTimePickerProps) {
  const parts  = (date || `${new Date().getFullYear()}-01-01`).split('-')
  const year   = YEARS.includes(parts[0]) ? parts[0] : YEARS[0]
  const monIdx = Math.max(0, parseInt(parts[1] || '1') - 1)
  const day    = parts[2]?.padStart(2, '0') || '01'
  const tparts = (time || '12:00').split(':')
  const hour   = tparts[0]?.padStart(2, '0') || '12'
  const rawMin = parseInt(tparts[1] || '0')
  const minute = String(Math.round(rawMin / 5) * 5 % 60).padStart(2, '0')
  const pad    = (n: number) => String(n).padStart(2, '0')

  function setDay(d: string)   { onDateChange(`${year}-${pad(monIdx + 1)}-${d}`) }
  function setMonth(m: string) { onDateChange(`${year}-${pad(MONTHS.indexOf(m) + 1)}-${day}`) }
  function setYear(y: string)  { onDateChange(`${y}-${pad(monIdx + 1)}-${day}`) }
  function setHour(h: string)  { onTimeChange(`${h}:${minute}`) }
  function setMin(m: string)   { onTimeChange(`${hour}:${m}`) }

  return (
    <div style={{
      background: '#FBF6EC',
      borderRadius: 18,
      border: '1.5px solid #1E1B16',
      boxShadow: '4px 4px 0 #1E1B16',
      padding: '6px 10px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      overflow: 'hidden',
    }}>
      <WheelCol items={DAYS}   value={day}            onChange={setDay}   width={54} />
      {SEP}
      <WheelCol items={MONTHS} value={MONTHS[monIdx]} onChange={setMonth} width={58} />
      {SEP}
      <WheelCol items={YEARS}  value={year}           onChange={setYear}  width={66} />

      {showTime && (
        <>
          <div style={{ width: 1, height: H * 3, background: '#D4C8AE', margin: '0 6px', flexShrink: 0 }} />
          <WheelCol items={HOURS} value={hour}   onChange={setHour} width={50} />
          <span style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontSize: 22, fontWeight: 800, color: '#C85A3C', userSelect: 'none', marginBottom: 2, flexShrink: 0 }}>:</span>
          <WheelCol items={MINS}  value={minute} onChange={setMin}  width={50} />
        </>
      )}
    </div>
  )
}

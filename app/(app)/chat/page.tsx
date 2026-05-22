'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

/* ── Types ───────────────────────────────────────────────── */
interface Message {
  id: string; content: string; created_at: string
  user_id: string; profiles: { display_name: string } | null
}
interface Member { id: string; display_name: string; left?: boolean }
interface CalEvent { id: string; title: string; event_date: string; event_time: string | null }
interface DMsg { id: string; user_id: string; content: string; created_at: string }
type View = 'list' | 'group' | string
type CallState = { name: string; type: 'audio' | 'video' } | null
type IncomingCall = { callerName: string; type: 'audio' | 'video'; callerId: string } | null

/* ── System message prefixes ─────────────────────────────── */
const SYS_CALL_AUDIO  = '__CALL_AUDIO__'
const SYS_CALL_VIDEO  = '__CALL_VIDEO__'
const SYS_IMAGE       = '__IMAGE__:'
const SYS_EVENT       = '__EVENT__:'
const SYS_AUDIO       = '__AUDIO__:'
const SYS_REPLY       = '__REPLY__:'
const DM_PFX          = 'DM:'  // private DMs: DM:recipientId:content
const SYS_LEFT        = '__LEFT__:'

/* ── Per-user bubble colors ──────────────────────────────── */
const BUBBLE_PALETTES: { bg: string; fg: string; border: string }[] = [
  { bg: '#F3D9C7', fg: '#6B2A10', border: '#C85A3C' },
  { bg: '#C8D8E8', fg: '#1A3A5C', border: '#6B8FA4' },
  { bg: '#C8E0D0', fg: '#1A4A2C', border: '#4A6A52' },
  { bg: '#E8E0C0', fg: '#5A4410', border: '#D89020' },
  { bg: '#D8C8E0', fg: '#4A1A5C', border: '#7A4A5A' },
  { bg: '#F0C8C8', fg: '#6B1A1A', border: '#D86B75' },
  { bg: '#C8E4E4', fg: '#1A5050', border: '#4A8A8A' },
]
function bubblePalette(uid: string) {
  let h = 5381
  for (let i = 0; i < uid.length; i++) h = (((h << 5) + h) + uid.charCodeAt(i)) >>> 0
  return BUBBLE_PALETTES[h % BUBBLE_PALETTES.length]
}

/* ── Avatar ──────────────────────────────────────────────── */
const PI_G: Record<string, [string, string]> = {
  A:['#FFD6A5','#E89A6F'],B:['#C5D3D9','#6B8FA4'],C:['#D4C4A0','#8B7D65'],
  D:['#C8D9B8','#4A6A52'],E:['#F5C4B0','#C85A3C'],F:['#F5E0A0','#D89020'],
  G:['#D4C0D0','#7A4A5A'],H:['#F5B8A8','#D86B75'],
}
function gradFor(name: string): [string, string] {
  const keys = Object.keys(PI_G)
  return PI_G[keys[(name || '').charCodeAt(0) % keys.length]]
}
function Avatar({ name = '?', size = 44, style: s }: { name?: string; size?: number; style?: React.CSSProperties }) {
  const [a, b] = gradFor(name)
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: `linear-gradient(135deg,${a},${b})`, border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 700, fontSize: Math.round(size * 0.38), color: 'var(--ink)', flexShrink: 0, userSelect: 'none', ...s }}>
      {(name || '?')[0].toUpperCase()}
    </div>
  )
}

/* ── Pressable ───────────────────────────────────────────── */
function Press({ onClick, children, style: s }: { onClick?: () => void; children: React.ReactNode; style?: React.CSSProperties }) {
  const [p, setP] = useState(false)
  return (
    <div onClick={onClick} onMouseDown={() => setP(true)} onMouseUp={() => setP(false)} onMouseLeave={() => setP(false)} onTouchStart={() => setP(true)} onTouchEnd={() => setP(false)}
      style={{ transform: p ? 'scale(0.97)' : 'scale(1)', transition: 'transform 150ms cubic-bezier(0.22,1,0.36,1)', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', ...s }}>
      {children}
    </div>
  )
}

/* ── Ringtone ────────────────────────────────────────────── */
function startRinging(): () => void {
  // Vibrate pattern (works on Android)
  try { navigator.vibrate?.([600, 200, 600, 200, 600]) } catch {}
  const vibrateInterval = setInterval(() => {
    try { navigator.vibrate?.([600, 200, 600]) } catch {}
  }, 3500)
  // Web Audio tones
  let audioCancelled = false
  let audioCtx: AudioContext | null = null
  try {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const tones = [880, 1047, 880]
    let step = 0
    function tick() {
      if (audioCancelled || !audioCtx) return
      try {
        const osc = audioCtx.createOscillator()
        const gain = audioCtx.createGain()
        osc.connect(gain); gain.connect(audioCtx.destination)
        osc.frequency.value = tones[step % tones.length]
        osc.type = 'sine'
        gain.gain.setValueAtTime(0.25, audioCtx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.22)
        osc.start(audioCtx.currentTime)
        osc.stop(audioCtx.currentTime + 0.22)
        step++
        osc.onended = () => { setTimeout(tick, step % tones.length === 0 ? 800 : 80) }
      } catch {}
    }
    tick()
  } catch {}
  return () => {
    audioCancelled = true
    clearInterval(vibrateInterval)
    try { navigator.vibrate?.(0) } catch {}
    try { audioCtx?.close() } catch {}
  }
}

/* ── Incoming call screen ────────────────────────────────── */
function IncomingCallScreen({ callerName, type, onAccept, onDecline }: {
  callerName: string; type: 'audio' | 'video'; onAccept: () => void; onDecline: () => void
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'linear-gradient(180deg,#1A1410 0%,#0D0B08 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
      <div style={{ fontFamily: 'var(--font-hand)', fontSize: 16, color: 'rgba(251,246,236,0.5)', marginBottom: 4 }}>{type === 'video' ? 'Videoanruf eingehend…' : 'Anruf eingehend…'}</div>
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <div style={{ position: 'absolute', inset: -24, borderRadius: '50%', background: 'rgba(200,90,60,0.12)', animation: 'pi-pulse 2s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', inset: -12, borderRadius: '50%', background: 'rgba(200,90,60,0.2)', animation: 'pi-pulse 2s ease-in-out 0.6s infinite' }} />
        <Avatar name={callerName} size={100} style={{ boxShadow: '0 0 0 4px rgba(200,90,60,0.5),0 0 0 8px rgba(200,90,60,0.15)' }} />
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 30, fontWeight: 700, color: 'var(--paper)', marginTop: 8 }}>{callerName}</div>
      <div style={{ position: 'absolute', bottom: 'max(80px, env(safe-area-inset-bottom, 80px))', display: 'flex', gap: 60 }}>
        {/* Decline */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <Press onClick={onDecline}>
            <div style={{ width: 68, height: 68, borderRadius: '50%', background: '#FF3B30', border: '2px solid #C0291F', boxShadow: '3px 3px 0 rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" style={{ transform: 'rotate(135deg)' }}>
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.61 4.44 2 2 0 0 1 3.59 2.25h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21.83 16.92z"/>
              </svg>
            </div>
          </Press>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>Ablehnen</span>
        </div>
        {/* Accept */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <Press onClick={onAccept}>
            <div style={{ width: 68, height: 68, borderRadius: '50%', background: '#34C759', border: '2px solid #28A046', boxShadow: '3px 3px 0 rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.61 4.44 2 2 0 0 1 3.59 2.25h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21.83 16.92z"/>
              </svg>
            </div>
          </Press>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>Annehmen</span>
        </div>
      </div>
    </div>
  )
}

/* ── Calling screen ──────────────────────────────────────── */
function CallingScreen({ name, type, onEnd }: { name: string; type: 'audio' | 'video'; onEnd: () => void }) {
  const [secs, setSecs] = useState(0)
  useEffect(() => { const t = setInterval(() => setSecs(s => s + 1), 1000); return () => clearInterval(t) }, [])
  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,#2A1E14,#1A160E)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, zIndex: 100 }}>
      <div style={{ fontFamily: 'var(--font-hand)', fontSize: 16, color: 'rgba(251,246,236,0.5)' }}>{type === 'video' ? 'Video-Anruf' : 'Sprachanruf'}</div>
      <Avatar name={name} size={96} style={{ boxShadow: '0 0 0 4px rgba(200,90,60,0.4),0 0 0 8px rgba(200,90,60,0.15)' }} />
      <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 26, fontWeight: 700, color: 'var(--paper)' }}>{name}</div>
      <div style={{ fontFamily: 'var(--font-hand)', fontSize: 18, color: 'rgba(251,246,236,0.55)' }}>{fmt(secs)}</div>
      <div style={{ position: 'absolute', bottom: 80, display: 'flex', gap: 24 }}>
        <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'rgba(251,246,236,0.12)', border: '1px solid rgba(251,246,236,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="var(--paper)" strokeWidth={1.6} strokeLinecap="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
        </div>
        <Press onClick={onEnd}>
          <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#FF3B30', border: '2px solid #C0291F', boxShadow: '2px 2px 0 rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" style={{ transform: 'rotate(135deg)' }}>
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.61 4.44 2 2 0 0 1 3.59 2.25h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21.83 16.92z"/>
            </svg>
          </div>
        </Press>
        <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'rgba(251,246,236,0.12)', border: '1px solid rgba(251,246,236,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="var(--paper)" strokeWidth={1.6} strokeLinecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
        </div>
      </div>
    </div>
  )
}

/* ── Group info sheet ────────────────────────────────────── */
function GroupSheet({ communityName, inviteCode, onClose, onSwitchGroup, onLogout }: { communityName: string; inviteCode: string; onClose: () => void; onSwitchGroup: () => void; onLogout: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 80, background: 'rgba(30,27,22,0.45)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--paper)', borderRadius: '24px 24px 0 0', border: '1.5px solid var(--stroke)', borderBottom: 'none', paddingBottom: 40, animation: 'pi-sheet-in 300ms cubic-bezier(0.22,1,0.36,1) both' }}>
        <div style={{ width: 36, height: 4, background: 'var(--stroke-hair)', borderRadius: 2, margin: '12px auto 0' }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 24px 16px', gap: 10 }}>
          <div style={{ width: 64, height: 64, borderRadius: 22, background: 'linear-gradient(135deg,var(--accent-soft),var(--accent))', border: '2px solid var(--stroke)', boxShadow: 'var(--offset-md)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="var(--paper)" strokeWidth={1.6} strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>{communityName}</div>
        </div>
        <div style={{ margin: '0 24px 14px', background: 'var(--accent-wash)', borderRadius: 'var(--r-md)', border: '1px solid var(--stroke-hair)', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 4 }}>Einladungscode</div>
            <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 24, fontWeight: 700, letterSpacing: 6, color: 'var(--accent)' }}>{inviteCode}</div>
          </div>
          <Press onClick={() => { navigator.clipboard?.writeText(inviteCode); setCopied(true); setTimeout(() => setCopied(false), 2000) }}>
            <div style={{ background: copied ? 'var(--sage)' : 'var(--accent)', color: 'var(--paper)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 'var(--r-full)', transition: 'all 0.2s' }}>{copied ? 'Kopiert!' : 'Kopieren'}</div>
          </Press>
        </div>
        <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Press onClick={onSwitchGroup}><div style={{ width: '100%', textAlign: 'center', color: 'var(--accent)', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 17, fontWeight: 700, height: 50, borderRadius: 'var(--r-full)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Gruppe wechseln</div></Press>
          <Press onClick={onLogout}><div style={{ width: '100%', textAlign: 'center', color: '#FF3B30', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 17, fontWeight: 700, height: 50, borderRadius: 'var(--r-full)', border: '1.5px solid rgba(255,59,48,0.3)', background: 'rgba(255,59,48,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Abmelden</div></Press>
        </div>
      </div>
    </div>
  )
}

/* ── System message bubble ───────────────────────────────── */
function SystemBubble({ content }: { content: string }) {
  if (content === SYS_CALL_AUDIO) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--sage-wash)', border: '1px solid var(--sage)', borderRadius: 'var(--r-full)', padding: '7px 14px', fontSize: 13, fontFamily: 'var(--font-sans)', color: 'var(--sage)' }}>
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--sage)" strokeWidth={2} strokeLinecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.61 4.44 2 2 0 0 1 3.59 2.25h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21.83 16.92z"/></svg>
      Sprachanruf
    </div>
  )
  if (content === SYS_CALL_VIDEO) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--accent-wash)', border: '1px solid var(--accent)', borderRadius: 'var(--r-full)', padding: '7px 14px', fontSize: 13, fontFamily: 'var(--font-sans)', color: 'var(--accent)' }}>
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
      Videoanruf
    </div>
  )
  if (content.startsWith(SYS_IMAGE)) {
    const url = content.slice(SYS_IMAGE.length)
    return <img src={url} alt="Foto" style={{ maxWidth: 240, maxHeight: 240, borderRadius: 12, border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', objectFit: 'cover', display: 'block' }} />
  }
  if (content.startsWith(SYS_EVENT)) {
    const parts = content.split(':')
    const title = parts[2]
    const time = parts.slice(3).join(':')
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#FFF8E0', border: '1px solid var(--ochre)', borderRadius: 'var(--r-full)', padding: '7px 14px', fontSize: 13, fontFamily: 'var(--font-sans)', color: 'var(--ochre)', maxWidth: 280 }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--ochre)" strokeWidth={2} strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span style={{ fontWeight: 600 }}>In 10 Min:</span> {title}{time && time !== 'undefined' ? ` · ${time.slice(0, 5)}` : ''}
      </div>
    )
  }
  if (content.startsWith(SYS_LEFT)) {
    const name = content.slice(SYS_LEFT.length)
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(30,27,22,0.05)', border: '1px solid var(--stroke-hair)', borderRadius: 'var(--r-full)', padding: '7px 14px', fontSize: 13, fontFamily: 'var(--font-sans)', color: 'var(--text-muted)' }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth={2} strokeLinecap="round"><path d="M17 16l4-4m0 0l-4-4m4 4H7"/><path d="M3 12V7a2 2 0 0 1 2-2h8"/><path d="M3 12v5a2 2 0 0 0 2 2h8"/></svg>
        <span><strong>{name}</strong> hat die Gruppe verlassen</span>
      </div>
    )
  }
  if (content.startsWith(SYS_AUDIO)) {
    const url = content.slice(SYS_AUDIO.length)
    return (
      <div style={{ background: 'var(--paper)', border: '1.5px solid var(--stroke)', borderRadius: 20, padding: '8px 12px', boxShadow: 'var(--offset-sm)' }}>
        <audio controls src={url} style={{ height: 32, width: 200, display: 'block' }} />
      </div>
    )
  }
  return null
}

/* ── Message group rendering ─────────────────────────────── */
function groupMessages(msgs: Message[]) {
  const out: { uid: string; name: string; items: Message[] }[] = []
  msgs.forEach(m => {
    const isSystem = m.content === SYS_CALL_AUDIO || m.content === SYS_CALL_VIDEO || m.content.startsWith(SYS_EVENT) || m.content.startsWith(SYS_LEFT)
    if (isSystem) {
      out.push({ uid: m.user_id, name: m.profiles?.display_name || '?', items: [m] })
      return
    }
    const last = out[out.length - 1]
    if (last && last.uid === m.user_id && !last.items[0].content.startsWith('__') && !m.content.startsWith('__')) {
      last.items.push(m)
    } else {
      out.push({ uid: m.user_id, name: m.profiles?.display_name || '?', items: [m] })
    }
  })
  return out
}

/* ── Group chat ──────────────────────────────────────────── */
function GroupChatView({ communityId, communityName, inviteCode, userId, myName, onBack, onCallStart, onShowInfo }: {
  communityId: string; communityName: string; inviteCode: string
  userId: string; myName: string; onBack: () => void
  onCallStart: (type: 'audio' | 'video') => void; onShowInfo: () => void
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText]         = useState('')
  const [loading, setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [msgAction, setMsgAction] = useState<Message | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText]   = useState('')
  const [replyTo, setReplyTo]     = useState<Message | null>(null)
  const bottomRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)
  const fileRef    = useRef<HTMLInputElement>(null)
  const supabase   = createClient()
  const notifiedRef    = useRef<Set<string>>(new Set())
  const mediaRecRef    = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const lpRef          = useRef<ReturnType<typeof setTimeout> | null>(null)
  const swipeStartX    = useRef(0)
  const swipeTriggered = useRef(false)

  const scrollDown = () => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })

  // Save "last seen" when leaving the group chat (fixes unread count for messages received while open)
  useEffect(() => {
    return () => { try { localStorage.setItem(`chat-seen-group-${communityId}`, new Date().toISOString()) } catch {} }
  }, [communityId])

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('chat_messages')
        .select('id,content,created_at,user_id')
        .eq('community_id', communityId)
        .not('content', 'like', 'DM:%')
        .order('created_at', { ascending: true })
        .limit(200)
      if (data && data.length > 0) {
        const uids = [...new Set(data.map((m: { user_id: string }) => m.user_id))]
        const { data: profs } = await supabase.from('profiles').select('id,display_name').in('id', uids)
        const pm: Record<string, string> = {}
        ;(profs || []).forEach((p: { id: string; display_name: string }) => { pm[p.id] = p.display_name })
        setMessages(data.map((m: Omit<Message, 'profiles'>) => ({ ...m, profiles: pm[m.user_id] ? { display_name: pm[m.user_id] } : null })) as Message[])
      } else {
        setMessages([])
      }
      setLoading(false)
    }
    load()

    const ch = supabase.channel(`chat:${communityId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `community_id=eq.${communityId}` }, async (payload) => {
        const raw = payload.new as { id: string; content: string; created_at: string; user_id: string }
        if (raw.content.startsWith(DM_PFX)) return // skip private messages
        const { data: prof } = await supabase.from('profiles').select('display_name').eq('id', raw.user_id).single()
        const msg: Message = { id: raw.id, content: raw.content, created_at: raw.created_at, user_id: raw.user_id, profiles: prof ? { display_name: (prof as { display_name: string }).display_name } : null }
        setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg])
      }).subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [communityId])

  useEffect(() => { scrollDown() }, [messages])

  const checkReminders = useCallback(async () => {
    const now = new Date()
    const { data: events } = await supabase.from('calendar_events').select('id,title,event_date,event_time').eq('community_id', communityId)
    if (!events) return
    for (const ev of events as CalEvent[]) {
      if (!ev.event_time) continue
      const [h, m] = ev.event_time.split(':').map(Number)
      const evTime = new Date(ev.event_date + 'T00:00:00')
      evTime.setHours(h, m, 0, 0)
      const diffMin = (evTime.getTime() - now.getTime()) / 60000
      if (diffMin >= 9 && diffMin <= 11) {
        const key = `ev-notified-${ev.id}-${ev.event_date}`
        if (notifiedRef.current.has(key)) continue
        const alreadySent = messages.some(msg => msg.content.startsWith(`${SYS_EVENT}${ev.id}:`))
        if (!alreadySent) {
          notifiedRef.current.add(key)
          await supabase.from('chat_messages').insert({ community_id: communityId, user_id: userId, content: `${SYS_EVENT}${ev.id}:${ev.title}:${ev.event_time}` })
          if (Notification.permission === 'granted') {
            new Notification(`📅 In 10 Minuten: ${ev.title}`, { body: `Um ${ev.event_time.slice(0, 5)} Uhr`, icon: '/icons/icon-192.png' })
          }
        }
      }
    }
  }, [communityId, userId, messages])

  useEffect(() => {
    checkReminders()
    const t = setInterval(checkReminders, 60_000)
    return () => clearInterval(t)
  }, [checkReminders])

  async function insertAndShow(content: string) {
    const { data, error } = await supabase.from('chat_messages').insert({ community_id: communityId, user_id: userId, content }).select('id,content,created_at,user_id').single()
    if (!error && data) {
      const msg: Message = { id: (data as { id: string }).id, content: (data as { content: string }).content, created_at: (data as { created_at: string }).created_at, user_id: userId, profiles: { display_name: myName } }
      setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg])
    }
  }

  async function send() {
    const content = text.trim()
    if (!content) return
    setText('')
    const finalContent = replyTo
      ? `${SYS_REPLY}${replyTo.user_id}:${(replyTo.profiles?.display_name || '?').slice(0, 20)}:${replyTo.content.slice(0, 60).replace(/\n/g, ' ')}::${content}`
      : content
    setReplyTo(null)
    await insertAndShow(finalContent)
    inputRef.current?.focus()
  }

  async function handleImageUpload(file: File) {
    if (!file) return
    setUploading(true)
    const path = `${communityId}/${userId}_${Date.now()}.${file.name.split('.').pop() || 'jpg'}`
    const { error } = await supabase.storage.from('photos').upload(path, file, { contentType: file.type })
    if (!error) {
      const { data: { publicUrl } } = supabase.storage.from('photos').getPublicUrl(path)
      await insertAndShow(`${SYS_IMAGE}${publicUrl}`)
    }
    setUploading(false)
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      audioChunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        if (blob.size < 1000) return
        setUploading(true)
        const path = `${communityId}/${userId}_audio_${Date.now()}.webm`
        const { error } = await supabase.storage.from('photos').upload(path, blob, { contentType: 'audio/webm' })
        if (!error) {
          const { data: { publicUrl } } = supabase.storage.from('photos').getPublicUrl(path)
          await insertAndShow(`${SYS_AUDIO}${publicUrl}`)
        }
        setUploading(false)
      }
      mr.start()
      mediaRecRef.current = mr
      setRecording(true)
    } catch { /* mic denied */ }
  }

  function stopRecording() { mediaRecRef.current?.stop(); mediaRecRef.current = null; setRecording(false) }

  function lpDown(msg: Message) {
    if (msg.content.startsWith('__')) return
    lpRef.current = setTimeout(() => setMsgAction(msg), 600)
  }
  function lpUp() { if (lpRef.current) { clearTimeout(lpRef.current); lpRef.current = null } }

  async function deleteMessage(id: string) {
    await supabase.from('chat_messages').delete().eq('id', id)
    setMessages(prev => prev.filter(m => m.id !== id))
    setMsgAction(null)
  }

  async function saveEdit(id: string) {
    const content = editText.trim()
    if (!content) return
    const { error } = await supabase.from('chat_messages').update({ content }).eq('id', id)
    if (!error) setMessages(prev => prev.map(m => m.id === id ? { ...m, content } : m))
    setEditingId(null); setEditText('')
  }

  function swipeDown(isMe: boolean, e: React.PointerEvent) { swipeStartX.current = e.clientX; swipeTriggered.current = false }
  function swipeMove(msg: Message, isMe: boolean, e: React.PointerEvent) {
    if (swipeTriggered.current) return
    const dx = e.clientX - swipeStartX.current
    const trigger = isMe ? dx < -55 : dx > 55
    if (trigger) {
      swipeTriggered.current = true
      if (lpRef.current) { clearTimeout(lpRef.current); lpRef.current = null }
      setReplyTo(msg)
      setTimeout(() => inputRef.current?.focus(), 50)
    } else if (Math.abs(dx) > 8 && lpRef.current) {
      clearTimeout(lpRef.current); lpRef.current = null
    }
  }

  function timeStr(iso: string) { return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) }
  const groups = useMemo(() => groupMessages(messages), [messages])

  // Decode action sheet preview (strip __REPLY__ encoding)
  function previewContent(content: string): string {
    if (content.startsWith(SYS_REPLY)) {
      const rest = content.slice(SYS_REPLY.length)
      const sep = rest.indexOf('::')
      return sep > -1 ? rest.slice(sep + 2) : content
    }
    return content
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--paper-tint)', position: 'relative' }}>
      {/* Long-press action sheet */}
      {msgAction && (
        <div onClick={() => setMsgAction(null)} style={{ position: 'absolute', inset: 0, zIndex: 90, background: 'rgba(30,27,22,0.3)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} className="up" style={{ background: 'var(--paper)', borderRadius: '24px 24px 0 0', border: '1.5px solid var(--stroke)', borderBottom: 'none', padding: '0 20px', paddingBottom: 'max(28px, env(safe-area-inset-bottom, 28px))' }}>
            <div style={{ width: 36, height: 4, background: 'var(--stroke-hair)', borderRadius: 2, margin: '12px auto 14px' }} />
            <div style={{ background: 'var(--paper-tint)', borderRadius: 'var(--r-md)', padding: '10px 14px', marginBottom: 14, fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--text-sub)', lineHeight: 1.4 }}>
              {(() => { const p = previewContent(msgAction.content); return p.length > 80 ? p.slice(0, 80) + '…' : p })()}
            </div>
            {msgAction.user_id === userId ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button onClick={() => { setEditingId(msgAction.id); setEditText(previewContent(msgAction.content)); setMsgAction(null) }} style={{ width: '100%', height: 50, background: 'var(--paper)', border: '1.5px solid var(--stroke)', borderRadius: 'var(--r-full)', boxShadow: 'var(--offset-sm)', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 16, fontWeight: 700, color: 'var(--accent)', cursor: 'pointer' }}>Bearbeiten</button>
                <button onClick={() => deleteMessage(msgAction.id)} style={{ width: '100%', height: 50, background: 'rgba(255,59,48,0.08)', border: '1.5px solid rgba(255,59,48,0.3)', borderRadius: 'var(--r-full)', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 16, fontWeight: 700, color: '#FF3B30', cursor: 'pointer' }}>Löschen</button>
              </div>
            ) : (
              <button onClick={() => setMsgAction(null)} style={{ width: '100%', height: 50, background: 'var(--paper-deep)', border: '1.5px solid var(--stroke-hair)', borderRadius: 'var(--r-full)', fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--text-muted)', cursor: 'pointer' }}>Schließen</button>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ background: 'rgba(251,246,236,0.92)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid var(--stroke-hair)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <Press onClick={onBack} style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--paper)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        </Press>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,var(--accent-soft),var(--accent))', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="var(--paper)" strokeWidth={1.8} strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onShowInfo}>
          <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 16, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{communityName}</div>
          <div style={{ fontFamily: 'var(--font-hand)', fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>Gruppen-Chat · aktiv</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Press onClick={() => onCallStart('audio')} style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--paper)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="var(--sage)" strokeWidth={1.8} strokeLinecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.61 4.44 2 2 0 0 1 3.59 2.25h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21.83 16.92z"/></svg>
          </Press>
          <Press onClick={() => onCallStart('video')} style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--paper)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={1.8} strokeLinecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          </Press>
        </div>
      </div>

      {/* Messages */}
      <div className="scroll" style={{ flex: 1, padding: '14px 12px 4px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {loading && [70,130,90,55,110].map((w,i) => (
          <div key={i} style={{ display: 'flex', justifyContent: i%2===0 ? 'flex-start' : 'flex-end', marginBottom: 8 }}>
            <div className="skel" style={{ height: 42, width: w }} />
          </div>
        ))}

        {!loading && groups.map((g, gi) => {
          const isMe = g.uid === userId
          const isSystem = g.items[0].content === SYS_CALL_AUDIO || g.items[0].content === SYS_CALL_VIDEO || g.items[0].content.startsWith(SYS_EVENT) || g.items[0].content.startsWith(SYS_LEFT)

          if (isSystem) {
            return (
              <div key={gi} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 10, gap: 2 }}>
                <span style={{ fontFamily: 'var(--font-hand)', fontSize: 12, color: 'var(--text-faint)', marginBottom: 4 }}>{g.name} · {new Date(g.items[0].created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
                <SystemBubble content={g.items[0].content} />
              </div>
            )
          }

          const last = g.items[g.items.length - 1]
          return (
            <div key={gi} style={{ display: 'flex', flexDirection: 'column', marginBottom: 8 }}>
              <div style={{ display: 'flex', flexDirection: isMe ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 8 }}>
                {!isMe ? <Avatar name={g.name} size={28} style={{ boxShadow: 'var(--offset-sm)' }} /> : <div style={{ width: 0 }} />}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', gap: 3, maxWidth: '74%' }}>
                  {!isMe && <span style={{ fontFamily: 'var(--font-hand)', fontSize: 13, fontWeight: 600, color: bubblePalette(g.uid).border, marginLeft: 4, marginBottom: 1 }}>{g.name}</span>}
                  {g.items.map((m, mi) => {
                    const isLast = mi === g.items.length - 1
                    const pal = isMe ? null : bubblePalette(m.user_id)
                    const bubbleBg = isMe ? 'var(--accent)' : pal!.bg
                    const bubbleFg = isMe ? 'var(--paper)' : pal!.fg
                    const bubbleBorder = isMe ? 'var(--stroke)' : pal!.border
                    const br = isMe ? `20px 20px ${isLast ? 6 : 20}px 20px` : `20px 20px 20px ${isLast ? 6 : 20}px`

                    if (m.content.startsWith(SYS_IMAGE)) {
                      const url = m.content.slice(SYS_IMAGE.length)
                      return <img key={m.id} src={url} alt="Foto" style={{ maxWidth: 220, maxHeight: 220, borderRadius: 12, border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', objectFit: 'cover' }} />
                    }
                    if (m.content.startsWith(SYS_AUDIO)) {
                      const url = m.content.slice(SYS_AUDIO.length)
                      return (
                        <div key={m.id} style={{ background: bubbleBg, border: `1.5px solid ${bubbleBorder}`, borderRadius: br, padding: '8px 12px', boxShadow: 'var(--offset-sm)' }}>
                          <audio controls src={url} style={{ height: 32, width: 180, display: 'block' }} />
                        </div>
                      )
                    }
                    if (editingId === m.id) {
                      return (
                        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input value={editText} onChange={e => setEditText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveEdit(m.id); if (e.key === 'Escape') { setEditingId(null); setEditText('') } }} autoFocus
                            style={{ flex: 1, background: isMe ? 'rgba(255,255,255,0.15)' : 'var(--paper-tint)', color: isMe ? 'var(--paper)' : 'var(--ink)', border: `1.5px solid ${bubbleBorder}`, borderRadius: 12, padding: '6px 10px', fontSize: 15 }} />
                          <button onClick={() => saveEdit(m.id)} style={{ background: 'var(--accent)', color: 'var(--paper)', border: 'none', borderRadius: 8, padding: '6px 10px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>✓</button>
                          <button onClick={() => { setEditingId(null); setEditText('') }} style={{ background: 'var(--paper-deep)', color: 'var(--ink)', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 13 }}>✗</button>
                        </div>
                      )
                    }

                    let replyBlock: { sender: string; quote: string } | null = null
                    let displayContent = m.content
                    if (m.content.startsWith(SYS_REPLY)) {
                      const rest = m.content.slice(SYS_REPLY.length)
                      const sep = rest.indexOf('::')
                      if (sep > -1) {
                        const parts = rest.slice(0, sep).split(':')
                        replyBlock = { sender: parts[1] || '?', quote: parts.slice(2).join(':') }
                        displayContent = rest.slice(sep + 2)
                      }
                    }

                    return (
                      <div key={m.id}
                        onPointerDown={e => { lpDown(m); swipeDown(isMe, e) }}
                        onPointerUp={lpUp}
                        onPointerMove={e => swipeMove(m, isMe, e)}
                        onPointerCancel={lpUp}
                        onContextMenu={e => { e.preventDefault(); lpDown(m) }}
                        style={{ background: bubbleBg, color: bubbleFg, padding: replyBlock ? '4px 14px 9px' : '9px 14px', fontSize: 15, lineHeight: 1.4, fontFamily: 'var(--font-sans)', border: `1.5px solid ${bubbleBorder}`, boxShadow: 'var(--offset-sm)', borderRadius: br, userSelect: 'none', WebkitUserSelect: 'none', cursor: 'default', touchAction: 'pan-y' }}>
                        {replyBlock && (
                          <div style={{ borderLeft: `3px solid ${isMe ? 'rgba(255,255,255,0.5)' : bubbleBorder}`, paddingLeft: 8, marginBottom: 6, marginTop: 5, opacity: 0.75 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 1 }}>{replyBlock.sender}</div>
                            <div style={{ fontSize: 12, lineHeight: 1.3 }}>{replyBlock.quote}</div>
                          </div>
                        )}
                        {displayContent}
                      </div>
                    )
                  })}
                  <div style={{ fontFamily: 'var(--font-hand)', fontSize: 12, color: 'var(--text-faint)', padding: '0 4px', marginTop: 1 }}>{new Date(last.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Reply preview bar */}
      {replyTo && (
        <div style={{ background: 'var(--accent-wash)', borderTop: '1px solid var(--stroke-hair)', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ width: 3, alignSelf: 'stretch', background: 'var(--accent)', borderRadius: 2, flexShrink: 0, minHeight: 20 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 2 }}>Antwort an {replyTo.profiles?.display_name || '?'}</div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--text-sub)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {replyTo.content.startsWith(SYS_AUDIO) ? '🎤 Sprachnachricht' : replyTo.content.startsWith(SYS_IMAGE) ? '📷 Foto' : previewContent(replyTo.content).slice(0, 60)}
            </div>
          </div>
          <button onClick={() => setReplyTo(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', flexShrink: 0 }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {/* Composer */}
      <div style={{ background: 'rgba(251,246,236,0.96)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderTop: '1px solid var(--stroke-hair)', padding: '10px 14px 16px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); if (fileRef.current) fileRef.current.value = '' }} />
        <Press onClick={() => fileRef.current?.click()} style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--paper)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {uploading ? <div style={{ width: 16, height: 16, border: '2px solid var(--stroke-hair)', borderTopColor: 'var(--accent)' }} className="spin" />
            : <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth={1.8} strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>}
        </Press>
        <div style={{ flex: 1, background: 'var(--paper)', borderRadius: 24, border: '1.5px solid var(--stroke)', padding: '10px 16px', display: 'flex', alignItems: 'center', boxShadow: 'var(--offset-sm)' }}>
          <input ref={inputRef} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Nachricht schreiben…" style={{ flex: 1, fontSize: 15, color: 'var(--ink)', background: 'transparent' }} />
        </div>
        {text.trim()
          ? <Press onClick={send} style={{ width: 42, height: 42, borderRadius: '50%', background: 'var(--accent)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="var(--paper)" strokeWidth={2.5} strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </Press>
          : <div onPointerDown={startRecording} onPointerUp={stopRecording} onPointerLeave={() => recording && stopRecording()}
              style={{ width: 42, height: 42, borderRadius: '50%', background: recording ? '#FF3B30' : 'var(--paper)', border: `1.5px solid ${recording ? '#FF3B30' : 'var(--stroke)'}`, boxShadow: recording ? '0 0 0 4px rgba(255,59,48,0.2)' : 'var(--offset-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', transition: 'all 0.15s', userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none' }}>
              <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke={recording ? '#fff' : 'var(--text-muted)'} strokeWidth={1.8} strokeLinecap="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>
            </div>
        }
      </div>
    </div>
  )
}

/* ── Private chat ────────────────────────────────────────── */
function PrivateChatView({ member, userId, communityId, onBack, onCallStart, onMessageSent, isLeft }: {
  member: Member; userId: string; communityId: string
  onBack: () => void; onCallStart: (type: 'audio' | 'video') => void
  onMessageSent?: (preview: string) => void
  isLeft?: boolean
}) {
  const [msgs, setMsgs]       = useState<DMsg[]>([])
  const [text, setText]       = useState('')
  const [uploading, setUploading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [loading, setLoading] = useState(true)
  const bottomRef      = useRef<HTMLDivElement>(null)
  const fileRef        = useRef<HTMLInputElement>(null)
  const inputRef       = useRef<HTMLInputElement>(null)
  const mediaRecRef    = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const supabase = createClient()

  const myDMPrefix    = `${DM_PFX}${member.id}:`
  const theirDMPrefix = `${DM_PFX}${userId}:`

  useEffect(() => {
    async function load() {
      // Fetch messages I sent to them
      const { data: mine } = await supabase.from('chat_messages').select('id,content,created_at,user_id')
        .eq('community_id', communityId).eq('user_id', userId).like('content', `${DM_PFX}${member.id}:%`)
        .order('created_at', { ascending: true }).limit(200)
      // Fetch messages they sent to me
      const { data: theirs } = await supabase.from('chat_messages').select('id,content,created_at,user_id')
        .eq('community_id', communityId).eq('user_id', member.id).like('content', `${DM_PFX}${userId}:%`)
        .order('created_at', { ascending: true }).limit(200)
      const all = [...(mine || []), ...(theirs || [])].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      setMsgs(all as DMsg[])
      setLoading(false)
    }
    load()

    // Save "last seen" when leaving DM (fixes unread for messages received while chat is open)
    const saveSeenOnUnmount = () => { try { localStorage.setItem(`chat-seen-dm-${communityId}-${member.id}`, new Date().toISOString()) } catch {} }

    // Realtime: listen for new DMs addressed to me from this member
    const ch = supabase.channel(`dm:${userId}:${member.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `community_id=eq.${communityId}` }, (payload) => {
        const raw = payload.new as DMsg
        if (raw.user_id === member.id && raw.content.startsWith(theirDMPrefix)) {
          setMsgs(prev => prev.find(m => m.id === raw.id) ? prev : [...prev, raw])
        }
      }).subscribe()

    return () => { supabase.removeChannel(ch); saveSeenOnUnmount() }
  }, [communityId, userId, member.id])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  function timeStr(iso: string) { return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) }

  async function send() {
    const content = text.trim()
    if (!content) return
    setText('')
    onMessageSent?.(content.slice(0, 50))
    const dmContent = `${myDMPrefix}${content}`
    const tempId = `temp-${Date.now()}`
    const tempMsg: DMsg = { id: tempId, user_id: userId, content: dmContent, created_at: new Date().toISOString() }
    setMsgs(prev => [...prev, tempMsg])
    const { data, error } = await supabase.from('chat_messages').insert({ community_id: communityId, user_id: userId, content: dmContent }).select('id,created_at').single()
    if (!error && data) {
      setMsgs(prev => prev.map(m => m.id === tempId ? { ...m, id: (data as { id: string }).id, created_at: (data as { created_at: string }).created_at } : m))
    } else if (error) {
      setMsgs(prev => prev.filter(m => m.id !== tempId))
    }
    inputRef.current?.focus()
  }

  async function handleImageUpload(file: File) {
    setUploading(true)
    const path = `${communityId}/dm_${userId}_${Date.now()}.${file.name.split('.').pop() || 'jpg'}`
    const { error } = await supabase.storage.from('photos').upload(path, file, { contentType: file.type })
    if (!error) {
      onMessageSent?.('📷 Foto')
      const { data: { publicUrl } } = supabase.storage.from('photos').getPublicUrl(path)
      const dmContent = `${myDMPrefix}${SYS_IMAGE}${publicUrl}`
      const tempId = `temp-${Date.now()}`
      setMsgs(prev => [...prev, { id: tempId, user_id: userId, content: dmContent, created_at: new Date().toISOString() }])
      const { data, error: err2 } = await supabase.from('chat_messages').insert({ community_id: communityId, user_id: userId, content: dmContent }).select('id,created_at').single()
      if (!err2 && data) setMsgs(prev => prev.map(m => m.id === tempId ? { ...m, id: (data as { id: string }).id, created_at: (data as { created_at: string }).created_at } : m))
    }
    setUploading(false)
  }

  async function startRecordingPrivate() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      audioChunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        if (blob.size < 1000) return
        setUploading(true)
        const path = `${communityId}/dm_${userId}_audio_${Date.now()}.webm`
        const { error } = await supabase.storage.from('photos').upload(path, blob, { contentType: 'audio/webm' })
        if (!error) {
          onMessageSent?.('🎤 Sprachnachricht')
          const { data: { publicUrl } } = supabase.storage.from('photos').getPublicUrl(path)
          const dmContent = `${myDMPrefix}${SYS_AUDIO}${publicUrl}`
          const tempId = `temp-${Date.now()}`
          setMsgs(prev => [...prev, { id: tempId, user_id: userId, content: dmContent, created_at: new Date().toISOString() }])
          const { data, error: err2 } = await supabase.from('chat_messages').insert({ community_id: communityId, user_id: userId, content: dmContent }).select('id,created_at').single()
          if (!err2 && data) setMsgs(prev => prev.map(m => m.id === tempId ? { ...m, id: (data as { id: string }).id, created_at: (data as { created_at: string }).created_at } : m))
        }
        setUploading(false)
      }
      mr.start(); mediaRecRef.current = mr; setRecording(true)
    } catch { /* mic denied */ }
  }

  function stopRecordingPrivate() { mediaRecRef.current?.stop(); mediaRecRef.current = null; setRecording(false) }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--paper-tint)', position: 'relative' }}>
      <div style={{ background: 'rgba(251,246,236,0.92)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid var(--stroke-hair)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <Press onClick={onBack} style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--paper)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        </Press>
        <Avatar name={member.display_name} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{member.display_name}</div>
          <div style={{ fontFamily: 'var(--font-hand)', fontSize: 12, color: isLeft ? '#FF3B30' : 'var(--text-muted)' }}>{isLeft ? 'Hat die Gruppe verlassen' : 'Privat · verschlüsselt'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Press onClick={() => onCallStart('audio')} style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--paper)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="var(--sage)" strokeWidth={1.8} strokeLinecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.61 4.44 2 2 0 0 1 3.59 2.25h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21.83 16.92z"/></svg>
          </Press>
          <Press onClick={() => onCallStart('video')} style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--paper)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={1.8} strokeLinecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          </Press>
        </div>
      </div>

      <div className="scroll" style={{ flex: 1, padding: '14px 12px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && [60,110,80].map((w,i) => (
          <div key={i} style={{ display: 'flex', justifyContent: i%2===0 ? 'flex-start' : 'flex-end' }}>
            <div className="skel" style={{ height: 40, width: w }} />
          </div>
        ))}
        {!loading && msgs.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <Avatar name={member.display_name} size={56} style={{ margin: '0 auto 12px' }} />
            <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 17, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>{member.display_name}</div>
            <div style={{ fontFamily: 'var(--font-hand)', fontSize: 15, color: 'var(--text-muted)' }}>Beginn eurer Unterhaltung</div>
          </div>
        )}
        {!loading && msgs.map(m => {
          const isMe = m.user_id === userId
          const dmPrefix = isMe ? myDMPrefix : theirDMPrefix
          const rawContent = m.content.startsWith(dmPrefix) ? m.content.slice(dmPrefix.length) : m.content

          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: isMe ? 'row-reverse' : 'row', gap: 8, alignItems: 'flex-end' }}>
              {!isMe && <Avatar name={member.display_name} size={28} />}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', maxWidth: '74%' }}>
                {rawContent.startsWith(SYS_IMAGE)
                  ? <img src={rawContent.slice(SYS_IMAGE.length)} alt="Foto" style={{ maxWidth: 220, maxHeight: 220, borderRadius: 12, border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', objectFit: 'cover' }} />
                  : rawContent.startsWith(SYS_AUDIO)
                  ? <div style={{ background: isMe ? 'var(--accent)' : 'var(--paper)', border: '1.5px solid var(--stroke)', borderRadius: 16, padding: '8px 12px', boxShadow: 'var(--offset-sm)' }}><audio controls src={rawContent.slice(SYS_AUDIO.length)} style={{ height: 32, width: 180, display: 'block' }} /></div>
                  : <div style={{ background: isMe ? 'var(--accent)' : 'var(--paper)', color: isMe ? 'var(--paper)' : 'var(--ink)', padding: '9px 14px', fontSize: 15, lineHeight: 1.4, border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', borderRadius: isMe ? '20px 20px 6px 20px' : '20px 20px 20px 6px' }}>{rawContent}</div>
                }
                <div style={{ fontFamily: 'var(--font-hand)', fontSize: 12, color: 'var(--text-faint)', padding: '0 4px', marginTop: 1 }}>{timeStr(m.created_at)}</div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {isLeft ? (
        <div style={{ background: 'var(--paper-tint)', borderTop: '1px solid var(--stroke-hair)', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexShrink: 0 }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth={2} strokeLinecap="round"><path d="M17 16l4-4m0 0l-4-4m4 4H7"/><path d="M3 12V7a2 2 0 0 1 2-2h8"/><path d="M3 12v5a2 2 0 0 0 2 2h8"/></svg>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--text-muted)' }}>Hat die Gruppe verlassen</span>
        </div>
      ) : (
        <div style={{ background: 'rgba(251,246,236,0.96)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderTop: '1px solid var(--stroke-hair)', padding: '10px 14px 16px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); if (fileRef.current) fileRef.current.value = '' }} />
          <Press onClick={() => fileRef.current?.click()} style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--paper)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {uploading ? <div style={{ width: 16, height: 16, border: '2px solid var(--stroke-hair)', borderTopColor: 'var(--accent)' }} className="spin" />
              : <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth={1.8} strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>}
          </Press>
          <div style={{ flex: 1, background: 'var(--paper)', borderRadius: 24, border: '1.5px solid var(--stroke)', padding: '10px 16px', display: 'flex', alignItems: 'center', boxShadow: 'var(--offset-sm)' }}>
            <input ref={inputRef} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="Nachricht schreiben…" style={{ flex: 1, fontSize: 15, color: 'var(--ink)', background: 'transparent' }} />
          </div>
          {text.trim()
            ? <Press onClick={send} style={{ width: 42, height: 42, borderRadius: '50%', background: 'var(--accent)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="var(--paper)" strokeWidth={2.5} strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </Press>
            : <div onPointerDown={startRecordingPrivate} onPointerUp={stopRecordingPrivate} onPointerLeave={() => recording && stopRecordingPrivate()}
                style={{ width: 42, height: 42, borderRadius: '50%', background: recording ? '#FF3B30' : 'var(--paper)', border: `1.5px solid ${recording ? '#FF3B30' : 'var(--stroke)'}`, boxShadow: recording ? '0 0 0 4px rgba(255,59,48,0.2)' : 'var(--offset-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', transition: 'all 0.15s', userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none' }}>
                <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke={recording ? '#fff' : 'var(--text-muted)'} strokeWidth={1.8} strokeLinecap="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>
              </div>
          }
        </div>
      )}
    </div>
  )
}

/* ── Main ChatPage ────────────────────────────────────────── */
export default function ChatPage() {
  const [view, setView]             = useState<View>('list')
  const [calling, setCalling]       = useState<CallState>(null)
  const [incomingCall, setIncomingCall] = useState<IncomingCall>(null)
  const [showInfo, setShowInfo]     = useState(false)
  const [communityId, setCommunityId] = useState<string | null>(null)
  const [communityName, setCommunityName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [userId, setUserId]         = useState('')
  const [myName, setMyName]         = useState('')
  const [members, setMembers]       = useState<Member[]>([])
  const [leftMembers, setLeftMembers] = useState<Member[]>([])
  const [loading, setLoading]       = useState(true)
  const [unreadGroup, setUnreadGroup] = useState(0)
  const [dmUnread, setDmUnread]       = useState<Record<string, number>>({})
  const [dmLastMsg, setDmLastMsg]     = useState<Record<string, string>>({})
  const viewRef        = useRef<View>('list')
  const userIdRef      = useRef('')
  const callChannelRef = useRef<ReturnType<typeof createClient>['channel'] extends (...args: infer A) => infer R ? R : never | null>(null as never)
  const stopRingRef    = useRef<(() => void) | null>(null)
  const supabase       = createClient()
  const router         = useRouter()

  useEffect(() => { viewRef.current = view }, [view])
  useEffect(() => { userIdRef.current = userId }, [userId])

  // Play/stop ringtone when incoming call changes
  useEffect(() => {
    if (incomingCall) {
      stopRingRef.current = startRinging()
      // Show browser notification if page hidden
      if (document.hidden && Notification.permission === 'granted') {
        new Notification(`📞 ${incomingCall.callerName} ruft an`, { body: incomingCall.type === 'video' ? 'Videoanruf' : 'Sprachanruf', icon: '/icons/icon-192.png', tag: 'incoming-call' })
      }
    } else {
      stopRingRef.current?.()
      stopRingRef.current = null
    }
  }, [incomingCall])

  // Subscribe to call broadcasts for this community
  useEffect(() => {
    if (!communityId || !userId) return
    const ch = supabase.channel(`calls:${communityId}`)
      .on('broadcast', { event: 'call_request' }, ({ payload }) => {
        if (!payload || payload.callerId === userId) return
        if (payload.recipientId !== 'all' && payload.recipientId !== userId) return
        // Don't show incoming call if already on a call
        setCalling(cur => {
          if (!cur) setIncomingCall({ callerName: payload.callerName, type: payload.type, callerId: payload.callerId })
          return cur
        })
      })
      .on('broadcast', { event: 'call_end' }, ({ payload }) => {
        if (!payload) return
        setIncomingCall(prev => (prev?.callerId === payload.callerId ? null : prev))
        // If we accepted and are on a call with this person, end it
        setCalling(prev => (prev && payload.callerId !== userId ? null : prev))
      })
      .subscribe()
    ;(callChannelRef as React.MutableRefObject<typeof ch>).current = ch
    return () => { supabase.removeChannel(ch) }
  }, [communityId, userId])

  // Unread group message count
  useEffect(() => {
    if (!communityId) return
    const lastSeen = (() => { try { return localStorage.getItem(`chat-seen-group-${communityId}`) || new Date(0).toISOString() } catch { return new Date(0).toISOString() } })()
    supabase.from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('community_id', communityId)
      .gt('created_at', lastSeen)
      .not('content', 'like', 'DM:%')
      .then(({ count }) => { if ((count ?? 0) > 0) setUnreadGroup(count!) })
    const ch = supabase.channel(`unread:${communityId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `community_id=eq.${communityId}` }, (payload) => {
        const raw = payload.new as { content: string; user_id: string }
        const { content } = raw
        const uid = userIdRef.current
        if (content.startsWith(`${DM_PFX}${uid}:`)) {
          // DM addressed to me
          const senderId = raw.user_id
          if (viewRef.current !== senderId) {
            setDmUnread(prev => ({ ...prev, [senderId]: (prev[senderId] || 0) + 1 }))
          }
          const msgRaw = content.slice(`${DM_PFX}${uid}:`.length)
          const preview = msgRaw.startsWith(SYS_AUDIO) ? '🎤 Sprachnachricht' : msgRaw.startsWith(SYS_IMAGE) ? '📷 Foto' : msgRaw.slice(0, 50)
          setDmLastMsg(prev => ({ ...prev, [senderId]: preview }))
          return
        }
        if (content.startsWith(DM_PFX) || content.startsWith('__')) return
        if (viewRef.current !== 'group') setUnreadGroup(u => u + 1)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [communityId])

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth'); return }
      setUserId(user.id)
      const { data: prof } = await supabase.from('profiles').select('display_name, current_community_id').eq('id', user.id).single()
      if (!prof?.current_community_id) { router.push('/onboarding'); return }
      setMyName(prof.display_name || '')
      const { data: comm } = await supabase.from('communities').select('id,name,invite_code').eq('id', prof.current_community_id).single()
      if (comm) { setCommunityId(comm.id); setCommunityName(comm.name); setInviteCode(comm.invite_code) }
      const { data: memberIds } = await supabase.from('community_members').select('user_id').eq('community_id', prof.current_community_id)
      const ids = (memberIds || []).map((m: { user_id: string }) => m.user_id).filter((id: string) => id !== user.id)
      let memberList: Member[] = []
      if (ids.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id,display_name').in('id', ids)
        memberList = (profiles as Member[]) || []
        setMembers(memberList)
      }

      // Load DM unread counts + last message previews + detect left members
      const { data: allDms } = await supabase
        .from('chat_messages')
        .select('id, content, user_id, created_at')
        .eq('community_id', prof.current_community_id)
        .like('content', 'DM:%')
        .order('created_at', { ascending: false })
        .limit(500)
      if (allDms) {
        const uid = user.id
        const cid = prof.current_community_id
        const unreadMap: Record<string, number> = {}
        const lastMsgMap: Record<string, string> = {}
        const currentMemberIdSet = new Set(memberList.map(m => m.id))
        for (const mem of memberList) {
          const lastSeenTs = (() => { try { return new Date(localStorage.getItem(`chat-seen-dm-${cid}-${mem.id}`) || 0).getTime() } catch { return 0 } })()
          const toMe     = allDms.filter((m: { content: string; user_id: string }) => m.user_id === mem.id && m.content.startsWith(`DM:${uid}:`))
          const unread   = toMe.filter((m: { created_at: string }) => new Date(m.created_at).getTime() > lastSeenTs).length
          if (unread > 0) unreadMap[mem.id] = unread
          const convo    = allDms.filter((m: { content: string; user_id: string }) =>
            (m.user_id === mem.id && m.content.startsWith(`DM:${uid}:`)) ||
            (m.user_id === uid && m.content.startsWith(`DM:${mem.id}:`))
          )
          if (convo.length > 0) {
            const lm = convo[0]
            const pfx = lm.user_id === uid ? `DM:${mem.id}:` : `DM:${uid}:`
            const raw = lm.content.startsWith(pfx) ? lm.content.slice(pfx.length) : lm.content
            lastMsgMap[mem.id] = raw.startsWith(SYS_AUDIO) ? '🎤 Sprachnachricht' : raw.startsWith(SYS_IMAGE) ? '📷 Foto' : raw.slice(0, 50)
          }
        }
        setDmUnread(unreadMap)
        // Find DM partners who are no longer in the community
        const dmPartnerIds = new Set<string>()
        for (const dm of allDms as { content: string; user_id: string }[]) {
          if (dm.user_id === uid) {
            const recipientId = dm.content.slice(3).split(':')[0]
            if (recipientId && recipientId !== uid && !currentMemberIdSet.has(recipientId)) dmPartnerIds.add(recipientId)
          } else if (dm.content.startsWith(`DM:${uid}:`) && !currentMemberIdSet.has(dm.user_id)) {
            dmPartnerIds.add(dm.user_id)
          }
        }
        if (dmPartnerIds.size > 0) {
          const leftIds = [...dmPartnerIds]
          const { data: leftProfs } = await supabase.from('profiles').select('id,display_name').in('id', leftIds)
          const leftList = (leftProfs || []).map((p: { id: string; display_name: string }) => ({ id: p.id, display_name: p.display_name, left: true as const }))
          setLeftMembers(leftList)
          for (const lm of leftList) {
            const convo = (allDms as { content: string; user_id: string }[]).filter(m =>
              (m.user_id === lm.id && m.content.startsWith(`DM:${uid}:`)) ||
              (m.user_id === uid && m.content.startsWith(`DM:${lm.id}:`))
            )
            if (convo.length > 0) {
              const msg = convo[0]
              const pfx = msg.user_id === uid ? `DM:${lm.id}:` : `DM:${uid}:`
              const raw = msg.content.startsWith(pfx) ? msg.content.slice(pfx.length) : msg.content
              lastMsgMap[lm.id] = raw.startsWith(SYS_AUDIO) ? '🎤 Sprachnachricht' : raw.startsWith(SYS_IMAGE) ? '📷 Foto' : raw.slice(0, 50)
            }
          }
        }
        setDmLastMsg(lastMsgMap)
      }
      setLoading(false)
    }
    init()
  }, [])

  function sendCallRequest(type: 'audio' | 'video', recipientId: string | 'all') {
    const ch = (callChannelRef as React.MutableRefObject<{ send: (msg: object) => void } | null>).current
    ch?.send({ type: 'broadcast', event: 'call_request', payload: { callerName: myName, type, callerId: userId, recipientId } })
  }

  function sendCallEnd() {
    const ch = (callChannelRef as React.MutableRefObject<{ send: (msg: object) => void } | null>).current
    ch?.send({ type: 'broadcast', event: 'call_end', payload: { callerId: userId } })
  }

  function handleCallEnd() {
    sendCallEnd()
    setCalling(null)
  }

  function handleGroupCallStart(type: 'audio' | 'video') {
    sendCallRequest(type, 'all')
    // Log to group chat
    supabase.from('chat_messages').insert({ community_id: communityId, user_id: userId, content: type === 'audio' ? SYS_CALL_AUDIO : SYS_CALL_VIDEO }).then(() => {})
    setCalling({ name: communityName, type })
  }

  function handlePrivateCallStart(type: 'audio' | 'video', member: Member) {
    sendCallRequest(type, member.id)
    setCalling({ name: member.display_name, type })
  }

  function handleAcceptCall() {
    if (!incomingCall) return
    const ic = incomingCall
    setIncomingCall(null)
    setCalling({ name: ic.callerName, type: ic.type })
  }

  function handleDeclineCall() {
    setIncomingCall(null)
  }

  async function switchCommunity() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !communityId) return
    await supabase.from('chat_messages').insert({ community_id: communityId, user_id: userId, content: `${SYS_LEFT}${myName}` })
    await supabase.from('community_members').delete().eq('community_id', communityId).eq('user_id', userId)
    await supabase.from('profiles').update({ current_community_id: null }).eq('id', user.id)
    router.push('/onboarding')
  }
  async function logout() { await supabase.auth.signOut(); router.push('/auth') }

  if (loading) return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--paper-tint)' }}>
      <div style={{ width: 28, height: 28, border: '2.5px solid var(--paper-deep)', borderTopColor: 'var(--accent)' }} className="spin" />
    </div>
  )

  return (
    <>
      {/* Incoming call overlay — rendered above everything */}
      {incomingCall && (
        <IncomingCallScreen callerName={incomingCall.callerName} type={incomingCall.type} onAccept={handleAcceptCall} onDecline={handleDeclineCall} />
      )}

      {calling ? (
        <div style={{ height: '100%', position: 'relative' }}>
          <CallingScreen name={calling.name} type={calling.type} onEnd={handleCallEnd} />
        </div>
      ) : view === 'group' && communityId ? (
        <div style={{ height: '100%', position: 'relative' }}>
          <GroupChatView communityId={communityId} communityName={communityName} inviteCode={inviteCode} userId={userId} myName={myName} onBack={() => setView('list')} onCallStart={handleGroupCallStart} onShowInfo={() => setShowInfo(true)} />
          {showInfo && <GroupSheet communityName={communityName} inviteCode={inviteCode} onClose={() => setShowInfo(false)} onSwitchGroup={switchCommunity} onLogout={logout} />}
        </div>
      ) : view !== 'list' && communityId ? (
        (() => {
          const member = members.find(m => m.id === view) || leftMembers.find(m => m.id === view)
          const isLeft = !members.find(m => m.id === view) && !!leftMembers.find(m => m.id === view)
          return member ? <PrivateChatView member={member} userId={userId} communityId={communityId} onBack={() => setView('list')} onCallStart={type => handlePrivateCallStart(type, member)} onMessageSent={preview => setDmLastMsg(prev => ({ ...prev, [member.id]: preview }))} isLeft={isLeft} /> : null
        })()
      ) : (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--paper-tint)' }}>
          <div style={{ background: 'rgba(251,246,236,0.92)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid var(--stroke-hair)', padding: '12px 22px 14px', flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-hand)', fontSize: 14, color: 'var(--accent)', marginBottom: 1 }}>deine gruppe,</div>
            <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 28, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>Chats</div>
          </div>
          <div className="scroll" style={{ flex: 1 }}>
            <div style={{ margin: '0 16px', marginTop: 16 }}>
              <Press onClick={() => { setView('group'); setUnreadGroup(0); try { if (communityId) localStorage.setItem(`chat-seen-group-${communityId}`, new Date().toISOString()) } catch {} }}>
                <div style={{ background: 'var(--paper)', border: '1.5px solid var(--stroke)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--offset-md)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 52, height: 52, borderRadius: 16, background: 'linear-gradient(135deg,var(--accent-soft),var(--accent))', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="var(--paper)" strokeWidth={1.6} strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{communityName || 'Gruppe'}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {unreadGroup > 0
                          ? <div style={{ minWidth: 22, height: 22, borderRadius: 'var(--r-full)', background: 'var(--accent)', color: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, padding: '0 6px', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)' }}>{unreadGroup > 99 ? '99+' : unreadGroup}</div>
                          : <div style={{ fontFamily: 'var(--font-hand)', fontSize: 13, color: 'var(--accent)' }}>jetzt</div>
                        }
                      </div>
                    </div>
                    <div style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--text-sub)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Tippe um zu schreiben…</div>
                  </div>
                </div>
              </Press>
            </div>
            {members.length > 0 && (
              <>
                <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--text-muted)', textTransform: 'uppercase', padding: '0 22px', marginTop: 20, marginBottom: 10 }}>PRIVAT · {members.length}</div>
                <div style={{ background: 'var(--paper)', border: '1.5px solid var(--stroke)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--offset-md)', margin: '0 16px', overflow: 'hidden' }}>
                  {members.map((m, i) => (
                    <Press key={m.id} onClick={() => {
                      setView(m.id)
                      setDmUnread(prev => { const n = { ...prev }; delete n[m.id]; return n })
                      try { if (communityId) localStorage.setItem(`chat-seen-dm-${communityId}-${m.id}`, new Date().toISOString()) } catch {}
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 14, borderTop: i === 0 ? 'none' : '1px solid var(--stroke-hair)', cursor: 'pointer' }}>
                        <Avatar name={m.display_name} size={50} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{m.display_name}</div>
                            {(dmUnread[m.id] ?? 0) > 0 && (
                              <div style={{ minWidth: 20, height: 20, borderRadius: 'var(--r-full)', background: 'var(--accent)', color: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, padding: '0 5px', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', flexShrink: 0, marginLeft: 8 }}>{dmUnread[m.id] > 99 ? '99+' : dmUnread[m.id]}</div>
                            )}
                          </div>
                          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: dmLastMsg[m.id] ? 'var(--text-sub)' : 'var(--text-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {dmLastMsg[m.id] || 'Schreib eine Nachricht…'}
                          </div>
                        </div>
                      </div>
                    </Press>
                  ))}
                </div>
              </>
            )}
            {leftMembers.length > 0 && (
              <>
                <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--text-faint)', textTransform: 'uppercase', padding: '0 22px', marginTop: 20, marginBottom: 10 }}>VERLASSEN · {leftMembers.length}</div>
                <div style={{ background: 'var(--paper)', border: '1.5px solid var(--stroke-hair)', borderRadius: 'var(--r-lg)', margin: '0 16px', overflow: 'hidden', opacity: 0.7 }}>
                  {leftMembers.map((m, i) => (
                    <Press key={m.id} onClick={() => setView(m.id)}>
                      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 14, borderTop: i === 0 ? 'none' : '1px solid var(--stroke-hair)', cursor: 'pointer' }}>
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                          <Avatar name={m.display_name} size={50} style={{ filter: 'grayscale(0.6)' }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 16, fontWeight: 700, color: 'var(--text-muted)' }}>{m.display_name}</div>
                          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--text-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {dmLastMsg[m.id] || 'Hat die Gruppe verlassen'}
                          </div>
                        </div>
                      </div>
                    </Press>
                  ))}
                </div>
              </>
            )}
            <div style={{ height: 16 }} />
          </div>
        </div>
      )}
    </>
  )
}

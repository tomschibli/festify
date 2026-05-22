'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

/* ── Icons ───────────────────────────────────────────────── */
function IcoMap({ active }: { active: boolean }) {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.6} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
      <line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>
    </svg>
  )
}
function IcoChat({ active }: { active: boolean }) {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      <circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="12" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/>
    </svg>
  )
}
function IcoCamera() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  )
}
function IcoCalendar({ active }: { active: boolean }) {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}
function IcoSettings({ active }: { active: boolean }) {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.6} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  )
}

const SIDE_TABS = [
  { href: '/map',      label: 'KARTE',    Icon: IcoMap },
  { href: '/chat',     label: 'CHATS',    Icon: IcoChat },
  null, // camera center
  { href: '/calendar', label: 'KALENDER', Icon: IcoCalendar },
  { href: '/settings', label: 'MEHR',     Icon: IcoSettings },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [camPressed, setCamPressed] = useState(false)
  const isCamera = pathname === '/camera'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden', background: 'var(--paper-tint)' }}>
      <main style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0 }}>
        {children}
      </main>

      {/* Tab Bar */}
      <nav style={{
        background: 'rgba(251,246,236,0.96)',
        backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        borderTop: '1px solid var(--stroke-hair)',
        padding: '10px 4px 26px',
        display: 'flex', justifyContent: 'space-around', alignItems: 'flex-end',
        zIndex: 20, flexShrink: 0,
      }}>
        {SIDE_TABS.map((tab, i) => {
          if (tab === null) {
            /* Camera center button */
            return (
              <Link key="camera" href="/camera"
                onMouseDown={() => setCamPressed(true)}
                onMouseUp={() => setCamPressed(false)}
                onMouseLeave={() => setCamPressed(false)}
                onTouchStart={() => setCamPressed(true)}
                onTouchEnd={() => setCamPressed(false)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 56, textDecoration: 'none', WebkitTapHighlightColor: 'transparent' }}
              >
                <div style={{
                  width: 52, height: 52, borderRadius: '50%',
                  background: isCamera ? 'var(--accent-deep)' : 'var(--accent)',
                  border: '2px solid var(--stroke)', boxShadow: 'var(--offset-md)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginTop: -14,
                  transform: camPressed ? 'scale(0.95)' : 'scale(1)',
                  transition: 'all 0.16s cubic-bezier(0.22,1,0.36,1)',
                  color: 'var(--paper)',
                }}>
                  <IcoCamera />
                </div>
              </Link>
            )
          }
          const active = pathname === tab.href
          const c = active ? 'var(--ink)' : 'var(--text-muted)'
          return (
            <Link key={tab.href} href={tab.href} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 4, minWidth: 56, padding: '4px 0',
              color: c, textDecoration: 'none',
              WebkitTapHighlightColor: 'transparent',
              transition: 'color 0.15s',
              position: 'relative',
            }}>
              <tab.Icon active={active} />
              <span style={{
                fontFamily: 'var(--font-sans)', fontSize: 9, fontWeight: active ? 700 : 400,
                letterSpacing: '1px', textTransform: 'uppercase', color: c,
              }}>{tab.label}</span>
              {active && (
                <div style={{
                  position: 'absolute', bottom: -8, width: 20, height: 2,
                  background: 'var(--accent)', borderRadius: 1,
                }} />
              )}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

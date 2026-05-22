'use client'

import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { RealtimeChannel } from '@supabase/supabase-js'

const MapLibreMap = dynamic(() => import('@/components/MapLibreMap'), {
  ssr: false,
  loading: () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#00010a', gap: 16 }}>
      <div style={{ width: 36, height: 36, border: '3px solid rgba(200,90,60,0.3)', borderTopColor: 'var(--accent)' }} className="spin" />
      <div style={{ fontFamily: 'var(--font-hand)', fontSize: 15, color: 'rgba(255,255,255,0.4)' }}>Karte lädt…</div>
    </div>
  ),
})

export interface MapPin {
  id: string; label: string; lat: number; lng: number
  emoji: string; created_by: string; profiles: { display_name: string } | null
}

export interface MemberLocation {
  userId: string; name: string; lat: number; lng: number; at: number
}

const PIN_TYPES = [
  { emoji: '📍', label: 'Treffpunkt' }, { emoji: '⛺', label: 'Zeltplatz' },
  { emoji: '🎵', label: 'Bühne' },      { emoji: '🍺', label: 'Bar' },
  { emoji: '🚗', label: 'Parkplatz' },  { emoji: '🚿', label: 'Dusche' },
  { emoji: '🚽', label: 'Toilette' },   { emoji: '🍔', label: 'Essen' },
  { emoji: '🔥', label: 'Feuer' },      { emoji: '🏥', label: 'Sanitäter' },
]

export default function MapPage() {
  const [pins, setPins]                       = useState<MapPin[]>([])
  const [communityId, setCommunityId]         = useState<string | null>(null)
  const [userId, setUserId]                   = useState<string | null>(null)
  const [adding, setAdding]                   = useState(false)
  const [pendingCoords, setPendingCoords]     = useState<{ lat: number; lng: number } | null>(null)
  const [pinLabel, setPinLabel]               = useState('')
  const [pinEmoji, setPinEmoji]               = useState('📍')
  const [userLocation, setUserLocation]       = useState<{ lat: number; lng: number } | null>(null)
  const [locationOn, setLocationOn]           = useState(false)
  const [showPermDialog, setShowPermDialog]   = useState(false)
  const [memberLocations, setMemberLocations] = useState<MemberLocation[]>([])
  const [showPinList, setShowPinList]         = useState(false)
  const [selectedPin, setSelectedPin]         = useState<MapPin | null>(null)
  const [confirmDelete, setConfirmDelete]     = useState<{ id: string; name: string } | null>(null)
  const [pinSearch, setPinSearch]             = useState('')
  const [flyTarget, setFlyTarget]             = useState<{ lat: number; lng: number; zoom?: number } | null>(null)
  const [members, setMembers]                 = useState<{ id: string; name: string }[]>([])
  const [showFriendList, setShowFriendList]   = useState(false)

  const watchRef    = useRef<number | null>(null)
  const channelRef  = useRef<RealtimeChannel | null>(null)
  const userIdRef   = useRef<string | null>(null)
  const myNameRef   = useRef('')
  const supabase    = createClient()
  const router      = useRouter()

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth'); return }
      userIdRef.current = user.id
      setUserId(user.id)
      const { data: prof } = await supabase.from('profiles').select('current_community_id, display_name').eq('id', user.id).single()
      if (!prof?.current_community_id) { router.push('/onboarding'); return }
      myNameRef.current = prof.display_name || ''
      setCommunityId(prof.current_community_id)
      await loadPins(prof.current_community_id)
      setupPresence(prof.current_community_id, user.id)

      // Load all community members for the friend list
      const { data: mems } = await supabase.from('community_members').select('user_id').eq('community_id', prof.current_community_id)
      if (mems) {
        const memIds = mems.map((m: { user_id: string }) => m.user_id).filter((id: string) => id !== user.id)
        if (memIds.length > 0) {
          const { data: memProfiles } = await supabase.from('profiles').select('id, display_name').in('id', memIds)
          if (memProfiles) setMembers(memProfiles.map((p: { id: string; display_name: string }) => ({ id: p.id, name: p.display_name || 'Unbekannt' })))
        }
      }

      // Check geolocation permission
      if ('permissions' in navigator) {
        const status = await navigator.permissions.query({ name: 'geolocation' })
        if (status.state === 'granted') {
          setLocationOn(true)
          startWatching()
        } else if (status.state === 'prompt') {
          setShowPermDialog(true)
        }
        // 'denied' → do nothing, location stays off
      } else {
        setShowPermDialog(true)
      }
    }
    init()
    return () => {
      if (watchRef.current !== null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, []) // eslint-disable-line

  function setupPresence(cid: string, uid: string) {
    // Remove any stale channel with this name (React StrictMode runs effects twice)
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null }
    const ch = supabase.channel(`loc:${cid}`)
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState()
      const locs: MemberLocation[] = []
      for (const key in state) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const arr = state[key] as any[]
        if (arr.length > 0) {
          const entry = arr[arr.length - 1]
          if (entry.userId !== uid) {
            locs.push({ userId: entry.userId, name: entry.name, lat: entry.lat, lng: entry.lng, at: entry.at })
          }
        }
      }
      setMemberLocations(locs)
    })
    ch.subscribe()
    channelRef.current = ch
  }

  function startWatching() {
    if (!navigator.geolocation) return
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current)
    watchRef.current = navigator.geolocation.watchPosition(
      pos => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setUserLocation(loc)
        channelRef.current?.track({
          userId: userIdRef.current,
          name: myNameRef.current,
          lat: loc.lat,
          lng: loc.lng,
          at: Date.now(),
        })
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10_000 }
    )
  }

  function handleGrantLocation() {
    setShowPermDialog(false)
    setLocationOn(true)
    startWatching()
  }

  function handleDenyLocation() {
    setShowPermDialog(false)
  }

  function toggleLocation() {
    if (locationOn) {
      if (watchRef.current !== null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null }
      try { channelRef.current?.untrack() } catch { /* noop */ }
      setUserLocation(null)
      setLocationOn(false)
    } else {
      setShowPermDialog(true)
    }
  }

  async function loadPins(cid: string) {
    const { data } = await supabase.from('map_pins').select('id, label, lat, lng, emoji, created_by').eq('community_id', cid)
    if (!data) { setPins([]); return }
    const uids = [...new Set(data.map((p: { created_by: string }) => p.created_by))]
    const { data: profs } = await supabase.from('profiles').select('id,display_name').in('id', uids)
    const pm: Record<string, string> = {}
    ;(profs || []).forEach((p: { id: string; display_name: string }) => { pm[p.id] = p.display_name })
    setPins(data.map((p: { id: string; label: string; lat: number; lng: number; emoji: string; created_by: string }) => ({
      ...p, profiles: pm[p.created_by] ? { display_name: pm[p.created_by] } : null,
    })) as MapPin[])
  }

  function handleMapClick(lat: number, lng: number) {
    if (!adding) return
    setPendingCoords({ lat, lng })
  }

  async function savePin() {
    if (!pendingCoords || !pinLabel.trim() || !communityId || !userId) return
    await supabase.from('map_pins').insert({ community_id: communityId, created_by: userId, label: pinLabel.trim(), lat: pendingCoords.lat, lng: pendingCoords.lng, emoji: pinEmoji })
    setPendingCoords(null); setPinLabel(''); setPinEmoji('📍'); setAdding(false)
    await loadPins(communityId)
  }

  async function deletePin(id: string) {
    if (!communityId) return
    await supabase.from('map_pins').delete().eq('id', id)
    setPins(prev => prev.filter(p => p.id !== id))
    setSelectedPin(null)
  }

  const pillStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '9px 16px', borderRadius: 'var(--r-full)',
    background: 'rgba(251,246,236,0.92)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
    border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)',
    cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600, color: 'var(--ink)',
    transition: 'all 0.15s',
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', background: '#00010a' }}>

      {/* Location permission dialog */}
      {showPermDialog && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(30,27,22,0.55)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px' }}>
          <div className="up" style={{ background: 'var(--paper)', borderRadius: 'var(--r-xl)', border: '2px solid var(--stroke)', boxShadow: 'var(--offset-lg)', padding: '28px 24px', width: '100%', maxWidth: 340, textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: 18, background: 'linear-gradient(145deg,var(--sky),#3A6A84)', border: '2px solid var(--stroke)', boxShadow: 'var(--offset-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
              <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
              </svg>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 22, fontWeight: 800, color: 'var(--ink)', marginBottom: 8 }}>Standort teilen?</div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--text-sub)', lineHeight: 1.55, marginBottom: 24 }}>
              Deine Gruppe sieht deinen Live-Standort auf der Karte. Du kannst ihn jederzeit ausschalten.
            </div>
            <button onClick={handleGrantLocation} style={{ width: '100%', background: 'var(--accent)', color: 'var(--paper)', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 17, fontWeight: 700, minHeight: 50, borderRadius: 'var(--r-full)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-md)', cursor: 'pointer', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              Ja, Standort teilen
            </button>
            <button onClick={handleDenyLocation} style={{ width: '100%', height: 44, background: 'none', border: '1.5px solid var(--stroke-hair)', borderRadius: 'var(--r-full)', fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--text-muted)', cursor: 'pointer' }}>
              Nein, danke
            </button>
          </div>
        </div>
      )}

      {/* Pin list sheet */}
      {showPinList && (
        <div onClick={() => { setShowPinList(false); setPinSearch('') }} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(30,27,22,0.5)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} className="up" style={{ background: 'var(--paper)', borderRadius: '24px 24px 0 0', border: '1.5px solid var(--stroke)', borderBottom: 'none', boxShadow: '0 -4px 0 var(--stroke)', maxHeight: '75dvh', display: 'flex', flexDirection: 'column', paddingBottom: 'max(20px, env(safe-area-inset-bottom, 20px))' }}>
            <div style={{ width: 36, height: 4, background: 'var(--stroke-hair)', borderRadius: 2, margin: '12px auto 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px 12px', borderBottom: '1px solid var(--stroke-hair)' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>Pins {pins.length > 0 && `(${pins.length})`}</div>
              <button onClick={() => { setShowPinList(false); setPinSearch('') }} style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700, color: 'var(--accent)', cursor: 'pointer' }}>Fertig</button>
            </div>
            {/* Search */}
            <div style={{ padding: '10px 16px 8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--paper-tint)', borderRadius: 'var(--r-full)', border: '1px solid var(--stroke-hair)', padding: '8px 14px' }}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input value={pinSearch} onChange={e => setPinSearch(e.target.value)} placeholder="Suchen…" style={{ flex: 1, fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--ink)', background: 'transparent' }} />
                {pinSearch && <button onClick={() => setPinSearch('')} style={{ color: 'var(--text-faint)', lineHeight: 1 }}>✕</button>}
              </div>
            </div>
            <div className="scroll" style={{ flex: 1, padding: '4px 16px 0' }}>
              {(() => {
                const filtered = pins.filter(p => !pinSearch || p.label.toLowerCase().includes(pinSearch.toLowerCase()) || (p.profiles?.display_name || '').toLowerCase().includes(pinSearch.toLowerCase()))
                if (filtered.length === 0) return <div style={{ textAlign: 'center', padding: '40px 0', fontFamily: 'var(--font-hand)', fontSize: 16, color: 'var(--text-muted)' }}>{pinSearch ? 'Keine Treffer' : 'Noch keine Pins gesetzt'}</div>
                return (
                  <div style={{ background: 'var(--paper)', border: '1.5px solid var(--stroke)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--offset-sm)', overflow: 'hidden' }}>
                    {filtered.map((pin, idx) => (
                      <div key={pin.id}>
                        {idx > 0 && <div style={{ height: 1, background: 'var(--stroke-hair)' }} />}
                        <div
                          onClick={() => { setShowPinList(false); setPinSearch(''); setFlyTarget({ lat: pin.lat, lng: pin.lng, zoom: 15 }) }}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', gap: 12, cursor: 'pointer' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontSize: 22 }}>{pin.emoji}</span>
                            <div>
                              <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{pin.label}</div>
                              <div style={{ fontFamily: 'var(--font-hand)', fontSize: 13, color: 'var(--text-muted)' }}>{pin.profiles?.display_name || 'Unbekannt'}</div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth={1.8} strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
                            {pin.created_by === userId && (
                              <button onClick={e => { e.stopPropagation(); setConfirmDelete({ id: pin.id, name: pin.label }) }} style={{ padding: 4 }}>
                                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth={1.6} strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4h6v2"/></svg>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Selected pin popup */}
      {selectedPin && (
        <div style={{ position: 'absolute', bottom: 20, left: 16, right: 16, zIndex: 50 }} className="up">
          <div style={{ background: 'var(--paper)', border: '1.5px solid var(--stroke)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--offset-md)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>{selectedPin.emoji}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>{selectedPin.label}</div>
              <div style={{ fontFamily: 'var(--font-hand)', fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{selectedPin.profiles?.display_name || 'Unbekannt'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {selectedPin.created_by === userId && (
                <button onClick={() => setConfirmDelete({ id: selectedPin.id, name: selectedPin.label })} style={{ background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.25)', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600, color: '#FF3B30' }}>Löschen</button>
              )}
              <button onClick={() => setSelectedPin(null)} style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--paper-deep)', border: '1px solid var(--stroke-hair)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pin form sheet */}
      {pendingCoords && (
        <div onClick={() => { setPendingCoords(null); setPinLabel('') }} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(30,27,22,0.5)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} className="up" style={{ background: 'var(--paper)', borderRadius: '24px 24px 0 0', border: '1.5px solid var(--stroke)', borderBottom: 'none', boxShadow: '0 -4px 0 var(--stroke)', padding: '0 20px', paddingBottom: 'max(32px, env(safe-area-inset-bottom, 32px))' }}>
            <div style={{ width: 36, height: 4, background: 'var(--stroke-hair)', borderRadius: 2, margin: '12px auto 16px' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <button onClick={() => { setPendingCoords(null); setPinLabel('') }} style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--text-muted)', cursor: 'pointer' }}>Abbrechen</button>
              <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>Pin setzen</div>
              <button onClick={savePin} disabled={!pinLabel.trim()} style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700, color: !pinLabel.trim() ? 'var(--text-faint)' : 'var(--accent)', cursor: !pinLabel.trim() ? 'not-allowed' : 'pointer' }}>Setzen</button>
            </div>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 14 }}>
              {PIN_TYPES.map(pt => (
                <button key={pt.emoji} onClick={() => { setPinEmoji(pt.emoji); setPinLabel(pt.label) }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 12px', borderRadius: 'var(--r-md)', border: pinEmoji === pt.emoji ? '1.5px solid var(--stroke)' : '1px solid var(--stroke-hair)', cursor: 'pointer', flexShrink: 0, background: pinEmoji === pt.emoji ? 'var(--accent)' : 'var(--paper-tint)', boxShadow: pinEmoji === pt.emoji ? 'var(--offset-sm)' : 'none', transition: 'all 0.15s' }}>
                  <span style={{ fontSize: 20 }}>{pt.emoji}</span>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: pinEmoji === pt.emoji ? 'var(--paper)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>{pt.label}</span>
                </button>
              ))}
            </div>
            <div style={{ background: 'var(--paper-tint)', borderRadius: 'var(--r-md)', border: '1px solid var(--stroke-hair)', padding: '0 16px' }}>
              <div style={{ paddingTop: 10, fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '1.2px' }}>Name</div>
              <input value={pinLabel} onChange={e => setPinLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && savePin()} placeholder="Name des Ortes" autoFocus style={{ width: '100%', fontFamily: 'var(--font-sans)', fontSize: 16, color: 'var(--ink)', paddingBottom: 12, paddingTop: 4, background: 'transparent' }} />
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(30,27,22,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px' }}>
          <div className="up" style={{ background: 'var(--paper)', borderRadius: 'var(--r-xl)', border: '2px solid var(--stroke)', boxShadow: 'var(--offset-lg)', padding: '24px 20px', width: '100%', maxWidth: 320, textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: 16, background: 'rgba(255,59,48,0.1)', border: '1.5px solid rgba(255,59,48,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#FF3B30" strokeWidth={1.8} strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4h6v2"/></svg>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 19, fontWeight: 800, color: 'var(--ink)', marginBottom: 8 }}>Pin löschen?</div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--text-sub)', lineHeight: 1.5, marginBottom: 22 }}>„{confirmDelete.name}" wird unwiderruflich gelöscht.</div>
            <button onClick={() => { deletePin(confirmDelete.id); setConfirmDelete(null) }} style={{ width: '100%', height: 48, background: '#FF3B30', color: 'white', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 16, fontWeight: 700, borderRadius: 'var(--r-full)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', cursor: 'pointer', marginBottom: 8 }}>Löschen</button>
            <button onClick={() => setConfirmDelete(null)} style={{ width: '100%', height: 44, background: 'none', border: '1.5px solid var(--stroke-hair)', borderRadius: 'var(--r-full)', fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--text-muted)', cursor: 'pointer' }}>Abbrechen</button>
          </div>
        </div>
      )}

      {/* Friend list sheet */}
      {showFriendList && (
        <div onClick={() => setShowFriendList(false)} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(30,27,22,0.5)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} className="up" style={{ background: 'var(--paper)', borderRadius: '24px 24px 0 0', border: '1.5px solid var(--stroke)', borderBottom: 'none', boxShadow: '0 -4px 0 var(--stroke)', maxHeight: '70dvh', display: 'flex', flexDirection: 'column', paddingBottom: 'max(20px, env(safe-area-inset-bottom, 20px))' }}>
            <div style={{ width: 36, height: 4, background: 'var(--stroke-hair)', borderRadius: 2, margin: '12px auto 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px 12px', borderBottom: '1px solid var(--stroke-hair)' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>Freunde</div>
              <button onClick={() => setShowFriendList(false)} style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700, color: 'var(--accent)', cursor: 'pointer' }}>Fertig</button>
            </div>
            <div className="scroll" style={{ flex: 1, padding: '10px 16px' }}>
              {members.length === 0 && <div style={{ textAlign: 'center', padding: '40px 0', fontFamily: 'var(--font-hand)', fontSize: 16, color: 'var(--text-muted)' }}>Keine Gruppenmitglieder</div>}
              {members.length > 0 && (
                <div style={{ background: 'var(--paper)', border: '1.5px solid var(--stroke)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--offset-sm)', overflow: 'hidden' }}>
                  {members.map((mem, idx) => {
                    const loc = memberLocations.find(l => l.userId === mem.id)
                    const isLive = loc && (Date.now() - loc.at) < 90_000
                    const canFly = !!loc
                    return (
                      <div key={mem.id}>
                        {idx > 0 && <div style={{ height: 1, background: 'var(--stroke-hair)' }} />}
                        <div
                          onClick={() => { if (canFly && loc) { setShowFriendList(false); setFlyTarget({ lat: loc.lat, lng: loc.lng, zoom: 14 }) } }}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', gap: 12, cursor: canFly ? 'pointer' : 'default', opacity: canFly ? 1 : 0.6 }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--paper-deep)', border: '1.5px solid var(--stroke-hair)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia,serif', fontStyle: 'italic', fontSize: 15, fontWeight: 700, color: 'var(--ink)', flexShrink: 0 }}>{mem.name.charAt(0).toUpperCase()}</div>
                            <div>
                              <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{mem.name}</div>
                              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: isLive ? 700 : 400, color: isLive ? '#34C759' : 'var(--text-faint)' }}>
                                {isLive ? '● live' : loc ? `vor ${Math.floor((Date.now() - loc.at) / 60_000)} Min.` : 'kein Standort'}
                              </div>
                            </div>
                          </div>
                          {canFly && (
                            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth={1.8} strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating top controls */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, paddingTop: 'max(10px, env(safe-area-inset-top, 10px))' }}>
        <div style={{ margin: '0 12px', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowPinList(true)} style={pillStyle}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth={1.8} strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              Pins{pins.length > 0 ? ` (${pins.length})` : ''}
            </button>
            <button onClick={() => setShowFriendList(true)} style={pillStyle}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Freunde{memberLocations.length > 0 ? ` (${memberLocations.length})` : ''}
            </button>
            <button onClick={toggleLocation} style={{ ...pillStyle, background: locationOn && userLocation ? 'rgba(0,122,255,0.15)' : 'rgba(251,246,236,0.92)', borderColor: locationOn && userLocation ? 'rgba(0,122,255,0.4)' : 'var(--stroke)', paddingInline: 12 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: locationOn && userLocation ? '#007AFF' : 'var(--text-faint)', boxShadow: locationOn && userLocation ? '0 0 0 3px rgba(0,122,255,0.2)' : 'none', transition: 'all 0.2s' }} />
              <span style={{ color: locationOn && userLocation ? '#007AFF' : 'var(--text-muted)', fontWeight: 700, fontSize: 13 }}>{locationOn && userLocation ? 'Standort an' : 'Standort aus'}</span>
            </button>
          </div>
          <button onClick={() => { setAdding(!adding); setPendingCoords(null) }} style={{ ...pillStyle, background: adding ? 'var(--accent)' : 'rgba(251,246,236,0.92)', color: adding ? 'var(--paper)' : 'var(--ink)' }}>
            {adding ? (
              <><svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Abbrechen</>
            ) : (
              <><svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Pin</>
            )}
          </button>
        </div>
        {adding && !pendingCoords && (
          <div style={{ margin: '8px 12px 0', textAlign: 'center' }}>
            <div style={{ display: 'inline-block', padding: '7px 16px', background: 'rgba(13,27,42,0.85)', backdropFilter: 'blur(8px)', borderRadius: 'var(--r-full)', fontFamily: 'var(--font-hand)', fontSize: 15, color: 'rgba(251,246,236,0.9)' }}>Auf die Karte tippen</div>
          </div>
        )}
      </div>

      {/* Map */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <MapLibreMap
          pins={pins}
          userLocation={locationOn ? userLocation : null}
          memberLocations={memberLocations}
          onMapClick={handleMapClick}
          addingMode={adding}
          userId={userId}
          onPinClick={pin => { setSelectedPin(pin); setAdding(false) }}
          flyTarget={flyTarget}
        />
      </div>
    </div>
  )
}

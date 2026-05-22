'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import DateTimePicker from '@/components/WheelPicker'

interface CalEvent {
  id: string
  title: string
  description: string | null
  event_date: string
  event_time: string | null
  created_by: string
  profiles: { display_name: string } | null
}

function getWeekDays(base: Date): Date[] {
  const mon = new Date(base)
  mon.setDate(base.getDate() - ((base.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i); return d
  })
}

const DAY_ABBR = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

const MEMBER_PALETTES: { bg: string; fg: string; border: string }[] = [
  { bg: '#F3D9C7', fg: '#6B2A10', border: '#C85A3C' },
  { bg: '#C8D8E8', fg: '#1A3A5C', border: '#6B8FA4' },
  { bg: '#C8E0D0', fg: '#1A4A2C', border: '#4A6A52' },
  { bg: '#E8E0C0', fg: '#5A4410', border: '#D89020' },
  { bg: '#D8C8E0', fg: '#4A1A5C', border: '#7A4A5A' },
  { bg: '#F0C8C8', fg: '#6B1A1A', border: '#D86B75' },
  { bg: '#C8E4E4', fg: '#1A5050', border: '#4A8A8A' },
]
function memberColorFor(uid: string) {
  let h = 5381
  for (let i = 0; i < uid.length; i++) h = (((h << 5) + h) + uid.charCodeAt(i)) >>> 0
  return MEMBER_PALETTES[h % MEMBER_PALETTES.length]
}

function FieldBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--paper-tint)', borderRadius: 'var(--r-md)', border: '1px solid var(--stroke-hair)', padding: '0 16px', marginBottom: 12 }}>
      <div style={{ paddingTop: 10, fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '1.2px' }}>{label}</div>
      {children}
    </div>
  )
}

export default function CalendarPage() {
  const [events, setEvents] = useState<CalEvent[]>([])
  const [communityId, setCommunityId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [weekBase, setWeekBase] = useState(new Date())
  const [form, setForm] = useState({ title: '', description: '', event_date: '', event_time: '' })
  const [currentTime, setCurrentTime] = useState(new Date())
  const [activeEvent, setActiveEvent] = useState<CalEvent | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<CalEvent | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()
  const router = useRouter()

  const today = new Date()
  const HOUR_HEIGHT = 56
  const HOUR_START = 6
  const HOUR_END = 23
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i)

  useEffect(() => {
    const todayStr = localDateStr(new Date())
    setForm(f => ({ ...f, event_date: todayStr }))
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth'); return }
      setUserId(user.id)
      const { data: prof } = await supabase.from('profiles').select('current_community_id').eq('id', user.id).single()
      if (!prof?.current_community_id) { router.push('/onboarding'); return }
      setCommunityId(prof.current_community_id)
      await load(prof.current_community_id)
      setLoading(false)
    }
    init()
  }, [])

  async function load(cid: string) {
    const { data } = await supabase
      .from('calendar_events')
      .select('id, title, description, event_date, event_time, created_by')
      .eq('community_id', cid)
      .order('event_date').order('event_time', { nullsFirst: true })
    if (!data) { setEvents([]); return }
    const uids = [...new Set(data.map((e: { created_by: string }) => e.created_by))]
    const { data: profs } = await supabase.from('profiles').select('id,display_name').in('id', uids)
    const pm: Record<string, string> = {}
    ;(profs || []).forEach((p: { id: string; display_name: string }) => { pm[p.id] = p.display_name })
    setEvents(data.map((e: Omit<CalEvent, 'profiles'> & { created_by: string }) => ({ ...e, profiles: pm[e.created_by] ? { display_name: pm[e.created_by] } : null })) as CalEvent[])
  }

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (loading || !gridRef.current) return
    const scrollTo = Math.max(0, (new Date().getHours() - HOUR_START - 2) * HOUR_HEIGHT)
    gridRef.current.scrollTop = scrollTo
  }, [loading])

  async function save() {
    if (!form.title.trim() || !form.event_date || !communityId || !userId) return
    setSaving(true)
    if (editingId) {
      await supabase.from('calendar_events').update({
        title: form.title.trim(),
        description: form.description.trim() || null,
        event_date: form.event_date,
        event_time: form.event_time || null,
      }).eq('id', editingId)
      setEditingId(null)
    } else {
      await supabase.from('calendar_events').insert({
        community_id: communityId, created_by: userId,
        title: form.title.trim(),
        description: form.description.trim() || null,
        event_date: form.event_date,
        event_time: form.event_time || null,
      })
    }
    setForm({ title: '', description: '', event_date: localDateStr(new Date()), event_time: '' })
    setShowForm(false)
    await load(communityId)
    setSaving(false)
  }

  async function del(id: string) {
    if (!communityId) return
    await supabase.from('calendar_events').delete().eq('id', id)
    setEvents(prev => prev.filter(e => e.id !== id))
  }

  const weekDays = getWeekDays(weekBase)
  const selectedStr = localDateStr(selectedDate)
  const monthLabel = weekDays[0].toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
  const nowH = currentTime.getHours(); const nowM = currentTime.getMinutes()
  const currentTimeTop = (nowH >= HOUR_START && nowH < HOUR_END) ? (nowH - HOUR_START + nowM / 60) * HOUR_HEIGHT : -1

  function prevWeek() { const d = new Date(weekBase); d.setDate(d.getDate() - 7); setWeekBase(d) }
  function nextWeek() { const d = new Date(weekBase); d.setDate(d.getDate() + 7); setWeekBase(d) }
  function isToday(d: Date) { return localDateStr(d) === localDateStr(today) }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--paper-tint)' }}>

      {/* Event form sheet */}
      {showForm && (
        <div onClick={() => { setShowForm(false); setEditingId(null) }} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(30,27,22,0.45)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} className="up" style={{ background: 'var(--paper)', borderRadius: '24px 24px 0 0', border: '1.5px solid var(--stroke)', borderBottom: 'none', boxShadow: '0 -4px 0 var(--stroke)', padding: '0 20px', paddingBottom: 'max(32px, env(safe-area-inset-bottom, 32px))' }}>
            <div style={{ width: 36, height: 4, background: 'var(--stroke-hair)', borderRadius: 2, margin: '12px auto 16px' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <button onClick={() => { setShowForm(false); setEditingId(null) }} style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--text-muted)', cursor: 'pointer' }}>Abbrechen</button>
              <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>{editingId ? 'Termin bearbeiten' : 'Neuer Termin'}</div>
              <button onClick={save} disabled={saving || !form.title.trim() || !form.event_date} style={{ fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 700, color: (!form.title.trim() || saving) ? 'var(--text-faint)' : 'var(--accent)', cursor: !form.title.trim() ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Speichern…' : editingId ? 'Speichern' : 'Hinzufügen'}
              </button>
            </div>

            <FieldBox label="Titel">
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} onKeyDown={e => e.key === 'Enter' && save()} placeholder="Was ist geplant?" autoFocus style={{ width: '100%', fontFamily: 'var(--font-sans)', fontSize: 16, color: 'var(--ink)', paddingBottom: 12, paddingTop: 4, background: 'transparent' }} />
            </FieldBox>

            <FieldBox label="Notiz">
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Optional…" rows={2} style={{ width: '100%', fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--ink)', paddingBottom: 12, paddingTop: 4, background: 'transparent', resize: 'none' }} />
            </FieldBox>

            <DateTimePicker
              date={form.event_date}
              time={form.event_time}
              onDateChange={d => setForm(f => ({ ...f, event_date: d }))}
              onTimeChange={t => setForm(f => ({ ...f, event_time: t }))}
              showTime={true}
            />
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ background: 'var(--paper)', borderBottom: '1px solid var(--stroke-hair)', paddingTop: 'max(14px, env(safe-area-inset-top, 14px))', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px 10px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 22, fontWeight: 800, color: 'var(--ink)' }}>Kalender</div>
          <button onClick={() => { setForm(f => ({ ...f, event_date: selectedStr })); setShowForm(true) }} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--accent)', color: 'var(--paper)', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, height: 32, paddingInline: 12, borderRadius: 'var(--r-full)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', cursor: 'pointer' }}>
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Termin
          </button>
        </div>

        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 8px' }}>
          <button onClick={prevWeek} style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: 'var(--paper-deep)', border: '1px solid var(--stroke-hair)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{monthLabel}</div>
          <button onClick={nextWeek} style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: 'var(--paper-deep)', border: '1px solid var(--stroke-hair)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>

        {/* Week strip */}
        <div style={{ display: 'grid', gridTemplateColumns: '44px repeat(7, 1fr)', padding: '0 8px 12px' }}>
          <div />
          {weekDays.map((d, i) => {
            const dStr = localDateStr(d)
            const isSelected = dStr === selectedStr
            const isTod = isToday(d)
            const hasEvent = events.some(e => e.event_date === dStr)
            return (
              <button key={i} onClick={() => setSelectedDate(d)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '7px 2px', border: 'none', borderRadius: 12, cursor: 'pointer', background: isSelected ? 'var(--accent)' : isTod ? 'var(--accent-wash)' : 'transparent', boxShadow: isSelected ? 'var(--offset-sm)' : 'none', transition: 'all 0.15s' }}>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: isSelected ? 'rgba(251,246,236,0.75)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{DAY_ABBR[i]}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 16, fontWeight: 800, color: isSelected ? 'var(--paper)' : isTod ? 'var(--accent)' : 'var(--ink)', lineHeight: 1 }}>{d.getDate()}</span>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: hasEvent ? (isSelected ? 'var(--paper)' : 'var(--accent)') : 'transparent' }} />
              </button>
            )
          })}
        </div>
      </div>

      {/* Week grid */}
      <div ref={gridRef} className="scroll" style={{ flex: 1 }}>
        {loading ? (
          <div style={{ display: 'flex', gap: 4, padding: '8px' }}>
            {[1,2,3,4,5,6,7].map(i => <div key={i} className="skel" style={{ flex: 1, height: 300, borderRadius: 8 }} />)}
          </div>
        ) : (
          <div style={{ display: 'flex', minHeight: `${(HOUR_END - HOUR_START) * HOUR_HEIGHT}px` }}>
            {/* Time column */}
            <div style={{ width: 44, flexShrink: 0 }}>
              {hours.map(h => (
                <div key={h} style={{ height: HOUR_HEIGHT, display: 'flex', alignItems: 'flex-start', paddingTop: 3, justifyContent: 'flex-end', paddingRight: 8 }}>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: 'var(--text-faint)' }}>
                    {String(h).padStart(2, '0')}:00
                  </span>
                </div>
              ))}
            </div>

            {/* Day columns */}
            <div style={{ flex: 1, display: 'flex', position: 'relative' }}>
              {weekDays.map((d, di) => {
                const dStr = localDateStr(d)
                const isSelected = dStr === selectedStr
                const isTod = isToday(d)
                const dayEvts = events.filter(e => e.event_date === dStr && e.event_time)
                const allDayEvts = events.filter(e => e.event_date === dStr && !e.event_time)

                return (
                  <div
                    key={di}
                    onClick={() => { setSelectedDate(d); setForm(f => ({ ...f, event_date: localDateStr(d) })) }}
                    style={{ flex: 1, position: 'relative', borderLeft: '1px solid var(--stroke-hair)', background: isTod ? 'rgba(200,90,60,0.03)' : isSelected ? 'rgba(200,90,60,0.015)' : 'transparent', cursor: 'pointer' }}
                  >
                    {hours.map(h => (
                      <div key={h} style={{ height: HOUR_HEIGHT, borderTop: '1px solid var(--f3)' }} />
                    ))}

                    {/* All-day events */}
                    {allDayEvts.map((ev, ai) => {
                      const pal = memberColorFor(ev.created_by)
                      return (
                        <div
                          key={ev.id}
                          onClick={e => { e.stopPropagation(); setActiveEvent(ev) }}
                          style={{ position: 'absolute', top: 4 + ai * 20, left: 1, right: 1, background: pal.bg, color: pal.fg, borderRadius: 4, padding: '2px 4px', fontSize: 9, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', zIndex: 2, cursor: 'pointer', border: `1px solid ${pal.border}` }}
                        >
                          {ev.title}
                        </div>
                      )
                    })}

                    {/* Timed events */}
                    {dayEvts.map(ev => {
                      const [eh, em] = (ev.event_time || '00:00').split(':').map(Number)
                      const top = (eh - HOUR_START + em / 60) * HOUR_HEIGHT
                      const pal = memberColorFor(ev.created_by)
                      return (
                        <div
                          key={ev.id}
                          onClick={e => { e.stopPropagation(); setActiveEvent(ev) }}
                          style={{ position: 'absolute', top: top + 1, left: 1, right: 1, background: pal.bg, color: pal.fg, borderRadius: 5, padding: '3px 5px', fontSize: 10, fontWeight: 700, lineHeight: 1.25, border: `1px solid ${pal.border}`, overflow: 'hidden', zIndex: 2, minHeight: 22, boxShadow: 'var(--offset-sm)', cursor: 'pointer' }}
                        >
                          <div style={{ opacity: 0.65, fontSize: 9 }}>{ev.event_time?.slice(0, 5)}</div>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</div>
                          {ev.profiles?.display_name && <div style={{ fontSize: 8, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.profiles.display_name}</div>}
                        </div>
                      )
                    })}

                    {/* Red current time line — only on today */}
                    {isTod && currentTimeTop >= 0 && (
                      <div style={{ position: 'absolute', top: currentTimeTop, left: 0, right: 0, height: 2, background: '#FF3B30', zIndex: 5, pointerEvents: 'none' }}>
                        <div style={{ position: 'absolute', left: -4, top: -3, width: 8, height: 8, borderRadius: '50%', background: '#FF3B30' }} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <div style={{ height: 20 }} />
      </div>

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(30,27,22,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px' }}>
          <div className="up" style={{ background: 'var(--paper)', borderRadius: 'var(--r-xl)', border: '2px solid var(--stroke)', boxShadow: 'var(--offset-lg)', padding: '24px 20px', width: '100%', maxWidth: 320, textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: 16, background: 'rgba(255,59,48,0.1)', border: '1.5px solid rgba(255,59,48,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#FF3B30" strokeWidth={1.8} strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4h6v2"/></svg>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 19, fontWeight: 800, color: 'var(--ink)', marginBottom: 8 }}>Termin löschen?</div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--text-sub)', lineHeight: 1.5, marginBottom: 22 }}>„{confirmDelete.title}" wird unwiderruflich gelöscht.</div>
            <button onClick={() => { del(confirmDelete.id); setActiveEvent(null); setConfirmDelete(null) }} style={{ width: '100%', height: 48, background: '#FF3B30', color: 'white', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 16, fontWeight: 700, borderRadius: 'var(--r-full)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', cursor: 'pointer', marginBottom: 8 }}>Löschen</button>
            <button onClick={() => setConfirmDelete(null)} style={{ width: '100%', height: 44, background: 'none', border: '1.5px solid var(--stroke-hair)', borderRadius: 'var(--r-full)', fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--text-muted)', cursor: 'pointer' }}>Abbrechen</button>
          </div>
        </div>
      )}

      {/* Event detail sheet */}
      {activeEvent && (
        <div onClick={() => setActiveEvent(null)} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(30,27,22,0.45)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} className="up" style={{ background: 'var(--paper)', borderRadius: '24px 24px 0 0', border: '1.5px solid var(--stroke)', borderBottom: 'none', padding: '0 20px', paddingBottom: 'max(32px, env(safe-area-inset-bottom, 32px))' }}>
            <div style={{ width: 36, height: 4, background: 'var(--stroke-hair)', borderRadius: 2, margin: '12px auto 20px' }} />
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 20, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>{activeEvent.title}</div>
              {activeEvent.event_time && <div style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--accent)', fontWeight: 700 }}>{activeEvent.event_time.slice(0, 5)} Uhr · {new Date(activeEvent.event_date + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</div>}
              {!activeEvent.event_time && <div style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--text-sub)' }}>{new Date(activeEvent.event_date + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</div>}
              {activeEvent.description && <div style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--text-sub)', marginTop: 6 }}>{activeEvent.description}</div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: memberColorFor(activeEvent.created_by).border, flexShrink: 0 }} />
                <div style={{ fontFamily: 'var(--font-hand)', fontSize: 13, color: 'var(--text-muted)' }}>von {activeEvent.profiles?.display_name || 'Unbekannt'}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
              {activeEvent.created_by === userId && (
                <button onClick={() => {
                  setForm({ title: activeEvent.title, description: activeEvent.description || '', event_date: activeEvent.event_date, event_time: activeEvent.event_time || '' })
                  setEditingId(activeEvent.id)
                  setActiveEvent(null)
                  setShowForm(true)
                }} style={{ flex: 1, height: 50, background: 'var(--paper-deep)', border: '1.5px solid var(--stroke)', borderRadius: 'var(--r-full)', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 16, fontWeight: 700, color: 'var(--ink)', cursor: 'pointer' }}>Bearbeiten</button>
              )}
              <button onClick={() => setConfirmDelete(activeEvent)} style={{ flex: 1, height: 50, background: 'rgba(255,59,48,0.08)', border: '1.5px solid rgba(255,59,48,0.3)', borderRadius: 'var(--r-full)', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 16, fontWeight: 700, color: '#FF3B30', cursor: 'pointer' }}>Löschen</button>
            </div>
            <button onClick={() => setActiveEvent(null)} style={{ width: '100%', height: 48, background: 'none', border: '1.5px solid var(--stroke-hair)', borderRadius: 'var(--r-full)', fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--text-muted)', cursor: 'pointer' }}>Schließen</button>
          </div>
        </div>
      )}
    </div>
  )
}

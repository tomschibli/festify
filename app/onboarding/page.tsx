'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

const fieldBox: React.CSSProperties = {
  background: 'var(--paper-tint)', borderRadius: 'var(--r-md)',
  border: '1px solid var(--stroke-hair)', padding: '0 16px', marginBottom: 14,
}
const fieldLabel: React.CSSProperties = {
  paddingTop: 10, fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700,
  color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '1.2px',
}
const fieldInput: React.CSSProperties = {
  width: '100%', fontFamily: 'var(--font-sans)', fontSize: 16,
  color: 'var(--ink)', paddingBottom: 12, paddingTop: 4, background: 'transparent',
}

function PrimaryBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '100%', background: disabled ? 'var(--text-faint)' : 'var(--accent)',
      color: 'var(--paper)', fontFamily: 'var(--font-display)', fontStyle: 'italic',
      fontSize: 18, fontWeight: 700, minHeight: 54, borderRadius: 'var(--r-full)',
      border: '1.5px solid var(--stroke)', boxShadow: disabled ? 'none' : 'var(--offset-md)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.12s',
    }}>
      {children}
    </button>
  )
}

export default function OnboardingPage() {
  const [view, setView]           = useState<'choose' | 'create' | 'join' | 'code'>('choose')
  const [communityName, setCommunityName] = useState('')
  const [joinCode, setJoinCode]   = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [checking, setChecking]   = useState(true)
  const [createdCode, setCreatedCode] = useState('')
  const [codeCopied, setCodeCopied]   = useState(false)
  const router   = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth'); return }
      const { data: prof } = await supabase.from('profiles').select('current_community_id').eq('id', user.id).single()
      if (prof?.current_community_id) router.push('/chat')
      else setChecking(false)
    }
    check()
  }, [])

  async function handleCreate() {
    if (!communityName.trim()) return
    setLoading(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth'); return }
    let code = generateCode()
    for (let i = 0; i < 10; i++) {
      const { data: ex } = await supabase.from('communities').select('id').eq('invite_code', code).single()
      if (!ex) break
      code = generateCode()
    }
    const { data: community, error: err } = await supabase
      .from('communities').insert({ name: communityName.trim(), invite_code: code, created_by: user.id })
      .select().single()
    if (err || !community) { setError(err?.message || 'Fehler beim Erstellen'); setLoading(false); return }
    await supabase.from('community_members').insert({ community_id: community.id, user_id: user.id, role: 'admin' })
    const { data: prof } = await supabase.from('profiles').select('display_name').eq('id', user.id).single()
    await supabase.from('profiles').upsert({ id: user.id, display_name: prof?.display_name || 'User', current_community_id: community.id })
    setCreatedCode(code)
    setView('code')
    setLoading(false)
  }

  async function handleJoin() {
    const code = joinCode.trim().toUpperCase()
    if (code.length !== 6) { setError('Bitte einen 6-stelligen Code eingeben.'); return }
    setLoading(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth'); return }
    const { data: community } = await supabase.from('communities').select('id, name').eq('invite_code', code).single()
    if (!community) { setError('Code nicht gefunden.'); setLoading(false); return }
    const { data: existing } = await supabase.from('community_members').select('id').eq('community_id', community.id).eq('user_id', user.id).single()
    if (!existing) {
      const { error: joinErr } = await supabase.from('community_members').insert({ community_id: community.id, user_id: user.id, role: 'member' })
      if (joinErr) { setError(joinErr.message); setLoading(false); return }
    }
    const { data: prof } = await supabase.from('profiles').select('display_name').eq('id', user.id).single()
    await supabase.from('profiles').upsert({ id: user.id, display_name: prof?.display_name || 'User', current_community_id: community.id })
    router.push('/chat')
  }

  const base: React.CSSProperties = {
    height: '100dvh', background: 'var(--paper)',
    display: 'flex', flexDirection: 'column', padding: '90px 22px 40px',
    backgroundImage: 'radial-gradient(circle at 80% 10%,rgba(200,90,60,0.06) 0%,transparent 50%)',
  }

  if (checking) return (
    <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--paper-tint)' }}>
      <div style={{ width: 28, height: 28, border: '2.5px solid var(--paper-deep)', borderTopColor: 'var(--accent)' }} className="spin" />
    </div>
  )

  if (view === 'code') return (
    <div style={{ ...base, alignItems: 'center', justifyContent: 'center', padding: '62px 28px 40px' }}>
      <div className="up" style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ width: 72, height: 72, borderRadius: 22, background: 'linear-gradient(145deg,var(--sage-soft),var(--sage))', border: '2px solid var(--stroke)', boxShadow: 'var(--offset-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="var(--paper)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 24, fontWeight: 800, color: 'var(--ink)', marginBottom: 6 }}>Gruppe erstellt!</div>
          <div style={{ fontFamily: 'var(--font-hand)', fontSize: 16, color: 'var(--text-sub)' }}>Teile diesen Code mit deiner Gruppe.</div>
        </div>
        <div style={{ background: 'var(--paper)', borderRadius: 'var(--r-lg)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-md)', padding: '20px 32px', textAlign: 'center', marginBottom: 12 }}>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.3px', marginBottom: 10 }}>Einladungscode</div>
          <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 38, fontWeight: 800, letterSpacing: 10, color: 'var(--accent)' }}>{createdCode}</div>
        </div>
        <button onClick={() => { navigator.clipboard?.writeText(createdCode); setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000) }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', background: 'var(--paper-deep)', color: codeCopied ? 'var(--sage)' : 'var(--accent)', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, height: 40, borderRadius: 'var(--r-full)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', marginBottom: 12, transition: 'all 0.2s', cursor: 'pointer' }}>
          {codeCopied ? 'Kopiert!' : 'Code kopieren'}
        </button>
        <PrimaryBtn onClick={() => router.push('/chat')}>Los geht&apos;s</PrimaryBtn>
      </div>
    </div>
  )

  if (view === 'create') return (
    <div style={base} className="up">
      <button onClick={() => { setView('choose'); setError('') }} style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--accent)', fontWeight: 500, textAlign: 'left', marginBottom: 20, cursor: 'pointer' }}>← Zurück</button>
      <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 24, fontWeight: 800, color: 'var(--ink)', marginBottom: 20 }}>Neue Gruppe</div>
      <div style={fieldBox}>
        <div style={fieldLabel}>Gruppenname</div>
        <input value={communityName} onChange={e => setCommunityName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreate()} placeholder="z.B. Fusion 2025" autoFocus style={fieldInput} />
      </div>
      {error && <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}
      <PrimaryBtn onClick={handleCreate} disabled={loading || communityName.trim().length < 2}>
        {loading ? <div style={{ width: 20, height: 20, border: '2px solid rgba(251,246,236,0.35)', borderTopColor: 'var(--paper)' }} className="spin" /> : 'Erstellen'}
      </PrimaryBtn>
    </div>
  )

  if (view === 'join') return (
    <div style={base} className="up">
      <button onClick={() => { setView('choose'); setError('') }} style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--accent)', fontWeight: 500, textAlign: 'left', marginBottom: 20, cursor: 'pointer' }}>← Zurück</button>
      <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 24, fontWeight: 800, color: 'var(--ink)', marginBottom: 20 }}>Beitreten</div>
      <div style={{ ...fieldBox, textAlign: 'center', padding: '20px 16px' }}>
        <div style={fieldLabel}>Einladungscode</div>
        <input
          value={joinCode.toUpperCase()} maxLength={6} autoFocus
          onChange={e => setJoinCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 6))}
          onKeyDown={e => e.key === 'Enter' && handleJoin()} placeholder="XXXXXX"
          style={{ ...fieldInput, textAlign: 'center', fontSize: 32, fontWeight: 800, letterSpacing: 10, color: 'var(--accent)', fontFamily: 'var(--font-display)', fontStyle: 'italic' }}
        />
        <div style={{ fontFamily: 'var(--font-hand)', fontSize: 14, color: 'var(--text-faint)', marginTop: 4 }}>{joinCode.length} / 6</div>
      </div>
      {error && <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}
      <PrimaryBtn onClick={handleJoin} disabled={loading || joinCode.length !== 6}>
        {loading ? <div style={{ width: 20, height: 20, border: '2px solid rgba(251,246,236,0.35)', borderTopColor: 'var(--paper)' }} className="spin" /> : 'Beitreten'}
      </PrimaryBtn>
    </div>
  )

  /* choose */
  return (
    <div style={base} className="up">
      <div style={{ fontFamily: 'var(--font-hand)', fontSize: 15, color: 'var(--accent)' }}>hallo,</div>
      <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 26, fontWeight: 800, color: 'var(--ink)', marginBottom: 28, lineHeight: 1.1 }}>Wo willst du starten?</div>
      <div style={{ background: 'var(--paper)', border: '1.5px solid var(--stroke)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--offset-md)', overflow: 'hidden' }}>
        {[
          { l: 'Gruppe erstellen', s: 'Neues Festival-Event anlegen', ic: 'var(--accent)', action: () => setView('create') },
          { l: 'Gruppe beitreten', s: 'Mit Einladungscode beitreten', ic: 'var(--sage)', action: () => setView('join') },
        ].map((r, i) => (
          <button key={r.l} onClick={r.action} style={{ width: '100%', display: 'flex', alignItems: 'center', padding: '14px 18px', gap: 14, minHeight: 54, borderTop: i === 0 ? 'none' : '1px solid var(--stroke-hair)', cursor: 'pointer', textAlign: 'left', background: 'transparent' }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: `${r.ic}18`, border: `1px solid ${r.ic}44`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={r.ic} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                {i === 0 ? <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></> : <><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></>}
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{r.l}</div>
              <div style={{ fontFamily: 'var(--font-hand)', fontSize: 13, color: 'var(--text-muted)', marginTop: 1 }}>{r.s}</div>
            </div>
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--stroke-hair)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        ))}
      </div>
    </div>
  )
}

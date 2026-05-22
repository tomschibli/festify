'use client'

import { useState, useRef, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function AuthPage() {
  const [step, setStep]       = useState<'credentials' | 'otp'>('credentials')
  const [name, setName]       = useState('')
  const [email, setEmail]     = useState('')
  const [code, setCode]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [cooldown, setCooldown] = useState(0)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const codeRef     = useRef<HTMLInputElement>(null)
  const router   = useRouter()
  const supabase = createClient()

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const nameOk  = name.trim().length >= 2
  const codeOk  = code.length === 8

  useEffect(() => () => { if (cooldownRef.current) clearInterval(cooldownRef.current) }, [])

  function startCooldown() {
    setCooldown(60)
    cooldownRef.current = setInterval(() => {
      setCooldown(c => {
        if (c <= 1) { clearInterval(cooldownRef.current!); cooldownRef.current = null; return 0 }
        return c - 1
      })
    }, 1000)
  }

  async function sendOtp() {
    if (!nameOk || !emailOk) return
    setLoading(true); setError('')
    const { error: e } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true },
    })
    if (e) {
      setError(e.message.includes('rate') ? 'Zu viele Anfragen. Bitte kurz warten.' : e.message)
      setLoading(false); return
    }
    setLoading(false)
    setStep('otp')
    startCooldown()
    setTimeout(() => codeRef.current?.focus(), 100)
  }

  async function verifyOtp() {
    if (!codeOk) return
    setLoading(true); setError('')
    const { data, error: e } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code,
      type: 'email',
    })
    if (e || !data.user) {
      setError('Code falsch oder abgelaufen. Bitte neu anfordern.')
      setLoading(false); return
    }
    const { data: existing } = await supabase.from('profiles').select('display_name').eq('id', data.user.id).single()
    await supabase.from('profiles').upsert({
      id: data.user.id,
      display_name: existing?.display_name || name.trim(),
    })
    router.push('/onboarding')
  }

  const bg: React.CSSProperties = {
    height: '100dvh', background: 'var(--paper)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '62px 28px 40px',
    backgroundImage: 'radial-gradient(circle at 70% 20%,rgba(200,90,60,0.07) 0%,transparent 50%),radial-gradient(circle at 20% 80%,rgba(74,106,82,0.06) 0%,transparent 50%)',
  }

  if (step === 'credentials') return (
    <div style={bg}>
      <div className="up" style={{ width: '100%', maxWidth: 360 }}>

        {/* Logo */}
        <div style={{ marginBottom: 40, textAlign: 'center' }}>
          <div style={{ width: 80, height: 80, borderRadius: 24, background: 'linear-gradient(145deg,var(--accent-soft),var(--accent))', border: '2px solid var(--stroke)', boxShadow: 'var(--offset-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <svg width={38} height={38} viewBox="0 0 24 24" fill="none" stroke="var(--paper)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <div style={{ fontFamily: 'var(--font-hand)', fontSize: 16, color: 'var(--accent)', marginBottom: 4 }}>say hi to your people,</div>
          <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 36, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.5px', marginBottom: 6 }}>Festify</div>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--text-sub)', lineHeight: 1.55 }}>
            Deine Festival-Gruppe an einem Ort.
          </div>
        </div>

        {/* Name */}
        <div style={{ background: 'var(--paper)', borderRadius: 'var(--r-lg)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', padding: '0 18px', marginBottom: 10 }}>
          <div style={{ paddingTop: 12, fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '1.3px' }}>Dein Name</div>
          <input
            type="text" value={name} autoFocus maxLength={30}
            onChange={e => { setName(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && nameOk && emailOk && sendOtp()}
            placeholder="z.B. Lena"
            style={{ width: '100%', fontFamily: 'var(--font-sans)', fontSize: 17, fontWeight: 500, color: 'var(--ink)', paddingBottom: 14, paddingTop: 4, background: 'transparent' }}
          />
        </div>

        {/* Email */}
        <div style={{ background: 'var(--paper)', borderRadius: 'var(--r-lg)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', padding: '0 18px', marginBottom: 14 }}>
          <div style={{ paddingTop: 12, fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '1.3px' }}>E-Mail-Adresse</div>
          <input
            type="email" value={email} inputMode="email" autoComplete="email"
            onChange={e => { setEmail(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && nameOk && emailOk && sendOtp()}
            placeholder="lena@example.com"
            style={{ width: '100%', fontFamily: 'var(--font-sans)', fontSize: 17, fontWeight: 500, color: 'var(--ink)', paddingBottom: 14, paddingTop: 4, background: 'transparent' }}
          />
        </div>

        {error && <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 12, paddingLeft: 4 }}>{error}</div>}

        <button
          onClick={sendOtp} disabled={loading || !nameOk || !emailOk}
          style={{ width: '100%', background: (loading || !nameOk || !emailOk) ? 'var(--text-faint)' : 'var(--accent)', color: 'var(--paper)', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 18, fontWeight: 700, minHeight: 54, borderRadius: 'var(--r-full)', border: '1.5px solid var(--stroke)', boxShadow: (loading || !nameOk || !emailOk) ? 'none' : 'var(--offset-md)', cursor: (loading || !nameOk || !emailOk) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.12s' }}
        >
          {loading
            ? <div style={{ width: 20, height: 20, border: '2.5px solid rgba(251,246,236,0.35)', borderTopColor: 'var(--paper)' }} className="spin" />
            : 'Code senden →'}
        </button>

        <div style={{ fontFamily: 'var(--font-hand)', fontSize: 15, color: 'var(--text-faint)', marginTop: 28, textAlign: 'center' }}>
          Kein Passwort · Gleicher Account per E-Mail
        </div>
      </div>
    </div>
  )

  /* ── OTP step ── */
  return (
    <div style={bg}>
      <div className="up" style={{ width: '100%', maxWidth: 360 }}>

        <button onClick={() => { setStep('credentials'); setCode(''); setError('') }}
          style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--accent)', fontWeight: 500, marginBottom: 28, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          Zurück
        </button>

        <div style={{ marginBottom: 32 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 28, fontWeight: 800, color: 'var(--ink)', marginBottom: 10, lineHeight: 1.1 }}>Code eingeben</div>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--text-sub)', lineHeight: 1.55 }}>
            Wir haben einen 6-stelligen Code an
          </div>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{email}</div>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--text-sub)' }}>gesendet.</div>
        </div>

        {/* Code box */}
        <div style={{ background: 'var(--paper)', borderRadius: 'var(--r-lg)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-md)', padding: '0 18px', marginBottom: 14, textAlign: 'center' }}>
          <div style={{ paddingTop: 12, fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '1.3px', marginBottom: 4 }}>Anmeldecode</div>
          <input
            ref={codeRef}
            type="text" inputMode="numeric" pattern="[0-9]*" maxLength={8}
            value={code}
            onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 8)); setError('') }}
            onKeyDown={e => e.key === 'Enter' && codeOk && verifyOtp()}
            placeholder="00000000"
            style={{ width: '100%', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 38, fontWeight: 800, color: code.length === 8 ? 'var(--accent)' : 'var(--ink)', textAlign: 'center', letterSpacing: '0.28em', paddingBottom: 16, background: 'transparent' }}
          />
        </div>

        {error && <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 12, paddingLeft: 4 }}>{error}</div>}

        <button
          onClick={verifyOtp} disabled={loading || !codeOk}
          style={{ width: '100%', background: (loading || !codeOk) ? 'var(--text-faint)' : 'var(--accent)', color: 'var(--paper)', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 18, fontWeight: 700, minHeight: 54, borderRadius: 'var(--r-full)', border: '1.5px solid var(--stroke)', boxShadow: (loading || !codeOk) ? 'none' : 'var(--offset-md)', cursor: (loading || !codeOk) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.12s' }}
        >
          {loading
            ? <div style={{ width: 20, height: 20, border: '2.5px solid rgba(251,246,236,0.35)', borderTopColor: 'var(--paper)' }} className="spin" />
            : 'Anmelden'}
        </button>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <button
            onClick={() => { if (cooldown > 0) return; setCode(''); setError(''); sendOtp() }}
            style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: cooldown > 0 ? 'var(--text-faint)' : 'var(--accent)', fontWeight: 500, cursor: cooldown > 0 ? 'not-allowed' : 'pointer' }}
          >
            {cooldown > 0 ? `Code neu senden (${cooldown}s)` : 'Code neu senden'}
          </button>
        </div>

        <div style={{ fontFamily: 'var(--font-hand)', fontSize: 14, color: 'var(--text-faint)', marginTop: 24, textAlign: 'center' }}>
          Gleiche E-Mail = gleicher Account · Immer
        </div>
      </div>
    </div>
  )
}

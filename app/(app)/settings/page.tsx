'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const PI_GRADIENTS: Record<string, [string, string]> = {
  A: ['#C85A3C', '#E89A6F'], B: ['#4A6A52', '#7A9E82'], C: ['#D89020', '#EDB84A'],
  D: ['#6B8FA4', '#9BB5C8'], E: ['#7A4A5A', '#AA7A8A'], F: ['#A4462E', '#C87A5A'],
  G: ['#3A5A42', '#6A8A72'], H: ['#B87820', '#D8A84A'],
}
function avatarGrad(name: string) {
  const key = String.fromCharCode(65 + (name.charCodeAt(0) % 8)) as keyof typeof PI_GRADIENTS
  return PI_GRADIENTS[key] || PI_GRADIENTS.A
}

interface Member {
  user_id: string
  profiles: { display_name: string } | null
}

export default function SettingsPage() {
  const [displayName, setDisplayName] = useState('')
  const [community, setCommunity] = useState<{ name: string; invite_code: string } | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [communityId, setCommunityId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth'); return }
      setUserId(user.id)
      const { data: prof } = await supabase.from('profiles').select('display_name, current_community_id').eq('id', user.id).single()
      setDisplayName(prof?.display_name || '')
      if (prof?.current_community_id) {
        setCommunityId(prof.current_community_id)
        const { data: comm } = await supabase.from('communities').select('name, invite_code').eq('id', prof.current_community_id).single()
        setCommunity(comm)
        const { data: mems } = await supabase
          .from('community_members')
          .select('user_id')
          .eq('community_id', prof.current_community_id)
        if (mems && mems.length > 0) {
          const uids = mems.map((m: { user_id: string }) => m.user_id)
          const { data: memberProfs } = await supabase.from('profiles').select('id,display_name').in('id', uids)
          const pm: Record<string, string> = {}
          ;(memberProfs || []).forEach((p: { id: string; display_name: string }) => { pm[p.id] = p.display_name })
          setMembers(mems.map((m: { user_id: string }) => ({
            user_id: m.user_id,
            profiles: pm[m.user_id] ? { display_name: pm[m.user_id] } : null,
          })))
        } else {
          setMembers([])
        }
      }
      setLoading(false)
    }
    init()
  }, [])

  async function copyCode() {
    if (!community?.invite_code) return
    await navigator.clipboard?.writeText(community.invite_code)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  async function switchCommunity() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !communityId) return
    await supabase.from('chat_messages').insert({ community_id: communityId, user_id: user.id, content: `__LEFT__:${displayName}` })
    await supabase.from('community_members').delete().eq('community_id', communityId).eq('user_id', user.id)
    await supabase.from('profiles').update({ current_community_id: null }).eq('id', user.id)
    router.push('/onboarding')
  }

  async function logout() {
    await supabase.auth.signOut()
    router.push('/auth')
  }

  if (loading) return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--paper-tint)' }}>
      <div style={{ width: 28, height: 28, border: '2.5px solid var(--paper-deep)', borderTopColor: 'var(--accent)' }} className="spin" />
    </div>
  )

  const [g1, g2] = avatarGrad(displayName || 'A')

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--paper-tint)' }}>
      {/* Header */}
      <div style={{ background: 'var(--paper)', borderBottom: '1px solid var(--stroke-hair)', padding: '12px 16px 14px', paddingTop: 'max(16px, env(safe-area-inset-top, 16px))', flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 22, fontWeight: 800, color: 'var(--ink)' }}>Mehr</div>
      </div>

      <div className="scroll" style={{ flex: 1, padding: '20px 16px' }}>

        {/* Profile card */}
        <div style={{ background: 'var(--paper)', border: '1.5px solid var(--stroke)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--offset-md)', padding: '18px 16px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: `linear-gradient(145deg,${g1},${g2})`, border: '2px solid var(--stroke)', boxShadow: 'var(--offset-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 22, fontWeight: 800, color: 'var(--paper)' }}>{(displayName || '?')[0].toUpperCase()}</span>
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 20, fontWeight: 800, color: 'var(--ink)' }}>{displayName}</div>
            <div style={{ fontFamily: 'var(--font-hand)', fontSize: 14, color: 'var(--text-muted)', marginTop: 2 }}>Anonym · kein Passwort</div>
          </div>
        </div>

        {/* Community card */}
        {community && (
          <>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 8, paddingLeft: 4 }}>Gruppe</div>
            <div style={{ background: 'var(--paper)', border: '1.5px solid var(--stroke)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--offset-sm)', overflow: 'hidden', marginBottom: 24 }}>
              {/* Group name row */}
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--stroke-hair)' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>{community.name}</div>
                <div style={{ fontFamily: 'var(--font-hand)', fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{members.length} {members.length === 1 ? 'Mitglied' : 'Mitglieder'}</div>
              </div>

              {/* Members */}
              {members.length > 0 && (
                <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--stroke-hair)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {members.map(m => {
                    const name = m.profiles?.display_name || '?'
                    const [mg1, mg2] = avatarGrad(name)
                    const isMe = m.user_id === userId
                    return (
                      <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--paper-tint)', border: `1px solid ${isMe ? 'var(--accent)' : 'var(--stroke-hair)'}`, borderRadius: 'var(--r-full)', padding: '4px 10px 4px 4px' }}>
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: `linear-gradient(135deg,${mg1},${mg2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: '#fff' }}>{name[0].toUpperCase()}</span>
                        </div>
                        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: isMe ? 700 : 400, color: isMe ? 'var(--accent)' : 'var(--ink)' }}>{name}{isMe ? ' (du)' : ''}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Invite code */}
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--stroke-hair)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>Einladungscode</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 24, fontWeight: 800, letterSpacing: 6, color: 'var(--accent)' }}>{community.invite_code}</div>
                </div>
                <button onClick={copyCode} style={{ background: copied ? 'var(--sage)' : 'var(--paper-deep)', color: copied ? 'var(--paper)' : 'var(--ink)', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, height: 34, paddingInline: 14, borderRadius: 'var(--r-full)', border: '1px solid var(--stroke-hair)', cursor: 'pointer', transition: 'all 0.2s' }}>
                  {copied ? 'Kopiert!' : 'Kopieren'}
                </button>
              </div>

              {/* Switch */}
              <button onClick={switchCommunity} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--accent)', fontWeight: 500 }}>Gruppe wechseln</span>
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--stroke-hair)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </>
        )}

        {/* App section */}
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 8, paddingLeft: 4 }}>App</div>
        <div style={{ background: 'var(--paper)', border: '1.5px solid var(--stroke)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--offset-sm)', overflow: 'hidden', marginBottom: 24 }}>
          {[
            { label: 'Version', value: '1.0.0' },
            { label: 'Sprache', value: 'Deutsch' },
          ].map((row, i) => (
            <div key={row.label}>
              {i > 0 && <div style={{ height: 1, background: 'var(--stroke-hair)' }} />}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 16px' }}>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--ink)' }}>{row.label}</span>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--text-muted)' }}>{row.value}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Logout */}
        <button onClick={logout} style={{ width: '100%', background: 'var(--paper)', color: 'var(--accent-deep)', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 17, fontWeight: 700, minHeight: 50, borderRadius: 'var(--r-lg)', border: '1.5px solid var(--accent)', boxShadow: 'var(--offset-sm)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.12s' }}>
          Abmelden
        </button>

        <div style={{ height: 28 }} />
      </div>
    </div>
  )
}

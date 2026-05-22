'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface Photo {
  id: string
  storage_path: string
  caption: string | null
  created_at: string
  user_id: string
  profiles: { display_name: string } | null
  url?: string
}

const PI_GRADIENTS: Record<string, [string, string]> = {
  A: ['#C85A3C', '#E89A6F'], B: ['#4A6A52', '#7A9E82'], C: ['#D89020', '#EDB84A'],
  D: ['#6B8FA4', '#9BB5C8'], E: ['#7A4A5A', '#AA7A8A'], F: ['#A4462E', '#C87A5A'],
  G: ['#3A5A42', '#6A8A72'], H: ['#B87820', '#D8A84A'],
}
function avatarGrad(name: string) {
  const key = String.fromCharCode(65 + (name.charCodeAt(0) % 8)) as keyof typeof PI_GRADIENTS
  return PI_GRADIENTS[key] || PI_GRADIENTS.A
}

export default function CameraPage() {
  const [mode, setMode] = useState<'camera' | 'gallery'>('camera')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [communityId, setCommunityId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [selected, setSelected] = useState<Photo | null>(null)
  const [loading, setLoading] = useState(true)
  const [flash, setFlash] = useState(false)
  const [shutterPressed, setShutterPressed] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth'); return }
      setUserId(user.id)
      const { data: prof } = await supabase.from('profiles').select('current_community_id').eq('id', user.id).single()
      if (!prof?.current_community_id) { router.push('/onboarding'); return }
      setCommunityId(prof.current_community_id)
      await loadPhotos(prof.current_community_id)
      setLoading(false)
    }
    init()
  }, [])

  async function loadPhotos(cid: string) {
    const { data } = await supabase
      .from('photos')
      .select('id, storage_path, caption, created_at, user_id')
      .eq('community_id', cid)
      .order('created_at', { ascending: false })
    if (!data) return
    const uids = [...new Set(data.map((p: { user_id: string }) => p.user_id))]
    const { data: profs } = await supabase.from('profiles').select('id,display_name').in('id', uids)
    const pm: Record<string, string> = {}
    ;(profs || []).forEach((p: { id: string; display_name: string }) => { pm[p.id] = p.display_name })
    setPhotos(data.map((p: Omit<Photo, 'profiles' | 'url'> & { user_id: string }) => ({
      ...p,
      profiles: pm[p.user_id] ? { display_name: pm[p.user_id] } : null,
      url: supabase.storage.from('photos').getPublicUrl(p.storage_path).data.publicUrl,
    })) as Photo[])
  }

  async function handleUpload(file: File | null | undefined) {
    if (!file || !communityId || !userId) return
    setUploading(true); setUploadProgress(15)
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${communityId}/${userId}_${Date.now()}.${ext}`
    setUploadProgress(40)
    const { error } = await supabase.storage.from('photos').upload(path, file, { contentType: file.type })
    setUploadProgress(75)
    if (!error) {
      await supabase.from('photos').insert({ community_id: communityId, user_id: userId, storage_path: path })
      setUploadProgress(100)
      await loadPhotos(communityId)
      setMode('gallery')
    }
    setTimeout(() => { setUploading(false); setUploadProgress(0) }, 600)
  }

  async function deletePhoto(photo: Photo) {
    if (photo.user_id !== userId) return
    await supabase.storage.from('photos').remove([photo.storage_path])
    await supabase.from('photos').delete().eq('id', photo.id)
    setPhotos(prev => prev.filter(p => p.id !== photo.id))
    setSelected(null)
  }

  const grouped: Record<string, Photo[]> = {}
  photos.forEach(p => {
    const date = new Date(p.created_at).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
    if (!grouped[date]) grouped[date] = []
    grouped[date].push(p)
  })

  /* ── Full-screen viewer ─────────────────────────── */
  if (selected) return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#0A0806', display: 'flex', flexDirection: 'column' }} className="fi">
      <div style={{ padding: '16px 16px 0', paddingTop: 'max(20px, env(safe-area-inset-top, 20px))', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={() => setSelected(null)} style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {selected.profiles?.display_name && (() => {
            const [g1, g2] = avatarGrad(selected.profiles!.display_name)
            return (
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: `linear-gradient(135deg,${g1},${g2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid rgba(255,255,255,0.2)' }}>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700, color: '#fff' }}>{selected.profiles!.display_name[0].toUpperCase()}</span>
              </div>
            )
          })()}
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{selected.profiles?.display_name}</span>
        </div>
        {selected.user_id === userId ? (
          <button onClick={() => deletePhoto(selected)} style={{ background: 'rgba(200,90,60,0.2)', border: '1px solid rgba(200,90,60,0.4)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>Löschen</span>
          </button>
        ) : <div style={{ width: 70 }} />}
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <img src={selected.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 12 }} />
      </div>
      <div style={{ padding: '12px 16px', paddingBottom: 'max(32px, env(safe-area-inset-bottom, 32px))', textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-hand)', fontSize: 14, color: 'rgba(255,255,255,0.35)' }}>
          {new Date(selected.created_at).toLocaleString('de-DE', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )

  /* ── Camera mode ─────────────────────────────────── */
  if (mode === 'camera') return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0A0806', position: 'relative', overflow: 'hidden' }}>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
        onChange={e => { handleUpload(e.target.files?.[0]); if (fileRef.current) fileRef.current.value = '' }} />

      {/* Viewfinder bg */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 30% 40%, rgba(200,90,60,0.12) 0%, transparent 55%), radial-gradient(ellipse at 70% 70%, rgba(74,106,82,0.1) 0%, transparent 50%)', pointerEvents: 'none' }} />

      {/* Top bar */}
      <div style={{ position: 'relative', zIndex: 10, padding: '12px 20px 0', paddingTop: 'max(16px, env(safe-area-inset-top, 16px))', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 20, fontWeight: 800, color: 'var(--paper)', letterSpacing: '-0.3px' }}>Festify</div>
        <button onClick={() => setFlash(f => !f)} style={{ width: 36, height: 36, borderRadius: '50%', background: flash ? 'rgba(216,144,32,0.3)' : 'rgba(255,255,255,0.1)', border: `1.5px solid ${flash ? 'rgba(216,144,32,0.6)' : 'rgba(255,255,255,0.15)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg width={18} height={18} viewBox="0 0 24 24" fill={flash ? 'rgba(216,144,32,0.8)' : 'none'} stroke={flash ? '#D89020' : 'rgba(255,255,255,0.6)'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        </button>
      </div>

      {/* Center viewfinder hint */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 5 }}>
        <div style={{ width: 220, height: 220, position: 'relative' }}>
          {[0, 1, 2, 3].map(corner => (
            <div key={corner} style={{
              position: 'absolute', width: 24, height: 24,
              top: corner < 2 ? 0 : undefined, bottom: corner >= 2 ? 0 : undefined,
              left: corner % 2 === 0 ? 0 : undefined, right: corner % 2 === 1 ? 0 : undefined,
              borderTop: corner < 2 ? '2px solid rgba(255,255,255,0.35)' : undefined,
              borderBottom: corner >= 2 ? '2px solid rgba(255,255,255,0.35)' : undefined,
              borderLeft: corner % 2 === 0 ? '2px solid rgba(255,255,255,0.35)' : undefined,
              borderRight: corner % 2 === 1 ? '2px solid rgba(255,255,255,0.35)' : undefined,
              borderRadius: corner === 0 ? '4px 0 0 0' : corner === 1 ? '0 4px 0 0' : corner === 2 ? '0 0 0 4px' : '0 0 4px 0',
            }} />
          ))}
        </div>
      </div>

      {/* Upload progress */}
      {uploading && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30, background: 'rgba(0,0,0,0.6)', padding: '12px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>Wird hochgeladen…</span>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>{uploadProgress}%</span>
          </div>
          <div style={{ height: 2, background: 'rgba(255,255,255,0.15)', borderRadius: 1, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--accent)', width: `${uploadProgress}%`, transition: 'width 0.3s ease', borderRadius: 1 }} />
          </div>
        </div>
      )}

      {/* Bottom controls */}
      <div style={{ position: 'relative', zIndex: 10, padding: '20px 32px', paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Gallery thumb */}
        <button onClick={() => setMode('gallery')} style={{ width: 48, height: 48, borderRadius: 10, background: 'rgba(255,255,255,0.1)', border: '1.5px solid rgba(255,255,255,0.2)', cursor: 'pointer', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {photos[0]?.url ? (
            <img src={photos[0].url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
            </svg>
          )}
        </button>

        {/* Shutter */}
        <button
          onMouseDown={() => setShutterPressed(true)}
          onMouseUp={() => setShutterPressed(false)}
          onTouchStart={() => setShutterPressed(true)}
          onTouchEnd={() => setShutterPressed(false)}
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{
            width: 80, height: 80, borderRadius: '50%',
            background: 'transparent',
            border: '3px solid rgba(255,255,255,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: uploading ? 'not-allowed' : 'pointer',
            transform: shutterPressed ? 'scale(0.93)' : 'scale(1)',
            transition: 'transform 0.12s cubic-bezier(0.22,1,0.36,1)',
          }}
        >
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: uploading ? 'rgba(200,90,60,0.4)' : 'var(--accent)',
            boxShadow: uploading ? 'none' : '0 0 0 2px rgba(200,90,60,0.3)',
            transition: 'all 0.15s',
          }} />
        </button>

        {/* Flip camera (decorative) */}
        <button style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: '1.5px solid rgba(255,255,255,0.2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 4v6h6"/><path d="M23 20v-6h-6"/>
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
          </svg>
        </button>
      </div>
    </div>
  )

  /* ── Gallery mode ─────────────────────────────────── */
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--paper-tint)' }}>
      {/* Header */}
      <div style={{ background: 'var(--paper)', borderBottom: '1px solid var(--stroke-hair)', padding: '12px 16px 10px', paddingTop: 'max(16px, env(safe-area-inset-top, 16px))', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button onClick={() => setMode('camera')} style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--paper-deep)', border: '1px solid var(--stroke-hair)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 18, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>Galerie</div>
          {!loading && <div style={{ fontFamily: 'var(--font-hand)', fontSize: 13, color: 'var(--text-muted)', marginTop: 1 }}>{photos.length} Fotos</div>}
        </div>
        <button onClick={() => setMode('camera')} style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--paper)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
        </button>
      </div>

      {uploading && (
        <div style={{ background: 'var(--paper)', borderBottom: '1px solid var(--stroke-hair)', padding: '8px 16px 10px', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--text-muted)' }}>Wird hochgeladen…</span>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>{uploadProgress}%</span>
          </div>
          <div style={{ height: 2, background: 'var(--stroke-hair)', borderRadius: 1, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--accent)', width: `${uploadProgress}%`, transition: 'width 0.3s ease', borderRadius: 1 }} />
          </div>
        </div>
      )}

      <div className="scroll" style={{ flex: 1 }}>
        {loading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5px', padding: '1.5px' }}>
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="skel" style={{ aspectRatio: '1', borderRadius: 0 }} />
            ))}
          </div>
        )}

        {!loading && photos.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 12 }}>
            <div style={{ width: 60, height: 60, borderRadius: 18, background: 'var(--paper)', border: '1.5px solid var(--stroke-hair)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 18, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>Noch keine Fotos</div>
              <div style={{ fontFamily: 'var(--font-hand)', fontSize: 15, color: 'var(--text-muted)' }}>Mach das erste Festfoto!</div>
            </div>
            <button onClick={() => setMode('camera')} style={{ background: 'var(--accent)', color: 'var(--paper)', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 16, fontWeight: 700, padding: '10px 28px', borderRadius: 'var(--r-full)', border: '1.5px solid var(--stroke)', boxShadow: 'var(--offset-md)', cursor: 'pointer' }}>
              Kamera öffnen
            </button>
          </div>
        )}

        {!loading && Object.entries(grouped).map(([date, datePhotos]) => (
          <div key={date}>
            <div style={{ padding: '14px 14px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{date}</div>
              <div style={{ fontFamily: 'var(--font-hand)', fontSize: 13, color: 'var(--text-muted)' }}>{datePhotos.length}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5px' }}>
              {datePhotos.map(photo => (
                <div key={photo.id} onClick={() => setSelected(photo)} style={{ aspectRatio: '1', cursor: 'pointer', overflow: 'hidden', background: 'var(--paper-deep)' }}>
                  <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                </div>
              ))}
            </div>
          </div>
        ))}

        <div style={{ height: 20 }} />
      </div>
    </div>
  )
}

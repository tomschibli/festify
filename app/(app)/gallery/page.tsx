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

export default function GalleryPage() {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [communityId, setCommunityId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [selected, setSelected] = useState<Photo | null>(null)
  const [loading, setLoading] = useState(true)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
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

  async function handleUpload(file: File | null | undefined, inputEl?: HTMLInputElement | null) {
    if (!file || !communityId || !userId) return
    if (inputEl) inputEl.value = ''
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>

      {/* Full-screen viewer */}
      {selected && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#000', display: 'flex', flexDirection: 'column' }} className="fi">
          <div style={{ padding: '16px', paddingTop: 'max(16px, env(safe-area-inset-top, 16px))', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={() => setSelected(null)} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '50%', width: '36px', height: '36px', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '14px' }}>{selected.profiles?.display_name}</div>
            {selected.user_id === userId ? (
              <button onClick={() => deletePhoto(selected)} style={{ background: 'rgba(255,59,48,0.2)', border: 'none', borderRadius: '8px', padding: '6px 12px', color: '#FF3B30', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}>
                Löschen
              </button>
            ) : <div style={{ width: '70px' }} />}
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px' }}>
            <img src={selected.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '6px' }} />
          </div>
          <div style={{ padding: '16px', paddingBottom: 'max(32px, env(safe-area-inset-bottom, 16px))', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '12px' }}>
            {new Date(selected.created_at).toLocaleString('de-DE', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => handleUpload(e.target.files?.[0], e.target)} />
      <input ref={galleryRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleUpload(e.target.files?.[0], e.target)} />

      {/* Nav bar */}
      <div className="navbar pt-safe" style={{ flexShrink: 0 }}>
        <div style={{ padding: '8px 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: '44px' }}>
          <div style={{ fontSize: '22px', fontWeight: '700', letterSpacing: '-0.3px' }}>Fotos</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-s" onClick={() => cameraRef.current?.click()} disabled={uploading}>Kamera</button>
            <button className="btn btn-s" onClick={() => galleryRef.current?.click()} disabled={uploading}>Galerie</button>
          </div>
        </div>
        {uploading && (
          <div style={{ padding: '0 16px 10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '12px', color: 'var(--t2)' }}>Wird hochgeladen</span>
              <span style={{ fontSize: '12px', color: 'var(--blue)', fontWeight: '600' }}>{uploadProgress}%</span>
            </div>
            <div style={{ height: '2px', background: 'var(--f3)', borderRadius: '1px', overflow: 'hidden' }}>
              <div style={{ height: '100%', background: 'var(--blue)', borderRadius: '1px', width: `${uploadProgress}%`, transition: 'width 0.3s ease' }} />
            </div>
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="scroll" style={{ flex: 1 }}>
        {loading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5px', padding: '1.5px' }}>
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="skel" style={{ aspectRatio: '1', borderRadius: 0 }} />
            ))}
          </div>
        )}

        {!loading && photos.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: '100px' }}>
            <div style={{ marginBottom: '8px' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--t3)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto' }}>
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
            <div style={{ fontSize: '17px', fontWeight: '600', color: 'var(--t1)', marginBottom: '6px' }}>Noch keine Fotos</div>
            <div style={{ fontSize: '15px', color: 'var(--t2)', marginBottom: '24px' }}>Mach das erste Bild</div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button className="btn btn-p" style={{ padding: '0 20px', minHeight: '42px', fontSize: '15px' }} onClick={() => cameraRef.current?.click()}>Kamera</button>
              <button className="btn btn-s" style={{ minHeight: '42px', fontSize: '15px' }} onClick={() => galleryRef.current?.click()}>Galerie</button>
            </div>
          </div>
        )}

        {!loading && Object.entries(grouped).map(([date, datePhotos]) => (
          <div key={date}>
            <div style={{ padding: '14px 16px 8px', fontSize: '13px', fontWeight: '600', color: 'var(--t2)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ color: 'var(--t1)', fontSize: '15px' }}>{date}</span>
              <span style={{ color: 'var(--t3)' }}>{datePhotos.length}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5px' }}>
              {datePhotos.map(photo => (
                <div key={photo.id} onClick={() => setSelected(photo)} style={{ aspectRatio: '1', cursor: 'pointer', overflow: 'hidden', background: 'var(--f3)' }}>
                  <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                </div>
              ))}
            </div>
          </div>
        ))}
        <div style={{ height: '16px' }} />
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface PackItem {
  id: string
  name: string
  assigned_to: string | null
  is_packed: boolean
  created_by: string
  profiles_created: { display_name: string } | null
  profiles_assigned: { display_name: string } | null
}

export default function PacklistPage() {
  const [items, setItems] = useState<PackItem[]>([])
  const [communityId, setCommunityId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [newItem, setNewItem] = useState('')
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'open' | 'mine'>('all')
  const inputRef = useRef<HTMLInputElement>(null)
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
      await load(prof.current_community_id)
      setLoading(false)
    }
    init()
  }, [])

  async function load(cid: string) {
    const { data } = await supabase
      .from('pack_list')
      .select('id, name, assigned_to, is_packed, created_by')
      .eq('community_id', cid)
      .order('created_at')
    if (!data) { setItems([]); return }
    const uids = [...new Set([
      ...data.map((i: { created_by: string }) => i.created_by),
      ...(data.map((i: { assigned_to: string | null }) => i.assigned_to).filter(Boolean) as string[]),
    ])]
    const { data: profs } = await supabase.from('profiles').select('id,display_name').in('id', uids)
    const pm: Record<string, string> = {}
    ;(profs || []).forEach((p: { id: string; display_name: string }) => { pm[p.id] = p.display_name })
    setItems(data.map((i: { id: string; name: string; assigned_to: string | null; is_packed: boolean; created_by: string }) => ({
      ...i,
      profiles_created: pm[i.created_by] ? { display_name: pm[i.created_by] } : null,
      profiles_assigned: i.assigned_to && pm[i.assigned_to] ? { display_name: pm[i.assigned_to] } : null,
    })) as PackItem[])
  }

  async function addItem() {
    if (!newItem.trim() || !communityId || !userId) return
    await supabase.from('pack_list').insert({ community_id: communityId, created_by: userId, name: newItem.trim() })
    setNewItem(''); setAdding(false)
    await load(communityId)
  }

  async function toggleAssign(item: PackItem) {
    if (!communityId || !userId) return
    const newVal = item.assigned_to === userId ? null : userId
    await supabase.from('pack_list').update({ assigned_to: newVal }).eq('id', item.id)
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, assigned_to: newVal, profiles_assigned: newVal ? { display_name: 'Du' } : null } : i))
  }

  async function togglePacked(item: PackItem) {
    const newVal = !item.is_packed
    await supabase.from('pack_list').update({ is_packed: newVal }).eq('id', item.id)
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_packed: newVal } : i))
  }

  async function deleteItem(id: string) {
    await supabase.from('pack_list').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const filtered = items.filter(item => {
    if (filter === 'open') return !item.assigned_to && !item.is_packed
    if (filter === 'mine') return item.assigned_to === userId
    return true
  })

  const packed = items.filter(i => i.is_packed).length
  const total = items.length
  const progress = total > 0 ? packed / total : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>

      {/* Nav bar */}
      <div className="navbar pt-safe" style={{ flexShrink: 0 }}>
        <div style={{ padding: '8px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: '44px' }}>
          <div style={{ fontSize: '22px', fontWeight: '700', letterSpacing: '-0.3px' }}>Packliste</div>
          <button className="btn btn-t" style={{ fontSize: '15px', fontWeight: '600' }}
            onClick={() => { setAdding(true); setTimeout(() => inputRef.current?.focus(), 50) }}>
            + Hinzufügen
          </button>
        </div>

        {/* Progress */}
        {total > 0 && (
          <div style={{ padding: '10px 16px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '13px', color: 'var(--t2)' }}>{packed} von {total} gepackt</span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--green)' }}>{Math.round(progress * 100)}%</span>
            </div>
            <div style={{ height: '3px', background: 'var(--f3)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', background: 'var(--green)', borderRadius: '2px', width: `${progress * 100}%`, transition: 'width 0.4s ease' }} />
            </div>
          </div>
        )}

        {/* Filter */}
        <div style={{ padding: '10px 16px 12px' }}>
          <div className="seg">
            {([['all','Alle'],['open','Frei'],['mine','Meine']] as const).map(([k, l]) => (
              <button key={k} className={`seg-i ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Add item */}
      {adding && (
        <div style={{ background: 'var(--card)', borderBottom: '0.5px solid var(--sep-o)', padding: '10px 16px', display: 'flex', gap: '10px', alignItems: 'center' }} className="up">
          <input
            ref={inputRef}
            className="field"
            type="text"
            value={newItem}
            onChange={e => setNewItem(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addItem(); if (e.key === 'Escape') { setAdding(false); setNewItem('') } }}
            placeholder="Was wird gebraucht?"
            style={{ flex: 1, background: 'var(--f3)', borderRadius: '10px', padding: '10px 14px' }}
          />
          <button className="btn btn-p" onClick={addItem} disabled={!newItem.trim()} style={{ minHeight: '40px', padding: '0 16px', fontSize: '15px', flexShrink: 0 }}>
            Hinzufügen
          </button>
          <button onClick={() => { setAdding(false); setNewItem('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)', padding: '8px', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      )}

      {/* List */}
      <div className="scroll" style={{ flex: 1 }}>
        {loading && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
            {[1,2,3,4].map(i => <div key={i} className="skel" style={{ height: '56px', borderRadius: i === 1 ? '12px 12px 0 0' : i === 4 ? '0 0 12px 12px' : 0 }} />)}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: '64px' }}>
            <div style={{ fontSize: '17px', fontWeight: '600', color: 'var(--t1)', marginBottom: '6px' }}>
              {filter === 'all' ? 'Liste ist leer' : 'Keine Einträge'}
            </div>
            <div style={{ fontSize: '15px', color: 'var(--t2)' }}>
              {filter === 'all' ? 'Füge das erste Item hinzu' : 'Filter wechseln'}
            </div>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div style={{ padding: '16px' }}>
            <div className="card">
              {filtered.map((item, idx) => (
                <div key={item.id}>
                  {idx > 0 && <div style={{ height: '0.5px', background: 'var(--sep)', margin: '0 16px 0 52px' }} />}
                  <div className="row" style={{ padding: '12px 16px', minHeight: '54px', background: item.is_packed ? 'rgba(52,199,89,0.04)' : 'transparent', transition: 'background 0.2s' }}>
                    <button className={`chk ${item.is_packed ? 'on' : ''}`} onClick={() => togglePacked(item)}>
                      {item.is_packed && (
                        <svg width="10" height="9" viewBox="0 0 12 10" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="1 5 4.5 8.5 11 1"/>
                        </svg>
                      )}
                    </button>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '16px', fontWeight: '400', color: item.is_packed ? 'var(--t3)' : 'var(--t1)',
                        textDecoration: item.is_packed ? 'line-through' : 'none', transition: 'all 0.2s'
                      }}>
                        {item.name}
                      </div>
                      {item.profiles_assigned && (
                        <div style={{ fontSize: '12px', color: 'var(--blue)', marginTop: '2px', fontWeight: '500' }}>
                          {item.assigned_to === userId ? 'Du bringst es' : item.profiles_assigned.display_name}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => toggleAssign(item)}
                      style={{
                        padding: '5px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer',
                        fontSize: '13px', fontWeight: '500', flexShrink: 0,
                        background: item.assigned_to === userId ? 'rgba(0,122,255,0.1)' : 'var(--f3)',
                        color: item.assigned_to === userId ? 'var(--blue)' : 'var(--t2)',
                        transition: 'all 0.15s',
                      }}
                    >
                      {item.assigned_to === userId ? 'Ich bring\'s' : 'Übernehmen'}
                    </button>

                    {item.created_by === userId && (
                      <button onClick={() => deleteItem(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)', padding: '4px 4px 4px 8px', flexShrink: 0 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ height: '16px' }} />
      </div>
    </div>
  )
}

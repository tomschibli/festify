import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('current_community_id')
    .eq('id', user.id)
    .single()

  if (profile?.current_community_id) {
    redirect('/chat')
  } else {
    redirect('/onboarding')
  }
}

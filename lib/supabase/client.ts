import { createBrowserClient } from '@supabase/ssr'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://eunhifqytvourasagzqx.supabase.co'
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_3dDSsF2ac9a2-0Tb12dl4g__N5V7JbX'

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_KEY)
}

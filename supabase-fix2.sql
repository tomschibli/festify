-- ============================================================
-- FIX: Infinite recursion in RLS policies
-- ============================================================

-- Drop all old policies
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_select_community" ON profiles;
DROP POLICY IF EXISTS "communities_select_member" ON communities;
DROP POLICY IF EXISTS "communities_select_by_code" ON communities;
DROP POLICY IF EXISTS "communities_insert" ON communities;
DROP POLICY IF EXISTS "members_select" ON community_members;
DROP POLICY IF EXISTS "members_insert" ON community_members;
DROP POLICY IF EXISTS "members_delete" ON community_members;
DROP POLICY IF EXISTS "chat_select" ON chat_messages;
DROP POLICY IF EXISTS "chat_insert" ON chat_messages;
DROP POLICY IF EXISTS "calendar_select" ON calendar_events;
DROP POLICY IF EXISTS "calendar_insert" ON calendar_events;
DROP POLICY IF EXISTS "calendar_update" ON calendar_events;
DROP POLICY IF EXISTS "calendar_delete" ON calendar_events;
DROP POLICY IF EXISTS "pack_select" ON pack_list;
DROP POLICY IF EXISTS "pack_insert" ON pack_list;
DROP POLICY IF EXISTS "pack_update" ON pack_list;
DROP POLICY IF EXISTS "pack_delete" ON pack_list;
DROP POLICY IF EXISTS "pins_select" ON map_pins;
DROP POLICY IF EXISTS "pins_insert" ON map_pins;
DROP POLICY IF EXISTS "pins_delete" ON map_pins;
DROP POLICY IF EXISTS "photos_select" ON photos;
DROP POLICY IF EXISTS "photos_insert" ON photos;
DROP POLICY IF EXISTS "photos_delete" ON photos;

-- Security definer function (bypasses RLS, kein infinite recursion)
CREATE OR REPLACE FUNCTION get_my_community_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT community_id FROM community_members WHERE user_id = auth.uid();
$$;

-- ── PROFILES ────────────────────────────────────────────────
CREATE POLICY "profiles_own" ON profiles FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_community" ON profiles FOR SELECT USING (
  id IN (
    SELECT user_id FROM community_members
    WHERE community_id IN (SELECT get_my_community_ids())
  )
);

-- ── COMMUNITIES ──────────────────────────────────────────────
CREATE POLICY "communities_all" ON communities FOR ALL USING (true) WITH CHECK (auth.uid() = created_by);

-- ── COMMUNITY MEMBERS ────────────────────────────────────────
-- Nicht-rekursiv: Nutzer sieht Mitglieder seiner eigenen Communities
CREATE POLICY "members_select" ON community_members FOR SELECT USING (
  community_id IN (SELECT get_my_community_ids())
);
CREATE POLICY "members_insert" ON community_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "members_delete" ON community_members FOR DELETE USING (auth.uid() = user_id);

-- ── CHAT ─────────────────────────────────────────────────────
CREATE POLICY "chat_select" ON chat_messages FOR SELECT USING (
  community_id IN (SELECT get_my_community_ids())
);
CREATE POLICY "chat_insert" ON chat_messages FOR INSERT WITH CHECK (
  auth.uid() = user_id AND community_id IN (SELECT get_my_community_ids())
);

-- ── CALENDAR ─────────────────────────────────────────────────
CREATE POLICY "calendar_select" ON calendar_events FOR SELECT USING (
  community_id IN (SELECT get_my_community_ids())
);
CREATE POLICY "calendar_insert" ON calendar_events FOR INSERT WITH CHECK (
  auth.uid() = created_by AND community_id IN (SELECT get_my_community_ids())
);
CREATE POLICY "calendar_update" ON calendar_events FOR UPDATE USING (auth.uid() = created_by);
CREATE POLICY "calendar_delete" ON calendar_events FOR DELETE USING (auth.uid() = created_by);

-- ── PACK LIST ─────────────────────────────────────────────────
CREATE POLICY "pack_select" ON pack_list FOR SELECT USING (
  community_id IN (SELECT get_my_community_ids())
);
CREATE POLICY "pack_insert" ON pack_list FOR INSERT WITH CHECK (
  auth.uid() = created_by AND community_id IN (SELECT get_my_community_ids())
);
CREATE POLICY "pack_update" ON pack_list FOR UPDATE USING (
  community_id IN (SELECT get_my_community_ids())
);
CREATE POLICY "pack_delete" ON pack_list FOR DELETE USING (auth.uid() = created_by);

-- ── MAP PINS ──────────────────────────────────────────────────
CREATE POLICY "pins_select" ON map_pins FOR SELECT USING (
  community_id IN (SELECT get_my_community_ids())
);
CREATE POLICY "pins_insert" ON map_pins FOR INSERT WITH CHECK (
  auth.uid() = created_by AND community_id IN (SELECT get_my_community_ids())
);
CREATE POLICY "pins_delete" ON map_pins FOR DELETE USING (auth.uid() = created_by);

-- ── PHOTOS ───────────────────────────────────────────────────
CREATE POLICY "photos_select" ON photos FOR SELECT USING (
  community_id IN (SELECT get_my_community_ids())
);
CREATE POLICY "photos_insert" ON photos FOR INSERT WITH CHECK (
  auth.uid() = user_id AND community_id IN (SELECT get_my_community_ids())
);
CREATE POLICY "photos_delete" ON photos FOR DELETE USING (auth.uid() = user_id);

-- ── STORAGE ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "storage_photos_select" ON storage.objects;
DROP POLICY IF EXISTS "storage_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "storage_photos_delete" ON storage.objects;

INSERT INTO storage.buckets (id, name, public) VALUES ('photos', 'photos', true) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "storage_select" ON storage.objects FOR SELECT USING (bucket_id = 'photos');
CREATE POLICY "storage_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'photos');
CREATE POLICY "storage_delete" ON storage.objects FOR DELETE USING (bucket_id = 'photos');

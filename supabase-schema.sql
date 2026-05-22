-- ============================================================
-- FESTIFY - Supabase Schema (Fixed order)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. PROFILES (no foreign deps except auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT 'User',
  avatar_url TEXT,
  current_community_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. COMMUNITIES
-- ============================================================
CREATE TABLE IF NOT EXISTS communities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. COMMUNITY MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS community_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(community_id, user_id)
);

-- ============================================================
-- 4. CHAT MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 5. CALENDAR EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  event_date DATE NOT NULL,
  event_time TIME,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 6. PACK LIST
-- ============================================================
CREATE TABLE IF NOT EXISTS pack_list (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_packed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. MAP PINS
-- ============================================================
CREATE TABLE IF NOT EXISTS map_pins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  emoji TEXT DEFAULT '📍',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8. PHOTOS
-- ============================================================
CREATE TABLE IF NOT EXISTS photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  caption TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RLS POLICIES (alle Tabellen existieren jetzt)
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE pack_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;

-- PROFILES
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_select_community" ON profiles FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM community_members cm1
    JOIN community_members cm2 ON cm1.community_id = cm2.community_id
    WHERE cm1.user_id = auth.uid() AND cm2.user_id = profiles.id
  )
);

-- COMMUNITIES
CREATE POLICY "communities_select_member" ON communities FOR SELECT USING (
  EXISTS (SELECT 1 FROM community_members WHERE community_id = communities.id AND user_id = auth.uid())
);
CREATE POLICY "communities_select_by_code" ON communities FOR SELECT USING (true);
CREATE POLICY "communities_insert" ON communities FOR INSERT WITH CHECK (auth.uid() = created_by);

-- COMMUNITY MEMBERS
CREATE POLICY "members_select" ON community_members FOR SELECT USING (
  EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = community_members.community_id AND cm.user_id = auth.uid())
);
CREATE POLICY "members_insert" ON community_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "members_delete" ON community_members FOR DELETE USING (user_id = auth.uid());

-- CHAT MESSAGES
CREATE POLICY "chat_select" ON chat_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM community_members WHERE community_id = chat_messages.community_id AND user_id = auth.uid())
);
CREATE POLICY "chat_insert" ON chat_messages FOR INSERT WITH CHECK (
  auth.uid() = user_id AND
  EXISTS (SELECT 1 FROM community_members WHERE community_id = chat_messages.community_id AND user_id = auth.uid())
);

-- CALENDAR EVENTS
CREATE POLICY "calendar_select" ON calendar_events FOR SELECT USING (
  EXISTS (SELECT 1 FROM community_members WHERE community_id = calendar_events.community_id AND user_id = auth.uid())
);
CREATE POLICY "calendar_insert" ON calendar_events FOR INSERT WITH CHECK (
  auth.uid() = created_by AND
  EXISTS (SELECT 1 FROM community_members WHERE community_id = calendar_events.community_id AND user_id = auth.uid())
);
CREATE POLICY "calendar_update" ON calendar_events FOR UPDATE USING (auth.uid() = created_by);
CREATE POLICY "calendar_delete" ON calendar_events FOR DELETE USING (auth.uid() = created_by);

-- PACK LIST
CREATE POLICY "pack_select" ON pack_list FOR SELECT USING (
  EXISTS (SELECT 1 FROM community_members WHERE community_id = pack_list.community_id AND user_id = auth.uid())
);
CREATE POLICY "pack_insert" ON pack_list FOR INSERT WITH CHECK (
  auth.uid() = created_by AND
  EXISTS (SELECT 1 FROM community_members WHERE community_id = pack_list.community_id AND user_id = auth.uid())
);
CREATE POLICY "pack_update" ON pack_list FOR UPDATE USING (
  EXISTS (SELECT 1 FROM community_members WHERE community_id = pack_list.community_id AND user_id = auth.uid())
);
CREATE POLICY "pack_delete" ON pack_list FOR DELETE USING (auth.uid() = created_by);

-- MAP PINS
CREATE POLICY "pins_select" ON map_pins FOR SELECT USING (
  EXISTS (SELECT 1 FROM community_members WHERE community_id = map_pins.community_id AND user_id = auth.uid())
);
CREATE POLICY "pins_insert" ON map_pins FOR INSERT WITH CHECK (
  auth.uid() = created_by AND
  EXISTS (SELECT 1 FROM community_members WHERE community_id = map_pins.community_id AND user_id = auth.uid())
);
CREATE POLICY "pins_delete" ON map_pins FOR DELETE USING (auth.uid() = created_by);

-- PHOTOS
CREATE POLICY "photos_select" ON photos FOR SELECT USING (
  EXISTS (SELECT 1 FROM community_members WHERE community_id = photos.community_id AND user_id = auth.uid())
);
CREATE POLICY "photos_insert" ON photos FOR INSERT WITH CHECK (
  auth.uid() = user_id AND
  EXISTS (SELECT 1 FROM community_members WHERE community_id = photos.community_id AND user_id = auth.uid())
);
CREATE POLICY "photos_delete" ON photos FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', 'User'))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- STORAGE POLICIES (photos bucket muss zuerst erstellt werden)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('photos', 'photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "storage_photos_select" ON storage.objects FOR SELECT USING (bucket_id = 'photos');
CREATE POLICY "storage_photos_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'photos' AND auth.role() = 'authenticated');
CREATE POLICY "storage_photos_delete" ON storage.objects FOR DELETE USING (bucket_id = 'photos' AND auth.uid()::text = (storage.foldername(name))[1]);

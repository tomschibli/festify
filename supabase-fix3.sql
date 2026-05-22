-- Allow users to delete and edit their own chat messages
CREATE POLICY "chat_delete" ON chat_messages FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "chat_update" ON chat_messages FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

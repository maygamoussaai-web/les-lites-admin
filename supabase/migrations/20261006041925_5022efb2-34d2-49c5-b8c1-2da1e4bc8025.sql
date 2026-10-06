GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_assistant_messages TO authenticated;
GRANT ALL ON public.ai_assistant_messages TO service_role;
CREATE INDEX IF NOT EXISTS idx_ai_messages_user_created ON public.ai_assistant_messages (user_id, created_at DESC);
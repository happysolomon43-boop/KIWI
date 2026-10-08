-- Private, bounded Classroom representations. Bytes never enter public Board JSON.
CREATE TABLE teaching_runtime.classroom_visual_assets (
  asset_id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE CASCADE,
  class_session_id text NOT NULL REFERENCES public.teaching_class_sessions(class_session_id) ON DELETE CASCADE,
  request_key text NOT NULL,
  authority_binding text NOT NULL,
  state text NOT NULL CHECK(state IN ('GENERATING','READY','FAILED')),
  lease_token text NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  mime_type text CHECK(mime_type IN ('image/png','image/jpeg','image/svg+xml')),
  asset_bytes bytea CHECK(octet_length(asset_bytes)<=20971520),
  visual_metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id,class_id,request_key),
  CHECK(state<>'READY' OR (asset_bytes IS NOT NULL AND mime_type IS NOT NULL AND visual_metadata IS NOT NULL))
);
CREATE INDEX classroom_visual_assets_class_idx ON teaching_runtime.classroom_visual_assets(class_id);
CREATE INDEX classroom_visual_assets_session_idx ON teaching_runtime.classroom_visual_assets(class_session_id);
ALTER TABLE teaching_runtime.classroom_visual_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON teaching_runtime.classroom_visual_assets FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON teaching_runtime.classroom_visual_assets TO service_role;
CREATE POLICY classroom_visual_assets_service ON teaching_runtime.classroom_visual_assets
  TO service_role USING(true) WITH CHECK(true);

CREATE POLICY "report_templates_files_access" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'report-templates'
    AND public.has_establishment_access(((storage.foldername(name))[1])::uuid)
  )
  WITH CHECK (
    bucket_id = 'report-templates'
    AND public.has_establishment_access(((storage.foldername(name))[1])::uuid)
  );
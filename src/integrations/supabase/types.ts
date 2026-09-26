export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_profile_establishments: {
        Row: {
          created_at: string
          establishment_id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          establishment_id: string
          profile_id: string
        }
        Update: {
          created_at?: string
          establishment_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_profile_establishments_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_profile_establishments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "admin_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      PLACEHOLDER_TYPES_REMAINDER
    }
  }
}

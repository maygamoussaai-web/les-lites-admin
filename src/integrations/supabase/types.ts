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
      admin_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          establishment_id: string | null
          first_name: string
          id: string
          is_active: boolean
          last_name: string
          notifications_enabled: boolean
          phone: string | null
          role: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          establishment_id?: string | null
          first_name: string
          id: string
          is_active?: boolean
          last_name: string
          notifications_enabled?: boolean
          phone?: string | null
          role: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          establishment_id?: string | null
          first_name?: string
          id?: string
          is_active?: boolean
          last_name?: string
          notifications_enabled?: boolean
          phone?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_profiles_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          establishment_id: string | null
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          establishment_id?: string | null
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          establishment_id?: string | null
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      class_reports: {
        Row: {
          class_id: string
          created_by: string | null
          establishment_id: string
          expires_at: string
          file_path: string
          generated_at: string
          id: string
          period_id: string
        }
        Insert: {
          class_id: string
          created_by?: string | null
          establishment_id: string
          expires_at?: string
          file_path: string
          generated_at?: string
          id?: string
          period_id: string
        }
        Update: {
          class_id?: string
          created_by?: string | null
          establishment_id?: string
          expires_at?: string
          file_path?: string
          generated_at?: string
          id?: string
          period_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_reports_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_reports_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_reports_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "grade_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      class_subjects: {
        Row: {
          class_id: string
          created_at: string
          establishment_id: string
          id: string
          name: string
        }
        Insert: {
          class_id: string
          created_at?: string
          establishment_id: string
          id?: string
          name: string
        }
        Update: {
          class_id?: string
          created_at?: string
          establishment_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_subjects_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_subjects_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          capacity: number
          created_at: string
          establishment_id: string
          fee_plan_id: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          capacity?: number
          created_at?: string
          establishment_id: string
          fee_plan_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          capacity?: number
          created_at?: string
          establishment_id?: string
          fee_plan_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classes_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_fee_plan_id_fkey"
            columns: ["fee_plan_id"]
            isOneToOne: false
            referencedRelation: "fee_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      establishments: {
        Row: {
          address: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          phone: string | null
          type: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          phone?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          phone?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      fee_plan_installments: {
        Row: {
          amount: number
          created_at: string
          due_date: string
          fee_plan_id: string
          id: string
          label: string
          position: number
        }
        Insert: {
          amount?: number
          created_at?: string
          due_date: string
          fee_plan_id: string
          id?: string
          label?: string
          position?: number
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string
          fee_plan_id?: string
          id?: string
          label?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "fee_plan_installments_fee_plan_id_fkey"
            columns: ["fee_plan_id"]
            isOneToOne: false
            referencedRelation: "fee_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_plans: {
        Row: {
          created_at: string
          establishment_id: string
          id: string
          name: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          establishment_id: string
          id?: string
          name: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          establishment_id?: string
          id?: string
          name?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_plans_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      grade_periods: {
        Row: {
          class_id: string
          created_at: string
          ended_at: string | null
          establishment_id: string
          id: string
          period_number: number
          started_at: string
        }
        Insert: {
          class_id: string
          created_at?: string
          ended_at?: string | null
          establishment_id: string
          id?: string
          period_number: number
          started_at?: string
        }
        Update: {
          class_id?: string
          created_at?: string
          ended_at?: string | null
          establishment_id?: string
          id?: string
          period_number?: number
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grade_periods_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grade_periods_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      grades: {
        Row: {
          class_id: string
          created_at: string
          created_by: string | null
          establishment_id: string
          id: string
          nature: string
          period_id: string
          scale: number
          sequence_number: number
          student_id: string
          subject_id: string
          value: number
        }
        Insert: {
          class_id: string
          created_at?: string
          created_by?: string | null
          establishment_id: string
          id?: string
          nature: string
          period_id: string
          scale: number
          sequence_number?: number
          student_id: string
          subject_id: string
          value: number
        }
        Update: {
          class_id?: string
          created_at?: string
          created_by?: string | null
          establishment_id?: string
          id?: string
          nature?: string
          period_id?: string
          scale?: number
          sequence_number?: number
          student_id?: string
          subject_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "grades_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grades_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grades_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "grade_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grades_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grades_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "class_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          establishment_id: string
          expires_at: string
          id: string
          invited_by: string | null
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          establishment_id: string
          expires_at: string
          id?: string
          invited_by?: string | null
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          establishment_id?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      report_templates: {
        Row: {
          class_id: string | null
          created_at: string
          created_by: string | null
          establishment_id: string
          file_path: string
          id: string
          is_active: boolean
          kind: string
          mapping: Json
          name: string
          scale: number
          updated_at: string
        }
        Insert: {
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          establishment_id: string
          file_path: string
          id?: string
          is_active?: boolean
          kind?: string
          mapping?: Json
          name: string
          scale?: number
          updated_at?: string
        }
        Update: {
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          establishment_id?: string
          file_path?: string
          id?: string
          is_active?: boolean
          kind?: string
          mapping?: Json
          name?: string
          scale?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_templates_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_templates_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      student_documents: {
        Row: {
          created_at: string
          created_by: string | null
          establishment_id: string
          file_path: string
          file_size: number
          file_type: string
          id: string
          name: string
          student_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          establishment_id: string
          file_path: string
          file_size?: number
          file_type: string
          id?: string
          name: string
          student_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          establishment_id?: string
          file_path?: string
          file_size?: number
          file_type?: string
          id?: string
          name?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_documents_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_documents_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_enrollments: {
        Row: {
          class_id: string | null
          class_name: string
          created_at: string
          ended_at: string | null
          establishment_id: string
          establishment_name: string
          fee_plan_id: string | null
          id: string
          installments_snapshot: Json
          started_at: string
          student_id: string
          total_amount: number
        }
        Insert: {
          class_id?: string | null
          class_name: string
          created_at?: string
          ended_at?: string | null
          establishment_id: string
          establishment_name: string
          fee_plan_id?: string | null
          id?: string
          installments_snapshot?: Json
          started_at?: string
          student_id: string
          total_amount?: number
        }
        Update: {
          class_id?: string | null
          class_name?: string
          created_at?: string
          ended_at?: string | null
          establishment_id?: string
          establishment_name?: string
          fee_plan_id?: string | null
          id?: string
          installments_snapshot?: Json
          started_at?: string
          student_id?: string
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "student_enrollments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_enrollments_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_enrollments_fee_plan_id_fkey"
            columns: ["fee_plan_id"]
            isOneToOne: false
            referencedRelation: "fee_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_report_cards: {
        Row: {
          class_id: string
          created_at: string
          document_id: string | null
          establishment_id: string
          general_average: number | null
          id: string
          period_id: string
          student_id: string
          subject_averages: Json | null
        }
        Insert: {
          class_id: string
          created_at?: string
          document_id?: string | null
          establishment_id: string
          general_average?: number | null
          id?: string
          period_id: string
          student_id: string
          subject_averages?: Json | null
        }
        Update: {
          class_id?: string
          created_at?: string
          document_id?: string | null
          establishment_id?: string
          general_average?: number | null
          id?: string
          period_id?: string
          student_id?: string
          subject_averages?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "student_report_cards_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_report_cards_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "student_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_report_cards_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_report_cards_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "grade_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_report_cards_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_transfers: {
        Row: {
          created_at: string
          from_class_id: string | null
          from_establishment_id: string | null
          id: string
          student_id: string
          to_class_id: string
          to_establishment_id: string
        }
        Insert: {
          created_at?: string
          from_class_id?: string | null
          from_establishment_id?: string | null
          id?: string
          student_id: string
          to_class_id: string
          to_establishment_id: string
        }
        Update: {
          created_at?: string
          from_class_id?: string | null
          from_establishment_id?: string | null
          id?: string
          student_id?: string
          to_class_id?: string
          to_establishment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_transfers_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          archived_at: string | null
          class_id: string | null
          created_at: string
          date_of_birth: string | null
          enrolled_at: string
          establishment_id: string
          first_name: string
          gender: string
          id: string
          last_name: string
          parent_phone_1: string | null
          parent_phone_2: string | null
          photo_url: string | null
          term1_average: number | null
          term2_average: number | null
          term3_average: number | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          class_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          enrolled_at?: string
          establishment_id: string
          first_name: string
          gender: string
          id?: string
          last_name: string
          parent_phone_1?: string | null
          parent_phone_2?: string | null
          photo_url?: string | null
          term1_average?: number | null
          term2_average?: number | null
          term3_average?: number | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          class_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          enrolled_at?: string
          establishment_id?: string
          first_name?: string
          gender?: string
          id?: string
          last_name?: string
          parent_phone_1?: string | null
          parent_phone_2?: string | null
          photo_url?: string | null
          term1_average?: number | null
          term2_average?: number | null
          term3_average?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "students_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_assignments: {
        Row: {
          created_at: string
          establishment_id: string
          hourly_rate: number | null
          id: string
          is_active: boolean
          payment_method: string
          salary_amount: number | null
          teacher_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          establishment_id: string
          hourly_rate?: number | null
          id?: string
          is_active?: boolean
          payment_method: string
          salary_amount?: number | null
          teacher_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          establishment_id?: string
          hourly_rate?: number | null
          id?: string
          is_active?: boolean
          payment_method?: string
          salary_amount?: number | null
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_assignments_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_assignments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_payments: {
        Row: {
          amount: number
          created_at: string
          establishment_id: string
          id: string
          note: string | null
          paid_at: string
          teacher_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          establishment_id: string
          id?: string
          note?: string | null
          paid_at?: string
          teacher_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          establishment_id?: string
          id?: string
          note?: string | null
          paid_at?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_payments_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_payments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_session_completions: {
        Row: {
          completed_at: string
          completed_by: string | null
          created_at: string
          id: string
          session_id: string
          week_start: string
        }
        Insert: {
          completed_at?: string
          completed_by?: string | null
          created_at?: string
          id?: string
          session_id: string
          week_start: string
        }
        Update: {
          completed_at?: string
          completed_by?: string | null
          created_at?: string
          id?: string
          session_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_session_completions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "teacher_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_sessions: {
        Row: {
          assignment_id: string
          class_id: string | null
          subject_id: string | null
          created_at: string
          duration_minutes: number
          id: string
          is_done: boolean
          name: string
          updated_at: string
          weekday: number
        }
        Insert: {
          assignment_id: string
          class_id?: string | null
          subject_id?: string | null
          created_at?: string
          duration_minutes?: number
          id?: string
          is_done?: boolean
          name: string
          updated_at?: string
          weekday?: number
        }
        Update: {
          assignment_id?: string
          class_id?: string | null
          subject_id?: string | null
          created_at?: string
          duration_minutes?: number
          id?: string
          is_done?: boolean
          name?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "teacher_sessions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "teacher_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_sessions_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_sessions_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "class_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      teachers: {
        Row: {
          archived_at: string | null
          created_at: string
          domain: string | null
          first_name: string
          id: string
          last_name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          domain?: string | null
          first_name: string
          id?: string
          last_name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          domain?: string | null
          first_name?: string
          id?: string
          last_name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tuition_payments: {
        Row: {
          amount: number
          created_at: string
          enrollment_id: string
          id: string
          note: string | null
          paid_at: string
          student_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          enrollment_id: string
          id?: string
          note?: string | null
          paid_at?: string
          student_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          enrollment_id?: string
          id?: string
          note?: string | null
          paid_at?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tuition_payments_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "student_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tuition_payments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

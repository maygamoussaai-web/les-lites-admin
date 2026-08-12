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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      academic_years: {
        Row: {
          created_at: string
          end_date: string | null
          id: string
          is_active: boolean
          name: string
          start_date: string | null
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          name: string
          start_date?: string | null
        }
        Update: {
          created_at?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          name?: string
          start_date?: string | null
        }
        Relationships: []
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
      assessment_types: {
        Row: {
          class_subject_config_id: string
          created_at: string
          id: string
          max_score: number
          name: string
          weight: number
        }
        Insert: {
          class_subject_config_id: string
          created_at?: string
          id?: string
          max_score?: number
          name: string
          weight?: number
        }
        Update: {
          class_subject_config_id?: string
          created_at?: string
          id?: string
          max_score?: number
          name?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "assessment_types_class_subject_config_id_fkey"
            columns: ["class_subject_config_id"]
            isOneToOne: false
            referencedRelation: "class_subject_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      assessments: {
        Row: {
          academic_period: string | null
          assessment_date: string | null
          assessment_type_id: string | null
          class_subject_config_id: string
          created_at: string
          id: string
          max_score: number
          title: string
        }
        Insert: {
          academic_period?: string | null
          assessment_date?: string | null
          assessment_type_id?: string | null
          class_subject_config_id: string
          created_at?: string
          id?: string
          max_score?: number
          title: string
        }
        Update: {
          academic_period?: string | null
          assessment_date?: string | null
          assessment_type_id?: string | null
          class_subject_config_id?: string
          created_at?: string
          id?: string
          max_score?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessments_assessment_type_id_fkey"
            columns: ["assessment_type_id"]
            isOneToOne: false
            referencedRelation: "assessment_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_class_subject_config_id_fkey"
            columns: ["class_subject_config_id"]
            isOneToOne: false
            referencedRelation: "class_subject_configs"
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
      class_subject_configs: {
        Row: {
          calculation_method: string
          class_id: string
          coefficient: number
          created_at: string
          grading_scale: number
          id: string
          is_active: boolean
          subject_id: string
        }
        Insert: {
          calculation_method?: string
          class_id: string
          coefficient?: number
          created_at?: string
          grading_scale?: number
          id?: string
          is_active?: boolean
          subject_id: string
        }
        Update: {
          calculation_method?: string
          class_id?: string
          coefficient?: number
          created_at?: string
          grading_scale?: number
          id?: string
          is_active?: boolean
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_subject_configs_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_subject_configs_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          academic_year_id: string
          created_at: string
          description: string | null
          establishment_id: string
          id: string
          is_active: boolean
          level: string | null
          name: string
          section: string | null
        }
        Insert: {
          academic_year_id: string
          created_at?: string
          description?: string | null
          establishment_id: string
          id?: string
          is_active?: boolean
          level?: string | null
          name: string
          section?: string | null
        }
        Update: {
          academic_year_id?: string
          created_at?: string
          description?: string | null
          establishment_id?: string
          id?: string
          is_active?: boolean
          level?: string | null
          name?: string
          section?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classes_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
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
      grades: {
        Row: {
          assessment_id: string
          comment: string | null
          created_at: string
          id: string
          score: number
          student_id: string
          updated_at: string
        }
        Insert: {
          assessment_id: string
          comment?: string | null
          created_at?: string
          id?: string
          score: number
          student_id: string
          updated_at?: string
        }
        Update: {
          assessment_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          score?: number
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grades_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grades_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
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
      student_enrollments: {
        Row: {
          academic_year_id: string
          class_id: string
          created_at: string
          end_date: string | null
          enrollment_date: string
          establishment_id: string
          id: string
          status: string
          student_id: string
          transfer_reason: string | null
        }
        Insert: {
          academic_year_id: string
          class_id: string
          created_at?: string
          end_date?: string | null
          enrollment_date?: string
          establishment_id: string
          id?: string
          status?: string
          student_id: string
          transfer_reason?: string | null
        }
        Update: {
          academic_year_id?: string
          class_id?: string
          created_at?: string
          end_date?: string | null
          enrollment_date?: string
          establishment_id?: string
          id?: string
          status?: string
          student_id?: string
          transfer_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_enrollments_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "student_enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          note: string | null
          payment_date: string
          payment_method: string | null
          receipt_number: string | null
          reference: string | null
          student_tuition_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          note?: string | null
          payment_date?: string
          payment_method?: string | null
          receipt_number?: string | null
          reference?: string | null
          student_tuition_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          note?: string | null
          payment_date?: string
          payment_method?: string | null
          receipt_number?: string | null
          reference?: string | null
          student_tuition_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_payments_student_tuition_id_fkey"
            columns: ["student_tuition_id"]
            isOneToOne: false
            referencedRelation: "student_tuition"
            referencedColumns: ["id"]
          },
        ]
      }
      student_tuition: {
        Row: {
          amount_due: number
          created_at: string
          id: string
          status: string
          student_id: string
          tuition_plan_id: string
        }
        Insert: {
          amount_due: number
          created_at?: string
          id?: string
          status?: string
          student_id: string
          tuition_plan_id: string
        }
        Update: {
          amount_due?: number
          created_at?: string
          id?: string
          status?: string
          student_id?: string
          tuition_plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_tuition_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_tuition_tuition_plan_id_fkey"
            columns: ["tuition_plan_id"]
            isOneToOne: false
            referencedRelation: "tuition_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          address: string | null
          created_at: string
          date_of_birth: string | null
          first_name: string
          gender: string | null
          guardian_name: string | null
          guardian_phone: string | null
          id: string
          last_name: string
          matricule: string | null
          phone: string | null
          photo_url: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          date_of_birth?: string | null
          first_name: string
          gender?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          id?: string
          last_name: string
          matricule?: string | null
          phone?: string | null
          photo_url?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          date_of_birth?: string | null
          first_name?: string
          gender?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          id?: string
          last_name?: string
          matricule?: string | null
          phone?: string | null
          photo_url?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      subjects: {
        Row: {
          code: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      teacher_assignments: {
        Row: {
          academic_year_id: string
          class_id: string | null
          created_at: string
          end_date: string | null
          establishment_id: string
          id: string
          is_active: boolean
          rate: number | null
          rate_unit: string | null
          remuneration_type: string
          start_date: string | null
          subject_id: string | null
          teacher_id: string
        }
        Insert: {
          academic_year_id: string
          class_id?: string | null
          created_at?: string
          end_date?: string | null
          establishment_id: string
          id?: string
          is_active?: boolean
          rate?: number | null
          rate_unit?: string | null
          remuneration_type?: string
          start_date?: string | null
          subject_id?: string | null
          teacher_id: string
        }
        Update: {
          academic_year_id?: string
          class_id?: string | null
          created_at?: string
          end_date?: string | null
          establishment_id?: string
          id?: string
          is_active?: boolean
          rate?: number | null
          rate_unit?: string | null
          remuneration_type?: string
          start_date?: string | null
          subject_id?: string | null
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_assignments_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_assignments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_assignments_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_assignments_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
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
          academic_year_id: string | null
          amount: number
          created_at: string
          establishment_id: string | null
          id: string
          note: string | null
          payment_date: string
          payment_method: string | null
          period_end: string | null
          period_start: string | null
          reference: string | null
          teacher_id: string
        }
        Insert: {
          academic_year_id?: string | null
          amount: number
          created_at?: string
          establishment_id?: string | null
          id?: string
          note?: string | null
          payment_date?: string
          payment_method?: string | null
          period_end?: string | null
          period_start?: string | null
          reference?: string | null
          teacher_id: string
        }
        Update: {
          academic_year_id?: string | null
          amount?: number
          created_at?: string
          establishment_id?: string | null
          id?: string
          note?: string | null
          payment_date?: string
          payment_method?: string | null
          period_end?: string | null
          period_start?: string | null
          reference?: string | null
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_payments_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
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
      teacher_work_logs: {
        Row: {
          approved_at: string | null
          created_at: string
          hours: number | null
          id: string
          note: string | null
          sessions: number | null
          status: string
          teacher_assignment_id: string
          work_date: string
        }
        Insert: {
          approved_at?: string | null
          created_at?: string
          hours?: number | null
          id?: string
          note?: string | null
          sessions?: number | null
          status?: string
          teacher_assignment_id: string
          work_date: string
        }
        Update: {
          approved_at?: string | null
          created_at?: string
          hours?: number | null
          id?: string
          note?: string | null
          sessions?: number | null
          status?: string
          teacher_assignment_id?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_work_logs_teacher_assignment_id_fkey"
            columns: ["teacher_assignment_id"]
            isOneToOne: false
            referencedRelation: "teacher_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      teachers: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          first_name: string
          id: string
          last_name: string
          matricule: string | null
          phone: string | null
          specialties: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          first_name: string
          id?: string
          last_name: string
          matricule?: string | null
          phone?: string | null
          specialties?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string
          matricule?: string | null
          phone?: string | null
          specialties?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      tuition_plans: {
        Row: {
          academic_year_id: string
          class_id: string | null
          created_at: string
          establishment_id: string
          id: string
          name: string
          total_amount: number
        }
        Insert: {
          academic_year_id: string
          class_id?: string | null
          created_at?: string
          establishment_id: string
          id?: string
          name: string
          total_amount: number
        }
        Update: {
          academic_year_id?: string
          class_id?: string | null
          created_at?: string
          establishment_id?: string
          id?: string
          name?: string
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "tuition_plans_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tuition_plans_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tuition_plans_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_admin_establishment: { Args: never; Returns: string }
      current_admin_role: { Args: never; Returns: string }
      has_class_access: { Args: { target_class_id: string }; Returns: boolean }
      has_establishment_access: {
        Args: { target_establishment_id: string }
        Returns: boolean
      }
      has_student_access: {
        Args: { target_student_id: string }
        Returns: boolean
      }
      has_teacher_access: {
        Args: { target_teacher_id: string }
        Returns: boolean
      }
      is_director_general: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

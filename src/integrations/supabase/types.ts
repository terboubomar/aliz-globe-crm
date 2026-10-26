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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      attachments: {
        Row: {
          checksum: string
          created_at: string
          id: string
          mime: string
          refund_id: string | null
          size: number
          status: string
          storage_key: string
          ticket_id: string | null
          uploaded_by: string
        }
        Insert: {
          checksum: string
          created_at?: string
          id?: string
          mime: string
          refund_id?: string | null
          size: number
          status?: string
          storage_key: string
          ticket_id?: string | null
          uploaded_by: string
        }
        Update: {
          checksum?: string
          created_at?: string
          id?: string
          mime?: string
          refund_id?: string | null
          size?: number
          status?: string
          storage_key?: string
          ticket_id?: string | null
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor: string
          created_at: string
          entity_id: string
          id: string
        }
        Insert: {
          action: string
          actor: string
          created_at?: string
          entity_id: string
          id?: string
        }
        Update: {
          action?: string
          actor?: string
          created_at?: string
          entity_id?: string
          id?: string
        }
        Relationships: []
      }
      branches: {
        Row: {
          active: boolean
          address: string | null
          brand_id: string
          city: string
          code: string
          created_at: string
          district: string | null
          id: string
          latitude: number | null
          longitude: number | null
          maps_url: string | null
          name: string
          phone: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          brand_id: string
          city: string
          code: string
          created_at?: string
          district?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          maps_url?: string | null
          name: string
          phone?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          brand_id?: string
          city?: string
          code?: string
          created_at?: string
          district?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          maps_url?: string | null
          name?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branches_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          color: string
          created_at: string
          id: string
          logo: string
          name: string
          name_en: string
          status: string
        }
        Insert: {
          color: string
          created_at?: string
          id: string
          logo: string
          name: string
          name_en: string
          status?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          logo?: string
          name?: string
          name_en?: string
          status?: string
        }
        Relationships: []
      }
      idempotency: {
        Row: {
          expires_at: string
          key: string
          request_hash: string
          response_enc: string
        }
        Insert: {
          expires_at: string
          key: string
          request_hash: string
          response_enc: string
        }
        Update: {
          expires_at?: string
          key?: string
          request_hash?: string
          response_enc?: string
        }
        Relationships: []
      }
      outbox: {
        Row: {
          created_at: string
          id: string
          key: string
          status: string
          ticket_id: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          status?: string
          ticket_id: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          status?: string
          ticket_id?: string
          type?: string
        }
        Relationships: []
      }
      qrs: {
        Row: {
          active: boolean
          branch_id: string
          code_enc: string
          created_at: string
          hash: string
          id: string
          placement: string
          revoked_at: string | null
          scans: number
        }
        Insert: {
          active?: boolean
          branch_id: string
          code_enc: string
          created_at?: string
          hash: string
          id?: string
          placement?: string
          revoked_at?: string | null
          scans?: number
        }
        Update: {
          active?: boolean
          branch_id?: string
          code_enc?: string
          created_at?: string
          hash?: string
          id?: string
          placement?: string
          revoked_at?: string | null
          scans?: number
        }
        Relationships: [
          {
            foreignKeyName: "qrs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_events: {
        Row: {
          actor: string
          created_at: string
          id: string
          note_enc: string | null
          refund_id: string
          type: string
        }
        Insert: {
          actor: string
          created_at?: string
          id?: string
          note_enc?: string | null
          refund_id: string
          type: string
        }
        Update: {
          actor?: string
          created_at?: string
          id?: string
          note_enc?: string | null
          refund_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_events_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount_minor: number | null
          approver: string | null
          branch_id: string | null
          brand_id: string
          created_at: string
          external_order: string
          external_reference: string | null
          id: string
          kind: string
          platform: string
          processor: string | null
          proof_id: string | null
          reason_enc: string
          requester: string
          sequence: number
          status: string
          ticket_id: string | null
          updated_at: string
          verifier: string | null
          version: number
        }
        Insert: {
          amount_minor?: number | null
          approver?: string | null
          branch_id?: string | null
          brand_id: string
          created_at?: string
          external_order: string
          external_reference?: string | null
          id?: string
          kind: string
          platform: string
          processor?: string | null
          proof_id?: string | null
          reason_enc: string
          requester: string
          sequence?: number
          status?: string
          ticket_id?: string | null
          updated_at?: string
          verifier?: string | null
          version?: number
        }
        Update: {
          amount_minor?: number | null
          approver?: string | null
          branch_id?: string | null
          brand_id?: string
          created_at?: string
          external_order?: string
          external_reference?: string | null
          id?: string
          kind?: string
          platform?: string
          processor?: string | null
          proof_id?: string | null
          reason_enc?: string
          requester?: string
          sequence?: number
          status?: string
          ticket_id?: string | null
          updated_at?: string
          verifier?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "refunds_branch_id_brand_id_fkey"
            columns: ["branch_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "refunds_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_ticket_id_brand_id_fkey"
            columns: ["ticket_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      shifts: {
        Row: {
          break_end: string | null
          break_start: string | null
          cancelled_at: string | null
          created_at: string
          created_by: string
          day_off: boolean
          end_at: string
          id: string
          lead: boolean
          start_at: string
          user_id: string
          version: number
        }
        Insert: {
          break_end?: string | null
          break_start?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by: string
          day_off?: boolean
          end_at: string
          id?: string
          lead?: boolean
          start_at: string
          user_id: string
          version?: number
        }
        Update: {
          break_end?: string | null
          break_start?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by?: string
          day_off?: boolean
          end_at?: string
          id?: string
          lead?: boolean
          start_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      ticket_events: {
        Row: {
          actor: string
          created_at: string
          id: string
          note_enc: string | null
          ticket_id: string
          type: string
        }
        Insert: {
          actor: string
          created_at?: string
          id?: string
          note_enc?: string | null
          ticket_id: string
          type: string
        }
        Update: {
          actor?: string
          created_at?: string
          id?: string
          note_enc?: string | null
          ticket_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_timers: {
        Row: {
          breached_at: string | null
          completed_at: string | null
          due_at: string
          milestone: string
          ticket_id: string
          warning_at: string
        }
        Insert: {
          breached_at?: string | null
          completed_at?: string | null
          due_at: string
          milestone: string
          ticket_id: string
          warning_at: string
        }
        Update: {
          breached_at?: string | null
          completed_at?: string | null
          due_at?: string
          milestone?: string
          ticket_id?: string
          warning_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_timers_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          acknowledged_at: string | null
          action_completed_at: string | null
          branch_brief_enc: string | null
          branch_id: string | null
          brand_id: string
          category: string
          closed_at: string | null
          communications_owner: string
          created_at: string
          creator: string
          customer_confirmed_at: string | null
          customer_enc: string | null
          description_enc: string
          escalated: boolean
          external_order: string | null
          id: string
          legal_hold: boolean
          phone_hash: string | null
          platform: string | null
          priority: string
          receipt_enc: string | null
          received_at: string
          resolution_owner: string | null
          sequence: number
          sla_policy: Json
          source: string
          state: string
          unknown_reason: string | null
          version: number
        }
        Insert: {
          acknowledged_at?: string | null
          action_completed_at?: string | null
          branch_brief_enc?: string | null
          branch_id?: string | null
          brand_id: string
          category: string
          closed_at?: string | null
          communications_owner: string
          created_at?: string
          creator: string
          customer_confirmed_at?: string | null
          customer_enc?: string | null
          description_enc: string
          escalated?: boolean
          external_order?: string | null
          id?: string
          legal_hold?: boolean
          phone_hash?: string | null
          platform?: string | null
          priority: string
          receipt_enc?: string | null
          received_at: string
          resolution_owner?: string | null
          sequence: number
          sla_policy: Json
          source: string
          state?: string
          unknown_reason?: string | null
          version?: number
        }
        Update: {
          acknowledged_at?: string | null
          action_completed_at?: string | null
          branch_brief_enc?: string | null
          branch_id?: string | null
          brand_id?: string
          category?: string
          closed_at?: string | null
          communications_owner?: string
          created_at?: string
          creator?: string
          customer_confirmed_at?: string | null
          customer_enc?: string | null
          description_enc?: string
          escalated?: boolean
          external_order?: string | null
          id?: string
          legal_hold?: boolean
          phone_hash?: string | null
          platform?: string | null
          priority?: string
          receipt_enc?: string | null
          received_at?: string
          resolution_owner?: string | null
          sequence?: number
          sla_policy?: Json
          source?: string
          state?: string
          unknown_reason?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "tickets_branch_id_brand_id_fkey"
            columns: ["branch_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "tickets_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_access: {
        Row: {
          expires_at: string
          hash: string
          ticket_id: string
        }
        Insert: {
          expires_at: string
          hash: string
          ticket_id: string
        }
        Update: {
          expires_at?: string
          hash?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_access_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          branch_ids: string[]
          brand_ids: string[]
          created_at: string
          email: string
          enabled: boolean
          finance_duty: string
          name: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          branch_ids?: string[]
          brand_ids?: string[]
          created_at?: string
          email: string
          enabled?: boolean
          finance_duty?: string
          name: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          branch_ids?: string[]
          brand_ids?: string[]
          created_at?: string
          email?: string
          enabled?: boolean
          finance_duty?: string
          name?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_refund_action: {
        Args: {
          _actor: string
          _id: string
          _note_enc: string
          _type: string
          _version: number
          p: Json
        }
        Returns: undefined
      }
      apply_ticket_action: {
        Args: {
          _actor: string
          _events: Json
          _id: string
          _timers: Json
          _version: number
          p: Json
        }
        Returns: undefined
      }
      create_ticket_tx: { Args: { p: Json }; Returns: Json }
      current_staff: {
        Args: never
        Returns: {
          branch_ids: string[]
          brand_ids: string[]
          created_at: string
          email: string
          enabled: boolean
          finance_duty: string
          name: string
          role: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "user_roles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      next_ticket_sequence: { Args: never; Returns: number }
      qr_ensure: {
        Args: {
          _actor: string
          _branch: string
          _code_enc: string
          _hash: string
        }
        Returns: Json
      }
      qr_retire: {
        Args: {
          _actor: string
          _id: string
          _new_code_enc: string
          _new_hash: string
        }
        Returns: Json
      }
      refund_visible: {
        Args: {
          _branch: string
          _brand: string
          _requester: string
          _ticket: string
        }
        Returns: boolean
      }
      request_refund_tx: { Args: { p: Json }; Returns: string }
      save_shifts_tx: {
        Args: { _actor: string; _entries: Json }
        Returns: number
      }
      staff_in_scope: {
        Args: { _branch: string; _brand: string }
        Returns: boolean
      }
      ticket_visible: {
        Args: {
          _branch: string
          _brand: string
          _escalated: boolean
          _owner: string
        }
        Returns: boolean
      }
      write_audit: {
        Args: { _action: string; _actor: string; _entity: string }
        Returns: undefined
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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

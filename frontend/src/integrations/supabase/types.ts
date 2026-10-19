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
    PostgrestVersion: "14.4"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      appointments: {
        Row: {
          assigned_staff_id: string | null
          assigned_staff_name: string | null
          assigned_staff_role: string | null
          client_email: string | null
          client_id: string | null
          client_name: string
          client_phone: string | null
          completed_at: string | null
          confirmed_by_staff_id: string | null
          created_at: string | null
          created_by_staff_id: string | null
          id: string
          pet_age: number | null
          pet_gender: string | null
          pet_id: string | null
          pet_name: string
          pet_species: string
          reminder_sent: boolean | null
          requested_date: string | null
          scheduled_date: string | null
          scheduled_time: string | null
          service: string
          status: string | null
          updated_at: string
        }
        Insert: {
          assigned_staff_id?: string | null
          assigned_staff_name?: string | null
          assigned_staff_role?: string | null
          client_email?: string | null
          client_id?: string | null
          client_name: string
          client_phone?: string | null
          completed_at?: string | null
          confirmed_by_staff_id?: string | null
          created_at?: string | null
          created_by_staff_id?: string | null
          id?: string
          pet_age?: number | null
          pet_gender?: string | null
          pet_id?: string | null
          pet_name: string
          pet_species: string
          reminder_sent?: boolean | null
          requested_date?: string | null
          scheduled_date?: string | null
          scheduled_time?: string | null
          service: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          assigned_staff_id?: string | null
          assigned_staff_name?: string | null
          assigned_staff_role?: string | null
          client_email?: string | null
          client_id?: string | null
          client_name?: string
          client_phone?: string | null
          completed_at?: string | null
          confirmed_by_staff_id?: string | null
          created_at?: string | null
          created_by_staff_id?: string | null
          id?: string
          pet_age?: number | null
          pet_gender?: string | null
          pet_id?: string | null
          pet_name?: string
          pet_species?: string
          reminder_sent?: boolean | null
          requested_date?: string | null
          scheduled_date?: string | null
          scheduled_time?: string | null
          service?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_assigned_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_confirmed_by_staff_id_fkey"
            columns: ["confirmed_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      att_attempts: {
        Row: {
          att_id: string
          fails: number
          locked_until: string | null
        }
        Insert: {
          att_id: string
          fails?: number
          locked_until?: string | null
        }
        Update: {
          att_id?: string
          fails?: number
          locked_until?: string | null
        }
        Relationships: []
      }
      att_audit: {
        Row: {
          action: string
          at: string
          detail: string
          id: number
          who: string
        }
        Insert: {
          action: string
          at?: string
          detail: string
          id?: never
          who: string
        }
        Update: {
          action?: string
          at?: string
          detail?: string
          id?: never
          who?: string
        }
        Relationships: []
      }
      att_days: {
        Row: {
          am_in: string | null
          am_out: string | null
          att_id: string
          breaks: Json
          day: string
          in_at: string | null
          out_at: string | null
          pm_in: string | null
          pm_out: string | null
        }
        Insert: {
          am_in?: string | null
          am_out?: string | null
          att_id: string
          breaks?: Json
          day: string
          in_at?: string | null
          out_at?: string | null
          pm_in?: string | null
          pm_out?: string | null
        }
        Update: {
          am_in?: string | null
          am_out?: string | null
          att_id?: string
          breaks?: Json
          day?: string
          in_at?: string | null
          out_at?: string | null
          pm_in?: string | null
          pm_out?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "att_days_att_id_fkey"
            columns: ["att_id"]
            isOneToOne: false
            referencedRelation: "att_people"
            referencedColumns: ["att_id"]
          },
        ]
      }
      att_leave_types: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      att_leaves: {
        Row: {
          att_id: string
          created_at: string
          day: string
          note: string | null
          request_id: string | null
          type: string
        }
        Insert: {
          att_id: string
          created_at?: string
          day: string
          note?: string | null
          request_id?: string | null
          type: string
        }
        Update: {
          att_id?: string
          created_at?: string
          day?: string
          note?: string | null
          request_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "att_leaves_att_id_fkey"
            columns: ["att_id"]
            isOneToOne: false
            referencedRelation: "att_people"
            referencedColumns: ["att_id"]
          },
          {
            foreignKeyName: "att_leaves_type_fkey"
            columns: ["type"]
            isOneToOne: false
            referencedRelation: "att_leave_types"
            referencedColumns: ["name"]
          },
        ]
      }
      att_people: {
        Row: {
          active: boolean
          att_id: string
          break_end: string
          break_start: string
          created_at: string
          full_name: string
          pin_changed_at: string
          pin_hash: string
          role_text: string
          shift_end: string
          shift_start: string
          staff_id: string | null
          start_day: string
          work_days: number[]
        }
        Insert: {
          active?: boolean
          att_id: string
          break_end?: string
          break_start?: string
          created_at?: string
          full_name: string
          pin_changed_at?: string
          pin_hash: string
          role_text?: string
          shift_end: string
          shift_start: string
          staff_id?: string | null
          start_day?: string
          work_days?: number[]
        }
        Update: {
          active?: boolean
          att_id?: string
          break_end?: string
          break_start?: string
          created_at?: string
          full_name?: string
          pin_changed_at?: string
          pin_hash?: string
          role_text?: string
          shift_end?: string
          shift_start?: string
          staff_id?: string | null
          start_day?: string
          work_days?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "att_people_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: true
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      att_punches: {
        Row: {
          action: string
          at: string
          att_id: string | null
          id: number
          result: string
        }
        Insert: {
          action: string
          at?: string
          att_id?: string | null
          id?: never
          result: string
        }
        Update: {
          action?: string
          at?: string
          att_id?: string | null
          id?: never
          result?: string
        }
        Relationships: []
      }
      attendance_audit: {
        Row: {
          actor_name: string
          area: string
          attendance_date: string | null
          change_text: string
          created_at: string
          id: number
          reason: string | null
          staff_name: string | null
        }
        Insert: {
          actor_name: string
          area: string
          attendance_date?: string | null
          change_text: string
          created_at?: string
          id?: never
          reason?: string | null
          staff_name?: string | null
        }
        Update: {
          actor_name?: string
          area?: string
          attendance_date?: string | null
          change_text?: string
          created_at?: string
          id?: never
          reason?: string | null
          staff_name?: string | null
        }
        Relationships: []
      }
      attendance_rules: {
        Row: {
          break_end: string
          break_start: string
          created_at: string
          created_by: string | null
          effective_from: string
          late_grace_minutes: number
          overtime_min_minutes: number
          overtime_mode: string
          time_in: string
          time_out: string
        }
        Insert: {
          break_end: string
          break_start: string
          created_at?: string
          created_by?: string | null
          effective_from: string
          late_grace_minutes?: number
          overtime_min_minutes?: number
          overtime_mode?: string
          time_in: string
          time_out: string
        }
        Update: {
          break_end?: string
          break_start?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          late_grace_minutes?: number
          overtime_min_minutes?: number
          overtime_mode?: string
          time_in?: string
          time_out?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          metadata: Json | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      auth_events: {
        Row: {
          created_at: string
          email: string
          event: string
          id: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          event: string
          id?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          event?: string
          id?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      booking_categories: {
        Row: {
          break_end: string | null
          break_start: string | null
          closed_day: number
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          last_slot: string
          name: string
          opening_time: string
          slot_minutes: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          break_end?: string | null
          break_start?: string | null
          closed_day?: number
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          last_slot?: string
          name: string
          opening_time?: string
          slot_minutes?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          break_end?: string | null
          break_start?: string | null
          closed_day?: number
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          last_slot?: string
          name?: string
          opening_time?: string
          slot_minutes?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      breeds: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          species_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          species_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          species_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "breeds_species_id_fkey"
            columns: ["species_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          type?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          address: string | null
          created_at: string | null
          deleted_at: string | null
          email: string | null
          fb_messenger: string | null
          id: string
          name: string
          phone: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          fb_messenger?: string | null
          id?: string
          name: string
          phone?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          fb_messenger?: string | null
          id?: string
          name?: string
          phone?: string | null
        }
        Relationships: []
      }
      clinic_pins: {
        Row: {
          created_at: string
          pin: string
          pin_date: string
        }
        Insert: {
          created_at?: string
          pin: string
          pin_date: string
        }
        Update: {
          created_at?: string
          pin?: string
          pin_date?: string
        }
        Relationships: []
      }
      clinic_settings: {
        Row: {
          address: string | null
          clinic_name: string
          currency: string
          description: string | null
          email: string | null
          emergency_phone: string | null
          facebook_url: string | null
          id: string
          logo_url: string | null
          map_link: string | null
          phone_number: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          clinic_name?: string
          currency?: string
          description?: string | null
          email?: string | null
          emergency_phone?: string | null
          facebook_url?: string | null
          id?: string
          logo_url?: string | null
          map_link?: string | null
          phone_number?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          clinic_name?: string
          currency?: string
          description?: string | null
          email?: string | null
          emergency_phone?: string | null
          facebook_url?: string | null
          id?: string
          logo_url?: string | null
          map_link?: string | null
          phone_number?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      clinic_staff: {
        Row: {
          created_at: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      inventory: {
        Row: {
          category: string | null
          created_at: string | null
          id: string
          image_key: string | null
          name: string
          safety_stock: number
          stock: number | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          id?: string
          image_key?: string | null
          name: string
          safety_stock?: number
          stock?: number | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          id?: string
          image_key?: string | null
          name?: string
          safety_stock?: number
          stock?: number | null
        }
        Relationships: []
      }
      inventory_logs: {
        Row: {
          change_amount: number
          changed_by: string | null
          created_at: string
          id: string
          product_id: string | null
          reason: string
          source_id: string | null
          source_table: string | null
        }
        Insert: {
          change_amount: number
          changed_by?: string | null
          created_at?: string
          id?: string
          product_id?: string | null
          reason: string
          source_id?: string | null
          source_table?: string | null
        }
        Update: {
          change_amount?: number
          changed_by?: string | null
          created_at?: string
          id?: string
          product_id?: string | null
          reason?: string
          source_id?: string | null
          source_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_logs_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_logs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          id: string
          invoice_id: string
          quantity: number
          service_id: string | null
          service_name: string
          subtotal: number
          unit_price: number
        }
        Insert: {
          id?: string
          invoice_id: string
          quantity?: number
          service_id?: string | null
          service_name: string
          subtotal: number
          unit_price: number
        }
        Update: {
          id?: string
          invoice_id?: string
          quantity?: number
          service_id?: string | null
          service_name?: string
          subtotal?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          appointment_id: string
          checkout_url: string | null
          created_at: string | null
          id: string
          paid_at: string | null
          payment_reference: string | null
          total_amount: number
        }
        Insert: {
          appointment_id: string
          checkout_url?: string | null
          created_at?: string | null
          id?: string
          paid_at?: string | null
          payment_reference?: string | null
          total_amount?: number
        }
        Update: {
          appointment_id?: string
          checkout_url?: string | null
          created_at?: string | null
          id?: string
          paid_at?: string | null
          payment_reference?: string | null
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      medical_records: {
        Row: {
          created_at: string
          examinations: Json
          follow_up_date: string | null
          follow_up_note: string | null
          follow_up_set_on: string | null
          id: string
          images: Json
          lab: Json
          monitoring: Json
          owner_info: Json
          patient_info: Json
          pet_id: string
          physical_exam: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          examinations?: Json
          follow_up_date?: string | null
          follow_up_note?: string | null
          follow_up_set_on?: string | null
          id?: string
          images?: Json
          lab?: Json
          monitoring?: Json
          owner_info?: Json
          patient_info?: Json
          pet_id: string
          physical_exam?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          examinations?: Json
          follow_up_date?: string | null
          follow_up_note?: string | null
          follow_up_set_on?: string | null
          id?: string
          images?: Json
          lab?: Json
          monitoring?: Json
          owner_info?: Json
          patient_info?: Json
          pet_id?: string
          physical_exam?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medical_records_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: true
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          category: string | null
          client_user_id: string | null
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string
          related_id: string | null
          related_type: string | null
          title: string
          type: string | null
          user_id: string | null
        }
        Insert: {
          category?: string | null
          client_user_id?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          related_id?: string | null
          related_type?: string | null
          title: string
          type?: string | null
          user_id?: string | null
        }
        Update: {
          category?: string | null
          client_user_id?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          related_id?: string | null
          related_type?: string | null
          title?: string
          type?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          appointment_id: string | null
          created_at: string
          id: string
          invoice_id: string | null
          method: string | null
          paid_at: string
          recorded_by: string | null
          reference: string | null
        }
        Insert: {
          amount: number
          appointment_id?: string | null
          created_at?: string
          id?: string
          invoice_id?: string | null
          method?: string | null
          paid_at?: string
          recorded_by?: string | null
          reference?: string | null
        }
        Update: {
          amount?: number
          appointment_id?: string | null
          created_at?: string
          id?: string
          invoice_id?: string | null
          method?: string | null
          paid_at?: string
          recorded_by?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_reminders: {
        Row: {
          follow_up_date: string
          id: string
          owner_id: string
          pet_id: string
          sent_at: string
        }
        Insert: {
          follow_up_date: string
          id?: string
          owner_id: string
          pet_id: string
          sent_at?: string
        }
        Update: {
          follow_up_date?: string
          id?: string
          owner_id?: string
          pet_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pet_reminders_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      pets: {
        Row: {
          age: number | null
          breed: string | null
          color: string | null
          created_at: string | null
          deleted_at: string | null
          gender: string | null
          id: string
          is_favorite: boolean | null
          name: string
          neutered: string | null
          notes: string | null
          owner_id: string
          photo_url: string | null
          species: string
          weight: number | null
        }
        Insert: {
          age?: number | null
          breed?: string | null
          color?: string | null
          created_at?: string | null
          deleted_at?: string | null
          gender?: string | null
          id?: string
          is_favorite?: boolean | null
          name: string
          neutered?: string | null
          notes?: string | null
          owner_id: string
          photo_url?: string | null
          species: string
          weight?: number | null
        }
        Update: {
          age?: number | null
          breed?: string | null
          color?: string | null
          created_at?: string | null
          deleted_at?: string | null
          gender?: string | null
          id?: string
          is_favorite?: boolean | null
          name?: string
          neutered?: string | null
          notes?: string | null
          owner_id?: string
          photo_url?: string | null
          species?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pets_owner_id_cascade"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      product_sales: {
        Row: {
          id: string
          product_id: string
          product_name: string
          quantity: number
          sold_at: string | null
          sold_by_staff_id: string | null
          total_amount: number
          unit_price: number
        }
        Insert: {
          id?: string
          product_id: string
          product_name: string
          quantity: number
          sold_at?: string | null
          sold_by_staff_id?: string | null
          total_amount: number
          unit_price: number
        }
        Update: {
          id?: string
          product_id?: string
          product_name?: string
          quantity?: number
          sold_at?: string | null
          sold_by_staff_id?: string | null
          total_amount?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_sales_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_sales_sold_by_staff_id_fkey"
            columns: ["sold_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string
          cost_price: number | null
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_available: boolean | null
          name: string
          price: number
          safety_stock: number
          stock: number | null
        }
        Insert: {
          category: string
          cost_price?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          name: string
          price: number
          safety_stock?: number
          stock?: number | null
        }
        Update: {
          category?: string
          cost_price?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          name?: string
          price?: number
          safety_stock?: number
          stock?: number | null
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          id: string
          platform: string | null
          token: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          id?: string
          platform?: string | null
          token: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          id?: string
          platform?: string | null
          token?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      service_price_tiers: {
        Row: {
          id: string
          max_weight: number
          min_weight: number
          price: number
          service_id: string
        }
        Insert: {
          id?: string
          max_weight: number
          min_weight: number
          price: number
          service_id: string
        }
        Update: {
          id?: string
          max_weight?: number
          min_weight?: number
          price?: number
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_price_tiers_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          category: string
          cost_price: number | null
          created_at: string | null
          id: string
          name: string
          notes: string | null
          price: number | null
          pricing_type: string
        }
        Insert: {
          category: string
          cost_price?: number | null
          created_at?: string | null
          id?: string
          name: string
          notes?: string | null
          price?: number | null
          pricing_type?: string
        }
        Update: {
          category?: string
          cost_price?: number | null
          created_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          price?: number | null
          pricing_type?: string
        }
        Relationships: []
      }
      staff: {
        Row: {
          address: string | null
          avatar_url: string | null
          contact_number: string | null
          created_at: string | null
          email: string
          full_name: string
          id: string
          invited_by: string | null
          job_title: string | null
          license_number: string | null
          must_change_password: boolean
          phone: string | null
          protected: boolean
          role: string | null
          secondary_title: string | null
          short_bio: string | null
          status: string | null
          title: string | null
          updated_at: string
          user_id: string | null
          years_of_experience: number | null
        }
        Insert: {
          address?: string | null
          avatar_url?: string | null
          contact_number?: string | null
          created_at?: string | null
          email: string
          full_name: string
          id?: string
          invited_by?: string | null
          job_title?: string | null
          license_number?: string | null
          must_change_password?: boolean
          phone?: string | null
          protected?: boolean
          role?: string | null
          secondary_title?: string | null
          short_bio?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string | null
          years_of_experience?: number | null
        }
        Update: {
          address?: string | null
          avatar_url?: string | null
          contact_number?: string | null
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          invited_by?: string | null
          job_title?: string | null
          license_number?: string | null
          must_change_password?: boolean
          phone?: string | null
          protected?: boolean
          role?: string | null
          secondary_title?: string | null
          short_bio?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string | null
          years_of_experience?: number | null
        }
        Relationships: []
      }
      staff_attendance: {
        Row: {
          attendance_date: string
          break_end_at: string | null
          break_minutes: number
          break_start_at: string | null
          clock_in_at: string | null
          clock_out_at: string | null
          created_at: string
          edit_reason: string | null
          edited: boolean
          id: string
          note: string | null
          recorded_by: string | null
          staff_id: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          attendance_date: string
          break_end_at?: string | null
          break_minutes?: number
          break_start_at?: string | null
          clock_in_at?: string | null
          clock_out_at?: string | null
          created_at?: string
          edit_reason?: string | null
          edited?: boolean
          id?: string
          note?: string | null
          recorded_by?: string | null
          staff_id: string
          status: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          attendance_date?: string
          break_end_at?: string | null
          break_minutes?: number
          break_start_at?: string | null
          clock_in_at?: string | null
          clock_out_at?: string | null
          created_at?: string
          edit_reason?: string | null
          edited?: boolean
          id?: string
          note?: string | null
          recorded_by?: string | null
          staff_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_attendance_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_attendance_audit: {
        Row: {
          attendance_id: string
          changed_at: string
          changed_by: string | null
          id: number
          new_record: Json | null
          old_record: Json | null
          operation: string
          staff_id: string
        }
        Insert: {
          attendance_id: string
          changed_at?: string
          changed_by?: string | null
          id?: never
          new_record?: Json | null
          old_record?: Json | null
          operation: string
          staff_id: string
        }
        Update: {
          attendance_id?: string
          changed_at?: string
          changed_by?: string | null
          id?: never
          new_record?: Json | null
          old_record?: Json | null
          operation?: string
          staff_id?: string
        }
        Relationships: []
      }
      staff_attendance_requests: {
        Row: {
          approved_minutes: number | null
          attendance_date: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          kind: string
          reason: string
          requested_minutes: number | null
          staff_id: string
          status: string
        }
        Insert: {
          approved_minutes?: number | null
          attendance_date: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          kind: string
          reason: string
          requested_minutes?: number | null
          staff_id: string
          status?: string
        }
        Update: {
          approved_minutes?: number | null
          attendance_date?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          kind?: string
          reason?: string
          requested_minutes?: number | null
          staff_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_attendance_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_attendance_requests_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_attendance_schedule: {
        Row: {
          break_end: string | null
          break_start: string | null
          id: boolean
          late_grace_minutes: number
          overtime_min_minutes: number
          time_in: string | null
          time_out: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          break_end?: string | null
          break_start?: string | null
          id?: boolean
          late_grace_minutes?: number
          overtime_min_minutes?: number
          time_in?: string | null
          time_out?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          break_end?: string | null
          break_start?: string | null
          id?: boolean
          late_grace_minutes?: number
          overtime_min_minutes?: number
          time_in?: string | null
          time_out?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_attendance_schedule_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_shifts: {
        Row: {
          break_end: string | null
          break_start: string | null
          mode: string
          staff_id: string
          time_in: string | null
          time_out: string | null
          updated_at: string
          updated_by: string | null
          work_days: number[]
        }
        Insert: {
          break_end?: string | null
          break_start?: string | null
          mode?: string
          staff_id: string
          time_in?: string | null
          time_out?: string | null
          updated_at?: string
          updated_by?: string | null
          work_days?: number[]
        }
        Update: {
          break_end?: string | null
          break_start?: string | null
          mode?: string
          staff_id?: string
          time_in?: string | null
          time_out?: string | null
          updated_at?: string
          updated_by?: string | null
          work_days?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "staff_shifts_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: true
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_shifts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      user_avatar_history: {
        Row: {
          created_at: string | null
          id: string
          photo_url: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          photo_url: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          photo_url?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      att_audit_add: {
        Args: { p_action: string; p_detail: string }
        Returns: undefined
      }
      att_clock: {
        Args: { p_action: string; p_id: string; p_pin: string }
        Returns: Json
      }
      att_issue_id: {
        Args: {
          p_pin: string
          p_shift_end: string
          p_shift_start: string
          p_staff_id: string
        }
        Returns: string
      }
      att_leave_remove_request: {
        Args: { p_request_id: string }
        Returns: number
      }
      att_leave_type_add: { Args: { p_name: string }; Returns: undefined }
      att_leave_type_delete: { Args: { p_id: string }; Returns: undefined }
      att_leave_type_rename: {
        Args: { p_id: string; p_name: string }
        Returns: undefined
      }
      att_log: {
        Args: { p_action: string; p_id: string; p_result: string }
        Returns: undefined
      }
      att_mark_leave: {
        Args: {
          p_att_id: string
          p_day: string
          p_note?: string
          p_type: string
        }
        Returns: undefined
      }
      att_mark_leave_range: {
        Args: {
          p_att_id: string
          p_from: string
          p_note?: string
          p_to: string
          p_type: string
        }
        Returns: Json
      }
      att_next_id: { Args: never; Returns: string }
      att_remove_leave: {
        Args: { p_att_id: string; p_day: string }
        Returns: undefined
      }
      att_reset_pin: { Args: { p_att_id: string }; Returns: string }
      att_set_active: {
        Args: { p_active: boolean; p_att_id: string }
        Returns: undefined
      }
      att_set_break_window: {
        Args: { p_att_id: string; p_end: string; p_start: string }
        Returns: undefined
      }
      att_set_work_days: {
        Args: { p_att_id: string; p_days: number[] }
        Returns: undefined
      }
      att_today_board: { Args: never; Returns: Json }
      att_worked_minutes: {
        Args: {
          p_bend: string
          p_bstart: string
          p_day: string
          p_in: string
          p_out: string
        }
        Returns: number
      }
      attendance_actor_name: { Args: never; Returns: string }
      attendance_days_text: { Args: { days: unknown }; Returns: string }
      attendance_is_admin: { Args: never; Returns: boolean }
      attendance_is_owner: { Args: never; Returns: boolean }
      attendance_random_pin: { Args: never; Returns: string }
      attendance_request_label: { Args: { kind: string }; Returns: string }
      attendance_staff_name: { Args: { p_staff_id: string }; Returns: string }
      attendance_today: { Args: never; Returns: string }
      cancel_my_appointment: {
        Args: { appointment_id: string }
        Returns: undefined
      }
      complete_password_change: { Args: never; Returns: undefined }
      decide_attendance_request: {
        Args: {
          p_approved_minutes?: number
          p_decision: string
          p_id: string
          p_note?: string
        }
        Returns: undefined
      }
      delete_service_category: {
        Args: { p_id: string; p_move_to?: string }
        Returns: undefined
      }
      get_clinic_pin: { Args: never; Returns: string }
      get_taken_times: {
        Args: { p_date: string }
        Returns: {
          scheduled_time: string
        }[]
      }
      is_active_staff:
        | { Args: never; Returns: boolean }
        | { Args: { uid: string }; Returns: boolean }
      is_admin:
        | { Args: never; Returns: boolean }
        | { Args: { uid: string }; Returns: boolean }
      is_clinic_staff: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      new_clinic_pin: { Args: never; Returns: string }
      prune_auth_events: { Args: never; Returns: undefined }
      record_product_sale: {
        Args: { p_product_id: string; p_quantity: number; p_staff_id: string }
        Returns: string
      }
      register_push_token: {
        Args: { p_platform: string; p_token: string }
        Returns: undefined
      }
      rename_service_category: {
        Args: { p_id: string; p_new_name: string }
        Returns: undefined
      }
      send_appointment_reminders: { Args: never; Returns: undefined }
      send_grooming_reminders: { Args: never; Returns: undefined }
      send_medication_reminders: { Args: never; Returns: undefined }
      send_vaccination_reminders: { Args: never; Returns: undefined }
      staff_attendance_request: {
        Args: {
          p_date: string
          p_kind: string
          p_minutes?: number
          p_reason: string
        }
        Returns: string
      }
      staff_clock: {
        Args: { p_action: string; p_pin?: string }
        Returns: undefined
      }
      support_assign_conversation: {
        Args: { p_conversation_id: string; p_staff_id: string }
        Returns: undefined
      }
      support_client_id: { Args: never; Returns: string }
      support_close_conversation: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      support_create_conversation: {
        Args: { p_attachments?: Json; p_first_message?: string }
        Returns: string
      }
      support_is_active_staff: { Args: never; Returns: boolean }
      support_mark_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      update_my_staff_profile: {
        Args: {
          p_avatar_url: string
          p_full_name: string
          p_phone: string
          p_title: string
        }
        Returns: undefined
      }
    }
    Enums: {
      support_conversation_status: "open" | "closed"
      support_message_sender_kind: "client" | "staff"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      support_conversation_status: ["open", "closed"],
      support_message_sender_kind: ["client", "staff"],
    },
  },
} as const

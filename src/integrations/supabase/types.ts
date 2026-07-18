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
      access_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json
          target_id: string | null
          target_type: string | null
          trip_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          target_id?: string | null
          target_type?: string | null
          trip_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          target_id?: string | null
          target_type?: string | null
          trip_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_audit_log_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      accommodations: {
        Row: {
          address_private: string | null
          area_public: string | null
          booking_ref: string | null
          check_in: string | null
          check_out: string | null
          cost: number | null
          currency: string | null
          day_id: string
          id: string
          lat: number | null
          lng: number | null
          missing: boolean
          name: string
          notes: string | null
        }
        Insert: {
          address_private?: string | null
          area_public?: string | null
          booking_ref?: string | null
          check_in?: string | null
          check_out?: string | null
          cost?: number | null
          currency?: string | null
          day_id: string
          id?: string
          lat?: number | null
          lng?: number | null
          missing?: boolean
          name: string
          notes?: string | null
        }
        Update: {
          address_private?: string | null
          area_public?: string | null
          booking_ref?: string | null
          check_in?: string | null
          check_out?: string | null
          cost?: number | null
          currency?: string | null
          day_id?: string
          id?: string
          lat?: number | null
          lng?: number | null
          missing?: boolean
          name?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accommodations_day_id_fkey"
            columns: ["day_id"]
            isOneToOne: false
            referencedRelation: "itinerary_days"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
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
      badges: {
        Row: {
          code: string
          description: string | null
          icon: string | null
          id: string
          name: string
        }
        Insert: {
          code: string
          description?: string | null
          icon?: string | null
          id?: string
          name: string
        }
        Update: {
          code?: string
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      block_list: {
        Row: {
          blocked_at: string
          id: string
          reason: string | null
          user_id: string | null
          visitor_token: string | null
        }
        Insert: {
          blocked_at?: string
          id?: string
          reason?: string | null
          user_id?: string | null
          visitor_token?: string | null
        }
        Update: {
          blocked_at?: string
          id?: string
          reason?: string | null
          user_id?: string | null
          visitor_token?: string | null
        }
        Relationships: []
      }
      booking_uploads: {
        Row: {
          applied_at: string | null
          approved_by: string | null
          booking_type: string | null
          created_at: string
          file_path: string | null
          id: string
          notes: string | null
          parsed_json: Json
          raw_text: string | null
          source_kind: string
          status: Database["public"]["Enums"]["booking_upload_status"]
          suggested_changes: Json
          trip_id: string
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          applied_at?: string | null
          approved_by?: string | null
          booking_type?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          notes?: string | null
          parsed_json?: Json
          raw_text?: string | null
          source_kind: string
          status?: Database["public"]["Enums"]["booking_upload_status"]
          suggested_changes?: Json
          trip_id: string
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          applied_at?: string | null
          approved_by?: string | null
          booking_type?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          notes?: string | null
          parsed_json?: Json
          raw_text?: string | null
          source_kind?: string
          status?: Database["public"]["Enums"]["booking_upload_status"]
          suggested_changes?: Json
          trip_id?: string
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_uploads_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          cost: number | null
          currency: string | null
          document_id: string | null
          ends_at: string | null
          id: string
          kind: string
          missing: boolean
          notes: string | null
          provider: string | null
          reference: string | null
          starts_at: string | null
          trip_id: string
        }
        Insert: {
          cost?: number | null
          currency?: string | null
          document_id?: string | null
          ends_at?: string | null
          id?: string
          kind: string
          missing?: boolean
          notes?: string | null
          provider?: string | null
          reference?: string | null
          starts_at?: string | null
          trip_id: string
        }
        Update: {
          cost?: number | null
          currency?: string | null
          document_id?: string | null
          ends_at?: string | null
          id?: string
          kind?: string
          missing?: boolean
          notes?: string | null
          provider?: string | null
          reference?: string | null
          starts_at?: string | null
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          post_id: string
          status: Database["public"]["Enums"]["post_status"]
          visitor_label: string | null
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          post_id: string
          status?: Database["public"]["Enums"]["post_status"]
          visitor_label?: string | null
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          post_id?: string
          status?: Database["public"]["Enums"]["post_status"]
          visitor_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      content_reports: {
        Row: {
          created_at: string
          id: string
          reason: string | null
          reporter_id: string | null
          target_id: string
          target_type: string
          visitor_token: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          reason?: string | null
          reporter_id?: string | null
          target_id: string
          target_type: string
          visitor_token?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string | null
          reporter_id?: string | null
          target_id?: string
          target_type?: string
          visitor_token?: string | null
        }
        Relationships: []
      }
      cost_payers: {
        Row: {
          created_at: string
          id: string
          name: string
          trip_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          trip_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_payers_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_share_snapshots: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          payload: Json
          token: string
          trip_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string
          payload: Json
          token: string
          trip_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          payload?: Json
          token?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_share_snapshots_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      day_travellers: {
        Row: {
          child_key: string | null
          day_id: string
          id: string
          user_id: string | null
        }
        Insert: {
          child_key?: string | null
          day_id: string
          id?: string
          user_id?: string | null
        }
        Update: {
          child_key?: string | null
          day_id?: string
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "day_travellers_day_id_fkey"
            columns: ["day_id"]
            isOneToOne: false
            referencedRelation: "itinerary_days"
            referencedColumns: ["id"]
          },
        ]
      }
      destination_photos: {
        Row: {
          caption: string | null
          created_at: string
          day_id: string
          id: string
          is_cover: boolean
          post_id: string | null
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          day_id: string
          id?: string
          is_cover?: boolean
          post_id?: string | null
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          day_id?: string
          id?: string
          is_cover?: boolean
          post_id?: string | null
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "destination_photos_day_id_fkey"
            columns: ["day_id"]
            isOneToOne: false
            referencedRelation: "itinerary_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "destination_photos_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string
          expires_on: string | null
          id: string
          kind: string
          mime_type: string | null
          owner_id: string
          size_bytes: number | null
          storage_path: string
          title: string
          trip_id: string
        }
        Insert: {
          created_at?: string
          expires_on?: string | null
          id?: string
          kind: string
          mime_type?: string | null
          owner_id: string
          size_bytes?: number | null
          storage_path: string
          title: string
          trip_id: string
        }
        Update: {
          created_at?: string
          expires_on?: string | null
          id?: string
          kind?: string
          mime_type?: string | null
          owner_id?: string
          size_bytes?: number | null
          storage_path?: string
          title?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_contacts: {
        Row: {
          id: string
          name: string
          phone: string
          relation: string | null
          trip_id: string
          visible_to_members: boolean
        }
        Insert: {
          id?: string
          name: string
          phone: string
          relation?: string | null
          trip_id: string
          visible_to_members?: boolean
        }
        Update: {
          id?: string
          name?: string
          phone?: string
          relation?: string | null
          trip_id?: string
          visible_to_members?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "emergency_contacts_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      fuel_logs: {
        Row: {
          by_user: string | null
          cost: number | null
          currency: string | null
          id: string
          litres: number | null
          odometer_km: number | null
          station: string | null
          ts: string
          vehicle_id: string
        }
        Insert: {
          by_user?: string | null
          cost?: number | null
          currency?: string | null
          id?: string
          litres?: number | null
          odometer_km?: number | null
          station?: string | null
          ts?: string
          vehicle_id: string
        }
        Update: {
          by_user?: string | null
          cost?: number | null
          currency?: string | null
          id?: string
          litres?: number | null
          odometer_km?: number | null
          station?: string | null
          ts?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fuel_logs_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_scores: {
        Row: {
          points: number
          trip_id: string
        }
        Insert: {
          points?: number
          trip_id: string
        }
        Update: {
          points?: number
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_scores_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: true
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      individual_scores: {
        Row: {
          points: number
          trip_id: string
          user_id: string
        }
        Insert: {
          points?: number
          trip_id: string
          user_id: string
        }
        Update: {
          points?: number
          trip_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "individual_scores_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      itinerary_days: {
        Row: {
          cover_photo_path: string | null
          day_date: string
          day_kind: Database["public"]["Enums"]["day_kind"]
          distance_km: number | null
          duration_min: number | null
          id: string
          leg: Json
          summary_private: string | null
          summary_public: string | null
          title: string
          trip_id: string
        }
        Insert: {
          cover_photo_path?: string | null
          day_date: string
          day_kind?: Database["public"]["Enums"]["day_kind"]
          distance_km?: number | null
          duration_min?: number | null
          id?: string
          leg?: Json
          summary_private?: string | null
          summary_public?: string | null
          title: string
          trip_id: string
        }
        Update: {
          cover_photo_path?: string | null
          day_date?: string
          day_kind?: Database["public"]["Enums"]["day_kind"]
          distance_km?: number | null
          duration_min?: number | null
          id?: string
          leg?: Json
          summary_private?: string | null
          summary_public?: string | null
          title?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "itinerary_days_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      location_points: {
        Row: {
          accuracy_m: number | null
          id: number
          is_parked: boolean
          lat: number
          lng: number
          sanitised: boolean
          speed_kph: number | null
          trip_id: string
          ts: string
          user_id: string
        }
        Insert: {
          accuracy_m?: number | null
          id?: number
          is_parked?: boolean
          lat: number
          lng: number
          sanitised?: boolean
          speed_kph?: number | null
          trip_id: string
          ts?: string
          user_id: string
        }
        Update: {
          accuracy_m?: number | null
          id?: number
          is_parked?: boolean
          lat?: number
          lng?: number
          sanitised?: boolean
          speed_kph?: number | null
          trip_id?: string
          ts?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_points_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_items: {
        Row: {
          done: boolean
          due_at: string | null
          due_km: number | null
          id: string
          title: string
          vehicle_id: string
        }
        Insert: {
          done?: boolean
          due_at?: string | null
          due_km?: number | null
          id?: string
          title: string
          vehicle_id: string
        }
        Update: {
          done?: boolean
          due_at?: string | null
          due_km?: number | null
          id?: string
          title?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_items_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_logs: {
        Row: {
          cost: number | null
          id: string
          notes: string | null
          odometer_km: number | null
          title: string
          ts: string
          vehicle_id: string
        }
        Insert: {
          cost?: number | null
          id?: string
          notes?: string | null
          odometer_km?: number | null
          title: string
          ts?: string
          vehicle_id: string
        }
        Update: {
          cost?: number | null
          id?: string
          notes?: string | null
          odometer_km?: number | null
          title?: string
          ts?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_logs_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mission_completions: {
        Row: {
          completed_at: string
          id: string
          mission_id: string
          proof_post_id: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string
          id?: string
          mission_id: string
          proof_post_id?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string
          id?: string
          mission_id?: string
          proof_post_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mission_completions_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
        ]
      }
      missions: {
        Row: {
          day_id: string | null
          description: string | null
          id: string
          is_fez: boolean
          is_group: boolean
          points: number
          title: string
          trip_id: string
          visibility: Database["public"]["Enums"]["post_visibility"]
        }
        Insert: {
          day_id?: string | null
          description?: string | null
          id?: string
          is_fez?: boolean
          is_group?: boolean
          points?: number
          title: string
          trip_id: string
          visibility?: Database["public"]["Enums"]["post_visibility"]
        }
        Update: {
          day_id?: string | null
          description?: string | null
          id?: string
          is_fez?: boolean
          is_group?: boolean
          points?: number
          title?: string
          trip_id?: string
          visibility?: Database["public"]["Enums"]["post_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "missions_day_id_fkey"
            columns: ["day_id"]
            isOneToOne: false
            referencedRelation: "itinerary_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missions_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          email_enabled: boolean
          push_enabled: boolean
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          snoozed_until: string | null
          user_id: string
          whatsapp_enabled: boolean
          whatsapp_number: string | null
        }
        Insert: {
          email_enabled?: boolean
          push_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          snoozed_until?: string | null
          user_id: string
          whatsapp_enabled?: boolean
          whatsapp_number?: string | null
        }
        Update: {
          email_enabled?: boolean
          push_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          snoozed_until?: string | null
          user_id?: string
          whatsapp_enabled?: boolean
          whatsapp_number?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          cancelled_at: string | null
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          id: string
          kind: string
          payload: Json
          read_at: string | null
          related_id: string | null
          related_type: string | null
          scheduled_for: string
          sent_at: string | null
          title: string
          trip_id: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          cancelled_at?: string | null
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          read_at?: string | null
          related_id?: string | null
          related_type?: string | null
          scheduled_for: string
          sent_at?: string | null
          title: string
          trip_id?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          cancelled_at?: string | null
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          read_at?: string | null
          related_id?: string | null
          related_type?: string | null
          scheduled_for?: string
          sent_at?: string | null
          title?: string
          trip_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      passenger_invitations: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          created_by: string
          email: string
          ends_on: string | null
          expires_at: string
          friendly_slug: string
          id: string
          name: string
          permissions: Json
          phone: string | null
          revoked_at: string | null
          starts_on: string | null
          token_hash: string
          trip_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          created_by: string
          email: string
          ends_on?: string | null
          expires_at: string
          friendly_slug: string
          id?: string
          name: string
          permissions?: Json
          phone?: string | null
          revoked_at?: string | null
          starts_on?: string | null
          token_hash: string
          trip_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          created_by?: string
          email?: string
          ends_on?: string | null
          expires_at?: string
          friendly_slug?: string
          id?: string
          name?: string
          permissions?: Json
          phone?: string | null
          revoked_at?: string | null
          starts_on?: string | null
          token_hash?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "passenger_invitations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      post_media: {
        Row: {
          height: number | null
          id: string
          is_public: boolean
          media_type: string
          post_id: string
          storage_path: string
          width: number | null
        }
        Insert: {
          height?: number | null
          id?: string
          is_public?: boolean
          media_type?: string
          post_id: string
          storage_path: string
          width?: number | null
        }
        Update: {
          height?: number | null
          id?: string
          is_public?: boolean
          media_type?: string
          post_id?: string
          storage_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "post_media_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_id: string
          body: string
          created_at: string
          day_id: string | null
          id: string
          status: Database["public"]["Enums"]["post_status"]
          trip_id: string
          visibility: Database["public"]["Enums"]["post_visibility"]
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          day_id?: string | null
          id?: string
          status?: Database["public"]["Enums"]["post_status"]
          trip_id: string
          visibility?: Database["public"]["Enums"]["post_visibility"]
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          day_id?: string | null
          id?: string
          status?: Database["public"]["Enums"]["post_status"]
          trip_id?: string
          visibility?: Database["public"]["Enums"]["post_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "posts_day_id_fkey"
            columns: ["day_id"]
            isOneToOne: false
            referencedRelation: "itinerary_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string
          id: string
          is_child: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          id: string
          is_child?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          is_child?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      public_location_points: {
        Row: {
          id: number
          lat_approx: number
          lng_approx: number
          trip_id: string
          ts: string
        }
        Insert: {
          id?: number
          lat_approx: number
          lng_approx: number
          trip_id: string
          ts: string
        }
        Update: {
          id?: number
          lat_approx?: number
          lng_approx?: number
          trip_id?: string
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_location_points_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          endpoint: string
          id: string
          label: string | null
          last_used_at: string | null
          p256dh: string
          user_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string
          endpoint: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          p256dh: string
          user_id: string
        }
        Update: {
          auth_key?: string
          created_at?: string
          endpoint?: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      rate_limit_buckets: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start?: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          post_id: string
          user_id: string | null
          visitor_token: string | null
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          post_id: string
          user_id?: string | null
          visitor_token?: string | null
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          post_id?: string
          user_id?: string | null
          visitor_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendations: {
        Row: {
          author_id: string | null
          body: string | null
          city: string | null
          country: string | null
          created_at: string
          id: string
          status: Database["public"]["Enums"]["post_status"]
          title: string
          trip_id: string
          visitor_label: string | null
        }
        Insert: {
          author_id?: string | null
          body?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["post_status"]
          title: string
          trip_id: string
          visitor_label?: string | null
        }
        Update: {
          author_id?: string | null
          body?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["post_status"]
          title?: string
          trip_id?: string
          visitor_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      role_bootstrap: {
        Row: {
          email: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          email: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          email?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      side_quests: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          points: number
          title: string
          trip_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          points?: number
          title: string
          trip_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          points?: number
          title?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "side_quests_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      translations: {
        Row: {
          created_at: string
          source: string
          source_hash: string
          target_lang: string
          translated: string
        }
        Insert: {
          created_at?: string
          source: string
          source_hash: string
          target_lang: string
          translated: string
        }
        Update: {
          created_at?: string
          source?: string
          source_hash?: string
          target_lang?: string
          translated?: string
        }
        Relationships: []
      }
      transport_legs: {
        Row: {
          day_id: string
          distance_km: number | null
          duration_min: number | null
          from_place: string
          id: string
          mode: string
          polyline: string | null
          to_place: string
        }
        Insert: {
          day_id: string
          distance_km?: number | null
          duration_min?: number | null
          from_place: string
          id?: string
          mode?: string
          polyline?: string | null
          to_place: string
        }
        Update: {
          day_id?: string
          distance_km?: number | null
          duration_min?: number | null
          from_place?: string
          id?: string
          mode?: string
          polyline?: string | null
          to_place?: string
        }
        Relationships: [
          {
            foreignKeyName: "transport_legs_day_id_fkey"
            columns: ["day_id"]
            isOneToOne: false
            referencedRelation: "itinerary_days"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_cost_splits: {
        Row: {
          cost_id: string
          id: string
          participant_key: string | null
          participant_user_id: string | null
          share_eur: number
        }
        Insert: {
          cost_id: string
          id?: string
          participant_key?: string | null
          participant_user_id?: string | null
          share_eur: number
        }
        Update: {
          cost_id?: string
          id?: string
          participant_key?: string | null
          participant_user_id?: string | null
          share_eur?: number
        }
        Relationships: [
          {
            foreignKeyName: "trip_cost_splits_cost_id_fkey"
            columns: ["cost_id"]
            isOneToOne: false
            referencedRelation: "trip_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_costs: {
        Row: {
          amount_eur: number
          approved_at: string | null
          approved_by: string | null
          category: string
          created_at: string
          created_by: string
          day_date: string
          description: string | null
          id: string
          original_amount: number | null
          original_currency: string | null
          paid_by: string | null
          paid_by_label: string | null
          payer_id: string | null
          receipt_path: string | null
          status: Database["public"]["Enums"]["cost_status"]
          trip_id: string
          updated_at: string
        }
        Insert: {
          amount_eur: number
          approved_at?: string | null
          approved_by?: string | null
          category?: string
          created_at?: string
          created_by: string
          day_date: string
          description?: string | null
          id?: string
          original_amount?: number | null
          original_currency?: string | null
          paid_by?: string | null
          paid_by_label?: string | null
          payer_id?: string | null
          receipt_path?: string | null
          status?: Database["public"]["Enums"]["cost_status"]
          trip_id: string
          updated_at?: string
        }
        Update: {
          amount_eur?: number
          approved_at?: string | null
          approved_by?: string | null
          category?: string
          created_at?: string
          created_by?: string
          day_date?: string
          description?: string | null
          id?: string
          original_amount?: number | null
          original_currency?: string | null
          paid_by?: string | null
          paid_by_label?: string | null
          payer_id?: string | null
          receipt_path?: string | null
          status?: Database["public"]["Enums"]["cost_status"]
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_costs_payer_id_fkey"
            columns: ["payer_id"]
            isOneToOne: false
            referencedRelation: "cost_payers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_costs_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_members: {
        Row: {
          created_at: string
          ends_on: string | null
          id: string
          permissions: Json
          revoked_at: string | null
          role_in_trip: string
          starts_on: string | null
          status: Database["public"]["Enums"]["trip_member_status"]
          trip_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ends_on?: string | null
          id?: string
          permissions?: Json
          revoked_at?: string | null
          role_in_trip?: string
          starts_on?: string | null
          status?: Database["public"]["Enums"]["trip_member_status"]
          trip_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          ends_on?: string | null
          id?: string
          permissions?: Json
          revoked_at?: string | null
          role_in_trip?: string
          starts_on?: string | null
          status?: Database["public"]["Enums"]["trip_member_status"]
          trip_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_members_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          created_at: string
          ends_on: string
          id: string
          name: string
          owner_id: string
          public_slug: string | null
          public_tracking_enabled: boolean
          slug: string
          starts_on: string
        }
        Insert: {
          created_at?: string
          ends_on: string
          id?: string
          name: string
          owner_id: string
          public_slug?: string | null
          public_tracking_enabled?: boolean
          slug: string
          starts_on: string
        }
        Update: {
          created_at?: string
          ends_on?: string
          id?: string
          name?: string
          owner_id?: string
          public_slug?: string | null
          public_tracking_enabled?: boolean
          slug?: string
          starts_on?: string
        }
        Relationships: []
      }
      user_badges: {
        Row: {
          awarded_at: string
          badge_id: string
          id: string
          trip_id: string | null
          user_id: string
        }
        Insert: {
          awarded_at?: string
          badge_id: string
          id?: string
          trip_id?: string | null
          user_id: string
        }
        Update: {
          awarded_at?: string
          badge_id?: string
          id?: string
          trip_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_badges_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "badges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_badges_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicle_check_ins: {
        Row: {
          by_user: string | null
          fluids_ok: boolean | null
          id: string
          lights_ok: boolean | null
          notes: string | null
          odometer_km: number | null
          ts: string
          tyre_pressure_ok: boolean | null
          vehicle_id: string
        }
        Insert: {
          by_user?: string | null
          fluids_ok?: boolean | null
          id?: string
          lights_ok?: boolean | null
          notes?: string | null
          odometer_km?: number | null
          ts?: string
          tyre_pressure_ok?: boolean | null
          vehicle_id: string
        }
        Update: {
          by_user?: string | null
          fluids_ok?: boolean | null
          id?: string
          lights_ok?: boolean | null
          notes?: string | null
          odometer_km?: number | null
          ts?: string
          tyre_pressure_ok?: boolean | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_check_ins_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_profiles: {
        Row: {
          current_odometer_km: number | null
          id: string
          last_service_at: string | null
          last_service_odometer_km: number | null
          make: string | null
          model: string | null
          name: string
          plate: string | null
          trip_id: string
          year: number | null
        }
        Insert: {
          current_odometer_km?: number | null
          id?: string
          last_service_at?: string | null
          last_service_odometer_km?: number | null
          make?: string | null
          model?: string | null
          name: string
          plate?: string | null
          trip_id: string
          year?: number | null
        }
        Update: {
          current_odometer_km?: number | null
          id?: string
          last_service_at?: string | null
          last_service_odometer_km?: number | null
          make?: string | null
          model?: string | null
          name?: string
          plate?: string | null
          trip_id?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_profiles_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      weather_snapshots: {
        Row: {
          day_id: string
          fetched_at: string
          id: string
          payload: Json
        }
        Insert: {
          day_id: string
          fetched_at?: string
          id?: string
          payload: Json
        }
        Update: {
          day_id?: string
          fetched_at?: string
          id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "weather_snapshots_day_id_fkey"
            columns: ["day_id"]
            isOneToOne: false
            referencedRelation: "itinerary_days"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      profiles_public: {
        Row: {
          avatar_url: string | null
          display_name: string | null
          id: string | null
        }
        Insert: {
          avatar_url?: string | null
          display_name?: string | null
          id?: string | null
        }
        Update: {
          avatar_url?: string | null
          display_name?: string | null
          id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      can_manage_fez: { Args: { _on: string; _trip: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_active_on: { Args: { _on: string; _trip: string }; Returns: boolean }
      is_member_of: { Args: { _trip: string }; Returns: boolean }
      is_owner: { Args: never; Returns: boolean }
      is_trip_owner: { Args: { _trip: string }; Returns: boolean }
      sanitise_locations: { Args: never; Returns: number }
      shares_trip_with: { Args: { _other: string }; Returns: boolean }
    }
    Enums: {
      app_role: "owner" | "companion" | "passenger" | "public_viewer"
      booking_upload_status: "pending" | "approved" | "rejected"
      cost_status: "pending" | "approved" | "rejected"
      day_kind: "destination" | "rest" | "open" | "empty"
      notification_channel: "push" | "whatsapp" | "email" | "inapp"
      post_status: "active" | "hidden" | "removed"
      post_visibility: "public" | "trip" | "private"
      trip_member_status: "active" | "suspended" | "revoked"
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
    Enums: {
      app_role: ["owner", "companion", "passenger", "public_viewer"],
      booking_upload_status: ["pending", "approved", "rejected"],
      cost_status: ["pending", "approved", "rejected"],
      day_kind: ["destination", "rest", "open", "empty"],
      notification_channel: ["push", "whatsapp", "email", "inapp"],
      post_status: ["active", "hidden", "removed"],
      post_visibility: ["public", "trip", "private"],
      trip_member_status: ["active", "suspended", "revoked"],
    },
  },
} as const

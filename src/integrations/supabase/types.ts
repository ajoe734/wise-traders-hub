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
  public: {
    Tables: {
      announcements: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          id: string
          published_at: string | null
          status: Database["public"]["Enums"]["announcement_status"]
          title: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["announcement_status"]
          title: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["announcement_status"]
          title?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: Json | null
          id: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      checkup_knowledge_candidates: {
        Row: {
          action: string | null
          category: string
          confidence: number | null
          created_at: string
          created_by: string | null
          expected_outcome: Json | null
          fact: string
          id: string
          industry_tags: string[] | null
          interpretation: string | null
          item_id: string | null
          lessons: string | null
          outcome: string | null
          return_pct: number | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_note: string | null
          source_meta: Json | null
          source_type: string
          status: string
          tags: string[] | null
          time_horizon: string | null
          title: string
          trigger_condition: Json | null
          updated_at: string
        }
        Insert: {
          action?: string | null
          category: string
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          expected_outcome?: Json | null
          fact: string
          id?: string
          industry_tags?: string[] | null
          interpretation?: string | null
          item_id?: string | null
          lessons?: string | null
          outcome?: string | null
          return_pct?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          source_meta?: Json | null
          source_type?: string
          status?: string
          tags?: string[] | null
          time_horizon?: string | null
          title: string
          trigger_condition?: Json | null
          updated_at?: string
        }
        Update: {
          action?: string | null
          category?: string
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          expected_outcome?: Json | null
          fact?: string
          id?: string
          industry_tags?: string[] | null
          interpretation?: string | null
          item_id?: string | null
          lessons?: string | null
          outcome?: string | null
          return_pct?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          source_meta?: Json | null
          source_type?: string
          status?: string
          tags?: string[] | null
          time_horizon?: string | null
          title?: string
          trigger_condition?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      checkup_knowledge_hits: {
        Row: {
          confidence: number | null
          context: string | null
          created_at: string
          id: string
          knowledge_item_id: string
          stock_code: string | null
          user_id: string | null
        }
        Insert: {
          confidence?: number | null
          context?: string | null
          created_at?: string
          id?: string
          knowledge_item_id: string
          stock_code?: string | null
          user_id?: string | null
        }
        Update: {
          confidence?: number | null
          context?: string | null
          created_at?: string
          id?: string
          knowledge_item_id?: string
          stock_code?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkup_knowledge_hits_knowledge_item_id_fkey"
            columns: ["knowledge_item_id"]
            isOneToOne: false
            referencedRelation: "checkup_knowledge_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkup_knowledge_hits_knowledge_item_id_fkey"
            columns: ["knowledge_item_id"]
            isOneToOne: false
            referencedRelation: "checkup_knowledge_usage_stats"
            referencedColumns: ["knowledge_item_id"]
          },
        ]
      }
      checkup_knowledge_items: {
        Row: {
          action: string | null
          archived_at: string | null
          backtest_run_at: string | null
          backtest_stats: Json | null
          backtestable: boolean
          category: string
          confidence: number | null
          created_at: string | null
          expected_outcome: Json | null
          fact: string
          id: string
          industry_tags: string[]
          interpretation: string | null
          is_active: boolean | null
          item_id: string
          last_validated_at: string | null
          lessons: string | null
          outcome: string | null
          parent_item_id: string | null
          return_pct: number | null
          sample_size: number
          source_type: string
          tags: string[] | null
          time_horizon: string | null
          title: string
          trigger_condition: Json | null
          universe_size: number | null
          updated_at: string | null
          version: number
          win_rate: number | null
        }
        Insert: {
          action?: string | null
          archived_at?: string | null
          backtest_run_at?: string | null
          backtest_stats?: Json | null
          backtestable?: boolean
          category: string
          confidence?: number | null
          created_at?: string | null
          expected_outcome?: Json | null
          fact: string
          id?: string
          industry_tags?: string[]
          interpretation?: string | null
          is_active?: boolean | null
          item_id: string
          last_validated_at?: string | null
          lessons?: string | null
          outcome?: string | null
          parent_item_id?: string | null
          return_pct?: number | null
          sample_size?: number
          source_type?: string
          tags?: string[] | null
          time_horizon?: string | null
          title: string
          trigger_condition?: Json | null
          universe_size?: number | null
          updated_at?: string | null
          version?: number
          win_rate?: number | null
        }
        Update: {
          action?: string | null
          archived_at?: string | null
          backtest_run_at?: string | null
          backtest_stats?: Json | null
          backtestable?: boolean
          category?: string
          confidence?: number | null
          created_at?: string | null
          expected_outcome?: Json | null
          fact?: string
          id?: string
          industry_tags?: string[]
          interpretation?: string | null
          is_active?: boolean | null
          item_id?: string
          last_validated_at?: string | null
          lessons?: string | null
          outcome?: string | null
          parent_item_id?: string | null
          return_pct?: number | null
          sample_size?: number
          source_type?: string
          tags?: string[] | null
          time_horizon?: string | null
          title?: string
          trigger_condition?: Json | null
          universe_size?: number | null
          updated_at?: string | null
          version?: number
          win_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "checkup_knowledge_items_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "checkup_knowledge_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkup_knowledge_items_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "checkup_knowledge_usage_stats"
            referencedColumns: ["knowledge_item_id"]
          },
        ]
      }
      checkup_knowledge_validations: {
        Row: {
          actual_change_pct: number | null
          created_at: string
          details: Json | null
          evaluated_at: string
          expected_direction: string | null
          hit_id: string | null
          horizon_days: number | null
          id: string
          is_correct: boolean | null
          knowledge_item_id: string
          stock_code: string | null
        }
        Insert: {
          actual_change_pct?: number | null
          created_at?: string
          details?: Json | null
          evaluated_at?: string
          expected_direction?: string | null
          hit_id?: string | null
          horizon_days?: number | null
          id?: string
          is_correct?: boolean | null
          knowledge_item_id: string
          stock_code?: string | null
        }
        Update: {
          actual_change_pct?: number | null
          created_at?: string
          details?: Json | null
          evaluated_at?: string
          expected_direction?: string | null
          hit_id?: string | null
          horizon_days?: number | null
          id?: string
          is_correct?: boolean | null
          knowledge_item_id?: string
          stock_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkup_knowledge_validations_hit_id_fkey"
            columns: ["hit_id"]
            isOneToOne: false
            referencedRelation: "checkup_knowledge_hits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkup_knowledge_validations_knowledge_item_id_fkey"
            columns: ["knowledge_item_id"]
            isOneToOne: false
            referencedRelation: "checkup_knowledge_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkup_knowledge_validations_knowledge_item_id_fkey"
            columns: ["knowledge_item_id"]
            isOneToOne: false
            referencedRelation: "checkup_knowledge_usage_stats"
            referencedColumns: ["knowledge_item_id"]
          },
        ]
      }
      checkup_plans: {
        Row: {
          created_at: string
          description: string | null
          features: Json
          id: string
          is_active: boolean
          monthly_quota: number
          name: string
          price_monthly: number
          price_yearly: number
          quota_period: string
          sort_order: number
          tier: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          monthly_quota: number
          name: string
          price_monthly: number
          price_yearly: number
          quota_period?: string
          sort_order?: number
          tier: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          monthly_quota?: number
          name?: string
          price_monthly?: number
          price_yearly?: number
          quota_period?: string
          sort_order?: number
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      checkup_prediction_accuracy: {
        Row: {
          actual: string
          event_id: string
          event_type: string | null
          id: string
          pred: string
          reviewed_at: string
          was_correct: boolean
        }
        Insert: {
          actual: string
          event_id: string
          event_type?: string | null
          id?: string
          pred: string
          reviewed_at?: string
          was_correct?: boolean
        }
        Update: {
          actual?: string
          event_id?: string
          event_type?: string | null
          id?: string
          pred?: string
          reviewed_at?: string
          was_correct?: boolean
        }
        Relationships: []
      }
      checkup_price_misses: {
        Row: {
          attempts: number
          first_seen_at: string
          id: string
          last_error: string | null
          last_seen_at: string
          reason: string
          resolved_at: string | null
          symbol: string
          user_id: string | null
        }
        Insert: {
          attempts?: number
          first_seen_at?: string
          id?: string
          last_error?: string | null
          last_seen_at?: string
          reason: string
          resolved_at?: string | null
          symbol: string
          user_id?: string | null
        }
        Update: {
          attempts?: number
          first_seen_at?: string
          id?: string
          last_error?: string | null
          last_seen_at?: string
          reason?: string
          resolved_at?: string | null
          symbol?: string
          user_id?: string | null
        }
        Relationships: []
      }
      checkup_storage: {
        Row: {
          data: Json
          key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          data?: Json
          key: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          data?: Json
          key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      checkup_subscriptions: {
        Row: {
          auto_renew: boolean
          billing_cycle: string
          canceled_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          plan_id: string
          provider_id: string | null
          started_at: string
          status: Database["public"]["Enums"]["subscription_status"]
          user_id: string
        }
        Insert: {
          auto_renew?: boolean
          billing_cycle: string
          canceled_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          plan_id: string
          provider_id?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          user_id: string
        }
        Update: {
          auto_renew?: boolean
          billing_cycle?: string
          canceled_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          plan_id?: string
          provider_id?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkup_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "checkup_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      checkup_trade_memos: {
        Row: {
          action: string | null
          code: string | null
          created_at: string
          id: string
          name: string | null
          price: number | null
          qa: Json | null
          qty: number | null
          trade_date: string | null
          trade_time: string | null
          user_id: string
        }
        Insert: {
          action?: string | null
          code?: string | null
          created_at?: string
          id?: string
          name?: string | null
          price?: number | null
          qa?: Json | null
          qty?: number | null
          trade_date?: string | null
          trade_time?: string | null
          user_id: string
        }
        Update: {
          action?: string | null
          code?: string | null
          created_at?: string
          id?: string
          name?: string | null
          price?: number | null
          qa?: Json | null
          qty?: number | null
          trade_date?: string | null
          trade_time?: string | null
          user_id?: string
        }
        Relationships: []
      }
      checkup_usage: {
        Row: {
          id: string
          kind: string
          used_at: string
          user_id: string
        }
        Insert: {
          id?: string
          kind?: string
          used_at?: string
          user_id: string
        }
        Update: {
          id?: string
          kind?: string
          used_at?: string
          user_id?: string
        }
        Relationships: []
      }
      current_prices: {
        Row: {
          best_ask: number | null
          best_bid: number | null
          change_percent: number | null
          change_value: number | null
          high_price: number | null
          limit_down: number | null
          limit_up: number | null
          low_price: number | null
          name: string | null
          open_price: number | null
          price: number | null
          pushed_at: string | null
          symbol: string
          tick_volume: number | null
          updated_at: string | null
          volume: number | null
          yesterday_close: number | null
        }
        Insert: {
          best_ask?: number | null
          best_bid?: number | null
          change_percent?: number | null
          change_value?: number | null
          high_price?: number | null
          limit_down?: number | null
          limit_up?: number | null
          low_price?: number | null
          name?: string | null
          open_price?: number | null
          price?: number | null
          pushed_at?: string | null
          symbol: string
          tick_volume?: number | null
          updated_at?: string | null
          volume?: number | null
          yesterday_close?: number | null
        }
        Update: {
          best_ask?: number | null
          best_bid?: number | null
          change_percent?: number | null
          change_value?: number | null
          high_price?: number | null
          limit_down?: number | null
          limit_up?: number | null
          low_price?: number | null
          name?: string | null
          open_price?: number | null
          price?: number | null
          pushed_at?: string | null
          symbol?: string
          tick_volume?: number | null
          updated_at?: string | null
          volume?: number | null
          yesterday_close?: number | null
        }
        Relationships: []
      }
      daily_price_snapshots: {
        Row: {
          change_percent: number | null
          close_price: number | null
          created_at: string
          high_price: number | null
          id: string
          is_limit_up: boolean
          limit_up_price: number | null
          low_price: number | null
          open_price: number | null
          symbol: string
          trade_date: string
          volume: number | null
          volume_ma5: number | null
          yesterday_close: number | null
        }
        Insert: {
          change_percent?: number | null
          close_price?: number | null
          created_at?: string
          high_price?: number | null
          id?: string
          is_limit_up?: boolean
          limit_up_price?: number | null
          low_price?: number | null
          open_price?: number | null
          symbol: string
          trade_date: string
          volume?: number | null
          volume_ma5?: number | null
          yesterday_close?: number | null
        }
        Update: {
          change_percent?: number | null
          close_price?: number | null
          created_at?: string
          high_price?: number | null
          id?: string
          is_limit_up?: boolean
          limit_up_price?: number | null
          low_price?: number | null
          open_price?: number | null
          symbol?: string
          trade_date?: string
          volume?: number | null
          volume_ma5?: number | null
          yesterday_close?: number | null
        }
        Relationships: []
      }
      expert_limit_up_hits: {
        Row: {
          close_price: number | null
          created_at: string
          entry_price: number | null
          expert_id: string
          id: string
          instrument: string | null
          symbol: string
          trade_date: string
          trade_record_id: string | null
        }
        Insert: {
          close_price?: number | null
          created_at?: string
          entry_price?: number | null
          expert_id: string
          id?: string
          instrument?: string | null
          symbol: string
          trade_date: string
          trade_record_id?: string | null
        }
        Update: {
          close_price?: number | null
          created_at?: string
          entry_price?: number | null
          expert_id?: string
          id?: string
          instrument?: string | null
          symbol?: string
          trade_date?: string
          trade_record_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expert_limit_up_hits_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_limit_up_hits_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_limit_up_hits_trade_record_id_fkey"
            columns: ["trade_record_id"]
            isOneToOne: false
            referencedRelation: "trade_records"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_line_channels: {
        Row: {
          channel_access_token: string
          channel_id: string
          channel_name: string | null
          created_at: string
          expert_id: string
          id: string
          is_active: boolean
          line_oa_id: string | null
          qr_code_url: string | null
          updated_at: string
        }
        Insert: {
          channel_access_token: string
          channel_id: string
          channel_name?: string | null
          created_at?: string
          expert_id: string
          id?: string
          is_active?: boolean
          line_oa_id?: string | null
          qr_code_url?: string | null
          updated_at?: string
        }
        Update: {
          channel_access_token?: string
          channel_id?: string
          channel_name?: string | null
          created_at?: string
          expert_id?: string
          id?: string
          is_active?: boolean
          line_oa_id?: string | null
          qr_code_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_line_channels_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: true
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_line_channels_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: true
            referencedRelation: "experts_public"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_plans: {
        Row: {
          created_at: string
          description: string | null
          expert_id: string
          features: Json | null
          id: string
          is_active: boolean
          name: string
          plan_type: Database["public"]["Enums"]["plan_type"]
          price_monthly: number
          price_yearly: number | null
          review_note: string | null
          review_status: Database["public"]["Enums"]["plan_review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          expert_id: string
          features?: Json | null
          id?: string
          is_active?: boolean
          name: string
          plan_type: Database["public"]["Enums"]["plan_type"]
          price_monthly?: number
          price_yearly?: number | null
          review_note?: string | null
          review_status?: Database["public"]["Enums"]["plan_review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          expert_id?: string
          features?: Json | null
          id?: string
          is_active?: boolean
          name?: string
          plan_type?: Database["public"]["Enums"]["plan_type"]
          price_monthly?: number
          price_yearly?: number | null
          review_note?: string | null
          review_status?: Database["public"]["Enums"]["plan_review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expert_plans_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_plans_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts_public"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_reason_templates: {
        Row: {
          content: string
          created_at: string
          expert_id: string
          id: string
          sort_order: number
          title: string
        }
        Insert: {
          content: string
          created_at?: string
          expert_id: string
          id?: string
          sort_order?: number
          title: string
        }
        Update: {
          content?: string
          created_at?: string
          expert_id?: string
          id?: string
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_reason_templates_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_reason_templates_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts_public"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_signal_templates: {
        Row: {
          action: string
          created_at: string
          expert_id: string
          id: string
          reason: string
          risk_note: string
          sort_order: number
          strategy_note: string
          title: string
        }
        Insert: {
          action: string
          created_at?: string
          expert_id: string
          id?: string
          reason?: string
          risk_note?: string
          sort_order?: number
          strategy_note?: string
          title: string
        }
        Update: {
          action?: string
          created_at?: string
          expert_id?: string
          id?: string
          reason?: string
          risk_note?: string
          sort_order?: number
          strategy_note?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_signal_templates_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_signal_templates_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts_public"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_signals: {
        Row: {
          action: Database["public"]["Enums"]["signal_action"]
          created_at: string
          expert_id: string
          id: string
          instrument: string
          learning_points: string | null
          line_pushed_at: string | null
          overall_summary: string | null
          plan_id: string | null
          price_hint: number | null
          published_at: string | null
          quantity: number | null
          quantity_unit: string
          reason_detail: string | null
          reason_summary: string | null
          risk_notes: string | null
          status: Database["public"]["Enums"]["signal_status"]
          taken_down_by: string | null
          taken_down_reason: string | null
          teaching_topic: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["signal_action"]
          created_at?: string
          expert_id: string
          id?: string
          instrument: string
          learning_points?: string | null
          line_pushed_at?: string | null
          overall_summary?: string | null
          plan_id?: string | null
          price_hint?: number | null
          published_at?: string | null
          quantity?: number | null
          quantity_unit?: string
          reason_detail?: string | null
          reason_summary?: string | null
          risk_notes?: string | null
          status?: Database["public"]["Enums"]["signal_status"]
          taken_down_by?: string | null
          taken_down_reason?: string | null
          teaching_topic?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["signal_action"]
          created_at?: string
          expert_id?: string
          id?: string
          instrument?: string
          learning_points?: string | null
          line_pushed_at?: string | null
          overall_summary?: string | null
          plan_id?: string | null
          price_hint?: number | null
          published_at?: string | null
          quantity?: number | null
          quantity_unit?: string
          reason_detail?: string | null
          reason_summary?: string | null
          risk_notes?: string | null
          status?: Database["public"]["Enums"]["signal_status"]
          taken_down_by?: string | null
          taken_down_reason?: string | null
          teaching_topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expert_signals_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_signals_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_signals_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "expert_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      experts: {
        Row: {
          avatar_url: string | null
          backtest_1y_return: number | null
          backtest_annual_return: number | null
          backtest_max_drawdown: number | null
          bio: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          markets: string[] | null
          name: string
          role: Database["public"]["Enums"]["expert_role"]
          slug: string
          starting_capital: number | null
          status: string
          strategy_summary: string | null
          style_tags: string[] | null
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          backtest_1y_return?: number | null
          backtest_annual_return?: number | null
          backtest_max_drawdown?: number | null
          bio?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          markets?: string[] | null
          name: string
          role: Database["public"]["Enums"]["expert_role"]
          slug: string
          starting_capital?: number | null
          status?: string
          strategy_summary?: string | null
          style_tags?: string[] | null
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          backtest_1y_return?: number | null
          backtest_annual_return?: number | null
          backtest_max_drawdown?: number | null
          bio?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          markets?: string[] | null
          name?: string
          role?: Database["public"]["Enums"]["expert_role"]
          slug?: string
          starting_capital?: number | null
          status?: string
          strategy_summary?: string | null
          style_tags?: string[] | null
          user_id?: string
        }
        Relationships: []
      }
      knowledge_auto_rules: {
        Row: {
          archive_below_win_rate: number
          auto_grid_search_below: number
          enabled: boolean
          id: string
          min_sample_size: number
          promote_above_win_rate: number
          promote_min_improvement_pct: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archive_below_win_rate?: number
          auto_grid_search_below?: number
          enabled?: boolean
          id?: string
          min_sample_size?: number
          promote_above_win_rate?: number
          promote_min_improvement_pct?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archive_below_win_rate?: number
          auto_grid_search_below?: number
          enabled?: boolean
          id?: string
          min_sample_size?: number
          promote_above_win_rate?: number
          promote_min_improvement_pct?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      knowledge_backfill_progress: {
        Row: {
          attempted_at: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          rows_inserted: number
          status: string
          symbol: string
          yyyymm: string
        }
        Insert: {
          attempted_at?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          rows_inserted?: number
          status?: string
          symbol: string
          yyyymm: string
        }
        Update: {
          attempted_at?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          rows_inserted?: number
          status?: string
          symbol?: string
          yyyymm?: string
        }
        Relationships: []
      }
      knowledge_backtest_runs: {
        Row: {
          auto_action: string | null
          auto_action_reason: string | null
          avg_return_pct: number | null
          completed_at: string | null
          created_at: string
          date_range_end: string | null
          date_range_start: string | null
          details: Json | null
          error_message: string | null
          id: string
          knowledge_item_id: string | null
          loss_count: number
          max_drawdown: number | null
          median_return_pct: number | null
          parameters: Json | null
          run_mode: string
          status: string
          total_hits: number
          universe_size: number | null
          win_count: number
          win_rate: number | null
        }
        Insert: {
          auto_action?: string | null
          auto_action_reason?: string | null
          avg_return_pct?: number | null
          completed_at?: string | null
          created_at?: string
          date_range_end?: string | null
          date_range_start?: string | null
          details?: Json | null
          error_message?: string | null
          id?: string
          knowledge_item_id?: string | null
          loss_count?: number
          max_drawdown?: number | null
          median_return_pct?: number | null
          parameters?: Json | null
          run_mode?: string
          status?: string
          total_hits?: number
          universe_size?: number | null
          win_count?: number
          win_rate?: number | null
        }
        Update: {
          auto_action?: string | null
          auto_action_reason?: string | null
          avg_return_pct?: number | null
          completed_at?: string | null
          created_at?: string
          date_range_end?: string | null
          date_range_start?: string | null
          details?: Json | null
          error_message?: string | null
          id?: string
          knowledge_item_id?: string | null
          loss_count?: number
          max_drawdown?: number | null
          median_return_pct?: number | null
          parameters?: Json | null
          run_mode?: string
          status?: string
          total_hits?: number
          universe_size?: number | null
          win_count?: number
          win_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_backtest_runs_knowledge_item_id_fkey"
            columns: ["knowledge_item_id"]
            isOneToOne: false
            referencedRelation: "checkup_knowledge_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_backtest_runs_knowledge_item_id_fkey"
            columns: ["knowledge_item_id"]
            isOneToOne: false
            referencedRelation: "checkup_knowledge_usage_stats"
            referencedColumns: ["knowledge_item_id"]
          },
        ]
      }
      knowledge_grid_search_results: {
        Row: {
          avg_return_pct: number | null
          created_at: string
          id: string
          is_best: boolean
          knowledge_item_id: string
          parameters: Json
          run_id: string
          score: number | null
          total_hits: number
          win_rate: number | null
        }
        Insert: {
          avg_return_pct?: number | null
          created_at?: string
          id?: string
          is_best?: boolean
          knowledge_item_id: string
          parameters: Json
          run_id: string
          score?: number | null
          total_hits?: number
          win_rate?: number | null
        }
        Update: {
          avg_return_pct?: number | null
          created_at?: string
          id?: string
          is_best?: boolean
          knowledge_item_id?: string
          parameters?: Json
          run_id?: string
          score?: number | null
          total_hits?: number
          win_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_grid_search_results_knowledge_item_id_fkey"
            columns: ["knowledge_item_id"]
            isOneToOne: false
            referencedRelation: "checkup_knowledge_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_grid_search_results_knowledge_item_id_fkey"
            columns: ["knowledge_item_id"]
            isOneToOne: false
            referencedRelation: "checkup_knowledge_usage_stats"
            referencedColumns: ["knowledge_item_id"]
          },
          {
            foreignKeyName: "knowledge_grid_search_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "knowledge_backtest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      line_binding_codes: {
        Row: {
          code: string
          created_at: string
          expert_id: string
          expires_at: string
          id: string
          used: boolean
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          expert_id: string
          expires_at: string
          id?: string
          used?: boolean
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          expert_id?: string
          expires_at?: string
          id?: string
          used?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_binding_codes_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_binding_codes_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts_public"
            referencedColumns: ["id"]
          },
        ]
      }
      member_line_bindings: {
        Row: {
          bound_at: string
          display_name: string | null
          expert_id: string
          id: string
          is_active: boolean
          line_user_id: string
          user_id: string
        }
        Insert: {
          bound_at?: string
          display_name?: string | null
          expert_id: string
          id?: string
          is_active?: boolean
          line_user_id: string
          user_id: string
        }
        Update: {
          bound_at?: string
          display_name?: string | null
          expert_id?: string
          id?: string
          is_active?: boolean
          line_user_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_line_bindings_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_line_bindings_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts_public"
            referencedColumns: ["id"]
          },
        ]
      }
      member_subscriptions: {
        Row: {
          auto_renew: boolean
          canceled_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          plan_id: string
          provider_id: string | null
          started_at: string
          status: Database["public"]["Enums"]["subscription_status"]
          user_id: string
        }
        Insert: {
          auto_renew?: boolean
          canceled_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          plan_id: string
          provider_id?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          user_id: string
        }
        Update: {
          auto_renew?: boolean
          canceled_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          plan_id?: string
          provider_id?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_member_subscriptions_provider"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "payment_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_member_subscriptions_provider"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "payment_providers_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "expert_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      payment_intents: {
        Row: {
          amount: number
          attribution: Json | null
          billing_cycle: string
          checkup_plan_id: string | null
          created_at: string
          discount_amount: number
          discount_reason: string | null
          expert_id: string | null
          id: string
          original_amount: number
          plan_id: string | null
          product_kind: string
          trade_no: string
          upgrade_from_subscription_id: string | null
          user_id: string | null
        }
        Insert: {
          amount: number
          attribution?: Json | null
          billing_cycle: string
          checkup_plan_id?: string | null
          created_at?: string
          discount_amount?: number
          discount_reason?: string | null
          expert_id?: string | null
          id?: string
          original_amount: number
          plan_id?: string | null
          product_kind?: string
          trade_no: string
          upgrade_from_subscription_id?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number
          attribution?: Json | null
          billing_cycle?: string
          checkup_plan_id?: string | null
          created_at?: string
          discount_amount?: number
          discount_reason?: string | null
          expert_id?: string | null
          id?: string
          original_amount?: number
          plan_id?: string | null
          product_kind?: string
          trade_no?: string
          upgrade_from_subscription_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      payment_providers: {
        Row: {
          config: Json | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          is_default: boolean
          provider_type: Database["public"]["Enums"]["provider_type"]
        }
        Insert: {
          config?: Json | null
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          provider_type: Database["public"]["Enums"]["provider_type"]
        }
        Update: {
          config?: Json | null
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          provider_type?: Database["public"]["Enums"]["provider_type"]
        }
        Relationships: []
      }
      payment_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      payment_transactions: {
        Row: {
          amount: number
          attribution: Json | null
          created_at: string
          currency: string
          discount_amount: number
          discount_reason: string | null
          id: string
          original_amount: number | null
          paid_at: string | null
          provider_id: string | null
          provider_tx_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          subscription_id: string | null
        }
        Insert: {
          amount?: number
          attribution?: Json | null
          created_at?: string
          currency?: string
          discount_amount?: number
          discount_reason?: string | null
          id?: string
          original_amount?: number | null
          paid_at?: string | null
          provider_id?: string | null
          provider_tx_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          subscription_id?: string | null
        }
        Update: {
          amount?: number
          attribution?: Json | null
          created_at?: string
          currency?: string
          discount_amount?: number
          discount_reason?: string | null
          id?: string
          original_amount?: number | null
          paid_at?: string | null
          provider_id?: string | null
          provider_tx_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "payment_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "payment_providers_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "member_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_split_overrides: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          notes: string | null
          pct_expert: number
          pct_platform: number
          plan_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          pct_expert: number
          pct_platform: number
          plan_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          pct_expert?: number
          pct_platform?: number
          plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_split_overrides_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: true
            referencedRelation: "expert_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          expert_slug: string | null
          id: string
          is_line_friend: boolean | null
          is_tester: boolean
          line_user_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          expert_slug?: string | null
          id?: string
          is_line_friend?: boolean | null
          is_tester?: boolean
          line_user_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          expert_slug?: string | null
          id?: string
          is_line_friend?: boolean | null
          is_tester?: boolean
          line_user_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      referral_attributions: {
        Row: {
          created_at: string
          id: string
          landing_path: string | null
          locked_until: string
          ref_code: string | null
          user_id: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          visitor_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          landing_path?: string | null
          locked_until?: string
          ref_code?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          visitor_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          landing_path?: string | null
          locked_until?: string
          ref_code?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          visitor_id?: string | null
        }
        Relationships: []
      }
      referral_channels: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          notes: string | null
          pct_channel: number | null
          pct_expert: number | null
          pct_platform: number | null
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          notes?: string | null
          pct_channel?: number | null
          pct_expert?: number | null
          pct_platform?: number | null
          source: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          pct_channel?: number | null
          pct_expert?: number | null
          pct_platform?: number | null
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      remittance_orders: {
        Row: {
          amount: number
          attribution: Json | null
          billing_cycle: string
          checkup_plan_id: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          discount_amount: number
          discount_reason: string | null
          id: string
          last5: string
          original_amount: number | null
          payer_name: string
          plan_id: string | null
          product_kind: string
          reject_reason: string | null
          status: string
          subscription_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          attribution?: Json | null
          billing_cycle: string
          checkup_plan_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          discount_amount?: number
          discount_reason?: string | null
          id?: string
          last5: string
          original_amount?: number | null
          payer_name: string
          plan_id?: string | null
          product_kind?: string
          reject_reason?: string | null
          status?: string
          subscription_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          attribution?: Json | null
          billing_cycle?: string
          checkup_plan_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          discount_amount?: number
          discount_reason?: string | null
          id?: string
          last5?: string
          original_amount?: number | null
          payer_name?: string
          plan_id?: string | null
          product_kind?: string
          reject_reason?: string | null
          status?: string
          subscription_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "remittance_orders_checkup_plan_id_fkey"
            columns: ["checkup_plan_id"]
            isOneToOne: false
            referencedRelation: "checkup_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_splits: {
        Row: {
          channel_reserve: number
          created_at: string
          discount: number
          discount_source: string | null
          expert_amount: number
          expert_id: string | null
          gross: number
          id: string
          net: number
          plan_id: string | null
          platform_amount: number
          rule_snapshot: Json
          rule_source: string
          transaction_id: string
          utm_snapshot: Json | null
        }
        Insert: {
          channel_reserve?: number
          created_at?: string
          discount?: number
          discount_source?: string | null
          expert_amount?: number
          expert_id?: string | null
          gross: number
          id?: string
          net: number
          plan_id?: string | null
          platform_amount: number
          rule_snapshot: Json
          rule_source: string
          transaction_id: string
          utm_snapshot?: Json | null
        }
        Update: {
          channel_reserve?: number
          created_at?: string
          discount?: number
          discount_source?: string | null
          expert_amount?: number
          expert_id?: string | null
          gross?: number
          id?: string
          net?: number
          plan_id?: string | null
          platform_amount?: number
          rule_snapshot?: Json
          rule_source?: string
          transaction_id?: string
          utm_snapshot?: Json | null
        }
        Relationships: []
      }
      stock_names: {
        Row: {
          created_at: string
          name: string
          symbol: string
        }
        Insert: {
          created_at?: string
          name: string
          symbol: string
        }
        Update: {
          created_at?: string
          name?: string
          symbol?: string
        }
        Relationships: []
      }
      system_jobs_log: {
        Row: {
          detail: Json | null
          duration_ms: number | null
          id: string
          job_name: string
          ran_at: string
          status: string
        }
        Insert: {
          detail?: Json | null
          duration_ms?: number | null
          id?: string
          job_name: string
          ran_at?: string
          status?: string
        }
        Update: {
          detail?: Json | null
          duration_ms?: number | null
          id?: string
          job_name?: string
          ran_at?: string
          status?: string
        }
        Relationships: []
      }
      trade_records: {
        Row: {
          created_at: string
          current_price: number | null
          entry_date: string | null
          entry_price: number | null
          exit_date: string | null
          exit_price: number | null
          expert_id: string
          id: string
          instrument: string
          pnl_percent: number | null
          price_updated_at: string | null
          quantity: number
          quantity_unit: string
          signal_id: string | null
          status: Database["public"]["Enums"]["trade_status"]
        }
        Insert: {
          created_at?: string
          current_price?: number | null
          entry_date?: string | null
          entry_price?: number | null
          exit_date?: string | null
          exit_price?: number | null
          expert_id: string
          id?: string
          instrument: string
          pnl_percent?: number | null
          price_updated_at?: string | null
          quantity?: number
          quantity_unit?: string
          signal_id?: string | null
          status?: Database["public"]["Enums"]["trade_status"]
        }
        Update: {
          created_at?: string
          current_price?: number | null
          entry_date?: string | null
          entry_price?: number | null
          exit_date?: string | null
          exit_price?: number | null
          expert_id?: string
          id?: string
          instrument?: string
          pnl_percent?: number | null
          price_updated_at?: string | null
          quantity?: number
          quantity_unit?: string
          signal_id?: string | null
          status?: Database["public"]["Enums"]["trade_status"]
        }
        Relationships: [
          {
            foreignKeyName: "trade_records_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_records_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_records_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "expert_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_signals: {
        Row: {
          closed_at: string | null
          created_at: string | null
          entry_price: number
          exit_price: number | null
          id: number
          name: string | null
          pnl: number | null
          pnl_percent: number | null
          status: string | null
          symbol: string
          user_id: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string | null
          entry_price: number
          exit_price?: number | null
          id?: number
          name?: string | null
          pnl?: number | null
          pnl_percent?: number | null
          status?: string | null
          symbol: string
          user_id: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string | null
          entry_price?: number
          exit_price?: number | null
          id?: number
          name?: string | null
          pnl?: number | null
          pnl_percent?: number | null
          status?: string | null
          symbol?: string
          user_id?: string
        }
        Relationships: []
      }
      user_performances: {
        Row: {
          current_price: number | null
          entry_price: number | null
          name: string | null
          pnl: number | null
          pnl_percent: number | null
          signal_id: number
          symbol: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          current_price?: number | null
          entry_price?: number | null
          name?: string | null
          pnl?: number | null
          pnl_percent?: number | null
          signal_id: number
          symbol: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          current_price?: number | null
          entry_price?: number | null
          name?: string | null
          pnl?: number | null
          pnl_percent?: number | null
          signal_id?: number
          symbol?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_summaries: {
        Row: {
          avg_pnl_percent: number | null
          total_pnl_percent: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          avg_pnl_percent?: number | null
          total_pnl_percent?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          avg_pnl_percent?: number | null
          total_pnl_percent?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      warrant_expiry: {
        Row: {
          expire_date: string | null
          fetched_at: string
          name: string | null
          parent_code: string | null
          symbol: string
        }
        Insert: {
          expire_date?: string | null
          fetched_at?: string
          name?: string | null
          parent_code?: string | null
          symbol: string
        }
        Update: {
          expire_date?: string | null
          fetched_at?: string
          name?: string | null
          parent_code?: string | null
          symbol?: string
        }
        Relationships: []
      }
    }
    Views: {
      checkup_knowledge_usage_stats: {
        Row: {
          hit_count: number | null
          hit_count_7d: number | null
          knowledge_item_id: string | null
          last_hit_at: string | null
        }
        Relationships: []
      }
      expert_line_channels_public: {
        Row: {
          channel_id: string | null
          channel_name: string | null
          created_at: string | null
          expert_id: string | null
          id: string | null
          is_active: boolean | null
          line_oa_id: string | null
          qr_code_url: string | null
          updated_at: string | null
        }
        Insert: {
          channel_id?: string | null
          channel_name?: string | null
          created_at?: string | null
          expert_id?: string | null
          id?: string | null
          is_active?: boolean | null
          line_oa_id?: string | null
          qr_code_url?: string | null
          updated_at?: string | null
        }
        Update: {
          channel_id?: string | null
          channel_name?: string | null
          created_at?: string | null
          expert_id?: string | null
          id?: string | null
          is_active?: boolean | null
          line_oa_id?: string | null
          qr_code_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expert_line_channels_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: true
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_line_channels_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: true
            referencedRelation: "experts_public"
            referencedColumns: ["id"]
          },
        ]
      }
      experts_public: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          description: string | null
          id: string | null
          markets: string[] | null
          name: string | null
          role: Database["public"]["Enums"]["expert_role"] | null
          slug: string | null
          status: string | null
          style_tags: string[] | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          markets?: string[] | null
          name?: string | null
          role?: Database["public"]["Enums"]["expert_role"] | null
          slug?: string | null
          status?: string | null
          style_tags?: string[] | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          markets?: string[] | null
          name?: string | null
          role?: Database["public"]["Enums"]["expert_role"] | null
          slug?: string | null
          status?: string | null
          style_tags?: string[] | null
        }
        Relationships: []
      }
      member_line_bindings_analyst: {
        Row: {
          bound_at: string | null
          display_name: string | null
          expert_id: string | null
          id: string | null
          is_active: boolean | null
          user_id: string | null
        }
        Insert: {
          bound_at?: string | null
          display_name?: string | null
          expert_id?: string | null
          id?: string | null
          is_active?: boolean | null
          user_id?: string | null
        }
        Update: {
          bound_at?: string | null
          display_name?: string | null
          expert_id?: string | null
          id?: string | null
          is_active?: boolean | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_line_bindings_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_line_bindings_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts_public"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_providers_safe: {
        Row: {
          created_at: string | null
          display_name: string | null
          id: string | null
          is_active: boolean | null
          is_default: boolean | null
          provider_type: Database["public"]["Enums"]["provider_type"] | null
        }
        Insert: {
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          is_active?: boolean | null
          is_default?: boolean | null
          provider_type?: Database["public"]["Enums"]["provider_type"] | null
        }
        Update: {
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          is_active?: boolean | null
          is_default?: boolean | null
          provider_type?: Database["public"]["Enums"]["provider_type"] | null
        }
        Relationships: []
      }
      profiles_analyst: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          display_name: string | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_checkup_usage_overview: {
        Args: never
        Returns: {
          display_name: string
          email: string
          is_exhausted: boolean
          is_near_limit: boolean
          last_used_at: string
          period: string
          quota_limit: number
          remaining: number
          resets_at: string
          tier: string
          usage_pct: number
          used: number
          user_id: string
        }[]
      }
      archive_and_promote_knowledge: {
        Args: {
          _new_confidence?: number
          _new_trigger: Json
          _note?: string
          _old_id: string
        }
        Returns: string
      }
      calculate_expert_performance: {
        Args: { _expert_id: string }
        Returns: Json
      }
      check_checkup_quota: { Args: { _user_id: string }; Returns: Json }
      cleanup_old_announcements: { Args: never; Returns: undefined }
      consume_checkup_quota: {
        Args: { _kind?: string; _user_id: string }
        Returns: Json
      }
      delete_expired_binding_codes: { Args: never; Returns: undefined }
      delete_old_prices: { Args: never; Returns: undefined }
      get_knowledge_revision: { Args: never; Returns: string }
      get_weekly_limit_up_leaderboard: {
        Args: { _end_date?: string; _start_date?: string }
        Returns: {
          avatar_url: string
          expert_id: string
          expert_name: string
          expert_slug: string
          limit_up_count: number
          weekly_return: number
          win_rate: number
        }[]
      }
      has_active_subscription: {
        Args: { _user_id: string }
        Returns: {
          expert_id: string
          plan_id: string
        }[]
      }
      has_active_subscription_after: {
        Args: { _published_at: string; _user_id: string }
        Returns: {
          expert_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_backtestable_trigger: { Args: { _cond: Json }; Returns: boolean }
      is_subscribed_to_plan: {
        Args: { _plan_id: string; _user_id: string }
        Returns: boolean
      }
      is_tester: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      announcement_status: "draft" | "published"
      app_role: "company_admin" | "analyst"
      expert_role: "advisor" | "mentor"
      payment_status: "pending" | "paid" | "failed" | "refunded"
      plan_review_status: "draft" | "pending" | "approved" | "rejected"
      plan_type:
        | "analyst_signal_l1"
        | "analyst_signal_diag_l2"
        | "mentor_weekly_journal"
        | "checkup_basic"
        | "checkup_pro"
      provider_type: "ecpay" | "newebpay" | "stripe" | "line_pay" | "acpay"
      signal_action: "buy" | "sell" | "add" | "trim" | "exit"
      signal_status: "published" | "pending"
      subscription_status: "active" | "canceled" | "expired"
      trade_status: "open" | "closed" | "stopped"
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
      announcement_status: ["draft", "published"],
      app_role: ["company_admin", "analyst"],
      expert_role: ["advisor", "mentor"],
      payment_status: ["pending", "paid", "failed", "refunded"],
      plan_review_status: ["draft", "pending", "approved", "rejected"],
      plan_type: [
        "analyst_signal_l1",
        "analyst_signal_diag_l2",
        "mentor_weekly_journal",
        "checkup_basic",
        "checkup_pro",
      ],
      provider_type: ["ecpay", "newebpay", "stripe", "line_pay", "acpay"],
      signal_action: ["buy", "sell", "add", "trim", "exit"],
      signal_status: ["published", "pending"],
      subscription_status: ["active", "canceled", "expired"],
      trade_status: ["open", "closed", "stopped"],
    },
  },
} as const

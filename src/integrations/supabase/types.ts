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
      checkup_knowledge_items: {
        Row: {
          action: string | null
          category: string
          confidence: number | null
          created_at: string | null
          fact: string
          id: string
          interpretation: string | null
          is_active: boolean | null
          item_id: string
          lessons: string | null
          outcome: string | null
          return_pct: number | null
          tags: string[] | null
          title: string
          updated_at: string | null
        }
        Insert: {
          action?: string | null
          category: string
          confidence?: number | null
          created_at?: string | null
          fact: string
          id?: string
          interpretation?: string | null
          is_active?: boolean | null
          item_id: string
          lessons?: string | null
          outcome?: string | null
          return_pct?: number | null
          tags?: string[] | null
          title: string
          updated_at?: string | null
        }
        Update: {
          action?: string | null
          category?: string
          confidence?: number | null
          created_at?: string | null
          fact?: string
          id?: string
          interpretation?: string | null
          is_active?: boolean | null
          item_id?: string
          lessons?: string | null
          outcome?: string | null
          return_pct?: number | null
          tags?: string[] | null
          title?: string
          updated_at?: string | null
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
          id: string
          is_limit_up: boolean
          limit_up_price: number | null
          symbol: string
          trade_date: string
          volume: number | null
          yesterday_close: number | null
        }
        Insert: {
          change_percent?: number | null
          close_price?: number | null
          created_at?: string
          id?: string
          is_limit_up?: boolean
          limit_up_price?: number | null
          symbol: string
          trade_date: string
          volume?: number | null
          yesterday_close?: number | null
        }
        Update: {
          change_percent?: number | null
          close_price?: number | null
          created_at?: string
          id?: string
          is_limit_up?: boolean
          limit_up_price?: number | null
          symbol?: string
          trade_date?: string
          volume?: number | null
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
      payment_transactions: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          paid_at: string | null
          provider_id: string | null
          provider_tx_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          subscription_id: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          paid_at?: string | null
          provider_id?: string | null
          provider_tx_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          subscription_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
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
    }
    Views: {
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
    }
    Functions: {
      calculate_expert_performance: {
        Args: { _expert_id: string }
        Returns: Json
      }
      cleanup_old_announcements: { Args: never; Returns: undefined }
      delete_expired_binding_codes: { Args: never; Returns: undefined }
      delete_old_prices: { Args: never; Returns: undefined }
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
      plan_type:
        | "analyst_signal_l1"
        | "analyst_signal_diag_l2"
        | "mentor_weekly_journal"
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
      plan_type: [
        "analyst_signal_l1",
        "analyst_signal_diag_l2",
        "mentor_weekly_journal",
      ],
      provider_type: ["ecpay", "newebpay", "stripe", "line_pay", "acpay"],
      signal_action: ["buy", "sell", "add", "trim", "exit"],
      signal_status: ["published", "pending"],
      subscription_status: ["active", "canceled", "expired"],
      trade_status: ["open", "closed", "stopped"],
    },
  },
} as const

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
      account_link_codes: {
        Row: {
          code: string
          consumed_at: string | null
          consumed_by_user_id: string | null
          created_at: string
          expires_at: string
          id: string
          initiator_email: string | null
          initiator_identity: string
          initiator_line_user_id: string | null
          initiator_user_id: string
        }
        Insert: {
          code: string
          consumed_at?: string | null
          consumed_by_user_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          initiator_email?: string | null
          initiator_identity: string
          initiator_line_user_id?: string | null
          initiator_user_id: string
        }
        Update: {
          code?: string
          consumed_at?: string | null
          consumed_by_user_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          initiator_email?: string | null
          initiator_identity?: string
          initiator_line_user_id?: string | null
          initiator_user_id?: string
        }
        Relationships: []
      }
      account_merges: {
        Row: {
          created_at: string
          id: string
          moved_counts: Json
          performed_by: string | null
          primary_email: string | null
          primary_identity: string | null
          primary_user_id: string
          secondary_email: string | null
          secondary_identity: string | null
          secondary_user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          moved_counts?: Json
          performed_by?: string | null
          primary_email?: string | null
          primary_identity?: string | null
          primary_user_id: string
          secondary_email?: string | null
          secondary_identity?: string | null
          secondary_user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          moved_counts?: Json
          performed_by?: string | null
          primary_email?: string | null
          primary_identity?: string | null
          primary_user_id?: string
          secondary_email?: string | null
          secondary_identity?: string | null
          secondary_user_id?: string
        }
        Relationships: []
      }
      ad_spend: {
        Row: {
          created_at: string
          id: string
          note: string | null
          spend_amount: number
          updated_at: string
          utm_campaign: string
          utm_medium: string | null
          utm_source: string | null
          yyyymm: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          spend_amount?: number
          updated_at?: string
          utm_campaign: string
          utm_medium?: string | null
          utm_source?: string | null
          yyyymm: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          spend_amount?: number
          updated_at?: string
          utm_campaign?: string
          utm_medium?: string | null
          utm_source?: string | null
          yyyymm?: string
        }
        Relationships: []
      }
      admin_view_as_sessions: {
        Row: {
          admin_user_id: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          ip: string | null
          revoked_at: string | null
          target_user_id: string
          token: string
          user_agent: string | null
        }
        Insert: {
          admin_user_id: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          ip?: string | null
          revoked_at?: string | null
          target_user_id: string
          token: string
          user_agent?: string | null
        }
        Update: {
          admin_user_id?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          ip?: string | null
          revoked_at?: string | null
          target_user_id?: string
          token?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      ai_gateway_usage_logs: {
        Row: {
          completion_tokens: number | null
          correlation_id: string | null
          cost_usd: number | null
          created_at: string
          duration_ms: number | null
          endpoint: string
          expert_id: string | null
          expert_slug: string | null
          finish_reason: string | null
          id: string
          log_id: string | null
          meta: Json | null
          model: string
          prompt_tokens: number | null
          run_id: string | null
          total_tokens: number | null
          user_id: string | null
        }
        Insert: {
          completion_tokens?: number | null
          correlation_id?: string | null
          cost_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          endpoint: string
          expert_id?: string | null
          expert_slug?: string | null
          finish_reason?: string | null
          id?: string
          log_id?: string | null
          meta?: Json | null
          model: string
          prompt_tokens?: number | null
          run_id?: string | null
          total_tokens?: number | null
          user_id?: string | null
        }
        Update: {
          completion_tokens?: number | null
          correlation_id?: string | null
          cost_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          endpoint?: string
          expert_id?: string | null
          expert_slug?: string | null
          finish_reason?: string | null
          id?: string
          log_id?: string | null
          meta?: Json | null
          model?: string
          prompt_tokens?: number | null
          run_id?: string | null
          total_tokens?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
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
      backfill_job_queue: {
        Row: {
          attempts: number
          correlation_id: string | null
          created_at: string
          dataset: string
          end_date: string
          fulfilled_at: string | null
          id: number
          last_error: string | null
          max_attempts: number
          next_run_at: string
          payload: Json | null
          priority_score: number
          source_hint: string
          start_date: string
          status: string
          stock_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          correlation_id?: string | null
          created_at?: string
          dataset: string
          end_date: string
          fulfilled_at?: string | null
          id?: number
          last_error?: string | null
          max_attempts?: number
          next_run_at?: string
          payload?: Json | null
          priority_score?: number
          source_hint?: string
          start_date: string
          status?: string
          stock_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          correlation_id?: string | null
          created_at?: string
          dataset?: string
          end_date?: string
          fulfilled_at?: string | null
          id?: number
          last_error?: string | null
          max_attempts?: number
          next_run_at?: string
          payload?: Json | null
          priority_score?: number
          source_hint?: string
          start_date?: string
          status?: string
          stock_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      bsr_coverage_daily: {
        Row: {
          broker_count: number
          broker_sum_shares: number
          computed_at: string
          coverage_class: string
          coverage_pct: number | null
          snapshot_volume_shares: number | null
          stock_id: string
          trade_date: string
        }
        Insert: {
          broker_count?: number
          broker_sum_shares?: number
          computed_at?: string
          coverage_class?: string
          coverage_pct?: number | null
          snapshot_volume_shares?: number | null
          stock_id: string
          trade_date: string
        }
        Update: {
          broker_count?: number
          broker_sum_shares?: number
          computed_at?: string
          coverage_class?: string
          coverage_pct?: number | null
          snapshot_volume_shares?: number | null
          stock_id?: string
          trade_date?: string
        }
        Relationships: []
      }
      checkup_analysis_jobs: {
        Row: {
          created_at: string
          error_text: string | null
          finished_at: string | null
          holdings_snapshot: Json | null
          id: string
          notified_at: string | null
          prompts_payload: Json | null
          raw_responses: Json | null
          result_summary: Json | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_text?: string | null
          finished_at?: string | null
          holdings_snapshot?: Json | null
          id?: string
          notified_at?: string | null
          prompts_payload?: Json | null
          raw_responses?: Json | null
          result_summary?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_text?: string | null
          finished_at?: string | null
          holdings_snapshot?: Json | null
          id?: string
          notified_at?: string | null
          prompts_payload?: Json | null
          raw_responses?: Json | null
          result_summary?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      checkup_daily_reminders: {
        Row: {
          channels: Json
          created_at: string
          id: string
          reminded_on: string
          user_id: string
        }
        Insert: {
          channels?: Json
          created_at?: string
          id?: string
          reminded_on: string
          user_id: string
        }
        Update: {
          channels?: Json
          created_at?: string
          id?: string
          reminded_on?: string
          user_id?: string
        }
        Relationships: []
      }
      checkup_entitlements: {
        Row: {
          amount: number
          created_at: string
          expires_at: string | null
          granted_by: string | null
          id: string
          is_active: boolean
          reason: string
          source: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          is_active?: boolean
          reason: string
          source?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          is_active?: boolean
          reason?: string
          source?: string | null
          updated_at?: string
          user_id?: string
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
          archived_reason: string | null
          backtest_run_at: string | null
          backtest_stats: Json | null
          backtestable: boolean
          candidate_observed_since: string | null
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
          lifecycle_status: string
          outcome: string | null
          parent_item_id: string | null
          rescue_attempts: number
          rescue_started_at: string | null
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
          archived_reason?: string | null
          backtest_run_at?: string | null
          backtest_stats?: Json | null
          backtestable?: boolean
          candidate_observed_since?: string | null
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
          lifecycle_status?: string
          outcome?: string | null
          parent_item_id?: string | null
          rescue_attempts?: number
          rescue_started_at?: string | null
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
          archived_reason?: string | null
          backtest_run_at?: string | null
          backtest_stats?: Json | null
          backtestable?: boolean
          candidate_observed_since?: string | null
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
          lifecycle_status?: string
          outcome?: string | null
          parent_item_id?: string | null
          rescue_attempts?: number
          rescue_started_at?: string | null
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
          user_id: string | null
          was_correct: boolean
        }
        Insert: {
          actual: string
          event_id: string
          event_type?: string | null
          id?: string
          pred: string
          reviewed_at?: string
          user_id?: string | null
          was_correct?: boolean
        }
        Update: {
          actual?: string
          event_id?: string
          event_type?: string | null
          id?: string
          pred?: string
          reviewed_at?: string
          user_id?: string | null
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
      conversions: {
        Row: {
          channel: string
          created_at: string
          expert_amount: number
          gross_amount: number
          id: string
          occurred_at: string
          order_id: string | null
          order_kind: string
          platform_amount: number
          ref_code: string | null
          user_id: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          visitor_id: string | null
        }
        Insert: {
          channel?: string
          created_at?: string
          expert_amount?: number
          gross_amount?: number
          id?: string
          occurred_at?: string
          order_id?: string | null
          order_kind: string
          platform_amount?: number
          ref_code?: string | null
          user_id: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          visitor_id?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          expert_amount?: number
          gross_amount?: number
          id?: string
          occurred_at?: string
          order_id?: string | null
          order_kind?: string
          platform_amount?: number
          ref_code?: string | null
          user_id?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          visitor_id?: string | null
        }
        Relationships: []
      }
      cron_dispatch_log: {
        Row: {
          dispatched_at: string
          id: number
          jobname: string
          request_id: number | null
        }
        Insert: {
          dispatched_at?: string
          id?: number
          jobname: string
          request_id?: number | null
        }
        Update: {
          dispatched_at?: string
          id?: number
          jobname?: string
          request_id?: number | null
        }
        Relationships: []
      }
      crypto_symbol_map: {
        Row: {
          binance_pair: string | null
          coingecko_id: string
          created_at: string
          display_name: string
          is_active: boolean
          symbol: string
          updated_at: string
        }
        Insert: {
          binance_pair?: string | null
          coingecko_id: string
          created_at?: string
          display_name: string
          is_active?: boolean
          symbol: string
          updated_at?: string
        }
        Update: {
          binance_pair?: string | null
          coingecko_id?: string
          created_at?: string
          display_name?: string
          is_active?: boolean
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      current_prices: {
        Row: {
          asset_class: string
          best_ask: number | null
          best_bid: number | null
          change_percent: number | null
          change_value: number | null
          currency: string
          high_price: number | null
          limit_down: number | null
          limit_up: number | null
          low_price: number | null
          market: string
          name: string | null
          open_price: number | null
          price: number | null
          pushed_at: string | null
          symbol: string
          tick_volume: number | null
          updated_at: string
          volume: number | null
          writer: string | null
          yesterday_close: number | null
        }
        Insert: {
          asset_class?: string
          best_ask?: number | null
          best_bid?: number | null
          change_percent?: number | null
          change_value?: number | null
          currency?: string
          high_price?: number | null
          limit_down?: number | null
          limit_up?: number | null
          low_price?: number | null
          market?: string
          name?: string | null
          open_price?: number | null
          price?: number | null
          pushed_at?: string | null
          symbol: string
          tick_volume?: number | null
          updated_at?: string
          volume?: number | null
          writer?: string | null
          yesterday_close?: number | null
        }
        Update: {
          asset_class?: string
          best_ask?: number | null
          best_bid?: number | null
          change_percent?: number | null
          change_value?: number | null
          currency?: string
          high_price?: number | null
          limit_down?: number | null
          limit_up?: number | null
          low_price?: number | null
          market?: string
          name?: string | null
          open_price?: number | null
          price?: number | null
          pushed_at?: string | null
          symbol?: string
          tick_volume?: number | null
          updated_at?: string
          volume?: number | null
          writer?: string | null
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
          market: string
          open_price: number | null
          symbol: string
          trade_date: string
          volume: number | null
          volume_ma5: number | null
          volume_shares: number | null
          volume_unit: string | null
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
          market?: string
          open_price?: number | null
          symbol: string
          trade_date: string
          volume?: number | null
          volume_ma5?: number | null
          volume_shares?: number | null
          volume_unit?: string | null
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
          market?: string
          open_price?: number | null
          symbol?: string
          trade_date?: string
          volume?: number | null
          volume_ma5?: number | null
          volume_shares?: number | null
          volume_unit?: string | null
          yesterday_close?: number | null
        }
        Relationships: []
      }
      data_source_health: {
        Row: {
          circuit_state: string
          consecutive_failures: number
          disabled_until: string | null
          fail_count_10m: number
          last_error_code: string | null
          last_failure_at: string | null
          last_success_at: string | null
          ok_count_10m: number
          p95_latency_ms: number | null
          source: string
          updated_at: string
          upstream_quota_limit: number | null
          upstream_quota_remaining: number | null
          upstream_quota_reset_at: string | null
        }
        Insert: {
          circuit_state?: string
          consecutive_failures?: number
          disabled_until?: string | null
          fail_count_10m?: number
          last_error_code?: string | null
          last_failure_at?: string | null
          last_success_at?: string | null
          ok_count_10m?: number
          p95_latency_ms?: number | null
          source: string
          updated_at?: string
          upstream_quota_limit?: number | null
          upstream_quota_remaining?: number | null
          upstream_quota_reset_at?: string | null
        }
        Update: {
          circuit_state?: string
          consecutive_failures?: number
          disabled_until?: string | null
          fail_count_10m?: number
          last_error_code?: string | null
          last_failure_at?: string | null
          last_success_at?: string | null
          ok_count_10m?: number
          p95_latency_ms?: number | null
          source?: string
          updated_at?: string
          upstream_quota_limit?: number | null
          upstream_quota_remaining?: number | null
          upstream_quota_reset_at?: string | null
        }
        Relationships: []
      }
      data_source_refresh_logs: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_message: string | null
          finished_at: string | null
          id: string
          metadata: Json | null
          row_count: number | null
          source_key: string
          started_at: string
          status: string
          triggered_by: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json | null
          row_count?: number | null
          source_key: string
          started_at?: string
          status: string
          triggered_by?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json | null
          row_count?: number | null
          source_key?: string
          started_at?: string
          status?: string
          triggered_by?: string | null
        }
        Relationships: []
      }
      edge_boot_events: {
        Row: {
          boot_at: string
          deployment_id: string | null
          fn: string
          id: number
          region: string | null
        }
        Insert: {
          boot_at?: string
          deployment_id?: string | null
          fn: string
          id?: number
          region?: string | null
        }
        Update: {
          boot_at?: string
          deployment_id?: string | null
          fn?: string
          id?: number
          region?: string | null
        }
        Relationships: []
      }
      edge_function_auth_events: {
        Row: {
          auth_class: string
          caller_ip: string | null
          code: string | null
          correlation_id: string | null
          created_at: string
          fn_name: string
          id: number
          outcome: number
          reason: string | null
        }
        Insert: {
          auth_class: string
          caller_ip?: string | null
          code?: string | null
          correlation_id?: string | null
          created_at?: string
          fn_name: string
          id?: number
          outcome: number
          reason?: string | null
        }
        Update: {
          auth_class?: string
          caller_ip?: string | null
          code?: string | null
          correlation_id?: string | null
          created_at?: string
          fn_name?: string
          id?: number
          outcome?: number
          reason?: string | null
        }
        Relationships: []
      }
      expert_ai_access_logs: {
        Row: {
          created_at: string
          decision: string
          expert_id: string | null
          expert_slug: string | null
          id: string
          meta: Json | null
          plan_id: string | null
          plan_type: string | null
          quota_limit: number | null
          quota_used: number | null
          rule: string
          subscription_status: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          decision: string
          expert_id?: string | null
          expert_slug?: string | null
          id?: string
          meta?: Json | null
          plan_id?: string | null
          plan_type?: string | null
          quota_limit?: number | null
          quota_used?: number | null
          rule: string
          subscription_status?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          decision?: string
          expert_id?: string | null
          expert_slug?: string | null
          id?: string
          meta?: Json | null
          plan_id?: string | null
          plan_type?: string | null
          quota_limit?: number | null
          quota_used?: number | null
          rule?: string
          subscription_status?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      expert_ai_conversations: {
        Row: {
          created_at: string
          expert_id: string
          id: string
          last_message_at: string
          title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expert_id: string
          id?: string
          last_message_at?: string
          title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expert_id?: string
          id?: string
          last_message_at?: string
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_ai_conversations_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_ai_conversations_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts_public"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_ai_fewshots: {
        Row: {
          answer: string
          created_at: string
          created_by: string | null
          expert_id: string
          id: string
          question: string
          reviewed_at: string | null
          reviewed_by: string | null
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          answer: string
          created_at?: string
          created_by?: string | null
          expert_id: string
          id?: string
          question: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          answer?: string
          created_at?: string
          created_by?: string | null
          expert_id?: string
          id?: string
          question?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_ai_fewshots_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_ai_fewshots_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts_public"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_ai_index_runs: {
        Row: {
          created_at: string
          duration_ms: number | null
          embed_failures: number
          error_message: string | null
          expert_id: string
          finished_at: string | null
          id: string
          indexed_chunks: number
          started_at: string
          status: string
          total_chunks: number | null
          trigger_source: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          embed_failures?: number
          error_message?: string | null
          expert_id: string
          finished_at?: string | null
          id?: string
          indexed_chunks?: number
          started_at?: string
          status?: string
          total_chunks?: number | null
          trigger_source?: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          embed_failures?: number
          error_message?: string | null
          expert_id?: string
          finished_at?: string | null
          id?: string
          indexed_chunks?: number
          started_at?: string
          status?: string
          total_chunks?: number | null
          trigger_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_ai_index_runs_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_ai_index_runs_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts_public"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_ai_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "expert_ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_ai_personas: {
        Row: {
          created_at: string
          disclaimer: string | null
          expert_id: string
          forbidden_topics: string[] | null
          model: string
          system_prompt: string | null
          tone: string[] | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          disclaimer?: string | null
          expert_id: string
          forbidden_topics?: string[] | null
          model?: string
          system_prompt?: string | null
          tone?: string[] | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          disclaimer?: string | null
          expert_id?: string
          forbidden_topics?: string[] | null
          model?: string
          system_prompt?: string | null
          tone?: string[] | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expert_ai_personas_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: true
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_ai_personas_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: true
            referencedRelation: "experts_public"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_ai_training_sessions: {
        Row: {
          ai_questions: Json
          answers: Json
          completed_at: string | null
          created_at: string
          expert_id: string
          id: string
          revisions: Json
          signal_id: string | null
          started_at: string
          status: string
          suggested_journal_edits: Json
          suggested_knowledge: Json
          updated_at: string
          week_start: string | null
        }
        Insert: {
          ai_questions?: Json
          answers?: Json
          completed_at?: string | null
          created_at?: string
          expert_id: string
          id?: string
          revisions?: Json
          signal_id?: string | null
          started_at?: string
          status?: string
          suggested_journal_edits?: Json
          suggested_knowledge?: Json
          updated_at?: string
          week_start?: string | null
        }
        Update: {
          ai_questions?: Json
          answers?: Json
          completed_at?: string | null
          created_at?: string
          expert_id?: string
          id?: string
          revisions?: Json
          signal_id?: string | null
          started_at?: string
          status?: string
          suggested_journal_edits?: Json
          suggested_knowledge?: Json
          updated_at?: string
          week_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expert_ai_training_sessions_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_ai_training_sessions_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_ai_training_sessions_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "expert_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_knowledge_chunks: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          embedding: string
          expert_id: string
          id: string
          is_manual: boolean
          metadata: Json
          reviewed_at: string | null
          reviewed_by: string | null
          source_id: string | null
          source_type: string
          status: string
          title: string | null
          training_session_id: string | null
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          embedding: string
          expert_id: string
          id?: string
          is_manual?: boolean
          metadata?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id?: string | null
          source_type: string
          status?: string
          title?: string | null
          training_session_id?: string | null
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          embedding?: string
          expert_id?: string
          id?: string
          is_manual?: boolean
          metadata?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id?: string | null
          source_type?: string
          status?: string
          title?: string | null
          training_session_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_knowledge_chunks_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_knowledge_chunks_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_knowledge_chunks_training_session_id_fkey"
            columns: ["training_session_id"]
            isOneToOne: false
            referencedRelation: "expert_ai_training_sessions"
            referencedColumns: ["id"]
          },
        ]
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
      expert_signal_legs: {
        Row: {
          created_at: string
          expiry: string | null
          id: string
          leg_index: number
          leg_price: number | null
          occ_symbol: string | null
          ratio: number
          right_type: string | null
          side: string
          signal_id: string
          strike: number | null
          underlying: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expiry?: string | null
          id?: string
          leg_index?: number
          leg_price?: number | null
          occ_symbol?: string | null
          ratio?: number
          right_type?: string | null
          side?: string
          signal_id: string
          strike?: number | null
          underlying: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expiry?: string | null
          id?: string
          leg_index?: number
          leg_price?: number | null
          occ_symbol?: string | null
          ratio?: number
          right_type?: string | null
          side?: string
          signal_id?: string
          strike?: number | null
          underlying?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_signal_legs_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "expert_signals"
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
          batch_id: string | null
          combo_strategy: string | null
          created_at: string
          executed_at: string | null
          expert_id: string
          id: string
          instrument: string
          is_combo: boolean
          learning_points: string | null
          line_pushed_at: string | null
          market: string
          max_loss_per_unit: number | null
          max_profit_per_unit: number | null
          net_premium: number | null
          overall_summary: string | null
          plan_id: string | null
          price_hint: number | null
          published_at: string | null
          quantity: number | null
          quantity_unit: string | null
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
          batch_id?: string | null
          combo_strategy?: string | null
          created_at?: string
          executed_at?: string | null
          expert_id: string
          id?: string
          instrument: string
          is_combo?: boolean
          learning_points?: string | null
          line_pushed_at?: string | null
          market: string
          max_loss_per_unit?: number | null
          max_profit_per_unit?: number | null
          net_premium?: number | null
          overall_summary?: string | null
          plan_id?: string | null
          price_hint?: number | null
          published_at?: string | null
          quantity?: number | null
          quantity_unit?: string | null
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
          batch_id?: string | null
          combo_strategy?: string | null
          created_at?: string
          executed_at?: string | null
          expert_id?: string
          id?: string
          instrument?: string
          is_combo?: boolean
          learning_points?: string | null
          line_pushed_at?: string | null
          market?: string
          max_loss_per_unit?: number | null
          max_profit_per_unit?: number | null
          net_premium?: number | null
          overall_summary?: string | null
          plan_id?: string | null
          price_hint?: number | null
          published_at?: string | null
          quantity?: number | null
          quantity_unit?: string | null
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
          asset_class: string
          avatar_url: string | null
          backtest_1y_return: number | null
          backtest_annual_return: number | null
          backtest_max_drawdown: number | null
          bio: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          id: string
          markets: string[] | null
          name: string
          operation_cycle: string | null
          risk_preference: string | null
          role: Database["public"]["Enums"]["expert_role"]
          slug: string
          starting_capital: number | null
          status: string
          strategy_name: string | null
          strategy_summary: string | null
          style_tags: string[] | null
          user_id: string
        }
        Insert: {
          asset_class?: string
          avatar_url?: string | null
          backtest_1y_return?: number | null
          backtest_annual_return?: number | null
          backtest_max_drawdown?: number | null
          bio?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          id?: string
          markets?: string[] | null
          name: string
          operation_cycle?: string | null
          risk_preference?: string | null
          role: Database["public"]["Enums"]["expert_role"]
          slug: string
          starting_capital?: number | null
          status?: string
          strategy_name?: string | null
          strategy_summary?: string | null
          style_tags?: string[] | null
          user_id: string
        }
        Update: {
          asset_class?: string
          avatar_url?: string | null
          backtest_1y_return?: number | null
          backtest_annual_return?: number | null
          backtest_max_drawdown?: number | null
          bio?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          id?: string
          markets?: string[] | null
          name?: string
          operation_cycle?: string | null
          risk_preference?: string | null
          role?: Database["public"]["Enums"]["expert_role"]
          slug?: string
          starting_capital?: number | null
          status?: string
          strategy_name?: string | null
          strategy_summary?: string | null
          style_tags?: string[] | null
          user_id?: string
        }
        Relationships: []
      }
      finmind_inflight_requests: {
        Row: {
          expires_at: string
          key: string
          kind: string
          started_at: string
          stock_id: string | null
        }
        Insert: {
          expires_at?: string
          key: string
          kind: string
          started_at?: string
          stock_id?: string | null
        }
        Update: {
          expires_at?: string
          key?: string
          kind?: string
          started_at?: string
          stock_id?: string | null
        }
        Relationships: []
      }
      finmind_quota_ledger: {
        Row: {
          borrowed_from: string | null
          created_at: string
          granted: boolean
          id: number
          pool_name: string
          reason: string | null
          request_kind: string
          root_cause_hint: string | null
          stock_id: string | null
        }
        Insert: {
          borrowed_from?: string | null
          created_at?: string
          granted: boolean
          id?: number
          pool_name: string
          reason?: string | null
          request_kind: string
          root_cause_hint?: string | null
          stock_id?: string | null
        }
        Update: {
          borrowed_from?: string | null
          created_at?: string
          granted?: boolean
          id?: number
          pool_name?: string
          reason?: string | null
          request_kind?: string
          root_cause_hint?: string | null
          stock_id?: string | null
        }
        Relationships: []
      }
      finmind_quota_pools: {
        Row: {
          base_daily_budget: number | null
          borrow_enabled: boolean
          capacity: number | null
          daily_budget: number
          last_refill_at: string
          last_reject_at: string | null
          last_reject_reason: string | null
          manual_override: boolean
          pool_name: string
          priority: number
          refill_per_min: number
          reset_at: string
          slo_boost_until: string | null
          tokens: number | null
          updated_at: string
          used_today: number
        }
        Insert: {
          base_daily_budget?: number | null
          borrow_enabled?: boolean
          capacity?: number | null
          daily_budget?: number
          last_refill_at?: string
          last_reject_at?: string | null
          last_reject_reason?: string | null
          manual_override?: boolean
          pool_name: string
          priority?: number
          refill_per_min?: number
          reset_at?: string
          slo_boost_until?: string | null
          tokens?: number | null
          updated_at?: string
          used_today?: number
        }
        Update: {
          base_daily_budget?: number | null
          borrow_enabled?: boolean
          capacity?: number | null
          daily_budget?: number
          last_refill_at?: string
          last_reject_at?: string | null
          last_reject_reason?: string | null
          manual_override?: boolean
          pool_name?: string
          priority?: number
          refill_per_min?: number
          reset_at?: string
          slo_boost_until?: string | null
          tokens?: number | null
          updated_at?: string
          used_today?: number
        }
        Relationships: []
      }
      finmind_upstream_quota: {
        Row: {
          observed_at: string
          quota_limit: number | null
          raw: Json | null
          remaining: number | null
          reset_at: string | null
          source: string
        }
        Insert: {
          observed_at?: string
          quota_limit?: number | null
          raw?: Json | null
          remaining?: number | null
          reset_at?: string | null
          source: string
        }
        Update: {
          observed_at?: string
          quota_limit?: number | null
          raw?: Json | null
          remaining?: number | null
          reset_at?: string | null
          source?: string
        }
        Relationships: []
      }
      function_run_logs: {
        Row: {
          created_at: string
          expert_id: string | null
          fn: string
          id: string
          level: string
          msg: string | null
          payload: Json
          run_id: string
          signal_id: string | null
          stage: string | null
        }
        Insert: {
          created_at?: string
          expert_id?: string | null
          fn: string
          id?: string
          level?: string
          msg?: string | null
          payload?: Json
          run_id: string
          signal_id?: string | null
          stage?: string | null
        }
        Update: {
          created_at?: string
          expert_id?: string | null
          fn?: string
          id?: string
          level?: string
          msg?: string | null
          payload?: Json
          run_id?: string
          signal_id?: string | null
          stage?: string | null
        }
        Relationships: []
      }
      fx_rates: {
        Row: {
          currency_pair: string
          fetched_at: string
          rate: number
          source: string
          updated_at: string
        }
        Insert: {
          currency_pair: string
          fetched_at?: string
          rate: number
          source: string
          updated_at?: string
        }
        Update: {
          currency_pair?: string
          fetched_at?: string
          rate?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      holding_meta_override_history: {
        Row: {
          action: string
          code: string
          id: string
          industries: string[] | null
          industry: string | null
          leader: string | null
          position: string | null
          recorded_at: string
          recorded_by: string | null
          revenue_mix: Json | null
          source: string | null
          strategy: string | null
          themes: string[] | null
          user_id: string
        }
        Insert: {
          action?: string
          code: string
          id?: string
          industries?: string[] | null
          industry?: string | null
          leader?: string | null
          position?: string | null
          recorded_at?: string
          recorded_by?: string | null
          revenue_mix?: Json | null
          source?: string | null
          strategy?: string | null
          themes?: string[] | null
          user_id: string
        }
        Update: {
          action?: string
          code?: string
          id?: string
          industries?: string[] | null
          industry?: string | null
          leader?: string | null
          position?: string | null
          recorded_at?: string
          recorded_by?: string | null
          revenue_mix?: Json | null
          source?: string | null
          strategy?: string | null
          themes?: string[] | null
          user_id?: string
        }
        Relationships: []
      }
      holding_meta_overrides: {
        Row: {
          code: string
          created_at: string
          id: string
          industries: string[] | null
          industry: string | null
          leader: string | null
          position: string | null
          revenue_mix: Json | null
          source: string
          strategy: string | null
          themes: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          industries?: string[] | null
          industry?: string | null
          leader?: string | null
          position?: string | null
          revenue_mix?: Json | null
          source?: string
          strategy?: string | null
          themes?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          industries?: string[] | null
          industry?: string | null
          leader?: string | null
          position?: string | null
          revenue_mix?: Json | null
          source?: string
          strategy?: string | null
          themes?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      holdings_fix_proposals: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          apply_result: Json | null
          created_at: string
          drift_category: string
          expert_id: string | null
          expert_name: string | null
          expert_slug: string | null
          generated_at: string
          generated_by: string | null
          id: string
          instrument: string | null
          payload: Json
          preview: Json
          proposed_action: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          severity: string
          signature: string
          status: string
          summary: string
          symbol: string | null
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          apply_result?: Json | null
          created_at?: string
          drift_category: string
          expert_id?: string | null
          expert_name?: string | null
          expert_slug?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          instrument?: string | null
          payload?: Json
          preview?: Json
          proposed_action: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity?: string
          signature: string
          status?: string
          summary: string
          symbol?: string | null
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          apply_result?: Json | null
          created_at?: string
          drift_category?: string
          expert_id?: string | null
          expert_name?: string | null
          expert_slug?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          instrument?: string | null
          payload?: Json
          preview?: Json
          proposed_action?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity?: string
          signature?: string
          status?: string
          summary?: string
          symbol?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "holdings_fix_proposals_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holdings_fix_proposals_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts_public"
            referencedColumns: ["id"]
          },
        ]
      }
      institutional_new_stock_queue: {
        Row: {
          attempts: number
          id: string
          last_error: string | null
          next_attempt_at: string
          requested_at: string
          status: string
          stock_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          requested_at?: string
          status?: string
          stock_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          requested_at?: string
          status?: string
          stock_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      internal_cron_secrets: {
        Row: {
          cron_key: string
          id: number
          rotated_at: string
        }
        Insert: {
          cron_key: string
          id?: number
          rotated_at?: string
        }
        Update: {
          cron_key?: string
          id?: number
          rotated_at?: string
        }
        Relationships: []
      }
      knowledge_auto_rules: {
        Row: {
          archive_below_win_rate: number
          auto_grid_search_below: number
          candidate_observe_days: number
          daily_grid_search_quota: number
          enabled: boolean
          id: string
          min_sample_size: number
          promote_above_win_rate: number
          promote_min_improvement_pct: number
          rescue_max_weeks: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archive_below_win_rate?: number
          auto_grid_search_below?: number
          candidate_observe_days?: number
          daily_grid_search_quota?: number
          enabled?: boolean
          id?: string
          min_sample_size?: number
          promote_above_win_rate?: number
          promote_min_improvement_pct?: number
          rescue_max_weeks?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archive_below_win_rate?: number
          auto_grid_search_below?: number
          candidate_observe_days?: number
          daily_grid_search_quota?: number
          enabled?: boolean
          id?: string
          min_sample_size?: number
          promote_above_win_rate?: number
          promote_min_improvement_pct?: number
          rescue_max_weeks?: number
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
      line_login_nonces: {
        Row: {
          access_token: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          nonce: string
          refresh_token: string
          user_id: string
        }
        Insert: {
          access_token: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          nonce?: string
          refresh_token: string
          user_id: string
        }
        Update: {
          access_token?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          nonce?: string
          refresh_token?: string
          user_id?: string
        }
        Relationships: []
      }
      line_oauth_states: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          payload: Json
          state: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          payload?: Json
          state: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          payload?: Json
          state?: string
        }
        Relationships: []
      }
      line_push_jobs: {
        Row: {
          action_label: string | null
          action_url: string | null
          created_at: string
          created_by: string
          error: string | null
          failed_count: number
          finished_at: string | null
          id: string
          image_url: string | null
          message_kind: string
          recipient_user_ids: string[]
          result: Json | null
          scheduled_at: string | null
          sent_count: number
          skipped_count: number
          started_at: string | null
          status: string
          text: string | null
          updated_at: string
        }
        Insert: {
          action_label?: string | null
          action_url?: string | null
          created_at?: string
          created_by: string
          error?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          image_url?: string | null
          message_kind: string
          recipient_user_ids: string[]
          result?: Json | null
          scheduled_at?: string | null
          sent_count?: number
          skipped_count?: number
          started_at?: string | null
          status?: string
          text?: string | null
          updated_at?: string
        }
        Update: {
          action_label?: string | null
          action_url?: string | null
          created_at?: string
          created_by?: string
          error?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          image_url?: string | null
          message_kind?: string
          recipient_user_ids?: string[]
          result?: Json | null
          scheduled_at?: string | null
          sent_count?: number
          skipped_count?: number
          started_at?: string | null
          status?: string
          text?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      line_push_receipts: {
        Row: {
          created_at: string
          dedupe_key: string
          expert_id: string | null
          id: string
          kind: string
          recipient: string
          sent_at: string
        }
        Insert: {
          created_at?: string
          dedupe_key: string
          expert_id?: string | null
          id?: string
          kind: string
          recipient: string
          sent_at?: string
        }
        Update: {
          created_at?: string
          dedupe_key?: string
          expert_id?: string | null
          id?: string
          kind?: string
          recipient?: string
          sent_at?: string
        }
        Relationships: []
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
          billing_cycle?: string
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
      notification_preferences: {
        Row: {
          checkup_complete_email: boolean
          checkup_complete_line: boolean
          meta_override_changed: boolean
          renewal_email: boolean
          target_price_new: boolean
          target_price_updated: boolean
          target_price_weekly: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          checkup_complete_email?: boolean
          checkup_complete_line?: boolean
          meta_override_changed?: boolean
          renewal_email?: boolean
          target_price_new?: boolean
          target_price_updated?: boolean
          target_price_weekly?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          checkup_complete_email?: boolean
          checkup_complete_line?: boolean
          meta_override_changed?: boolean
          renewal_email?: boolean
          target_price_new?: boolean
          target_price_updated?: boolean
          target_price_weekly?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          download_url: string | null
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
          download_url?: string | null
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
          download_url?: string | null
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
          completed_at: string | null
          created_at: string
          discount_amount: number
          discount_reason: string | null
          expert_id: string | null
          final_recovery_notified_at: string | null
          id: string
          original_amount: number
          plan_id: string | null
          product_kind: string
          recovery_notified_at: string | null
          status: string
          trade_no: string
          upgrade_from_subscription_id: string | null
          user_id: string | null
        }
        Insert: {
          amount: number
          attribution?: Json | null
          billing_cycle: string
          checkup_plan_id?: string | null
          completed_at?: string | null
          created_at?: string
          discount_amount?: number
          discount_reason?: string | null
          expert_id?: string | null
          final_recovery_notified_at?: string | null
          id?: string
          original_amount: number
          plan_id?: string | null
          product_kind?: string
          recovery_notified_at?: string | null
          status?: string
          trade_no: string
          upgrade_from_subscription_id?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number
          attribution?: Json | null
          billing_cycle?: string
          checkup_plan_id?: string | null
          completed_at?: string | null
          created_at?: string
          discount_amount?: number
          discount_reason?: string | null
          expert_id?: string | null
          final_recovery_notified_at?: string | null
          id?: string
          original_amount?: number
          plan_id?: string | null
          product_kind?: string
          recovery_notified_at?: string | null
          status?: string
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
      paywall_events: {
        Row: {
          context: Json | null
          created_at: string
          event_kind: string
          id: string
          surface: string
          user_id: string | null
          variant: string | null
          visitor_id: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          event_kind: string
          id?: string
          surface: string
          user_id?: string | null
          variant?: string | null
          visitor_id?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          event_kind?: string
          id?: string
          surface?: string
          user_id?: string | null
          variant?: string | null
          visitor_id?: string | null
        }
        Relationships: []
      }
      perf_metrics: {
        Row: {
          cls_score: number | null
          created_at: string
          fcp_ms: number | null
          id: string
          inp_ms: number | null
          lcp_ms: number | null
          route: string
          session_id: string | null
          ua_kind: string | null
          user_id: string | null
          viewport_w: number | null
        }
        Insert: {
          cls_score?: number | null
          created_at?: string
          fcp_ms?: number | null
          id?: string
          inp_ms?: number | null
          lcp_ms?: number | null
          route: string
          session_id?: string | null
          ua_kind?: string | null
          user_id?: string | null
          viewport_w?: number | null
        }
        Update: {
          cls_score?: number | null
          created_at?: string
          fcp_ms?: number | null
          id?: string
          inp_ms?: number | null
          lcp_ms?: number | null
          route?: string
          session_id?: string | null
          ua_kind?: string | null
          user_id?: string | null
          viewport_w?: number | null
        }
        Relationships: []
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
      price_parity_events: {
        Row: {
          cache_price: number | null
          created_at: string
          db_price: number | null
          diff_pct: number
          id: string
          market: string
          source: string
          symbol: string
          user_id: string | null
        }
        Insert: {
          cache_price?: number | null
          created_at?: string
          db_price?: number | null
          diff_pct: number
          id?: string
          market: string
          source: string
          symbol: string
          user_id?: string | null
        }
        Update: {
          cache_price?: number | null
          created_at?: string
          db_price?: number | null
          diff_pct?: number
          id?: string
          market?: string
          source?: string
          symbol?: string
          user_id?: string | null
        }
        Relationships: []
      }
      price_quota_ledger: {
        Row: {
          admitted: number
          created_at: string
          id: number
          market: string
          requested: number
          tokens_after: number
          writer: string | null
        }
        Insert: {
          admitted: number
          created_at?: string
          id?: number
          market: string
          requested: number
          tokens_after: number
          writer?: string | null
        }
        Update: {
          admitted?: number
          created_at?: string
          id?: number
          market?: string
          requested?: number
          tokens_after?: number
          writer?: string | null
        }
        Relationships: []
      }
      price_quota_pools: {
        Row: {
          api_name: string
          created_at: string
          last_refill: string
          market: string
          per_day_cap: number | null
          per_min_cap: number
          tokens: number
          updated_at: string
        }
        Insert: {
          api_name: string
          created_at?: string
          last_refill?: string
          market: string
          per_day_cap?: number | null
          per_min_cap: number
          tokens?: number
          updated_at?: string
        }
        Update: {
          api_name?: string
          created_at?: string
          last_refill?: string
          market?: string
          per_day_cap?: number | null
          per_min_cap?: number
          tokens?: number
          updated_at?: string
        }
        Relationships: []
      }
      processed_webhook_events: {
        Row: {
          delivery_id: string
          id: string
          processed_at: string
          source: string
        }
        Insert: {
          delivery_id: string
          id?: string
          processed_at?: string
          source: string
        }
        Update: {
          delivery_id?: string
          id?: string
          processed_at?: string
          source?: string
        }
        Relationships: []
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
          merged_into_user_id: string | null
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
          merged_into_user_id?: string | null
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
          merged_into_user_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      publish_batch_attempts: {
        Row: {
          attempt_no: number
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          market: string
          max_attempts: number
          next_retry_at: string | null
          parent_attempt_id: string | null
          response: Json | null
          root_attempt_id: string | null
          run_id: string | null
          scheduled_at: string
          started_at: string | null
          status: string
          trigger_source: string
          updated_at: string
        }
        Insert: {
          attempt_no?: number
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          market: string
          max_attempts?: number
          next_retry_at?: string | null
          parent_attempt_id?: string | null
          response?: Json | null
          root_attempt_id?: string | null
          run_id?: string | null
          scheduled_at?: string
          started_at?: string | null
          status?: string
          trigger_source?: string
          updated_at?: string
        }
        Update: {
          attempt_no?: number
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          market?: string
          max_attempts?: number
          next_retry_at?: string | null
          parent_attempt_id?: string | null
          response?: Json | null
          root_attempt_id?: string | null
          run_id?: string | null
          scheduled_at?: string
          started_at?: string | null
          status?: string
          trigger_source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "publish_batch_attempts_parent_attempt_id_fkey"
            columns: ["parent_attempt_id"]
            isOneToOne: false
            referencedRelation: "publish_batch_attempts"
            referencedColumns: ["id"]
          },
        ]
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
          client_request_id: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          discount_amount: number
          discount_reason: string | null
          id: string
          last5: string | null
          original_amount: number | null
          payer_name: string | null
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
          client_request_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          discount_amount?: number
          discount_reason?: string | null
          id?: string
          last5?: string | null
          original_amount?: number | null
          payer_name?: string | null
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
          client_request_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          discount_amount?: number
          discount_reason?: string | null
          id?: string
          last5?: string | null
          original_amount?: number | null
          payer_name?: string | null
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
      signal_trade_applications: {
        Row: {
          action: string
          applied_at: string
          applied_quantity: number | null
          expert_id: string
          signal_id: string
          tg_op: string | null
        }
        Insert: {
          action: string
          applied_at?: string
          applied_quantity?: number | null
          expert_id: string
          signal_id: string
          tg_op?: string | null
        }
        Update: {
          action?: string
          applied_at?: string
          applied_quantity?: number | null
          expert_id?: string
          signal_id?: string
          tg_op?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signal_trade_applications_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: true
            referencedRelation: "expert_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_fundamentals: {
        Row: {
          data: Json
          dataset: string
          fetched_at: string
          id: number
          report_date: string
          source: string
          stock_id: string
        }
        Insert: {
          data: Json
          dataset: string
          fetched_at?: string
          id?: number
          report_date: string
          source: string
          stock_id: string
        }
        Update: {
          data?: Json
          dataset?: string
          fetched_at?: string
          id?: number
          report_date?: string
          source?: string
          stock_id?: string
        }
        Relationships: []
      }
      stock_names: {
        Row: {
          asset_class: string
          created_at: string
          currency: string
          market: string | null
          name: string
          symbol: string
        }
        Insert: {
          asset_class?: string
          created_at?: string
          currency?: string
          market?: string | null
          name: string
          symbol: string
        }
        Update: {
          asset_class?: string
          created_at?: string
          currency?: string
          market?: string | null
          name?: string
          symbol?: string
        }
        Relationships: []
      }
      system_alerts: {
        Row: {
          detail: Json
          fired_at: string
          id: string
          kind: string
          level: string
          message: string | null
          metric_value: number | null
          notified_at: string | null
          notify_error: string | null
          resolved_at: string | null
          threshold: number | null
          title: string
        }
        Insert: {
          detail?: Json
          fired_at?: string
          id?: string
          kind: string
          level?: string
          message?: string | null
          metric_value?: number | null
          notified_at?: string | null
          notify_error?: string | null
          resolved_at?: string | null
          threshold?: number | null
          title: string
        }
        Update: {
          detail?: Json
          fired_at?: string
          id?: string
          kind?: string
          level?: string
          message?: string | null
          metric_value?: number | null
          notified_at?: string | null
          notify_error?: string | null
          resolved_at?: string | null
          threshold?: number | null
          title?: string
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
      system_kill_switches: {
        Row: {
          auto_trigger_metric: string | null
          disabled_at: string | null
          disabled_by: string | null
          disabled_reason: string | null
          enabled: boolean
          key: string
          updated_at: string
        }
        Insert: {
          auto_trigger_metric?: string | null
          disabled_at?: string | null
          disabled_by?: string | null
          disabled_reason?: string | null
          enabled?: boolean
          key: string
          updated_at?: string
        }
        Update: {
          auto_trigger_metric?: string | null
          disabled_at?: string | null
          disabled_by?: string | null
          disabled_reason?: string | null
          enabled?: boolean
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      target_price_history: {
        Row: {
          batch_id: string | null
          change_type: string
          code: string
          created_at: string
          detail: Json
          firm: string
          id: string
          prev_target: number | null
          report_date: string | null
          source: string
          target: number
          user_id: string
        }
        Insert: {
          batch_id?: string | null
          change_type?: string
          code: string
          created_at?: string
          detail?: Json
          firm?: string
          id?: string
          prev_target?: number | null
          report_date?: string | null
          source?: string
          target: number
          user_id: string
        }
        Update: {
          batch_id?: string | null
          change_type?: string
          code?: string
          created_at?: string
          detail?: Json
          firm?: string
          id?: string
          prev_target?: number | null
          report_date?: string | null
          source?: string
          target?: number
          user_id?: string
        }
        Relationships: []
      }
      trade_records: {
        Row: {
          combo_strategy: string | null
          created_at: string
          currency: string | null
          current_price: number | null
          entry_date: string | null
          entry_price: number | null
          exit_date: string | null
          exit_price: number | null
          expert_id: string
          id: string
          instrument: string
          is_combo: boolean
          market: string | null
          max_loss_per_unit: number | null
          max_profit_per_unit: number | null
          net_premium: number | null
          pnl_percent: number | null
          price_updated_at: string | null
          quantity: number
          quantity_unit: string
          signal_id: string | null
          status: Database["public"]["Enums"]["trade_status"]
        }
        Insert: {
          combo_strategy?: string | null
          created_at?: string
          currency?: string | null
          current_price?: number | null
          entry_date?: string | null
          entry_price?: number | null
          exit_date?: string | null
          exit_price?: number | null
          expert_id: string
          id?: string
          instrument: string
          is_combo?: boolean
          market?: string | null
          max_loss_per_unit?: number | null
          max_profit_per_unit?: number | null
          net_premium?: number | null
          pnl_percent?: number | null
          price_updated_at?: string | null
          quantity?: number
          quantity_unit?: string
          signal_id?: string | null
          status?: Database["public"]["Enums"]["trade_status"]
        }
        Update: {
          combo_strategy?: string | null
          created_at?: string
          currency?: string | null
          current_price?: number | null
          entry_date?: string | null
          entry_price?: number | null
          exit_date?: string | null
          exit_price?: number | null
          expert_id?: string
          id?: string
          instrument?: string
          is_combo?: boolean
          market?: string | null
          max_loss_per_unit?: number | null
          max_profit_per_unit?: number | null
          net_premium?: number | null
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
      traffic_events: {
        Row: {
          event_name: string | null
          event_props: Json | null
          id: string
          is_internal: boolean
          occurred_at: string
          referrer_host: string | null
          route: string
          user_id: string | null
          visitor_id: string
        }
        Insert: {
          event_name?: string | null
          event_props?: Json | null
          id?: string
          is_internal?: boolean
          occurred_at?: string
          referrer_host?: string | null
          route: string
          user_id?: string | null
          visitor_id: string
        }
        Update: {
          event_name?: string | null
          event_props?: Json | null
          id?: string
          is_internal?: boolean
          occurred_at?: string
          referrer_host?: string | null
          route?: string
          user_id?: string | null
          visitor_id?: string
        }
        Relationships: []
      }
      traffic_visits: {
        Row: {
          channel: string
          country: string | null
          created_at: string
          device_kind: string | null
          first_landing_path: string | null
          first_referrer: string | null
          first_referrer_host: string | null
          first_seen_at: string
          id: string
          last_seen_at: string
          page_views: number
          ref_code: string | null
          user_id: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          visitor_id: string
        }
        Insert: {
          channel?: string
          country?: string | null
          created_at?: string
          device_kind?: string | null
          first_landing_path?: string | null
          first_referrer?: string | null
          first_referrer_host?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          page_views?: number
          ref_code?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_id: string
        }
        Update: {
          channel?: string
          country?: string | null
          created_at?: string
          device_kind?: string | null
          first_landing_path?: string | null
          first_referrer?: string | null
          first_referrer_host?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          page_views?: number
          ref_code?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_id?: string
        }
        Relationships: []
      }
      tw_bsr_api_reservations: {
        Row: {
          api_name: string
          correlation_id: string | null
          expires_at: string
          id: number
          rate_limited: boolean
          recycle_reason: string | null
          released: boolean
          reserved_at: string
          settled_at: string | null
          success: boolean | null
          tier: number | null
        }
        Insert: {
          api_name?: string
          correlation_id?: string | null
          expires_at: string
          id?: number
          rate_limited?: boolean
          recycle_reason?: string | null
          released?: boolean
          reserved_at?: string
          settled_at?: string | null
          success?: boolean | null
          tier?: number | null
        }
        Update: {
          api_name?: string
          correlation_id?: string | null
          expires_at?: string
          id?: number
          rate_limited?: boolean
          recycle_reason?: string | null
          released?: boolean
          reserved_at?: string
          settled_at?: string | null
          success?: boolean | null
          tier?: number | null
        }
        Relationships: []
      }
      tw_bsr_api_usage: {
        Row: {
          api_name: string
          bucket_start: string
          call_count: number
          error_count: number
          rate_limited_count: number
          success_count: number
        }
        Insert: {
          api_name?: string
          bucket_start: string
          call_count?: number
          error_count?: number
          rate_limited_count?: number
          success_count?: number
        }
        Update: {
          api_name?: string
          bucket_start?: string
          call_count?: number
          error_count?: number
          rate_limited_count?: number
          success_count?: number
        }
        Relationships: []
      }
      tw_bsr_attempt_logs: {
        Row: {
          adaptive_strategy: Json | null
          attempt_step: number
          attempted_at: string
          backoff_seconds_before: number
          config_version: string | null
          consecutive_failures_before: number
          correlation_id: string | null
          created_at: string
          error: string | null
          error_class: string | null
          fallback_as_of_date: string | null
          fallback_used: boolean
          http_status: number | null
          id: number
          latency_ms: number
          next_retry_at: string | null
          next_retry_source: string | null
          ocr_mode: string
          ocr_trace: Json | null
          outcome: string
          stock_id: string
          trade_date: string
          ua_hash: string
          ua_label: string
        }
        Insert: {
          adaptive_strategy?: Json | null
          attempt_step?: number
          attempted_at?: string
          backoff_seconds_before?: number
          config_version?: string | null
          consecutive_failures_before?: number
          correlation_id?: string | null
          created_at?: string
          error?: string | null
          error_class?: string | null
          fallback_as_of_date?: string | null
          fallback_used?: boolean
          http_status?: number | null
          id?: number
          latency_ms?: number
          next_retry_at?: string | null
          next_retry_source?: string | null
          ocr_mode?: string
          ocr_trace?: Json | null
          outcome: string
          stock_id: string
          trade_date: string
          ua_hash: string
          ua_label: string
        }
        Update: {
          adaptive_strategy?: Json | null
          attempt_step?: number
          attempted_at?: string
          backoff_seconds_before?: number
          config_version?: string | null
          consecutive_failures_before?: number
          correlation_id?: string | null
          created_at?: string
          error?: string | null
          error_class?: string | null
          fallback_as_of_date?: string | null
          fallback_used?: boolean
          http_status?: number | null
          id?: number
          latency_ms?: number
          next_retry_at?: string | null
          next_retry_source?: string | null
          ocr_mode?: string
          ocr_trace?: Json | null
          outcome?: string
          stock_id?: string
          trade_date?: string
          ua_hash?: string
          ua_label?: string
        }
        Relationships: []
      }
      tw_bsr_daily: {
        Row: {
          avg_buy_price: number | null
          avg_sell_price: number | null
          broker_id: string
          broker_name: string
          buy_shares: number
          created_at: string
          id: number
          net_shares: number
          sell_shares: number
          stock_id: string
          trade_date: string
        }
        Insert: {
          avg_buy_price?: number | null
          avg_sell_price?: number | null
          broker_id: string
          broker_name: string
          buy_shares?: number
          created_at?: string
          id?: number
          net_shares?: number
          sell_shares?: number
          stock_id: string
          trade_date: string
        }
        Update: {
          avg_buy_price?: number | null
          avg_sell_price?: number | null
          broker_id?: string
          broker_name?: string
          buy_shares?: number
          created_at?: string
          id?: number
          net_shares?: number
          sell_shares?: number
          stock_id?: string
          trade_date?: string
        }
        Relationships: []
      }
      tw_bsr_daily_snapshot_status: {
        Row: {
          attempt_count: number
          correlation_id: string | null
          coverage_brokers: number
          coverage_rows: number
          coverage_stocks: number
          created_at: string
          fetched_at: string | null
          lane_a_status: string
          lane_b_status: string
          lane_c_status: string
          last_error: string | null
          lock_expires_at: string | null
          partial_lanes: string[]
          sealed_at: string | null
          sealed_by_lane: string | null
          source: string | null
          status: string
          trade_date: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          correlation_id?: string | null
          coverage_brokers?: number
          coverage_rows?: number
          coverage_stocks?: number
          created_at?: string
          fetched_at?: string | null
          lane_a_status?: string
          lane_b_status?: string
          lane_c_status?: string
          last_error?: string | null
          lock_expires_at?: string | null
          partial_lanes?: string[]
          sealed_at?: string | null
          sealed_by_lane?: string | null
          source?: string | null
          status?: string
          trade_date: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          correlation_id?: string | null
          coverage_brokers?: number
          coverage_rows?: number
          coverage_stocks?: number
          created_at?: string
          fetched_at?: string | null
          lane_a_status?: string
          lane_b_status?: string
          lane_c_status?: string
          last_error?: string | null
          lock_expires_at?: string | null
          partial_lanes?: string[]
          sealed_at?: string | null
          sealed_by_lane?: string | null
          source?: string | null
          status?: string
          trade_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      tw_bsr_degrade_events: {
        Row: {
          api_name: string
          correlation_id: string | null
          created_at: string
          detail: Json
          from_mode: string
          id: number
          reason: string
          threshold: number | null
          to_mode: string
          trigger_metric: string | null
          trigger_value: number | null
        }
        Insert: {
          api_name?: string
          correlation_id?: string | null
          created_at?: string
          detail?: Json
          from_mode: string
          id?: number
          reason: string
          threshold?: number | null
          to_mode: string
          trigger_metric?: string | null
          trigger_value?: number | null
        }
        Update: {
          api_name?: string
          correlation_id?: string | null
          created_at?: string
          detail?: Json
          from_mode?: string
          id?: number
          reason?: string
          threshold?: number | null
          to_mode?: string
          trigger_metric?: string | null
          trigger_value?: number | null
        }
        Relationships: []
      }
      tw_bsr_fetch_failures: {
        Row: {
          attempts: number
          backoff_seconds: number
          consecutive_failures: number
          correlation_id: string | null
          created_at: string
          error_class: string | null
          id: number
          last_error: string | null
          next_retry_at: string | null
          reason: string
          resolved_at: string | null
          stock_id: string
          trade_date: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          backoff_seconds?: number
          consecutive_failures?: number
          correlation_id?: string | null
          created_at?: string
          error_class?: string | null
          id?: number
          last_error?: string | null
          next_retry_at?: string | null
          reason: string
          resolved_at?: string | null
          stock_id: string
          trade_date: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          backoff_seconds?: number
          consecutive_failures?: number
          correlation_id?: string | null
          created_at?: string
          error_class?: string | null
          id?: number
          last_error?: string | null
          next_retry_at?: string | null
          reason?: string
          resolved_at?: string | null
          stock_id?: string
          trade_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      tw_bsr_keepwarm_metrics: {
        Row: {
          coverage_brokers: number
          coverage_stocks: number
          created_at: string
          duration_ms: number
          error: string | null
          fallback_used_count: number
          id: string
          sealed: boolean
          sealed_by_lane: string | null
          started_at: string
          status: string
          trade_date: string
          wave: number
        }
        Insert: {
          coverage_brokers?: number
          coverage_stocks?: number
          created_at?: string
          duration_ms?: number
          error?: string | null
          fallback_used_count?: number
          id?: string
          sealed?: boolean
          sealed_by_lane?: string | null
          started_at?: string
          status: string
          trade_date: string
          wave?: number
        }
        Update: {
          coverage_brokers?: number
          coverage_stocks?: number
          created_at?: string
          duration_ms?: number
          error?: string | null
          fallback_used_count?: number
          id?: string
          sealed?: boolean
          sealed_by_lane?: string | null
          started_at?: string
          status?: string
          trade_date?: string
          wave?: number
        }
        Relationships: []
      }
      tw_bsr_sync_config: {
        Row: {
          config: Json
          key: string
          note: string | null
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          config: Json
          key: string
          note?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          config?: Json
          key?: string
          note?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: []
      }
      tw_bsr_sync_config_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          config: Json
          id: string
          key: string
          note: string | null
          version: number
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          config: Json
          id?: string
          key: string
          note?: string | null
          version: number
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          config?: Json
          id?: string
          key?: string
          note?: string | null
          version?: number
        }
        Relationships: []
      }
      tw_bsr_sync_locks: {
        Row: {
          acquired_at: string
          expires_at: string
          lock_key: string
        }
        Insert: {
          acquired_at?: string
          expires_at: string
          lock_key: string
        }
        Update: {
          acquired_at?: string
          expires_at?: string
          lock_key?: string
        }
        Relationships: []
      }
      tw_bsr_sync_metrics: {
        Row: {
          avg_latency_ms: number
          bucket_at: string
          empty: number
          http_block: number
          ocr_fail: number
          success: number
          total: number
        }
        Insert: {
          avg_latency_ms?: number
          bucket_at: string
          empty?: number
          http_block?: number
          ocr_fail?: number
          success?: number
          total?: number
        }
        Update: {
          avg_latency_ms?: number
          bucket_at?: string
          empty?: number
          http_block?: number
          ocr_fail?: number
          success?: number
          total?: number
        }
        Relationships: []
      }
      tw_bsr_sync_queue: {
        Row: {
          attempts: number
          correlation_id: string | null
          created_at: string
          enqueued_at: string
          enqueued_by: string | null
          finished_at: string | null
          id: number
          last_error: string | null
          last_success_at: string | null
          max_attempts: number
          next_run_at: string
          post_close_only: boolean
          priority: number
          started_at: string | null
          status: string
          stock_id: string
          trade_date: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          correlation_id?: string | null
          created_at?: string
          enqueued_at?: string
          enqueued_by?: string | null
          finished_at?: string | null
          id?: number
          last_error?: string | null
          last_success_at?: string | null
          max_attempts?: number
          next_run_at?: string
          post_close_only?: boolean
          priority: number
          started_at?: string | null
          status?: string
          stock_id: string
          trade_date: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          correlation_id?: string | null
          created_at?: string
          enqueued_at?: string
          enqueued_by?: string | null
          finished_at?: string | null
          id?: number
          last_error?: string | null
          last_success_at?: string | null
          max_attempts?: number
          next_run_at?: string
          post_close_only?: boolean
          priority?: number
          started_at?: string | null
          status?: string
          stock_id?: string
          trade_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      tw_bsr_upstream_probe: {
        Row: {
          earliest_data: string | null
          empty_streak: number
          exhausted: boolean
          probed_back_to: string | null
          stock_id: string
          updated_at: string
        }
        Insert: {
          earliest_data?: string | null
          empty_streak?: number
          exhausted?: boolean
          probed_back_to?: string | null
          stock_id: string
          updated_at?: string
        }
        Update: {
          earliest_data?: string | null
          empty_streak?: number
          exhausted?: boolean
          probed_back_to?: string | null
          stock_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tw_chip_fact: {
        Row: {
          avg_buy_price: number | null
          avg_sell_price: number | null
          broker_id: string
          broker_name: string | null
          buy_shares: number
          id: number
          ingested_at: string
          net_shares: number | null
          raw: Json | null
          sell_shares: number
          source: string
          stock_id: string
          trade_date: string
        }
        Insert: {
          avg_buy_price?: number | null
          avg_sell_price?: number | null
          broker_id: string
          broker_name?: string | null
          buy_shares?: number
          id?: number
          ingested_at?: string
          net_shares?: number | null
          raw?: Json | null
          sell_shares?: number
          source: string
          stock_id: string
          trade_date: string
        }
        Update: {
          avg_buy_price?: number | null
          avg_sell_price?: number | null
          broker_id?: string
          broker_name?: string | null
          buy_shares?: number
          id?: number
          ingested_at?: string
          net_shares?: number | null
          raw?: Json | null
          sell_shares?: number
          source?: string
          stock_id?: string
          trade_date?: string
        }
        Relationships: []
      }
      tw_chips_rollup: {
        Row: {
          as_of_date: string
          broker_count: number | null
          bsr_available: boolean
          concentration_ratio: number | null
          dealer_net: number
          fallback_used: boolean
          foreign_net: number
          id: number
          low_quality: boolean | null
          source_date: string
          stock_id: string
          top_buy_brokers: Json
          top_sell_brokers: Json
          trust_net: number
          updated_at: string
          window_days: number
        }
        Insert: {
          as_of_date: string
          broker_count?: number | null
          bsr_available?: boolean
          concentration_ratio?: number | null
          dealer_net?: number
          fallback_used?: boolean
          foreign_net?: number
          id?: number
          low_quality?: boolean | null
          source_date?: string
          stock_id: string
          top_buy_brokers?: Json
          top_sell_brokers?: Json
          trust_net?: number
          updated_at?: string
          window_days: number
        }
        Update: {
          as_of_date?: string
          broker_count?: number | null
          bsr_available?: boolean
          concentration_ratio?: number | null
          dealer_net?: number
          fallback_used?: boolean
          foreign_net?: number
          id?: number
          low_quality?: boolean | null
          source_date?: string
          stock_id?: string
          top_buy_brokers?: Json
          top_sell_brokers?: Json
          trust_net?: number
          updated_at?: string
          window_days?: number
        }
        Relationships: []
      }
      tw_institutional_daily: {
        Row: {
          created_at: string
          dealer_net: number
          foreign_net: number
          id: number
          raw: Json | null
          source: string
          stock_id: string
          total_net: number
          trade_date: string
          trust_net: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          dealer_net?: number
          foreign_net?: number
          id?: number
          raw?: Json | null
          source?: string
          stock_id: string
          total_net?: number
          trade_date: string
          trust_net?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          dealer_net?: number
          foreign_net?: number
          id?: number
          raw?: Json | null
          source?: string
          stock_id?: string
          total_net?: number
          trade_date?: string
          trust_net?: number
          updated_at?: string
        }
        Relationships: []
      }
      tw_market_holidays: {
        Row: {
          detected_at: string
          name: string | null
          note: string | null
          source: string
          trade_date: string
        }
        Insert: {
          detected_at?: string
          name?: string | null
          note?: string | null
          source?: string
          trade_date: string
        }
        Update: {
          detected_at?: string
          name?: string | null
          note?: string | null
          source?: string
          trade_date?: string
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
          call_put: string | null
          exercise_ratio: number | null
          expire_date: string | null
          fetched_at: string
          name: string | null
          parent_code: string | null
          ratio_source: string | null
          ratio_updated_at: string | null
          strike_price: number | null
          symbol: string
        }
        Insert: {
          call_put?: string | null
          exercise_ratio?: number | null
          expire_date?: string | null
          fetched_at?: string
          name?: string | null
          parent_code?: string | null
          ratio_source?: string | null
          ratio_updated_at?: string | null
          strike_price?: number | null
          symbol: string
        }
        Update: {
          call_put?: string | null
          exercise_ratio?: number | null
          expire_date?: string | null
          fetched_at?: string
          name?: string | null
          parent_code?: string | null
          ratio_source?: string | null
          ratio_updated_at?: string | null
          strike_price?: number | null
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
      chip_fact_conflicts: {
        Row: {
          broker_id: string | null
          lane_count: number | null
          lanes: string[] | null
          max_net: number | null
          min_net: number | null
          net_diff: number | null
          stock_id: string | null
          trade_date: string | null
        }
        Relationships: []
      }
      chip_fact_health: {
        Row: {
          broker_count: number | null
          lane: string | null
          last_ingested_at: string | null
          row_count: number | null
          sealed: boolean | null
          sealed_by_lane: string | null
          stock_count: number | null
          trade_date: string | null
        }
        Relationships: []
      }
      chips_state_hourly: {
        Row: {
          borrowed: number | null
          granted: number | null
          hour: string | null
          pool_name: string | null
          ready_ratio: number | null
          rejected: number | null
          total: number | null
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
      finmind_pool_daily_equiv: {
        Row: {
          capacity: number | null
          daily_budget: number | null
          estimated_full_at: string | null
          manual_override: boolean | null
          pool_name: string | null
          refill_per_hour: number | null
          refill_per_min: number | null
          remaining_today: number | null
          slo_boost_until: string | null
          tokens: number | null
          used_today: number | null
        }
        Insert: {
          capacity?: number | null
          daily_budget?: number | null
          estimated_full_at?: never
          manual_override?: boolean | null
          pool_name?: string | null
          refill_per_hour?: never
          refill_per_min?: number | null
          remaining_today?: never
          slo_boost_until?: string | null
          tokens?: number | null
          used_today?: number | null
        }
        Update: {
          capacity?: number | null
          daily_budget?: number | null
          estimated_full_at?: never
          manual_override?: boolean | null
          pool_name?: string | null
          refill_per_hour?: never
          refill_per_min?: number | null
          remaining_today?: never
          slo_boost_until?: string | null
          tokens?: number | null
          used_today?: number | null
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
          env: string | null
          id: string | null
          is_active: boolean | null
          is_default: boolean | null
          provider_type: Database["public"]["Enums"]["provider_type"] | null
        }
        Insert: {
          created_at?: string | null
          display_name?: string | null
          env?: never
          id?: string | null
          is_active?: boolean | null
          is_default?: boolean | null
          provider_type?: Database["public"]["Enums"]["provider_type"] | null
        }
        Update: {
          created_at?: string | null
          display_name?: string | null
          env?: never
          id?: string | null
          is_active?: boolean | null
          is_default?: boolean | null
          provider_type?: Database["public"]["Enums"]["provider_type"] | null
        }
        Relationships: []
      }
      payment_settings_safe: {
        Row: {
          id: string | null
          key: string | null
          updated_at: string | null
          updated_by: string | null
          value: Json | null
        }
        Insert: {
          id?: string | null
          key?: string | null
          updated_at?: string | null
          updated_by?: string | null
          value?: never
        }
        Update: {
          id?: string | null
          key?: string | null
          updated_at?: string | null
          updated_by?: string | null
          value?: never
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
      v_active_tw_holdings: {
        Row: {
          stock_id: string | null
        }
        Relationships: []
      }
      v_price_freshness: {
        Row: {
          coverage_ratio: number | null
          covered_count: number | null
          market: string | null
          max_age_s: number | null
          newest_updated_at: string | null
          oldest_updated_at: string | null
          p50_age_s: number | null
          p95_age_s: number | null
          universe_count: number | null
        }
        Relationships: []
      }
      v_price_sync_universe: {
        Row: {
          market: string | null
          priority: number | null
          symbol: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_apply_fix_proposal: {
        Args: { p_confirm: boolean; p_id: string }
        Returns: Json
      }
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
      admin_delete_trade_records_by_signal_ids: {
        Args: { _signal_ids: string[] }
        Returns: number
      }
      admin_delete_trade_records_by_symbol: {
        Args: { _expert_id: string; _symbol_prefix: string }
        Returns: number
      }
      admin_generate_fix_proposals: {
        Args: { p_category?: string }
        Returns: {
          inserted: number
          superseded: number
          total_pending: number
        }[]
      }
      admin_holdings_consistency_audit: {
        Args: never
        Returns: {
          category: string
          details: Json
          expert_name: string
          expert_slug: string
          severity: string
          symbol: string
        }[]
      }
      admin_list_cron_jobs: {
        Args: never
        Returns: {
          active: boolean
          command: string
          database: string
          jobid: number
          jobname: string
          schedule: string
          username: string
        }[]
      }
      admin_reject_fix_proposal: {
        Args: { p_id: string; p_note?: string }
        Returns: undefined
      }
      admin_reset_expert_asset_class: {
        Args: { _expert_id: string; _new_asset_class: string }
        Returns: undefined
      }
      admin_reset_line_free_quota: {
        Args: { _line_user_id: string }
        Returns: Json
      }
      admin_signal_dupe_trades_audit: {
        Args: never
        Returns: {
          action: string
          dup_count: number
          earliest_created_at: string
          expert_id: string
          expert_name: string
          has_manual_edit: boolean
          instrument: string
          open_count: number
          signal_id: string
          signal_published_at: string
          trade_ids: string[]
        }[]
      }
      admin_signal_dupe_trades_fix: {
        Args: { p_dry_run?: boolean; p_force?: boolean; p_signal_id: string }
        Returns: Json
      }
      admin_trade_dedupe_sweep: { Args: { p_dry_run?: boolean }; Returns: Json }
      archive_and_promote_knowledge: {
        Args: {
          _new_confidence?: number
          _new_trigger: Json
          _note?: string
          _old_id: string
        }
        Returns: string
      }
      backfill_job_set_done: {
        Args: { _id: number; _status: string }
        Returns: undefined
      }
      backfill_job_set_failed: {
        Args: { _error: string; _id: number; _retry_at?: string }
        Returns: undefined
      }
      backfill_legacy_bsr_to_fact: {
        Args: { _from: string; _to: string }
        Returns: {
          inserted_rows: number
          skipped_rows: number
        }[]
      }
      backfill_queue_stats: {
        Args: never
        Returns: {
          dataset: string
          done: number
          failed: number
          oldest_pending: string
          pending: number
          running: number
          skipped: number
        }[]
      }
      bsr_apply_degrade_transition: {
        Args: {
          _api: string
          _cooldown_seconds: number
          _correlation_id?: string
          _reason: string
          _threshold: number
          _to_mode: string
          _trigger_metric: string
          _trigger_value: number
        }
        Returns: {
          applied: boolean
          from_mode: string
          to_mode: string
        }[]
      }
      bsr_check_tier_admission: {
        Args: { _api?: string; _limit?: number; _tier?: number }
        Returns: {
          allowed: boolean
          available_for_tier: number
          hourly_used: number
          reason: string
          tier_guarantee: number
          tier_used: number
        }[]
      }
      bsr_force_recycle_reservation: {
        Args: { _reason?: string; _reservation_id: number }
        Returns: boolean
      }
      bsr_get_degrade_state: {
        Args: { _api?: string }
        Returns: {
          cooldown_until: string
          last_transition_at: string
          mode: string
          reason: string
          since: string
          trigger_metric: string
          trigger_value: number
        }[]
      }
      bsr_list_stuck_reservations: {
        Args: { _api?: string; _limit?: number; _min_age_seconds?: number }
        Returns: {
          age_seconds: number
          correlation_id: string
          expired: boolean
          expires_at: string
          id: number
          reserved_at: string
        }[]
      }
      bsr_recent_degrade_events: {
        Args: { _api?: string; _limit?: number }
        Returns: {
          created_at: string
          from_mode: string
          id: number
          reason: string
          threshold: number
          to_mode: string
          trigger_metric: string
          trigger_value: number
        }[]
      }
      bsr_reservation_stats: {
        Args: { _api?: string }
        Returns: {
          expired_unsettled: number
          expiring_soon: number
          in_flight: number
          oldest_in_flight_age_seconds: number
          rate_limited_last_hour: number
          settled_last_hour: number
        }[]
      }
      bsr_snapshot_claim: {
        Args: {
          _correlation_id: string
          _lease_seconds?: number
          _trade_date: string
        }
        Returns: {
          attempt_count: number
          claimed: boolean
          prev_status: string
        }[]
      }
      bsr_snapshot_fulfill_jobs: {
        Args: { _threshold?: number; _trade_date: string }
        Returns: {
          fulfilled: number
          still_pending: number
        }[]
      }
      bsr_snapshot_mark:
        | {
            Args: {
              _coverage_rows: number
              _coverage_stocks: number
              _last_error?: string
              _source: string
              _status: string
              _trade_date: string
            }
            Returns: undefined
          }
        | {
            Args: {
              _coverage_rows: number
              _coverage_stocks: number
              _last_error?: string
              _sealed_by_lane?: string
              _source: string
              _status: string
              _trade_date: string
            }
            Returns: undefined
          }
      bsr_snapshot_stats: {
        Args: { _days?: number }
        Returns: {
          exhausted_days: number
          hit_ratio_24h: number
          oldest_pending_days: number
          partial_days: number
          quota_per_day_avg: number
          ready_days: number
          total_days: number
        }[]
      }
      bsr_trace_by_correlation: { Args: { _cid: string }; Returns: Json }
      calculate_expert_performance: {
        Args: { _expert_id: string }
        Returns: Json
      }
      check_bsr_rate_limit: {
        Args: { _api?: string; _limit?: number }
        Returns: {
          allowed: boolean
          remaining: number
          used: number
        }[]
      }
      check_checkup_quota: { Args: { _user_id: string }; Returns: Json }
      check_kill_switch: { Args: { _key: string }; Returns: boolean }
      check_knowledge_title_similarity: {
        Args: { _category: string; _threshold?: number; _title: string }
        Returns: {
          id: string
          item_id: string
          sim: number
          title: string
        }[]
      }
      chip_fact_summary: {
        Args: { _days?: number }
        Returns: {
          broker_scraper_rows: number
          distinct_days: number
          distinct_stocks: number
          eligible_days: number
          finmind_batch_rows: number
          finmind_per_stock_rows: number
          last_fact_at: string
          legacy_migration_rows: number
          sealed_days: number
          total_rows: number
        }[]
      }
      claim_backfill_jobs: {
        Args: { _batch_size?: number; _max_priority_score?: number }
        Returns: {
          attempts: number
          dataset: string
          end_date: string
          id: number
          payload: Json
          source_hint: string
          start_date: string
          stock_id: string
        }[]
      }
      claim_bsr_queue_jobs: {
        Args: { _batch?: number; _max_priority?: number }
        Returns: {
          attempts: number
          correlation_id: string | null
          created_at: string
          enqueued_at: string
          enqueued_by: string | null
          finished_at: string | null
          id: number
          last_error: string | null
          last_success_at: string | null
          max_attempts: number
          next_run_at: string
          post_close_only: boolean
          priority: number
          started_at: string | null
          status: string
          stock_id: string
          trade_date: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "tw_bsr_sync_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_institutional_new_stock: {
        Args: { _lease_seconds?: number }
        Returns: {
          attempts: number
          id: string
          stock_id: string
        }[]
      }
      cleanup_account_link_codes: { Args: never; Returns: undefined }
      cleanup_line_oauth_states: { Args: never; Returns: undefined }
      cleanup_old_announcements: { Args: never; Returns: undefined }
      cleanup_old_auth_events: { Args: never; Returns: number }
      cleanup_old_expert_ai_access_logs: { Args: never; Returns: undefined }
      cleanup_old_perf_metrics: { Args: never; Returns: undefined }
      cleanup_old_traffic: { Args: never; Returns: undefined }
      cleanup_processed_webhook_events: { Args: never; Returns: number }
      compute_bsr_series_readiness: {
        Args: { p_stock_id: string }
        Returns: Json
      }
      consume_checkup_quota: {
        Args: { _kind?: string; _user_id: string }
        Returns: Json
      }
      converge_bsr_windows: {
        Args: {
          p_chunk_dates?: number
          p_horizon_days?: number
          p_max_stocks?: number
        }
        Returns: Json
      }
      cron_edge_call: {
        Args: { body?: Json; fn_name: string; timeout_ms?: number }
        Returns: number
      }
      delete_expired_binding_codes: { Args: never; Returns: undefined }
      delete_old_prices: { Args: never; Returns: undefined }
      derive_traffic_channel: {
        Args: {
          _referrer_host: string
          _utm_medium: string
          _utm_source: string
        }
        Returns: string
      }
      detect_chip_gap_jobs: {
        Args: {
          _lookback_days?: number
          _max_jobs?: number
          _target_date?: string
        }
        Returns: {
          end_date: string
          gap_count: number
          start_date: string
          stock_id: string
        }[]
      }
      detect_fundamental_gap_jobs: {
        Args: { _max_jobs?: number; _target_date?: string }
        Returns: {
          end_date: string
          gap_count: number
          missing_datasets: string[]
          start_date: string
          stock_id: string
        }[]
      }
      detect_institutional_gap_jobs: {
        Args: {
          _lookback_days?: number
          _max_jobs?: number
          _target_date?: string
        }
        Returns: {
          end_date: string
          gap_count: number
          start_date: string
          stock_id: string
        }[]
      }
      enqueue_all_active_tw_holdings_bsr: {
        Args: { p_lookback_days?: number }
        Returns: Json
      }
      enqueue_backfill_jobs: {
        Args: { _jobs: Json }
        Returns: {
          inserted: number
          skipped: number
        }[]
      }
      enqueue_bsr_backfill: {
        Args: { p_days?: number; p_stock_id: string }
        Returns: number
      }
      enqueue_institutional_backfill_universe: { Args: never; Returns: number }
      enqueue_institutional_new_stock: {
        Args: { _stock_id: string }
        Returns: {
          enqueued: boolean
          reason: string
        }[]
      }
      ensure_bsr_queued: { Args: { p_stock_id: string }; Returns: Json }
      ensure_bsr_window: {
        Args: {
          p_horizon_days?: number
          p_stock_id: string
          p_window_days?: number
        }
        Returns: Json
      }
      expected_latest_bsr_date: { Args: never; Returns: string }
      finmind_admit: {
        Args: {
          _cost?: number
          _kind?: string
          _pool: string
          _stock_id?: string
        }
        Returns: Json
      }
      finmind_admit_v2: {
        Args: {
          _allow_borrow?: boolean
          _cost?: number
          _kind: string
          _pool: string
          _stock_id?: string
        }
        Returns: Json
      }
      finmind_inflight_acquire: {
        Args: { _key: string; _kind: string; _stock_id: string }
        Returns: boolean
      }
      finmind_inflight_release: { Args: { _key: string }; Returns: undefined }
      finmind_pool_reset: { Args: never; Returns: Json }
      finmind_pool_set_budget: {
        Args: { _budget: number; _pool: string }
        Returns: Json
      }
      get_analyst_subscriber_profiles: {
        Args: never
        Returns: {
          avatar_url: string
          display_name: string
          user_id: string
        }[]
      }
      get_bsr_daily_series: {
        Args: { _days?: number; _stock_id: string }
        Returns: {
          broker_count: number
          concentration_ratio: number
          low_quality: boolean
          trade_date: string
        }[]
      }
      get_bsr_readiness_v2: { Args: { _stock_id: string }; Returns: Json }
      get_coverage_stats: {
        Args: { _scope?: string; _window_days?: number }
        Returns: {
          filling: number
          missing: number
          ready: number
          total_stocks: number
          updated_at: string
        }[]
      }
      get_cron_job_runs: {
        Args: { _jobnames?: string[]; _limit?: number }
        Returns: {
          cron_status: string
          end_time: string
          http_duration_ms: number
          http_error: string
          http_response_snippet: string
          http_status: number
          jobname: string
          request_id: number
          return_message: string
          runid: number
          sql_duration_ms: number
          start_time: string
        }[]
      }
      get_cron_jobs: {
        Args: never
        Returns: {
          active: boolean
          jobid: number
          jobname: string
          schedule: string
        }[]
      }
      get_cron_key: { Args: never; Returns: string }
      get_event_heatmap: {
        Args: { _from: string; _to: string }
        Returns: {
          event_name: string
          last_seen: string
          total_count: number
          unique_users: number
          unique_visitors: number
        }[]
      }
      get_expert_capital_status: { Args: { _expert_id: string }; Returns: Json }
      get_expert_detail_bundle: { Args: { _slug: string }; Returns: Json }
      get_expert_revenue_breakdown: {
        Args: { _from: string; _to: string }
        Returns: {
          channel_reserve: number
          expert_amount: number
          expert_id: string
          expert_name: string
          expert_slug: string
          gross: number
          net: number
          orders: number
          platform_amount: number
          unique_buyers: number
        }[]
      }
      get_fastlane_stats: { Args: never; Returns: Json }
      get_funnel_overview: {
        Args: { _from: string; _steps: string[]; _to: string }
        Returns: Json
      }
      get_knowledge_revision: { Args: never; Returns: string }
      get_owned_journal_bundle: { Args: { _signal_id: string }; Returns: Json }
      get_page_analytics: {
        Args: { _from: string; _include_internal?: boolean; _to: string }
        Returns: Json
      }
      get_perf_metrics_summary: { Args: { _days?: number }; Returns: Json }
      get_plan_expert_status: {
        Args: { p_plan_id: string }
        Returns: {
          expert_id: string
          expert_name: string
          expert_slug: string
          expert_status: string
        }[]
      }
      get_price_parity_summary: { Args: { _days?: number }; Returns: Json }
      get_pricing_bundle: { Args: { _user_id?: string }; Returns: Json }
      get_product_breakdown: {
        Args: { _from: string; _to: string }
        Returns: Json
      }
      get_public_experts_list: { Args: never; Returns: Json }
      get_publish_batch_attempts: {
        Args: { _limit?: number }
        Returns: {
          attempt_no: number
          created_at: string
          duration_ms: number
          error_message: string
          finished_at: string
          id: string
          market: string
          max_attempts: number
          next_retry_at: string
          parent_attempt_id: string
          response: Json
          root_attempt_id: string
          run_id: string
          scheduled_at: string
          started_at: string
          status: string
          trigger_source: string
        }[]
      }
      get_publish_batch_runs: {
        Args: { _limit?: number }
        Returns: {
          ended_at: string
          failed: number
          market: string
          pending_found: number
          published: number
          push_fail: number
          pushed: number
          run_id: string
          started_at: string
        }[]
      }
      get_publish_batch_status: {
        Args: never
        Returns: {
          asset_class: string
          expert_id: string
          expert_name: string
          expert_slug: string
          failed_pending_count: number
          last_attempt_at: string
          last_error_kind: string
          last_error_msg: string
          last_error_signal_id: string
          last_run_id: string
          market: string
          pending_count: number
          published_this_week: number
        }[]
      }
      get_remittance_account: { Args: never; Returns: Json }
      get_roas_ltv_by_campaign: {
        Args: { _from: string; _to: string }
        Returns: {
          cac: number
          conversions_count: number
          first_arpu: number
          gross_revenue: number
          ltv_30d: number
          ltv_90d: number
          payback_ratio: number
          roas: number
          spend: number
          unique_buyers: number
          utm_campaign: string
          utm_medium: string
          utm_source: string
        }[]
      }
      get_top_instruments: {
        Args: { _from: string; _limit?: number; _to: string }
        Returns: Json
      }
      get_traffic_health: { Args: never; Returns: Json }
      get_traffic_overview: {
        Args: { _from: string; _to: string }
        Returns: Json
      }
      get_user_funnel_drop: {
        Args: { _from: string; _to: string; _user_id: string }
        Returns: Json
      }
      get_user_journey: {
        Args: { _from: string; _to: string; _visitor_id: string }
        Returns: Json
      }
      get_user_subscription_timeline: {
        Args: { _expert_id?: string; _user_id: string }
        Returns: Json
      }
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
      is_snapshot_sealed: { Args: { _trade_date: string }; Returns: boolean }
      is_subscribed_to_plan: {
        Args: { _plan_id: string; _user_id: string }
        Returns: boolean
      }
      is_tester: { Args: { _user_id: string }; Returns: boolean }
      is_tw_trading_day: { Args: { _d: string }; Returns: boolean }
      is_tw_trading_hours: { Args: never; Returns: boolean }
      log_unit_lock_violation: { Args: { payload: Json }; Returns: string }
      mark_bsr_upstream_probe: {
        Args: { p_had_data: boolean; p_probed_date: string; p_stock_id: string }
        Returns: undefined
      }
      match_expert_knowledge:
        | {
            Args: {
              p_expert_id: string
              p_match_count?: number
              p_query_embedding: string
            }
            Returns: {
              content: string
              id: string
              is_manual: boolean
              metadata: Json
              similarity: number
              source_id: string
              source_type: string
            }[]
          }
        | {
            Args: {
              p_expert_id: string
              p_match_count?: number
              p_query_embedding: string
            }
            Returns: {
              content: string
              id: string
              metadata: Json
              similarity: number
              source_id: string
              source_type: string
            }[]
          }
      materialize_bsr_daily_from_fact:
        | {
            Args: { _trade_date: string }
            Returns: {
              materialized_rows: number
              skipped_sealed: boolean
            }[]
          }
        | {
            Args: { _stock_ids?: string[]; _trade_date: string }
            Returns: {
              materialized_rows: number
              skipped_sealed: boolean
            }[]
          }
      normalize_snapshot_volume_shares: {
        Args: { p_hint_unit?: string; p_market: string; p_volume: number }
        Returns: {
          shares: number
          unit: string
        }[]
      }
      price_admit: {
        Args: { p_market: string; p_requested: number; p_writer?: string }
        Returns: number
      }
      prune_backfill_job_queue: { Args: never; Returns: undefined }
      prune_bsr_sync_queue: { Args: never; Returns: number }
      prune_cron_dispatch_log: { Args: never; Returns: undefined }
      purge_expired_bsr_reservations: {
        Args: { _api?: string }
        Returns: {
          recycled_count: number
          recycled_ids: number[]
        }[]
      }
      realign_instrument_unit: {
        Args: {
          p_expert_id: string
          p_new_unit: string
          p_symbol_prefix: string
        }
        Returns: Json
      }
      reap_stale_bsr_queue_jobs: {
        Args: { _stale_minutes?: number }
        Returns: {
          reaped_jobs: number
          released_locks: number
        }[]
      }
      rebuild_bsr_rollup: {
        Args: { _as_of: string; _max_stocks?: number; _stock_ids?: string[] }
        Returns: Json
      }
      reconcile_line_free_quota: { Args: { _user_id: string }; Returns: Json }
      reconcile_snapshot: {
        Args: { _trade_date: string }
        Returns: {
          bsr_stocks: number
          coverage_brokers: number
          coverage_stocks: number
          inst_stocks: number
          lane_a_status: string
          lane_b_status: string
          lane_c_status: string
          notes: string
          sealed_at: string
          sealed_by_lane: string
          trade_date: string
        }[]
      }
      record_bsr_api_call: {
        Args: { _api?: string; _rate_limited?: boolean; _success?: boolean }
        Returns: undefined
      }
      recover_stale_backfill_jobs: {
        Args: { _stale_after?: string }
        Returns: number
      }
      refresh_bsr_coverage_daily: {
        Args: { days?: number }
        Returns: {
          date_from: string
          date_to: string
          rows_upserted: number
        }[]
      }
      release_bsr_reservation: {
        Args: { _reservation_id: number }
        Returns: undefined
      }
      reserve_bsr_api_quota:
        | {
            Args: {
              _api: string
              _correlation_id?: string
              _lease_seconds: number
              _limit: number
            }
            Returns: {
              granted: boolean
              remaining: number
              reservation_id: number
              used: number
            }[]
          }
        | {
            Args: {
              _api: string
              _correlation_id?: string
              _lease_seconds: number
              _limit: number
              _tier?: number
            }
            Returns: {
              granted: boolean
              remaining: number
              reservation_id: number
              used: number
            }[]
          }
      reset_data_source_circuit: {
        Args: { _source: string }
        Returns: {
          circuit_state: string
          consecutive_failures: number
          disabled_until: string | null
          fail_count_10m: number
          last_error_code: string | null
          last_failure_at: string | null
          last_success_at: string | null
          ok_count_10m: number
          p95_latency_ms: number | null
          source: string
          updated_at: string
          upstream_quota_limit: number | null
          upstream_quota_remaining: number | null
          upstream_quota_reset_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "data_source_health"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      run_rls_subscription_tests: {
        Args: never
        Returns: {
          detail: string
          passed: boolean
          test_name: string
        }[]
      }
      save_signal_batch: {
        Args: {
          _batch_id: string
          _expert_id: string
          _is_editing?: boolean
          _legs?: Json
          _signals: Json
        }
        Returns: number
      }
      settle_bsr_reservation: {
        Args: {
          _rate_limited?: boolean
          _reservation_id: number
          _success?: boolean
        }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      signal_in_subscription_window: {
        Args: {
          _expires_at: string
          _published_at: string
          _role: Database["public"]["Enums"]["expert_role"]
          _started_at: string
        }
        Returns: boolean
      }
      strip_referrer_query: { Args: { ref: string }; Returns: string }
      toggle_kill_switch: {
        Args: { _enabled: boolean; _key: string; _reason?: string }
        Returns: Json
      }
      trade_dedupe_sweep: { Args: { p_dry_run?: boolean }; Returns: Json }
      tw_bsr_eligibility: { Args: { p_stock_id: string }; Returns: Json }
      tw_detect_market_holidays: {
        Args: { _from?: string; _to?: string }
        Returns: {
          holiday_date: string
          was_inserted: boolean
        }[]
      }
      tw_missing_trading_days: {
        Args: { _from?: string; _to?: string }
        Returns: {
          bsr_rows: number
          inst_rows: number
          trade_date: string
        }[]
      }
      tw_trading_days: {
        Args: { _from: string; _to: string }
        Returns: string[]
      }
      upsert_current_price: {
        Args: { p_rows: Json; p_writer: string }
        Returns: number
      }
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
      provider_type:
        | "ecpay"
        | "newebpay"
        | "stripe"
        | "line_pay"
        | "acpay"
        | "remittance"
      signal_action:
        | "buy"
        | "sell"
        | "add"
        | "trim"
        | "exit"
        | "hold"
        | "teaching"
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
      provider_type: [
        "ecpay",
        "newebpay",
        "stripe",
        "line_pay",
        "acpay",
        "remittance",
      ],
      signal_action: ["buy", "sell", "add", "trim", "exit", "hold", "teaching"],
      signal_status: ["published", "pending"],
      subscription_status: ["active", "canceled", "expired"],
      trade_status: ["open", "closed", "stopped"],
    },
  },
} as const

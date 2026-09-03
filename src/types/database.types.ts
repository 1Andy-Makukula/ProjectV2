export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      admin_action_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          payload: Json
          target_id: string | null
          target_type: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          payload?: Json
          target_id?: string | null
          target_type: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          payload?: Json
          target_id?: string | null
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_action_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      bundles: {
        Row: {
          bundle_metadata: Json
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          name: string
          total_price_zmw: number
        }
        Insert: {
          bundle_metadata?: Json
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name: string
          total_price_zmw: number
        }
        Update: {
          bundle_metadata?: Json
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name?: string
          total_price_zmw?: number
        }
        Relationships: [
          {
            foreignKeyName: "bundles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_item_images: {
        Row: {
          catalog_item_id: string
          created_at: string
          id: string
          image_url: string
          sort_order: number
        }
        Insert: {
          catalog_item_id: string
          created_at?: string
          id?: string
          image_url: string
          sort_order?: number
        }
        Update: {
          catalog_item_id?: string
          created_at?: string
          id?: string
          image_url?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalog_item_images_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_items: {
        Row: {
          category_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          item_type: string
          name: string
          suggested_price_zmw: number | null
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          item_type?: string
          name: string
          suggested_price_zmw?: number | null
        }
        Update: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          item_type?: string
          name?: string
          suggested_price_zmw?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string | null
          id: string
          image_url: string | null
          is_featured: boolean | null
          name: string
          slug: string
          ui_order_index: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          image_url?: string | null
          is_featured?: boolean | null
          name: string
          slug: string
          ui_order_index?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          image_url?: string | null
          is_featured?: boolean | null
          name?: string
          slug?: string
          ui_order_index?: number | null
        }
        Relationships: []
      }
      claim_status_feed: {
        Row: {
          claim_code: string
          claim_status: string
          updated_at: string | null
        }
        Insert: {
          claim_code: string
          claim_status: string
          updated_at?: string | null
        }
        Update: {
          claim_code?: string
          claim_status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      conversation_reads: {
        Row: {
          conversation_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_occasions: {
        Row: {
          contact_id: string
          created_at: string
          day: number
          id: string
          kind: string
          label: string | null
          month: number | null
          notes: string | null
          recurrence: string
          updated_at: string
          year: number | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          day: number
          id?: string
          kind: string
          label?: string | null
          month?: number | null
          notes?: string | null
          recurrence?: string
          updated_at?: string
          year?: number | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          day?: number
          id?: string
          kind?: string
          label?: string | null
          month?: number | null
          notes?: string | null
          recurrence?: string
          updated_at?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_occasions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          created_at: string
          id: string
          name: string
          notes: string | null
          owner_user_id: string
          phone: string
          relationship: string | null
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          owner_user_id: string
          phone: string
          relationship?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          owner_user_id?: string
          phone?: string
          relationship?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          buyer_id: string | null
          created_at: string
          id: string
          is_closed: boolean
          item_id: string | null
          kind: string
          last_message_at: string
          shop_id: string | null
          shop_order_id: string | null
          subject: string | null
        }
        Insert: {
          buyer_id?: string | null
          created_at?: string
          id?: string
          is_closed?: boolean
          item_id?: string | null
          kind: string
          last_message_at?: string
          shop_id?: string | null
          shop_order_id?: string | null
          subject?: string | null
        }
        Update: {
          buyer_id?: string | null
          created_at?: string
          id?: string
          is_closed?: boolean
          item_id?: string | null
          kind?: string
          last_message_at?: string
          shop_id?: string | null
          shop_order_id?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_shop_order_id_fkey"
            columns: ["shop_order_id"]
            isOneToOne: false
            referencedRelation: "shop_orders"
            referencedColumns: ["shop_order_id"]
          },
        ]
      }
      experience_items: {
        Row: {
          experience_id: string
          id: string
          item_id: string
          note: string | null
          quantity: number
          sort_order: number
        }
        Insert: {
          experience_id: string
          id?: string
          item_id: string
          note?: string | null
          quantity?: number
          sort_order?: number
        }
        Update: {
          experience_id?: string
          id?: string
          item_id?: string
          note?: string | null
          quantity?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "experience_items_experience_id_fkey"
            columns: ["experience_id"]
            isOneToOne: false
            referencedRelation: "experiences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experience_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      experiences: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          expires_at: string | null
          id: string
          image_url: string | null
          is_active: boolean
          is_featured: boolean
          name: string
          slug: string
          sort_order: number
          tagline: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_featured?: boolean
          name: string
          slug: string
          sort_order?: number
          tagline?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_featured?: boolean
          name?: string
          slug?: string
          sort_order?: number
          tagline?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiences_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      fx_quotes: {
        Row: {
          applied_rate: number
          basket_zmw_minor: number
          buyer_id: string
          consumed_at: string | null
          consumed_by_transaction_id: string | null
          expires_at: string
          fee_percent_applied: number
          issued_at: string
          mid_rate: number
          oer_timestamp: string
          platform_fee_minor: number
          quote_id: string
          quoted_amount_minor: number
          snapshot_age_minutes_at_issue: number
          snapshot_id: string
          spread_percent_applied: number
          target_currency: string
          total_zmw_minor: number
        }
        Insert: {
          applied_rate: number
          basket_zmw_minor: number
          buyer_id: string
          consumed_at?: string | null
          consumed_by_transaction_id?: string | null
          expires_at: string
          fee_percent_applied: number
          issued_at?: string
          mid_rate: number
          oer_timestamp: string
          platform_fee_minor: number
          quote_id?: string
          quoted_amount_minor: number
          snapshot_age_minutes_at_issue: number
          snapshot_id: string
          spread_percent_applied: number
          target_currency: string
          total_zmw_minor: number
        }
        Update: {
          applied_rate?: number
          basket_zmw_minor?: number
          buyer_id?: string
          consumed_at?: string | null
          consumed_by_transaction_id?: string | null
          expires_at?: string
          fee_percent_applied?: number
          issued_at?: string
          mid_rate?: number
          oer_timestamp?: string
          platform_fee_minor?: number
          quote_id?: string
          quoted_amount_minor?: number
          snapshot_age_minutes_at_issue?: number
          snapshot_id?: string
          spread_percent_applied?: number
          target_currency?: string
          total_zmw_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "fx_quotes_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fx_quotes_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "fx_rate_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      fx_rate_snapshots: {
        Row: {
          base_currency: string
          created_at: string
          fetched_at: string
          id: string
          oer_timestamp: string
          rate_source: string
          rates: Json
        }
        Insert: {
          base_currency: string
          created_at?: string
          fetched_at?: string
          id?: string
          oer_timestamp: string
          rate_source?: string
          rates: Json
        }
        Update: {
          base_currency?: string
          created_at?: string
          fetched_at?: string
          id?: string
          oer_timestamp?: string
          rate_source?: string
          rates?: Json
        }
        Relationships: []
      }
      item_images: {
        Row: {
          created_at: string
          id: string
          image_url: string
          item_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          image_url: string
          item_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string
          item_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "item_images_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      item_option_groups: {
        Row: {
          allow_multiple: boolean
          created_at: string
          id: string
          is_required: boolean
          item_id: string
          kind: string
          label: string
          max_value: number | null
          min_value: number | null
          sort_order: number
          unit_price_delta_zmw: number
        }
        Insert: {
          allow_multiple?: boolean
          created_at?: string
          id?: string
          is_required?: boolean
          item_id: string
          kind?: string
          label: string
          max_value?: number | null
          min_value?: number | null
          sort_order?: number
          unit_price_delta_zmw?: number
        }
        Update: {
          allow_multiple?: boolean
          created_at?: string
          id?: string
          is_required?: boolean
          item_id?: string
          kind?: string
          label?: string
          max_value?: number | null
          min_value?: number | null
          sort_order?: number
          unit_price_delta_zmw?: number
        }
        Relationships: [
          {
            foreignKeyName: "item_option_groups_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      item_options: {
        Row: {
          created_at: string
          group_id: string
          id: string
          is_available: boolean
          label: string
          price_delta_zmw: number
          sort_order: number
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          is_available?: boolean
          label: string
          price_delta_zmw?: number
          sort_order?: number
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          is_available?: boolean
          label?: string
          price_delta_zmw?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "item_options_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "item_option_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      item_price_tiers: {
        Row: {
          created_at: string
          id: string
          item_id: string
          min_quantity: number
          unit_price_zmw: number
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          min_quantity: number
          unit_price_zmw: number
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          min_quantity?: number
          unit_price_zmw?: number
        }
        Relationships: [
          {
            foreignKeyName: "item_price_tiers_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          allow_custom_quote: boolean
          category_id: string | null
          created_at: string | null
          currency: string | null
          description: string | null
          fulfillment_location: string | null
          has_expiry: boolean
          id: string
          image_url: string | null
          is_available: boolean | null
          is_discounted: boolean
          is_quote_only: boolean
          is_weekly_pick: boolean | null
          is_wholesale: boolean
          item_type: string
          lead_time_days: number | null
          minimum_order_quantity: number
          name: string
          original_price_zmw: number | null
          price_is_minimum: boolean
          price_zmw: number
          promo_badge_text: string | null
          requires_scheduling: boolean
          shop_id: string
          stock_alert_level: string | null
          stock_baseline: number | null
          stock_quantity: number | null
          valid_for_days: number | null
          wholesale_price_zmw: number | null
        }
        Insert: {
          allow_custom_quote?: boolean
          category_id?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          fulfillment_location?: string | null
          has_expiry?: boolean
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          is_discounted?: boolean
          is_quote_only?: boolean
          is_weekly_pick?: boolean | null
          is_wholesale?: boolean
          item_type?: string
          lead_time_days?: number | null
          minimum_order_quantity?: number
          name: string
          original_price_zmw?: number | null
          price_is_minimum?: boolean
          price_zmw: number
          promo_badge_text?: string | null
          requires_scheduling?: boolean
          shop_id: string
          stock_alert_level?: string | null
          stock_baseline?: number | null
          stock_quantity?: number | null
          valid_for_days?: number | null
          wholesale_price_zmw?: number | null
        }
        Update: {
          allow_custom_quote?: boolean
          category_id?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          fulfillment_location?: string | null
          has_expiry?: boolean
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          is_discounted?: boolean
          is_quote_only?: boolean
          is_weekly_pick?: boolean | null
          is_wholesale?: boolean
          item_type?: string
          lead_time_days?: number | null
          minimum_order_quantity?: number
          name?: string
          original_price_zmw?: number | null
          price_is_minimum?: boolean
          price_zmw?: number
          promo_badge_text?: string | null
          requires_scheduling?: boolean
          shop_id?: string
          stock_alert_level?: string | null
          stock_baseline?: number | null
          stock_quantity?: number | null
          valid_for_days?: number | null
          wholesale_price_zmw?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      kithly_wallets: {
        Row: {
          balance: number
          created_at: string | null
          currency: string
          id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string | null
          currency?: string
          id?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string | null
          currency?: string
          id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kithly_wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      list_items: {
        Row: {
          created_at: string
          entry_kind: string
          id: string
          item_id: string | null
          list_id: string
          shop_id: string | null
          snapshot_image_url: string | null
          snapshot_name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          entry_kind?: string
          id?: string
          item_id?: string | null
          list_id: string
          shop_id?: string | null
          snapshot_image_url?: string | null
          snapshot_name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          entry_kind?: string
          id?: string
          item_id?: string | null
          list_id?: string
          shop_id?: string | null
          snapshot_image_url?: string | null
          snapshot_name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "list_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_items_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
        ]
      }
      list_ratings: {
        Row: {
          created_at: string
          list_id: string
          rating: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          list_id: string
          rating: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          list_id?: string
          rating?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_ratings_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_ratings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      list_saves: {
        Row: {
          created_at: string
          list_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          list_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          list_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_saves_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_saves_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      lists: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_anonymous: boolean
          is_platform: boolean
          owner_shop_id: string | null
          owner_user_id: string | null
          rating_count: number
          rating_sum: number
          save_count: number
          slug: string
          title: string
          updated_at: string
          visibility: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_anonymous?: boolean
          is_platform?: boolean
          owner_shop_id?: string | null
          owner_user_id?: string | null
          rating_count?: number
          rating_sum?: number
          save_count?: number
          slug: string
          title: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_anonymous?: boolean
          is_platform?: boolean
          owner_shop_id?: string | null
          owner_user_id?: string | null
          rating_count?: number
          rating_sum?: number
          save_count?: number
          slug?: string
          title?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "lists_owner_shop_id_fkey"
            columns: ["owner_shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lists_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_campaigns: {
        Row: {
          created_at: string | null
          id: string
          image_url: string
          is_active: boolean | null
          sort_order: number | null
          target_route: string
          title: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          image_url: string
          is_active?: boolean | null
          sort_order?: number | null
          target_route: string
          title: string
        }
        Update: {
          created_at?: string | null
          id?: string
          image_url?: string
          is_active?: boolean | null
          sort_order?: number | null
          target_route?: string
          title?: string
        }
        Relationships: []
      }
      merchant_float_ledger: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          entry_type: string
          id: string
          shop_id: string
          shop_order_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          entry_type: string
          id?: string
          shop_id: string
          shop_order_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          entry_type?: string
          id?: string
          shop_id?: string
          shop_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "merchant_float_ledger_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_float_ledger_shop_order_id_fkey"
            columns: ["shop_order_id"]
            isOneToOne: false
            referencedRelation: "shop_orders"
            referencedColumns: ["shop_order_id"]
          },
        ]
      }
      merchant_shops: {
        Row: {
          created_at: string
          shop_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          shop_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          shop_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_shops_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_shops_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_withdrawals: {
        Row: {
          amount: number
          created_at: string
          failure_reason: string | null
          id: string
          ledger_id: string | null
          processed_at: string | null
          provider: string
          provider_reference: string | null
          provider_transfer_id: string | null
          requested_by: string | null
          shop_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          failure_reason?: string | null
          id?: string
          ledger_id?: string | null
          processed_at?: string | null
          provider?: string
          provider_reference?: string | null
          provider_transfer_id?: string | null
          requested_by?: string | null
          shop_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          failure_reason?: string | null
          id?: string
          ledger_id?: string | null
          processed_at?: string | null
          provider?: string
          provider_reference?: string | null
          provider_transfer_id?: string | null
          requested_by?: string | null
          shop_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_withdrawals_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "payout_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_withdrawals_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_withdrawals_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string | null
          conversation_id: string
          created_at: string
          id: string
          image_url: string | null
          message_type: string
          quotation_id: string | null
          sender_id: string | null
          sender_role: string
        }
        Insert: {
          body?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          image_url?: string | null
          message_type?: string
          quotation_id?: string | null
          sender_id?: string | null
          sender_role: string
        }
        Update: {
          body?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          image_url?: string | null
          message_type?: string
          quotation_id?: string | null
          sender_id?: string | null
          sender_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          reference_id: string | null
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          reference_id?: string | null
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          reference_id?: string | null
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          allocated_price: number
          child_claim_code: string | null
          created_at: string | null
          fulfilled_at: string | null
          fulfillment_status: string
          item_id: string
          order_item_id: string
          shop_order_id: string
        }
        Insert: {
          allocated_price: number
          child_claim_code?: string | null
          created_at?: string | null
          fulfilled_at?: string | null
          fulfillment_status?: string
          item_id: string
          order_item_id?: string
          shop_order_id: string
        }
        Update: {
          allocated_price?: number
          child_claim_code?: string | null
          created_at?: string | null
          fulfilled_at?: string | null
          fulfillment_status?: string
          item_id?: string
          order_item_id?: string
          shop_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_shop_order_id_fkey"
            columns: ["shop_order_id"]
            isOneToOne: false
            referencedRelation: "shop_orders"
            referencedColumns: ["shop_order_id"]
          },
        ]
      }
      payment_webhook_idempotency: {
        Row: {
          created_at: string
          idempotency_key: string
          transaction_id: string
        }
        Insert: {
          created_at?: string
          idempotency_key: string
          transaction_id: string
        }
        Update: {
          created_at?: string
          idempotency_key?: string
          transaction_id?: string
        }
        Relationships: []
      }
      payout_bank_codes: {
        Row: {
          category: string
          created_at: string
          display_name: string
          flutterwave_code: string | null
          id: string
          is_verified: boolean
          method_key: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          display_name: string
          flutterwave_code?: string | null
          id?: string
          is_verified?: boolean
          method_key: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          display_name?: string
          flutterwave_code?: string | null
          id?: string
          is_verified?: boolean
          method_key?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      payout_ledger: {
        Row: {
          amount: number | null
          commission: number | null
          created_at: string
          credit_amount: number
          id: string
          ledger_type: string
          reference: string | null
          shop_id: string
          shop_order_id: string | null
          status: string | null
        }
        Insert: {
          amount?: number | null
          commission?: number | null
          created_at?: string
          credit_amount?: number
          id?: string
          ledger_type?: string
          reference?: string | null
          shop_id: string
          shop_order_id?: string | null
          status?: string | null
        }
        Update: {
          amount?: number | null
          commission?: number | null
          created_at?: string
          credit_amount?: number
          id?: string
          ledger_type?: string
          reference?: string | null
          shop_id?: string
          shop_order_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payout_ledger_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_trust_tiers: {
        Row: {
          exposure_limit: number
          min_successful_deliveries: number
          sort_order: number
          tier: string
          upfront_percentage: number
        }
        Insert: {
          exposure_limit: number
          min_successful_deliveries: number
          sort_order: number
          tier: string
          upfront_percentage: number
        }
        Update: {
          exposure_limit?: number
          min_successful_deliveries?: number
          sort_order?: number
          tier?: string
          upfront_percentage?: number
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          abandoned_checkout_timeout_minutes: number | null
          current_usd_zmw_rate: number
          dispute_window_minutes: number
          expiry_reminder_days: number
          expiry_sender_refund_percent: number
          fx_fallback_bank_fee_percent: number
          fx_max_snapshot_age_minutes: number
          fx_quote_ttl_seconds: number
          fx_spread_percent: number
          id: number
          international_buyer_fee_percent: number
          local_buyer_fee_percent: number
          low_stock_percent: number
          merchant_fee_percent: number
          voucher_grace_days: number
        }
        Insert: {
          abandoned_checkout_timeout_minutes?: number | null
          current_usd_zmw_rate?: number
          dispute_window_minutes?: number
          expiry_reminder_days?: number
          expiry_sender_refund_percent?: number
          fx_fallback_bank_fee_percent?: number
          fx_max_snapshot_age_minutes?: number
          fx_quote_ttl_seconds?: number
          fx_spread_percent?: number
          id?: number
          international_buyer_fee_percent?: number
          local_buyer_fee_percent?: number
          low_stock_percent?: number
          merchant_fee_percent?: number
          voucher_grace_days?: number
        }
        Update: {
          abandoned_checkout_timeout_minutes?: number | null
          current_usd_zmw_rate?: number
          dispute_window_minutes?: number
          expiry_reminder_days?: number
          expiry_sender_refund_percent?: number
          fx_fallback_bank_fee_percent?: number
          fx_max_snapshot_age_minutes?: number
          fx_quote_ttl_seconds?: number
          fx_spread_percent?: number
          id?: number
          international_buyer_fee_percent?: number
          local_buyer_fee_percent?: number
          low_stock_percent?: number
          merchant_fee_percent?: number
          voucher_grace_days?: number
        }
        Relationships: []
      }
      provider_event_idempotency: {
        Row: {
          created_at: string
          event_key: string
          event_type: string
        }
        Insert: {
          created_at?: string
          event_key: string
          event_type: string
        }
        Update: {
          created_at?: string
          event_key?: string
          event_type?: string
        }
        Relationships: []
      }
      quotation_line_items: {
        Row: {
          description: string
          id: string
          quantity: number
          quotation_id: string
          sort_order: number
          unit_price_zmw: number
        }
        Insert: {
          description: string
          id?: string
          quantity?: number
          quotation_id: string
          sort_order?: number
          unit_price_zmw: number
        }
        Update: {
          description?: string
          id?: string
          quantity?: number
          quotation_id?: string
          sort_order?: number
          unit_price_zmw?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotation_line_items_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          buyer_id: string
          conversation_id: string
          created_at: string
          created_by: string | null
          decided_at: string | null
          decline_reason: string | null
          fulfillment_item_id: string | null
          id: string
          notes: string | null
          shop_id: string
          status: string
          target_execution_date: string | null
          total_amount: number
          valid_until: string | null
        }
        Insert: {
          buyer_id: string
          conversation_id: string
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decline_reason?: string | null
          fulfillment_item_id?: string | null
          id?: string
          notes?: string | null
          shop_id: string
          status?: string
          target_execution_date?: string | null
          total_amount: number
          valid_until?: string | null
        }
        Update: {
          buyer_id?: string
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decline_reason?: string | null
          fulfillment_item_id?: string | null
          id?: string
          notes?: string | null
          shop_id?: string
          status?: string
          target_execution_date?: string | null
          total_amount?: number
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotations_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_fulfillment_item_id_fkey"
            columns: ["fulfillment_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_documents: {
        Row: {
          archived_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          label: string
          shop_id: string
          storage_path: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          label: string
          shop_id: string
          storage_path: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          label?: string
          shop_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_documents_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_orders: {
        Row: {
          checkout_intent: string
          claim_code: string
          claim_status: string
          created_at: string | null
          disputed_at: string | null
          experience_id: string | null
          expires_at: string | null
          fulfilled_at: string | null
          message: string | null
          payout_status: string
          recipient_name: string | null
          recipient_phone: string | null
          settled: boolean | null
          settlement_target_time: string | null
          shop_id: string
          shop_order_id: string
          subtotal: number
          target_execution_date: string | null
          transaction_id: string
          upfront_paid: number
        }
        Insert: {
          checkout_intent?: string
          claim_code: string
          claim_status?: string
          created_at?: string | null
          disputed_at?: string | null
          experience_id?: string | null
          expires_at?: string | null
          fulfilled_at?: string | null
          message?: string | null
          payout_status?: string
          recipient_name?: string | null
          recipient_phone?: string | null
          settled?: boolean | null
          settlement_target_time?: string | null
          shop_id: string
          shop_order_id?: string
          subtotal?: number
          target_execution_date?: string | null
          transaction_id: string
          upfront_paid?: number
        }
        Update: {
          checkout_intent?: string
          claim_code?: string
          claim_status?: string
          created_at?: string | null
          disputed_at?: string | null
          experience_id?: string | null
          expires_at?: string | null
          fulfilled_at?: string | null
          message?: string | null
          payout_status?: string
          recipient_name?: string | null
          recipient_phone?: string | null
          settled?: boolean | null
          settlement_target_time?: string | null
          shop_id?: string
          shop_order_id?: string
          subtotal?: number
          target_execution_date?: string | null
          transaction_id?: string
          upfront_paid?: number
        }
        Relationships: [
          {
            foreignKeyName: "shop_orders_experience_id_fkey"
            columns: ["experience_id"]
            isOneToOne: false
            referencedRelation: "experiences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_orders_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_orders_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["transaction_id"]
          },
        ]
      }
      shop_ratings: {
        Row: {
          comment: string | null
          created_at: string
          rating: number
          shop_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          rating: number
          shop_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          rating?: number
          shop_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_ratings_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_ratings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          active_exposure: number
          address: string | null
          application_status: string
          cover_image_url: string | null
          created_at: string | null
          description: string | null
          float_balance: number
          float_exposure_limit: number
          id: string
          image_url: string | null
          is_active: boolean | null
          location: string | null
          logo_url: string | null
          maps_link: string | null
          name: string
          nrc_document_url: string | null
          nrc_url: string | null
          offers_products: boolean
          offers_services: boolean
          opening_hours: Json | null
          owner_id: string | null
          pacra_document_url: string | null
          pacra_url: string | null
          payout_account_name: string | null
          payout_bank_name: string | null
          payout_details: string | null
          payout_method: string | null
          payout_trust_tier: string
          physical_address: string | null
          public_email: string | null
          public_phone: string | null
          rating_count: number
          rating_sum: number
          rejection_reason: string | null
          shop_location: string | null
          successful_deliveries: number
          upfront_payout_percentage: number
          verification_reviewed_at: string | null
          verification_reviewed_by: string | null
          verification_status: string | null
          verification_tier: string | null
        }
        Insert: {
          active_exposure?: number
          address?: string | null
          application_status?: string
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          float_balance?: number
          float_exposure_limit?: number
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          location?: string | null
          logo_url?: string | null
          maps_link?: string | null
          name: string
          nrc_document_url?: string | null
          nrc_url?: string | null
          offers_products?: boolean
          offers_services?: boolean
          opening_hours?: Json | null
          owner_id?: string | null
          pacra_document_url?: string | null
          pacra_url?: string | null
          payout_account_name?: string | null
          payout_bank_name?: string | null
          payout_details?: string | null
          payout_method?: string | null
          payout_trust_tier?: string
          physical_address?: string | null
          public_email?: string | null
          public_phone?: string | null
          rating_count?: number
          rating_sum?: number
          rejection_reason?: string | null
          shop_location?: string | null
          successful_deliveries?: number
          upfront_payout_percentage?: number
          verification_reviewed_at?: string | null
          verification_reviewed_by?: string | null
          verification_status?: string | null
          verification_tier?: string | null
        }
        Update: {
          active_exposure?: number
          address?: string | null
          application_status?: string
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          float_balance?: number
          float_exposure_limit?: number
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          location?: string | null
          logo_url?: string | null
          maps_link?: string | null
          name?: string
          nrc_document_url?: string | null
          nrc_url?: string | null
          offers_products?: boolean
          offers_services?: boolean
          opening_hours?: Json | null
          owner_id?: string | null
          pacra_document_url?: string | null
          pacra_url?: string | null
          payout_account_name?: string | null
          payout_bank_name?: string | null
          payout_details?: string | null
          payout_method?: string | null
          payout_trust_tier?: string
          physical_address?: string | null
          public_email?: string | null
          public_phone?: string | null
          rating_count?: number
          rating_sum?: number
          rejection_reason?: string | null
          shop_location?: string | null
          successful_deliveries?: number
          upfront_payout_percentage?: number
          verification_reviewed_at?: string | null
          verification_reviewed_by?: string | null
          verification_status?: string | null
          verification_tier?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shops_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shops_payout_trust_tier_fkey"
            columns: ["payout_trust_tier"]
            isOneToOne: false
            referencedRelation: "payout_trust_tiers"
            referencedColumns: ["tier"]
          },
          {
            foreignKeyName: "shops_verification_reviewed_by_fkey"
            columns: ["verification_reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          caption: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          item_ids: string[]
          media_url: string
          shop_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          item_ids?: string[]
          media_url: string
          shop_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          item_ids?: string[]
          media_url?: string
          shop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_events: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          payload: Json
          shop_order_id: string | null
          transaction_id: string | null
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          payload?: Json
          shop_order_id?: string | null
          transaction_id?: string | null
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          payload?: Json
          shop_order_id?: string | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transaction_events_shop_order_id_fkey"
            columns: ["shop_order_id"]
            isOneToOne: false
            referencedRelation: "shop_orders"
            referencedColumns: ["shop_order_id"]
          },
        ]
      }
      transactions: {
        Row: {
          buyer_id: string | null
          charge_amount_minor: number | null
          charge_currency: string | null
          created_at: string | null
          currency: string
          fx_quote_id: string | null
          fx_rate_applied: number | null
          gateway_initiated_at: string | null
          gateway_reference: string | null
          gateway_tx_ref: string | null
          items_subtotal: number | null
          origin_type: string | null
          platform_fee: number
          public_code: string | null
          sender_phone: string | null
          status: string
          total_amount: number
          transaction_id: string
        }
        Insert: {
          buyer_id?: string | null
          charge_amount_minor?: number | null
          charge_currency?: string | null
          created_at?: string | null
          currency?: string
          fx_quote_id?: string | null
          fx_rate_applied?: number | null
          gateway_initiated_at?: string | null
          gateway_reference?: string | null
          gateway_tx_ref?: string | null
          items_subtotal?: number | null
          origin_type?: string | null
          platform_fee?: number
          public_code?: string | null
          sender_phone?: string | null
          status?: string
          total_amount: number
          transaction_id?: string
        }
        Update: {
          buyer_id?: string | null
          charge_amount_minor?: number | null
          charge_currency?: string | null
          created_at?: string | null
          currency?: string
          fx_quote_id?: string | null
          fx_rate_applied?: number | null
          gateway_initiated_at?: string | null
          gateway_reference?: string | null
          gateway_tx_ref?: string | null
          items_subtotal?: number | null
          origin_type?: string | null
          platform_fee?: number
          public_code?: string | null
          sender_phone?: string | null
          status?: string
          total_amount?: number
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_fx_quote_id_fkey"
            columns: ["fx_quote_id"]
            isOneToOne: false
            referencedRelation: "fx_quotes"
            referencedColumns: ["quote_id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string | null
          email: string
          id: string
          location: string | null
          name: string
          phone: string | null
          role: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id: string
          location?: string | null
          name: string
          phone?: string | null
          role?: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          location?: string | null
          name?: string
          phone?: string | null
          role?: string
        }
        Relationships: []
      }
      wallet_ledger: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          id: string
          reversal_of: string | null
          transaction_id: string | null
          wallet_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          reversal_of?: string | null
          transaction_id?: string | null
          wallet_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          reversal_of?: string | null
          transaction_id?: string | null
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_ledger_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "wallet_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_ledger_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "wallet_ledger_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "kithly_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_quotation: { Args: { p_quotation_id: string }; Returns: Json }
      admin_broadcast_notification: {
        Args: { p_audience?: string; p_message: string; p_type?: string }
        Returns: number
      }
      admin_expire_order: {
        Args: { p_reason?: string; p_shop_order_id: string }
        Returns: Json
      }
      admin_force_fulfill_order: {
        Args: { p_reason?: string; p_shop_order_id: string }
        Returns: Json
      }
      admin_start_conversation: {
        Args: { p_buyer_id?: string; p_shop_id?: string; p_subject?: string }
        Returns: string
      }
      apply_merchant_settlement: {
        Args: { p_shop_order_id: string }
        Returns: Json
      }
      atomic_fulfill_voucher: {
        Args: { p_claim_code: string; p_shop_id: string }
        Returns: {
          item_name: string
          recipient_name: string
          voucher_id: string
        }[]
      }
      buyer_fee_percent_for: {
        Args: { p_origin_type: string }
        Returns: number
      }
      can_access_conversation: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      can_access_shop_document_folder: {
        Args: { p_folder: string }
        Returns: boolean
      }
      can_edit_item_options: { Args: { p_group_id: string }; Returns: boolean }
      can_edit_list: { Args: { p_list_id: string }; Returns: boolean }
      can_rate_shop: { Args: { p_shop_id: string }; Returns: boolean }
      can_view_list: { Args: { p_list_id: string }; Returns: boolean }
      checkout_init_atomic: {
        Args: {
          p_buyer_id: string
          p_context?: Json
          p_gateway_tx_ref: string
          p_origin_type: string
          p_vendors: Json
        }
        Returns: Json
      }
      claim_withdrawal_batch: {
        Args: { p_limit?: number }
        Returns: {
          amount: number
          bank_category: string
          flutterwave_code: string
          is_verified: boolean
          payout_account_name: string
          payout_details: string
          payout_method: string
          shop_id: string
          shop_name: string
          withdrawal_id: string
        }[]
      }
      complete_redemption: { Args: { p_shop_order_id: string }; Returns: Json }
      complete_withdrawal: {
        Args: {
          p_reference?: string
          p_transfer_id?: string
          p_withdrawal_id: string
        }
        Returns: Json
      }
      confirm_payment_atomic: {
        Args: {
          p_idempotency_key?: string
          p_paid_amount: number
          p_paid_currency: string
          p_payload?: string
          p_transaction_id: string
        }
        Returns: Json
      }
      consume_fx_quote: {
        Args: {
          p_buyer_id: string
          p_expected_total_minor: number
          p_quote_id: string
          p_transaction_id: string
        }
        Returns: Json
      }
      conversation_role_for: {
        Args: { p_conversation_id: string; p_user_id: string }
        Returns: string
      }
      convert_floating_item_to_credits: {
        Args: { p_item_id: string; p_user_id: string }
        Returns: boolean
      }
      copy_list: {
        Args: { p_list_id: string; p_title?: string }
        Returns: Json
      }
      create_notification: {
        Args: {
          p_message: string
          p_reference_id?: string
          p_type: string
          p_user_id: string
        }
        Returns: string
      }
      create_quotation: {
        Args: {
          p_conversation_id: string
          p_line_items: Json
          p_notes?: string
          p_target_execution_date?: string
          p_valid_until?: string
        }
        Returns: string
      }
      current_user_role: { Args: never; Returns: string }
      decline_quotation: {
        Args: { p_quotation_id: string; p_reason?: string }
        Returns: Json
      }
      dispatch_expiry_reminder_whatsapp: { Args: never; Returns: number }
      ensure_transaction_code: {
        Args: { p_transaction_id: string }
        Returns: string
      }
      experience_is_available: {
        Args: { p_experience_id: string }
        Returns: boolean
      }
      experience_total: { Args: { p_experience_id: string }; Returns: number }
      fail_withdrawal: {
        Args: { p_reason: string; p_withdrawal_id: string }
        Returns: Json
      }
      fulfill_voucher_atomic: {
        Args: {
          p_claim_code: string
          p_merchant_user_id: string
          p_missing_item_ids: string[]
          p_present_item_ids: string[]
        }
        Returns: Json
      }
      fx_estimate_for_basket: {
        Args: { p_target_currency: string; p_vendors: Json }
        Returns: Json
      }
      fx_estimate_local_cost: {
        Args: { p_target_currency: string; p_total_zmw_minor: number }
        Returns: Json
      }
      fx_snapshot_age_minutes: { Args: never; Returns: number }
      fx_supported_currencies: { Args: never; Returns: string[] }
      fx_zmw_rate: { Args: { p_target_currency: string }; Returns: number }
      gen_claim_code: { Args: { p_len?: number }; Returns: string }
      generate_list_slug: { Args: { p_title: string }; Returns: string }
      get_shop_order_by_claim_code: { Args: { code: string }; Returns: Json }
      get_transaction_status: {
        Args: { p_transaction_id: string }
        Returns: string
      }
      import_catalog_item_to_shop: {
        Args: {
          p_actor_id: string
          p_catalog_item_id: string
          p_image_urls?: string[]
          p_price_zmw: number
          p_shop_id: string
        }
        Returns: Json
      }
      increment_merchant_balance: {
        Args: { amount_to_add: number; target_shop_id: string }
        Returns: undefined
      }
      increment_wallet_balance: {
        Args: {
          p_amount: number
          p_reference?: string
          p_shop_order_id?: string
          p_user_id: string
        }
        Returns: undefined
      }
      is_transaction_buyer: {
        Args: { tx_id: string; user_id: string }
        Returns: boolean
      }
      is_transaction_recipient: {
        Args: { phone: string; tx_id: string }
        Returns: boolean
      }
      is_valid_opening_hours: { Args: { p_hours: Json }; Returns: boolean }
      issue_fx_quote: {
        Args: {
          p_basket_zmw_minor: number
          p_buyer_id: string
          p_target_currency: string
        }
        Returns: Json
      }
      issue_fx_quote_for_basket: {
        Args: { p_buyer_id: string; p_target_currency: string; p_vendors: Json }
        Returns: Json
      }
      log_admin_action: {
        Args: {
          p_action: string
          p_actor_id?: string
          p_payload?: Json
          p_target_id?: string
          p_target_type: string
        }
        Returns: string
      }
      low_stock_threshold: { Args: { p_baseline: number }; Returns: number }
      mark_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      mark_withdrawal_unverified: {
        Args: { p_reason: string; p_withdrawal_id: string }
        Returns: Json
      }
      merchant_share_for: { Args: { p_gross: number }; Returns: number }
      notify_conversation_counterparties: {
        Args: {
          p_conversation_id: string
          p_preview: string
          p_sender_id: string
          p_sender_role: string
        }
        Returns: undefined
      }
      notify_experience_shop_owners: {
        Args: { p_experience_id: string; p_item_id?: string }
        Returns: undefined
      }
      notify_expiring_vouchers: { Args: never; Returns: number }
      notify_low_stock: { Args: never; Returns: number }
      price_basket_zmw: { Args: { p_vendors: Json }; Returns: number }
      process_due_redemptions: { Args: never; Returns: number }
      process_expired_vouchers: { Args: never; Returns: number }
      raise_order_dispute: {
        Args: { p_reason: string; p_shop_order_id: string }
        Returns: Json
      }
      reclaim_abandoned_checkouts: {
        Args: { p_older_than_minutes?: number }
        Returns: number
      }
      refresh_shop_trust_tier: {
        Args: { p_shop_id: string }
        Returns: undefined
      }
      register_merchant_shop: {
        Args: {
          p_location: string
          p_nrc_url: string
          p_offers_products?: boolean
          p_offers_services?: boolean
          p_pacra_url: string
          p_physical_address: string
          p_shop_name: string
        }
        Returns: Json
      }
      release_abandoned_checkout: {
        Args: { p_reason?: string; p_transaction_id: string }
        Returns: Json
      }
      reopen_unverified_withdrawal: {
        Args: { p_withdrawal_id: string }
        Returns: Json
      }
      request_withdrawal_atomic: {
        Args: { target_shop_id: string; withdrawal_amount: number }
        Returns: string
      }
      resolve_claim_code_for_shop: {
        Args: { p_code: string; p_shop_id: string }
        Returns: string
      }
      resolve_shop_merchant_user_id: {
        Args: { p_shop_id: string }
        Returns: string
      }
      reverse_completed_withdrawal: {
        Args: {
          p_event_key?: string
          p_reason: string
          p_withdrawal_id: string
        }
        Returns: Json
      }
      review_merchant_verification: {
        Args: {
          p_decision: string
          p_rejection_reason?: string
          p_shop_id: string
        }
        Returns: Json
      }
      scheduler_prerequisites: { Args: never; Returns: Json }
      send_message: {
        Args: {
          p_body?: string
          p_conversation_id: string
          p_image_url?: string
          p_message_type?: string
        }
        Returns: string
      }
      set_experience_items: {
        Args: { p_experience_id: string; p_items: Json }
        Returns: number
      }
      settle_payout_atomic: {
        Args: { p_merchant_user_id: string; p_shop_order_id: string }
        Returns: Json
      }
      start_conversation: {
        Args: { p_item_id?: string; p_shop_id: string; p_subject?: string }
        Returns: string
      }
      trigger_daily_payout_sweeper: { Args: never; Returns: undefined }
      trigger_fx_snapshot: { Args: never; Returns: undefined }
      unit_price_for: {
        Args: { p_item_id: string; p_quantity: number }
        Returns: number
      }
      update_shop_profile: {
        Args: {
          p_address?: string
          p_cover_image_url?: string
          p_location?: string
          p_logo_url?: string
          p_maps_link?: string
          p_name?: string
          p_opening_hours?: Json
          p_payout_account_name?: string
          p_payout_bank_name?: string
          p_payout_details?: string
          p_payout_method?: string
          p_public_email?: string
          p_public_phone?: string
          p_shop_id: string
        }
        Returns: Json
      }
      voucher_expiry_at: {
        Args: {
          p_purchased_at: string
          p_requires_scheduling: boolean
          p_target_execution_date: string
          p_valid_for_days: number
        }
        Returns: string
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const


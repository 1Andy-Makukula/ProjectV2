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
      items: {
        Row: {
          category_id: string | null
          created_at: string | null
          currency: string | null
          description: string | null
          id: string
          image_url: string | null
          is_available: boolean | null
          is_weekly_pick: boolean | null
          name: string
          price_zmw: number
          promo_badge_text: string | null
          shop_id: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          is_weekly_pick?: boolean | null
          name: string
          price_zmw: number
          promo_badge_text?: string | null
          shop_id: string
        }
        Update: {
          category_id?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          is_weekly_pick?: boolean | null
          name?: string
          price_zmw?: number
          promo_badge_text?: string | null
          shop_id?: string
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
      shop_orders: {
        Row: {
          claim_code: string
          claim_status: string
          created_at: string | null
          fulfilled_at: string | null
          message: string | null
          payout_status: string
          recipient_name: string
          recipient_phone: string
          settled: boolean | null
          settlement_target_time: string | null
          shop_id: string
          shop_order_id: string
          subtotal: number
          transaction_id: string
        }
        Insert: {
          claim_code: string
          claim_status?: string
          created_at?: string | null
          fulfilled_at?: string | null
          message?: string | null
          payout_status?: string
          recipient_name: string
          recipient_phone: string
          settled?: boolean | null
          settlement_target_time?: string | null
          shop_id: string
          shop_order_id?: string
          subtotal?: number
          transaction_id: string
        }
        Update: {
          claim_code?: string
          claim_status?: string
          created_at?: string | null
          fulfilled_at?: string | null
          message?: string | null
          payout_status?: string
          recipient_name?: string
          recipient_phone?: string
          settled?: boolean | null
          settlement_target_time?: string | null
          shop_id?: string
          shop_order_id?: string
          subtotal?: number
          transaction_id?: string
        }
        Relationships: [
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
      shops: {
        Row: {
          address: string | null
          cover_image_url: string | null
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          location: string | null
          logo_url: string | null
          name: string
          owner_id: string
          payout_details: string | null
          payout_method: string | null
        }
        Insert: {
          address?: string | null
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          location?: string | null
          logo_url?: string | null
          name: string
          owner_id: string
          payout_details?: string | null
          payout_method?: string | null
        }
        Update: {
          address?: string | null
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          location?: string | null
          logo_url?: string | null
          name?: string
          owner_id?: string
          payout_details?: string | null
          payout_method?: string | null
        }
        Relationships: []
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
          buyer_id: string
          created_at: string | null
          currency: string
          gateway_tx_ref: string | null
          origin_type: string | null
          sender_phone: string | null
          status: string
          total_amount: number
          transaction_id: string
        }
        Insert: {
          buyer_id: string
          created_at?: string | null
          currency?: string
          gateway_tx_ref?: string | null
          origin_type?: string | null
          sender_phone?: string | null
          status?: string
          total_amount: number
          transaction_id?: string
        }
        Update: {
          buyer_id?: string
          created_at?: string | null
          currency?: string
          gateway_tx_ref?: string | null
          origin_type?: string | null
          sender_phone?: string | null
          status?: string
          total_amount?: number
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_sender_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string | null
          email: string
          id: string
          name: string
          phone: string | null
          role: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id: string
          name: string
          phone?: string | null
          role?: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          name?: string
          phone?: string | null
          role?: string
        }
        Relationships: []
      }
      wallet_ledger: {
        Row: {
          amount: number
          created_at: string | null
          description: string | null
          id: string
          transaction_id: string | null
          wallet_id: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          description?: string | null
          id?: string
          transaction_id?: string | null
          wallet_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          description?: string | null
          id?: string
          transaction_id?: string | null
          wallet_id?: string
        }
        Relationships: [
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
      atomic_fulfill_voucher: {
        Args: { p_claim_code: string; p_shop_id: string }
        Returns: {
          item_name: string
          recipient_name: string
          voucher_id: string
        }[]
      }
      checkout_init_atomic: {
        Args: {
          p_buyer_id: string
          p_gateway_tx_ref: string
          p_message?: string
          p_origin_type: string
          p_recipient_name?: string
          p_recipient_phone?: string
          p_vendors: Json
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
      convert_floating_item_to_credits: {
        Args: { p_item_id: string; p_user_id: string }
        Returns: boolean
      }
      current_user_role: { Args: never; Returns: string }
      fulfill_voucher_atomic: {
        Args: {
          p_claim_code: string
          p_merchant_user_id: string
          p_missing_item_ids: string[]
          p_present_item_ids: string[]
        }
        Returns: Json
      }
      gen_claim_code: { Args: { p_len?: number }; Returns: string }
      get_shop_order_by_claim_code: { Args: { code: string }; Returns: Json }
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
      process_expired_vouchers: { Args: never; Returns: undefined }
      register_merchant_shop: {
        Args: { p_location: string; p_shop_name: string }
        Returns: Json
      }
      request_withdrawal_atomic: {
        Args: { target_shop_id: string; withdrawal_amount: number }
        Returns: string
      }
      settle_payout_atomic: {
        Args: { p_merchant_user_id: string; p_shop_order_id: string }
        Returns: Json
      }
      sweep_hanging_payments: { Args: never; Returns: undefined }
      trigger_daily_payout_sweeper: { Args: never; Returns: undefined }
      trigger_payment_sweeper: { Args: never; Returns: undefined }
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

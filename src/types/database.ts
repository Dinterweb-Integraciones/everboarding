export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      clients: {
        Row: {
          id: string;
          owner_user_id: string;
          seller_user_id: string | null;
          csm_user_id: string | null;
          name: string;
          slug: string;
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_user_id: string;
          seller_user_id?: string | null;
          csm_user_id?: string | null;
          name: string;
          slug?: string;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_user_id?: string;
          seller_user_id?: string | null;
          csm_user_id?: string | null;
          name?: string;
          slug?: string;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      client_members: {
        Row: {
          client_id: string;
          user_id: string;
          access_role: Database["public"]["Enums"]["client_access_role"];
          profile_role: Database["public"]["Enums"]["client_profile_role"];
          added_by_user_id: string | null;
          accepted_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          client_id: string;
          user_id: string;
          access_role: Database["public"]["Enums"]["client_access_role"];
          profile_role?: Database["public"]["Enums"]["client_profile_role"];
          added_by_user_id?: string | null;
          accepted_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          client_id?: string;
          user_id?: string;
          access_role?: Database["public"]["Enums"]["client_access_role"];
          profile_role?: Database["public"]["Enums"]["client_profile_role"];
          added_by_user_id?: string | null;
          accepted_at?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      client_share_links: {
        Row: {
          id: string;
          client_id: string;
          token: string;
          access_role: Database["public"]["Enums"]["client_access_role"];
          profile_role: Database["public"]["Enums"]["client_profile_role"];
          stage_scope: Database["public"]["Enums"]["project_stage"];
          created_by_user_id: string;
          expires_at: string | null;
          revoked_at: string | null;
          created_at: string;
          updated_at: string;
          last_used_at: string | null;
          use_count: number;
        };
        Insert: {
          id?: string;
          client_id: string;
          token?: string;
          access_role: Database["public"]["Enums"]["client_access_role"];
          profile_role?: Database["public"]["Enums"]["client_profile_role"];
          stage_scope?: Database["public"]["Enums"]["project_stage"];
          created_by_user_id: string;
          expires_at?: string | null;
          revoked_at?: string | null;
          created_at?: string;
          updated_at?: string;
          last_used_at?: string | null;
          use_count?: number;
        };
        Update: {
          id?: string;
          client_id?: string;
          token?: string;
          access_role?: Database["public"]["Enums"]["client_access_role"];
          profile_role?: Database["public"]["Enums"]["client_profile_role"];
          stage_scope?: Database["public"]["Enums"]["project_stage"];
          created_by_user_id?: string;
          expires_at?: string | null;
          revoked_at?: string | null;
          created_at?: string;
          updated_at?: string;
          last_used_at?: string | null;
          use_count?: number;
        };
      };
      onboarding_configs: {
        Row: {
          client_id: string;
          start_date: string;
          base_capacity: number;
          extra_capacity: number;
          lost_credits: number;
          custom_plan_credits: number | null;
          custom_plan_price: number | null;
          custom_plan_type: Database["public"]["Enums"]["custom_plan_type"] | null;
          current_stage: Database["public"]["Enums"]["project_stage"];
          credit_validity_days: number;
          show_all_completed: boolean;
          sales_cleared: boolean;
          created_at: string;
          updated_at: string;
          updated_by_user_id: string | null;
        };
        Insert: {
          client_id: string;
          start_date?: string;
          base_capacity?: number;
          extra_capacity?: number;
          lost_credits?: number;
          custom_plan_credits?: number | null;
          custom_plan_price?: number | null;
          custom_plan_type?: Database["public"]["Enums"]["custom_plan_type"] | null;
          current_stage?: Database["public"]["Enums"]["project_stage"];
          credit_validity_days?: number;
          show_all_completed?: boolean;
          sales_cleared?: boolean;
          created_at?: string;
          updated_at?: string;
          updated_by_user_id?: string | null;
        };
        Update: {
          client_id?: string;
          start_date?: string;
          base_capacity?: number;
          extra_capacity?: number;
          lost_credits?: number;
          custom_plan_credits?: number | null;
          custom_plan_price?: number | null;
          custom_plan_type?: Database["public"]["Enums"]["custom_plan_type"] | null;
          current_stage?: Database["public"]["Enums"]["project_stage"];
          credit_validity_days?: number;
          show_all_completed?: boolean;
          sales_cleared?: boolean;
          created_at?: string;
          updated_at?: string;
          updated_by_user_id?: string | null;
        };
      };
      onboarding_initiatives: {
        Row: {
          id: string;
          client_id: string;
          title: string;
          type: string | null;
          status: Database["public"]["Enums"]["initiative_status"];
          description: string | null;
          owner_client: string | null;
          owner_csm: string | null;
          est_start_date: string | null;
          est_end_date: string | null;
          date_planned: string | null;
          last_activity: string | null;
          is_blocked: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
          created_by_user_id: string | null;
          updated_by_user_id: string | null;
        };
        Insert: {
          id?: string;
          client_id: string;
          title: string;
          type?: string | null;
          status?: Database["public"]["Enums"]["initiative_status"];
          description?: string | null;
          owner_client?: string | null;
          owner_csm?: string | null;
          est_start_date?: string | null;
          est_end_date?: string | null;
          date_planned?: string | null;
          last_activity?: string | null;
          is_blocked?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
          created_by_user_id?: string | null;
          updated_by_user_id?: string | null;
        };
        Update: {
          id?: string;
          client_id?: string;
          title?: string;
          type?: string | null;
          status?: Database["public"]["Enums"]["initiative_status"];
          description?: string | null;
          owner_client?: string | null;
          owner_csm?: string | null;
          est_start_date?: string | null;
          est_end_date?: string | null;
          date_planned?: string | null;
          last_activity?: string | null;
          is_blocked?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
          created_by_user_id?: string | null;
          updated_by_user_id?: string | null;
        };
      };
      onboarding_initiative_subitems: {
        Row: {
          id: string;
          initiative_id: string;
          catalog_item_id: string | null;
          name: string;
          unit_credits: number;
          quantity: number;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          initiative_id: string;
          catalog_item_id?: string | null;
          name: string;
          unit_credits: number;
          quantity?: number;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          initiative_id?: string;
          catalog_item_id?: string | null;
          name?: string;
          unit_credits?: number;
          quantity?: number;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      onboarding_activity_logs: {
        Row: {
          id: string;
          initiative_id: string;
          entry: string;
          created_by_user_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          initiative_id: string;
          entry: string;
          created_by_user_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          initiative_id?: string;
          entry?: string;
          created_by_user_id?: string | null;
          created_at?: string;
        };
      };
      credit_catalog_items: {
        Row: {
          id: string;
          category: string;
          label: string;
          credits: number;
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          category: string;
          label: string;
          credits: number;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          category?: string;
          label?: string;
          credits?: number;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Enums: {
      client_access_role: "viewer" | "editor" | "owner";
      client_profile_role: "sales" | "csm" | "client" | "stakeholder";
      initiative_status: "backlog" | "planned" | "executing" | "completed";
      custom_plan_type: "mensual" | "proyecto";
      project_stage: "sales" | "cs" | "client";
    };
    Functions: {
      redeem_client_share_link: {
        Args: {
          p_token: string;
        };
        Returns: string;
      };
      create_client: {
        Args: {
          p_name: string;
          p_description: string | null;
          p_slug: string | null;
          p_seller_user_id: string | null;
          p_csm_user_id: string | null;
        };
        Returns: Database["public"]["Tables"]["clients"]["Row"];
      };
      list_assignable_profiles: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          email: string;
          full_name: string | null;
        }[];
      };
      add_client_member_by_email: {
        Args: {
          p_client_id: string;
          p_email: string;
          p_access_role: Database["public"]["Enums"]["client_access_role"];
          p_profile_role: Database["public"]["Enums"]["client_profile_role"];
        };
        Returns: Database["public"]["Tables"]["client_members"]["Row"];
      };
      get_public_onboarding_snapshot: {
        Args: {
          p_slug: string;
        };
        Returns: Json;
      };
      create_public_backlog_initiative: {
        Args: {
          p_slug: string;
          p_title: string;
          p_description: string | null;
        };
        Returns: Database["public"]["Tables"]["onboarding_initiatives"]["Row"];
      };
    };
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type Inserts<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type Updates<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];

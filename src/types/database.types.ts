
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "clients": {
                  Row: {
                    "address": string | null,"created_at": string,"email": string | null,"id": string,"matricule_fiscal": string | null,"name": string,"organization_id": string,"phone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"created_at"?: string,"email"?: string | null,"id"?: string,"matricule_fiscal"?: string | null,"name": string,"organization_id": string,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"created_at"?: string,"email"?: string | null,"id"?: string,"matricule_fiscal"?: string | null,"name"?: string,"organization_id"?: string,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clients_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"document_items": {
                  Row: {
                    "created_at": string,"description": string,"document_id": string,"id": string,"organization_id": string,"position": number,"quantity": number,"tva_rate": number,"unit_price": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description": string,"document_id": string,"id"?: string,"organization_id": string,"position"?: number,"quantity": number,"tva_rate": number,"unit_price": number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string,"document_id"?: string,"id"?: string,"organization_id"?: string,"position"?: number,"quantity"?: number,"tva_rate"?: number,"unit_price"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_items_document_fk"
      columns: ["organization_id","document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"documents": {
                  Row: {
                    "client_id": string | null,"converted_from": string | null,"created_at": string,"currency": string,"due_date": string | null,"id": string,"issue_date": string | null,"notes": string | null,"number": number | null,"organization_id": string,"status": Database["public"]['Enums']["document_status"],"type": Database["public"]['Enums']["document_type"],"updated_at": string,"year": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id"?: string | null,"converted_from"?: string | null,"created_at"?: string,"currency"?: string,"due_date"?: string | null,"id"?: string,"issue_date"?: string | null,"notes"?: string | null,"number"?: number | null,"organization_id": string,"status"?: Database["public"]['Enums']["document_status"],"type": Database["public"]['Enums']["document_type"],"updated_at"?: string,"year"?: number | null
                  }
                  Update: {
                    "client_id"?: string | null,"converted_from"?: string | null,"created_at"?: string,"currency"?: string,"due_date"?: string | null,"id"?: string,"issue_date"?: string | null,"notes"?: string | null,"number"?: number | null,"organization_id"?: string,"status"?: Database["public"]['Enums']["document_status"],"type"?: Database["public"]['Enums']["document_type"],"updated_at"?: string,"year"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "documents_client_fk"
      columns: ["organization_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "documents_converted_from_fk"
      columns: ["organization_id","converted_from"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "documents_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organization_members": {
                  Row: {
                    "created_at": string,"organization_id": string,"role": Database["public"]['Enums']["org_role"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"organization_id": string,"role"?: Database["public"]['Enums']["org_role"],"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"organization_id"?: string,"role"?: Database["public"]['Enums']["org_role"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_members_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "address": string | null,"created_at": string,"email": string | null,"id": string,"matricule_fiscal": string | null,"name": string,"phone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"created_at"?: string,"email"?: string | null,"id"?: string,"matricule_fiscal"?: string | null,"name": string,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"created_at"?: string,"email"?: string | null,"id"?: string,"matricule_fiscal"?: string | null,"name"?: string,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"payments": {
                  Row: {
                    "amount": number,"created_at": string,"document_id": string,"id": string,"method": Database["public"]['Enums']["payment_method"],"organization_id": string,"paid_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"document_id": string,"id"?: string,"method": Database["public"]['Enums']["payment_method"],"organization_id": string,"paid_at": string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"document_id"?: string,"id"?: string,"method"?: Database["public"]['Enums']["payment_method"],"organization_id"?: string,"paid_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_document_fk"
      columns: ["organization_id","document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"full_name": string | null,"id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"full_name"?: string | null,"id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"full_name"?: string | null,"id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"tax_settings": {
                  Row: {
                    "created_at": string,"default_tva_rate": number | null,"organization_id": string,"retenue_enabled": boolean,"retenue_rate": number | null,"retenue_threshold": number | null,"timbre_fiscal": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"default_tva_rate"?: number | null,"organization_id": string,"retenue_enabled"?: boolean,"retenue_rate"?: number | null,"retenue_threshold"?: number | null,"timbre_fiscal"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"default_tva_rate"?: number | null,"organization_id"?: string,"retenue_enabled"?: boolean,"retenue_rate"?: number | null,"retenue_threshold"?: number | null,"timbre_fiscal"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tax_settings_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            "document_status": "draft"|"sent"|"paid"|"cancelled","document_type": "devis"|"facture","org_role": "owner"|"admin"|"member","payment_method": "cash"|"virement"|"cheque"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "document_status": ["draft", "sent", "paid", "cancelled"],"document_type": ["devis", "facture"],"org_role": ["owner", "admin", "member"],"payment_method": ["cash", "virement", "cheque"]
          }
        }
} as const

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
      audit: {
        Row: {
          at: string
          by_id: string
          id: number
          project_id: string
          record_ref: Json | null
          text_he: string
        }
        Insert: {
          at?: string
          by_id: string
          id?: never
          project_id: string
          record_ref?: Json | null
          text_he: string
        }
        Update: {
          at?: string
          by_id?: string
          id?: never
          project_id?: string
          record_ref?: Json | null
          text_he?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      boq_lines: {
        Row: {
          chapter: string
          chapter_name_he: string
          coverage: string
          coverage_ref: string | null
          covered_by_contract_id: string | null
          description_he: string
          id: string
          note_he: string | null
          position: number
          project_id: string
          qty: number
          section_id: string
          unit: string
        }
        Insert: {
          chapter: string
          chapter_name_he: string
          coverage: string
          coverage_ref?: string | null
          covered_by_contract_id?: string | null
          description_he: string
          id: string
          note_he?: string | null
          position: number
          project_id: string
          qty: number
          section_id: string
          unit: string
        }
        Update: {
          chapter?: string
          chapter_name_he?: string
          coverage?: string
          coverage_ref?: string | null
          covered_by_contract_id?: string | null
          description_he?: string
          id?: string
          note_he?: string | null
          position?: number
          project_id?: string
          qty?: number
          section_id?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "boq_lines_project_id_covered_by_contract_id_fkey"
            columns: ["project_id", "covered_by_contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "boq_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boq_lines_project_id_section_id_fkey"
            columns: ["project_id", "section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      budget_changes: {
        Row: {
          amount: number
          approved_by: string
          created_at: string
          created_by: string
          date: string
          from_section_id: string | null
          id: string
          kind: string
          project_id: string
          reason_he: string
          reference_he: string | null
          to_section_id: string | null
        }
        Insert: {
          amount: number
          approved_by: string
          created_at?: string
          created_by: string
          date: string
          from_section_id?: string | null
          id: string
          kind: string
          project_id: string
          reason_he: string
          reference_he?: string | null
          to_section_id?: string | null
        }
        Update: {
          amount?: number
          approved_by?: string
          created_at?: string
          created_by?: string
          date?: string
          from_section_id?: string | null
          id?: string
          kind?: string
          project_id?: string
          reason_he?: string
          reference_he?: string | null
          to_section_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_changes_project_id_approved_by_fkey"
            columns: ["project_id", "approved_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "budget_changes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_changes_project_id_from_section_id_fkey"
            columns: ["project_id", "from_section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "budget_changes_project_id_to_section_id_fkey"
            columns: ["project_id", "to_section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      change_log: {
        Row: {
          after: string
          at: string
          before: string
          by_id: string
          field: string
          id: number
          note_he: string | null
          project_id: string
          record_id: string
          record_type: string
        }
        Insert: {
          after: string
          at?: string
          before: string
          by_id: string
          field: string
          id?: never
          note_he?: string | null
          project_id: string
          record_id: string
          record_type: string
        }
        Update: {
          after?: string
          at?: string
          before?: string
          by_id?: string
          field?: string
          id?: never
          note_he?: string | null
          project_id?: string
          record_id?: string
          record_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          amount: number | null
          boq_match_verified: boolean
          closed: Json | null
          document_id: string | null
          exclusions: Json
          id: string
          inclusions_he: string[]
          note_he: string | null
          price_appendices: Json | null
          project_id: string
          retention_pct: number
          scope_he: string
          section_id: string
          signed_at: string
          steel_supplied_by_client: boolean
          supplier_id: string
        }
        Insert: {
          amount?: number | null
          boq_match_verified?: boolean
          closed?: Json | null
          document_id?: string | null
          exclusions?: Json
          id: string
          inclusions_he?: string[]
          note_he?: string | null
          price_appendices?: Json | null
          project_id: string
          retention_pct?: number
          scope_he?: string
          section_id: string
          signed_at: string
          steel_supplied_by_client?: boolean
          supplier_id: string
        }
        Update: {
          amount?: number | null
          boq_match_verified?: boolean
          closed?: Json | null
          document_id?: string | null
          exclusions?: Json
          id?: string
          inclusions_he?: string[]
          note_he?: string | null
          price_appendices?: Json | null
          project_id?: string
          retention_pct?: number
          scope_he?: string
          section_id?: string
          signed_at?: string
          steel_supplied_by_client?: boolean
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_project_id_document_id_fkey"
            columns: ["project_id", "document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "contracts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_project_id_section_id_fkey"
            columns: ["project_id", "section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "contracts_project_id_supplier_id_fkey"
            columns: ["project_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      controls: {
        Row: {
          checked_he: string[]
          control_date: string
          created_at: string
          finalized: boolean
          findings: Json
          notes: Json
          operator_id: string | null
          positives: Json
          project_id: string
          report_config: Json
          requested_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          checked_he?: string[]
          control_date: string
          created_at?: string
          finalized?: boolean
          findings?: Json
          notes?: Json
          operator_id?: string | null
          positives?: Json
          project_id: string
          report_config?: Json
          requested_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          checked_he?: string[]
          control_date?: string
          created_at?: string
          finalized?: boolean
          findings?: Json
          notes?: Json
          operator_id?: string | null
          positives?: Json
          project_id?: string
          report_config?: Json
          requested_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "controls_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      data_corrections: {
        Row: {
          after_he: string
          approved_by_id: string
          at: string
          before_he: string
          control_date: string
          cross_section_he: string
          field_he: string
          finding_id: string | null
          id: string
          project_id: string
          record_id: string
          record_type: string
          status: string
        }
        Insert: {
          after_he: string
          approved_by_id: string
          at?: string
          before_he: string
          control_date: string
          cross_section_he: string
          field_he: string
          finding_id?: string | null
          id: string
          project_id: string
          record_id: string
          record_type: string
          status: string
        }
        Update: {
          after_he?: string
          approved_by_id?: string
          at?: string
          before_he?: string
          control_date?: string
          cross_section_he?: string
          field_he?: string
          finding_id?: string | null
          id?: string
          project_id?: string
          record_id?: string
          record_type?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_corrections_project_id_control_date_fkey"
            columns: ["project_id", "control_date"]
            isOneToOne: false
            referencedRelation: "controls"
            referencedColumns: ["project_id", "control_date"]
          },
        ]
      }
      decisions: {
        Row: {
          audit_he: string | null
          choice_id: string | null
          control_date: string
          finding_id: string
          free_text_he: string | null
          owner_id: string | null
          pending: Json | null
          project_id: string
          resolved_at: string | null
          route_id: string | null
          status: string
          updated_at: string
          verified_he: string | null
        }
        Insert: {
          audit_he?: string | null
          choice_id?: string | null
          control_date: string
          finding_id: string
          free_text_he?: string | null
          owner_id?: string | null
          pending?: Json | null
          project_id: string
          resolved_at?: string | null
          route_id?: string | null
          status: string
          updated_at?: string
          verified_he?: string | null
        }
        Update: {
          audit_he?: string | null
          choice_id?: string | null
          control_date?: string
          finding_id?: string
          free_text_he?: string | null
          owner_id?: string | null
          pending?: Json | null
          project_id?: string
          resolved_at?: string | null
          route_id?: string | null
          status?: string
          updated_at?: string
          verified_he?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "decisions_project_id_control_date_fkey"
            columns: ["project_id", "control_date"]
            isOneToOne: false
            referencedRelation: "controls"
            referencedColumns: ["project_id", "control_date"]
          },
        ]
      }
      documents: {
        Row: {
          anchors: Json
          blocks: Json
          date: string
          facts: Json
          facts_source: Json | null
          file_name: string
          file_path: string | null
          footer_he: string
          id: string
          kind: string
          mime_type: string | null
          project_id: string
          record_id: string | null
          record_type: string | null
          size_bytes: number | null
          summary_he: string | null
          superseded_by: string | null
          supplier_id: string | null
          text: string | null
          title_he: string
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          anchors?: Json
          blocks?: Json
          date: string
          facts?: Json
          facts_source?: Json | null
          file_name: string
          file_path?: string | null
          footer_he?: string
          id: string
          kind: string
          mime_type?: string | null
          project_id: string
          record_id?: string | null
          record_type?: string | null
          size_bytes?: number | null
          summary_he?: string | null
          superseded_by?: string | null
          supplier_id?: string | null
          text?: string | null
          title_he: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          anchors?: Json
          blocks?: Json
          date?: string
          facts?: Json
          facts_source?: Json | null
          file_name?: string
          file_path?: string | null
          footer_he?: string
          id?: string
          kind?: string
          mime_type?: string | null
          project_id?: string
          record_id?: string | null
          record_type?: string | null
          size_bytes?: number | null
          summary_he?: string | null
          superseded_by?: string | null
          supplier_id?: string | null
          text?: string | null
          title_he?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_project_id_supplier_id_fkey"
            columns: ["project_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      forecast_adjustments: {
        Row: {
          amount: number
          basis: string
          basis_he: string
          change_type: string
          committed_portion: Json | null
          control_date: string
          created_at: string
          description_he: string
          document_id: string | null
          finding_id: string | null
          id: string
          project_id: string
          qty: number | null
          replaces_line_id: string | null
          section_id: string
          source_ref: string
          unit: string | null
          unit_price: number | null
        }
        Insert: {
          amount: number
          basis: string
          basis_he: string
          change_type: string
          committed_portion?: Json | null
          control_date: string
          created_at?: string
          description_he: string
          document_id?: string | null
          finding_id?: string | null
          id: string
          project_id: string
          qty?: number | null
          replaces_line_id?: string | null
          section_id: string
          source_ref: string
          unit?: string | null
          unit_price?: number | null
        }
        Update: {
          amount?: number
          basis?: string
          basis_he?: string
          change_type?: string
          committed_portion?: Json | null
          control_date?: string
          created_at?: string
          description_he?: string
          document_id?: string | null
          finding_id?: string | null
          id?: string
          project_id?: string
          qty?: number | null
          replaces_line_id?: string | null
          section_id?: string
          source_ref?: string
          unit?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "forecast_adjustments_project_id_control_date_fkey"
            columns: ["project_id", "control_date"]
            isOneToOne: false
            referencedRelation: "controls"
            referencedColumns: ["project_id", "control_date"]
          },
          {
            foreignKeyName: "forecast_adjustments_project_id_section_id_fkey"
            columns: ["project_id", "section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      forecast_lines: {
        Row: {
          amount: number
          basis: string
          control_date: string
          description_he: string
          id: string
          kind: string
          position: number
          project_id: string
          qty: number | null
          section_id: string
          source_ref: string | null
          unit: string | null
          unit_price: number | null
        }
        Insert: {
          amount: number
          basis: string
          control_date: string
          description_he: string
          id: string
          kind: string
          position: number
          project_id: string
          qty?: number | null
          section_id: string
          source_ref?: string | null
          unit?: string | null
          unit_price?: number | null
        }
        Update: {
          amount?: number
          basis?: string
          control_date?: string
          description_he?: string
          id?: string
          kind?: string
          position?: number
          project_id?: string
          qty?: number | null
          section_id?: string
          source_ref?: string | null
          unit?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "forecast_lines_project_id_control_date_section_id_fkey"
            columns: ["project_id", "control_date", "section_id"]
            isOneToOne: false
            referencedRelation: "forecast_sections"
            referencedColumns: ["project_id", "control_date", "section_id"]
          },
        ]
      }
      forecast_sections: {
        Row: {
          budget: number
          committed: number
          control_date: string
          coverage_note_he: string | null
          eac: number
          project_id: string
          recorded: number
          remaining_commitment: number
          section_id: string
          uncovered: number
        }
        Insert: {
          budget: number
          committed: number
          control_date: string
          coverage_note_he?: string | null
          eac: number
          project_id: string
          recorded: number
          remaining_commitment: number
          section_id: string
          uncovered: number
        }
        Update: {
          budget?: number
          committed?: number
          control_date?: string
          coverage_note_he?: string | null
          eac?: number
          project_id?: string
          recorded?: number
          remaining_commitment?: number
          section_id?: string
          uncovered?: number
        }
        Relationships: [
          {
            foreignKeyName: "forecast_sections_project_id_control_date_fkey"
            columns: ["project_id", "control_date"]
            isOneToOne: false
            referencedRelation: "forecast_versions"
            referencedColumns: ["project_id", "control_date"]
          },
          {
            foreignKeyName: "forecast_sections_project_id_section_id_fkey"
            columns: ["project_id", "section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      forecast_versions: {
        Row: {
          control_date: string
          has_sections: boolean
          project_id: string
          qualifications_he: string[]
          status: string
          total_eac: number
        }
        Insert: {
          control_date: string
          has_sections?: boolean
          project_id: string
          qualifications_he?: string[]
          status: string
          total_eac: number
        }
        Update: {
          control_date?: string
          has_sections?: boolean
          project_id?: string
          qualifications_he?: string[]
          status?: string
          total_eac?: number
        }
        Relationships: [
          {
            foreignKeyName: "forecast_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      heartbeats: {
        Row: {
          at: string
          by_id: string
          details: Json
          documents_pending: number
          documents_processed: number
          findings: number
          id: number
          project_id: string
          records_changed: number
          since_change_log_id: number
          summary_he: string
          until_change_log_id: number
        }
        Insert: {
          at?: string
          by_id: string
          details?: Json
          documents_pending?: number
          documents_processed?: number
          findings?: number
          id?: never
          project_id: string
          records_changed?: number
          since_change_log_id?: number
          summary_he?: string
          until_change_log_id?: number
        }
        Update: {
          at?: string
          by_id?: string
          details?: Json
          documents_pending?: number
          documents_processed?: number
          findings?: number
          id?: never
          project_id?: string
          records_changed?: number
          since_change_log_id?: number
          summary_he?: string
          until_change_log_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "heartbeats_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          approved_by: string | null
          attachment_id: string | null
          building: string | null
          contract_id: string | null
          cumulative_now: number | null
          cumulative_prev: number | null
          date: string
          date_received: string
          description_he: string
          doc_type: string
          entered_at: string
          entered_by: string
          id: number
          net_payable: number
          partial_no: number | null
          period: string
          po_id: number | null
          project_id: string
          quantity: number | null
          retention_amt: number
          retention_pct: number
          section_id: string
          status: string
          supplier_doc_no: string
          supplier_id: string
          unit: string | null
          unit_price: number | null
          update_note_he: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          approved_by?: string | null
          attachment_id?: string | null
          building?: string | null
          contract_id?: string | null
          cumulative_now?: number | null
          cumulative_prev?: number | null
          date: string
          date_received: string
          description_he: string
          doc_type: string
          entered_at: string
          entered_by: string
          id: number
          net_payable: number
          partial_no?: number | null
          period: string
          po_id?: number | null
          project_id: string
          quantity?: number | null
          retention_amt?: number
          retention_pct?: number
          section_id: string
          status: string
          supplier_doc_no: string
          supplier_id: string
          unit?: string | null
          unit_price?: number | null
          update_note_he?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          approved_by?: string | null
          attachment_id?: string | null
          building?: string | null
          contract_id?: string | null
          cumulative_now?: number | null
          cumulative_prev?: number | null
          date?: string
          date_received?: string
          description_he?: string
          doc_type?: string
          entered_at?: string
          entered_by?: string
          id?: number
          net_payable?: number
          partial_no?: number | null
          period?: string
          po_id?: number | null
          project_id?: string
          quantity?: number | null
          retention_amt?: number
          retention_pct?: number
          section_id?: string
          status?: string
          supplier_doc_no?: string
          supplier_id?: string
          unit?: string | null
          unit_price?: number | null
          update_note_he?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_project_id_attachment_id_fkey"
            columns: ["project_id", "attachment_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "invoices_project_id_contract_id_fkey"
            columns: ["project_id", "contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_id_po_id_fkey"
            columns: ["project_id", "po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "invoices_project_id_section_id_fkey"
            columns: ["project_id", "section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "invoices_project_id_supplier_id_fkey"
            columns: ["project_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      open_issues: {
        Row: {
          closed_at: string | null
          due_date: string | null
          finding_id: string | null
          id: string
          impact_if_ignored_he: string | null
          opened_in_control: string
          owner_id: string
          project_id: string
          section_id: string | null
          status: string
          title_he: string
        }
        Insert: {
          closed_at?: string | null
          due_date?: string | null
          finding_id?: string | null
          id: string
          impact_if_ignored_he?: string | null
          opened_in_control: string
          owner_id: string
          project_id: string
          section_id?: string | null
          status: string
          title_he: string
        }
        Update: {
          closed_at?: string | null
          due_date?: string | null
          finding_id?: string | null
          id?: string
          impact_if_ignored_he?: string | null
          opened_in_control?: string
          owner_id?: string
          project_id?: string
          section_id?: string | null
          status?: string
          title_he?: string
        }
        Relationships: [
          {
            foreignKeyName: "open_issues_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_issues_project_id_owner_id_fkey"
            columns: ["project_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "open_issues_project_id_section_id_fkey"
            columns: ["project_id", "section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      people: {
        Row: {
          can_write_allocation: boolean
          channel: string | null
          id: string
          name_he: string
          project_id: string
          role_he: string
        }
        Insert: {
          can_write_allocation?: boolean
          channel?: string | null
          id: string
          name_he: string
          project_id: string
          role_he: string
        }
        Update: {
          can_write_allocation?: boolean
          channel?: string | null
          id?: string
          name_he?: string
          project_id?: string
          role_he?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          boq_version: Json
          buckets: Json
          budget_version: Json
          buildings: Json
          check_policy: Json
          company_he: string
          control_dates: string[]
          created_at: string
          current_control_date: string | null
          gross_sqm: number | null
          id: string
          materiality: Json
          name_he: string
          physical_progress_pct: number | null
          risk_policy: Json
          schedule: Json
          start_date: string | null
          status_he: string | null
          units: number | null
        }
        Insert: {
          boq_version: Json
          buckets?: Json
          budget_version: Json
          buildings?: Json
          check_policy?: Json
          company_he: string
          control_dates?: string[]
          created_at?: string
          current_control_date?: string | null
          gross_sqm?: number | null
          id: string
          materiality?: Json
          name_he: string
          physical_progress_pct?: number | null
          risk_policy?: Json
          schedule?: Json
          start_date?: string | null
          status_he?: string | null
          units?: number | null
        }
        Update: {
          boq_version?: Json
          buckets?: Json
          budget_version?: Json
          buildings?: Json
          check_policy?: Json
          company_he?: string
          control_dates?: string[]
          created_at?: string
          current_control_date?: string | null
          gross_sqm?: number | null
          id?: string
          materiality?: Json
          name_he?: string
          physical_progress_pct?: number | null
          risk_policy?: Json
          schedule?: Json
          start_date?: string | null
          status_he?: string | null
          units?: number | null
        }
        Relationships: []
      }
      purchase_orders: {
        Row: {
          amount: number
          attachment_id: string | null
          contract_id: string | null
          date: string
          delivered_qty: number
          description_he: string
          id: number
          invoiced_amount: number
          kind: string
          price_unit: string
          project_id: string
          qty: number
          section_id: string
          status: string
          supplier_id: string
          unit: string
          unit_price: number
          update_note_he: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          attachment_id?: string | null
          contract_id?: string | null
          date: string
          delivered_qty?: number
          description_he: string
          id: number
          invoiced_amount?: number
          kind: string
          price_unit: string
          project_id: string
          qty: number
          section_id: string
          status: string
          supplier_id: string
          unit: string
          unit_price: number
          update_note_he?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          attachment_id?: string | null
          contract_id?: string | null
          date?: string
          delivered_qty?: number
          description_he?: string
          id?: number
          invoiced_amount?: number
          kind?: string
          price_unit?: string
          project_id?: string
          qty?: number
          section_id?: string
          status?: string
          supplier_id?: string
          unit?: string
          unit_price?: number
          update_note_he?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_project_id_attachment_id_fkey"
            columns: ["project_id", "attachment_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "purchase_orders_project_id_contract_id_fkey"
            columns: ["project_id", "contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "purchase_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_project_id_section_id_fkey"
            columns: ["project_id", "section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "purchase_orders_project_id_supplier_id_fkey"
            columns: ["project_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      questions: {
        Row: {
          answer_he: string | null
          answered_at: string | null
          answered_by_id: string | null
          asked_at: string
          asked_by_id: string
          channel: string
          control_date: string
          finding_id: string | null
          id: string
          project_id: string
          status: string
          text_he: string
          to_id: string
        }
        Insert: {
          answer_he?: string | null
          answered_at?: string | null
          answered_by_id?: string | null
          asked_at?: string
          asked_by_id: string
          channel: string
          control_date: string
          finding_id?: string | null
          id: string
          project_id: string
          status: string
          text_he: string
          to_id: string
        }
        Update: {
          answer_he?: string | null
          answered_at?: string | null
          answered_by_id?: string | null
          asked_at?: string
          asked_by_id?: string
          channel?: string
          control_date?: string
          finding_id?: string | null
          id?: string
          project_id?: string
          status?: string
          text_he?: string
          to_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "questions_project_id_control_date_fkey"
            columns: ["project_id", "control_date"]
            isOneToOne: false
            referencedRelation: "controls"
            referencedColumns: ["project_id", "control_date"]
          },
          {
            foreignKeyName: "questions_project_id_to_id_fkey"
            columns: ["project_id", "to_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      report_versions: {
        Row: {
          control_date: string
          created_at: string
          created_by: string
          docx_path: string | null
          id: number
          label: string | null
          model: Json
          project_id: string
        }
        Insert: {
          control_date: string
          created_at?: string
          created_by: string
          docx_path?: string | null
          id?: never
          label?: string | null
          model: Json
          project_id: string
        }
        Update: {
          control_date?: string
          created_at?: string
          created_by?: string
          docx_path?: string | null
          id?: never
          label?: string | null
          model?: Json
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sections: {
        Row: {
          budget: number
          chapters: string[]
          id: string
          kind: string
          name_he: string
          position: number
          project_id: string
          short_name_he: string
          split: string
        }
        Insert: {
          budget: number
          chapters?: string[]
          id: string
          kind?: string
          name_he: string
          position: number
          project_id: string
          short_name_he: string
          split: string
        }
        Update: {
          budget?: number
          chapters?: string[]
          id?: string
          kind?: string
          name_he?: string
          position?: number
          project_id?: string
          short_name_he?: string
          split?: string
        }
        Relationships: [
          {
            foreignKeyName: "sections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          id: string
          kind: string
          name_he: string
          project_id: string
        }
        Insert: {
          id: string
          kind: string
          name_he: string
          project_id: string
        }
        Update: {
          id?: string
          kind?: string
          name_he?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      fmt_num: { Args: { v: number }; Returns: string }
      reset_project: { Args: { p_project_id: string }; Returns: undefined }
      section_label: {
        Args: { p_project_id: string; p_section_id: string }
        Returns: string
      }
      snapshot_project_seed: {
        Args: { p_project_id: string }
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

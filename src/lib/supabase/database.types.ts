export type Json = string | number | boolean | null | {
    [key: string]: Json | undefined;
} | Json[];
export type Database = {
    "graphql_public": {
        Tables: {
            [_ in never]: never;
        };
        Views: {
            [_ in never]: never;
        };
        Functions: {
            "graphql": {
                Args: {
                    "extensions"?: Json;
                    "operationName"?: string;
                    "query"?: string;
                    "variables"?: Json;
                };
                Returns: Json;
            };
        };
        Enums: {
            [_ in never]: never;
        };
        CompositeTypes: {
            [_ in never]: never;
        };
    };
    "public": {
        Tables: {
            "budgets": {
                Row: {
                    "category_id": string;
                    "created_at": string;
                    "currency": string;
                    "id": string;
                    "limit_minor": number | null;
                    "starts_month": string;
                    "user_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "category_id": string;
                    "created_at"?: string;
                    "currency": string;
                    "id"?: string;
                    "limit_minor"?: number | null;
                    "starts_month": string;
                    "user_id"?: string;
                };
                Update: {
                    "category_id"?: string;
                    "created_at"?: string;
                    "currency"?: string;
                    "id"?: string;
                    "limit_minor"?: number | null;
                    "starts_month"?: string;
                    "user_id"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "budgets_category_id_fkey";
                        columns: [
                            "category_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "categories";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "budgets_user_id_currency_fkey";
                        columns: [
                            "user_id",
                            "currency"
                        ];
                        isOneToOne: false;
                        referencedRelation: "currencies";
                        referencedColumns: [
                            "user_id",
                            "code"
                        ];
                    }
                ];
            };
            "cashier_changes": {
                Row: {
                    "amount_minor": number;
                    "balance_id": string;
                    "currency": string;
                    "id": string;
                    "position": number;
                    "rate_base": string | null;
                    "rate_denominator": number | null;
                    "rate_numerator": number | null;
                    "rate_quote": string | null;
                    "transaction_id": string;
                    "user_id": string;
                    "wallet_name_snapshot": string | null;
                };
                ComputedFields: never;
                Insert: {
                    "amount_minor": number;
                    "balance_id": string;
                    "currency": string;
                    "id"?: string;
                    "position": number;
                    "rate_base"?: string | null;
                    "rate_denominator"?: number | null;
                    "rate_numerator"?: number | null;
                    "rate_quote"?: string | null;
                    "transaction_id": string;
                    "user_id"?: string;
                    "wallet_name_snapshot"?: string | null;
                };
                Update: {
                    "amount_minor"?: number;
                    "balance_id"?: string;
                    "currency"?: string;
                    "id"?: string;
                    "position"?: number;
                    "rate_base"?: string | null;
                    "rate_denominator"?: number | null;
                    "rate_numerator"?: number | null;
                    "rate_quote"?: string | null;
                    "transaction_id"?: string;
                    "user_id"?: string;
                    "wallet_name_snapshot"?: string | null;
                };
                Relationships: [
                    {
                        foreignKeyName: "cashier_changes_balance_id_owner";
                        columns: [
                            "balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balance_totals";
                        referencedColumns: [
                            "balance_id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "cashier_changes_balance_id_owner";
                        columns: [
                            "balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balances";
                        referencedColumns: [
                            "id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "cashier_changes_transaction_owner_fkey";
                        columns: [
                            "transaction_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "transactions";
                        referencedColumns: [
                            "id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "cashier_changes_user_id_currency_fkey";
                        columns: [
                            "user_id",
                            "currency"
                        ];
                        isOneToOne: false;
                        referencedRelation: "currencies";
                        referencedColumns: [
                            "user_id",
                            "code"
                        ];
                    },
                    {
                        foreignKeyName: "cashier_changes_user_id_rate_base_fkey";
                        columns: [
                            "user_id",
                            "rate_base"
                        ];
                        isOneToOne: false;
                        referencedRelation: "currencies";
                        referencedColumns: [
                            "user_id",
                            "code"
                        ];
                    },
                    {
                        foreignKeyName: "cashier_changes_user_id_rate_quote_fkey";
                        columns: [
                            "user_id",
                            "rate_quote"
                        ];
                        isOneToOne: false;
                        referencedRelation: "currencies";
                        referencedColumns: [
                            "user_id",
                            "code"
                        ];
                    }
                ];
            };
            "categories": {
                Row: {
                    "archived_at": string | null;
                    "color": string;
                    "created_at": string;
                    "id": string;
                    "kind": Database["public"]['Enums']["category_kind"];
                    "name_ar": string | null;
                    "name_en": string | null;
                    "parent_id": string | null;
                    "position": number;
                    "tile": number;
                    "user_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "archived_at"?: string | null;
                    "color": string;
                    "created_at"?: string;
                    "id"?: string;
                    "kind": Database["public"]['Enums']["category_kind"];
                    "name_ar"?: string | null;
                    "name_en"?: string | null;
                    "parent_id"?: string | null;
                    "position"?: number;
                    "tile": number;
                    "user_id"?: string;
                };
                Update: {
                    "archived_at"?: string | null;
                    "color"?: string;
                    "created_at"?: string;
                    "id"?: string;
                    "kind"?: Database["public"]['Enums']["category_kind"];
                    "name_ar"?: string | null;
                    "name_en"?: string | null;
                    "parent_id"?: string | null;
                    "position"?: number;
                    "tile"?: number;
                    "user_id"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "categories_parent_id_fkey";
                        columns: [
                            "parent_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "categories";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "currencies": {
                Row: {
                    "code": string;
                    "created_at": string;
                    "decimal_places": number;
                    "disabled_at": string | null;
                    "first_used_at": string | null;
                    "symbol": string;
                    "user_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "code": string;
                    "created_at"?: string;
                    "decimal_places": number;
                    "disabled_at"?: string | null;
                    "first_used_at"?: string | null;
                    "symbol": string;
                    "user_id"?: string;
                };
                Update: {
                    "code"?: string;
                    "created_at"?: string;
                    "decimal_places"?: number;
                    "disabled_at"?: string | null;
                    "first_used_at"?: string | null;
                    "symbol"?: string;
                    "user_id"?: string;
                };
                Relationships: [
                ];
            };
            "expense_items": {
                Row: {
                    "amount_minor": number;
                    "description": string;
                    "id": string;
                    "position": number;
                    "transaction_id": string;
                    "user_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "amount_minor": number;
                    "description": string;
                    "id"?: string;
                    "position": number;
                    "transaction_id": string;
                    "user_id"?: string;
                };
                Update: {
                    "amount_minor"?: number;
                    "description"?: string;
                    "id"?: string;
                    "position"?: number;
                    "transaction_id"?: string;
                    "user_id"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "expense_items_transaction_owner_fkey";
                        columns: [
                            "transaction_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "transactions";
                        referencedColumns: [
                            "id",
                            "user_id"
                        ];
                    }
                ];
            };
            "fixed_expenses": {
                Row: {
                    "amount_minor": number;
                    "balance_id": string;
                    "category_id": string;
                    "created_at": string;
                    "due_day": number | null;
                    "id": string;
                    "items": NonNullable<Json>;
                    "name": string;
                    "position": number;
                    "user_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "amount_minor": number;
                    "balance_id": string;
                    "category_id": string;
                    "created_at"?: string;
                    "due_day"?: number | null;
                    "id"?: string;
                    "items"?: NonNullable<Json>;
                    "name": string;
                    "position"?: number;
                    "user_id"?: string;
                };
                Update: {
                    "amount_minor"?: number;
                    "balance_id"?: string;
                    "category_id"?: string;
                    "created_at"?: string;
                    "due_day"?: number | null;
                    "id"?: string;
                    "items"?: NonNullable<Json>;
                    "name"?: string;
                    "position"?: number;
                    "user_id"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "fixed_expenses_balance_id_owner";
                        columns: [
                            "balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balance_totals";
                        referencedColumns: [
                            "balance_id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "fixed_expenses_balance_id_owner";
                        columns: [
                            "balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balances";
                        referencedColumns: [
                            "id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "fixed_expenses_category_id_fkey";
                        columns: [
                            "category_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "categories";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "installments": {
                Row: {
                    "balance_id": string;
                    "category_id": string;
                    "created_at": string;
                    "currency": string;
                    "due_day": number | null;
                    "id": string;
                    "monthly_minor": number | null;
                    "name": string;
                    "paid_before_minor": number;
                    "position": number;
                    "total_minor": number;
                    "user_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "balance_id": string;
                    "category_id": string;
                    "created_at"?: string;
                    "currency": string;
                    "due_day"?: number | null;
                    "id"?: string;
                    "monthly_minor"?: number | null;
                    "name": string;
                    "paid_before_minor"?: number;
                    "position"?: number;
                    "total_minor": number;
                    "user_id"?: string;
                };
                Update: {
                    "balance_id"?: string;
                    "category_id"?: string;
                    "created_at"?: string;
                    "currency"?: string;
                    "due_day"?: number | null;
                    "id"?: string;
                    "monthly_minor"?: number | null;
                    "name"?: string;
                    "paid_before_minor"?: number;
                    "position"?: number;
                    "total_minor"?: number;
                    "user_id"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "installments_balance_id_owner";
                        columns: [
                            "balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balance_totals";
                        referencedColumns: [
                            "balance_id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "installments_balance_id_owner";
                        columns: [
                            "balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balances";
                        referencedColumns: [
                            "id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "installments_category_id_fkey";
                        columns: [
                            "category_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "categories";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "installments_user_id_currency_fkey";
                        columns: [
                            "user_id",
                            "currency"
                        ];
                        isOneToOne: false;
                        referencedRelation: "currencies";
                        referencedColumns: [
                            "user_id",
                            "code"
                        ];
                    }
                ];
            };
            "invoice_folders": {
                Row: {
                    "created_at": string;
                    "id": string;
                    "name": string;
                    "owner_id": string;
                    "updated_at": string;
                };
                ComputedFields: never;
                Insert: {
                    "created_at"?: string;
                    "id": string;
                    "name": string;
                    "owner_id"?: string;
                    "updated_at"?: string;
                };
                Update: {
                    "created_at"?: string;
                    "id"?: string;
                    "name"?: string;
                    "owner_id"?: string;
                    "updated_at"?: string;
                };
                Relationships: [
                ];
            };
            "invoice_item_tombstones": {
                Row: {
                    "created_at": string;
                    "created_by": string | null;
                    "currency": string;
                    "decimal_places": number;
                    "deleted_at": string;
                    "deleted_by": string | null;
                    "folder_id": string;
                    "id": string;
                    "name": string;
                    "price_minor": number;
                    "restoring_txid": number | null;
                    "updated_at": string;
                    "updated_by": string | null;
                };
                ComputedFields: never;
                Insert: {
                    "created_at": string;
                    "created_by"?: string | null;
                    "currency": string;
                    "decimal_places": number;
                    "deleted_at"?: string;
                    "deleted_by"?: string | null;
                    "folder_id": string;
                    "id": string;
                    "name": string;
                    "price_minor": number;
                    "restoring_txid"?: number | null;
                    "updated_at": string;
                    "updated_by"?: string | null;
                };
                Update: {
                    "created_at"?: string;
                    "created_by"?: string | null;
                    "currency"?: string;
                    "decimal_places"?: number;
                    "deleted_at"?: string;
                    "deleted_by"?: string | null;
                    "folder_id"?: string;
                    "id"?: string;
                    "name"?: string;
                    "price_minor"?: number;
                    "restoring_txid"?: number | null;
                    "updated_at"?: string;
                    "updated_by"?: string | null;
                };
                Relationships: [
                ];
            };
            "invoice_items": {
                Row: {
                    "created_at": string;
                    "created_by": string | null;
                    "currency": string;
                    "decimal_places": number;
                    "folder_id": string;
                    "id": string;
                    "name": string;
                    "price_minor": number;
                    "updated_at": string;
                    "updated_by": string | null;
                };
                ComputedFields: never;
                Insert: {
                    "created_at"?: string;
                    "created_by"?: string | null;
                    "currency": string;
                    "decimal_places": number;
                    "folder_id": string;
                    "id": string;
                    "name": string;
                    "price_minor": number;
                    "updated_at"?: string;
                    "updated_by"?: string | null;
                };
                Update: {
                    "created_at"?: string;
                    "created_by"?: string | null;
                    "currency"?: string;
                    "decimal_places"?: number;
                    "folder_id"?: string;
                    "id"?: string;
                    "name"?: string;
                    "price_minor"?: number;
                    "updated_at"?: string;
                    "updated_by"?: string | null;
                };
                Relationships: [
                    {
                        foreignKeyName: "invoice_items_folder_id_fkey";
                        columns: [
                            "folder_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "invoice_folders";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "invoice_links": {
                Row: {
                    "created_at": string;
                    "folder_id": string;
                    "token": string;
                };
                ComputedFields: never;
                Insert: {
                    "created_at"?: string;
                    "folder_id": string;
                    "token": string;
                };
                Update: {
                    "created_at"?: string;
                    "folder_id"?: string;
                    "token"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "invoice_links_folder_id_fkey";
                        columns: [
                            "folder_id"
                        ];
                        isOneToOne: true;
                        referencedRelation: "invoice_folders";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "invoice_members": {
                Row: {
                    "display_name": string | null;
                    "folder_id": string;
                    "joined_at": string;
                    "removed_at": string | null;
                    "user_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "display_name"?: string | null;
                    "folder_id": string;
                    "joined_at"?: string;
                    "removed_at"?: string | null;
                    "user_id": string;
                };
                Update: {
                    "display_name"?: string | null;
                    "folder_id"?: string;
                    "joined_at"?: string;
                    "removed_at"?: string | null;
                    "user_id"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "invoice_members_folder_id_fkey";
                        columns: [
                            "folder_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "invoice_folders";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "loan_deleted_requests": {
                Row: {
                    "request_id": string;
                    "request_kind": string;
                    "user_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "request_id": string;
                    "request_kind": string;
                    "user_id": string;
                };
                Update: {
                    "request_id"?: string;
                    "request_kind"?: string;
                    "user_id"?: string;
                };
                Relationships: [
                ];
            };
            "loans": {
                Row: {
                    "archived_at": string | null;
                    "balance_id": string;
                    "created_at": string;
                    "creation_mode": string;
                    "currency": string;
                    "deleted_at": string | null;
                    "direction": string;
                    "fee_bps": number;
                    "fee_category_id": string;
                    "fee_minor": number;
                    "fee_paid_before_minor": number;
                    "id": string;
                    "monthly_payment_minor": number | null;
                    "name": string;
                    "opened_on": string;
                    "payment_count": number | null;
                    "principal_minor": number;
                    "principal_paid_before_minor": number;
                    "request_id": string;
                    "request_payload": NonNullable<Json>;
                    "total_due_minor": number;
                    "user_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "archived_at"?: string | null;
                    "balance_id": string;
                    "created_at"?: string;
                    "creation_mode": string;
                    "currency": string;
                    "deleted_at"?: string | null;
                    "direction": string;
                    "fee_bps": number;
                    "fee_category_id": string;
                    "fee_minor": number;
                    "fee_paid_before_minor"?: number;
                    "id"?: string;
                    "monthly_payment_minor"?: number | null;
                    "name": string;
                    "opened_on": string;
                    "payment_count"?: number | null;
                    "principal_minor": number;
                    "principal_paid_before_minor"?: number;
                    "request_id": string;
                    "request_payload": NonNullable<Json>;
                    "total_due_minor": number;
                    "user_id"?: string;
                };
                Update: {
                    "archived_at"?: string | null;
                    "balance_id"?: string;
                    "created_at"?: string;
                    "creation_mode"?: string;
                    "currency"?: string;
                    "deleted_at"?: string | null;
                    "direction"?: string;
                    "fee_bps"?: number;
                    "fee_category_id"?: string;
                    "fee_minor"?: number;
                    "fee_paid_before_minor"?: number;
                    "id"?: string;
                    "monthly_payment_minor"?: number | null;
                    "name"?: string;
                    "opened_on"?: string;
                    "payment_count"?: number | null;
                    "principal_minor"?: number;
                    "principal_paid_before_minor"?: number;
                    "request_id"?: string;
                    "request_payload"?: NonNullable<Json>;
                    "total_due_minor"?: number;
                    "user_id"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "loans_balance_id_owner";
                        columns: [
                            "balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balance_totals";
                        referencedColumns: [
                            "balance_id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "loans_balance_id_owner";
                        columns: [
                            "balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balances";
                        referencedColumns: [
                            "id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "loans_fee_category_id_fkey";
                        columns: [
                            "fee_category_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "categories";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "loans_user_id_currency_fkey";
                        columns: [
                            "user_id",
                            "currency"
                        ];
                        isOneToOne: false;
                        referencedRelation: "currencies";
                        referencedColumns: [
                            "user_id",
                            "code"
                        ];
                    }
                ];
            };
            "pending_payments": {
                Row: {
                    "client": string;
                    "created_at": string;
                    "creation_payload": NonNullable<Json>;
                    "currency": string;
                    "deleted_at": string | null;
                    "due_on": string | null;
                    "id": string;
                    "project": string;
                    "revision": number;
                    "total_minor": number;
                    "user_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "client": string;
                    "created_at"?: string;
                    "creation_payload": NonNullable<Json>;
                    "currency": string;
                    "deleted_at"?: string | null;
                    "due_on"?: string | null;
                    "id": string;
                    "project": string;
                    "revision"?: number;
                    "total_minor": number;
                    "user_id"?: string;
                };
                Update: {
                    "client"?: string;
                    "created_at"?: string;
                    "creation_payload"?: NonNullable<Json>;
                    "currency"?: string;
                    "deleted_at"?: string | null;
                    "due_on"?: string | null;
                    "id"?: string;
                    "project"?: string;
                    "revision"?: number;
                    "total_minor"?: number;
                    "user_id"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "pending_payments_user_id_currency_fkey";
                        columns: [
                            "user_id",
                            "currency"
                        ];
                        isOneToOne: false;
                        referencedRelation: "currencies";
                        referencedColumns: [
                            "user_id",
                            "code"
                        ];
                    }
                ];
            };
            "profiles": {
                Row: {
                    "created_at": string;
                    "digits": string;
                    "locale": string;
                    "onboarded_at": string | null;
                    "salary_amount_minor": number | null;
                    "salary_email_enabled": boolean;
                    "salary_balance_id": string | null;
                    "theme": string;
                    "timezone": string;
                    "usd_lbp_rate": number | null;
                    "default_currency": string | null;
                    "user_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "created_at"?: string;
                    "digits"?: string;
                    "locale"?: string;
                    "onboarded_at"?: string | null;
                    "salary_amount_minor"?: number | null;
                    "salary_email_enabled"?: boolean;
                    "salary_balance_id"?: string | null;
                    "theme"?: string;
                    "timezone"?: string;
                    "usd_lbp_rate"?: number | null;
                    "default_currency"?: string | null;
                    "user_id": string;
                };
                Update: {
                    "created_at"?: string;
                    "digits"?: string;
                    "locale"?: string;
                    "onboarded_at"?: string | null;
                    "salary_amount_minor"?: number | null;
                    "salary_email_enabled"?: boolean;
                    "salary_balance_id"?: string | null;
                    "theme"?: string;
                    "timezone"?: string;
                    "usd_lbp_rate"?: number | null;
                    "default_currency"?: string | null;
                    "user_id"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "profiles_salary_balance_id_owner";
                        columns: [
                            "salary_balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balance_totals";
                        referencedColumns: [
                            "balance_id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "profiles_salary_balance_id_owner";
                        columns: [
                            "salary_balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balances";
                        referencedColumns: [
                            "id",
                            "user_id"
                        ];
                    }
                ];
            };
            "transactions": {
                Row: {
                    "amount_minor": number;
                    "balance_id": string;
                    "category_id": string | null;
                    "change_balance_id": string | null;
                    "change_balance_ids": (string)[];
                    "change_currency": string | null;
                    "change_minor": number | null;
                    "change_rate_base": string | null;
                    "change_rate_denominator": number | null;
                    "change_rate_numerator": number | null;
                    "change_rate_quote": string | null;
                    "cost_currency": string | null;
                    "created_at": string;
                    "currency": string;
                    "deleted_at": string | null;
                    "fixed_expense_id": string | null;
                    "id": string;
                    "installment_id": string | null;
                    "installment_override_of": string | null;
                    "kind": Database["public"]['Enums']["txn_kind"];
                    "loan_event": string | null;
                    "loan_event_seq": number | null;
                    "loan_fee_minor": number | null;
                    "loan_flow": string | null;
                    "loan_id": string | null;
                    "loan_payload": Json | null;
                    "loan_principal_minor": number | null;
                    "loan_request_id": string | null;
                    "note": string | null;
                    "occurred_on": string;
                    "pending_payment_id": string | null;
                    "pending_receipt_payload": Json | null;
                    "revision": number;
                    "salary_cycle_id": string | null;
                    "source": string | null;
                    "tender_minor": number | null;
                    "to_amount_minor": number | null;
                    "to_balance_id": string | null;
                    "to_wallet_name_snapshot": string | null;
                    "updated_at": string;
                    "user_id": string;
                    "wallet_name_snapshot": string | null;
                    "cashier_snapshot": Json | null;
                };
                ComputedFields: "cashier_snapshot";
                Insert: {
                    "amount_minor": number;
                    "balance_id": string;
                    "category_id"?: string | null;
                    "change_balance_id"?: string | null;
                    "change_balance_ids"?: (string)[];
                    "change_currency"?: string | null;
                    "change_minor"?: number | null;
                    "change_rate_base"?: string | null;
                    "change_rate_denominator"?: number | null;
                    "change_rate_numerator"?: number | null;
                    "change_rate_quote"?: string | null;
                    "cost_currency"?: string | null;
                    "created_at"?: string;
                    "currency": string;
                    "deleted_at"?: string | null;
                    "fixed_expense_id"?: string | null;
                    "id"?: string;
                    "installment_id"?: string | null;
                    "installment_override_of"?: string | null;
                    "kind": Database["public"]['Enums']["txn_kind"];
                    "loan_event"?: string | null;
                    "loan_event_seq"?: number | null;
                    "loan_fee_minor"?: number | null;
                    "loan_flow"?: string | null;
                    "loan_id"?: string | null;
                    "loan_payload"?: Json | null;
                    "loan_principal_minor"?: number | null;
                    "loan_request_id"?: string | null;
                    "note"?: string | null;
                    "occurred_on": string;
                    "pending_payment_id"?: string | null;
                    "pending_receipt_payload"?: Json | null;
                    "revision"?: number;
                    "salary_cycle_id"?: string | null;
                    "source"?: string | null;
                    "tender_minor"?: number | null;
                    "to_amount_minor"?: number | null;
                    "to_balance_id"?: string | null;
                    "to_wallet_name_snapshot"?: string | null;
                    "updated_at"?: string;
                    "user_id"?: string;
                    "wallet_name_snapshot"?: string | null;
                };
                Update: {
                    "amount_minor"?: number;
                    "balance_id"?: string;
                    "category_id"?: string | null;
                    "change_balance_id"?: string | null;
                    "change_balance_ids"?: (string)[];
                    "change_currency"?: string | null;
                    "change_minor"?: number | null;
                    "change_rate_base"?: string | null;
                    "change_rate_denominator"?: number | null;
                    "change_rate_numerator"?: number | null;
                    "change_rate_quote"?: string | null;
                    "cost_currency"?: string | null;
                    "created_at"?: string;
                    "currency"?: string;
                    "deleted_at"?: string | null;
                    "fixed_expense_id"?: string | null;
                    "id"?: string;
                    "installment_id"?: string | null;
                    "installment_override_of"?: string | null;
                    "kind"?: Database["public"]['Enums']["txn_kind"];
                    "loan_event"?: string | null;
                    "loan_event_seq"?: number | null;
                    "loan_fee_minor"?: number | null;
                    "loan_flow"?: string | null;
                    "loan_id"?: string | null;
                    "loan_payload"?: Json | null;
                    "loan_principal_minor"?: number | null;
                    "loan_request_id"?: string | null;
                    "note"?: string | null;
                    "occurred_on"?: string;
                    "pending_payment_id"?: string | null;
                    "pending_receipt_payload"?: Json | null;
                    "revision"?: number;
                    "salary_cycle_id"?: string | null;
                    "source"?: string | null;
                    "tender_minor"?: number | null;
                    "to_amount_minor"?: number | null;
                    "to_balance_id"?: string | null;
                    "to_wallet_name_snapshot"?: string | null;
                    "updated_at"?: string;
                    "user_id"?: string;
                    "wallet_name_snapshot"?: string | null;
                };
                Relationships: [
                    {
                        foreignKeyName: "pending_receipt_owner";
                        columns: [
                            "pending_payment_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "pending_payment_progress";
                        referencedColumns: [
                            "id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "pending_receipt_owner";
                        columns: [
                            "pending_payment_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "pending_payments";
                        referencedColumns: [
                            "id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_balance_id_owner";
                        columns: [
                            "balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balance_totals";
                        referencedColumns: [
                            "balance_id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_balance_id_owner";
                        columns: [
                            "balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balances";
                        referencedColumns: [
                            "id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_category_id_fkey";
                        columns: [
                            "category_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "categories";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_change_balance_id_owner";
                        columns: [
                            "change_balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balance_totals";
                        referencedColumns: [
                            "balance_id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_change_balance_id_owner";
                        columns: [
                            "change_balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balances";
                        referencedColumns: [
                            "id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_fixed_expense_id_fkey";
                        columns: [
                            "fixed_expense_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "fixed_expenses";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_installment_id_fkey";
                        columns: [
                            "installment_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "installment_progress";
                        referencedColumns: [
                            "installment_id"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_installment_id_fkey";
                        columns: [
                            "installment_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "installments";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_installment_override_of_fkey";
                        columns: [
                            "installment_override_of"
                        ];
                        isOneToOne: false;
                        referencedRelation: "loan_overview";
                        referencedColumns: [
                            "latest_payment_id"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_installment_override_of_fkey";
                        columns: [
                            "installment_override_of"
                        ];
                        isOneToOne: false;
                        referencedRelation: "transactions";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_loan_id_fkey";
                        columns: [
                            "loan_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "loan_overview";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_loan_id_fkey";
                        columns: [
                            "loan_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "loan_progress";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_loan_id_fkey";
                        columns: [
                            "loan_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "loans";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_salary_cycle_id_fkey";
                        columns: [
                            "salary_cycle_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "loan_overview";
                        referencedColumns: [
                            "latest_payment_id"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_salary_cycle_id_fkey";
                        columns: [
                            "salary_cycle_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "transactions";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_to_balance_id_owner";
                        columns: [
                            "to_balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balance_totals";
                        referencedColumns: [
                            "balance_id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_to_balance_id_owner";
                        columns: [
                            "to_balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balances";
                        referencedColumns: [
                            "id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_user_id_change_currency_fkey";
                        columns: [
                            "user_id",
                            "change_currency"
                        ];
                        isOneToOne: false;
                        referencedRelation: "currencies";
                        referencedColumns: [
                            "user_id",
                            "code"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_user_id_change_rate_base_fkey";
                        columns: [
                            "user_id",
                            "change_rate_base"
                        ];
                        isOneToOne: false;
                        referencedRelation: "currencies";
                        referencedColumns: [
                            "user_id",
                            "code"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_user_id_change_rate_quote_fkey";
                        columns: [
                            "user_id",
                            "change_rate_quote"
                        ];
                        isOneToOne: false;
                        referencedRelation: "currencies";
                        referencedColumns: [
                            "user_id",
                            "code"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_user_id_cost_currency_fkey";
                        columns: [
                            "user_id",
                            "cost_currency"
                        ];
                        isOneToOne: false;
                        referencedRelation: "currencies";
                        referencedColumns: [
                            "user_id",
                            "code"
                        ];
                    },
                    {
                        foreignKeyName: "transactions_user_id_currency_fkey";
                        columns: [
                            "user_id",
                            "currency"
                        ];
                        isOneToOne: false;
                        referencedRelation: "currencies";
                        referencedColumns: [
                            "user_id",
                            "code"
                        ];
                    }
                ];
            };
            "wallet_balances": {
                Row: {
                    "created_at": string;
                    "currency": string;
                    "detached_at": string | null;
                    "id": string;
                    "opening_balance_minor": number;
                    "position": number;
                    "user_id": string;
                    "wallet_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "created_at"?: string;
                    "currency": string;
                    "detached_at"?: string | null;
                    "id"?: string;
                    "opening_balance_minor"?: number;
                    "position": number;
                    "user_id"?: string;
                    "wallet_id": string;
                };
                Update: {
                    "created_at"?: string;
                    "currency"?: string;
                    "detached_at"?: string | null;
                    "id"?: string;
                    "opening_balance_minor"?: number;
                    "position"?: number;
                    "user_id"?: string;
                    "wallet_id"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "wallet_balances_user_id_currency_fkey";
                        columns: [
                            "user_id",
                            "currency"
                        ];
                        isOneToOne: false;
                        referencedRelation: "currencies";
                        referencedColumns: [
                            "user_id",
                            "code"
                        ];
                    },
                    {
                        foreignKeyName: "wallet_balances_wallet_id_user_id_fkey";
                        columns: [
                            "wallet_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallets";
                        referencedColumns: [
                            "id",
                            "user_id"
                        ];
                    }
                ];
            };
            "wallets": {
                Row: {
                    "created_at": string;
                    "default_balance_id": string | null;
                    "deleted_at": string | null;
                    "id": string;
                    "kind": Database["public"]['Enums']["wallet_kind"];
                    "name": string;
                    "needs_attention": boolean;
                    "position": number;
                    "user_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "created_at"?: string;
                    "default_balance_id"?: string | null;
                    "deleted_at"?: string | null;
                    "id"?: string;
                    "kind": Database["public"]['Enums']["wallet_kind"];
                    "name": string;
                    "needs_attention"?: boolean;
                    "position"?: number;
                    "user_id"?: string;
                };
                Update: {
                    "created_at"?: string;
                    "default_balance_id"?: string | null;
                    "deleted_at"?: string | null;
                    "id"?: string;
                    "kind"?: Database["public"]['Enums']["wallet_kind"];
                    "name"?: string;
                    "needs_attention"?: boolean;
                    "position"?: number;
                    "user_id"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "wallet_default_owner";
                        columns: [
                            "default_balance_id",
                            "id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balance_totals";
                        referencedColumns: [
                            "balance_id",
                            "wallet_id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "wallet_default_owner";
                        columns: [
                            "default_balance_id",
                            "id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balances";
                        referencedColumns: [
                            "id",
                            "wallet_id",
                            "user_id"
                        ];
                    }
                ];
            };
        };
        Views: {
            "installment_progress": {
                Row: {
                    "installment_id": string;
                    "last_paid_on": string | null;
                    "paid_minor": number | null;
                    "payment_count": number | null;
                    "remaining_minor": number | null;
                    "user_id": string;
                };
                ComputedFields: never;
                Relationships: [
                ];
            };
            "loan_overview": {
                Row: {
                    "archived_at": string | null;
                    "balance_id": string;
                    "created_at": string;
                    "creation_mode": string;
                    "currency": string;
                    "deleted_at": string | null;
                    "direction": string;
                    "fee_bps": number;
                    "fee_category_id": string;
                    "fee_minor": number;
                    "fee_paid_before_minor": number;
                    "fee_paid_minor": number | null;
                    "fee_remaining_minor": number | null;
                    "id": string;
                    "latest_payment_id": string | null;
                    "latest_payment_on": string | null;
                    "latest_payment_revision": number | null;
                    "latest_payment_sequence": number | null;
                    "live_payment_count": number | null;
                    "monthly_payment_minor": number | null;
                    "name": string;
                    "opened_on": string;
                    "payment_count": number | null;
                    "principal_minor": number;
                    "principal_paid_before_minor": number;
                    "principal_paid_minor": number | null;
                    "principal_remaining_minor": number | null;
                    "remaining_minor": number | null;
                    "request_id": string;
                    "request_payload": NonNullable<Json>;
                    "total_due_minor": number;
                    "user_id": string;
                };
                ComputedFields: never;
                Relationships: [
                    {
                        foreignKeyName: "loans_balance_id_owner";
                        columns: [
                            "balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balance_totals";
                        referencedColumns: [
                            "balance_id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "loans_balance_id_owner";
                        columns: [
                            "balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balances";
                        referencedColumns: [
                            "id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "loans_fee_category_id_fkey";
                        columns: [
                            "fee_category_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "categories";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "loans_user_id_currency_fkey";
                        columns: [
                            "user_id",
                            "currency"
                        ];
                        isOneToOne: false;
                        referencedRelation: "currencies";
                        referencedColumns: [
                            "user_id",
                            "code"
                        ];
                    }
                ];
            };
            "loan_progress": {
                Row: {
                    "archived_at": string | null;
                    "balance_id": string;
                    "created_at": string;
                    "creation_mode": string;
                    "currency": string;
                    "deleted_at": string | null;
                    "direction": string;
                    "fee_bps": number;
                    "fee_category_id": string;
                    "fee_minor": number;
                    "fee_paid_before_minor": number;
                    "fee_paid_minor": number | null;
                    "fee_remaining_minor": number | null;
                    "id": string;
                    "monthly_payment_minor": number | null;
                    "name": string;
                    "opened_on": string;
                    "payment_count": number | null;
                    "principal_minor": number;
                    "principal_paid_before_minor": number;
                    "principal_paid_minor": number | null;
                    "principal_remaining_minor": number | null;
                    "remaining_minor": number | null;
                    "request_id": string;
                    "request_payload": NonNullable<Json>;
                    "total_due_minor": number;
                    "user_id": string;
                };
                ComputedFields: never;
                Relationships: [
                    {
                        foreignKeyName: "loans_balance_id_owner";
                        columns: [
                            "balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balance_totals";
                        referencedColumns: [
                            "balance_id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "loans_balance_id_owner";
                        columns: [
                            "balance_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallet_balances";
                        referencedColumns: [
                            "id",
                            "user_id"
                        ];
                    },
                    {
                        foreignKeyName: "loans_fee_category_id_fkey";
                        columns: [
                            "fee_category_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "categories";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "loans_user_id_currency_fkey";
                        columns: [
                            "user_id",
                            "currency"
                        ];
                        isOneToOne: false;
                        referencedRelation: "currencies";
                        referencedColumns: [
                            "user_id",
                            "code"
                        ];
                    }
                ];
            };
            "pending_payment_progress": {
                Row: {
                    "client": string;
                    "created_at": string;
                    "creation_payload": NonNullable<Json>;
                    "currency": string;
                    "deleted_at": string | null;
                    "due_on": string | null;
                    "has_receipt_history": boolean | null;
                    "id": string;
                    "project": string;
                    "received_minor": number | null;
                    "remaining_minor": number | null;
                    "revision": number;
                    "total_minor": number;
                    "user_id": string;
                };
                ComputedFields: never;
                Relationships: [
                    {
                        foreignKeyName: "pending_payments_user_id_currency_fkey";
                        columns: [
                            "user_id",
                            "currency"
                        ];
                        isOneToOne: false;
                        referencedRelation: "currencies";
                        referencedColumns: [
                            "user_id",
                            "code"
                        ];
                    }
                ];
            };
            "reporting_entries": {
                Row: {
                    "amount_minor": number | null;
                    "category_id": string | null;
                    "currency": string | null;
                    "kind": string | null;
                    "occurred_on": string | null;
                    "transaction_id": string | null;
                    "user_id": string | null;
                };
                ComputedFields: never;
                Relationships: [
                ];
            };
            "wallet_balance_totals": {
                Row: {
                    "balance_id": string;
                    "balance_minor": number | null;
                    "currency": string;
                    "user_id": string;
                    "wallet_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "balance_id"?: string | null;
                    "balance_minor"?: never;
                    "currency"?: string | null;
                    "user_id"?: string | null;
                    "wallet_id"?: string | null;
                };
                Update: {
                    "balance_id"?: string | null;
                    "balance_minor"?: never;
                    "currency"?: string | null;
                    "user_id"?: string | null;
                    "wallet_id"?: string | null;
                };
                Relationships: [
                    {
                        foreignKeyName: "wallet_balances_user_id_currency_fkey";
                        columns: [
                            "user_id",
                            "currency"
                        ];
                        isOneToOne: false;
                        referencedRelation: "currencies";
                        referencedColumns: [
                            "user_id",
                            "code"
                        ];
                    },
                    {
                        foreignKeyName: "wallet_balances_wallet_id_user_id_fkey";
                        columns: [
                            "wallet_id",
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "wallets";
                        referencedColumns: [
                            "id",
                            "user_id"
                        ];
                    }
                ];
            };
        };
        Functions: {
            "add_wallet_balance": {
                Args: {
                    "p_currency": string;
                    "p_wallet_id": string;
                };
                Returns: string;
            };
            "cancel_loan": {
                Args: {
                    "p_id": string;
                };
                Returns: undefined;
            };
            "cashier_convert_minor": {
                Args: {
                    "p_base": string;
                    "p_d": number;
                    "p_from": string;
                    "p_minor": number;
                    "p_n": number;
                    "p_quote": string;
                    "p_to": string;
                };
                Returns: number;
            };
            "cashier_snapshot": {
                Args: {
                    "p": Omit<Database["public"]['Tables']["transactions"]['Row'], Database["public"]['Tables']["transactions"]['ComputedFields']>;
                };
                Returns: Json;
            };
            "category_name_key": {
                Args: {
                    "p_name": string;
                };
                Returns: string;
            };
            "category_normalize_name": {
                Args: {
                    "p_name": string;
                };
                Returns: string;
            };
            "create_currency": {
                Args: {
                    "p_code": string;
                    "p_decimal_places": number;
                    "p_symbol": string;
                };
                Returns: undefined;
            };
            "create_loan": {
                Args: {
                    "p_input": Json;
                };
                Returns: {
                    "id": string;
                }[];
            };
            "create_pending_payment": {
                Args: {
                    "p_input": Json;
                };
                Returns: {
                    "id": string;
                }[];
            };
            "create_wallet": {
                Args: {
                    "p_default_currency": string;
                    "p_kind": Database["public"]['Enums']["wallet_kind"];
                    "p_name": string;
                    "p_opening_minor"?: number;
                };
                Returns: string;
            };
            "delete_currency": {
                Args: {
                    "p_code": string;
                };
                Returns: undefined;
            };
            "delete_installment": {
                Args: {
                    "p_installment_id": string;
                };
                Returns: undefined;
            };
            "delete_loan": {
                Args: {
                    "p_id": string;
                };
                Returns: undefined;
            };
            "delete_loan_payment": {
                Args: {
                    "p_expected_revision": number;
                    "p_transaction_id": string;
                };
                Returns: undefined;
            };
            "delete_wallet": {
                Args: {
                    "p_id": string;
                };
                Returns: undefined;
            };
            "detach_wallet_balance": {
                Args: {
                    "p_balance_id": string;
                };
                Returns: undefined;
            };
            "disable_invoice_link": {
                Args: {
                    "p_folder": string;
                };
                Returns: undefined;
            };
            "installment_cycle_snapshot": {
                Args: Record<PropertyKey, never>;
                Returns: Json;
            };
            "installment_cycle_summary": {
                Args: Record<PropertyKey, never>;
                Returns: Json;
            };
            "invoice_item_restorable": {
                Args: {
                    "p_deleted_at": string;
                };
                Returns: boolean;
            };
            "invoice_link_preview": {
                Args: {
                    "p_token": string;
                };
                Returns: string;
            };
            "is_invoice_member": {
                Args: {
                    "folder": string;
                };
                Returns: boolean;
            };
            "is_invoice_owner": {
                Args: {
                    "folder": string;
                };
                Returns: boolean;
            };
            "join_invoice_folder": {
                Args: {
                    "p_name": string;
                    "p_token": string;
                };
                Returns: string;
            };
            "leave_invoice_folder": {
                Args: {
                    "p_folder": string;
                };
                Returns: undefined;
            };
            "loan_today": {
                Args: Record<PropertyKey, never>;
                Returns: string;
            };
            "loan_validate_input": {
                Args: {
                    "p_input": Json;
                    "p_numbers": (string)[];
                    "p_strings": (string)[];
                };
                Returns: undefined;
            };
            "loan_validate_plan_input": {
                Args: {
                    "p_input": Json;
                };
                Returns: undefined;
            };
            "month_budgets": {
                Args: {
                    "p_month": string;
                };
                Returns: {
                    "category_id": string;
                    "currency": string;
                    "limit_minor": number;
                    "starts_month": string;
                }[];
            };
            "set_transaction_date": {
                Args: {
                    "p_id": string;
                    "p_expected_revision": number;
                    "p_date": string;
                };
                Returns: {
                    "id": string;
                    "revision": number;
                }[];
            };
            "category_spend_between": {
                Args: {
                    "p_from": string;
                    "p_to": string | null;
                };
                Returns: {
                    "category_id": string;
                    "currency": string;
                    "spent_minor": number;
                }[];
            };
            "month_category_spend": {
                Args: {
                    "p_month": string;
                };
                Returns: {
                    "category_id": string;
                    "currency": string;
                    "spent_minor": number;
                }[];
            };
            "pay_fixed_expense": {
                Args: {
                    "p_id": string;
                };
                Returns: {
                    "id": string;
                    "revision": number;
                }[];
            };
            "receive_salary": {
                Args: {
                    "p_expected_cycle_id": string;
                    "p_request_id": string;
                };
                Returns: {
                    "id": string;
                    "revision": number;
                }[];
            };
            "record_balance_transfer": {
                Args: {
                    "p_from_amount_minor": number;
                    "p_from_balance_id": string;
                    "p_note"?: string;
                    "p_occurred_on": string;
                    "p_to_amount_minor": number;
                    "p_to_balance_id": string;
                    "p_usd_lbp_rate"?: number;
                };
                Returns: {
                    "id": string;
                    "revision": number;
                }[];
            };
            "record_installment_payment": {
                Args: {
                    "p_amount_minor": number;
                    "p_balance_id": string;
                    "p_installment_id": string;
                    "p_occurred_on": string;
                    "p_override_of_transaction_id": string;
                    "p_request_id": string;
                    "p_salary_cycle_id": string;
                };
                Returns: {
                    "id": string;
                    "revision": number;
                }[];
            };
            "record_loan_payment": {
                Args: {
                    "p_input": Json;
                };
                Returns: {
                    "id": string;
                    "revision": number;
                }[];
            };
            "record_pending_receipt": {
                Args: {
                    "p_input": Json;
                };
                Returns: {
                    "id": string;
                }[];
            };
            "record_transfer": {
                Args: {
                    "p_from_amount_minor": number;
                    "p_from_balance_id": string;
                    "p_note"?: string;
                    "p_occurred_on": string;
                    "p_to_amount_minor": number;
                    "p_to_balance_id": string;
                    "p_usd_lbp_rate"?: number;
                };
                Returns: {
                    "id": string;
                    "revision": number;
                }[];
            };
            "remove_category": {
                Args: {
                    "p_id": string;
                };
                Returns: string;
            };
            "remove_invoice_member": {
                Args: {
                    "p_folder": string;
                    "p_user": string;
                };
                Returns: undefined;
            };
            "reorder_categories": {
                Args: {
                    "p_ids": (string)[];
                    "p_kind": Database["public"]['Enums']["category_kind"];
                };
                Returns: undefined;
            };
            "reorder_wallets": {
                Args: {
                    "p_ids": (string)[];
                };
                Returns: undefined;
            };
            "restore_invoice_item": {
                Args: {
                    "p_item": string;
                };
                Returns: undefined;
            };
            "restore_loan_payment": {
                Args: {
                    "p_expected_revision": number;
                    "p_transaction_id": string;
                };
                Returns: {
                    "id": string;
                    "revision": number;
                }[];
            };
            "retire_loan_request": {
                Args: {
                    "p_kind": string;
                    "p_request_id": string;
                    "p_user_id": string;
                };
                Returns: undefined;
            };
            "rotate_invoice_link": {
                Args: {
                    "p_folder": string;
                    "p_owner_name": string;
                };
                Returns: string;
            };
            "save_transaction": {
                Args: {
                    "p_expected_revision": number;
                    "p_id": string;
                    "p_input": Json;
                    "p_items": Json;
                    "p_settlement"?: Json;
                };
                Returns: {
                    "id": string;
                    "revision": number;
                }[];
            };
            "set_currency_disabled": {
                Args: {
                    "p_code": string;
                    "p_disabled": boolean;
                };
                Returns: undefined;
            };
            "set_loan_archived": {
                Args: {
                    "p_archived": boolean;
                    "p_id": string;
                };
                Returns: undefined;
            };
            "set_transaction_deleted": {
                Args: {
                    "p_deleted": boolean;
                    "p_expected_revision": number;
                    "p_id": string;
                };
                Returns: {
                    "id": string;
                    "revision": number;
                }[];
            };
            "set_wallet_default": {
                Args: {
                    "p_balance_id": string;
                    "p_wallet_id": string;
                };
                Returns: undefined;
            };
            "settle_and_delete_wallet": {
                Args: {
                    "p_request_id": string;
                    "p_settlements": Json;
                    "p_wallet_id": string;
                };
                Returns: undefined;
            };
            "update_currency": {
                Args: {
                    "p_code": string;
                    "p_current_code": string;
                    "p_decimal_places": number;
                    "p_symbol": string;
                };
                Returns: undefined;
            };
            "update_loan": {
                Args: {
                    "p_id": string;
                    "p_input": Json;
                };
                Returns: undefined;
            };
            "update_pending_payment": {
                Args: {
                    "p_delete"?: boolean;
                    "p_id": string;
                    "p_input": Json;
                    "p_revision": number;
                };
                Returns: undefined;
            };
            "upgrade_default_category_icons": {
                Args: Record<PropertyKey, never>;
                Returns: undefined;
            };
            "void_loan_payment": {
                Args: {
                    "p_expected_revision": number;
                    "p_transaction_id": string;
                };
                Returns: {
                    "id": string;
                    "revision": number;
                }[];
            };
        };
        Enums: {
            "category_kind": "expense" | "income";
            "txn_kind": "expense" | "income" | "transfer" | "loan";
            "wallet_kind": "cash" | "bank" | "card";
        };
        CompositeTypes: {
            [_ in never]: never;
        };
    };
};
type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];
export type Tables<DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | {
    schema: keyof DatabaseWithoutInternals;
}, TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"]) : never = never> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
    Row: infer R;
} ? R : never : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
    Row: infer R;
} ? R : never : never;
export type TablesInsert<DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | {
    schema: keyof DatabaseWithoutInternals;
}, TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] : never = never> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Insert: infer I;
} ? I : never : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Insert: infer I;
} ? I : never : never;
export type TablesUpdate<DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | {
    schema: keyof DatabaseWithoutInternals;
}, TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] : never = never> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Update: infer U;
} ? U : never : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Update: infer U;
} ? U : never : never;
export type Enums<DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | {
    schema: keyof DatabaseWithoutInternals;
}, EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"] : never = never> = DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName] : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions] : never;
export type CompositeTypes<PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"] | {
    schema: keyof DatabaseWithoutInternals;
}, CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"] : never = never> = PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName] : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"] ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions] : never;
export const Constants = {
    "graphql_public": {
        Enums: {}
    }, "public": {
        Enums: {
            "category_kind": ["expense", "income"], "txn_kind": ["expense", "income", "transfer", "loan"], "wallet_kind": ["cash", "bank", "card"]
        }
    }
} as const;

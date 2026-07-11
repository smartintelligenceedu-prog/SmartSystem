// Hand-written types matching database/schema.sql for the tables this flow
// touches. Once the schema stabilizes, swap these for `supabase gen types
// typescript` output — not worth the generated-types pipeline yet for one flow.

export interface RegistrationKit {
  id: string;
  name: string;
  price: number;
  voucher_self_use_count: number;
  voucher_resale_count: number;
  includes_business_card: boolean;
  is_active: boolean;
}

export type AnalystStatus = "pending" | "approved" | "suspended" | "rejected" | "terminated";

export interface RegistrationResult {
  order_id: string;
  registration_order_id: string;
  analyst_id: string;
  kit_name: string;
  price: number;
  sponsor_name: string | null;
}

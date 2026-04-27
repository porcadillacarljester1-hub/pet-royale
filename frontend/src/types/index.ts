import type { Tables, TablesInsert, TablesUpdate, Enums } from "@/integrations/supabase/types";

// Row types (from DB)
export type Client = Tables<"clients">;
export type Pet = Tables<"pets">;
export type Appointment = Tables<"appointments">;
export type AppointmentHistory = Tables<"appointment_history">;

/** * MANUALLY OVERRIDING INVENTORY TYPE 
 * This ensures the frontend matches the SQL exactly: name, category, stock, image_key
 */
export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  stock: number;
  image_key: string;
  created_at?: string;
}

// Insert types
export type ClientInsert = TablesInsert<"clients">;
export type PetInsert = TablesInsert<"pets">;
export type InventoryInsert = Omit<InventoryItem, 'id' | 'created_at'>; // Safety Omit
export type AppointmentInsert = TablesInsert<"appointments">;
export type AppointmentHistoryInsert = TablesInsert<"appointment_history">;

// Update types
export type ClientUpdate = TablesUpdate<"clients">;
export type InventoryUpdate = Partial<InventoryInsert>;
export type AppointmentUpdate = TablesUpdate<"appointments">;

// Enum types
export type AppointmentStatus = Enums<"appointment_status">;

// Client with pets (joined)
export interface ClientWithPets extends Client {
  pets: Pet[];
}
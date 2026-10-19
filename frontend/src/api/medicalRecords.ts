import { supabase } from "@/integrations/supabase/client";

/* One medical record per pet, laid out like the clinic's paper form.
   The paper form has 4 "Date & Time" columns for the physical exam and the
   lab results, so each of those is an array of 4 columns. */
export const EXAM_COLUMNS = 4;

export type OwnerInfo = {
  name: string;
  address: string;
  contact: string;
  email: string;
};

export type PatientInfo = {
  name: string;
  species: string;
  breed: string;
  age_dob: string;
  sex: string;
  neutered_spayed: string;
  multivalent_vaccines: string;
  anti_rabies_vaccine: string;
  deworming_tick_flea_mites: string;
};

/* One "Date & Time" column. Keys match the row keys in PatientRecordDialog. */
export type ExamColumn = { date_time: string } & Record<string, string>;

export type MonitoringRow = {
  date_time: string;
  temp_weight: string;
  diagnosis: string;
  observations: string;
  medications_procedure: string;
  dosage_frequency: string;
  remarks: string;
};

export type MedicalRecord = {
  pet_id: string;
  owner_info: OwnerInfo;
  patient_info: PatientInfo;
  physical_exam: ExamColumn[];
  lab: ExamColumn[];
  monitoring: MonitoringRow[];
  updated_at?: string | null;
};

export const emptyMonitoringRow = (): MonitoringRow => ({
  date_time: "", temp_weight: "", diagnosis: "", observations: "",
  medications_procedure: "", dosage_frequency: "", remarks: "",
});

const emptyColumns = (): ExamColumn[] =>
  Array.from({ length: EXAM_COLUMNS }, () => ({ date_time: "" }));

/* Pads saved columns to 4, so an older or partly filled record still shows
   every column of the paper form. */
const padColumns = (cols?: ExamColumn[] | null): ExamColumn[] =>
  emptyColumns().map((empty, i) => ({ ...empty, ...(cols?.[i] ?? {}) }));

/* A new record starts from what the system already knows about the owner
   and pet, so staff only fill in what is missing. */
export function buildRecord(pet: any, saved?: Partial<MedicalRecord> | null): MedicalRecord {
  const owner = pet?.owner ?? {};
  return {
    pet_id: pet.id,
    owner_info: {
      name: owner.name ?? "",
      address: owner.address ?? "",
      contact: owner.phone ?? "",
      email: owner.email ?? "",
      ...(saved?.owner_info ?? {}),
    },
    patient_info: {
      name: pet.name ?? "",
      species: pet.species ?? "",
      breed: pet.breed ?? "",
      age_dob: pet.birthdate ?? (pet.age != null ? `${pet.age} yrs` : ""),
      sex: pet.gender ?? "",
      neutered_spayed: "",
      multivalent_vaccines: "",
      anti_rabies_vaccine: "",
      deworming_tick_flea_mites: "",
      ...(saved?.patient_info ?? {}),
    },
    physical_exam: padColumns(saved?.physical_exam),
    lab: padColumns(saved?.lab),
    monitoring: saved?.monitoring?.length ? saved.monitoring : [emptyMonitoringRow()],
    updated_at: saved?.updated_at ?? null,
  };
}

export async function fetchMedicalRecord(petId: string): Promise<MedicalRecord | null> {
  const { data, error } = await (supabase as any)
    .from("medical_records")
    .select("pet_id, owner_info, patient_info, physical_exam, lab, monitoring, updated_at")
    .eq("pet_id", petId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

const hasText = (row: Record<string, string>) =>
  Object.values(row).some((v) => String(v ?? "").trim() !== "");

export async function saveMedicalRecord(record: MedicalRecord): Promise<MedicalRecord> {
  const { updated_at: _ignored, ...rest } = record;
  const payload = {
    ...rest,
    // Empty monitoring rows are not worth storing.
    monitoring: record.monitoring.filter(hasText),
  };
  const { data, error } = await (supabase as any)
    .from("medical_records")
    .upsert(payload, { onConflict: "pet_id" })
    .select("pet_id, owner_info, patient_info, physical_exam, lab, monitoring, updated_at")
    .single();
  if (error) throw error;
  return data;
}

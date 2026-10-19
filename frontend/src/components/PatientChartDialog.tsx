import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  X, ArrowLeft, Loader2, Plus, Upload, FileText,
} from "lucide-react";

/* ───────────────────────── Setup ─────────────────────────
   Table: public.medical_records, one row per pet. Examinations are kept in
   the `examinations` jsonb column. Run medical_records_examinations.sql once.
   Images use the private bucket created by medical_records_images.sql.
   The "Come back on" date needs medical_records_follow_up.sql.              */
const IMAGE_BUCKET = "medical-images";
const MAX_IMAGE_MB = 15;
const FILE_TYPES = [
  "image/jpeg", "image/png", "application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const isImageName = (name: string) => /\.(jpe?g|png)$/i.test(name);
const fileExt = (file: File) => {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return /^[a-z0-9]{1,6}$/.test(ext) ? ext : "bin";
};
const IMAGE_KINDS = ["X-ray", "CT scan", "Ultrasound", "Urinalysis", "Lab report", "Other"];
const CONDITIONS = ["Excellent", "Good", "Fair", "Poor", "Critical"];
const CHECKS = 4;

/* Character limits. Free-text clinical fields take 5,000; short notes 500;
   short entries 200. Dates and numbers are not free text. */
const LONG = 5000;
const MID = 500;
const SHORT = 200;

/* ── Shared look with the Pets and Owners screens ── */
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]";
const CARD = "rounded-[12px] border border-[hsl(var(--border))] bg-white";
const CTRL =
  "w-full min-w-0 rounded-[9px] border border-[hsl(var(--input))] bg-white px-3 text-[14px] transition hover:border-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary))] focus:outline-none";
const INPUT = `${CTRL} h-10`;
const TEXTAREA = `${CTRL} h-[88px] resize-none py-2 leading-snug`;
const BAD = "!border-[hsl(var(--destructive))] ring-2 ring-[hsl(var(--destructive)/.2)]";
const BTN =
  `inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] bg-white px-4 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:cursor-default disabled:opacity-40 ${FOCUS_RING}`;
const BTN_PRIMARY =
  `inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-[hsl(var(--primary))] px-5 text-[14px] font-bold text-[hsl(var(--primary-foreground))] transition hover:opacity-90 disabled:cursor-default disabled:opacity-50 ${FOCUS_RING}`;
const BTN_ADD =
  `inline-flex h-10 items-center gap-2 rounded-[10px] border-[1.5px] border-dashed border-[hsl(var(--primary))] px-4 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`;
const TAB = (active: boolean) =>
  `inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-[9px] px-[18px] text-[14px] font-semibold transition ${FOCUS_RING} ${
    active
      ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
      : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
  }`;

/* ── Form content, in the order of the clinic's paper form ── */
type Group = "exam" | "lab" | "mon";
type RowType = "text" | "num" | "select";
type Row = {
  key: string; label: string; hint?: string; type: RowType; limit?: number;
  min?: number; max?: number; step?: number; options?: string[]; placeholder?: string;
};

const EXAM_ROWS: Row[] = [
  { key: "history", label: "Clinical history", type: "text", limit: LONG },
  { key: "temp", label: "Rectal temperature", hint: "°C", type: "num", min: 25, max: 45, step: 0.1 },
  { key: "weight", label: "Weight", hint: "kg", type: "num", min: 0.1, max: 200, step: 0.01 },
  { key: "behavior", label: "Behavior", type: "text", limit: MID },
  { key: "condition", label: "General condition", type: "select", options: CONDITIONS },
  { key: "integument", label: "Integument", hint: "External parasites, wounds, laceration, hydration", type: "text", limit: LONG },
  { key: "head", label: "Head / mouth / neck", type: "text", limit: LONG },
  { key: "eyes", label: "Eyes", type: "text", limit: LONG },
  { key: "ears", label: "Ears", type: "text", limit: LONG },
  { key: "nose", label: "Nose", type: "text", limit: LONG },
  { key: "cardio", label: "Cardiovascular", hint: "Heart rate, beats per minute", type: "num", min: 0, max: 300, step: 1 },
  { key: "resp", label: "Respiratory", hint: "Respiratory rate, breaths per minute", type: "num", min: 0, max: 200, step: 1 },
  { key: "nervous", label: "Nervous", type: "text", limit: LONG },
  { key: "musculo", label: "Musculo-skeletal", type: "text", limit: LONG },
  { key: "abdomen", label: "Abdomen / GIT", type: "text", limit: LONG },
  { key: "genito", label: "Genito-urinary", type: "text", limit: LONG },
  { key: "pln", label: "PLN", hint: "Peripheral lymph nodes", type: "text", limit: MID },
  { key: "comments", label: "Additional comments", type: "text", limit: LONG },
  { key: "recLabs", label: "Recommended lab works", type: "text", limit: LONG },
];
const LAB_ROWS: Row[] = [
  { key: "cbc", label: "CBC results", type: "text", limit: LONG },
  { key: "chem", label: "Blood chemistry", type: "text", limit: LONG },
  { key: "kits", label: "Test kits", type: "text", limit: LONG },
  { key: "imaging", label: "X-ray / UTZ / UA", hint: "Results. Attach images below.", type: "text", limit: LONG },
  { key: "other", label: "Other lab works", type: "text", limit: LONG },
  { key: "procedure", label: "Recommended procedure", type: "text", limit: LONG },
  { key: "dx", label: "Tentative diagnosis", type: "text", limit: LONG },
];
const MON_ROWS: Row[] = [
  { key: "tw", label: "Temp & weight", type: "text", limit: SHORT, placeholder: "38.5 °C / 4.2 kg" },
  { key: "dx", label: "Diagnosis", type: "text", limit: LONG },
  { key: "obs", label: "Observations", type: "text", limit: LONG },
  { key: "med", label: "Medications / procedure", type: "text", limit: LONG },
  { key: "dose", label: "Dosage & frequency", type: "text", limit: SHORT, placeholder: "10 mg/kg, twice daily, 7 days" },
  { key: "rem", label: "Remarks", type: "text", limit: LONG },
];
const VAX_FIELDS: { key: VaxKey; label: string }[] = [
  { key: "multivalent", label: "Multivalent vaccines" },
  { key: "rabies", label: "Anti-rabies vaccine" },
  { key: "deworm", label: "Deworming / tick / flea / mites" },
];
type VaxKey = "multivalent" | "rabies" | "deworm";

/* ── Data shapes ── */
type Col = { at: string; f: Record<string, string> };
type Img = { id: string; name: string; kind: string; at: string; note: string; path?: string; file?: File; url?: string };
type Exam = {
  id: string;
  vax: Record<VaxKey, string>;
  exam: Col[];
  lab: Col[];
  mon: Col[];
  images: Img[];
};
type StoredImg = { id: string; name: string; kind: string; at: string; note: string; path: string };
type StoredExam = Omit<Exam, "images"> & { images: StoredImg[] };

const newId = () => (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const emptyCol = (): Col => ({ at: "", f: {} });
const padCols = (cols: any): Col[] => {
  const out: Col[] = Array.isArray(cols)
    ? cols.map((c) => ({ at: String(c?.at ?? ""), f: { ...(c?.f ?? {}) } }))
    : [];
  while (out.length < CHECKS) out.push(emptyCol());
  return out;
};
const blankExam = (): Exam => ({
  id: newId(),
  vax: { multivalent: "", rabies: "", deworm: "" },
  exam: padCols([]),
  lab: padCols([]),
  mon: padCols([]),
  images: [],
});

/* Read the saved examinations. Records from the earlier single-table layout
   are converted into one examination so nothing is lost. */
function fromStored(x: any, urls: Record<string, string>): Exam {
  return {
    id: x.id ?? newId(),
    vax: { multivalent: x.vax?.multivalent ?? "", rabies: x.vax?.rabies ?? "", deworm: x.vax?.deworm ?? "" },
    exam: padCols(x.exam),
    lab: padCols(x.lab),
    mon: padCols(x.mon),
    images: (x.images ?? []).map((i: StoredImg) => ({ ...i, url: urls[i.path] })),
  };
}
function fromLegacy(rec: any, urls: Record<string, string>): Exam[] {
  const hasOld = [rec.physical_exam, rec.lab, rec.monitoring].some((a) => Array.isArray(a) && a.length);
  if (!hasOld) return [];
  const pi = rec.patient_info ?? {};
  return [{
    id: newId(),
    vax: {
      multivalent: pi.multivalent_vaccines ?? "",
      rabies: pi.anti_rabies_vaccine ?? "",
      deworm: pi.deworming_tick_flea_mites ?? "",
    },
    exam: padCols(rec.physical_exam),
    lab: padCols(rec.lab),
    mon: padCols((rec.monitoring ?? []).map((m: any) => ({
      at: m.at ?? "",
      f: { tw: m.tw ?? "", dx: m.dx ?? "", obs: m.obs ?? "", med: m.med ?? "", dose: m.dose ?? "", rem: m.rem ?? "" },
    }))),
    images: (rec.images ?? []).map((i: any) => ({ ...i, url: urls[i.path] })),
  }];
}

/* ── Display helpers ── */
const fmtDate = (v?: string | null) => {
  if (!v) return null;
  const d = new Date(v.length === 10 ? v + "T00:00:00" : v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const fmtStamp = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const fmtPhone = (p?: string | null) => {
  if (!p) return "";
  const m = String(p).trim().match(/^\+63(\d{3})(\d{3})(\d{4})$/);
  return m ? `+63 ${m[1]} ${m[2]} ${m[3]}` : String(p);
};
/* "Dog, male, not neutered". Built from the same fields the details form edits. */
const patientSummary = (p: Record<string, string>) => {
  const sex = (p.gender || "").trim().toLowerCase();
  const n = (p.neutered || "").trim();
  const fixed = /^y/i.test(n) ? (sex.startsWith("f") ? "spayed" : "neutered") : /^n/i.test(n) ? "not neutered" : "";
  return [p.species?.trim(), sex, fixed].filter(Boolean).join(", ");
};
/* "3" becomes "3 yrs". Anything that isn't a plain number (a date of birth, "6 months") is left as typed. */
const ageLabel = (v?: string) => {
  const t = (v ?? "").trim();
  return /^\d+(\.\d+)?$/.test(t) ? `${t} ${Number(t) === 1 ? "yr" : "yrs"}` : t;
};
const firstDate = (ex: Exam) => ex.exam.find((c) => c.at)?.at || ex.lab.find((c) => c.at)?.at || "";

/* Counter under every free-text field. Turns amber near the limit, red over. */
function Counter({ value, limit }: { value: string; limit: number }) {
  const n = value.length;
  const tone = n > limit ? "text-[hsl(var(--destructive))] font-bold" : n > limit * 0.9 ? "text-[hsl(40_70%_30%)] font-bold" : "text-[hsl(var(--muted-foreground))]";
  return <p className={`mt-1 text-right text-[11.5px] tabular-nums ${tone}`}>{n.toLocaleString()} / {limit.toLocaleString()}</p>;
}

/* One control for one row type. Single-line controls are 40px high and
   text areas are 88px high everywhere. */
function Control({ row, value, onChange, label, bad }: {
  row: Row; value: string; onChange: (v: string) => void; label: string; bad?: boolean;
}) {
  const cls = bad ? BAD : "";
  if (row.type === "select") {
    return (
      <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} className={`${INPUT} ${cls}`}>
        <option value="">Select</option>
        {row.options!.map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  }
  if (row.type === "num") {
    return (
      <input type="number" inputMode="decimal" value={value} aria-label={label} min={row.min} max={row.max} step={row.step}
        onChange={(e) => onChange(e.target.value)} className={`${INPUT} ${cls}`} />
    );
  }
  if ((row.limit ?? SHORT) >= MID) {
    return (
      <div>
        <textarea value={value} aria-label={label} maxLength={row.limit} onChange={(e) => onChange(e.target.value)}
          className={`${TEXTAREA} ${cls}`} />
        <Counter value={value} limit={row.limit!} />
      </div>
    );
  }
  return (
    <input type="text" value={value} aria-label={label} maxLength={row.limit} placeholder={row.placeholder}
      onChange={(e) => onChange(e.target.value)} className={`${INPUT} ${cls}`} />
  );
}

/* ── One table for every checklist: items down the side, one column per time. ── */
function GridTable({
  rows, cols, rowErrors, onAt, onCell, onAddCol, onRemoveCol, addLabel, entryLabel,
}: {
  rows: Row[]; cols: Col[]; rowErrors: Set<string>;
  onAt: (i: number, v: string) => void;
  onCell: (i: number, key: string, v: string) => void;
  onAddCol: () => void; onRemoveCol: (i: number) => void;
  addLabel: string; entryLabel: string;
}) {
  return (
    <div>
      <div className="w-full overflow-x-auto">
        <table className="w-full border-separate border-spacing-0" style={{ minWidth: 240 + 240 * cols.length }}>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-[1] w-[240px] border-b border-r border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3 text-left text-[12px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Item
              </th>
              {cols.map((c, i) => (
                <th key={i} scope="col" className="min-w-[240px] border-b border-r border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3 text-left align-top">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[12px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{entryLabel} {i + 1}</span>
                    {cols.length > 1 && (
                      <button type="button" onClick={() => onRemoveCol(i)} aria-label={`Remove ${entryLabel.toLowerCase()} ${i + 1}`}
                        className={`rounded-md p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))] ${FOCUS_RING}`}>
                        <X size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  <label className="block">
                    <span className="sr-only">{entryLabel} {i + 1} date and time</span>
                    <input type="datetime-local" value={c.at} onChange={(e) => onAt(i, e.target.value)}
                      className={`${INPUT} ${rowErrors.has(`${i}|at`) ? BAD : ""}`} />
                  </label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className="sticky left-0 z-[1] w-[240px] border-b border-r border-[hsl(var(--border))] bg-[hsl(var(--muted)/.5)] p-3 text-left align-top">
                  <span className="block text-[14px] font-bold">{r.label}</span>
                  {r.hint && <span className="mt-0.5 block text-[12px] font-normal text-[hsl(var(--muted-foreground))]">{r.hint}</span>}
                </th>
                {cols.map((c, i) => (
                  <td key={i} className="min-w-[240px] border-b border-r border-[hsl(var(--border))] p-3 align-top">
                    <Control row={r} value={c.f[r.key] ?? ""} label={`${r.label}, ${entryLabel.toLowerCase()} ${i + 1}`}
                      onChange={(v) => onCell(i, r.key, v)} bad={rowErrors.has(`${i}|${r.key}`)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-[hsl(var(--border))] px-5 py-3">
        <button type="button" onClick={onAddCol} className={BTN_ADD}>
          <Plus size={14} strokeWidth={2.6} aria-hidden="true" /> {addLabel}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[12px] font-semibold text-[hsl(var(--muted-foreground))]">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className={INPUT} />
    </label>
  );
}


/* ── Entry point ── */
export default function PatientChartDialog({ pet, onClose }: { pet: any | null; onClose: () => void }) {
  return pet ? <Chart key={pet.id} pet={pet} onClose={onClose} /> : null;
}

function Chart({ pet, onClose }: { pet: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const owner = pet.owner ?? {};

  const [exams, setExams] = useState<Exam[]>([blankExam()]);
  const [active, setActive] = useState(0);
  /* Downloaded images, kept in memory for this page. They have no expiry. */
  const blobUrls = useRef<Map<string, string>>(new Map());
  const [oInfo, setOInfo] = useState<Record<string, string>>({
    name: owner.name ?? "", phone: owner.phone ?? "", email: owner.email ?? "",
    address: owner.address ?? "", messenger: owner.fb_messenger ?? owner.messenger ?? "",
  });
  const [pInfo, setPInfo] = useState<Record<string, string>>({
    name: pet.name ?? "", species: pet.species ?? "", breed: pet.breed ?? "",
    age: pet.age != null ? String(pet.age) : "", gender: pet.gender ?? "", neutered: pet.neutered ?? "",
  });
  const [editingDetails, setEditingDetails] = useState(false);
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [follow, setFollow] = useState<{ date: string; note: string }>({ date: "", note: "" });
  const savedFollow = useRef<{ date: string | null; setOn: string | null }>({ date: null, setOn: null });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const loadedAt = useRef<string | null>(null);
  const recordExists = useRef(false);
  const hydrated = useRef(false);
  const removedPaths = useRef<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: saved, isLoading, isError, error: loadError, refetch } = useQuery({
    queryKey: ["medical-record", pet.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("medical_records")
        .select("owner_info, patient_info, examinations, physical_exam, lab, monitoring, images, updated_at, follow_up_date, follow_up_note, follow_up_set_on")
        .eq("pet_id", pet.id)
        .maybeSingle();
      if (error) throw error;
      return { rec: data ?? null, urls: {} as Record<string, string>, updatedAt: data?.updated_at ?? null };
    },
  });

  /* Load once, when the record arrives. */
  useEffect(() => {
    if (hydrated.current || isLoading || isError || !saved) return;
    hydrated.current = true;
    loadedAt.current = saved.updatedAt;
    recordExists.current = !!saved.rec;
    const rec = saved.rec;
    if (rec) {
      setFollow({ date: rec.follow_up_date ?? "", note: rec.follow_up_note ?? "" });
      savedFollow.current = { date: rec.follow_up_date ?? null, setOn: rec.follow_up_set_on ?? null };
      if (rec.owner_info && Object.keys(rec.owner_info).length) setOInfo((p) => ({ ...p, ...rec.owner_info }));
      if (rec.patient_info && Object.keys(rec.patient_info).length) setPInfo((p) => ({ ...p, ...rec.patient_info }));
      const list: Exam[] = Array.isArray(rec.examinations) && rec.examinations.length
        ? rec.examinations.map((x: any) => fromStored(x, saved.urls))
        : fromLegacy(rec, saved.urls);
      if (list.length) {
        setExams(list);
        const paths = list.flatMap((e) => e.images.map((i) => i.path)).filter((p): p is string => !!p && isImageName(p));
        void Promise.all(paths.map((p) => fetchImage(p).catch(() => null))).then(attachBlobUrls);
      }
    }
    if (saved.updatedAt) setSavedAt(saved.updatedAt);
  }, [saved, isLoading, isError]);

  /* Warn before leaving with unsaved work. */
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  /* Saving is blocked until the record has loaded, so nothing overwrites it. */
  const canEdit = !isLoading && !isError;
  const current = exams[Math.min(active, exams.length - 1)];
  const touch = () => setDirty(true);

  const patchExam = (id: string, fn: (e: Exam) => Exam) => {
    setExams((list) => list.map((e) => (e.id === id ? fn(e) : e)));
    touch();
  };
  const clearError = (prefix: string) => setErrors((s) => {
    if (![...s].some((k) => k.startsWith(prefix))) return s;
    return new Set([...s].filter((k) => !k.startsWith(prefix)));
  });

  const setAt = (examId: string, group: Group, i: number, at: string) => {
    patchExam(examId, (e) => ({ ...e, [group]: e[group].map((c, j) => (j === i ? { ...c, at } : c)) }));
    clearError(`${examId}|${group}|${i}|at`);
  };
  const setCell = (examId: string, group: Group, i: number, key: string, v: string) => {
    patchExam(examId, (e) => ({ ...e, [group]: e[group].map((c, j) => (j === i ? { ...c, f: { ...c.f, [key]: v } } : c)) }));
    clearError(`${examId}|${group}|${i}|${key}`);
  };
  const addCol = (examId: string, group: Group) => patchExam(examId, (e) => ({ ...e, [group]: [...e[group], emptyCol()] }));
  const removeCol = (examId: string, group: Group, i: number) => {
    const ex = exams.find((e) => e.id === examId);
    if (!ex) return;
    const col = ex[group][i];
    const hasData = !!col.at || Object.values(col.f).some((v: string) => v.trim());
    if (hasData && !window.confirm(`Remove this ${group === "mon" ? "entry" : "column"} and everything entered in it?`)) return;
    patchExam(examId, (e) => ({ ...e, [group]: e[group].filter((_, j) => j !== i) }));
    clearError(`${examId}|${group}|`);
  };

  const addExam = () => {
    const ex = blankExam();
    setExams((list) => [...list, ex]);
    setActive(exams.length);
    touch();
  };
  const removeExam = (ex: Exam) => {
    const hasData = [...ex.exam, ...ex.lab, ...ex.mon].some((c) => c.at || Object.values(c.f).some((v: string) => v.trim())) || ex.images.length > 0;
    if (hasData && !window.confirm("Remove this examination and everything entered in it?")) return;
    if (exams.length === 1) { setExams([blankExam()]); setActive(0); }
    else { setExams((list) => list.filter((e) => e.id !== ex.id)); setActive(0); }
    ex.images.forEach((im) => im.path && removedPaths.current.push(im.path));
    touch();
  };

  const setVax = (examId: string, key: VaxKey, v: string) => patchExam(examId, (e) => ({ ...e, vax: { ...e.vax, [key]: v } }));
  const setInfo = (set: Dispatch<SetStateAction<Record<string, string>>>, key: string, v: string) => {
    set((p) => ({ ...p, [key]: v })); touch();
  };

  /* ── Images and files: JPG, PNG, PDF or Word, up to MAX_IMAGE_MB ── */
  const addFiles = (examId: string, files: FileList | File[] | null) => {
    Array.from(files ?? []).forEach((f) => {
      if (!FILE_TYPES.includes(f.type)) { toast.error(`${f.name}: only JPG, PNG, PDF or Word files can be added.`); return; }
      if (f.size > MAX_IMAGE_MB * 1024 * 1024) { toast.error(`${f.name}: larger than ${MAX_IMAGE_MB} MB.`); return; }
      patchExam(examId, (e) => ({
        ...e,
        images: [...e.images, { id: newId(), name: f.name, kind: isImageName(f.name) ? "X-ray" : "Lab report", at: "", note: "", file: f, url: URL.createObjectURL(f) }],
      }));
    });
  };
  const editImg = (examId: string, imgId: string, patch: Partial<Img>) =>
    patchExam(examId, (e) => ({ ...e, images: e.images.map((i) => (i.id === imgId ? { ...i, ...patch } : i)) }));
  const removeImg = (examId: string, img: Img) => {
    if (img.path) removedPaths.current.push(img.path);
    if (img.file && img.url) URL.revokeObjectURL(img.url);
    patchExam(examId, (e) => ({ ...e, images: e.images.filter((i) => i.id !== img.id) }));
  };

  /* ── Images ──
     Each image is downloaded once through the signed-in session, so the
     storage rules decide who can see it, and it never expires. */
  const fetchImage = async (path: string) => {
    const cached = blobUrls.current.get(path);
    if (cached) return cached;
    const { data, error } = await supabase.storage.from(IMAGE_BUCKET).download(path);
    if (error || !data) throw error ?? new Error("Image not found");
    const url = URL.createObjectURL(data);
    blobUrls.current.set(path, url);
    return url;
  };
  const attachBlobUrls = () => {
    setExams((list) => list.map((e) => ({
      ...e,
      images: e.images.map((im) => {
        const url = im.path ? blobUrls.current.get(im.path) : undefined;
        return url && im.url !== url ? { ...im, url } : im;
      }),
    })));
  };
  const retryImage = (im: Img) => {
    if (!im.path) return;
    blobUrls.current.delete(im.path);
    fetchImage(im.path).then(attachBlobUrls).catch(() => toast.error("Couldn't load this image. Reload the page to try again."));
  };
  const downloadFile = async (im: Img) => {
    try {
      const href = im.file ? URL.createObjectURL(im.file) : await fetchImage(im.path!);
      const a = document.createElement("a");
      a.href = href;
      a.download = im.name;
      a.click();
      if (im.file) URL.revokeObjectURL(href);
    } catch {
      toast.error("Couldn't download this file. Try again.");
    }
  };
  const openImage = async (im: Img) => {
    if (!isImageName(im.name)) return downloadFile(im);
    if (im.file && im.url) { window.open(im.url, "_blank"); return; }
    if (!im.path) return;
    const w = window.open("", "_blank");
    if (w) w.opener = null;
    try {
      const url = await fetchImage(im.path);
      if (w) w.location.href = url; else window.open(url, "_blank");
    } catch {
      w?.close();
      toast.error("Couldn't open this image. Try again.");
    }
  };
  useEffect(() => () => { blobUrls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  /* ── Validation ── */
  const validate = () => {
    const errs = new Set<string>();
    const checkRows = (ex: Exam, group: Group, rows: Row[], cols: Col[]) => {
      cols.forEach((c, i) => {
        const prefix = `${ex.id}|${group}|${i}|`;
        const hasData = rows.some((r) => (c.f[r.key] ?? "").trim());
        if (hasData && !c.at) errs.add(`${prefix}at`);
        rows.forEach((r) => {
          const v = (c.f[r.key] ?? "").trim();
          if (r.type !== "num" || !v) return;
          const n = Number(v);
          if (!/^\d+(\.\d+)?$/.test(v) || n < (r.min ?? -Infinity) || n > (r.max ?? Infinity)) errs.add(`${prefix}${r.key}`);
        });
      });
    };
    exams.forEach((ex) => {
      checkRows(ex, "exam", EXAM_ROWS, ex.exam);
      checkRows(ex, "lab", LAB_ROWS, ex.lab);
      checkRows(ex, "mon", MON_ROWS, ex.mon);
    });
    return errs;
  };

  const save = async () => {
    if (!canEdit || saving) return;
    const errs = validate();
    if (errs.size) {
      setErrors(errs);
      const firstExamId = [...errs][0].split("|")[0];
      const idx = exams.findIndex((e) => e.id === firstExamId);
      if (idx >= 0) setActive(idx);
      toast.error(describeErrors(errs, exams).slice(0, 3).join(" · "), { duration: 8000 });
      return;
    }

    setSaving(true);
    const uploaded: string[] = [];
    try {
      /* Built after the uploads below; the save step checks it atomically. */

      /* Upload new images first. If the save fails, these are removed again. */
      const pathFor = new Map<string, string>();
      const payload: StoredExam[] = [];
      for (const ex of exams) {
        const images: StoredImg[] = [];
        for (const im of ex.images) {
          let path = im.path;
          if (im.file) {
            path = `${pet.id}/${ex.id}/${im.id}.${fileExt(im.file)}`;
            const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, im.file, { contentType: im.file.type, upsert: false });
            if (error) throw error;
            uploaded.push(path);
            pathFor.set(im.id, path);
          }
          if (!path) continue;
          images.push({ id: im.id, name: im.name, kind: im.kind, at: im.at, note: im.note, path });
        }
        payload.push({ id: ex.id, vax: ex.vax, exam: ex.exam, lab: ex.lab, mon: ex.mon, images });
      }

      const localToday = () => new Date().toLocaleDateString("en-CA");
      const sameDate = (follow.date || null) === savedFollow.current.date;
      const followBody = {
        follow_up_date: follow.date || null,
        follow_up_note: follow.note.trim() || null,
        // A new or changed date counts from today. The same date keeps its original start.
        follow_up_set_on: follow.date
          ? (sameDate && savedFollow.current.setOn ? savedFollow.current.setOn : localToday())
          : null,
      };
      const body = { owner_info: oInfo, patient_info: pInfo, examinations: payload, ...followBody };
      let row: { updated_at: string };
      if (recordExists.current) {
        /* The update only matches if nobody saved since this record was loaded,
           so the check and the save cannot be separated by another save. */
        let query = (supabase as any).from("medical_records").update(body).eq("pet_id", pet.id);
        query = loadedAt.current ? query.eq("updated_at", loadedAt.current) : query.is("updated_at", null);
        const { data, error } = await query.select("updated_at");
        if (error) throw error;
        if (!data || data.length === 0) {
          throw new Error("This record was changed by someone else after you opened it. Reload the patient before saving. Your entries are still on screen.");
        }
        row = data[0];
      } else {
        const { data, error } = await (supabase as any)
          .from("medical_records")
          .insert({ pet_id: pet.id, ...body })
          .select("updated_at")
          .single();
        if (error) throw error;
        row = data;
        recordExists.current = true;
      }

      if (removedPaths.current.length) {
        await supabase.storage.from(IMAGE_BUCKET).remove(removedPaths.current).catch(() => {});
        removedPaths.current = [];
      }
      loadedAt.current = row.updated_at;
      savedFollow.current = { date: followBody.follow_up_date, setOn: followBody.follow_up_set_on };
      setExams((list) => list.map((e) => ({
        ...e,
        images: e.images.map((im) => (pathFor.has(im.id) ? { ...im, path: pathFor.get(im.id), file: undefined } : im)),
      })));
      setErrors(new Set());
      setDirty(false);
      setSavedAt(row.updated_at);
      /* Keep the owner record in step with the owner details on this chart. */
      if (owner?.id) {
        const { error: ownerError } = await (supabase as any).from("clients").update({
          name: oInfo.name || null,
          phone: oInfo.phone || null,
          email: oInfo.email || null,
          address: oInfo.address || null,
          fb_messenger: oInfo.messenger || null,
        }).eq("id", owner.id);
        if (ownerError) throw ownerError;
      }
      queryClient.invalidateQueries({ queryKey: ["medical-record", pet.id] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Medical record saved.");
    } catch (err: any) {
      if (uploaded.length) await supabase.storage.from(IMAGE_BUCKET).remove(uploaded).catch(() => {});
      toast.error(err?.message || "Couldn't save the record. Your entries are still on screen.");
    } finally {
      setSaving(false);
    }
  };

  const requestClose = () => {
    if (dirty && !window.confirm("You have unsaved changes. Close without saving?")) return;
    onClose();
  };

  const status = saving ? "Saving…" : dirty ? "Unsaved changes" : savedAt ? `Saved ${fmtStamp(savedAt)}` : "No changes yet";

  return (
    <div className="mx-auto w-full max-w-[1440px] px-5 pb-6 sm:px-8 lg:px-10"
      onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } }}>

      {/* ── Patient header ── */}
      <button type="button" onClick={requestClose}
        className={`inline-flex min-h-11 items-center gap-1.5 rounded-md text-[14px] font-medium text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))] ${FOCUS_RING}`}>
        <ArrowLeft size={16} aria-hidden="true" /> Back to appointments
      </button>
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 pt-2">
        <div className="flex min-w-0 items-center gap-4">
          <div aria-hidden="true"
            className="flex h-16 w-16 flex-none items-center justify-center rounded-full bg-[hsl(var(--primary))] text-[26px] font-bold text-[hsl(var(--primary-foreground))] shadow-[0_0_0_3px_#fff,0_0_0_5px_hsl(var(--accent))]">
            {(pInfo.name || pet.name || "?").trim().charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="break-words text-[32px] font-bold leading-[1.1] tracking-[-0.01em]">{pInfo.name || pet.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-[14px] text-[hsl(var(--muted-foreground))]">
              {pet.visit ? (
                <>
                  <span>{[pet.visit.service, pet.visit.when].filter(Boolean).join(", ")}</span>
                  <span className={`rounded-full px-2.5 py-[3px] text-[12.5px] font-semibold ${
                    pet.visit.status === "In progress" || pet.visit.status === "Completed"
                      ? "bg-[#DDEFE6] text-[#17553B]"
                      : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"}`}>
                    {pet.visit.status}
                  </span>
                </>
              ) : patientSummary(pInfo) ? <span>{patientSummary(pInfo)}</span> : null}
            </div>
          </div>
        </div>
        <button type="button" className={`${BTN} !h-11 px-5`} onClick={() => setEditingDetails((v) => !v)} disabled={!canEdit}>
          {editingDetails ? "Done" : "Edit details"}
        </button>
      </div>

      {/* ── Owner and patient ── */}
      {editingDetails ? (
        <section className={`${CARD} grid gap-x-5 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-4`} aria-label="Edit owner and patient details">
          <Field label="Owner's name" value={oInfo.name ?? ""} onChange={(v) => setInfo(setOInfo, "name", v)} />
          <Field label="Contact no." value={oInfo.phone ?? ""} onChange={(v) => setInfo(setOInfo, "phone", v)} />
          <Field label="FB Messenger" value={oInfo.messenger ?? ""} onChange={(v) => setInfo(setOInfo, "messenger", v)} />
          <Field label="Address" value={oInfo.address ?? ""} onChange={(v) => setInfo(setOInfo, "address", v)} />
          <Field label="Pet's name" value={pInfo.name ?? ""} onChange={(v) => setInfo(setPInfo, "name", v)} />
          <Field label="Species" value={pInfo.species ?? ""} onChange={(v) => setInfo(setPInfo, "species", v)} />
          <Field label="Breed" value={pInfo.breed ?? ""} onChange={(v) => setInfo(setPInfo, "breed", v)} />
          <Field label="Age / DOB" value={pInfo.age ?? ""} onChange={(v) => setInfo(setPInfo, "age", v)} />
          <Field label="Sex" value={pInfo.gender ?? ""} onChange={(v) => setInfo(setPInfo, "gender", v)} />
          <Field label="Neutered / spayed" value={pInfo.neutered ?? ""} onChange={(v) => setInfo(setPInfo, "neutered", v)} />
        </section>
      ) : (
        <section aria-label="Patient and owner details" className={`${CARD} grid md:grid-cols-2`}>
          <InfoPanel title="Patient" rows={[
            { label: "Species", value: pInfo.species },
            { label: "Breed", value: pInfo.breed },
            { label: "Age", value: ageLabel(pInfo.age) },
            { label: "Sex", value: pInfo.gender },
            { label: "Neutered / spayed", value: pInfo.neutered },
          ]} />
          <InfoPanel divided title="Owner" rows={[
            { label: "Name", value: oInfo.name },
            { label: "Contact no.", value: fmtPhone(oInfo.phone), href: oInfo.phone ? `tel:${oInfo.phone.replace(/\s/g, "")}` : undefined },
            { label: "Email", value: oInfo.email },
            { label: "FB Messenger", value: oInfo.messenger },
            { label: "Address", value: oInfo.address },
          ]} />
        </section>
      )}

      {/* ── Come back on ── */}
      <section className={`${CARD} mt-4 flex flex-wrap items-end gap-x-5 gap-y-4 px-7 py-4`} aria-label="Come back on">
        <div className="min-w-[200px] flex-1">
          <h3 className="text-[16px] font-bold">Come back on</h3>
          <p className="mt-0.5 text-[13px] text-[hsl(var(--muted-foreground))]">One date per patient. Clears after the next visit.</p>
        </div>
        <label className="block min-w-0">
          <span className="mb-1.5 block text-[12.5px] font-semibold text-[hsl(var(--muted-foreground))]">Date</span>
          <input type="date" value={follow.date} disabled={!canEdit}
            onChange={(e) => { setFollow((f) => ({ ...f, date: e.target.value })); touch(); }}
            className={`${INPUT} !h-11 w-[180px]`} />
        </label>
        <label className="block min-w-[280px] flex-[2]">
          <span className="mb-1.5 block text-[12.5px] font-semibold text-[hsl(var(--muted-foreground))]">Reason (optional)</span>
          <input type="text" value={follow.note} maxLength={SHORT} placeholder="e.g. Recheck the skin in 10 days" disabled={!canEdit}
            onChange={(e) => { setFollow((f) => ({ ...f, note: e.target.value })); touch(); }}
            className={`${INPUT} !h-11`} />
        </label>
        {follow.date && (
          <button type="button" className={`${BTN} !h-11`} disabled={!canEdit}
            onClick={() => { setFollow({ date: "", note: "" }); touch(); }}>Clear</button>
        )}
      </section>

      {/* ── Examinations and visits ── */}
      <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-[hsl(var(--border))] pb-4">
        {exams.map((ex, i) => {
          const d = fmtDate(firstDate(ex));
          const on = i === active;
          return (
            <button key={ex.id} type="button" aria-pressed={on}
              onClick={() => setActive(i)} className={TAB(on)}>
              Examination {i + 1}{d ? ` · ${d}` : ""}
            </button>
          );
        })}
        <button type="button" onClick={addExam} className={`${BTN_ADD} !h-11`}>
          <Plus size={14} strokeWidth={2.6} aria-hidden="true" /> New examination
        </button>
      </div>

      {isLoading ? (
        <div className={`${CARD} mt-4 flex items-center gap-2 p-6 text-[14px] text-[hsl(var(--muted-foreground))]`} role="status">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading the record…
        </div>
      ) : isError ? (
        <div className={`${CARD} mt-4 p-6 text-[14px]`} role="alert">
          <p>Couldn&apos;t load this patient&apos;s record. Saving is off so existing data isn&apos;t overwritten.</p>
          <p className="mt-1 text-[12.5px] text-[hsl(var(--muted-foreground))]">{(loadError as any)?.message}</p>
          <button type="button" onClick={() => void refetch()} className="mt-2 font-bold text-[hsl(var(--primary))] hover:underline">Try again</button>
        </div>
      ) : (
        <>
          {current && (
            <div className="mt-4 space-y-5">
              {/* Vaccines and deworming for this examination */}
              <section className={CARD}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] px-5 py-4">
                  <div>
                    <h3 className="text-[16px] font-bold">Vaccines and deworming</h3>
                    <p className="mt-0.5 text-[13px] text-[hsl(var(--muted-foreground))]">As of this examination.</p>
                  </div>
                </div>
                <div className="grid gap-4 p-5 sm:grid-cols-3">
                  {VAX_FIELDS.map(({ key, label }) => (
                    <label key={key} className="block min-w-0">
                      <span className="mb-1.5 block text-[12px] font-semibold text-[hsl(var(--muted-foreground))]">{label}</span>
                      <input type="text" value={current.vax[key]} maxLength={SHORT}
                        onChange={(e) => setVax(current.id, key, e.target.value)} className={INPUT} />
                    </label>
                  ))}
                </div>
              </section>

              <section className={CARD}>
                <div className="border-b border-[hsl(var(--border))] px-5 py-4">
                  <h3 className="text-[16px] font-bold">Physical examination</h3>
                  <p className="mt-0.5 text-[13px] text-[hsl(var(--muted-foreground))]">Each column is one checklist time.</p>
                </div>
                <GridTable rows={EXAM_ROWS} cols={current.exam}
                  rowErrors={rowErrorsFor(errors, `${current.id}|exam|`)}
                  onAt={(i, v) => setAt(current.id, "exam", i, v)}
                  onCell={(i, k, v) => setCell(current.id, "exam", i, k, v)}
                  onAddCol={() => addCol(current.id, "exam")}
                  onRemoveCol={(i) => removeCol(current.id, "exam", i)}
                  addLabel="Add checklist time" entryLabel="Check" />
              </section>

              <section className={CARD}>
                <div className="border-b border-[hsl(var(--border))] px-5 py-4">
                  <h3 className="text-[16px] font-bold">Laboratory tests, recommendation and diagnosis</h3>
                  <p className="mt-0.5 text-[13px] text-[hsl(var(--muted-foreground))]">Each column is one set of results.</p>
                </div>
                <GridTable rows={LAB_ROWS} cols={current.lab}
                  rowErrors={rowErrorsFor(errors, `${current.id}|lab|`)}
                  onAt={(i, v) => setAt(current.id, "lab", i, v)}
                  onCell={(i, k, v) => setCell(current.id, "lab", i, k, v)}
                  onAddCol={() => addCol(current.id, "lab")}
                  onRemoveCol={(i) => removeCol(current.id, "lab", i)}
                  addLabel="Add results column" entryLabel="Result" />

                <div className="border-t border-[hsl(var(--border))] p-5">
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h4 className="text-[15px] font-bold">Images and files</h4>
                      <p className="mt-0.5 text-[13px] text-[hsl(var(--muted-foreground))]">JPG, PNG, PDF or Word, up to {MAX_IMAGE_MB} MB each. Only staff can open them.</p>
                    </div>
                    <button type="button" onClick={() => fileInput.current?.click()} className={BTN}>
                      <Upload size={16} aria-hidden="true" /> Add file
                    </button>
                  </div>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(current.id, e.dataTransfer.files); }}
                    className={`rounded-[12px] border-[1.5px] border-dashed p-4 transition ${dragOver ? "border-[hsl(var(--primary))] bg-[hsl(var(--muted))]" : "border-[hsl(var(--border))]"}`}
                  >
                    {current.images.length === 0 ? (
                      <p className="py-4 text-center text-[14px] text-[hsl(var(--muted-foreground))]">Drop files here, or use Add file.</p>
                    ) : (
                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        {current.images.map((im) => (
                          <div key={im.id} className="overflow-hidden rounded-[10px] border border-[hsl(var(--border))] bg-white">
                            {!isImageName(im.name) ? (
                              <button type="button" onClick={() => void openImage(im)} aria-label={`Download ${im.name}`}
                                className={`flex h-40 w-full flex-col items-center justify-center gap-2 bg-[hsl(var(--muted)/.5)] text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}>
                                <FileText size={32} aria-hidden="true" />
                                <span className="text-[13px] font-semibold text-[hsl(var(--foreground))]">Download file</span>
                              </button>
                            ) : im.url ? (
                              <button type="button" onClick={() => void openImage(im)} aria-label={`Open ${im.name} full size`} className="block w-full">
                                <img src={im.url} alt={im.name} onError={() => retryImage(im)} className="h-40 w-full bg-black object-cover" />
                              </button>
                            ) : (
                              <div className="grid h-40 place-items-center bg-[hsl(var(--muted))] text-[13px] text-[hsl(var(--muted-foreground))]">
                                <div className="text-center">
                                  <p>Preview unavailable</p>
                                  {im.path && <button type="button" onClick={() => retryImage(im)} className="mt-1 font-bold text-[hsl(var(--primary))] hover:underline">Try again</button>}
                                </div>
                              </div>
                            )}
                            <div className="grid gap-2 p-3">
                              <div className="flex items-center justify-between gap-2 text-[13px]">
                                <span className="truncate font-semibold" title={im.name}>{im.name}</span>
                                <button type="button" onClick={() => removeImg(current.id, im)} aria-label={`Remove ${im.name}`}
                                  className={`rounded-md p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))] ${FOCUS_RING}`}>
                                  <X size={14} aria-hidden="true" />
                                </button>
                              </div>
                              <select value={im.kind} aria-label="Image type" onChange={(e) => editImg(current.id, im.id, { kind: e.target.value })} className={INPUT}>
                                {IMAGE_KINDS.map((k) => <option key={k}>{k}</option>)}
                              </select>
                              <input type="datetime-local" value={im.at} aria-label="Image date and time"
                                onChange={(e) => editImg(current.id, im.id, { at: e.target.value })} className={INPUT} />
                              <input type="text" value={im.note} maxLength={MID} placeholder="Note (optional)" aria-label="Image note"
                                onChange={(e) => editImg(current.id, im.id, { note: e.target.value })} className={INPUT} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <input ref={fileInput} type="file" accept="image/jpeg,image/png,application/pdf,.doc,.docx" multiple hidden
                    onChange={(e) => { addFiles(current.id, e.target.files); e.target.value = ""; }} />
                </div>
              </section>

              <section className={CARD}>
                <div className="border-b border-[hsl(var(--border))] px-5 py-4">
                  <h3 className="text-[16px] font-bold">Monitoring and treatment plan</h3>
                  <p className="mt-0.5 text-[13px] text-[hsl(var(--muted-foreground))]">Each column is one monitoring or treatment entry.</p>
                </div>
                <GridTable rows={MON_ROWS} cols={current.mon}
                  rowErrors={rowErrorsFor(errors, `${current.id}|mon|`)}
                  onAt={(i, v) => setAt(current.id, "mon", i, v)}
                  onCell={(i, k, v) => setCell(current.id, "mon", i, k, v)}
                  onAddCol={() => addCol(current.id, "mon")}
                  onRemoveCol={(i) => removeCol(current.id, "mon", i)}
                  addLabel="Add entry" entryLabel="Entry" />
              </section>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[hsl(var(--border))] bg-white px-5 py-4">
                <button type="button" onClick={() => removeExam(current)} className={`${BTN} text-[hsl(var(--destructive))]`}>
                  Remove examination
                </button>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="text-right">
                    <p role="status" aria-live="polite" className={`text-[13px] ${dirty ? "font-bold text-[hsl(40_70%_30%)]" : "text-[hsl(var(--muted-foreground))]"}`}>{status}</p>
                    <p className="text-[12px] text-[hsl(var(--muted-foreground))]">Saves every examination for this patient.</p>
                  </div>
                  <button type="button" className={BTN_PRIMARY} disabled={!dirty || saving} onClick={() => void save()}>
                    {saving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                    {saving ? "Saving…" : "Save record"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
}

/* Errors for one group, keyed by `${index}|${field}` for the table to read. */
function rowErrorsFor(errors: Set<string>, prefix: string) {
  const out = new Set<string>();
  errors.forEach((k) => { if (k.startsWith(prefix)) out.add(k.slice(prefix.length)); });
  return out;
}

/* Plain-language list of what needs fixing, e.g.
   "Examination 1, Physical examination check 2: add the date & time". */
function describeErrors(errs: Set<string>, exams: Exam[]): string[] {
  const groupName: Record<string, string> = { exam: "Physical examination", lab: "Lab results", mon: "Monitoring" };
  const entryName: Record<string, string> = { exam: "check", lab: "result", mon: "entry" };
  const rowsByGroup: Record<string, Row[]> = { exam: EXAM_ROWS, lab: LAB_ROWS, mon: MON_ROWS };
  return [...errs].map((key) => {
    const [examId, group, idx, field] = key.split("|");
    const n = exams.findIndex((e) => e.id === examId) + 1;
    const where = `Examination ${n}, ${groupName[group]} ${entryName[group]} ${Number(idx) + 1}`;
    if (field === "at") return `${where}: add the date & time`;
    const label = rowsByGroup[group]?.find((r) => r.key === field)?.label ?? field;
    return `${where}, ${label}: value is outside the allowed range`;
  });
}

/* Read-only details: label on the left, value on the right. Two of these sit
   side by side inside one shared card; `divided` adds the line between them. */
function InfoPanel({ title, rows, divided }: {
  title: string;
  rows: { label: string; value?: string | null; href?: string }[];
  divided?: boolean;
}) {
  return (
    <div role="group" aria-label={title}
      className={`min-w-0 px-7 pb-2 pt-5 ${divided ? "border-t border-[hsl(var(--border))] md:border-l md:border-t-0" : ""}`}>
      <h3 className="mb-1 text-[16px] font-bold">{title}</h3>
      <dl>
        {rows.map((r) => (
          <div key={r.label}
            className="grid grid-cols-[112px_1fr] gap-3 border-t border-[hsl(var(--border))] py-3 sm:grid-cols-[140px_1fr]">
            <dt className="text-[14px] text-[hsl(var(--muted-foreground))]">{r.label}</dt>
            <dd className={`min-w-0 break-words text-[15px] ${r.value ? "font-medium" : "text-[hsl(var(--muted-foreground))]"}`}>
              {r.value ? (
                r.href ? <a href={r.href} className="font-semibold underline underline-offset-[3px]">{r.value}</a> : r.value
              ) : "Not recorded"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

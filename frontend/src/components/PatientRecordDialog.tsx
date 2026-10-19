import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  AlertTriangle, Calendar, Check, CheckCheck, ChevronDown, ClipboardList, FlaskConical,
  Loader2, Mail, MapPin, PawPrint, Phone, Plus, Stethoscope, Trash2, User, X,
} from "lucide-react";
import {
  buildRecord, emptyMonitoringRow, fetchMedicalRecord, saveMedicalRecord,
  type ExamColumn, type MedicalRecord, type MonitoringRow, type OwnerInfo, type PatientInfo,
} from "@/api/medicalRecords";

/* ---------- Design tokens ---------- */

const RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary)/.45)] focus-visible:ring-offset-1 focus-visible:ring-offset-[hsl(var(--background))]";
const CONTROL =
  `w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm text-[hsl(var(--foreground))] shadow-[0_1px_0_rgb(0_0_0/.02)] transition-colors placeholder:text-[hsl(var(--muted-foreground)/.7)] hover:border-[hsl(var(--muted-foreground)/.45)] focus:border-[hsl(var(--primary))] ${RING}`;
const BTN_PRIMARY =
  `inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-5 text-sm font-semibold text-[hsl(var(--primary-foreground))] shadow-sm transition hover:bg-[hsl(var(--primary)/.9)] disabled:pointer-events-none disabled:opacity-60 ${RING}`;
const BTN_OUTLINE =
  `inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 text-sm font-semibold text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))] ${RING}`;
const BTN_GHOST_SM =
  `inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] ${RING}`;

/* ---------- Form schema (mirrors the clinic's paper form) ---------- */

type FieldKind = "text" | "area" | "select";
type FieldDef = {
  key: string; label: string; kind?: FieldKind; unit?: string;
  placeholder?: string; options?: string[]; normal?: boolean; wide?: boolean;
};
type FieldGroup = { title: string; description?: string; fields: FieldDef[]; columns?: 1 | 2 | 3 };

const PHYSICAL_GROUPS: FieldGroup[] = [
  {
    title: "Clinical history",
    fields: [{ key: "clinical_history", label: "Clinical history", kind: "area", placeholder: "Chief complaint, onset, duration, diet, previous treatment…", wide: true }],
    columns: 1,
  },
  {
    title: "Vital signs",
    columns: 3,
    fields: [
      { key: "rectal_temperature", label: "Rectal temperature", unit: "°C", placeholder: "38.5" },
      { key: "weight", label: "Weight", unit: "kg", placeholder: "12.4" },
      { key: "cardiovascular_hr", label: "Cardiovascular (HR)", unit: "bpm", placeholder: "110" },
      { key: "respiratory_rr", label: "Respiratory (RR)", unit: "/min", placeholder: "24" },
      { key: "general_condition", label: "General condition", kind: "select", options: ["Excellent", "Good", "Fair", "Poor", "Critical"] },
      { key: "behavior", label: "Behavior", placeholder: "Alert, responsive" },
    ],
  },
  {
    title: "Body systems",
    description: "Use “Normal” for unremarkable findings, or describe what you observed.",
    columns: 2,
    fields: [
      { key: "integument", label: "Integument", placeholder: "Ext. parasites, wounds, laceration, hydration", normal: true },
      { key: "head_mouth_neck", label: "Head / mouth / neck", normal: true },
      { key: "eyes", label: "Eyes", normal: true },
      { key: "ears", label: "Ears", normal: true },
      { key: "nose", label: "Nose", normal: true },
      { key: "nervous", label: "Nervous", normal: true },
      { key: "musculoskeletal", label: "Musculo-skeletal", normal: true },
      { key: "abdomen_git", label: "Abdomen / GIT", normal: true },
      { key: "genito_urinary", label: "Genito-urinary", normal: true },
      { key: "pln", label: "PLN (peripheral lymph nodes)", normal: true },
    ],
  },
  {
    title: "Assessment",
    columns: 2,
    fields: [
      { key: "additional_comments", label: "Additional comments", kind: "area" },
      { key: "recommended_lab_works", label: "Recommended lab works", kind: "area", placeholder: "e.g. CBC, blood chem, 4Dx" },
    ],
  },
];

const LAB_GROUPS: FieldGroup[] = [
  {
    title: "Laboratory results",
    columns: 1,
    fields: [
      { key: "cbc_results", label: "CBC results", kind: "area" },
      { key: "blood_chemistry", label: "Blood chemistry", kind: "area" },
      { key: "test_kits", label: "Test kits", kind: "area", placeholder: "e.g. Parvo, Distemper, 4Dx" },
    ],
  },
  {
    title: "Imaging & other tests",
    columns: 2,
    fields: [
      { key: "xray_utz_ua", label: "X-ray / UTZ / UA", kind: "area" },
      { key: "other_lab_works", label: "Other lab works", kind: "area" },
    ],
  },
  {
    title: "Recommendation & diagnosis",
    columns: 2,
    fields: [
      { key: "recommended_procedure", label: "Recommended procedure", kind: "area" },
      { key: "tentative_diagnosis", label: "Tentative diagnosis", kind: "area" },
    ],
  },
];

const fieldKeys = (groups: FieldGroup[]) => groups.flatMap((g) => g.fields.map((f) => f.key));
const PHYSICAL_KEYS = fieldKeys(PHYSICAL_GROUPS);
const LAB_KEYS = fieldKeys(LAB_GROUPS);

/* ---------- Helpers ---------- */

const filled = (v: unknown) => String(v ?? "").trim() !== "";
const columnHasData = (c: ExamColumn, keys: string[]) => filled(c.date_time) || keys.some((k) => filled(c[k]));

function fmtDateTime(value?: string | null, withYear = false) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}),
    hour: "numeric", minute: "2-digit",
  });
}

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/* ---------- Primitives ---------- */

function Label({ htmlFor, children, unit }: { htmlFor: string; children: ReactNode; unit?: string }) {
  return (
    <label htmlFor={htmlFor} className="flex items-baseline justify-between gap-2 text-[13px] font-medium text-[hsl(var(--foreground))]">
      <span>{children}</span>
      {unit && <span className="text-xs font-normal text-[hsl(var(--muted-foreground))]">{unit}</span>}
    </label>
  );
}

function SelectControl({
  id, value, onChange, options,
}: { id: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="relative">
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={`${CONTROL} h-10 appearance-none pr-9`}>
        <option value="">Select…</option>
        {options.map((o) => <option key={o}>{o}</option>)}
        {value && !options.includes(value) && <option>{value}</option>}
      </select>
      <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
    </div>
  );
}

function FieldControl({
  id, def, value, onChange,
}: { id: string; def: FieldDef; value: string; onChange: (v: string) => void }) {
  const isNormal = value.trim().toLowerCase() === "normal";
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${def.wide ? "sm:col-span-full" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} unit={def.normal ? undefined : def.unit}>{def.label}</Label>
        {def.normal && (
          <button
            type="button"
            aria-pressed={isNormal}
            onClick={() => onChange(isNormal ? "" : "Normal")}
            className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-semibold transition ${RING} ${
              isNormal
                ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary)/.5)] hover:text-[hsl(var(--foreground))]"
            }`}
          >
            {isNormal && <Check size={11} strokeWidth={3} aria-hidden="true" />}
            Normal
          </button>
        )}
      </div>
      {def.kind === "area" ? (
        <textarea
          id={id}
          rows={3}
          value={value}
          placeholder={def.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${CONTROL} min-h-[84px] resize-y py-2 leading-relaxed`}
        />
      ) : def.kind === "select" ? (
        <SelectControl id={id} value={value} onChange={onChange} options={def.options ?? []} />
      ) : (
        <input
          id={id}
          type="text"
          inputMode={def.unit && !def.normal ? "decimal" : undefined}
          value={value}
          placeholder={def.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${CONTROL} h-10`}
        />
      )}
    </div>
  );
}

function TextField({
  id, label, value, onChange, type = "text", placeholder, icon: Icon,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; icon?: typeof User;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        {Icon && <Icon size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />}
        <input
          id={id} type={type} value={value} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${CONTROL} h-10 ${Icon ? "pl-9" : ""}`}
        />
      </div>
    </div>
  );
}

function Panel({
  title, description, action, children,
}: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[hsl(var(--border))] px-5 py-3.5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">{title}</h3>
          {description && <p className="mt-0.5 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">{description}</p>}
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

const gridCols = (n: 1 | 2 | 3 = 2) =>
  n === 1 ? "grid gap-4" : n === 2 ? "grid gap-4 sm:grid-cols-2" : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

function SectionIntro({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight text-[hsl(var(--foreground))]">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{description}</p>
      </div>
      {action}
    </div>
  );
}

/* ---------- Owner & patient ---------- */

function OwnerSection({ value, onChange }: { value: OwnerInfo; onChange: (v: OwnerInfo) => void }) {
  const set = (k: keyof OwnerInfo) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="flex flex-col gap-5">
      <SectionIntro title="Owner information" description="Contact details for the pet's owner, as written at the top of the clinic form." />
      <Panel title="Contact details">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField id="owner_name" label="Owner's name" icon={User} value={value.name} onChange={set("name")} />
          <TextField id="owner_contact" label="Contact no. / FB Messenger" icon={Phone} value={value.contact} onChange={set("contact")} />
          <TextField id="owner_email" label="Email" type="email" icon={Mail} value={value.email} onChange={set("email")} />
          <TextField id="owner_address" label="Address" icon={MapPin} value={value.address} onChange={set("address")} />
        </div>
      </Panel>
    </div>
  );
}

function PatientSection({ value, onChange }: { value: PatientInfo; onChange: (v: PatientInfo) => void }) {
  const set = (k: keyof PatientInfo) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="flex flex-col gap-5">
      <SectionIntro title="Patient information" description="Signalment and preventive care history." />
      <Panel title="Signalment">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextField id="pet_name" label="Pet's name" value={value.name} onChange={set("name")} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pet_species">Species</Label>
            <SelectControl id="pet_species" value={value.species} onChange={set("species")} options={["Canine", "Feline", "Others"]} />
          </div>
          <TextField id="pet_breed" label="Breed" value={value.breed} onChange={set("breed")} />
          <TextField id="pet_age_dob" label="Age / DOB" placeholder="e.g. 3 yrs or 2023-04-12" value={value.age_dob} onChange={set("age_dob")} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pet_sex">Sex</Label>
            <SelectControl id="pet_sex" value={value.sex} onChange={set("sex")} options={["Male", "Female"]} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pet_neutered">Neutered / spayed</Label>
            <SelectControl id="pet_neutered" value={value.neutered_spayed} onChange={set("neutered_spayed")} options={["Yes", "No"]} />
          </div>
        </div>
      </Panel>
      <Panel title="Preventive care" description="Include the product and date of the latest dose.">
        <div className="grid gap-4 lg:grid-cols-3">
          <TextField id="pet_multivalent" label="Multivalent vaccines" placeholder="5-in-1 · 3 doses · 03/2026" value={value.multivalent_vaccines} onChange={set("multivalent_vaccines")} />
          <TextField id="pet_anti_rabies" label="Anti-rabies vaccine" placeholder="05/2026" value={value.anti_rabies_vaccine} onChange={set("anti_rabies_vaccine")} />
          <TextField id="pet_deworming" label="Deworming / tick / flea / mites" placeholder="Bravecto · 08/2026" value={value.deworming_tick_flea_mites} onChange={set("deworming_tick_flea_mites")} />
        </div>
      </Panel>
    </div>
  );
}

/* ---------- Exam-style sections (4 dated entries, like the paper form) ---------- */

function EntryPicker({
  columns, keys, active, onSelect, noun,
}: { columns: ExamColumn[]; keys: string[]; active: number; onSelect: (i: number) => void; noun: string }) {
  return (
    <div role="tablist" aria-label={`${noun} entries`} className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {columns.map((c, i) => {
        const selected = i === active;
        const hasData = columnHasData(c, keys);
        const date = fmtDateTime(c.date_time);
        return (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(i)}
            className={`flex min-w-0 items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition ${RING} ${
              selected
                ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/.06)] shadow-[0_0_0_1px_hsl(var(--primary))]"
                : "border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--muted-foreground)/.4)]"
            }`}
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                hasData
                  ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                  : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
              }`}
            >
              {hasData ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[hsl(var(--foreground))]">{noun} {i + 1}</span>
              <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">
                {date ?? (hasData ? "No date set" : "Not recorded")}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ExamSection({
  title, description, noun, groups, keys, columns, onChange,
}: {
  title: string; description: string; noun: string; groups: FieldGroup[]; keys: string[];
  columns: ExamColumn[]; onChange: (c: ExamColumn[]) => void;
}) {
  const firstEmpty = columns.findIndex((c) => !columnHasData(c, keys));
  const [active, setActive] = useState(() => {
    const lastFilled = columns.map((c) => columnHasData(c, keys)).lastIndexOf(true);
    return Math.max(0, lastFilled);
  });
  const col = columns[active];
  const prefix = `${noun.toLowerCase()}-${active}`;

  const setCell = (key: string, v: string) =>
    onChange(columns.map((c, i) => (i === active ? { ...c, [key]: v } : c)));

  const markAllNormal = (group: FieldGroup) =>
    onChange(columns.map((c, i) => {
      if (i !== active) return c;
      const next = { ...c };
      group.fields.forEach((f) => { if (f.normal && !filled(next[f.key])) next[f.key] = "Normal"; });
      return next;
    }));

  const clearEntry = () => {
    if (!window.confirm(`Clear everything in ${noun} ${active + 1}?`)) return;
    onChange(columns.map((c, i) => (i === active ? { date_time: "" } : c)));
  };

  return (
    <div className="flex flex-col gap-5">
      <SectionIntro
        title={title}
        description={description}
        action={firstEmpty !== -1 && firstEmpty !== active ? (
          <button type="button" className={BTN_OUTLINE} onClick={() => setActive(firstEmpty)}>
            <Plus size={16} aria-hidden="true" /> New {noun.toLowerCase()}
          </button>
        ) : undefined}
      />

      <EntryPicker columns={columns} keys={keys} active={active} onSelect={setActive} noun={noun} />

      <div role="tabpanel" aria-label={`${noun} ${active + 1}`} className="flex flex-col gap-4">
        <Panel
          title={`${noun} ${active + 1}`}
          description="Date and time this entry was recorded."
          action={columnHasData(col, keys) ? (
            <button type="button" onClick={clearEntry} className={`${BTN_GHOST_SM} hover:text-[hsl(var(--destructive))]`}>
              <Trash2 size={14} aria-hidden="true" /> Clear entry
            </button>
          ) : undefined}
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex w-full max-w-xs flex-col gap-1.5">
              <Label htmlFor={`${prefix}-date`}>Date & time</Label>
              <input
                id={`${prefix}-date`}
                type="datetime-local"
                value={col.date_time ?? ""}
                onChange={(e) => setCell("date_time", e.target.value)}
                className={`${CONTROL} h-10`}
              />
            </div>
            {!filled(col.date_time) && (
              <button type="button" className={`${BTN_OUTLINE} h-10`} onClick={() => setCell("date_time", nowLocal())}>
                <Calendar size={15} aria-hidden="true" /> Use current time
              </button>
            )}
          </div>
        </Panel>

        {groups.map((group) => {
          const normals = group.fields.filter((f) => f.normal);
          const canMarkAll = normals.some((f) => !filled(col[f.key]));
          return (
            <Panel
              key={group.title}
              title={group.title}
              description={group.description}
              action={normals.length > 0 ? (
                <button type="button" className={BTN_GHOST_SM} disabled={!canMarkAll} onClick={() => markAllNormal(group)}>
                  <CheckCheck size={14} aria-hidden="true" /> Mark remaining normal
                </button>
              ) : undefined}
            >
              <div className={gridCols(group.columns)}>
                {group.fields.map((f) => (
                  <FieldControl
                    key={f.key}
                    id={`${prefix}-${f.key}`}
                    def={f}
                    value={col[f.key] ?? ""}
                    onChange={(v) => setCell(f.key, v)}
                  />
                ))}
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Monitoring & treatment ---------- */

const MONITORING_FIELDS: { key: Extract<keyof MonitoringRow, string>; label: string; area?: boolean; placeholder?: string }[] = [
  { key: "diagnosis", label: "Diagnosis", area: true },
  { key: "observations", label: "Observations", area: true },
  { key: "medications_procedure", label: "Medications / procedure", area: true },
  { key: "dosage_frequency", label: "Dosage & frequency", area: true, placeholder: "e.g. 250 mg PO BID × 7 days" },
];

function MonitoringSection({ rows, onChange }: { rows: MonitoringRow[]; onChange: (r: MonitoringRow[]) => void }) {
  const setCell = (r: number, key: keyof MonitoringRow, v: string) =>
    onChange(rows.map((row, i) => (i === r ? { ...row, [key]: v } : row)));
  const remove = (r: number) => {
    if (Object.values(rows[r]).some(filled) && !window.confirm(`Remove entry ${r + 1}?`)) return;
    const next = rows.filter((_, i) => i !== r);
    onChange(next.length ? next : [emptyMonitoringRow()]);
  };
  const add = () => onChange([...rows, { ...emptyMonitoringRow(), date_time: nowLocal() }]);

  return (
    <div className="flex flex-col gap-5">
      <SectionIntro
        title="Monitoring & treatment plan"
        description="Log one entry per check-up, treatment, or medication change."
        action={<button type="button" className={BTN_OUTLINE} onClick={add}><Plus size={16} aria-hidden="true" /> Add entry</button>}
      />

      <ol className="flex flex-col gap-4">
        {rows.map((row, r) => {
          const p = `mon-${r}`;
          return (
            <li key={r} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
              <header className="flex items-center justify-between gap-3 border-b border-[hsl(var(--border))] px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--muted))] text-xs font-bold text-[hsl(var(--foreground))]">
                    {r + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[hsl(var(--foreground))]">Entry {r + 1}</p>
                    <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{fmtDateTime(row.date_time, true) ?? "No date set"}</p>
                  </div>
                </div>
                <button type="button" onClick={() => remove(r)} aria-label={`Remove entry ${r + 1}`} className={`${BTN_GHOST_SM} hover:text-[hsl(var(--destructive))]`}>
                  <Trash2 size={14} aria-hidden="true" /> <span className="hidden sm:inline">Remove</span>
                </button>
              </header>
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${p}-date`}>Date & time</Label>
                  <input id={`${p}-date`} type="datetime-local" value={row.date_time} onChange={(e) => setCell(r, "date_time", e.target.value)} className={`${CONTROL} h-10`} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${p}-tw`}>Temp & weight</Label>
                  <input id={`${p}-tw`} type="text" placeholder="38.6 °C · 12.1 kg" value={row.temp_weight} onChange={(e) => setCell(r, "temp_weight", e.target.value)} className={`${CONTROL} h-10`} />
                </div>
                {MONITORING_FIELDS.map((f) => (
                  <div key={f.key} className="flex flex-col gap-1.5">
                    <Label htmlFor={`${p}-${f.key}`}>{f.label}</Label>
                    <textarea
                      id={`${p}-${f.key}`} rows={2} value={row[f.key]} placeholder={f.placeholder}
                      onChange={(e) => setCell(r, f.key, e.target.value)}
                      className={`${CONTROL} min-h-[72px] resize-y py-2 leading-relaxed`}
                    />
                  </div>
                ))}
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label htmlFor={`${p}-remarks`}>Remarks</Label>
                  <input id={`${p}-remarks`} type="text" value={row.remarks} onChange={(e) => setCell(r, "remarks", e.target.value)} className={`${CONTROL} h-10`} />
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        onClick={add}
        className={`flex h-12 items-center justify-center gap-2 rounded-xl border border-dashed border-[hsl(var(--border))] text-sm font-semibold text-[hsl(var(--muted-foreground))] transition hover:border-[hsl(var(--primary)/.5)] hover:bg-[hsl(var(--primary)/.04)] hover:text-[hsl(var(--primary))] ${RING}`}
      >
        <Plus size={16} aria-hidden="true" /> Add another entry
      </button>
    </div>
  );
}

/* ---------- Shell ---------- */

type SectionKey = "owner" | "patient" | "physical" | "lab" | "monitoring";

function sectionProgress(record: MedicalRecord): Record<SectionKey, { label: string; complete: boolean }> {
  const o = record.owner_info;
  const ownerDone = [o.name, o.contact, o.address, o.email].filter(filled).length;
  const p = record.patient_info;
  const patientVals = [p.name, p.species, p.breed, p.age_dob, p.sex, p.neutered_spayed, p.multivalent_vaccines, p.anti_rabies_vaccine, p.deworming_tick_flea_mites];
  const patientDone = patientVals.filter(filled).length;
  const exams = record.physical_exam.filter((c) => columnHasData(c, PHYSICAL_KEYS)).length;
  const labs = record.lab.filter((c) => columnHasData(c, LAB_KEYS)).length;
  const mons = record.monitoring.filter((r) => Object.values(r).some(filled)).length;
  return {
    owner: { label: `${ownerDone}/4 fields`, complete: ownerDone === 4 },
    patient: { label: `${patientDone}/${patientVals.length} fields`, complete: patientDone === patientVals.length },
    physical: { label: exams ? `${exams} of 4 exams` : "No exams yet", complete: exams > 0 },
    lab: { label: labs ? `${labs} of 4 results` : "No results yet", complete: labs > 0 },
    monitoring: { label: mons ? `${mons} ${mons === 1 ? "entry" : "entries"}` : "No entries yet", complete: mons > 0 },
  };
}

const NAV: { key: SectionKey; label: string; icon: typeof User; group: string }[] = [
  { key: "owner", label: "Owner", icon: User, group: "Profile" },
  { key: "patient", label: "Patient", icon: PawPrint, group: "Profile" },
  { key: "physical", label: "Physical examination", icon: Stethoscope, group: "Clinical" },
  { key: "lab", label: "Lab tests & diagnosis", icon: FlaskConical, group: "Clinical" },
  { key: "monitoring", label: "Monitoring & treatment", icon: ClipboardList, group: "Clinical" },
];

function SectionNav({
  active, onSelect, progress,
}: { active: SectionKey; onSelect: (k: SectionKey) => void; progress: ReturnType<typeof sectionProgress> }) {
  const groups = ["Profile", "Clinical"];
  return (
    <nav aria-label="Record sections" className="shrink-0 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.35)] md:w-64 md:border-b-0 md:border-r">
      <div className="flex gap-1 overflow-x-auto p-2 md:flex-col md:gap-5 md:overflow-visible md:p-4">
        {groups.map((g) => (
          <div key={g} className="flex gap-1 md:flex-col">
            <p className="hidden px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] md:block">{g}</p>
            {NAV.filter((n) => n.group === g).map(({ key, label, icon: Icon }) => {
              const selected = active === key;
              const prog = progress[key];
              return (
                <button
                  key={key}
                  type="button"
                  aria-current={selected ? "page" : undefined}
                  onClick={() => onSelect(key)}
                  className={`group flex shrink-0 items-center gap-3 rounded-lg px-2.5 py-2 text-left transition ${RING} ${
                    selected
                      ? "bg-[hsl(var(--background))] shadow-sm ring-1 ring-[hsl(var(--border))]"
                      : "hover:bg-[hsl(var(--background)/.7)]"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                      selected ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))] ring-1 ring-[hsl(var(--border))]"
                    }`}
                  >
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className={`block whitespace-nowrap text-sm font-medium md:whitespace-normal ${selected ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--foreground)/.85)]"}`}>
                      {label}
                    </span>
                    <span className="hidden items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] md:flex">
                      {prog.complete && <Check size={12} strokeWidth={3} className="text-[hsl(var(--primary))]" aria-hidden="true" />}
                      {prog.label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}

function PatientSummary({ record }: { record: MedicalRecord }) {
  const p = record.patient_info;
  const meta = [p.species, p.breed, p.sex, p.age_dob].filter(filled);
  return (
    <div className="flex min-w-0 items-center gap-4">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
        <PawPrint size={22} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Medical record</p>
        <DialogTitle className="truncate text-xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
          {p.name || "Unnamed patient"}
        </DialogTitle>
        <DialogDescription asChild>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[hsl(var(--muted-foreground))]">
            {meta.length > 0 && <span>{meta.join(" · ")}</span>}
            {filled(record.owner_info.name) && (
              <span className="inline-flex items-center gap-1.5"><User size={13} aria-hidden="true" />{record.owner_info.name}</span>
            )}
            {filled(record.owner_info.contact) && (
              <span className="inline-flex items-center gap-1.5"><Phone size={13} aria-hidden="true" />{record.owner_info.contact}</span>
            )}
          </div>
        </DialogDescription>
      </div>
    </div>
  );
}

/* Keyed by pet and save time, so it starts fresh from the loaded record. */
function RecordForm({ pet, initial, onClose }: { pet: any; initial: MedicalRecord; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<SectionKey>("physical");
  const [record, setRecord] = useState<MedicalRecord>(initial);
  const [dirty, setDirty] = useState(false);

  const update = <K extends keyof MedicalRecord>(key: K) => (value: MedicalRecord[K]) => {
    setRecord((r) => ({ ...r, [key]: value }));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () => saveMedicalRecord(record),
    onSuccess: (saved) => {
      queryClient.setQueryData(["medical-record", pet.id], saved);
      setDirty(false);
      toast.success(`Record for ${record.patient_info.name || pet.name} saved.`);
      onClose();
    },
    onError: (err: any) => toast.error(err?.message || "Couldn't save the record."),
  });

  const close = () => {
    if (dirty && !window.confirm("You have unsaved changes. Close without saving?")) return;
    onClose();
  };

  const progress = sectionProgress(record);
  const savedAt = fmtDateTime(initial.updated_at, true);

  return (
    <form
      className="flex h-full min-h-0 flex-col"
      onSubmit={(e) => { e.preventDefault(); if (!save.isPending) save.mutate(); }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); close(); }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          if (!save.isPending) save.mutate();
        }
      }}
    >
      <header className="flex items-start justify-between gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] px-5 py-4 md:px-6">
        <PatientSummary record={record} />
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] ${RING}`}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <SectionNav active={section} onSelect={setSection} progress={progress} />
        <main className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--background))]">
          <div className="mx-auto w-full max-w-4xl px-5 py-6 md:px-8">
            {section === "owner" && <OwnerSection value={record.owner_info} onChange={update("owner_info")} />}
            {section === "patient" && <PatientSection value={record.patient_info} onChange={update("patient_info")} />}
            {section === "physical" && (
              <ExamSection
                title="Physical examination"
                description="Up to 4 dated examinations, matching the clinic's paper form. Pick an exam, then record the findings."
                noun="Exam"
                groups={PHYSICAL_GROUPS}
                keys={PHYSICAL_KEYS}
                columns={record.physical_exam}
                onChange={update("physical_exam")}
              />
            )}
            {section === "lab" && (
              <ExamSection
                title="Laboratory tests, recommendation & diagnosis"
                description="Up to 4 dated result sets. Pick a result set, then enter the findings."
                noun="Result"
                groups={LAB_GROUPS}
                keys={LAB_KEYS}
                columns={record.lab}
                onChange={update("lab")}
              />
            )}
            {section === "monitoring" && <MonitoringSection rows={record.monitoring} onChange={update("monitoring")} />}
          </div>
        </main>
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] px-5 py-3 md:px-6">
        <p className="mr-auto flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]" aria-live="polite">
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${dirty ? "bg-amber-500" : savedAt ? "bg-emerald-500" : "bg-[hsl(var(--muted-foreground)/.4)]"}`}
          />
          {dirty ? "Unsaved changes" : savedAt ? `Saved ${savedAt}` : "Not saved yet"}
          <span className="hidden text-[hsl(var(--muted-foreground)/.7)] lg:inline">· Ctrl/⌘ + S to save</span>
        </p>
        <button type="button" onClick={close} className={BTN_OUTLINE}>Cancel</button>
        <button type="submit" disabled={save.isPending} className={BTN_PRIMARY}>
          {save.isPending && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
          {save.isPending ? "Saving…" : "Save record"}
        </button>
      </footer>
    </form>
  );
}

export default function PatientRecordDialog({ pet, onClose }: { pet: any | null; onClose: () => void }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["medical-record", pet?.id],
    queryFn: () => fetchMedicalRecord(pet.id),
    enabled: !!pet,
  });

  return (
    <Dialog open={!!pet} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        /* The form handles Escape and outside clicks itself, so unsaved
           changes are not lost by accident. */
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="flex h-[100dvh] w-full max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-[hsl(var(--background))] p-0 sm:h-[92vh] sm:w-[calc(100vw-2rem)] sm:max-w-[1240px] sm:rounded-2xl sm:border sm:border-[hsl(var(--border))] [&>button]:hidden"
      >
        {!pet ? null : isLoading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3" role="status" aria-live="polite">
            <DialogTitle className="sr-only">Loading medical record</DialogTitle>
            <DialogDescription className="sr-only">Loading the record for {pet.name}</DialogDescription>
            <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading record…</p>
          </div>
        ) : isError ? (
          <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--destructive)/.1)]">
              <AlertTriangle className="text-[hsl(var(--destructive))]" aria-hidden="true" />
            </span>
            <DialogTitle className="mt-4 text-base font-semibold">Couldn&apos;t load the record</DialogTitle>
            <DialogDescription className="mx-auto mt-1 max-w-sm text-sm text-[hsl(var(--muted-foreground))]">
              Check your connection and try again.
            </DialogDescription>
            <div className="mt-5 flex justify-center gap-3">
              <button type="button" onClick={onClose} className={BTN_OUTLINE}>Close</button>
              <button type="button" onClick={() => void refetch()} className={BTN_PRIMARY}>Try again</button>
            </div>
          </div>
        ) : (
          <RecordForm
            key={`${pet.id}-${data?.updated_at ?? "new"}`}
            pet={pet}
            initial={buildRecord(pet, data)}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

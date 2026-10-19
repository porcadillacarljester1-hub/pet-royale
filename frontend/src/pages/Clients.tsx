import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AdminLayout from "@/components/AdminLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchClientsWithPets, deleteClient,
} from "@/api/clients";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import type { ClientWithPets } from "@/types";
// xlsx-js-style is SheetJS with cell styles and frozen panes. Install: npm i xlsx-js-style
import * as XLSX from "xlsx-js-style";
import { useAdminStore } from "@/store/adminStore";
import PatientChartDialog from "@/components/PatientChartDialog";
import {
  X, Loader2, Check, Clock3, AlertTriangle,
  Trash2, ChevronDown, Plus,
  PawPrint, FileSpreadsheet, Search, FileText,
} from "lucide-react";

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]";

/* A patient with no completed visit for this many days shows "Follow-up due". */
const DUE_DAYS = 182;
const PAGE_SIZE = 25;
/* Where "Book visit" goes. It opens Appointments and passes the pet along in
   the navigation state (state.walkInPetId). Change the path if your route
   differs. */
const BOOK_ROUTE = "/appointments";

/* Same look as the Dashboard and Appointments screens: 1px panels with a soft
   shadow, small sentence-case table headings, 10px-radius controls and a 44px
   toolbar row. */
const PAGE_WRAP = "mx-auto w-full max-w-[1440px] space-y-4 px-5 pb-8 sm:px-8 lg:px-10";
const CARD =
  "rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] shadow-[0_1px_2px_rgb(15_36_71/.05),0_4px_16px_rgb(15_36_71/.05)]";
/* PANEL clips row content; CARD does not, so a toolbar card can hold pickers. */
const PANEL =
  "-mx-5 overflow-hidden rounded-none border border-[hsl(var(--border))] bg-white sm:-mx-8 lg:-mx-10";
const TABLE_HEAD =
  "hidden gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.45)] px-6 py-3 text-[13px] font-semibold text-[hsl(var(--muted-foreground))] lg:grid";
/* Segmented tabs: one soft track with a navy tab for the chosen view. */
/* Toolbar buttons: 40px high, 10px radius. */
const CTL_BASE =
  `inline-flex h-10 items-center justify-center rounded-[10px] text-[14px] font-bold ${FOCUS_RING}`;
const CTL_FIELD = "border-[1.5px] border-[hsl(var(--primary))] bg-white text-[hsl(var(--primary))]";
/* Previous / Next, as on the Dashboard. */
const PAGER_BTN =
  `h-10 rounded-full border-[1.5px] border-[hsl(var(--primary))] px-5 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-30 ${FOCUS_RING}`;

/* Capitalizes the first letter of each word without touching the rest,
   so "dos" becomes "Dos" and "McDonald" stays "McDonald". */
const titleCase = (s?: string | null) => (s || "").replace(/(^|\s)\S/g, (c) => c.toUpperCase());

function SearchField({
  label, value, onChange, className = "",
}: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <label className={`flex h-10 items-center gap-2 rounded-[10px] border border-[hsl(var(--card-border))] bg-white px-3 focus-within:border-[hsl(var(--primary))] focus-within:ring-2 focus-within:ring-[hsl(var(--primary)/.15)] ${className}`}>
      <Search size={16} className="shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-[14px] !outline-none !ring-0 !shadow-none placeholder:text-[hsl(var(--muted-foreground))]"
      />
    </label>
  );
}

function SelectField({
  label, value, onChange, children, className = "",
}: {
  label: string; value: string; onChange: React.ChangeEventHandler<HTMLSelectElement>;
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={onChange}
        aria-label={label}
        className={`h-10 w-full appearance-none rounded-[10px] border border-[hsl(var(--card-border))] bg-white pl-3 pr-9 text-[14px] font-semibold transition focus:border-[hsl(var(--accent))] ${FOCUS_RING}`}
      >
        {children}
      </select>
      <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
    </div>
  );
}

/* Small button used inside rows (Book visit). */
const ROW_BTN =
  `inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] px-4 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-[hsl(var(--card))] ${FOCUS_RING}`;

/* Round profile photo (or initials) in the 2px navy ring the Appointments
   and Dashboard patient cells use. */
function RingAvatar({
  src, initials, className = "h-10 w-10", textClass = "text-[14px]",
}: {
  src?: string | null; initials: string; className?: string; textClass?: string;
}) {
  /* A photo that fails to load falls back to the initials rather than a
     broken-image icon. Google profile photos need no-referrer: Google's
     image server can refuse a request that carries this site's address. */
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return (
    <div className={`shrink-0 overflow-hidden rounded-full border-2 border-[hsl(var(--primary))] ${className}`}>
      {src && failedSrc !== src ? (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className={`flex h-full w-full items-center justify-center bg-[hsl(43_85%_93%)] font-extrabold text-[hsl(var(--primary))] ${textClass}`}
          aria-hidden="true"
        >
          {initials}
        </div>
      )}
    </div>
  );
}

/* Column layouts. Patients view: Patient, Owner, Last visit,
   Status, Action. Owners view: Owner, Email, Phone, Pets, Last visit,
   Action. The pets of an owner show as rows, so they need no columns.
   Patient gets the most room because its line (species, age, sex) is the
   longest; the Pets column is wide enough for two avatars and the count. */
/* The Action column holds two buttons: Record and Book visit. */
const PATIENT_COLS = "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_236px]";
const RECORD_COLS = "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.9fr)_minmax(0,1fr)_180px]";
const OWNER_COLS = "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_96px_minmax(0,1fr)_96px]";
const EMPTY_OWNER_COLS = "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_84px_100px]";
const PET_ROW_COLS = "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_236px]";

/* requested_date can be null on older rows, and `new Date(null +
   "T00:00:00")` renders as "Invalid Date" rather than failing. */
function fmtDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value.length === 10 ? value + "T00:00:00" : value);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysSince(value?: string | null) {
  if (!value) return null;
  const d = new Date(value.length === 10 ? value + "T00:00:00" : value);
  return Number.isNaN(d.getTime()) ? null : Math.floor((Date.now() - d.getTime()) / 864e5);
}

/* Today's date as YYYY-MM-DD in local time (toISOString() is UTC, a day
   behind before 8:00 AM in the Philippines). */
function localToday() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

type VisitState = "seen" | "due" | "never" | "upcoming";
/* Only call once the visits have loaded; before that every pet would look
   "never seen". */
function visitStateOf(pet: any): VisitState {
  if (pet.followUp) return pet.followUp.state;
  if (!pet.visitCount) return "never";
  const d = daysSince(pet.lastVisit);
  return d != null && d > DUE_DAYS ? "due" : "seen";
}

/* Two-letter initials for an owner with no photo. Shared by the list
   row and the owner panel so both fall back the same way. */
function initialsOf(name?: string | null) {
  return (name || "")
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
}

function petLine(pet: any) {
  const age = pet.age != null ? `${pet.age} yr${Number(pet.age) === 1 ? "" : "s"}` : "Age not set";
  return [pet.species, age, pet.gender].filter(Boolean).join(" · ");
}

/* Display only: +639502791505 shows as +63 950 279 1505. Anything that isn't
   a Philippine mobile number in that form is shown exactly as stored. Search
   and the Excel export still use the stored number. */
function fmtPhone(p?: string | null) {
  if (!p) return "";
  const m = String(p).trim().match(/^\+63(\d{3})(\d{3})(\d{4})$/);
  return m ? `+63 ${m[1]} ${m[2]} ${m[3]}` : String(p);
}

function exportPatients(rows: any[]) {
  const TEAL = "0E4F45", INK = "1A1A1A", GRID = "D9D9D9";
  const header = [
    "Owner name", "Owner email", "Owner phone",
    "Pet name", "Species", "Sex", "Age (yrs)", "Visits", "Last visit",
  ];

  const body = rows.map((p) => [
    p.owner?.name ?? "",
    p.owner?.email ?? "",
    (p.owner as any)?.phone ?? "",
    p.name ?? "",
    p.species ?? "",
    p.gender ?? "",
    p.age ?? "",
    p.visitCount ?? 0,
    p.lastVisit ? p.lastVisit.slice(0, 10) : "",
  ]);

  const sheet: any = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = [
    { wch: 24 }, { wch: 28 }, { wch: 16 }, { wch: 16 },
    { wch: 14 }, { wch: 9 }, { wch: 11 }, { wch: 9 }, { wch: 12 },
  ];

  const numCols = [6, 7];
  const lastCol = header.length - 1;
  const paint = (r: number, c: number, st: Record<string, unknown>) => {
    const ref = XLSX.utils.encode_cell({ r, c });
    if (!sheet[ref]) sheet[ref] = { t: "s", v: "" };
    sheet[ref].s = st;
  };
  for (let c = 0; c <= lastCol; c++) {
    paint(0, c, {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { patternType: "solid", fgColor: { rgb: TEAL } },
      alignment: { vertical: "center", horizontal: numCols.includes(c) ? "right" : "left" },
      border: { bottom: { style: "medium", color: { rgb: INK } } },
    });
  }
  for (let r = 1; r <= body.length; r++) {
    for (let c = 0; c <= lastCol; c++) {
      paint(r, c, {
        alignment: { vertical: "center", horizontal: numCols.includes(c) ? "right" : "left" },
        border: { bottom: { style: "thin", color: { rgb: GRID } } },
      });
    }
  }
  sheet["!rows"] = [{ hpt: 22 }];
  sheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(lastCol)}${body.length + 1}` };
  sheet["!freeze"] = { xSplit: "0", ySplit: "1", topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Patients");
  XLSX.writeFile(book, `pet-royale-patients_${localToday()}.xlsx`);
}

async function fetchVisitsByPet() {
  /* One request returns at most 1000 rows. Without paging, a clinic with more
     appointments than that would silently lose the oldest ones, and patients
     would show "Never seen" or a wrong visit count. */
  const PAGE = 1000;
  const all: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await (supabase as any)
      .from("appointments")
      .select("id, pet_id, service, requested_date, scheduled_time, status")
      .order("requested_date", { ascending: false })
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }

  const byPet: Record<string, any[]> = {};
  all.forEach((a: any) => {
    if (a.pet_id) (byPet[a.pet_id] ||= []).push(a);
  });
  return byPet;
}

/* Seen / Follow-up due / Never seen: soft filled chip, same shape as the
   Appointments status pills. */
function StatusChip({ state, date }: { state: VisitState; date?: string | null }) {
  const base = "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-bold";
  if (state === "seen") {
    return (
      <span className={`${base} bg-[hsl(145_40%_90%)] text-[hsl(145_42%_24%)]`}>
        <Check size={13} strokeWidth={3} aria-hidden="true" /> Seen
      </span>
    );
  }
  if (state === "upcoming") {
    return (
      <span className={`${base} bg-[hsl(40_80%_90%)] text-[hsl(40_70%_26%)]`}>
        <Clock3 size={13} strokeWidth={3} aria-hidden="true" /> Follow-up {fmtDate(date) ?? ""}
      </span>
    );
  }
  if (state === "due") {
    return (
      <span className={`${base} bg-[hsl(40_80%_90%)] text-[hsl(40_70%_26%)]`}>
        <Clock3 size={13} strokeWidth={3} aria-hidden="true" /> Follow-up due
      </span>
    );
  }
  return (
    <span className={`${base} bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]`}>
      Never seen
    </span>
  );
}

export default function Clients() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  // The list holds owners' phone numbers and emails, so only admins can download it.
  const isAdmin = useAdminStore((s) => s.role) === "admin";

  const { data: rawClients = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["clients-with-pets"], queryFn: fetchClientsWithPets,
  });
  /* Owner names are shown capitalized everywhere on this screen. */
  const clients = useMemo(
    () => rawClients.map((c: any) => ({ ...c, name: titleCase(c.name) })),
    [rawClients]
  );
  const { data: visitsByPet = {}, isLoading: visitsLoading, isError: visitsError, refetch: refetchVisits } = useQuery({
    queryKey: ["visits-by-pet"], queryFn: fetchVisitsByPet,
  });
  const {
    data: medicalRecords = [],
    isLoading: recordsLoading,
    isError: recordsError,
    error: recordsLoadError,
    refetch: refetchRecords,
  } = useQuery({
    queryKey: ["patient-medical-records"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("medical_records")
        .select("pet_id, updated_at, follow_up_date, follow_up_set_on");
      if (error) throw error;
      return data ?? [];
    },
  });
  const recordPetIds = useMemo(
    () => new Set<string>(medicalRecords.map((record: any) => record.pet_id).filter(Boolean)),
    [medicalRecords]
  );
  const followUpRecords = useMemo(
    () => Object.fromEntries(medicalRecords.filter((r: any) => r.pet_id).map((r: any) => [r.pet_id, r])),
    [medicalRecords]
  );
  /* Until the visits arrive (or if they fail to load) every pet would look
     "never seen". So nothing that depends on visits is shown as a number or a
     status until they are here. */
  /* Reminders already sent to owners: one row per pet per follow-up date. */
  const { data: reminders = [] } = useQuery({
    queryKey: ["pet-reminders"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("pet_reminders").select("pet_id, follow_up_date");
      if (error) throw error;
      return data ?? [];
    },
  });
  const reminderSent = (pet: any) =>
    reminders.some((r: any) => r.pet_id === pet.id && r.follow_up_date === pet.followUp?.date);

  const dataReady = !isLoading && !isError;
  const visitsReady = !visitsLoading && !visitsError;

  /* Which sidebar entry we are on: Pets (/clients), Owners
     (/clients/owners) or Medical Records (/clients/records). The route
     decides, so there is no in-page switch for it any more. */
  const section: "pets" | "owners" | "records" =
    location.pathname.endsWith("/owners") ? "owners" :
    location.pathname.endsWith("/records") ? "records" : "pets";
  const view: "Patients" | "Owners" = section === "owners" ? "Owners" : "Patients";
  const [petTab, setPetTab] = useState<"All patients" | "Follow-up due" | "Never seen">("All patients");
  const setPatientTab = setPetTab;
  const patientTab: "All patients" | "Follow-up due" | "Never seen" | "Records" =
    section === "records" ? "Records" : petTab;
  const [ownersWithoutPets, setOwnersWithoutPets] = useState(false);
  const [query, setQuery] = useState("");
  const [species, setSpecies] = useState("All species");
  const [gender, setGender] = useState("All genders");
  const [sort, setSort] = useState<{ key: "name" | "last"; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<ClientWithPets | null>(null);
  const [deleting, setDeleting] = useState(false);
  /* The patient whose medical record (the clinic's paper form) is open. */
  const [recordPet, setRecordPet] = useState<any | null>(null);
  /* The patient whose reminder is being sent right now. */
  const [sendingId, setSendingId] = useState<string | null>(null);

  /* Moving between the three entries keeps this same page mounted, so the
     open chart and the filters are cleared on every navigation (clicking
     the entry you are already on also returns from an open chart). */
  useEffect(() => {
    setRecordPet(null);
    setPetTab("All patients");
    setOwnersWithoutPets(false);
    setSpecies("All species");
    setGender("All genders");
    setPage(1);
    setExpandedId(null);
  }, [location.key]);

  const patients = useMemo(
    () => clients.flatMap((c: any) =>
      (c.pets || []).map((p: any) => {
        const visits = visitsByPet[p.id] || [];
        const today = localToday();
        /* Only visits that have happened: completed, and dated today or
           earlier. A completed visit with a future date is bad data and
           must not make a patient look "Seen". */
        const completed = visits.filter(
          (v: any) => v.status === "completed" && (v.requested_date ?? "") <= today
        );
        /* The vet's "Come back on" date. A visit completed after it was set
           means the follow-up has been done, so the 6-month rule applies again. */
        const record = followUpRecords[p.id];
        const setOn: string | null = record?.follow_up_set_on ?? null;
        const fulfilled = !!setOn && completed.some((v: any) => (v.requested_date ?? "") > setOn);
        const followDate: string | null = record?.follow_up_date ?? null;
        const followUp = followDate && !fulfilled
          ? { date: followDate, state: followDate <= today ? "due" : "upcoming" }
          : null;
        return {
          ...p,
          owner: c,
          visits,
          followUp,
          visitCount: completed.length,
          // The last visit that happened, not one booked and cancelled.
          lastVisit: completed[0]?.requested_date ?? null,
          lastService: completed[0]?.service ?? null,
        };
      })
    ),
    [clients, visitsByPet, followUpRecords]
  );

  const speciesOptions = useMemo(
    () => [...new Set(patients.map((p: any) => p.species).filter(Boolean))].sort(),
    [patients]
  );

  const counts = useMemo(() => {
    const ready = visitsReady;
    return {
      patients: patients.length,
      owners: clients.length,
      due: ready ? patients.filter((p: any) => visitStateOf(p) === "due").length : 0,
      neverSeen: ready ? patients.filter((p: any) => visitStateOf(p) === "never").length : 0,
      records: recordsLoading ? null : recordsError ? null : patients.filter((p: any) => recordPetIds.has(p.id)).length,
      ownersWithoutPets: clients.filter((c: any) => !c.pets?.length).length,
    };
  }, [patients, clients, visitsReady, recordPetIds, recordsLoading, recordsError]);

  const q = query.trim().toLowerCase();
  const hasPetFilter = species !== "All species" || gender !== "All genders";
  const hasFilters = !!q || hasPetFilter || petTab !== "All patients" || ownersWithoutPets;

  const ownerTextMatches = (owner: any) =>
    !q || [owner?.name, owner?.email, owner?.phone].filter(Boolean).join(" ").toLowerCase().includes(q);

  const petMatches = (pet: any) => {
    const text = !q || ownerTextMatches(pet.owner) || (pet.name || "").toLowerCase().includes(q);
    const speciesOk = species === "All species" || pet.species === species;
    const genderOk = gender === "All genders" || pet.gender === gender;
    const scopeOk =
      patientTab === "Follow-up due" ? visitStateOf(pet) === "due" :
      patientTab === "Never seen" ? visitStateOf(pet) === "never" :
      patientTab === "Records" ? recordPetIds.has(pet.id) : true;
    return text && speciesOk && genderOk && scopeOk;
  };

  const filteredPets = useMemo(
    () => patients.filter(petMatches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patients, q, species, gender, patientTab, recordPetIds]
  );

  const ownerGroups = useMemo(() => {
    const all = clients.map((owner: any) => {
      const pets = patients.filter((patient: any) => patient.owner?.id === owner.id);
      const visitDates = pets.map((pet: any) => pet.lastVisit).filter(Boolean).sort();
      const lastVisit = visitDates[visitDates.length - 1] ?? null;
      return { owner, pets, lastVisit };
    });
    return all
      .map((g: any) => ({ ...g, matchingPets: g.pets.filter(petMatches) }))
      .filter((g: any) => g.matchingPets.length > 0 || ((!hasPetFilter || ownersWithoutPets) && ownerTextMatches(g.owner)))
      .sort((a: any, b: any) => (a.owner?.name || "").localeCompare(b.owner?.name || ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, patients, q, species, gender, patientTab, recordPetIds, ownersWithoutPets]);

  const sortedPets = useMemo(() => {
    const arr = [...filteredPets];
    arr.sort((a: any, b: any) =>
      sort.key === "last"
        ? (a.lastVisit || "").localeCompare(b.lastVisit || "") * sort.dir
        : (a.name || "").localeCompare(b.name || "") * sort.dir
    );
    return arr;
  }, [filteredPets, sort]);

  const visibleOwnerGroups = ownersWithoutPets
    ? ownerGroups.filter((group: any) => group.pets.length === 0)
    : ownerGroups;
  const items: any[] = view === "Patients" ? sortedPets : visibleOwnerGroups;
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageNo = Math.min(page, pages);
  const pageItems = items.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE);

  const clearFilters = () => {
    setQuery(""); setSpecies("All species"); setGender("All genders");
    setPatientTab("All patients"); setOwnersWithoutPets(false); setPage(1);
  };
  const toggleSort = (key: "name" | "last") => {
    setSort((s) => (s.key === key ? { key, dir: (-s.dir) as 1 | -1 } : { key, dir: key === "last" ? -1 : 1 }));
    setPage(1);
  };
  const sortMark = (key: "name" | "last") => (sort.key === key ? (sort.dir > 0 ? " ↑" : " ↓") : "");

  const bookVisit = (pet: any) => navigate(BOOK_ROUTE, { state: { walkInPetId: pet.id } });

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteClient(deleteTarget.id);
      toast.success("Owner deleted.");
      /* Everything that was built from this owner's pets and visits. */
      queryClient.invalidateQueries({ queryKey: ["clients-with-pets"] });
      queryClient.invalidateQueries({ queryKey: ["visits-by-pet"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
      queryClient.invalidateQueries({ queryKey: ["unbilled"] });
      setDeleteTarget(null);
    } catch (err: any) { toast.error(err?.message || "Failed to delete owner."); } finally { setDeleting(false); }
  };

  /* Sends the owner an in-app reminder for a due follow-up. The log row is
     written first: its unique key stops a second send for the same follow-up.
     If the notification then fails, the log row is removed so it can be retried. */
  const handleSendReminder = async (pet: any) => {
    const owner = pet.owner;
    const due: string | undefined = pet.followUp?.date;
    if (!owner?.id || !due) { toast.error("This patient has no follow-up date."); return; }
    setSendingId(pet.id);
    try {
      const { error: logErr } = await (supabase as any)
        .from("pet_reminders")
        .insert([{ pet_id: pet.id, owner_id: owner.id, follow_up_date: due }]);
      if (logErr?.code === "23505") { toast.info("Reminder already sent."); return; }
      if (logErr) throw logErr;

      const { error } = await (supabase as any).from("notifications").insert([{
        title: "Follow-up reminder",
        message: `${owner.name}, ${pet.name} is due for a follow-up visit (${fmtDate(due) ?? due}). Please book a visit with the clinic.`,
        type: "appointment",
        category: "follow_up_reminder",
        related_type: "pet",
        related_id: pet.id,
        client_user_id: owner.id,
        is_read: false,
      }]);
      if (error) {
        await (supabase as any).from("pet_reminders").delete().eq("pet_id", pet.id).eq("follow_up_date", due);
        throw error;
      }
      toast.success(`Reminder sent to ${owner.name}.`);
      void queryClient.invalidateQueries({ queryKey: ["pet-reminders"] });
    } catch (err: any) {
      toast.error(err?.message || "Couldn't send the reminder.");
    } finally {
      setSendingId(null);
    }
  };

  /* Last visit cell for a pet: date and visit count. */
  const lastVisitCell = (pet: any) =>
    !visitsReady ? (
      <span className="text-[16px] text-[hsl(var(--muted-foreground))]" aria-label="Loading visits">—</span>
    ) : fmtDate(pet.lastVisit) ? (
      <>
        <p className="truncate text-[16px] font-bold">{fmtDate(pet.lastVisit)}</p>
        <p className="truncate text-[14px] text-[hsl(var(--muted-foreground))]">
          {pet.visitCount} visit{pet.visitCount === 1 ? "" : "s"}
        </p>
      </>
    ) : (
      <span className="text-[16px] text-[hsl(var(--muted-foreground))]">No visits yet</span>
    );

  const statusCell = (pet: any) =>
    !visitsReady ? (
      <span className="text-[14px] text-[hsl(var(--muted-foreground))]" role="status">
        {visitsError ? (
          <>
            Couldn&apos;t load.{" "}
            <button onClick={() => void refetchVisits()} className="font-bold text-[hsl(var(--primary))] hover:underline">
              Try again
            </button>
          </>
        ) : "Loading…"}
      </span>
    ) : (
      <StatusChip state={visitStateOf(pet)} date={pet.followUp?.date} />
    );

  /* Pets list only: a visit with nothing pending shows no status, since the
     Last visit column already shows it. Owners keep the Seen chip. */
  const petStatusCell = (pet: any) =>
    visitsReady && visitStateOf(pet) === "seen" ? null : statusCell(pet);

  /* Shown only for a due follow-up. Turns into "Reminder sent" once logged. */
  const ReminderBtn = ({ pet }: { pet: any }) => {
    const sent = reminderSent(pet);
    const busy = sendingId === pet.id;
    return (
      <button
        type="button"
        onClick={() => void handleSendReminder(pet)}
        disabled={sent || busy}
        aria-label={`Send a reminder to ${pet.owner?.name ?? "the owner"} about ${pet.name}`}
        className={`${ROW_BTN} border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-white hover:bg-[hsl(var(--primary))] disabled:bg-[hsl(var(--muted))] disabled:text-[hsl(var(--muted-foreground))]`}
      >
        {busy ? "Sending…" : sent ? "Reminder sent" : "Send reminder"}
      </button>
    );
  };

  const BookBtn = ({ pet }: { pet: any }) => (
    <button type="button" onClick={() => bookVisit(pet)} className={ROW_BTN} aria-label={`Book a visit for ${pet.name}`}>
      <Plus size={15} strokeWidth={2.6} aria-hidden="true" /> Book visit
    </button>
  );

  const RecordBtn = ({ pet }: { pet: any }) => (
    <button type="button" onClick={() => setRecordPet(pet)} className={ROW_BTN} aria-label={`Open the medical record of ${pet.name}`}>
      <FileText size={15} strokeWidth={2.4} aria-hidden="true" /> {patientTab === "Records" ? "Open record" : "Record"}
    </button>
  );

  return (
    <AdminLayout
      title={section === "owners" ? "Owners" : section === "records" ? "Medical Records" : "Pets"}
      eyebrow={dataReady ? `Care library · ${counts.patients} patients across ${counts.owners} owners` : "Care library"}
    >
      {recordPet ? (
        /* The patient chart opens in the page, so the sidebar stays visible. */
        <PatientChartDialog pet={recordPet} onClose={() => setRecordPet(null)} />
      ) : (
      <div className={PAGE_WRAP}>

        {/* ── Toolbar ── */}
        <div className={`${PANEL} flex flex-col gap-0`}>
          {section !== "records" && (
          <div className="flex flex-wrap items-center gap-6 border-b border-[hsl(var(--border))] bg-white px-6">
            {view === "Patients" ? (
              <div className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Patient lists">
                {([
                  ["All patients", dataReady ? counts.patients : "—"],
                  ["Follow-up due", visitsReady ? counts.due : "—"],
                  ["Never seen", visitsReady ? counts.neverSeen : "—"],
                ] as const).map(([label, count]) => (
                  <button
                    key={label}
                    type="button"
                    role="tab"
                    aria-pressed={patientTab === label}
                    aria-selected={patientTab === label}
                    onClick={() => { setPatientTab(label); setPage(1); setExpandedId(null); }}
                    className={`-mb-px flex h-12 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-1 text-[14px] transition ${FOCUS_RING} ${
                      patientTab === label
                        ? "border-[hsl(var(--primary))] font-bold text-[hsl(var(--foreground))]"
                        : "border-transparent font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    }`}
                  >
                    {label}
                    <span className={`inline-flex min-w-[22px] items-center justify-center rounded-full px-1.5 py-0.5 text-[12px] font-bold tabular-nums ${patientTab === label ? "bg-[hsl(var(--primary))] text-white" : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"}`}>{count ?? "—"}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex min-w-0 gap-1" role="group" aria-label="Filter owners">
                {([
                  ["All owners", false, dataReady ? counts.owners : "—"],
                  ["Without pets", true, dataReady ? counts.ownersWithoutPets : "—"],
                ] as const).map(([label, withoutPets, count]) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={ownersWithoutPets === withoutPets}
                    onClick={() => { setOwnersWithoutPets(withoutPets); setPage(1); setExpandedId(null); }}
                    className={`-mb-px flex h-12 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-1 text-[14px] transition ${FOCUS_RING} ${
                      ownersWithoutPets === withoutPets
                        ? "border-[hsl(var(--primary))] font-bold text-[hsl(var(--foreground))]"
                        : "border-transparent font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    }`}
                  >
                    {label}
                    <span className={`inline-flex min-w-[22px] items-center justify-center rounded-full px-1.5 py-0.5 text-[12px] font-bold tabular-nums ${ownersWithoutPets === withoutPets ? "bg-[hsl(var(--primary))] text-white" : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"}`}>{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          )}

          {recordsError && (
            <p className="text-[13px] text-[hsl(var(--destructive))]" role="alert">
              Couldn&apos;t load medical records: {(recordsLoadError as Error)?.message}{" "}
              <button type="button" onClick={() => void refetchRecords()} className="font-bold underline">Try again</button>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 border-b border-[hsl(var(--border))] bg-white px-6 py-3.5">
            <SearchField
              label={view === "Patients" ? "Search patient, owner or phone" : "Search owner, email or phone"}
              value={query}
              onChange={(v) => { setQuery(v); setPage(1); }}
              className="min-w-[200px] flex-1 basis-[240px]"
            />
            {view === "Patients" && patientTab !== "Records" && (
              <>
                <SelectField label="Species" value={species} onChange={(e) => { setSpecies(e.target.value); setPage(1); }} className="min-w-[150px] shrink-0">
                  <option>All species</option>
                  {speciesOptions.map((s: string) => <option key={s}>{s}</option>)}
                </SelectField>
                <SelectField label="Sex" value={gender} onChange={(e) => { setGender(e.target.value); setPage(1); }} className="min-w-[150px] shrink-0">
                  <option>All genders</option>
                  <option>Male</option>
                  <option>Female</option>
                </SelectField>
              </>
            )}
            {isAdmin && view === "Patients" && (
              <button
                onClick={() => exportPatients(filteredPets)}
                disabled={filteredPets.length === 0 || !visitsReady}
                title={visitsReady ? "Exports the patients currently shown below, as an Excel file (admins only)" : "Available once the visit counts have loaded"}
                className={`${CTL_BASE} ${CTL_FIELD} shrink-0 gap-2 px-5 transition hover:bg-[hsl(var(--muted))] disabled:opacity-50`}
              >
                <FileSpreadsheet size={16} aria-hidden="true" />
                Export Excel
              </button>
            )}
          </div>

        {/* ── List ── */}
          {view === "Patients" ? (
            patientTab === "Records" ? (
              <div className={`${TABLE_HEAD} ${RECORD_COLS}`}>
                <button type="button" onClick={() => toggleSort("name")} className={`text-left hover:text-[hsl(var(--foreground))] ${FOCUS_RING}`}>Patient{sortMark("name")}</button>
                <span>Owner</span>
                <span>Medical record</span>
                <span className="text-right">Action</span>
              </div>
            ) : (
              <div className={`${TABLE_HEAD} ${PATIENT_COLS}`}>
                <button type="button" onClick={() => toggleSort("name")} className={`text-left hover:text-[hsl(var(--foreground))] ${FOCUS_RING}`}>Patient{sortMark("name")}</button>
                <span>Owner</span>
                <button type="button" onClick={() => toggleSort("last")} className={`text-left hover:text-[hsl(var(--foreground))] ${FOCUS_RING}`}>Last visit{sortMark("last")}</button>
                <span>Status</span>
                <span className="text-right">Action</span>
              </div>
            )
          ) : (
            ownersWithoutPets ? (
              <div className={`${TABLE_HEAD} ${EMPTY_OWNER_COLS}`}>
                <span>Owner</span>
                <span>Contact</span>
                <span>Pets</span>
                <span className="text-right">Action</span>
              </div>
            ) : (
              <div className={`${TABLE_HEAD} ${OWNER_COLS}`}>
                <span>Owner</span>
                <span>Phone</span>
                <span>Messenger</span>
                <span>Address</span>
                <span>Pets</span>
                <span>Last visit</span>
                <span className="text-right">Action</span>
              </div>
            )
          )}

          {isLoading ? (
            <div className="flex justify-center py-16" role="status" aria-live="polite">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />
            </div>
          ) : isError ? (
            <div className="p-14 text-center">
              <AlertTriangle className="mx-auto text-[hsl(var(--destructive))]" aria-hidden="true" />
              <p className="mt-3 text-[14px] font-bold">Couldn&apos;t load patients</p>
              <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-[hsl(var(--muted-foreground))]">
                Check your connection and try again.
              </p>
              <button
                onClick={() => void refetch()}
                className={`${CTL_BASE} ${CTL_FIELD} mx-auto mt-4 px-6 transition hover:bg-[hsl(var(--muted))]`}
              >
                Try again
              </button>
            </div>
          ) : view === "Patients" && patientTab === "Records" && recordsLoading ? (
            <div className="flex justify-center py-16" role="status" aria-live="polite">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />
            </div>
          ) : total === 0 ? (
            <div className="p-14 text-center">
              <PawPrint className="mx-auto text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
              <p className="mt-3 text-[14px] font-bold">
                {ownersWithoutPets
                  ? "No owners without pets"
                  : view === "Owners" ? "No owners found" : patients.length === 0 ? "No registered patients" : "No records match"}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-[hsl(var(--muted-foreground))]">
                {ownersWithoutPets
                  ? clients.length > 0 ? "Every registered owner currently has at least one pet." : "No owners are registered yet."
                  : view === "Owners"
                  ? "Owners appear here once they register through the app."
                  : patients.length === 0
                  ? "Patients appear here once pet owners register through the app."
                  : patientTab === "Records"
                    ? "Medical records appear here once one has been saved for a patient."
                    : "Try a different name, species or sex."}
              </p>
              {hasFilters && (view === "Owners" ? clients.length > 0 : patients.length > 0) && (
                <button
                  onClick={clearFilters}
                  className={`mx-auto mt-4 flex h-10 items-center gap-1.5 rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] px-5 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
                >
                  <X size={16} aria-hidden="true" /> Clear filters
                </button>
              )}
            </div>
          ) : view === "Patients" ? (
            pageItems.map((pet: any) => (
              <div
                key={pet.id}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-[hsl(var(--border))] px-5 py-4 transition last:border-0 hover:bg-[hsl(var(--muted)/.35)] lg:gap-4 lg:px-6 ${patientTab === "Records" ? RECORD_COLS : PATIENT_COLS}`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <RingAvatar src={pet.photo_url} initials={initialsOf(pet.name)} className="h-10 w-10" />
                  <div className="min-w-0">
                    <p className="break-words text-[14px] font-bold leading-snug">{pet.name}</p>
                    <p className="break-words text-[12.5px] leading-snug text-[hsl(var(--muted-foreground))]">{petLine(pet)}</p>
                    <p className="truncate text-[12.5px] text-[hsl(var(--muted-foreground))] lg:hidden">
                      {pet.owner?.name}{pet.owner?.phone ? ` · ${fmtPhone(pet.owner.phone)}` : ""}
                    </p>
                  </div>
                </div>

                <div className="hidden min-w-0 lg:block">
                  <p className="break-words text-[14px] font-bold leading-snug">{pet.owner?.name}</p>
                  <p className="truncate text-[12.5px] text-[hsl(var(--muted-foreground))]">
                    {fmtPhone(pet.owner?.phone) || "—"}
                  </p>
                </div>

                {patientTab === "Records" ? (
                  <div className="min-w-0">
                    {fmtDate(medicalRecords.find((record: any) => record.pet_id === pet.id)?.updated_at) ? (
                      <p className="text-[14px] font-bold">{fmtDate(medicalRecords.find((record: any) => record.pet_id === pet.id)?.updated_at)}</p>
                    ) : (
                      <p className="text-[14px] text-[hsl(var(--muted-foreground))]">No record yet</p>
                    )}
                  </div>
                ) : null}

                {patientTab !== "Records" && <div className="order-last col-span-2 min-w-0 lg:order-none lg:col-span-1">
                  <div className="hidden lg:block">{lastVisitCell(pet)}</div>
                  <div className="flex items-center gap-3 lg:hidden">
                    {petStatusCell(pet)}
                    {visitsReady && (
                      <span className="text-[12.5px] text-[hsl(var(--muted-foreground))]">
                        {fmtDate(pet.lastVisit) ? `Last ${fmtDate(pet.lastVisit)}` : "No visits yet"}
                      </span>
                    )}
                  </div>
                </div>}

                {patientTab !== "Records" && <div className="hidden min-w-0 lg:block">{petStatusCell(pet)}</div>}

                <div className="flex items-center justify-end gap-2">
                  {patientTab === "Records" ? (
                    <RecordBtn pet={pet} />
                  ) : (
                    <>
                      {visitsReady && visitStateOf(pet) === "due" && <ReminderBtn pet={pet} />}
                      <RecordBtn pet={pet} />
                    </>
                  )}
                </div>
              </div>
            ))
          ) : (
            pageItems.map((group: any) => {
              /* Pets in name order, the same order the Patients tab uses by default. */
              const petsToShow = [...(group.matchingPets.length > 0 ? group.matchingPets : group.pets)]
                .sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""));
              const totalPets = group.pets.length;
              const neverSeen = visitsReady ? petsToShow.filter((pet: any) => pet.visitCount === 0).length : 0;
              const open = expandedId === group.owner.id;
              const panelId = `owner-pets-${group.owner.id}`;
              const toggle = () => setExpandedId(open ? null : group.owner.id);
              return (
                <div key={group.owner.id} className="border-b border-[hsl(var(--border)/.55)] last:border-0">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={toggle}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
                    }}
                    className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-4 transition hover:bg-[hsl(var(--muted)/.35)] lg:gap-4 lg:px-6 ${ownersWithoutPets ? EMPTY_OWNER_COLS : OWNER_COLS} ${FOCUS_RING}`}
                  >
                    {/* Owner: photo (or initials) in the navy ring */}
                    <div className="flex min-w-0 items-center gap-3">
                      <RingAvatar src={group.owner.avatar_url} initials={initialsOf(group.owner.name)} className="h-10 w-10" />
                      <div className="min-w-0">
                        <p className="break-words text-[14px] font-bold">{group.owner.name}</p>
                        <p className="break-words text-[12.5px] leading-snug text-[hsl(var(--muted-foreground))] lg:hidden">
                          {totalPets} {totalPets === 1 ? "pet" : "pets"} · {fmtPhone((group.owner as any).phone) || group.owner.email || "No contact details"}
                        </p>
                        {!ownersWithoutPets && (
                          <p className="hidden truncate text-[12.5px] leading-snug text-[hsl(var(--muted-foreground))] lg:block" title={group.owner.email || ""}>
                            {group.owner.email || "No email"}
                          </p>
                        )}
                      </div>
                    </div>

                    <p className="hidden min-w-0 break-words text-[14px] tabular-nums lg:block">
                      {fmtPhone((group.owner as any).phone) || <span className="text-[hsl(var(--muted-foreground))]">—</span>}
                    </p>

                    {!ownersWithoutPets && (
                      <p className="hidden min-w-0 truncate text-[14px] lg:block" title={(group.owner as any).fb_messenger || ""}>
                        {(group.owner as any).fb_messenger || <span className="text-[hsl(var(--muted-foreground))]">—</span>}
                      </p>
                    )}
                    {!ownersWithoutPets && (
                      <p className="hidden min-w-0 truncate text-[14px] lg:block" title={(group.owner as any).address || ""}>
                        {(group.owner as any).address || <span className="text-[hsl(var(--muted-foreground))]">—</span>}
                      </p>
                    )}

                    {/* Pets: overlapping avatars and the count */}
                    <div className={`hidden items-center gap-2 lg:flex ${ownersWithoutPets ? "col-span-1" : ""}`}>
                      <div className="flex">
                        {group.pets.slice(0, 2).map((pet: any, i: number) => (
                          <div key={pet.id} className={i > 0 ? "-ml-2.5" : ""}>
                            <RingAvatar src={pet.photo_url} initials={initialsOf(pet.name)} className="h-8 w-8" textClass="text-[11px]" />
                          </div>
                        ))}
                      </div>
                      <span className="text-[14px] font-bold tabular-nums">{totalPets}</span>
                    </div>

                    {/* Last visit: the most recent completed visit across this owner's pets. */}
                    {!ownersWithoutPets && <div className="hidden min-w-0 lg:block">
                      {!visitsReady ? (
                        <span className="text-[14px] text-[hsl(var(--muted-foreground))]" aria-label="Loading visits">—</span>
                      ) : fmtDate(group.lastVisit) ? (
                        <>
                          <p className="truncate text-[14px] font-bold">{fmtDate(group.lastVisit)}</p>
                          <p className="truncate text-[12.5px] text-[hsl(var(--muted-foreground))]">
                            {group.pets.find((pet: any) => pet.lastVisit === group.lastVisit)?.name}
                          </p>
                        </>
                      ) : (
                        <span className="text-[14px] text-[hsl(var(--muted-foreground))]">No visits yet</span>
                      )}
                    </div>}

                    {/* Action: the round button that shows the pets. Delete now
                        lives inside the opened panel, so it is no longer one
                        click away from the list. */}
                    <div className="flex items-center justify-end">
                      <span aria-hidden="true" className={`inline-flex h-9 items-center gap-1.5 rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] px-3 text-[14px] font-bold text-[hsl(var(--primary))] transition ${
                            open
                              ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                              : "bg-[hsl(var(--card))] text-[hsl(var(--primary))]"
                          }`}>
                        {open ? "Close" : "Open"}
                        <ChevronDown size={16} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
                      </span>
                    </div>
                  </div>

                  {/* ── Pets dropdown ── */}
                  {open && (
                    <div id={panelId} className="px-5 pb-5 duration-200 animate-in fade-in slide-in-from-top-1 sm:px-6">
                      <div className="rounded-[14px] bg-[hsl(var(--background))] p-4">
                        <div className="flex items-start justify-between gap-3 px-2 pb-3">
                          <div className="min-w-0">
                            <p className="truncate text-[14px] font-bold">Pets of {group.owner.name}</p>
                            <p className="text-[12.5px] text-[hsl(var(--muted-foreground))]">
                              {petsToShow.length === totalPets
                                ? `${totalPets} ${totalPets === 1 ? "pet" : "pets"}`
                                : `${petsToShow.length} of ${totalPets} pets shown`}
                              {visitsReady && neverSeen > 0 && ` · ${neverSeen} never seen`}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(group.owner)}
                            className={`inline-flex h-9 shrink-0 items-center gap-1.5 px-1 text-[14px] font-bold text-[hsl(var(--destructive))] transition hover:underline ${FOCUS_RING}`}
                          >
                            <Trash2 size={16} aria-hidden="true" /> Delete owner
                          </button>
                        </div>

                        {petsToShow.length === 0 ? (
                          <div className="rounded-[12px] border-2 border-dashed border-[hsl(var(--card-border))] bg-[hsl(var(--card))] px-5 py-8 text-center">
                            <PawPrint className="mx-auto text-[hsl(var(--muted-foreground))]" size={22} aria-hidden="true" />
                            <p className="mt-2 text-[14px] font-bold">No pets registered yet</p>
                            <p className="mt-0.5 text-[12.5px] text-[hsl(var(--muted-foreground))]">
                              Pets appear here once this owner adds them in the app.
                            </p>
                          </div>
                        ) : (
                          <div className="grid gap-2">
                            {petsToShow.map((pet: any) => (
                              <div
                                key={pet.id}
                                className={`grid grid-cols-1 items-center gap-3 rounded-[12px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] px-4 py-3 lg:gap-4 ${PET_ROW_COLS}`}
                              >
                                <div className="flex min-w-0 items-center gap-3">
                                  <RingAvatar src={pet.photo_url} initials={initialsOf(pet.name)} className="h-9 w-9" textClass="text-[12px]" />
                                  <div className="min-w-0">
                                    <p className="break-words text-[14px] font-bold leading-snug">{pet.name}</p>
                                    <p className="break-words text-[12.5px] leading-snug text-[hsl(var(--muted-foreground))]">{petLine(pet)}</p>
                                  </div>
                                </div>
                                <div className="min-w-0">{lastVisitCell(pet)}</div>
                                <div>{statusCell(pet)}</div>
                                <div className="flex justify-start gap-2 lg:justify-end">
                                  <RecordBtn pet={pet} />
                                  <BookBtn pet={pet} />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* ── Footer: count and paging ── */}
          {dataReady && total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border)/.7)] px-5 py-3 text-[14px] text-[hsl(var(--muted-foreground))] sm:px-6">
              <span>
                Showing <b className="text-[hsl(var(--foreground))]">{(pageNo - 1) * PAGE_SIZE + 1}–{Math.min(pageNo * PAGE_SIZE, total)}</b> of{" "}
                <b className="text-[hsl(var(--foreground))]">{total}</b>{" "}
                {view === "Patients"
                  ? (total === 1 ? "patient" : "patients")
                  : (total === 1 ? "owner" : "owners")}
              </span>
              <div className="flex items-center gap-3">
                <button type="button" className={PAGER_BTN} disabled={pageNo === 1} onClick={() => setPage(pageNo - 1)}>Previous</button>
                <span className="tabular-nums">{pageNo} / {pages}</span>
                <button type="button" className={PAGER_BTN} disabled={pageNo === pages} onClick={() => setPage(pageNo + 1)}>Next</button>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* ── Delete owner ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="max-w-[480px] rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--background))] p-6 [&>button]:hidden">
          <div className="min-w-0">
            <DialogTitle className="text-[24px] font-bold leading-[30px] tracking-[-.02em]">
              Delete {deleteTarget?.name}?
            </DialogTitle>
            <p className="mt-2.5 text-[16px] leading-6">
              This removes the owner
              {deleteTarget && deleteTarget.pets.length > 0 && (
                <>, along with {deleteTarget.pets.length} pet{deleteTarget.pets.length === 1 ? "" : "s"},</>
              )} from the system, and they can no longer book in the app.
            </p>
            <p className="mt-2.5 text-[15px] leading-[22px] text-[hsl(var(--muted-foreground))]">
              Past visits and invoices are kept. You can&apos;t restore them from this screen.
            </p>
          </div>
          <div className="mt-6 flex gap-3">
            <button
              onClick={() => setDeleteTarget(null)}
              className={`flex h-12 flex-1 items-center justify-center rounded-full border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] text-[16px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
            >
              Keep owner
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className={`flex h-12 flex-1 items-center justify-center rounded-full border-[1.5px] border-[hsl(var(--destructive))] bg-[hsl(var(--destructive))] text-[16px] font-bold text-[hsl(var(--destructive-foreground))] shadow-[0_6px_16px_rgb(166_63_38/.28)] transition hover:opacity-90 disabled:opacity-60 ${FOCUS_RING}`}
            >
              {deleting ? "Deleting…" : "Delete owner"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

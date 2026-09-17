import { useMemo, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchClientsWithPets, deleteClient, fetchClientVisitStats,
} from "@/api/clients";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "sonner";
import type { ClientWithPets } from "@/types";
import * as XLSX from "xlsx";
import {
  Search, ListFilter, X, Phone, Mail, UserRound, Check, Eye, Loader2, BadgeCheck,
  Trash2, AlertTriangle, Dog, Cat, Venus, Mars, Download,
  Stethoscope, CalendarDays, Receipt, PawPrint,
} from "lucide-react";

const peso = (n: number) =>
  `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const VISIT_PILL: Record<string, string> = {
  Completed: "bg-[hsl(145_42%_88%)] text-[hsl(145_42%_27%)]",
  Confirmed: "bg-[hsl(174_35%_88%)] text-[hsl(174_43%_28%)]",
  Pending: "bg-[hsl(40_55%_88%)] text-[hsl(40_55%_30%)]",
  Cancelled: "bg-[hsl(15_72%_90%)] text-[hsl(15_60%_38%)]",
};

const STATUS_LABEL: Record<string, string> = {
  incoming: "Pending", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled",
};

function speciesIcon(species?: string) {
  const v = species?.toLowerCase() || "";
  if (v.includes("dog")) return Dog;
  if (v.includes("cat")) return Cat;
  return BadgeCheck;
}

/* requested_date can be null on older rows, and `new Date(null +
   "T00:00:00")` renders as "Invalid Date" rather than failing. */
function fmtDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value.length === 10 ? value + "T00:00:00" : value);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* Owner and pet details can't be got out of the app any other way — if
   the clinic changes systems or a client asks for their record, this is
   the only export path. */
function exportPatients(rows: any[]) {
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

  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = [
    { wch: 22 }, { wch: 26 }, { wch: 16 }, { wch: 16 },
    { wch: 14 }, { wch: 9 }, { wch: 11 }, { wch: 9 }, { wch: 12 },
  ];

  const range = XLSX.utils.decode_range(sheet["!ref"]!);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const ref = XLSX.utils.encode_cell({ r: 0, c });
    if (sheet[ref]) {
      sheet[ref].s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "0E4F45" } },
      };
    }
  }
  sheet["!freeze"] = { xSplit: "0", ySplit: "1" };

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Patients");
  XLSX.writeFile(book, `pet-royale-patients_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/* Every appointment, grouped by pet. One query rather than one per
   pet — with 200 patients the naive version is 200 requests. */
async function fetchVisitsByPet() {
  const { data, error } = await (supabase as any)
    .from("appointments")
    .select("id, pet_id, service, requested_date, scheduled_time, status")
    .order("requested_date", { ascending: false });
  if (error) throw error;

  const byPet: Record<string, any[]> = {};
  (data || []).forEach((a: any) => {
    if (a.pet_id) (byPet[a.pet_id] ||= []).push(a);
  });
  return byPet;
}

function StatCard({
  label, value, caption, icon: Icon, accent, delay,
}: {
  label: string; value: number; caption: string;
  icon: React.ElementType; accent: string; delay?: string;
}) {
  return (
    <article className={`workspace-card workspace-rise ${delay ?? ""} rounded-[24px] p-5`}>
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">
          {label}
        </p>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${accent}`}>
          <Icon size={17} />
        </span>
      </div>
      <p className="mt-5 text-[29px] font-bold tracking-[-.05em]">{value}</p>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{caption}</p>
    </article>
  );
}

export default function Clients() {
  const queryClient = useQueryClient();

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["clients-with-pets"], queryFn: fetchClientsWithPets,
  });
  const { data: visitStats = {} } = useQuery({
    queryKey: ["client-visit-stats"], queryFn: fetchClientVisitStats,
  });
  const { data: visitsByPet = {} } = useQuery({
    queryKey: ["visits-by-pet"], queryFn: fetchVisitsByPet,
  });

  const [query, setQuery] = useState("");
  const [species, setSpecies] = useState("All species");
  const [gender, setGender] = useState("All genders");

  const [selectedOwner, setSelectedOwner] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClientWithPets | null>(null);
  const [deleting, setDeleting] = useState(false);

  /* One row per pet — species and breed belong to a pet, so a client
     with three pets is three rows, each carrying its owner. */
  const patients = useMemo(
    () => clients.flatMap((c: any) =>
      (c.pets || []).map((p: any) => {
        const visits = visitsByPet[p.id] || [];
        const completed = visits.filter((v: any) => v.status === "completed");
        return {
          ...p,
          owner: c,
          visits,
          visitCount: completed.length,
          // The last visit that happened, not one booked and cancelled.
          lastVisit: completed[0]?.requested_date ?? null,
          lastService: completed[0]?.service ?? null,
        };
      })
    ),
    [clients, visitsByPet]
  );

  const speciesOptions = useMemo(
    () => [...new Set(patients.map((p: any) => p.species).filter(Boolean))].sort(),
    [patients]
  );

  const counts = useMemo(() => ({
    patients: patients.length,
    owners: clients.length,
    seen: patients.filter((p: any) => p.visitCount > 0).length,
    neverSeen: patients.filter((p: any) => p.visitCount === 0).length,
  }), [patients, clients]);

  const ownerGroups = useMemo(() => clients.map((owner: any) => {
    const pets = patients.filter((patient: any) => patient.owner?.id === owner.id);
    const completedVisits = pets.reduce((total: number, pet: any) => total + pet.visitCount, 0);
    const lastVisit = pets
      .map((pet: any) => pet.lastVisit)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
    return { owner, pets, completedVisits, lastVisit };
  }), [clients, patients]);

  const visible = patients.filter((p: any) => {
    const q = query.trim().toLowerCase();
    const matchesQuery = !q ||
      p.name?.toLowerCase().includes(q) ||
      p.owner?.name?.toLowerCase().includes(q) ||
      p.owner?.email?.toLowerCase().includes(q) ||
      false;
    const matchesSpecies = species === "All species" || p.species === species;
    const matchesGender = gender === "All genders" || p.gender === gender;
    return matchesQuery && matchesSpecies && matchesGender;
  });

  const hasFilters = !!query || species !== "All species" || gender !== "All genders";
  const clearFilters = () => { setQuery(""); setSpecies("All species"); setGender("All genders"); };

  const visibleGroups = ownerGroups.filter((group: any) => {
    const q = query.trim().toLowerCase();
    const ownerMatches = !q ||
      group.owner?.name?.toLowerCase().includes(q) ||
      group.owner?.email?.toLowerCase().includes(q);
    const matchingPets = group.pets.filter((pet: any) => {
      const petMatches = !q || pet.name?.toLowerCase().includes(q);
      const speciesMatches = species === "All species" || pet.species === species;
      const genderMatches = gender === "All genders" || pet.gender === gender;
      return petMatches && speciesMatches && genderMatches;
    });
    const hasPetFilter = species !== "All species" || gender !== "All genders";
    return (ownerMatches || matchingPets.length > 0) && (!hasPetFilter || matchingPets.length > 0);
  });

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteClient(deleteTarget.id);
      toast.success("Owner deleted.");
      queryClient.invalidateQueries({ queryKey: ["clients-with-pets"] });
      setDeleteTarget(null);
      setSelectedOwner(null);
    } catch { toast.error("Failed to delete owner."); } finally { setDeleting(false); }
  };

  return (
    <AdminLayout
      title="Patients"
      eyebrow={`Care library · ${counts.patients} patients across ${counts.owners} owners`}
      actions={
        <button
          onClick={() => exportPatients(visible)}
          disabled={visibleGroups.length === 0}
          title="Exports the patients currently shown"
          className="flex h-9 items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs font-bold transition hover:bg-[hsl(var(--muted))] disabled:opacity-40"
        >
          <Download size={15} /> Export
        </button>
      }
    >
      <div className="mx-auto max-w-[1440px] space-y-5 px-5 py-7 sm:px-8 lg:px-10">

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Registered patients" value={counts.patients} caption="Pets on record"
            icon={BadgeCheck} accent="bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"
          />
          <StatCard
            label="Pet owners" value={counts.owners} caption="Registered through the app"
            icon={UserRound} accent="bg-[hsl(200_30%_88%)] text-[hsl(200_40%_31%)]" delay="workspace-rise-1"
          />
          <StatCard
            label="Seen at least once" value={counts.seen} caption="Have a completed visit"
            icon={Stethoscope} accent="bg-[hsl(145_42%_88%)] text-[hsl(145_42%_27%)]" delay="workspace-rise-2"
          />
          <StatCard
            label="Never seen" value={counts.neverSeen} caption="Registered, no visit yet"
            icon={CalendarDays} accent="bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]" delay="workspace-rise-3"
          />
        </div>

        {/* ── Search and filters ── */}
        <div className="workspace-card flex flex-col gap-3 rounded-[24px] p-4 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search patient or owner…"
              className="h-11 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] pl-10 pr-3 text-sm"
            />
          </div>

          <select
            value={species} onChange={(e) => setSpecies(e.target.value)} aria-label="Filter by species"
            className="h-11 shrink-0 rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-xs font-semibold"
          >
            <option>All species</option>
            {speciesOptions.map((s: string) => <option key={s}>{s}</option>)}
          </select>

          <select
            value={gender} onChange={(e) => setGender(e.target.value)} aria-label="Filter by sex"
            className="h-11 shrink-0 rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-xs font-semibold"
          >
            <option>All genders</option>
            <option>Male</option>
            <option>Female</option>
          </select>

          {hasFilters ? (
            <button
              onClick={clearFilters}
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-[hsl(var(--input))] px-3 text-xs font-bold transition hover:bg-[hsl(var(--muted))]"
            >
              <X size={14} /> Clear
            </button>
          ) : (
            <span className="flex shrink-0 items-center gap-2 px-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
              <ListFilter size={15} />{visibleGroups.length} owners shown
            </span>
          )}
        </div>

        {/* ── Table ── */}
        <div className="workspace-card overflow-hidden rounded-[26px]">
          <div className="hidden grid-cols-[1.2fr_1.8fr_1fr_130px_50px] gap-4 border-b border-[hsl(var(--border)/.7)] px-6 py-3 text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))] lg:grid">
            <span>Owner</span>
            <span>Pets</span>
            <span>Care activity</span>
            <span>Last visit</span>
            <span className="text-right">View</span>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
            </div>
          ) : visibleGroups.length === 0 ? (
            <div className="p-14 text-center">
              <PawPrint className="mx-auto text-[hsl(var(--muted-foreground))]" />
              <p className="mt-3 text-sm font-bold">
                {patients.length === 0 ? "No registered patients" : "No patients match these filters"}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-[hsl(var(--muted-foreground))]">
                {patients.length === 0
                  ? "Patients appear here once pet owners register through the app."
                  : "Try a different name, species or sex."}
              </p>
              {hasFilters && patients.length > 0 && (
                <button
                  onClick={clearFilters}
                  className="mx-auto mt-4 flex h-10 items-center gap-1.5 rounded-xl border border-[hsl(var(--border))] px-4 text-xs font-bold transition hover:bg-[hsl(var(--muted))]"
                >
                  <X size={14} /> Clear filters
                </button>
              )}
            </div>
          ) : (
            visibleGroups.map((group: any) => {
              const matchingPets = group.pets.filter((pet: any) => {
                const q = query.trim().toLowerCase();
                return (!q || pet.name?.toLowerCase().includes(q)) &&
                  (species === "All species" || pet.species === species) &&
                  (gender === "All genders" || pet.gender === gender);
              });
              const petsToShow = matchingPets.length > 0 ? matchingPets : group.pets;
              return (
                <div
                  key={group.owner.id}
                  onClick={() => setSelectedOwner(group)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedOwner(group); }}
                  role="button"
                  tabIndex={0}
                  className="grid gap-3 border-b border-[hsl(var(--border)/.55)] px-5 py-4 transition last:border-0 hover:bg-[hsl(var(--muted)/.25)] lg:grid-cols-[1.2fr_1.8fr_1fr_130px_50px] lg:items-center lg:gap-4 lg:px-6"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {group.owner.avatar_url ? (
                        <img src={group.owner.avatar_url} alt="" className="h-9 w-9 shrink-0 rounded-xl object-cover" />
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]">
                          <UserRound size={17} />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{group.owner.name}</p>
                        <p className="mt-0.5 truncate text-[11px] text-[hsl(var(--muted-foreground))]">
                          {(group.owner as any).phone || group.owner.email || "No contact details"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-lg font-bold leading-none text-[hsl(var(--foreground))]">
                      {petsToShow.length}
                    </span>
                    <span className="text-[hsl(var(--muted-foreground))]">
                      {petsToShow.length === 1 ? "registered pet" : "registered pets"}
                    </span>
                  </div>

                  <div className="text-xs">
                    <p className="font-semibold">{group.completedVisits} completed visit{group.completedVisits === 1 ? "" : "s"}</p>
                    <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                      {group.pets.filter((pet: any) => pet.visitCount === 0).length} never seen
                    </p>
                  </div>

                  <p className="text-xs">
                    {fmtDate(group.lastVisit) ?? <span className="text-[hsl(var(--muted-foreground))]">No visits yet</span>}
                  </p>

                  <div className="flex justify-end">
                    <button
                        onClick={(event) => { event.stopPropagation(); setSelectedOwner(group); }}
                        aria-label={`View ${group.owner.name}'s pets`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))]"
                      >
                        <Eye size={15} />
                    </button>
                  </div>
                </div>
              );
            })
          )}

          {visibleGroups.length > 0 && (
            <div className="border-t border-[hsl(var(--border)/.7)] px-6 py-3.5">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Showing <strong className="text-[hsl(var(--foreground))]">{visibleGroups.length}</strong> of {ownerGroups.length} owners · {visibleGroups.reduce((sum: number, group: any) => sum + group.pets.length, 0)} pets
              </p>
            </div>
          )}
        </div>
      </div>

      {selectedOwner && (
        <OwnerPanel
          group={selectedOwner}
          onClose={() => setSelectedOwner(null)}
          onDelete={() => { setDeleteTarget(selectedOwner.owner); setSelectedOwner(null); }}
        />
      )}

      {/* ── Delete owner ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="max-w-[420px] rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-7 [&>button]:hidden">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))]">
              <AlertTriangle size={21} />
            </div>
            <div className="min-w-0">
              <h2 className="display-face text-[27px] leading-none">Delete this owner?</h2>
              <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
                <strong className="text-[hsl(var(--foreground))]">{deleteTarget?.name}</strong> will be removed
                {deleteTarget && deleteTarget.pets.length > 0 && (
                  <>, along with {deleteTarget.pets.length} pet{deleteTarget.pets.length === 1 ? "" : "s"} and their records</>
                )}. This can&apos;t be undone.
              </p>
            </div>
          </div>
          <div className="mt-7 flex justify-end gap-2">
            <button
              onClick={() => setDeleteTarget(null)}
              className="h-11 rounded-xl border border-[hsl(var(--border))] px-4 text-sm font-bold transition hover:bg-[hsl(var(--muted))]"
            >
              Keep owner
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="h-11 rounded-xl bg-[hsl(var(--destructive))] px-5 text-sm font-bold text-[hsl(var(--destructive-foreground))] disabled:opacity-60"
            >
              {deleting ? "Deleting…" : "Delete owner"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

function OwnerPanel({
  group, onClose, onDelete,
}: {
  group: any;
  onClose: () => void;
  onDelete: () => void;
}) {
  const owner = group.owner;

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="owner-panel-title">
      <div className="workspace-card workspace-scroll max-h-[calc(100dvh-24px)] w-full max-w-[900px] overflow-y-auto rounded-[24px] bg-[hsl(var(--card))] p-5 sm:max-h-[calc(100dvh-48px)] sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {owner.avatar_url ? (
              <img src={owner.avatar_url} alt="" className="h-12 w-12 shrink-0 rounded-2xl object-cover" />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]">
                <UserRound size={22} />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--primary))]">Owner profile</p>
              <h2 id="owner-panel-title" className="display-face mt-1 truncate text-[30px] leading-none">{owner.name}</h2>
              <p className="mt-1 truncate text-xs text-[hsl(var(--muted-foreground))]">{owner.email}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><X size={18} /></button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-[hsl(var(--muted)/.6)] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">Pets</p>
            <p className="mt-1 text-lg font-bold">{group.pets.length}</p>
          </div>
          <div className="rounded-xl bg-[hsl(var(--muted)/.6)] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">Completed visits</p>
            <p className="mt-1 text-lg font-bold">{group.completedVisits}</p>
          </div>
          <div className="rounded-xl bg-[hsl(var(--muted)/.6)] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">Last visit</p>
            <p className="mt-1 text-sm font-bold">{fmtDate(group.lastVisit) ?? "No visits yet"}</p>
          </div>
        </div>

        <section className="mt-5 rounded-xl border border-[hsl(var(--border)/.8)] bg-[hsl(var(--background)/.55)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold">Mobile profile</h3>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Details provided by the owner account.</p>
            </div>
            <BadgeCheck size={18} className="text-[hsl(var(--primary))]" />
          </div>
          <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">Full name</p>
              <p className="mt-1 font-semibold">{owner.name || "Not provided"}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">Email</p>
              <p className="mt-1 truncate font-semibold">{owner.email || "Not provided"}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">Phone</p>
              <p className="mt-1 font-semibold">{owner.phone || "Not provided"}</p>
            </div>
          </div>
        </section>

        <section className="mt-6 border-t border-[hsl(var(--border)/.7)] pt-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold">Pets registered to this owner</h3>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Each pet's profile and completed care history.</p>
            </div>
            <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">{group.pets.length} total</span>
          </div>

          {group.pets.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-[hsl(var(--border))] px-5 py-8 text-center text-xs text-[hsl(var(--muted-foreground))]">No pets registered for this owner.</div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-[hsl(var(--border)/.8)]">
              <div className="min-w-[680px]">
                <div className="grid grid-cols-[1.3fr_100px_90px_100px_80px_120px] gap-3 bg-[hsl(var(--muted)/.55)] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">
                  <span>Pet</span><span>Species</span><span>Age</span><span>Breed</span><span>Gender</span><span>Care history</span>
                </div>
                {group.pets.map((pet: any) => {
                  const Icon = speciesIcon(pet.species);
                  return (
                    <div key={pet.id} className="grid grid-cols-[1.3fr_100px_90px_100px_80px_120px] items-center gap-3 border-t border-[hsl(var(--border)/.6)] px-4 py-3 text-xs">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"><Icon size={15} /></span>
                        <span className="truncate font-bold">{pet.name}</span>
                      </div>
                      <span>{pet.species || "—"}</span>
                      <span>{pet.age != null ? `${pet.age} yr` : "—"}</span>
                      <span className="truncate">{pet.breed || "—"}</span>
                      <span>{pet.gender || "—"}</span>
                      <span className="font-semibold">{pet.visitCount} visit{pet.visitCount === 1 ? "" : "s"}<span className="block text-[11px] font-normal text-[hsl(var(--muted-foreground))]">{fmtDate(pet.lastVisit) ?? "Never seen"}</span></span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <div className="mt-6 flex justify-end border-t border-[hsl(var(--border)/.7)] pt-5">
          <button onClick={onDelete} aria-label="Delete owner" className="rounded-xl border border-[hsl(var(--border))] px-4 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--destructive)/.08)] hover:text-[hsl(var(--destructive))]"><Trash2 size={15} /></button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════ Patient panel ══════════════════
   Pet details, owner contact, and the full visit history — the one
   thing the old Medical Records screen owned. */

function PatientPanel({
  patient, stats, onClose, onDelete,
}: {
  patient: any;
  stats?: { totalVisits: number; lastVisit: string | null };
  onClose: () => void;
  onDelete: () => void;
}) {
  const Icon = speciesIcon(patient.species);
  const owner = patient.owner;
  const visits = patient.visits || [];

  /* What each visit was billed, so the history shows the money as well
     as the care. Only fetched when the panel opens. */
  const { data: invoices = {} } = useQuery({
    queryKey: ["pet-invoices", patient.id],
    enabled: visits.length > 0,
    queryFn: async () => {
      const ids = visits.map((v: any) => v.id);
      const { data } = await (supabase as any)
        .from("invoices").select("appointment_id, total_amount, status").in("appointment_id", ids);
      const map: Record<string, any> = {};
      (data || []).forEach((i: any) => { map[i.appointment_id] = i; });
      return map;
    },
  });

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="workspace-card workspace-scroll h-full w-full max-w-[540px] overflow-y-auto p-6 sm:p-8">

        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-4">
            {patient.photo_url ? (
              <img src={patient.photo_url} alt="" className="h-16 w-16 shrink-0 rounded-[22px] object-cover" />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]">
                <Icon size={26} />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--primary))]">
                Patient record
              </p>
              <h2 className="display-face mt-1 truncate text-[33px] leading-none">{patient.name}</h2>
              <p className="mt-2 truncate text-sm text-[hsl(var(--muted-foreground))]">
                {patient.species}{patient.breed ? ` · ${patient.breed}` : ""}
                {patient.age != null && ` · ${patient.age} yr`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Owner ── */}
        <section className="mt-8 rounded-2xl bg-[hsl(var(--muted)/.6)] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">
            Owner
          </p>
          <p className="mt-2 text-sm font-bold">{owner?.name || "—"}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(owner as any)?.phone && (
              <a
                href={`tel:${(owner as any).phone}`}
                className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold transition hover:bg-[hsl(var(--muted))]"
              >
                <Phone size={13} />{(owner as any).phone}
              </a>
            )}
            <a
              href={`mailto:${owner?.email}`}
              className="flex min-w-0 items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold transition hover:bg-[hsl(var(--muted))]"
            >
              <Mail size={13} /><span className="truncate">{owner?.email}</span>
            </a>
          </div>
        </section>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-[hsl(var(--muted)/.65)] p-4">
            <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">
              Visits
            </p>
            <p className="mt-2 text-sm font-bold">{patient.visitCount}</p>
          </div>
          <div className="rounded-2xl bg-[hsl(var(--muted)/.65)] p-4">
            <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">
              Last visit
            </p>
            <p className="mt-2 text-sm font-bold">{fmtDate(patient.lastVisit) ?? "Never"}</p>
          </div>
        </div>

        {/* ── Visit history ──
               Moved from the old Medical Records screen. Every
               appointment for this pet, newest first, with what it was
               billed. */}
        <section className="mt-8 border-t border-[hsl(var(--border)/.7)] pt-6">
          <h3 className="text-sm font-bold">
            {visits.length} appointment{visits.length === 1 ? "" : "s"} on record
          </h3>

          {visits.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-[hsl(var(--border))] px-6 py-12 text-center">
              <CalendarDays className="mx-auto text-[hsl(var(--muted-foreground))]" size={22} />
              <p className="mt-3 text-sm font-bold">No visits yet</p>
              <p className="mx-auto mt-1 max-w-xs text-xs text-[hsl(var(--muted-foreground))]">
                Appointments booked for this patient will appear here.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {visits.map((visit: any) => {
                const invoice = invoices[visit.id];
                return (
                  <div
                    key={visit.id}
                    className="rounded-2xl border border-[hsl(var(--border)/.75)] px-4 py-3.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-bold">{visit.service}</p>
                        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                          <CalendarDays size={11} className="shrink-0" />
                          {fmtDate(visit.requested_date) ?? "No date"}
                          {visit.scheduled_time && ` · ${visit.scheduled_time}`}
                        </p>
                      </div>
                      <span className={`status-pill shrink-0 ${
                        VISIT_PILL[STATUS_LABEL[visit.status]] ?? "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
                      }`}>
                        {STATUS_LABEL[visit.status] || visit.status}
                      </span>
                    </div>

                    {invoice && (
                      <div className="mt-2.5 flex items-center gap-1.5 border-t border-[hsl(var(--border)/.5)] pt-2.5">
                        <Receipt size={12} className="text-[hsl(var(--muted-foreground))]" />
                        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                          {peso(Number(invoice.total_amount))} · {invoice.status}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="mt-8 flex justify-end border-t border-[hsl(var(--border)/.7)] pt-6">
          <button
            onClick={onDelete}
            aria-label="Delete owner"
            className="rounded-xl border border-[hsl(var(--border))] px-4 text-[hsl(var(--muted-foreground))] transition hover:border-[hsl(var(--destructive)/.4)] hover:bg-[hsl(var(--destructive)/.08)] hover:text-[hsl(var(--destructive))]"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

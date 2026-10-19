import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, ChevronRight, ChevronDown, PawPrint } from "lucide-react";

const CARD = "rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] shadow-[0_1px_2px_rgb(15_36_71/.05),0_4px_16px_rgb(15_36_71/.05)]";
const INPUT = "block h-11 w-full rounded-[10px] border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 text-[14px] font-medium transition placeholder:font-normal placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary))] focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-1";
const BTN_SOLID = "inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-[hsl(var(--primary))] px-5 text-[14px] font-bold text-[hsl(var(--primary-foreground))] transition hover:opacity-90";

export default function SpeciesSection() {
  const queryClient = useQueryClient();
  const [newSpeciesName, setNewSpeciesName] = useState("");
  const [addingSpecies, setAddingSpecies] = useState(false);
  
  // Selected species for managing breeds
  const [selectedSpeciesId, setSelectedSpeciesId] = useState<string | null>(null);
  const [newBreedName, setNewBreedName] = useState("");
  const [addingBreed, setAddingBreed] = useState(false);

  // Fetch species
  const { data: species = [], isLoading: loadingSpecies } = useQuery({
    queryKey: ["settings-species-list"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("categories")
        .select("id, name")
        .eq("type", "species")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch breeds for the selected species (assuming a related table or category structure)
  const { data: breeds = [], isLoading: loadingBreeds } = useQuery({
    queryKey: ["settings-breeds-list", selectedSpeciesId],
    enabled: !!selectedSpeciesId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("categories") // or your breeds table if separate
        .select("id, name")
        .eq("type", "breed")
        .eq("parent_id", selectedSpeciesId)
        .order("name", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const handleAddSpecies = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSpeciesName.trim()) return;

    setAddingSpecies(true);
    const { error } = await (supabase as any).from("categories").insert({
      name: newSpeciesName.trim(),
      type: "species",
    });
    setAddingSpecies(false);

    if (error) {
      toast.error("Couldn't add species.");
      return;
    }

    toast.success("Species added.");
    setNewSpeciesName("");
    queryClient.invalidateQueries({ queryKey: ["settings-species-list"] });
    queryClient.invalidateQueries({ queryKey: ["settings-species"] });
  };

  const handleDeleteSpecies = async (id: string) => {
    const { error } = await (supabase as any).from("categories").delete().eq("id", id);
    if (error) {
      toast.error("Couldn't delete species.");
      return;
    }
    if (selectedSpeciesId === id) setSelectedSpeciesId(null);
    toast.success("Species removed.");
    queryClient.invalidateQueries({ queryKey: ["settings-species-list"] });
    queryClient.invalidateQueries({ queryKey: ["settings-species"] });
  };

  const handleAddBreed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBreedName.trim() || !selectedSpeciesId) return;

    setAddingBreed(true);
    const { error } = await (supabase as any).from("categories").insert({
      name: newBreedName.trim(),
      type: "breed",
      parent_id: selectedSpeciesId,
    });
    setAddingBreed(false);

    if (error) {
      toast.error("Couldn't add breed.");
      return;
    }

    toast.success("Breed added.");
    setNewBreedName("");
    queryClient.invalidateQueries({ queryKey: ["settings-breeds-list", selectedSpeciesId] });
  };

  const handleDeleteBreed = async (id: string) => {
    const { error } = await (supabase as any).from("categories").delete().eq("id", id);
    if (error) {
      toast.error("Couldn't delete breed.");
      return;
    }
    toast.success("Breed removed.");
    queryClient.invalidateQueries({ queryKey: ["settings-breeds-list", selectedSpeciesId] });
  };

  if (loadingSpecies) {
    return (
      <div className={`${CARD} flex justify-center py-16`}>
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
      </div>
    );
  }

  const selectedSpecies = species.find((s: any) => s.id === selectedSpeciesId);

  return (
    <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
      {/* Species Management Column */}
      <div className={CARD} aria-label="Species list">
        <div className="p-6">
          <h3 className="text-[18px] font-extrabold tracking-[-.01em]">Species</h3>
          <p className="mt-1 text-[14px] text-[hsl(var(--muted-foreground))]">
            Add and manage the primary animal categories for clinic patients.
          </p>

          <form onSubmit={handleAddSpecies} className="mt-5 flex gap-3">
            <input
              type="text"
              placeholder="New species (e.g. Rabbit)"
              value={newSpeciesName}
              onChange={(e) => setNewSpeciesName(e.target.value)}
              className={`${INPUT} flex-1`}
            />
            <button type="submit" disabled={addingSpecies || !newSpeciesName.trim()} className={BTN_SOLID}>
              {addingSpecies ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Add
            </button>
          </form>

          <div className="mt-6 divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))]">
            {species.length === 0 ? (
              <p className="p-6 text-center text-[14px] text-[hsl(var(--muted-foreground))]">No species found.</p>
            ) : (
              species.map((item: any) => {
                const isSelected = item.id === selectedSpeciesId;
                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedSpeciesId(item.id)}
                    className={`flex cursor-pointer items-center justify-between px-5 py-3.5 transition hover:bg-[hsl(var(--muted)/.5)] ${
                      isSelected ? "bg-[hsl(var(--muted)/.8)] font-semibold" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <PawPrint size={16} className="text-[hsl(var(--primary))]" />
                      <span className="text-[15px]">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSpecies(item.id);
                        }}
                        className="text-[hsl(var(--destructive))] transition hover:opacity-75"
                        aria-label={`Delete ${item.name}`}
                      >
                        <Trash2 size={16} />
                      </button>
                      <ChevronRight size={16} className="text-[hsl(var(--muted-foreground))]" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Breeds Management Column */}
      <div className={CARD} aria-label="Breeds list">
        <div className="p-6">
          <h3 className="text-[18px] font-extrabold tracking-[-.01em]">
            {selectedSpecies ? `Breeds for ${selectedSpecies.name}` : "Breeds"}
          </h3>
          <p className="mt-1 text-[14px] text-[hsl(var(--muted-foreground))]">
            {selectedSpecies
              ? `Manage specific breeds under ${selectedSpecies.name}.`
              : "Select a species on the left to manage its breeds."}
          </p>

          {selectedSpecies ? (
            <>
              <form onSubmit={handleAddBreed} className="mt-5 flex gap-3">
                <input
                  type="text"
                  placeholder={`New breed for ${selectedSpecies.name}`}
                  value={newBreedName}
                  onChange={(e) => setNewBreedName(e.target.value)}
                  className={`${INPUT} flex-1`}
                />
                <button type="submit" disabled={addingBreed || !newBreedName.trim()} className={BTN_SOLID}>
                  {addingBreed ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  Add Breed
                </button>
              </form>

              <div className="mt-6 divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))]">
                {loadingBreeds ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--primary))]" />
                  </div>
                ) : breeds.length === 0 ? (
                  <p className="p-6 text-center text-[14px] text-[hsl(var(--muted-foreground))]">
                    No breeds added for this species yet.
                  </p>
                ) : (
                  breeds.map((breed: any) => (
                    <div key={breed.id} className="flex items-center justify-between px-5 py-3.5">
                      <span className="text-[15px] font-medium">{breed.name}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteBreed(breed.id)}
                        className="text-[hsl(var(--destructive))] transition hover:opacity-75"
                        aria-label={`Delete ${breed.name}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="mt-12 flex flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] p-10 text-center">
              <PawPrint size={32} className="text-[hsl(var(--muted-foreground)/.5)]" />
              <p className="mt-3 text-[14px] font-medium text-[hsl(var(--muted-foreground))]">
                No species selected. Click on a species from the left list to view and manage its breeds.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
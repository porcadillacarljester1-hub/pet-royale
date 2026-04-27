import { create } from "zustand";

interface AdminState {
  isLoggedIn: boolean;
  login: () => void;
  logout: () => void;
}

export const useAdminStore = create<AdminState>((set) => ({
  isLoggedIn: false,
  login: () => set({ isLoggedIn: true }),
  logout: () => set({ isLoggedIn: false }),
}));

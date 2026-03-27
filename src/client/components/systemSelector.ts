import type { SystemDTO } from "../../shared/types";
import { api } from "../api/client";

const STORAGE_KEY = "rcv:systemId";

export interface SystemSelectorData {
  systems: SystemDTO[];
  selectedSystemId: string | null;
  loading: boolean;
  error: string | null;

  init(): Promise<void>;
  selectSystem(id: string): void;
}

export function systemSelector(): SystemSelectorData {
  return {
    systems: [],
    selectedSystemId: null,
    loading: false,
    error: null,

    async init() {
      this.loading = true;
      this.error = null;
      try {
        this.systems = await api.getSystems();
        const savedId = localStorage.getItem(STORAGE_KEY);
        if (savedId && this.systems.find((s) => s.id === savedId)) {
          this.selectSystem(savedId);
        } else if (this.systems.length === 1) {
          this.selectSystem(this.systems[0]!.id);
        }
      } catch (err) {
        this.error = String(err);
      } finally {
        this.loading = false;
      }
    },

    selectSystem(id: string) {
      this.selectedSystemId = id;
      localStorage.setItem(STORAGE_KEY, id);
      const sys = this.systems.find((s) => s.id === id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).$dispatch("system-selected", { id, name: sys?.name ?? id });
    },
  };
}

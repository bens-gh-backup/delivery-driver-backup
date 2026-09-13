import { GAME_CONFIG } from "../game/config";
import type { PlayerProgression } from "../vehicles/VehicleTypes";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class ProgressionStore {
  constructor(private readonly storage: KeyValueStorage | null = browserStorage()) {}

  load(): unknown {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(GAME_CONFIG.progression.saveKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  save(progression: PlayerProgression): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(GAME_CONFIG.progression.saveKey, JSON.stringify(progression));
    } catch {
      // Storage failures should not stop the game session.
    }
  }

  clear(): void {
    if (!this.storage) return;
    try {
      this.storage.removeItem(GAME_CONFIG.progression.saveKey);
    } catch {
      // Storage failures should not stop the game session.
    }
  }
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

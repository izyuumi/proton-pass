import { LocalStorage } from "@raycast/api";
import { Item, Vault } from "./types";

const ITEMS_CACHE_KEY = "proton_pass_items_cache";
const VAULTS_CACHE_KEY = "proton_pass_vaults_cache";
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedData<T> {
  data: T;
  timestamp: number;
}

function isCacheValid<T>(cached: CachedData<T>): boolean {
  return Date.now() - cached.timestamp < CACHE_TTL_MS;
}

export async function getCachedItems(): Promise<Item[] | null> {
  try {
    const raw = await LocalStorage.getItem<string>(ITEMS_CACHE_KEY);
    if (!raw) return null;

    const cached: CachedData<Item[]> = JSON.parse(raw);
    if (!isCacheValid(cached)) return null;

    return cached.data;
  } catch {
    return null;
  }
}

export async function setCachedItems(items: Item[]): Promise<void> {
  const cached: CachedData<Item[]> = { data: items, timestamp: Date.now() };
  await LocalStorage.setItem(ITEMS_CACHE_KEY, JSON.stringify(cached));
}

export async function getCachedVaults(): Promise<Vault[] | null> {
  try {
    const raw = await LocalStorage.getItem<string>(VAULTS_CACHE_KEY);
    if (!raw) return null;

    const cached: CachedData<Vault[]> = JSON.parse(raw);
    if (!isCacheValid(cached)) return null;

    return cached.data;
  } catch {
    return null;
  }
}

export async function setCachedVaults(vaults: Vault[]): Promise<void> {
  const cached: CachedData<Vault[]> = { data: vaults, timestamp: Date.now() };
  await LocalStorage.setItem(VAULTS_CACHE_KEY, JSON.stringify(cached));
}

export async function clearCache(): Promise<void> {
  await Promise.all([LocalStorage.removeItem(ITEMS_CACHE_KEY), LocalStorage.removeItem(VAULTS_CACHE_KEY)]);
}

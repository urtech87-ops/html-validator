"use client";

import { useSyncExternalStore } from "react";
import { createPersistedStore } from "@/lib/client/persisted-store";
import { parseFilters, type MessageFilter } from "@/lib/validation/message-filters";
import { DEFAULT_OPTIONS, parseOptions, type ValidationOptions } from "@/lib/validation/options";

export const optionsStore = createPersistedStore<ValidationOptions>("markuplens-options", DEFAULT_OPTIONS, parseOptions);
export const filtersStore = createPersistedStore<MessageFilter[]>("markuplens-message-filters", [], parseFilters);

export function useOptions(): [ValidationOptions, (next: ValidationOptions) => void] {
  const value = useSyncExternalStore(optionsStore.subscribe, optionsStore.getSnapshot, optionsStore.getServerSnapshot);
  return [value, optionsStore.set];
}

export function useMessageFilters(): [MessageFilter[], (next: MessageFilter[]) => void] {
  const value = useSyncExternalStore(filtersStore.subscribe, filtersStore.getSnapshot, filtersStore.getServerSnapshot);
  return [value, filtersStore.set];
}

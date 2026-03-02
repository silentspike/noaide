import { createContext, useContext } from "solid-js";

export interface ExpandedState {
  isExpanded: (key: string, defaultValue: boolean) => boolean;
  toggle: (key: string) => void;
}

const ExpandedContext = createContext<ExpandedState>();

export function useExpanded() {
  return useContext(ExpandedContext);
}

export const ExpandedProvider = ExpandedContext.Provider;

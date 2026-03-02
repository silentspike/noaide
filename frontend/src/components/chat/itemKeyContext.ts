import { createContext, useContext } from "solid-js";

const ItemKeyContext = createContext<string>();

export function useItemKey() {
  return useContext(ItemKeyContext);
}

export const ItemKeyProvider = ItemKeyContext.Provider;

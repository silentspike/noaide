import { createSignal, onCleanup, onMount } from "solid-js";

export function useMediaQuery(query: string): () => boolean {
  const [matches, setMatches] = createSignal(false);

  onMount(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    onCleanup(() => mql.removeEventListener("change", handler));
  });

  return matches;
}

export function useIsMobile(): () => boolean {
  return useMediaQuery("(max-width: 767px)");
}

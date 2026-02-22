import { type Component, createSignal, onMount } from "solid-js";

type Theme = "mocha" | "latte";

interface Props {
  onToggle?: (theme: Theme) => void;
}

const ThemeToggle: Component<Props> = (props) => {
  const [theme, setTheme] = createSignal<Theme>("mocha");

  onMount(() => {
    const stored = localStorage.getItem("togaf-theme") as Theme | null;
    if (stored === "latte") {
      setTheme("latte");
      applyTheme("latte");
    }
  });

  function applyTheme(t: Theme) {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("togaf-theme", t);
  }

  function toggle() {
    const next: Theme = theme() === "mocha" ? "latte" : "mocha";
    setTheme(next);
    applyTheme(next);
    props.onToggle?.(next);
  }

  return (
    <button
      class="theme-toggle"
      onClick={toggle}
      title={`Switch to ${theme() === "mocha" ? "Latte (light)" : "Mocha (dark)"}`}
    >
      &#9681;
    </button>
  );
};

export default ThemeToggle;

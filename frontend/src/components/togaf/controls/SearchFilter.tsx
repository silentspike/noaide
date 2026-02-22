import { type Component, createSignal } from "solid-js";

interface Props {
  placeholder?: string;
  onFilter: (query: string) => void;
}

const SearchFilter: Component<Props> = (props) => {
  const [query, setQuery] = createSignal("");

  function handleInput(e: InputEvent) {
    const value = (e.target as HTMLInputElement).value;
    setQuery(value);
    props.onFilter(value);
  }

  function clear() {
    setQuery("");
    props.onFilter("");
  }

  return (
    <div style={{ display: "flex", "align-items": "center", gap: "4px", position: "relative" }}>
      <input
        class="search-input"
        type="text"
        value={query()}
        onInput={handleInput}
        placeholder={props.placeholder ?? "Filter..."}
      />
      {query() && (
        <button
          onClick={clear}
          style={{
            position: "absolute",
            right: "8px",
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            "font-size": "0.85rem",
            padding: "0 4px",
          }}
        >
          &times;
        </button>
      )}
    </div>
  );
};

export default SearchFilter;

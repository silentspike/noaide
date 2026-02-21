import { createSignal, Show, For } from "solid-js";
import FileNode, { type FileEntry } from "./FileNode";

interface FileTreeProps {
  onFileSelect: (path: string) => void;
}

export default function FileTree(props: FileTreeProps) {
  const [selectedPath, setSelectedPath] = createSignal<string>("");
  const [searchQuery, setSearchQuery] = createSignal("");

  // Demo tree structure — will be replaced by real data from WebTransport
  const [tree] = createSignal<FileEntry[]>([
    {
      name: "src",
      path: "src",
      isDir: true,
      children: [
        { name: "main.rs", path: "src/main.rs", isDir: false },
        {
          name: "parser",
          path: "src/parser",
          isDir: true,
          children: [
            { name: "mod.rs", path: "src/parser/mod.rs", isDir: false },
            { name: "jsonl.rs", path: "src/parser/jsonl.rs", isDir: false, modified: true },
            { name: "types.rs", path: "src/parser/types.rs", isDir: false },
          ],
        },
        {
          name: "ecs",
          path: "src/ecs",
          isDir: true,
          children: [
            { name: "mod.rs", path: "src/ecs/mod.rs", isDir: false },
            { name: "components.rs", path: "src/ecs/components.rs", isDir: false },
          ],
        },
      ],
    },
    { name: "Cargo.toml", path: "Cargo.toml", isDir: false },
    { name: "README.md", path: "README.md", isDir: false },
  ]);

  const handleSelect = (path: string) => {
    setSelectedPath(path);
    props.onFileSelect(path);
  };

  const filteredTree = () => {
    const q = searchQuery().toLowerCase();
    if (!q) return tree();
    return filterEntries(tree(), q);
  };

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        background: "var(--ctp-mantle)",
      }}
    >
      <div
        style={{
          padding: "8px",
          "border-bottom": "1px solid var(--ctp-surface0)",
        }}
      >
        <input
          type="text"
          placeholder="Filter files..."
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
          style={{
            width: "100%",
            padding: "4px 8px",
            background: "var(--ctp-surface0)",
            border: "1px solid var(--ctp-surface1)",
            "border-radius": "4px",
            color: "var(--ctp-text)",
            "font-family": "var(--font-mono)",
            "font-size": "11px",
            outline: "none",
          }}
        />
      </div>
      <div
        style={{
          flex: "1",
          overflow: "auto",
          padding: "4px 0",
        }}
      >
        <For each={filteredTree()}>
          {(entry) => (
            <FileNode
              entry={entry}
              depth={0}
              onSelect={handleSelect}
              selectedPath={selectedPath()}
            />
          )}
        </For>
      </div>
    </div>
  );
}

function filterEntries(entries: FileEntry[], query: string): FileEntry[] {
  const result: FileEntry[] = [];
  for (const entry of entries) {
    if (entry.isDir && entry.children) {
      const filteredChildren = filterEntries(entry.children, query);
      if (filteredChildren.length > 0) {
        result.push({ ...entry, children: filteredChildren });
      }
    } else if (entry.name.toLowerCase().includes(query)) {
      result.push(entry);
    }
  }
  return result;
}

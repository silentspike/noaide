import { Show, For, Switch, Match } from "solid-js";
import type { ContentBlock, ToolResultContent } from "../../types/messages";
import EditCard from "../tools/EditCard";
import BashCard from "../tools/BashCard";
import ReadCard from "../tools/ReadCard";
import GrepCard from "../tools/GrepCard";
import GlobCard from "../tools/GlobCard";
import WebSearchCard from "../tools/WebSearchCard";
import WebFetchCard from "../tools/WebFetchCard";
import LspCard from "../tools/LspCard";
import NotebookCard from "../tools/NotebookCard";
import PdfCard from "../tools/PdfCard";
import PermissionCard from "../tools/PermissionCard";
import ToolCardBase from "../tools/ToolCardBase";

interface ToolCardProps {
  blocks: ContentBlock[];
}

export default function ToolCard(props: ToolCardProps) {
  const toolUse = () => props.blocks.find((b) => b.type === "tool_use");
  const toolResult = () => props.blocks.find((b) => b.type === "tool_result");

  const toolName = () => toolUse()?.name ?? "tool";
  const isError = () => toolResult()?.is_error === true;
  const input = () => toolUse()?.input as Record<string, unknown> | undefined;

  /** Extract text content from tool_result (handles both string and array) */
  const resultText = (): string => {
    const c = toolResult()?.content;
    if (!c) return "";
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      return (c as ToolResultContent[])
        .filter((item) => item.type === "text" && item.text)
        .map((item) => item.text!)
        .join("\n");
    }
    return String(c);
  };

  /** Extract image blocks from tool_result content array */
  const resultImages = (): ToolResultContent[] => {
    const c = toolResult()?.content;
    if (!c || typeof c === "string" || !Array.isArray(c)) return [];
    return (c as ToolResultContent[]).filter(
      (item) => item.type === "image" && item.source,
    );
  };

  return (
    <Switch fallback={<GenericToolCard toolName={toolName()} input={input()} result={resultText()} images={resultImages()} isError={isError()} />}>
      <Match when={toolName() === "Edit"}>
        <EditCard
          filePath={(input()?.file_path as string) ?? ""}
          oldString={input()?.old_string as string | undefined}
          newString={input()?.new_string as string | undefined}
          result={resultText()}
          isError={isError()}
        />
      </Match>
      <Match when={toolName() === "Bash"}>
        <BashCard
          command={(input()?.command as string) ?? ""}
          description={(input()?.description as string) ?? undefined}
          output={resultText()}
          isError={isError()}
        />
      </Match>
      <Match when={toolName() === "Read"}>
        {(() => {
          const filePath = (input()?.file_path as string) ?? "";
          const isPdf = filePath.endsWith(".pdf");
          return isPdf ? (
            <PdfCard
              filePath={filePath}
              pages={input()?.pages as string | undefined}
              content={resultText()}
              isError={isError()}
            />
          ) : (
            <ReadCard
              filePath={filePath}
              content={resultText()}
              images={resultImages()}
              isError={isError()}
            />
          );
        })()}
      </Match>
      <Match when={toolName() === "Grep"}>
        <GrepCard
          pattern={(input()?.pattern as string) ?? ""}
          results={resultText()}
          isError={isError()}
        />
      </Match>
      <Match when={toolName() === "Glob"}>
        <GlobCard
          pattern={(input()?.pattern as string) ?? ""}
          files={resultText()}
          isError={isError()}
        />
      </Match>
      <Match when={toolName() === "WebSearch"}>
        <WebSearchCard
          query={(input()?.query as string) ?? ""}
          results={resultText()}
          isError={isError()}
        />
      </Match>
      <Match when={toolName() === "WebFetch"}>
        <WebFetchCard
          url={(input()?.url as string) ?? ""}
          content={resultText()}
          isError={isError()}
        />
      </Match>
      <Match when={toolName() === "LSP"}>
        <LspCard
          operation={(input()?.operation as string) ?? ""}
          filePath={(input()?.filePath as string) ?? ""}
          line={input()?.line as number | undefined}
          result={resultText()}
          isError={isError()}
        />
      </Match>
      <Match when={toolName() === "NotebookEdit"}>
        <NotebookCard
          cellType={(input()?.cell_type as string) ?? "code"}
          content={(input()?.new_source as string) ?? ""}
          isError={isError()}
        />
      </Match>
      <Match when={toolName() === "AskUserQuestion"}>
        <PermissionCard
          tool="AskUserQuestion"
          description={JSON.stringify(input()?.questions ?? [], null, 2)}
          isError={isError()}
        />
      </Match>
    </Switch>
  );
}

function GenericToolCard(props: {
  toolName: string;
  input?: Record<string, unknown>;
  result: string;
  images?: ToolResultContent[];
  isError: boolean;
}) {
  const inputText = () => {
    if (!props.input) return "";
    return JSON.stringify(props.input, null, 2);
  };

  return (
    <ToolCardBase toolName={props.toolName} isError={props.isError}>
      <Show when={inputText()}>
        <pre
          style={{
            margin: "0 0 6px",
            "font-family": "var(--font-mono)",
            "font-size": "11px",
            color: "var(--ctp-subtext0)",
            "white-space": "pre-wrap",
            "word-break": "break-word",
            "max-height": "200px",
            overflow: "auto",
          }}
        >
          {inputText()}
        </pre>
      </Show>
      <Show when={props.images && props.images.length > 0}>
        <ToolResultImages images={props.images!} />
      </Show>
      <Show when={props.result}>
        <pre
          style={{
            margin: "0",
            "font-family": "var(--font-mono)",
            "font-size": "11px",
            color: props.isError ? "var(--ctp-red)" : "var(--ctp-subtext0)",
            "white-space": "pre-wrap",
            "word-break": "break-word",
            "max-height": "300px",
            overflow: "auto",
          }}
        >
          {props.result}
        </pre>
      </Show>
    </ToolCardBase>
  );
}

/** Render images from tool_result content (e.g. Read tool on PNG/JPG) */
function ToolResultImages(props: { images: ToolResultContent[] }) {
  return (
    <div style={{ display: "flex", "flex-wrap": "wrap", gap: "8px", margin: "6px 0" }}>
      <For each={props.images}>
        {(img) => (
          <div
            style={{
              "border-radius": "8px",
              overflow: "hidden",
              border: "1px solid var(--ctp-surface1)",
              "max-width": "100%",
            }}
          >
            <img
              src={`data:${img.source!.media_type};base64,${img.source!.data}`}
              alt="Tool result image"
              style={{
                "max-width": "100%",
                "max-height": "400px",
                "object-fit": "contain",
                display: "block",
              }}
            />
          </div>
        )}
      </For>
    </div>
  );
}

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Severity } from "@/lib/types";

export interface SuggestionRange {
  id: string;
  from: number;
  to: number;
  severity: Severity;
}

const pluginKey = new PluginKey<DecorationSet>("suggestionHighlight");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    suggestionHighlight: {
      setSuggestionRanges: (ranges: SuggestionRange[]) => ReturnType;
      setActiveSuggestion: (id: string | null) => ReturnType;
    };
  }
}

interface State {
  ranges: SuggestionRange[];
  activeId: string | null;
}

const stateKey = new PluginKey<State>("suggestionHighlightState");

function buildDecorations(state: State, doc: { content: { size: number } }) {
  const decos = state.ranges
    .filter((r) => r.from >= 0 && r.from < r.to && r.to <= doc.content.size)
    .map((r) =>
      Decoration.inline(r.from, r.to, {
        class: [
          "geo-highlight",
          `geo-highlight-${r.severity}`,
          state.activeId === r.id ? "geo-highlight-active" : "",
        ]
          .filter(Boolean)
          .join(" "),
        "data-suggestion-id": r.id,
      }),
    );
  return DecorationSet.create(doc as never, decos);
}

export const SuggestionHighlight = Extension.create({
  name: "suggestionHighlight",

  addCommands() {
    return {
      setSuggestionRanges:
        (ranges) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(stateKey, { ranges }));
          return true;
        },
      setActiveSuggestion:
        (id) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(stateKey, { activeId: id }));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<State>({
        key: stateKey,
        state: {
          init: () => ({ ranges: [], activeId: null }),
          apply(tr, prev) {
            const meta = tr.getMeta(stateKey) as Partial<State> | undefined;
            if (!meta) return prev;
            return {
              ranges: meta.ranges ?? prev.ranges,
              activeId:
                meta.activeId !== undefined ? meta.activeId : prev.activeId,
            };
          },
        },
      }),
      new Plugin({
        key: pluginKey,
        props: {
          decorations(state) {
            const s = stateKey.getState(state);
            if (!s) return DecorationSet.empty;
            return buildDecorations(s, state.doc);
          },
        },
      }),
    ];
  },
});

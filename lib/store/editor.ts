"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Suggestion } from "@/lib/types";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface ArticleState {
  title: string;
  body: string;
  saveStatus: SaveStatus;
  updatedAt: number;
}

interface EditorStore {
  articles: Record<string, ArticleState>;
  activeSuggestionId: string | null;

  upsert: (id: string, patch: Partial<ArticleState>) => void;
  setActiveSuggestion: (id: string | null) => void;
}

const DEFAULT_ARTICLE: ArticleState = {
  title: "",
  body: "",
  saveStatus: "idle",
  updatedAt: 0,
};

export const useEditorStore = create<EditorStore>()(
  persist(
    (set) => ({
      articles: {},
      activeSuggestionId: null,

      upsert: (id, patch) =>
        set((state) => ({
          articles: {
            ...state.articles,
            [id]: {
              ...DEFAULT_ARTICLE,
              ...state.articles[id],
              ...patch,
              updatedAt: Date.now(),
            },
          },
        })),

      setActiveSuggestion: (id) => set({ activeSuggestionId: id }),
    }),
    {
      name: "peec-content-studio:editor",
      partialize: (state) => ({ articles: state.articles }),
    },
  ),
);

export function getArticle(
  state: EditorStore,
  id: string,
): ArticleState {
  return state.articles[id] ?? DEFAULT_ARTICLE;
}

export type { Suggestion };

"use client";

import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "./useDebounce";
import type { SuggestRequest, SuggestResponse } from "@/lib/types";

const DEBOUNCE_MS = 800;
const MIN_TEXT_LENGTH = 60;

async function fetchSuggestions(req: SuggestRequest): Promise<SuggestResponse> {
  const res = await fetch("/api/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error || body?.message || JSON.stringify(body);
    } catch {
      detail = await res.text();
    }
    throw new Error(`${res.status} ${res.statusText} — ${detail}`);
  }
  return (await res.json()) as SuggestResponse;
}

interface UseSuggestionsArgs {
  articleId: string;
  title: string;
  body: string;
  plainText: string;
}

export function useSuggestions({
  articleId,
  title,
  body,
  plainText,
}: UseSuggestionsArgs) {
  const debouncedTitle = useDebounce(title, DEBOUNCE_MS);
  const debouncedText = useDebounce(plainText, DEBOUNCE_MS);
  // body is tracked for invalidation but not sent — the API takes plain text.
  void body;

  const enabled = debouncedText.trim().length >= MIN_TEXT_LENGTH;

  const query = useQuery({
    queryKey: ["suggest", articleId, debouncedTitle, debouncedText],
    queryFn: () =>
      fetchSuggestions({
        articleId,
        articleTitle: debouncedTitle,
        articleText: debouncedText,
      }),
    enabled,
  });

  return {
    suggestions: query.data?.suggestions ?? [],
    status: query.isLoading
      ? ("loading" as const)
      : query.isError
        ? ("error" as const)
        : query.isSuccess
          ? ("ready" as const)
          : ("idle" as const),
    errorMessage: query.error instanceof Error ? query.error.message : undefined,
    isFetching: query.isFetching,
    enabled,
  };
}

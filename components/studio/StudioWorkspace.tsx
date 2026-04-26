"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { Editor } from "@/components/studio/Editor";
import { StudioHeader } from "@/components/studio/StudioHeader";
import { SuggestionsSidebar } from "@/components/studio/SuggestionsSidebar";
import { useEditorStore } from "@/lib/store/editor";
import { useSuggestions } from "@/components/studio/hooks/useSuggestions";
import { SimulatorModal } from "@/components/simulator/SimulatorModal";
import type { SuggestionRange } from "@/components/studio/extensions/SuggestionHighlight";

interface StudioWorkspaceProps {
  articleId: string;
  actionText?: string;
}

const SAVED_PULSE_MS = 600;

export function StudioWorkspace({ articleId, actionText }: StudioWorkspaceProps) {
  const article = useEditorStore((s) => s.articles[articleId]);
  const upsert = useEditorStore((s) => s.upsert);

  const [hydrated, setHydrated] = useState(false);
  const [editor, setEditor] = useState<TiptapEditor | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [plainText, setPlainText] = useState("");
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from localStorage post-mount (avoid SSR mismatch).
  useEffect(() => {
    setHydrated(true);
  }, []);

  const title = article?.title ?? "";
  const body = article?.body ?? "";
  const saveStatus = article?.saveStatus ?? "idle";

  const { suggestions, status, errorMessage } = useSuggestions({
    articleId,
    title,
    body,
    plainText,
  });

  const visibleSuggestions = useMemo(
    () => suggestions.filter((s) => !dismissed.has(s.id)),
    [suggestions, dismissed],
  );

  const ranges: SuggestionRange[] = useMemo(
    () =>
      visibleSuggestions.map((s) => ({
        id: s.id,
        from: s.range.from,
        to: s.range.to,
        severity: s.severity,
      })),
    [visibleSuggestions],
  );

  const markSaved = useCallback(() => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
    upsert(articleId, { saveStatus: "saving" });
    savedTimer.current = setTimeout(() => {
      upsert(articleId, { saveStatus: "saved" });
    }, SAVED_PULSE_MS);
  }, [articleId, upsert]);

  const handleTitleChange = (v: string) => {
    upsert(articleId, { title: v, saveStatus: "dirty" });
    markSaved();
  };

  const handleBodyChange = useCallback(
    (html: string, text: string) => {
      setPlainText(text);
      upsert(articleId, { body: html, saveStatus: "dirty" });
      markSaved();
    },
    [articleId, upsert, markSaved],
  );

  const handleApply = useCallback(
    (id: string) => {
      const s = visibleSuggestions.find((x) => x.id === id);
      if (!s || !s.suggestedEdit || !editor) return;
      editor
        .chain()
        .focus()
        .setTextSelection({ from: s.range.from, to: s.range.to })
        .insertContent(s.suggestedEdit)
        .run();
      setDismissed((prev) => new Set(prev).add(id));
      setActiveId(null);
    },
    [editor, visibleSuggestions],
  );

  const handleDismiss = (id: string) => {
    setDismissed((prev) => new Set(prev).add(id));
    if (activeId === id) setActiveId(null);
  };

  const handleSelect = (id: string) => {
    setActiveId(id);
    if (!editor) return;
    const s = visibleSuggestions.find((x) => x.id === id);
    if (s) {
      editor.commands.focus();
      editor.commands.setTextSelection({ from: s.range.from, to: s.range.to });
    }
  };

  if (!hydrated) {
    return null;
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      <StudioHeader
        title={actionText || title}
        saveStatus={saveStatus}
        onRunSimulator={() => setSimulatorOpen(true)}
        simulatorDisabled={plainText.trim().length < 200}
        simulatorDisabledReason="Add at least 200 characters to your draft to run the simulator."
      />

      <SimulatorModal
        open={simulatorOpen}
        onOpenChange={setSimulatorOpen}
        articleTitle={title}
        articleText={plainText}
      />

      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[760px] mx-auto px-10 pt-12 pb-24">
            <textarea
              rows={1}
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Untitled article"
              className="w-full bg-transparent border-0 outline-none text-[36px] font-semibold tracking-tight text-gray-900 placeholder:text-gray-300 mb-2 resize-none overflow-hidden"
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${target.scrollHeight}px`;
              }}
              ref={(el) => {
                if (el) {
                  el.style.height = "auto";
                  el.style.height = `${el.scrollHeight}px`;
                }
              }}
            />
            <p className="text-[13px] text-gray-400 mb-6">
              Draft for AI-search visibility · suggestions update as you write.
            </p>

            <Editor
              initialContent={body}
              onUpdate={handleBodyChange}
              onReady={setEditor}
              ranges={ranges}
              activeId={activeId}
              onClickSuggestion={handleSelect}
            />
          </div>
        </main>

        <SuggestionsSidebar
          suggestions={visibleSuggestions}
          status={status}
          errorMessage={errorMessage}
          activeId={activeId}
          onSelect={handleSelect}
          onApply={handleApply}
          onDismiss={handleDismiss}
        />
      </div>
    </div>
  );
}

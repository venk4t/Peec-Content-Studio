"use client";

import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect } from "react";
import {
  SuggestionHighlight,
  type SuggestionRange,
} from "@/components/studio/extensions/SuggestionHighlight";

interface EditorProps {
  initialContent: string;
  onUpdate: (html: string, plainText: string) => void;
  onReady: (editor: TiptapEditor) => void;
  ranges: SuggestionRange[];
  activeId: string | null;
  onClickSuggestion: (id: string) => void;
}

export function Editor({
  initialContent,
  onUpdate,
  onReady,
  ranges,
  activeId,
  onClickSuggestion,
}: EditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading") return "Heading";
          return "Start writing… or paste an outline.";
        },
      }),
      SuggestionHighlight,
    ],
    content: initialContent || "<p></p>",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "tiptap focus:outline-none text-[15px] text-gray-900 leading-relaxed min-h-[420px]",
      },
      handleClick(view, _pos, event) {
        const target = event.target as HTMLElement | null;
        const el = target?.closest?.("[data-suggestion-id]");
        const id = el?.getAttribute("data-suggestion-id");
        if (id) {
          onClickSuggestion(id);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      onUpdate(editor.getHTML(), editor.getText());
    },
    onCreate: ({ editor }) => {
      onReady(editor);
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.commands.setSuggestionRanges(ranges);
  }, [editor, ranges]);

  useEffect(() => {
    if (!editor) return;
    editor.commands.setActiveSuggestion(activeId);
  }, [editor, activeId]);

  return <EditorContent editor={editor} />;
}

import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';
import { ChatMarkdownMessage } from './ChatMarkdownMessage.tsx';

function languageExtensionFor(language: string, filePath: string): Extension {
  const lang = (language || '').toLowerCase();
  const ext = filePath.split('.').pop()?.toLowerCase() || '';

  if (lang === 'tsx' || ext === 'tsx') return javascript({ typescript: true, jsx: true });
  if (lang === 'typescript' || lang === 'ts' || ext === 'ts' || ext === 'mts') {
    return javascript({ typescript: true });
  }
  if (lang === 'jsx' || ext === 'jsx') return javascript({ jsx: true });
  if (lang === 'javascript' || lang === 'js' || ext === 'js' || ext === 'mjs' || ext === 'cjs') {
    return javascript();
  }
  if (lang === 'python' || lang === 'py' || ext === 'py') return python();
  if (lang === 'json' || ext === 'json') return json();
  if (lang === 'html' || lang === 'htm' || ext === 'html' || ext === 'htm' || ext === 'svg') {
    return html();
  }
  if (lang === 'css' || lang === 'scss' || ext === 'css' || ext === 'scss') return css();
  if (lang === 'markdown' || lang === 'md' || ext === 'md') return markdown();
  if (lang === 'sql' || ext === 'sql') return sql();
  return [];
}

const editorThemeOverrides = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '12px',
    backgroundColor: '#020617',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace',
    lineHeight: '1.55',
  },
  '.cm-gutters': {
    backgroundColor: '#0f172a',
    color: '#64748b',
    borderRight: '1px solid #1e293b',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#1e293b',
    color: '#e2e8f0',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(30, 41, 59, 0.45)',
  },
});

export function supportsLivePreview(filePath: string, language: string): 'html' | 'markdown' | null {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const lang = (language || '').toLowerCase();
  if (ext === 'html' || ext === 'htm' || ext === 'svg' || lang === 'html') return 'html';
  if (ext === 'md' || ext === 'markdown' || lang === 'markdown') return 'markdown';
  return null;
}

export function CodingCodeEditor({
  filePath,
  value,
  language,
  readOnly = false,
  previewMode = false,
  onChange,
}: {
  filePath: string;
  value: string;
  language: string;
  readOnly?: boolean;
  previewMode?: boolean;
  onChange: (nextValue: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompRef = useRef(new Compartment());
  const readOnlyCompRef = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const isInternalChangeRef = useRef(false);

  onChangeRef.current = onChange;

  const previewKind = supportsLivePreview(filePath, language);
  const showingPreview = previewMode && previewKind !== null;

  useEffect(() => {
    if (showingPreview || !hostRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        isInternalChangeRef.current = true;
        onChangeRef.current(update.state.doc.toString());
        isInternalChangeRef.current = false;
      }
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        oneDark,
        editorThemeOverrides,
        langCompRef.current.of(languageExtensionFor(language, filePath)),
        readOnlyCompRef.current.of(EditorState.readOnly.of(readOnly)),
        updateListener,
        EditorView.contentAttributes.of({
          'aria-label': `Code-Editor für ${filePath}`,
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: hostRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once when entering editor mode or switching filePath
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showingPreview, filePath]);

  // Sync language / readOnly dynamically
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        langCompRef.current.reconfigure(languageExtensionFor(language, filePath)),
        readOnlyCompRef.current.reconfigure(EditorState.readOnly.of(readOnly)),
      ],
    });
  }, [language, filePath, readOnly]);

  // Sync external document updates (e.g. Diff apply / Checkpoint rollback)
  useEffect(() => {
    const view = viewRef.current;
    if (!view || isInternalChangeRef.current) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
    }
  }, [value]);

  if (showingPreview) {
    if (previewKind === 'html') {
      return (
        <div className="flex min-h-0 flex-1 flex-col bg-white" data-testid="coding-live-preview">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] text-slate-600">
            <span className="shrink-0 whitespace-nowrap font-medium">Isolierte HTML-Vorschau (Sandbox)</span>
            <span className="min-w-0 truncate font-mono text-slate-500">
              {filePath.replace(/^coding-workspace\//, '')}
            </span>
          </div>
          <iframe
            title={`Live-Vorschau für ${filePath}`}
            sandbox="allow-scripts"
            srcDoc={value}
            className="min-h-0 w-full flex-1 border-0 bg-white"
          />
        </div>
      );
    }

    return (
      <div
        className="min-h-0 flex-1 overflow-y-auto bg-white p-3 text-slate-900"
        data-testid="coding-live-preview"
      >
        <ChatMarkdownMessage content={value} />
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      data-testid="coding-cm-editor"
      className="min-h-0 flex-1 overflow-hidden bg-slate-950"
    />
  );
}

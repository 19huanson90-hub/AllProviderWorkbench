import { AlertTriangle, Check, GitCompareArrows, X } from 'lucide-react';
import { useMemo } from 'react';
import { computeLineDiff } from '../lib/codingDiff.ts';

export interface PendingDiffReview {
  targetPath: string;
  language: string;
  oldContent: string;
  newContent: string;
  mode: 'patch' | 'overwrite' | 'create';
  appliedHunks?: number;
  totalHunks?: number;
  warning?: string;
}

export function CodingDiffModal({
  review,
  applying,
  onConfirm,
  onCancel,
}: {
  review: PendingDiffReview;
  applying: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const diff = useMemo(
    () => computeLineDiff(review.oldContent, review.newContent),
    [review.oldContent, review.newContent]
  );

  const hasChanges = diff.addedCount > 0 || diff.removedCount > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="diff-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-[1px]"
    >
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="min-w-0">
            <h3
              id="diff-modal-title"
              className="flex items-center gap-2 text-sm font-semibold text-slate-900"
            >
              <GitCompareArrows className="h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
              <span className="truncate">
                Diff-Prüfung: <span className="font-mono">{review.targetPath}</span>
              </span>
            </h3>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-600 tabular-nums">
              <span>
                {review.mode === 'patch'
                  ? `SEARCH/REPLACE-Patch (${review.appliedHunks ?? 0}/${review.totalHunks ?? 0} Blöcke)`
                  : review.mode === 'create'
                    ? 'Neue Datei in coding-workspace/'
                    : 'Datei-Aktualisierung'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono font-medium text-emerald-700">+{diff.addedCount}</span>
              <span className="font-mono font-medium text-rose-700">-{diff.removedCount}</span>
              <span aria-hidden="true">·</span>
              <span>Automatisches Checkpoint-Backup vor Übernahme</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Diff-Prüfung schließen"
            className="rounded p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {review.warning && (
          <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
            <span>{review.warning}</span>
          </div>
        )}

        {/* Unified Diff Viewport */}
        <div
          data-testid="coding-diff-lines"
          className="min-h-0 flex-1 overflow-auto bg-slate-950 font-mono text-[11px] leading-relaxed text-slate-100"
        >
          {!hasChanges ? (
            <div className="p-6 text-center text-xs text-slate-400">
              Keine zeilenweisen Unterschiede — der Inhalt ist identisch.
            </div>
          ) : (
            <table className="w-full border-collapse">
              <tbody>
                {diff.lines.map((line, i) => {
                  const rowCls =
                    line.type === 'added'
                      ? 'bg-emerald-950/60 text-emerald-100'
                      : line.type === 'removed'
                        ? 'bg-rose-950/60 text-rose-100'
                        : 'text-slate-300';
                  const gutterCls =
                    line.type === 'added'
                      ? 'bg-emerald-950/90 text-emerald-400'
                      : line.type === 'removed'
                        ? 'bg-rose-950/90 text-rose-400'
                        : 'bg-slate-900/80 text-slate-500';
                  const marker = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
                  return (
                    <tr key={i} className={rowCls}>
                      <td
                        className={`w-10 select-none border-r border-slate-800 px-1.5 text-right tabular-nums ${gutterCls}`}
                      >
                        {line.oldLine ?? ''}
                      </td>
                      <td
                        className={`w-10 select-none border-r border-slate-800 px-1.5 text-right tabular-nums ${gutterCls}`}
                      >
                        {line.newLine ?? ''}
                      </td>
                      <td className="w-5 select-none px-1.5 text-center font-bold">{marker}</td>
                      <td className="whitespace-pre px-2 py-0.5">{line.text || ' '}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
          <span className="text-[11px] text-slate-500">
            Speichert in <span className="font-mono text-slate-700">{review.targetPath}</span> und legt einen 1-Klick-Checkpoint an.
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={applying}
              className="inline-flex items-center gap-1.5 rounded-md bg-teal-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{applying ? 'Speichere…' : 'Änderung übernehmen'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { Check, Copy, ExternalLink, Image as ImageIcon } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';
import { parseSafeMarkdownBlocks, sanitizeSafeHttpUrl } from '../lib/notebookEngine.ts';

function renderInlineFormatted(text: string): ReactNode[] {
  // Matches: [label](url), **bold**, `code`, or bare https:// URLs
  const tokenRe = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|(https?:\/\/[^\s<>()]+))/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<Fragment key={`t-${keyIdx++}`}>{text.slice(lastIndex, match.index)}</Fragment>);
    }

    if (match[2] && match[3]) {
      const safeHref = sanitizeSafeHttpUrl(match[3]);
      if (safeHref) {
        parts.push(
          <a
            key={`a-${keyIdx++}`}
            href={safeHref}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-teal-700 underline decoration-teal-300 underline-offset-2 hover:text-teal-900"
          >
            {match[2]}
          </a>
        );
      } else {
        parts.push(<Fragment key={`at-${keyIdx++}`}>{match[2]}</Fragment>);
      }
    } else if (match[4]) {
      parts.push(
        <strong key={`b-${keyIdx++}`} className="font-semibold text-slate-950">
          {match[4]}
        </strong>
      );
    } else if (match[5]) {
      parts.push(
        <code
          key={`c-${keyIdx++}`}
          className="rounded bg-slate-200/80 px-1 py-0.5 font-mono text-[11px] text-slate-900"
        >
          {match[5]}
        </code>
      );
    } else if (match[6]) {
      const cleanRaw = match[6].replace(/[.,;:!?]+$/, '');
      const trailing = match[6].slice(cleanRaw.length);
      const safeHref = sanitizeSafeHttpUrl(cleanRaw);
      if (safeHref) {
        parts.push(
          <Fragment key={`u-${keyIdx++}`}>
            <a
              href={safeHref}
              target="_blank"
              rel="noreferrer"
              className="break-all font-medium text-teal-700 underline decoration-teal-300 underline-offset-2 hover:text-teal-900"
            >
              {cleanRaw}
            </a>
            {trailing}
          </Fragment>
        );
      } else {
        parts.push(<Fragment key={`ut-${keyIdx++}`}>{match[6]}</Fragment>);
      }
    }

    lastIndex = tokenRe.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(<Fragment key={`e-${keyIdx++}`}>{text.slice(lastIndex)}</Fragment>);
  }
  return parts;
}

export function ChatMarkdownMessage({ content }: { content: string }) {
  const [copiedCodeIdx, setCopiedCodeIdx] = useState<number | null>(null);
  const blocks = parseSafeMarkdownBlocks(content);

  const handleCopyCode = async (code: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCodeIdx(idx);
      setTimeout(() => setCopiedCodeIdx((c) => (c === idx ? null : c)), 1500);
    } catch {
      // ignore clipboard restrictions
    }
  };

  if (blocks.length === 0) {
    return <div className="whitespace-pre-wrap break-words">{content}</div>;
  }

  return (
    <div className="space-y-2.5 text-xs leading-relaxed text-slate-900">
      {blocks.map((block, idx) => {
        if (block.type === 'heading') {
          const cls =
            block.level <= 2
              ? 'text-sm font-semibold text-slate-950 pt-1'
              : 'text-xs font-semibold text-slate-900 pt-0.5';
          return (
            <div key={idx} className={cls}>
              {renderInlineFormatted(block.text)}
            </div>
          );
        }

        if (block.type === 'list') {
          return (
            <ul key={idx} className="list-disc space-y-1 pl-4">
              {block.items.map((item, j) => (
                <li key={j} className="break-words">
                  {renderInlineFormatted(item)}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === 'code') {
          return (
            <div key={idx} className="overflow-hidden rounded-md border border-slate-800 bg-slate-950">
              <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-2.5 py-1 font-mono text-[10px] text-slate-400">
                <span>{block.language || 'code'}</span>
                <button
                  type="button"
                  onClick={() => void handleCopyCode(block.code, idx)}
                  className="inline-flex items-center gap-1 text-slate-300 hover:text-white"
                >
                  {copiedCodeIdx === idx ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                      Kopiert
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" aria-hidden="true" />
                      Code kopieren
                    </>
                  )}
                </button>
              </div>
              <pre className="max-h-72 overflow-x-auto p-2.5 font-mono text-[11px] leading-relaxed text-slate-100">
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }

        if (block.type === 'image') {
          return (
            <figure
              key={idx}
              className="overflow-hidden rounded-md border border-slate-200 bg-white p-2"
            >
              <img
                src={block.url}
                alt={block.alt}
                loading="lazy"
                className="max-h-80 w-auto rounded object-contain"
              />
              <figcaption className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                <span className="inline-flex items-center gap-1 truncate">
                  <ImageIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {block.alt}
                </span>
                <a
                  href={block.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 font-medium text-teal-700 hover:underline"
                >
                  Original öffnen
                  <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
                </a>
              </figcaption>
            </figure>
          );
        }

        return (
          <p key={idx} className="whitespace-pre-wrap break-words">
            {renderInlineFormatted(block.text)}
          </p>
        );
      })}
    </div>
  );
}

import { ArrowUpDown, ExternalLink, Flame, FlaskConical, KeyRound, Lock, Search, X, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isUsableGreenOrGelb, resolveProviderApiKeyPage } from '../lib/testEngine.ts';
import type { ClassifiedProvider, SecurityClass } from '../lib/types.ts';
import { SecurityClassTag, UnfilteredTag } from './SecurityIndicator.tsx';

interface ClassificationViewProps {
  providers: ClassifiedProvider[];
  initialClassFilter?: SecurityClass | 'ALL';
  activeRouterProviderIds: string[];
  testingSingleId: string | null;
  onUseConnection: (provider: ClassifiedProvider) => void;
  onRunSingleTest: (providerId: string) => void;
}

type ClassFilter = 'ALL' | SecurityClass;
type ClassificationSort = 'default' | 'unfiltered_first' | 'name_asc' | 'class_order';

const CLASS_ORDER: Record<SecurityClass, number> = {
  GRUEN: 0,
  GELB: 1,
  ROT: 2,
  SCHWARZ: 3,
};

export function ClassificationView({
  providers,
  initialClassFilter = 'ALL',
  activeRouterProviderIds,
  testingSingleId,
  onUseConnection,
  onRunSingleTest,
}: ClassificationViewProps) {
  const [classFilter, setClassFilter] = useState<ClassFilter>(initialClassFilter);
  const [onlyUnfiltered, setOnlyUnfiltered] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<ClassificationSort>('default');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [authFilter, setAuthFilter] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');
  const [searchScope, setSearchScope] = useState<'name_url' | 'all'>('name_url');
  const [selectedProvider, setSelectedProvider] = useState<ClassifiedProvider | null>(null);
  const routerSet = useMemo(() => new Set(activeRouterProviderIds), [activeRouterProviderIds]);

  useEffect(() => {
    setClassFilter(initialClassFilter);
  }, [initialClassFilter]);

  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const p of providers) {
      for (const c of p.kategorien) set.add(c);
    }
    return Array.from(set).sort();
  }, [providers]);

  const allAuthTypes = useMemo(() => {
    const set = new Set<string>();
    for (const p of providers) set.add(p.auth_typ || 'unbekannt');
    return Array.from(set).sort();
  }, [providers]);

  const counts = useMemo(() => {
    const c: Record<ClassFilter, number> = {
      ALL: providers.length,
      GRUEN: 0,
      GELB: 0,
      ROT: 0,
      SCHWARZ: 0,
    };
    for (const p of providers) c[p.securityClass]++;
    return c;
  }, [providers]);

  const unfilteredCount = useMemo(
    () => providers.filter((p) => p.isUnfiltered).length,
    [providers]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = providers.filter((p) => {
      if (classFilter !== 'ALL' && p.securityClass !== classFilter) return false;
      if (onlyUnfiltered && !p.isUnfiltered) return false;
      if (categoryFilter !== 'ALL' && !p.kategorien.includes(categoryFilter)) return false;
      if (authFilter !== 'ALL' && p.auth_typ !== authFilter) return false;
      if (q) {
        const safeUrl =
          p.securityClass === 'SCHWARZ' || p.isIllegal ? '' : p.url;
        const hay =
          searchScope === 'name_url'
            ? `${p.name} ${p.id} ${safeUrl} ${p.isUnfiltered ? 'unfiltered uncensored' : ''}`.toLowerCase()
            : `${p.id} ${p.name} ${safeUrl} ${p.kategorien.join(' ')} ${p.beschreibung} ${p.isUnfiltered ? 'unfiltered uncensored' : ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortBy === 'unfiltered_first') {
      return [...list].sort((a, b) => {
        if (a.isUnfiltered !== b.isUnfiltered) return a.isUnfiltered ? -1 : 1;
        if (CLASS_ORDER[a.securityClass] !== CLASS_ORDER[b.securityClass]) {
          return CLASS_ORDER[a.securityClass] - CLASS_ORDER[b.securityClass];
        }
        return a.name.localeCompare(b.name, 'de');
      });
    }
    if (sortBy === 'name_asc') {
      return [...list].sort((a, b) => a.name.localeCompare(b.name, 'de'));
    }
    if (sortBy === 'class_order') {
      return [...list].sort((a, b) => {
        if (CLASS_ORDER[a.securityClass] !== CLASS_ORDER[b.securityClass]) {
          return CLASS_ORDER[a.securityClass] - CLASS_ORDER[b.securityClass];
        }
        if (a.isUnfiltered !== b.isUnfiltered) return a.isUnfiltered ? -1 : 1;
        return a.name.localeCompare(b.name, 'de');
      });
    }
    return list;
  }, [providers, classFilter, onlyUnfiltered, sortBy, categoryFilter, authFilter, search, searchScope]);

  const classButtons: Array<{ value: ClassFilter; label: string }> = [
    { value: 'ALL', label: 'Alle' },
    { value: 'GRUEN', label: 'GRÜN' },
    { value: 'GELB', label: 'GELB' },
    { value: 'ROT', label: 'ROT' },
    { value: 'SCHWARZ', label: 'SCHWARZ' },
  ];

  const hasActiveFilters =
    classFilter !== 'ALL' ||
    onlyUnfiltered ||
    sortBy !== 'default' ||
    categoryFilter !== 'ALL' ||
    authFilter !== 'ALL' ||
    search.trim().length > 0;

  return (
    <div className="space-y-4">
      {/* Filter & Search Toolbar */}
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        {/* Dedicated Name & URL Search Row */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Provider nach Name oder URL filtern (z. B. groq, github.com, ollama)…"
              aria-label="Provider nach Name oder URL suchen"
              className="w-full rounded-md border border-slate-300 bg-white py-2 pr-9 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
            />
            {search.length > 0 && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Suchfeld leeren"
                className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          <div
            className="inline-flex shrink-0 rounded-md border border-slate-200 bg-slate-50 p-0.5"
            role="group"
            aria-label="Suchbereich wählen"
          >
            <button
              type="button"
              onClick={() => setSearchScope('name_url')}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                searchScope === 'name_url'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Name & URL
            </button>
            <button
              type="button"
              onClick={() => setSearchScope('all')}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                searchScope === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Volltext
            </button>
          </div>
        </div>

        {/* Class, Unfiltered, Sort, Category & Auth Filter Row */}
        <div className="flex flex-col gap-3 border-t border-slate-100 pt-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex flex-wrap rounded-md border border-slate-200 bg-slate-50 p-0.5"
              role="group"
              aria-label="Nach Sicherheitsklasse filtern"
            >
              {classButtons.map((btn) => {
                const active = classFilter === btn.value;
                return (
                  <button
                    key={btn.value}
                    type="button"
                    onClick={() => setClassFilter(btn.value)}
                    className={`rounded px-3 py-1.5 text-xs font-medium transition-colors tabular-nums ${
                      active
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {btn.label} ({counts[btn.value]})
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setOnlyUnfiltered((prev) => !prev)}
              aria-pressed={onlyUnfiltered}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs font-semibold transition-colors tabular-nums ${
                onlyUnfiltered
                  ? 'border-fuchsia-600 bg-fuchsia-700 text-white shadow-xs'
                  : 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800 hover:bg-fuchsia-100'
              }`}
            >
              <Flame className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Nur Unfiltered ({unfilteredCount})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5">
              <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as ClassificationSort)}
                aria-label="Provider sortieren"
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-teal-700 focus:outline-none"
              >
                <option value="default">Sortierung: Standard</option>
                <option value="unfiltered_first">Sortierung: Unfiltered zuerst</option>
                <option value="class_order">Sortierung: Klasse (GRÜN → SCHWARZ)</option>
                <option value="name_asc">Sortierung: Name (A–Z)</option>
              </select>
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Nach Kategorie filtern"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-teal-700 focus:outline-none"
            >
              <option value="ALL">Alle Kategorien ({allCategories.length})</option>
              {allCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            <select
              value={authFilter}
              onChange={(e) => setAuthFilter(e.target.value)}
              aria-label="Nach Auth-Typ filtern"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-teal-700 focus:outline-none"
            >
              <option value="ALL">Alle Auth-Typen</option>
              {allAuthTypes.map((auth) => (
                <option key={auth} value={auth}>
                  {auth}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 tabular-nums">
          <p>
            Angezeigt: <strong className="text-slate-900">{filtered.length}</strong> von{' '}
            {providers.length} Provider-Blöcken ({unfilteredCount} als UNFILTERED markiert). Zeile
            anklicken für vollständige Evidenz & Klassifikationsbegründung.
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                setClassFilter('ALL');
                setOnlyUnfiltered(false);
                setSortBy('default');
                setCategoryFilter('ALL');
                setAuthFilter('ALL');
                setSearch('');
              }}
              className="font-medium text-teal-700 hover:text-teal-900 hover:underline"
            >
              Alle Filter zurücksetzen
            </button>
          )}
        </div>
      </div>

      {/* High-Density Data Table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-600">
                <th className="px-4 py-3">Klasse</th>
                <th className="px-4 py-3">Provider / ID / URL</th>
                <th className="px-4 py-3">Kategorien</th>
                <th className="px-4 py-3">Auth</th>
                <th className="px-4 py-3">Verbindung</th>
                <th className="px-4 py-3">Begründung</th>
                <th className="px-4 py-3 text-right">Nutzung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => {
                const isSelected = selectedProvider?.id === p.id;
                const maskedUrl = p.securityClass === 'SCHWARZ' || p.isIllegal;
                const usable = isUsableGreenOrGelb(p);
                const inRouter = routerSet.has(p.id);
                return (
                  <tr
                    key={`${p.id}-${p.sourceLineNumber}`}
                    onClick={() => setSelectedProvider(p)}
                    className={`cursor-pointer transition-colors hover:bg-slate-50 ${
                      isSelected ? 'bg-teal-50/60' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 align-top">
                      <div className="flex flex-col items-start gap-1">
                        <SecurityClassTag secClass={p.securityClass} />
                        {p.isUnfiltered && <UnfilteredTag compact />}
                        {inRouter && (
                          <div className="font-mono text-[10px] font-semibold text-teal-700">
                            IM ROUTER
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="max-w-xs px-4 py-2.5 align-top">
                      <div className="flex flex-wrap items-center gap-1.5 font-medium text-slate-900">
                        <span>{p.name}</span>
                      </div>
                      <div className="font-mono text-xs text-slate-500">{p.id}</div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-slate-400">
                        {maskedUrl ? '[GESPERRT – Regel 1]' : p.url || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 align-top font-mono text-xs text-slate-600">
                      {p.kategorien.join(' · ')}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 align-top font-mono text-xs text-slate-700">
                      {p.auth_typ}
                    </td>
                    <td className="px-4 py-2.5 align-top text-xs text-slate-600">
                      <div>{p.verbindungsart || '—'}</div>
                      {p.protokoll && (
                        <div className="font-mono text-[11px] text-slate-400">{p.protokoll}</div>
                      )}
                    </td>
                    <td className="max-w-xs px-4 py-2.5 align-top text-xs leading-relaxed text-slate-600">
                      {p.classificationReason}
                    </td>
                    <td
                      className="whitespace-nowrap px-4 py-2.5 text-right align-top"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {usable ? (
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {(() => {
                            const keyPage = resolveProviderApiKeyPage(p);
                            return keyPage ? (
                              <a
                                href={keyPage.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`${keyPage.label} von ${p.name} öffnen (${keyPage.url})`}
                                aria-label={`API-Key-Seite von ${p.name} öffnen`}
                                className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100"
                              >
                                <KeyRound className="h-3 w-3 shrink-0" aria-hidden="true" />
                                API-Key
                                <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-70" aria-hidden="true" />
                              </a>
                            ) : null;
                          })()}
                          <button
                            type="button"
                            onClick={() => onUseConnection(p)}
                            aria-label={`${p.name} nutzen`}
                            className="inline-flex items-center gap-1 rounded bg-teal-700 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-teal-800"
                          >
                            <Zap className="h-3 w-3" aria-hidden="true" />
                            Nutzen
                          </button>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-mono text-xs text-slate-400">
                          <Lock className="h-3 w-3" aria-hidden="true" />
                          Gesperrt
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    Keine Provider entsprechen den aktiven Such- oder Filterkriterien.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-Over Detail Drawer */}
      {selectedProvider && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-slate-900/30"
          role="dialog"
          aria-modal="true"
          aria-label={`Details zu ${selectedProvider.name}`}
          onClick={() => setSelectedProvider(null)}
        >
          <div
            className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-slate-200 bg-white p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <SecurityClassTag secClass={selectedProvider.securityClass} />
                  {selectedProvider.isUnfiltered && <UnfilteredTag />}
                  <span className="font-mono text-xs text-slate-500">
                    Zeile {selectedProvider.sourceLineNumber} · {selectedProvider.id}
                  </span>
                </div>
                <h3 className="mt-1.5 text-lg font-semibold text-slate-900">
                  {selectedProvider.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProvider(null)}
                aria-label="Detailansicht schließen"
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-sm">
              {isUsableGreenOrGelb(selectedProvider) && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const target = selectedProvider;
                      setSelectedProvider(null);
                      onUseConnection(target);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md bg-teal-700 px-3 py-2 text-xs font-medium text-white hover:bg-teal-800"
                  >
                    <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                    Verbindung nutzen / API & Router
                  </button>
                  <button
                    type="button"
                    onClick={() => onRunSingleTest(selectedProvider.id)}
                    disabled={testingSingleId === selectedProvider.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <FlaskConical className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                    {testingSingleId === selectedProvider.id
                      ? 'Prüfe…'
                      : '4-Phasen-Einzeltest starten'}
                  </button>
                  {(() => {
                    const keyPage = resolveProviderApiKeyPage(selectedProvider);
                    return keyPage ? (
                      <a
                        href={keyPage.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={keyPage.url}
                        className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100"
                      >
                        <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                        API-Key holen
                        <ExternalLink className="h-3 w-3 opacity-75" aria-hidden="true" />
                      </a>
                    ) : null;
                  })()}
                </div>
              )}

              <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5">
                <p className="font-mono text-xs font-semibold uppercase text-slate-500">
                  Klassifikationsbegründung (ZIEL 1)
                </p>
                <p className="mt-1 text-slate-800">{selectedProvider.classificationReason}</p>
                {selectedProvider.rule7Collision && (
                  <p className="mt-2 font-mono text-xs text-amber-800">
                    {selectedProvider.rule7Collision}
                  </p>
                )}
              </div>

              <dl className="grid grid-cols-1 gap-3 border-b border-slate-200 pb-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium text-slate-500">URL</dt>
                  <dd className="mt-0.5 break-all font-mono text-xs text-slate-800">
                    {selectedProvider.securityClass === 'SCHWARZ' || selectedProvider.isIllegal ? (
                      <span className="text-red-700">
                        [GESPERRT – Regel 1: kein Exploit-Link]
                      </span>
                    ) : selectedProvider.url ? (
                      <a
                        href={selectedProvider.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-teal-700 hover:underline"
                      >
                        {selectedProvider.url}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Auth-Typ & Env-Var</dt>
                  <dd className="mt-0.5 font-mono text-xs text-slate-800">
                    {selectedProvider.auth_typ}
                    {selectedProvider.expectedEnvVar
                      ? ` · ${selectedProvider.expectedEnvVar}`
                      : ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Verbindungsart / Protokoll</dt>
                  <dd className="mt-0.5 text-xs text-slate-800">
                    {selectedProvider.verbindungsart || '—'} · {selectedProvider.protokoll || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Free-Tier / Kommerziell</dt>
                  <dd className="mt-0.5 text-xs text-slate-800">
                    {selectedProvider.free_tier_typ || '—'}
                    {selectedProvider.kommerzielle_nutzung
                      ? ` · Kommerziell: ${selectedProvider.kommerzielle_nutzung}`
                      : ''}
                  </dd>
                </div>
              </dl>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Beschreibung [Belegt aus Quelldatei]
                </h4>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
                  {selectedProvider.beschreibung || '—'}
                </p>
              </div>

              {selectedProvider.einschraenkungen && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Einschränkungen
                  </h4>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
                    {selectedProvider.einschraenkungen}
                  </p>
                </div>
              )}

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Roh-Flags & Risiko-Feld
                </h4>
                <pre className="mt-1 overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs whitespace-pre-wrap text-slate-800">
                  {`flags: ${selectedProvider.flagsRaw || '—'}\nrisiko: ${selectedProvider.risiko || '—'}`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

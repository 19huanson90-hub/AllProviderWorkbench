export type SecurityClass = 'GRUEN' | 'GELB' | 'ROT' | 'SCHWARZ';

export type SecurityClassLabel = 'GRÜN' | 'GELB' | 'ROT' | 'SCHWARZ';

export interface ParsedFlags {
  raw: string;
  riskant: boolean | null;
  riskantDetail: string | null;
  forschung: boolean | null;
  selbstEvaluierend: boolean | null;
  empfehlenswert: 'True' | 'False' | 'unklar' | null;
}

export interface ProviderRecord {
  id: string;
  name: string;
  update_typ: string;
  url: string;
  kategorien: string[];
  verbindungsart: string;
  protokoll: string;
  beschreibung: string;
  einschraenkungen: string;
  flagsRaw: string;
  flags: ParsedFlags;
  risiko: string;
  auth_typ: string;
  free_tier_typ: string;
  kommerzielle_nutzung: string;
  modell_info: string;
  quelle: string;
  entdeckt_am: string;
  isIllegal: boolean;
  isAnonymPseudoKey: boolean;
  isBridgeCategory: boolean;
  isGenericAutomationTool: boolean;
  starsExtracted: number | null;
  lastCommitText: string | null;
  sourceLineNumber: number;
}

export type TestEligibility =
  | 'ANONYMOUS_API_AND_HEAD'
  | 'HEAD_ONLY_GREEN'
  | 'HEAD_ONLY_GELB'
  | 'API_KEY_ENV_CHECK'
  | 'SKIP_LOCALHOST'
  | 'SKIP_ROT_TOS'
  | 'SKIP_SCHWARZ_ILLEGAL'
  | 'SKIP_RULE1_ILLEGAL'
  | 'SKIP_RULE1_ANONYM_PSEUDO_KEY'
  | 'SKIP_NO_URL';

export interface ClassifiedProvider extends ProviderRecord {
  securityClass: SecurityClass;
  securityClassLabel: SecurityClassLabel;
  classificationReason: string;
  riskyBool: boolean;
  empfohlenValue: string;
  testPolicy: TestEligibility;
  expectedEnvVar: string | null;
  rule7Collision: string | null;
}

export type TestRunStatus =
  | 'PENDING'
  | 'OK'
  | 'OK_API_PROBE'
  | 'REDIRECT'
  | 'AUTH_REQUIRED'
  | 'WAF_PROTECTED'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'SKIPPED (ToS-Risiko)'
  | 'SKIPPED (illegal)'
  | 'SKIPPED (Regel 1: anonym_pseudo_key)'
  | 'SKIPPED (kein Key)'
  | 'SKIPPED (lokal/kein Endpunkt)';

export type TestPhaseStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface TestPhaseResult {
  phase: 'dns' | 'reachability' | 'protocol' | 'scoring';
  label: string;
  status: TestPhaseStatus;
  detail: string;
  durationMs?: number;
}

export type ReadinessTier =
  | 'SOFORT_NUTZBAR'
  | 'BEREIT_MIT_KEY'
  | 'EINGESCHRAENKT_WAF'
  | 'LOKAL_ENGINE'
  | 'NICHT_ERREICHBAR'
  | 'UNGETESTET'
  | 'GESPERRT';

export interface TestResultRow {
  id: string;
  name: string;
  kategorie: string;
  securityClass: SecurityClass;
  status: TestRunStatus;
  http_code: string;
  risky: boolean;
  empfohlen: string;
  note: string;
  url: string;
  redirectTarget?: string;
  latencyMs?: number;
  apiProbeSummary?: string;
  testedAt?: string;
  executed: boolean;
  phases?: TestPhaseResult[];
  healthScore?: number;
  readinessTier?: ReadinessTier;
}

export interface TestAnalytics {
  totalTestableGreenGelb: number;
  testedGreenGelb: number;
  readyImmediateCount: number;
  readyWithKeyCount: number;
  wafProtectedCount: number;
  localEnginesCount: number;
  unreachableCount: number;
  blockedRule1OrRotCount: number;
  avgLatencyMs: number | null;
  topRankedGreenIds: string[];
  failureClusters: Array<{
    key: string;
    label: string;
    count: number;
    recommendation: string;
  }>;
}

export interface BridgeCandidateEvaluation {
  id: string;
  name: string;
  url: string;
  targetProviders: string[];
  stars: number | null;
  lastCommitText: string | null;
  activeUnder6Months: boolean | null;
  locallySelfHosted: boolean;
  documentedAuth: boolean;
  dockerCompatibleWin11: boolean;
  riskLevel: 'mittel' | 'hoch' | 'illegal' | 'unklar';
  authWay: string;
  selected: boolean;
  decisionReason: string;
}

export interface BridgeSelectionEntry {
  zielprovider: string;
  bridge_id: string | null;
  bridge_name: string | null;
  bridge_url: string | null;
  begruendung: string;
  restrisiko: string;
  auth_weg: string;
  port: number | null;
  docker_service: string | null;
  docker_capable: boolean;
  stars_belegt: number | null;
  last_commit_belegt: string | null;
  candidatesEvaluated: BridgeCandidateEvaluation[];
}

export interface Rule7CollisionNotice {
  providerId: string;
  providerName: string;
  securityClass: SecurityClass;
  conflict: string;
  resolution: string;
}

export interface SecurityAuditCheck {
  id: string;
  rule: string;
  label: string;
  passed: boolean;
  evidence: string;
}

export interface SuiteFile {
  path: string;
  language:
    | 'json'
    | 'csv'
    | 'yaml'
    | 'powershell'
    | 'markdown'
    | 'python'
    | 'dotenv'
    | 'html'
    | 'javascript';
  description: string;
  content: string;
}

export interface DatasetSummary {
  totalProviders: number;
  sourceName: string;
  parsedAt: string;
  counts: Record<SecurityClass, number>;
  bridgeCandidatesCount: number;
  selectedBridgesCount: number;
  dockerizedBridgesCount: number;
  rule7Collisions: Rule7CollisionNotice[];
  auditChecks: SecurityAuditCheck[];
}

export interface BridgeRepoStatus {
  bridgeId: string;
  zielprovider: string;
  repoUrl: string;
  localPath: string;
  status: 'idle' | 'cloning' | 'cloned' | 'failed';
  cloned: boolean;
  commitHash: string | null;
  commitDate: string | null;
  branch: string | null;
  fileCount: number;
  hasDockerfile: boolean;
  hasDockerCompose: boolean;
  hasLicense: boolean;
  hasReadme: boolean;
  topFiles: string[];
  error: string | null;
  updatedAt: string | null;
}

export type ConnectionKind = 'openai_rest' | 'native_rest' | 'browser_only' | 'mcp_or_sdk';

export interface BridgeRuntimeState {
  bridgeId: string;
  zielprovider: string;
  port: number | null;
  dockerService: string | null;
  status: 'stopped' | 'cloning' | 'starting' | 'running' | 'error';
  mode: 'docker' | 'native' | 'none';
  pid: number | null;
  startedAt: string | null;
  lastProbeOk: boolean | null;
  lastProbeStatus: string | null;
  lastProbeLatencyMs: number | null;
  detectedCommand: string | null;
  error: string | null;
  logs: string[];
}

export interface WorkspacePayload {
  summary: DatasetSummary;
  providers: ClassifiedProvider[];
  testResults: TestResultRow[];
  testAnalytics: TestAnalytics;
  activeRouterProviderIds: string[];
  bridgeSelections: BridgeSelectionEntry[];
  excludedBridgeEntries: BridgeCandidateEvaluation[];
  bridgeRepos: BridgeRepoStatus[];
  bridgeRuntimes: BridgeRuntimeState[];
  cloneBatchRunning: boolean;
  artifacts: SuiteFile[];
  batchState: TestBatchState;
}

export interface TestBatchState {
  running: boolean;
  mode: string | null;
  total: number;
  completed: number;
  startedAt: string | null;
  finishedAt: string | null;
}

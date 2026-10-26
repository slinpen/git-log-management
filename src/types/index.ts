// 提交类型
export type CommitType = 'feature' | 'fix' | 'perf' | 'refactor' | 'docs' | 'test' | 'chore' | 'style' | 'other';

export interface Commit {
  sha: string;
  author: string;
  email: string;
  date: string;
  subject: string;
  body?: string;
}

export interface CommitCandidate {
  sha: string;
  author: string;
  date: string;
  subject: string;
}

export interface Contributor {
  name: string;
  count: number;
  email?: string;
}

export interface FileStat {
  file: string;
  count: number;
}

export interface Stat {
  files: number;
  insertions: number;
  deletions: number;
}

export interface CommitsResponse {
  ok: boolean;
  error?: string;
  branch: string;
  selectedBranch?: string;
  stat: Stat;
  contributors: Contributor[];
  total: number;
  commits: Commit[];
}

export interface Project {
  id: string;
  name: string;
  path: string;
  branch?: string;
  addedAt: number;
  valid?: boolean;
  config?: ProjectConfig;
}

// 项目运行配置
export interface ProjectConfig {
  startCommand: string;
  port: number | null;
  cwd: string;
  autoOpen: boolean;
  env: Record<string, string>;
}

// 项目运行状态
export type RunStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface ProjectRunStatus {
  ok: boolean;
  status: RunStatus;
  pid?: number | null;
  port?: number | null;
  url?: string;
  startedAt?: number;
  error?: string;
  logs?: string[];
}

// 项目配置自动解析结果
export interface DetectedConfig {
  packageManager: string;
  script: { name: string; command: string } | null;
  startCommand: string;
  port: number | null;
  framework: string;
  packageJsonFound: boolean;
  note: string;
}

export interface Branch {
  name: string;
  isCurrent: boolean;
  remote: boolean;
}

export interface ContributorProfile {
  author: string;
  totalCommits: number;
  totalFiles: number;
  insertions: number;
  deletions: number;
  touchedFiles: number;
  typeDist: Record<string, number>;
  hourDist: number[];
  timeline: { date: string; count: number }[];
  topFiles: { file: string; count: number }[];
  commits: { sha: string; date: string; subject: string; type: CommitType }[];
}

export type ReportType = 'daily' | 'weekly' | 'monthly';
export type ReportMode = 'template' | 'ai';

// 已保存的报告（列表项，不含正文）
export interface ReportMeta {
  id: string;
  projectId: string;
  projectName: string;
  repoPath: string;
  branch: string;
  type: ReportType;
  mode: ReportMode;
  source: 'manual' | 'auto';
  commitCount: number;
  date: string;
  createdAt: number;
}

export interface ReportDetail extends ReportMeta {
  content: string;
}

// 提交趋势
export interface TrendPoint {
  date: string;
  count: number;
}

// 异常提交告警
export type AlertSeverity = 'warning' | 'info';
export interface CommitAlert {
  type: 'empty_message' | 'short_message' | 'late_night' | 'large_commit';
  severity: AlertSeverity;
  sha: string;
  author: string;
  date: string;
  subject: string;
  message: string;
}

// 文件改动历史（变更影响分析）
export interface FileHistoryCommit {
  sha: string;
  author: string;
  date: string;
  subject: string;
  insertions: number;
  deletions: number;
}

export interface FileHistoryResponse {
  ok: boolean;
  error?: string;
  commits: FileHistoryCommit[];
}

// 分支/tag 引用
export interface RefItem {
  name: string;
  kind: 'branch' | 'tag';
}

// 版本对比结果
export interface CompareCommit {
  sha: string;
  author: string;
  date: string;
  subject: string;
  type: CommitType;
}

export interface CompareResponse {
  ok: boolean;
  error?: string;
  commits: CompareCommit[];
  stat: Stat;
}

// ---------- 跨项目仪表盘 ----------
export interface DashboardProjectInfo {
  id: string;
  name: string;
  path: string;
  branch: string;
  valid: boolean;
  todayCount: number;
  weekCount: number;
  activeAuthors: number;
  // 与上游的差异；null 表示无上游分支
  ahead: number | null;
  behind: number | null;
  dirty: boolean;
  lastCommit: { date: string; author: string; subject: string } | null;
}

export interface DashboardResponse {
  ok: boolean;
  projects: DashboardProjectInfo[];
}

// ---------- 提交图谱 ----------
export interface GraphCommit {
  sha: string;
  parents: string[];
  shortSha: string;
  author: string;
  date: string;
  subject: string;
}

export interface GraphResponse {
  ok: boolean;
  error?: string;
  commits: GraphCommit[];
}

// ---------- 工作区文件状态 ----------
export interface WorkingFile {
  file: string;
  renamedFrom?: string | null;
  status: string;      // 原始 porcelain 状态码（如 "M ", " M", "??", "R "）
  statusLabel: string; // 中文状态（修改/新增/删除/重命名/未跟踪…）
  untracked: boolean;
  staged: boolean;     // 暂存区有改动
  unstaged: boolean;   // 工作区有改动（含未跟踪）
  insertions: number | null;
  deletions: number | null;
}

export interface WorkingStatusResponse {
  ok: boolean;
  error?: string;
  branch: string;
  ahead: number | null;
  behind: number | null;
  files: WorkingFile[];
}

export interface GitOperationResult {
  ok: boolean;
  error?: string;
  sha?: string;    // commit 成功时的短 sha
  output?: string; // push/pull 的输出
  discarded?: number;
}

export interface FileDiffResponse {
  ok: boolean;
  error?: string;
  diff: string;
}

import type {
  Project, CommitsResponse, Branch, ContributorProfile, CommitCandidate, Commit,
  TrendPoint, CommitAlert, ProjectConfig, ProjectRunStatus, DetectedConfig,
  FileHistoryResponse, RefItem, CompareResponse, DashboardResponse,
  ReportType, ReportMode, ReportMeta, ReportDetail, GraphResponse,
  WorkingStatusResponse, GitOperationResult, FileDiffResponse,
} from '../types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`请求失败: ${res.status}`);
  }
  return res.json();
}

export const api = {
  getProjects: () => request<{ ok: boolean; projects: Project[] }>('/api/projects'),

  getDashboard: () => request<DashboardResponse>('/api/dashboard'),

  addProjectByPicker: () =>
    request<{ ok: boolean; project?: Project; error?: string }>('/api/projects/pick', { method: 'POST' }),

  addProject: (path: string, name?: string) =>
    request<{ ok: boolean; project?: Project; error?: string }>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, name }),
    }),

  removeProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getProjectConfig: (id: string) =>
    request<{ ok: boolean; config: ProjectConfig; error?: string }>(`/api/projects/${encodeURIComponent(id)}/config`),

  saveProjectConfig: (id: string, config: Partial<ProjectConfig>) =>
    request<{ ok: boolean; config: ProjectConfig; error?: string }>(`/api/projects/${encodeURIComponent(id)}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    }),

  detectProjectConfig: (id: string) =>
    request<{ ok: boolean; detected: DetectedConfig; root?: string; error?: string }>(`/api/projects/${encodeURIComponent(id)}/detect`),

  startProject: (id: string) =>
    request<{ ok: boolean; pid?: number; error?: string }>(`/api/projects/${encodeURIComponent(id)}/start`, { method: 'POST' }),

  stopProject: (id: string) =>
    request<{ ok: boolean; error?: string }>(`/api/projects/${encodeURIComponent(id)}/stop`, { method: 'POST' }),

  getProjectStatus: (id: string) =>
    request<ProjectRunStatus>(`/api/projects/${encodeURIComponent(id)}/status`),

  getCommits: (params: { path: string; since?: string; author?: string; file?: string; branch?: string; n?: number; skip?: number }) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    });
    return request<CommitsResponse>(`/api/commits?${qs.toString()}`);
  },

  getBranches: (path: string) => {
    const qs = new URLSearchParams({ path });
    return request<{ ok: boolean; branches: Branch[] }>(`/api/branches?${qs.toString()}`);
  },

  getFiles: (path: string, since?: string, branch?: string) => {
    const qs = new URLSearchParams({ path });
    if (since) qs.set('since', since);
    if (branch) qs.set('branch', branch);
    return request<{ ok: boolean; files: { file: string; count: number }[] }>(`/api/files?${qs.toString()}`);
  },

  getCommitDetail: (path: string, sha: string) => {
    const qs = new URLSearchParams({ path, sha });
    return request<{ ok: boolean; detail?: string; error?: string }>(`/api/commit?${qs.toString()}`);
  },

  getCommitDiff: (path: string, sha: string) => {
    const qs = new URLSearchParams({ path, sha });
    return request<{ ok: boolean; diff?: string; error?: string }>(`/api/commit-diff?${qs.toString()}`);
  },

  getTrend: (path: string, branch?: string, days = 30) => {
    const qs = new URLSearchParams({ path, days: String(days) });
    if (branch) qs.set('branch', branch);
    return request<{ ok: boolean; trend: TrendPoint[] }>(`/api/trend?${qs.toString()}`);
  },

  getAlerts: (path: string, branch?: string, since = '30 days ago', n = 500) => {
    const qs = new URLSearchParams({ path, since, n: String(n) });
    if (branch) qs.set('branch', branch);
    return request<{ ok: boolean; alerts: CommitAlert[] }>(`/api/alerts?${qs.toString()}`);
  },

  getContributorProfile: (path: string, author: string, branch?: string, since?: string) => {
    const qs = new URLSearchParams({ path, author });
    if (branch) qs.set('branch', branch);
    if (since) qs.set('since', since);
    return request<{ ok: boolean; profile: ContributorProfile; error?: string }>(
      `/api/contributor?${qs.toString()}`
    );
  },

  search: (path: string, q: string, branch?: string, n = 40) => {
    const qs = new URLSearchParams({ path, q, n: String(n) });
    if (branch) qs.set('branch', branch);
    return request<{ ok: boolean; candidates: CommitCandidate[]; error?: string }>(
      `/api/search?${qs.toString()}`
    );
  },

  getFileHistory: (path: string, file: string, branch?: string, n = 100) => {
    const qs = new URLSearchParams({ path, file, n: String(n) });
    if (branch) qs.set('branch', branch);
    return request<FileHistoryResponse>(`/api/file-history?${qs.toString()}`);
  },

  getRefs: (path: string) => {
    const qs = new URLSearchParams({ path });
    return request<{ ok: boolean; branches: RefItem[]; tags: RefItem[] }>(`/api/refs?${qs.toString()}`);
  },

  compare: (path: string, from: string, to: string, n = 300) => {
    const qs = new URLSearchParams({ path, from, to, n: String(n) });
    return request<CompareResponse>(`/api/compare?${qs.toString()}`);
  },

  // ---------- 报告历史 ----------
  getReports: (projectId?: string) => {
    const qs = projectId ? new URLSearchParams({ projectId }) : new URLSearchParams();
    return request<{ ok: boolean; reports: ReportMeta[] }>(`/api/reports?${qs.toString()}`);
  },

  saveReport: (report: {
    projectId: string;
    type: ReportType;
    mode: ReportMode;
    branch: string;
    commitCount: number;
    content: string;
  }) =>
    request<{ ok: boolean; report?: ReportMeta; error?: string }>('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    }),

  getReportDetail: (id: string) =>
    request<{ ok: boolean; report?: ReportDetail; error?: string }>(`/api/reports/${encodeURIComponent(id)}`),

  deleteReport: (id: string) =>
    request<{ ok: boolean; error?: string }>(`/api/reports/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ---------- 提交图谱 ----------
  getGraph: (path: string, branch?: string, n = 100) => {
    const qs = new URLSearchParams({ path, n: String(n) });
    if (branch) qs.set('branch', branch);
    return request<GraphResponse>(`/api/graph?${qs.toString()}`);
  },

  // ---------- 工作区文件状态与 Git 操作 ----------
  getStatus: (path: string) =>
    request<WorkingStatusResponse>(`/api/status?path=${encodeURIComponent(path)}`),

  getFileDiff: (path: string, file: string, staged = false) =>
    request<FileDiffResponse>(`/api/filediff?path=${encodeURIComponent(path)}&file=${encodeURIComponent(file)}&staged=${staged}`),

  stageFiles: (path: string, files: string[]) =>
    request<GitOperationResult>('/api/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, files }),
    }),

  unstageFiles: (path: string, files: string[]) =>
    request<GitOperationResult>('/api/unstage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, files }),
    }),

  discardChanges: (path: string, files: string[]) =>
    request<GitOperationResult>('/api/discard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, files }),
    }),

  commit: (path: string, message: string) =>
    request<GitOperationResult>('/api/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, message }),
    }),

  push: (path: string) =>
    request<GitOperationResult>('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }),

  pull: (path: string) =>
    request<GitOperationResult>('/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }),
};

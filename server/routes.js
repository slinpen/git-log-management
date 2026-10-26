import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import {
  runGit, isGitRepo, getBranch, getBranches, getCommits,
  getCommitsOverview, getDiffStat, getContributorProfile,
  getCommitDiff, getCommitTrend, getCommitAlerts, getCommitCount,
  getFileHistory, getRefs, getCompare, getProjectSummary, isDirty, getCommitGraph,
  getWorkingChanges, stageFiles, unstageFiles, discardFileChanges,
  commitStaged, pushRepo, pullRepo, getFileDiff,
} from './git.js';
import { loadProjects, saveProjects } from './store.js';
import { runProjectAction, getAllProcesses } from './proc.js';
import { detectProjectConfig } from './parse.js';
import { cachedGit } from './cache.js';
import { saveReport, listReports, getReport, deleteReport } from './reports.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// ---------- 打开本地目录选择器（macOS） ----------
function openDirectoryPicker() {
  return new Promise((resolve) => {
    const script = `
      set theFolder to POSIX path of (choose folder with prompt "选择要添加的 Git 项目目录")
      return theFolder
    `;
    execFile('osascript', ['-e', script], { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: (stderr || err.message || '未选择目录').trim() });
      } else {
        resolve({ ok: true, path: stdout.trim() });
      }
    });
  });
}

// 校验仓库路径
async function requireRepo(res, repoPath) {
  if (!repoPath || !await isGitRepo(repoPath)) {
    res.status(400).json({ ok: false, error: '无效的仓库路径' });
    return false;
  }
  return true;
}

// ---------- 项目 CRUD ----------
router.get('/projects', async (req, res) => {
  const projects = loadProjects();
  for (const p of projects) {
    if (fs.existsSync(p.path) && await isGitRepo(p.path)) {
      p.branch = await getBranch(p.path);
      p.valid = true;
    } else {
      p.valid = false;
    }
  }
  res.json({ ok: true, projects });
});

router.post('/projects/pick', async (req, res) => {
  const picked = await openDirectoryPicker();
  if (!picked.ok) return res.json({ ok: false, error: picked.error });
  const dir = picked.path;
  if (!await isGitRepo(dir)) {
    return res.json({ ok: false, error: '所选目录不是 Git 仓库（未找到 .git）' });
  }
  const projects = loadProjects();
  if (projects.some(p => p.path === dir)) {
    return res.json({ ok: false, error: '该项目已存在' });
  }
  const branch = await getBranch(dir);
  const name = path.basename(dir) || dir;
  projects.push({ id: Date.now().toString(36), name, path: dir, branch, addedAt: Date.now() });
  saveProjects(projects);
  res.json({ ok: true, project: projects[projects.length - 1] });
});

router.post('/projects', async (req, res) => {
  const data = req.body || {};
  const dir = (data.path || '').trim();
  if (!dir) return res.status(400).json({ ok: false, error: '路径不能为空' });
  if (!fs.existsSync(dir)) return res.status(400).json({ ok: false, error: '路径不存在' });
  if (!await isGitRepo(dir)) return res.status(400).json({ ok: false, error: '不是有效的 Git 仓库' });
  const projects = loadProjects();
  if (projects.some(p => p.path === dir)) {
    return res.status(400).json({ ok: false, error: '该项目已存在' });
  }
  const branch = await getBranch(dir);
  const name = data.name || path.basename(dir) || dir;
  const project = { id: Date.now().toString(36), name, path: dir, branch, addedAt: Date.now() };
  projects.push(project);
  saveProjects(projects);
  res.json({ ok: true, project });
});

router.delete('/projects/:id', (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const projects = loadProjects().filter(p => p.id !== id);
  saveProjects(projects);
  res.json({ ok: true });
});

// ---------- 项目运行配置 ----------
router.get('/projects/:id/config', (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const project = loadProjects().find(p => p.id === id);
  if (!project) return res.status(404).json({ ok: false, error: '项目不存在' });
  res.json({ ok: true, config: project.config || {} });
});

// 自动解析项目配置（package.json / vite.config / .env 等）
router.get('/projects/:id/detect', (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const project = loadProjects().find(p => p.id === id);
  if (!project) return res.status(404).json({ ok: false, error: '项目不存在' });
  const root = project.config?.cwd
    ? path.join(project.path, project.config.cwd)
    : project.path;
  const detected = detectProjectConfig(root);
  res.json({ ok: true, detected, root });
});

router.post('/projects/:id/config', (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const config = req.body || {};
  const projects = loadProjects();
  const project = projects.find(p => p.id === id);
  if (!project) return res.status(404).json({ ok: false, error: '项目不存在' });
  project.config = {
    startCommand: (config.startCommand || '').trim(),
    port: config.port ? parseInt(config.port, 10) : null,
    cwd: (config.cwd || '').trim(),
    autoOpen: !!config.autoOpen,
    env: config.env || {},
  };
  saveProjects(projects);
  res.json({ ok: true, config: project.config });
});

// ---------- 项目启停 ----------
router.post('/projects/:id/start', async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const project = loadProjects().find(p => p.id === id);
  if (!project) return res.status(404).json({ ok: false, error: '项目不存在' });
  // cwd 解析：config.cwd 为空 → 项目根目录；否则拼接项目根目录 + 相对 cwd
  const baseCwd = project.config?.cwd
    ? path.join(project.path, project.config.cwd)
    : project.path;
  const result = await runProjectAction(id, 'start', { ...project.config, cwd: baseCwd });
  res.json(result);
});

router.post('/projects/:id/stop', async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const result = await runProjectAction(id, 'stop', null);
  res.json(result);
});

router.get('/projects/:id/status', async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const project = loadProjects().find(p => p.id === id);
  const result = await runProjectAction(id, 'status', project?.config);
  res.json(result);
});

// ---------- 提交图谱（sha + parents 拓扑数据） ----------
router.get('/graph', async (req, res) => {
  const { path: repoPath, branch = '', n = '100' } = req.query;
  if (!await requireRepo(res, repoPath)) return;
  const r = await cachedGit(repoPath, branch, `graph:${n}`, () =>
    getCommitGraph(repoPath, branch, parseInt(n, 10)));
  res.json(r);
});

// ---------- 工作区文件状态与 Git 写操作（轻量 Git 客户端） ----------
// status 实时返回（工作区状态与 ref 无关，不走缓存）；写操作会改变 ref，缓存随 sha 自动失效。
router.get('/status', async (req, res) => {
  const { path: repoPath } = req.query;
  if (!await requireRepo(res, repoPath)) return;
  res.json(await getWorkingChanges(repoPath));
});

router.get('/filediff', async (req, res) => {
  const { path: repoPath, file, staged = 'false' } = req.query;
  if (!await requireRepo(res, repoPath)) return;
  if (!file) return res.status(400).json({ ok: false, error: '缺少文件参数' });
  res.json(await getFileDiff(repoPath, String(file), staged === 'true'));
});

router.post('/stage', async (req, res) => {
  const { path: repoPath, files } = req.body || {};
  if (!await requireRepo(res, repoPath)) return;
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ ok: false, error: '缺少文件列表' });
  }
  res.json(await stageFiles(repoPath, files));
});

router.post('/unstage', async (req, res) => {
  const { path: repoPath, files } = req.body || {};
  if (!await requireRepo(res, repoPath)) return;
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ ok: false, error: '缺少文件列表' });
  }
  res.json(await unstageFiles(repoPath, files));
});

router.post('/discard', async (req, res) => {
  const { path: repoPath, files } = req.body || {};
  if (!await requireRepo(res, repoPath)) return;
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ ok: false, error: '缺少文件列表' });
  }
  res.json(await discardFileChanges(repoPath, files));
});

router.post('/commit', async (req, res) => {
  const { path: repoPath, message } = req.body || {};
  if (!await requireRepo(res, repoPath)) return;
  const msg = (message || '').trim();
  if (!msg) return res.status(400).json({ ok: false, error: '提交信息不能为空' });
  res.json(await commitStaged(repoPath, msg));
});

router.post('/push', async (req, res) => {
  const { path: repoPath } = req.body || {};
  if (!await requireRepo(res, repoPath)) return;
  res.json(await pushRepo(repoPath));
});

router.post('/pull', async (req, res) => {
  const { path: repoPath } = req.body || {};
  if (!await requireRepo(res, repoPath)) return;
  res.json(await pullRepo(repoPath));
});

// ---------- 跨项目仪表盘 ----------
// 每个项目返回：当前分支、今日/近7天提交、活跃人数、与上游 ahead/behind、最近提交、dirty 状态。
// 概要部分走 cachedGit（ref 变化或 TTL 失效）；dirty 单独探测（工作区改动不改变 ref）。
router.get('/dashboard', async (req, res) => {
  const projects = loadProjects();
  const list = await Promise.all(projects.map(async (p) => {
    const base = { id: p.id, name: p.name, path: p.path, branch: '', valid: false };
    if (!fs.existsSync(p.path) || !await isGitRepo(p.path)) return base;
    const [summary, dirty] = await Promise.all([
      cachedGit(p.path, '', 'summary', () => getProjectSummary(p.path)),
      isDirty(p.path),
    ]);
    return { ...base, ...summary, dirty, valid: true };
  }));
  res.json({ ok: true, projects: list });
});

// ---------- 提交查询 ----------
router.get('/commits', async (req, res) => {
  const { path: repoPath, since = '', author = '', file = '', branch = '', n = '200', skip = '0' } = req.query;
  if (!await requireRepo(res, repoPath)) return;
  const limit = parseInt(n, 10);
  const offset = parseInt(skip, 10);

  // 缓存键覆盖全部查询参数；ref 指向变化或 TTL 到期自动失效。
  // stat/contributors 由 getCommitsOverview 单次 git log 同时算出，
  // 进程数从原先的 5 个降到 3 个（page log + overview log + rev-list count）。
  const result = await cachedGit(repoPath, branch, `commits:${since}|${author}|${file}|${limit}|${offset}`, async () => {
    const [commits, branchName, overview, total] = await Promise.all([
      getCommits(repoPath, { since, author, file, n: limit, branch, skip: offset }),
      getBranch(repoPath),
      getCommitsOverview(repoPath, since, branch),
      getCommitCount(repoPath, { since, author, file, branch }),
    ]);
    if (!commits.ok) return { ok: false, error: commits.error };
    return {
      ok: true,
      branch: branchName,
      selectedBranch: branch || branchName,
      stat: overview.stat,
      contributors: overview.contributors,
      total,
      commits: commits.commits,
    };
  });
  res.json(result);
});

router.get('/branches', async (req, res) => {
  const { path: repoPath } = req.query;
  if (!await requireRepo(res, repoPath)) return;
  const branches = await getBranches(repoPath);
  res.json({ ok: true, branches });
});

// ---------- 单个提交详情 ----------
router.get('/commit', async (req, res) => {
  const { path: repoPath, sha } = req.query;
  if (!repoPath || !sha) return res.status(400).json({ ok: false, error: '参数缺失' });
  const r = await runGit(repoPath, ['show', sha, '--stat', '--date=format:%Y-%m-%d %H:%M']);
  if (!r.ok) return res.json({ ok: false, error: r.error });
  res.json({ ok: true, detail: r.stdout });
});

// ---------- 单提交 diff 预览 ----------
router.get('/commit-diff', async (req, res) => {
  const { path: repoPath, sha } = req.query;
  if (!repoPath || !sha) return res.status(400).json({ ok: false, error: '参数缺失' });
  const r = await getCommitDiff(repoPath, sha);
  if (!r.ok) return res.json({ ok: false, error: r.error });
  res.json({ ok: true, diff: r.diff });
});

// ---------- 提交趋势 ----------
router.get('/trend', async (req, res) => {
  const { path: repoPath, branch = '', days = '30' } = req.query;
  if (!await requireRepo(res, repoPath)) return;
  const trend = await cachedGit(repoPath, branch, `trend:${days}`, () =>
    getCommitTrend(repoPath, branch, parseInt(days, 10)));
  res.json({ ok: true, trend });
});

// ---------- 异常提交告警 ----------
router.get('/alerts', async (req, res) => {
  const { path: repoPath, branch = '', since = '30 days ago', n = '500' } = req.query;
  if (!await requireRepo(res, repoPath)) return;
  const alerts = await cachedGit(repoPath, branch, `alerts:${since}|${n}`, () =>
    getCommitAlerts(repoPath, branch, since, parseInt(n, 10)));
  res.json({ ok: true, alerts });
});

// ---------- 热门文件 ----------
router.get('/files', async (req, res) => {
  const { path: repoPath, since = '', branch = '' } = req.query;
  if (!await requireRepo(res, repoPath)) return;
  const files = await cachedGit(repoPath, branch, `files:${since}`, () =>
    getDiffStat(repoPath, since, branch));
  res.json({ ok: true, files });
});

// ---------- 贡献者画像 ----------
router.get('/contributor', async (req, res) => {
  const { path: repoPath, author = '', branch = '', since = '' } = req.query;
  if (!repoPath || !author) return res.status(400).json({ ok: false, error: '参数缺失' });
  if (!await requireRepo(res, repoPath)) return;
  const profile = await cachedGit(repoPath, branch, `contributor:${author}|${since}`, () =>
    getContributorProfile(repoPath, author, branch, since));
  res.json({ ok: true, profile });
});

// ---------- 文件改动历史（变更影响分析） ----------
router.get('/file-history', async (req, res) => {
  const { path: repoPath, file = '', branch = '', n = '100' } = req.query;
  if (!repoPath || !file) return res.status(400).json({ ok: false, error: '参数缺失' });
  if (!await requireRepo(res, repoPath)) return;
  const r = await cachedGit(repoPath, branch, `file-history:${file}|${n}`, () =>
    getFileHistory(repoPath, file, branch, parseInt(n, 10)));
  res.json(r);
});

// ---------- 分支/tag 列表（用于版本对比） ----------
router.get('/refs', async (req, res) => {
  const { path: repoPath } = req.query;
  if (!await requireRepo(res, repoPath)) return;
  const refs = await cachedGit(repoPath, '', 'refs', () => getRefs(repoPath));
  res.json({ ok: true, ...refs });
});

// ---------- 版本对比（两个 ref 之间的提交差异 + changelog） ----------
router.get('/compare', async (req, res) => {
  const { path: repoPath, from = '', to = '', n = '300' } = req.query;
  if (!repoPath || !from || !to) return res.status(400).json({ ok: false, error: '参数缺失' });
  if (!await requireRepo(res, repoPath)) return;
  const r = await cachedGit(repoPath, to, `compare:${from}|${to}|${n}`, () =>
    getCompare(repoPath, from, to, parseInt(n, 10)));
  res.json(r);
});

// ---------- 语义搜索（--grep 粗筛候选，AI 精排在前端完成） ----------
router.get('/search', async (req, res) => {
  const { path: repoPath, q = '', branch = '', n = '40' } = req.query;
  if (!repoPath || !q) return res.status(400).json({ ok: false, error: '参数缺失' });
  if (!await requireRepo(res, repoPath)) return;

  const parseCandidate = (stdout) => {
    const candidates = [];
    for (const line of stdout.split('\n').filter(Boolean)) {
      const parts = line.split('\x1f');
      if (parts.length < 4) continue;
      candidates.push({
        sha: parts[0].replace(/^\x1e/, ''),
        author: parts[1],
        date: parts[2],
        subject: parts[3],
      });
    }
    return candidates;
  };

  // 把自然语言拆成关键词，用多个 --grep（OR）提高召回；
  // 若关键词太少或粗筛结果为空，则回退返回近期提交作为候选，交给 AI 精排。
  const keywords = String(q)
    .split(/[\s,，。;；:：、!！?？]+/)
    .map(s => s.trim())
    .filter(s => s.length >= 2);

  const baseArgs = ['log', '--date=format:%Y-%m-%d %H:%M',
    '--pretty=format:%x1e%h%x1f%an%x1f%ad%x1f%s', '-i'];

  let candidates = [];
  if (keywords.length > 0) {
    const grepArgs = [...baseArgs];
    for (const kw of keywords) grepArgs.push('--grep=' + kw);
    grepArgs.push('-n', String(parseInt(n, 10)));
    if (branch) grepArgs.push(branch);
    const r = await runGit(repoPath, grepArgs);
    if (r.ok) candidates = parseCandidate(r.stdout);
  }

  // 粗筛无结果（自然语言整句通常匹配不到）→ 回退近期提交，让 AI 做语义匹配
  if (candidates.length === 0) {
    const fallbackArgs = ['log', '--date=format:%Y-%m-%d %H:%M',
      '--pretty=format:%x1e%h%x1f%an%x1f%ad%x1f%s', '-n', String(parseInt(n, 10))];
    if (branch) fallbackArgs.push(branch);
    const r = await runGit(repoPath, fallbackArgs);
    if (r.ok) candidates = parseCandidate(r.stdout);
  }

  res.json({ ok: true, candidates });
});

// ---------- 报告历史 ----------
// 列表（可选按项目过滤，不含正文）
router.get('/reports', (req, res) => {
  const { projectId = '' } = req.query;
  res.json({ ok: true, reports: listReports(projectId || undefined) });
});

// 保存报告（手动生成后由前端调用；定时任务在服务端直接调 saveReport）
router.post('/reports', (req, res) => {
  const { projectId = '', type = '', mode = '', branch = '', commitCount = 0, content = '' } = req.body || {};
  if (!projectId || !type || !content) {
    return res.status(400).json({ ok: false, error: '参数缺失' });
  }
  const project = loadProjects().find((p) => p.id === projectId);
  if (!project) return res.status(404).json({ ok: false, error: '项目不存在' });
  const report = saveReport({
    projectId,
    projectName: project.name,
    repoPath: project.path,
    branch,
    type,
    mode: mode || 'template',
    commitCount,
    content,
    source: 'manual',
  });
  res.json({ ok: true, report: { ...report, content: undefined } });
});

// 报告详情（含正文）
router.get('/reports/:id', (req, res) => {
  const report = getReport(decodeURIComponent(req.params.id));
  if (!report) return res.status(404).json({ ok: false, error: '报告不存在' });
  res.json({ ok: true, report });
});

// 删除报告
router.delete('/reports/:id', (req, res) => {
  const ok = deleteReport(decodeURIComponent(req.params.id));
  if (!ok) return res.status(404).json({ ok: false, error: '报告不存在' });
  res.json({ ok: true });
});

export default router;

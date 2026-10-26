import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { classify } from './git.js';

// ---------- 报告持久化 ----------
// 每份报告存为 data/reports/<id>.json，重启自动加载。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPORTS_DIR = path.join(__dirname, '..', 'data', 'reports');

const TYPE_LABELS = {
  feature: '新特性',
  fix: '修复',
  perf: '优化',
  refactor: '重构',
  docs: '文档',
  test: '测试',
  chore: '构建',
  style: '样式',
  other: '其他',
};

function ensureDir() {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function reportFile(id) {
  // id 仅允许字母数字，防止路径注入
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  return path.join(REPORTS_DIR, `${id}.json`);
}

function todayStr() {
  const d = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function saveReport({ projectId, projectName, repoPath, branch, type, mode, commitCount, content, source = 'manual' }) {
  ensureDir();
  const report = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    projectId,
    projectName,
    repoPath,
    branch: branch || '',
    type, // daily | weekly | monthly
    mode, // template | ai
    source, // manual | auto
    commitCount: commitCount || 0,
    content,
    date: todayStr(),
    createdAt: Date.now(),
  };
  fs.writeFileSync(path.join(REPORTS_DIR, `${report.id}.json`), JSON.stringify(report, null, 2), 'utf-8');
  return report;
}

// 列表（不含正文，倒序）
export function listReports(projectId) {
  ensureDir();
  const out = [];
  for (const f of fs.readdirSync(REPORTS_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const r = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), 'utf-8'));
      if (projectId && r.projectId !== projectId) continue;
      const { content, ...meta } = r;
      out.push(meta);
    } catch (e) {
      // 单个损坏文件不影响整体
    }
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

export function getReport(id) {
  const file = reportFile(id);
  if (!file || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return null;
  }
}

export function deleteReport(id) {
  const file = reportFile(id);
  if (!file || !fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

// 今天该项目是否已有指定类型的报告（避免定时任务重复生成）
export function hasReportToday(projectId, type) {
  const today = todayStr();
  return listReports(projectId).some((r) => r.type === type && r.date === today);
}

// ---------- 服务端日报模板渲染 ----------
// 结构与前端 src/api/report.ts 的 renderTemplateReport(daily) 保持一致；
// 定时任务在服务端生成，无法复用前端模块，修改模板时请同步两处。

function fmtDate(d) {
  return d.toLocaleDateString('zh-CN');
}

export function renderDailyTemplate(commits, branch) {
  const now = new Date();
  const dateStr = fmtDate(now);

  const groups = {};
  for (const c of commits) {
    const t = classify(c.subject);
    (groups[t] = groups[t] || []).push(c);
  }
  const contributors = [...new Set(commits.map((c) => c.author))];

  const feat = groups.feature || [];
  const fix = groups.fix || [];
  const perf = groups.perf || [];
  const refactor = groups.refactor || [];
  const others = [
    ...(groups.docs || []), ...(groups.test || []),
    ...(groups.chore || []), ...(groups.style || []),
    ...(groups.other || []),
  ];

  let md = `# 研发日报（${dateStr}）\n\n`;
  md += `## 一、今日概览\n- 提交数：${commits.length}\n- 参与人：${contributors.join('、') || '无'}\n- 分支：${branch || '—'}\n\n`;
  md += `## 二、完成事项\n`;
  const items = [...feat, ...perf, ...refactor, ...others]
    .map((c) => `- [${TYPE_LABELS[classify(c.subject)]}] ${c.subject}（\`${(c.sha || '').slice(0, 7)}\`）`);
  md += items.length ? items.join('\n') + '\n\n' : '- 无\n\n';
  md += `## 三、问题与修复\n`;
  md += fix.length ? fix.map((c) => `- [修复] ${c.subject}（\`${(c.sha || '').slice(0, 7)}\`）`).join('\n') + '\n\n' : '- 无\n\n';
  md += `## 四、明日计划\n- 待补充\n`;
  return md;
}

// ---------- macOS 系统通知 ----------
export function notify(title, message) {
  if (process.platform !== 'darwin') return;
  const script = `display notification "${String(message).replace(/"/g, '\\"')}" with title "${String(title).replace(/"/g, '\\"')}"`;
  execFile('osascript', ['-e', script], () => {
    // 通知失败不影响主流程
  });
}

import { loadProjects } from './store.js';
import { isGitRepo, getCommits, getBranch } from './git.js';
import { saveReport, hasReportToday, renderDailyTemplate, notify } from './reports.js';

// ---------- 定时日报生成器 ----------
// 每分钟检查一次：到了设定时刻（默认 18:30）且该项目今天还没有日报，
// 就自动生成模板日报并持久化，同时发 macOS 系统通知。
// 服务重启后下一分钟的 tick 会补上当天错过的生成（只要还没过午夜）。
//
// 配置（环境变量）：
//   GLM_REPORT_HOUR   生成时刻-小时，默认 18
//   GLM_REPORT_MINUTE 生成时刻-分钟，默认 30
//   GLM_SCHEDULER=0   关闭定时生成

const CHECK_INTERVAL = 60 * 1000;

function scheduleConfig() {
  return {
    hour: parseInt(process.env.GLM_REPORT_HOUR || '18', 10),
    minute: parseInt(process.env.GLM_REPORT_MINUTE || '30', 10),
    enabled: process.env.GLM_SCHEDULER !== '0',
  };
}

function isDueNow(cfg) {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const dueMin = cfg.hour * 60 + cfg.minute;
  // 当天到达/超过设定时刻即触发（幂等由 hasReportToday 保证）
  return nowMin >= dueMin;
}

async function generateDailyForProject(project) {
  // 今天 00:00 起的提交
  const now = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  const midnight = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} 00:00`;

  const [commits, branch] = await Promise.all([
    getCommits(project.path, { since: midnight, n: 1000 }),
    getBranch(project.path),
  ]);
  if (!commits.ok) return { ok: false, error: commits.error };

  const content = renderDailyTemplate(commits.commits, branch);
  const report = saveReport({
    projectId: project.id,
    projectName: project.name,
    repoPath: project.path,
    branch,
    type: 'daily',
    mode: 'template',
    commitCount: commits.commits.length,
    content,
    source: 'auto',
  });
  return { ok: true, report };
}

export function startScheduler() {
  const cfg = scheduleConfig();
  if (!cfg.enabled) {
    console.log('  ⏰ 定时日报生成已关闭（GLM_SCHEDULER=0）');
    return;
  }

  const tick = async () => {
    if (!isDueNow(cfg)) return;
    const projects = loadProjects();
    for (const p of projects) {
      try {
        if (!await isGitRepo(p.path)) continue;
        // 已有今天的日报（手动保存或自动生成过）则跳过
        if (hasReportToday(p.id, 'daily')) continue;
        const r = await generateDailyForProject(p);
        if (r.ok && r.report.commitCount > 0) {
          notify('Git 日志管理', `「${p.name}」今日日报已生成（${r.report.commitCount} 个提交）`);
          console.log(`  ⏰ 已自动生成日报：${p.name}（${r.report.commitCount} 个提交）`);
        } else if (r.ok) {
          // 无提交也保存一份空日报，避免每分钟重试；但不发通知打扰
          console.log(`  ⏰ ${p.name} 今日无提交，已生成空日报`);
        } else {
          console.warn(`  ⏰ ${p.name} 日报生成失败：${r.error}`);
        }
      } catch (e) {
        console.warn(`  ⏰ ${p.name} 日报生成异常：`, e.message || e);
      }
    }
  };

  // 启动后延迟 10 秒再开始 tick，避免与启动期的项目加载竞争
  setTimeout(() => {
    tick();
    setInterval(tick, CHECK_INTERVAL);
  }, 10 * 1000);

  console.log(`  ⏰ 定时日报生成已开启：每天 ${String(cfg.hour).padStart(2, '0')}:${String(cfg.minute).padStart(2, '0')}`);
}

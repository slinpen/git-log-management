import { execFile } from 'child_process';

// ---------- git 命令封装 ----------
// opts 透传给 execFile（如 push/pull 的 timeout）
export function runGit(repoPath, args, opts = {}) {
  return new Promise((resolve) => {
    execFile('git', ['-C', repoPath, ...args], { maxBuffer: 50 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        const timedOut = err.killed || err.signal === 'SIGTERM';
        // stdout 仍返回：部分命令（如 diff --no-index）以非零退出码表示"有差异"，输出有效
        resolve({ ok: false, error: timedOut ? '命令超时，请检查网络或远程仓库' : (stderr || err.message || '').trim(), stdout: stdout || '' });
      } else {
        resolve({ ok: true, stdout: stdout || '', stderr: (stderr || '').trim() });
      }
    });
  });
}

export function isGitRepo(repoPath) {
  return new Promise((resolve) => {
    execFile('git', ['-C', repoPath, 'rev-parse', '--is-inside-work-tree'], (err, stdout) => {
      resolve(!err && stdout.trim() === 'true');
    });
  });
}

export async function getBranch(repoPath) {
  const r = await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.ok ? r.stdout.trim() : '';
}

export async function getBranches(repoPath) {
  const [listR, curR] = await Promise.all([
    runGit(repoPath, ['branch', '-a', '--format=%(refname:short)']),
    runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
  ]);
  if (!listR.ok) return [];
  const currentBranch = curR.ok ? curR.stdout.trim() : '';
  const branches = [];
  const seen = new Set();
  for (const name of listR.stdout.split('\n').map(s => s.trim()).filter(Boolean)) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (name.endsWith('/HEAD')) continue;
    branches.push({
      name,
      isCurrent: name === currentBranch,
      remote: name.includes('/'),
    });
  }
  branches.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return branches;
}

export async function getCommits(repoPath, opts = {}) {
  const { since = '', author = '', n = 500, file = '', branch = '', skip = 0 } = opts;
  const args = ['log', '--date=format:%Y-%m-%d %H:%M', '--pretty=format:%x1e%h%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%b'];
  if (since) args.push(`--since=${since}`);
  if (author) args.push(`--author=${author}`);
  if (skip) args.push(`--skip=${skip}`);
  if (n) args.push(`-n`, String(n));
  if (branch) args.push(branch);
  if (file) args.push('--', file);

  const r = await runGit(repoPath, args);
  if (!r.ok) return { ok: false, error: r.error };
  const lines = r.stdout.split('\n').filter(Boolean);
  const commits = [];
  for (const line of lines) {
    const parts = line.split('\x1f');
    if (parts.length < 5) continue;
    commits.push({
      sha: parts[0].replace(/^\x1e/, ''),
      author: parts[1],
      email: parts[2],
      date: parts[3],
      subject: parts[4],
      body: parts.slice(5).join('\x1f'),
    });
  }
  return { ok: true, commits };
}

// 统计符合条件的提交总数（用于分页）
// rev-list --count 在 git 内部完成计数，远快于格式化整条 log 输出再数行数
export async function getCommitCount(repoPath, opts = {}) {
  const { since = '', author = '', file = '', branch = '' } = opts;
  const args = ['rev-list', '--count'];
  if (since) args.push(`--since=${since}`);
  if (author) args.push(`--author=${author}`);
  args.push(branch || 'HEAD');
  if (file) args.push('--', file);
  const r = await runGit(repoPath, args);
  if (!r.ok) return 0;
  return parseInt(r.stdout.trim(), 10) || 0;
}

// 一次遍历同时得到：代码量统计（stat）+ 贡献者排名（contributors）
// 替代原先 getCommitStat / getContributors 两次独立的 git log 调用。
// 输出格式：每条提交为 "\x1e<an>\x1f<ae>" 一行 + shortstat 一行 + 空行
export async function getCommitsOverview(repoPath, since, branch = '') {
  const args = ['log', '--pretty=format:%x1e%an%x1f%ae', '--shortstat'];
  if (since) args.push(`--since=${since}`);
  if (branch) args.push(branch);
  const r = await runGit(repoPath, args);
  const stat = { files: 0, insertions: 0, deletions: 0 };
  const map = new Map(); // 身份 key -> { email, names: Map<name, count>, count }
  if (!r.ok) return { stat, contributors: [] };
  const statRe = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('\x1e')) {
      // 作者身份合并：以邮箱（大小写归一）为身份 key，同人换名/多邮箱改名不影响统计；
      // 邮箱缺失时退化为按名字聚合。展示名取该身份下出现次数最多的名字，
      // 次数平局时取最近一次提交使用的名字（日志倒序遍历，先记录的是最新的）。
      const [name, email] = line.slice(1).split('\x1f');
      const key = (email || name || '').toLowerCase();
      if (!key) continue;
      let entry = map.get(key);
      if (!entry) {
        entry = { email: email || '', names: new Map(), count: 0 };
        map.set(key, entry);
      }
      entry.count += 1;
      if (name) entry.names.set(name, (entry.names.get(name) || 0) + 1);
    } else {
      const m = line.match(statRe);
      if (m) {
        stat.files += parseInt(m[1] || '0', 10);
        stat.insertions += parseInt(m[2] || '0', 10);
        stat.deletions += parseInt(m[3] || '0', 10);
      }
    }
  }
  const contributors = Array.from(map.entries())
    .map(([, entry]) => {
      let name = '';
      let best = 0;
      for (const [n, c] of entry.names) {
        if (c > best) { best = c; name = n; }
      }
      return { name, count: entry.count, email: entry.email };
    })
    .sort((a, b) => b.count - a.count);
  return { stat, contributors };
}

// ---------- 项目概要（跨项目仪表盘用） ----------
// 返回当前分支、今日/近7天提交数、近7天活跃人数、与上游的 ahead/behind、最近一次提交。
// 工作区 dirty 状态不在此处（不随 ref 变化，由调用方单独探测）。
export async function getProjectSummary(repoPath) {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  const midnight = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} 00:00`;

  const [branchR, weekR, todayR, abR, lastR] = await Promise.all([
    runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(repoPath, ['log', '--since=7 days ago', '--pretty=format:%ae']),
    runGit(repoPath, ['rev-list', '--count', `--since=${midnight}`, 'HEAD']),
    runGit(repoPath, ['rev-list', '--left-right', '--count', '@{u}...HEAD']),
    runGit(repoPath, ['log', '-1', '--date=format:%Y-%m-%d %H:%M', '--pretty=format:%x1e%ad%x1f%an%x1f%s']),
  ]);

  // 近 7 天：提交数 + 活跃贡献者数（按邮箱去重）
  let weekCount = 0;
  const authors = new Set();
  if (weekR.ok) {
    for (const line of weekR.stdout.split('\n').filter(Boolean)) {
      const e = line.trim().toLowerCase();
      if (e) { weekCount += 1; authors.add(e); }
    }
  }

  // ahead/behind：输出 "behind\tahead"（left=上游独有，right=本地独有）；无上游时为 null
  let ahead = null, behind = null;
  if (abR.ok) {
    const m = abR.stdout.trim().match(/^(\d+)\s+(\d+)$/);
    if (m) { behind = parseInt(m[1], 10); ahead = parseInt(m[2], 10); }
  }

  let lastCommit = null;
  if (lastR.ok) {
    const parts = lastR.stdout.trim().split('\x1f');
    if (parts.length >= 3) {
      lastCommit = { date: parts[0].replace(/^\x1e/, ''), author: parts[1], subject: parts[2] };
    }
  }

  return {
    branch: branchR.ok ? branchR.stdout.trim() : '',
    todayCount: todayR.ok ? (parseInt(todayR.stdout.trim(), 10) || 0) : 0,
    weekCount,
    activeAuthors: authors.size,
    ahead,
    behind,
    lastCommit,
  };
}

// 工作区是否有未提交改动（轻量探测，不进缓存）
export async function isDirty(repoPath) {
  const r = await runGit(repoPath, ['status', '--porcelain']);
  return r.ok && r.stdout.trim().length > 0;
}

export async function getDiffStat(repoPath, since, branch = '') {
  const args = ['log', '--pretty=format:', '--name-only'];
  if (since) args.push(`--since=${since}`);
  if (branch) args.push(branch);
  const r = await runGit(repoPath, args);
  const fileCount = new Map();
  if (r.ok) {
    for (const line of r.stdout.split('\n')) {
      const f = line.trim();
      if (f && !f.startsWith('(')) {
        fileCount.set(f, (fileCount.get(f) || 0) + 1);
      }
    }
  }
  return Array.from(fileCount.entries())
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

export async function getContributorProfile(repoPath, author, branch = '', since = '') {
  const commitArgs = ['log', '--date=format:%Y-%m-%d %H:%M', `--author=${author}`,
    '--pretty=format:%x1e%h%x1f%ad%x1f%s'];
  if (since) commitArgs.push(`--since=${since}`);
  if (branch) commitArgs.push(branch);
  const commitR = await runGit(repoPath, commitArgs);

  const statArgs = ['log', '--shortstat', '--pretty=format:__SEP__', `--author=${author}`];
  if (since) statArgs.push(`--since=${since}`);
  if (branch) statArgs.push(branch);
  const statR = await runGit(repoPath, statArgs);

  const fileArgs = ['log', '--pretty=format:', '--name-only', `--author=${author}`];
  if (since) fileArgs.push(`--since=${since}`);
  if (branch) fileArgs.push(branch);
  const fileR = await runGit(repoPath, fileArgs);

  const commits = [];
  if (commitR.ok) {
    for (const line of commitR.stdout.split('\n').filter(Boolean)) {
      const parts = line.split('\x1f');
      if (parts.length < 3) continue;
      commits.push({
        sha: parts[0].replace(/^\x1e/, ''),
        date: parts[1],
        subject: parts[2],
        type: classify(parts[2]),
      });
    }
  }

  const statList = [];
  if (statR.ok) {
    const blocks = statR.stdout.split('__SEP__');
    const re = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/;
    for (const b of blocks) {
      const m = b.match(re);
      if (m) {
        statList.push({
          files: parseInt(m[1] || '0', 10),
          insertions: parseInt(m[2] || '0', 10),
          deletions: parseInt(m[3] || '0', 10),
        });
      } else {
        statList.push({ files: 0, insertions: 0, deletions: 0 });
      }
    }
  }

  const fileMap = new Map();
  const touchedSet = new Set();
  if (fileR.ok) {
    const blocks = fileR.stdout.split(/\n\n+/);
    for (const b of blocks) {
      for (const f of b.split('\n').map(s => s.trim()).filter(Boolean)) {
        if (f.startsWith('(')) continue;
        touchedSet.add(f);
        fileMap.set(f, (fileMap.get(f) || 0) + 1);
      }
    }
  }

  let totalFiles = 0, totalInsertions = 0, totalDeletions = 0;
  for (const s of statList) {
    totalFiles += s.files;
    totalInsertions += s.insertions;
    totalDeletions += s.deletions;
  }

  const typeDist = {};
  for (const c of commits) {
    typeDist[c.type] = (typeDist[c.type] || 0) + 1;
  }

  const hourDist = new Array(24).fill(0);
  for (const c of commits) {
    const h = new Date(c.date.replace(' ', 'T')).getHours();
    if (!isNaN(h)) hourDist[h]++;
  }

  const dayMap = new Map();
  for (const c of commits) {
    const d = c.date.slice(0, 10);
    dayMap.set(d, (dayMap.get(d) || 0) + 1);
  }
  const timeline = Array.from(dayMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const topFiles = Array.from(fileMap.entries())
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    author,
    totalCommits: commits.length,
    totalFiles,
    insertions: totalInsertions,
    deletions: totalDeletions,
    touchedFiles: touchedSet.size,
    typeDist,
    hourDist,
    timeline,
    topFiles,
    commits: commits.slice(0, 50),
  };
}

// ---------- 单提交 diff ----------
export async function getCommitDiff(repoPath, sha) {
  const r = await runGit(repoPath, ['show', sha, '--format=fuller', '--no-color', '-p']);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, diff: r.stdout };
}

// ---------- 提交趋势（按天聚合提交数与代码量） ----------
export async function getCommitTrend(repoPath, branch = '', days = 30) {
  const args = ['log', '--date=format:%Y-%m-%d', '--pretty=format:%ad', '--since=' + days + ' days ago'];
  if (branch) args.push(branch);
  const r = await runGit(repoPath, args);
  const countMap = new Map();
  if (r.ok) {
    for (const line of r.stdout.split('\n').filter(Boolean)) {
      const d = line.trim();
      countMap.set(d, (countMap.get(d) || 0) + 1);
    }
  }
  // 生成完整的日期序列（含无提交的天）
  const daysList = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    daysList.push({ date: key, count: countMap.get(key) || 0 });
  }
  return daysList;
}

// ---------- 异常提交告警 ----------
export async function getCommitAlerts(repoPath, branch = '', since = '30 days ago', n = 500) {
  const args = ['log', '--date=format:%Y-%m-%d %H:%M',
    '--pretty=format:%x1e%h%x1f%an%x1f%ad%x1f%s%x1f%b'];
  if (since) args.push(`--since=${since}`);
  if (n) args.push(`-n`, String(n));
  if (branch) args.push(branch);
  const r = await runGit(repoPath, args);
  if (!r.ok) return [];

  const commits = [];
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const parts = line.split('\x1f');
    if (parts.length < 5) continue;
    const subject = parts[3];
    const body = parts.slice(4).join('\x1f');
    commits.push({
      sha: parts[0].replace(/^\x1e/, ''),
      author: parts[1],
      date: parts[2],
      subject,
      body,
    });
  }

  const alerts = [];
  for (const c of commits) {
    // 1. 空提交信息
    if (!c.subject || c.subject.trim() === '') {
      alerts.push({ type: 'empty_message', severity: 'warning', sha: c.sha, author: c.author, date: c.date, subject: c.subject, message: '提交信息为空' });
      continue;
    }
    // 2. 提交信息过短（少于 3 个字符）
    if (c.subject.trim().length < 3) {
      alerts.push({ type: 'short_message', severity: 'info', sha: c.sha, author: c.author, date: c.date, subject: c.subject, message: '提交信息过短' });
    }
    // 3. 深夜提交（0-5 点）
    const hour = new Date(c.date.replace(' ', 'T')).getHours();
    if (!isNaN(hour) && hour >= 0 && hour < 6) {
      alerts.push({ type: 'late_night', severity: 'info', sha: c.sha, author: c.author, date: c.date, subject: c.subject, message: `深夜提交（${String(hour).padStart(2, '0')}:00）` });
    }
  }

  // 4. 大提交（改动文件数/行数超阈值）—— 用 shortstat 逐提交统计
  const statArgs = ['log', '--shortstat', '--pretty=format:__SEP__%x1e%h'];
  if (since) statArgs.push(`--since=${since}`);
  if (n) statArgs.push(`-n`, String(n));
  if (branch) statArgs.push(branch);
  const statR = await runGit(repoPath, statArgs);
  if (statR.ok) {
    const blocks = statR.stdout.split('__SEP__');
    const re = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/;
    for (const b of blocks) {
      const shaMatch = b.match(/\x1e([0-9a-f]+)/);
      const statMatch = b.match(re);
      if (!shaMatch || !statMatch) continue;
      const sha = shaMatch[1];
      const files = parseInt(statMatch[1] || '0', 10);
      const insertions = parseInt(statMatch[2] || '0', 10);
      const deletions = parseInt(statMatch[3] || '0', 10);
      if (files >= 30 || insertions + deletions >= 500) {
        const c = commits.find(x => x.sha === sha);
        alerts.push({
          type: 'large_commit', severity: 'warning', sha, author: c ? c.author : '', date: c ? c.date : '',
          subject: c ? c.subject : '', message: `大提交（${files} 文件，+${insertions}/-${deletions} 行）`,
        });
      }
    }
  }

  return alerts;
}

// ---------- 文件改动历史（变更影响分析） ----------
// 用 --follow 追踪文件重命名，返回该文件的完整改动轨迹
export async function getFileHistory(repoPath, file, branch = '', n = 100) {
  const args = ['log', '--follow', '--date=format:%Y-%m-%d %H:%M',
    '--pretty=format:%x1e%h%x1f%an%x1f%ad%x1f%s', '--stat'];
  if (branch) args.push(branch);
  if (n) args.push('-n', String(n));
  args.push('--', file);

  const r = await runGit(repoPath, args);
  if (!r.ok) return { ok: false, error: r.error };

  const commits = [];
  // 每条记录格式：\x1e<sha>\x1f<author>\x1f<date>\x1f<subject>\n\n<stat 行...>
  const blocks = r.stdout.split('\n\n');
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    const header = lines[0];
    const parts = header.split('\x1f');
    if (parts.length < 4) continue;
    const sha = parts[0].replace(/^\x1e/, '');
    const author = parts[1];
    const date = parts[2];
    const subject = parts[3];

    // 解析 stat 行（可能有多行，也可能跨块）
    let insertions = 0, deletions = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // 匹配 " 3 files changed, 10 insertions(+), 2 deletions(-)" 或 " 1 file changed, 5 insertions(+), 3 deletions(-)"
      const m = line.match(/(\d+) insertions?\(\+\)/);
      if (m) insertions = parseInt(m[1], 10);
      const d = line.match(/(\d+) deletions?\(-\)/);
      if (d) deletions = parseInt(d[1], 10);
    }

    commits.push({ sha, author, date, subject, insertions, deletions });
  }

  return { ok: true, commits };
}

// ---------- 获取分支 + tag 列表（用于版本对比） ----------
export async function getRefs(repoPath) {
  const [branchR, tagR] = await Promise.all([
    runGit(repoPath, ['branch', '-a', '--format=%(refname:short)']),
    runGit(repoPath, ['tag', '--sort=-creatordate']),
  ]);

  const branches = [];
  if (branchR.ok) {
    const seen = new Set();
    for (const name of branchR.stdout.split('\n').map(s => s.trim()).filter(Boolean)) {
      if (seen.has(name) || name.endsWith('/HEAD')) continue;
      seen.add(name);
      branches.push({ name, kind: 'branch' });
    }
  }

  const tags = [];
  if (tagR.ok) {
    for (const name of tagR.stdout.split('\n').map(s => s.trim()).filter(Boolean)) {
      tags.push({ name, kind: 'tag' });
    }
  }

  return { branches, tags };
}

// ---------- 版本对比：两个 ref 之间的提交差异 + changelog ----------
export async function getCompare(repoPath, from, to, n = 300) {
  // from..to：列出 to 有而 from 没有的提交（即本次"发布"新增的改动）
  const args = ['log', '--date=format:%Y-%m-%d %H:%M',
    '--pretty=format:%x1e%h%x1f%an%x1f%ad%x1f%s', `${from}..${to}`];
  if (n) args.push('-n', String(n));
  const r = await runGit(repoPath, args);
  if (!r.ok) return { ok: false, error: r.error };

  const commits = [];
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const parts = line.split('\x1f');
    if (parts.length < 4) continue;
    commits.push({
      sha: parts[0].replace(/^\x1e/, ''),
      author: parts[1],
      date: parts[2],
      subject: parts[3],
      type: classify(parts[3]),
    });
  }

  // 统计本次改动的代码量
  const statR = await runGit(repoPath, ['diff', '--shortstat', `${from}...${to}`]);
  let stat = { files: 0, insertions: 0, deletions: 0 };
  if (statR.ok) {
    const m = statR.stdout.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
    if (m) {
      stat.files = parseInt(m[1] || '0', 10);
      stat.insertions = parseInt(m[2] || '0', 10);
      stat.deletions = parseInt(m[3] || '0', 10);
    }
  }

  return { ok: true, commits, stat };
}

// ---------- 提交图谱（sha + 父提交列表，用于前端泳道图布局） ----------
// %P 输出父提交完整 sha（merge 提交有多个，空格分隔），前端据 parent→child 关系画连线
export async function getCommitGraph(repoPath, branch = '', n = 100) {
  const args = ['log', '--date=format:%Y-%m-%d %H:%M',
    '--pretty=format:%x1e%H%x1f%P%x1f%h%x1f%an%x1f%ad%x1f%s'];
  if (n) args.push('-n', String(n));
  if (branch) args.push(branch);
  const r = await runGit(repoPath, args);
  if (!r.ok) return { ok: false, error: r.error };
  const commits = [];
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const parts = line.split('\x1f');
    if (parts.length < 5) continue;
    commits.push({
      sha: parts[0].replace(/^\x1e/, ''),
      parents: parts[1] ? parts[1].split(' ').filter(Boolean) : [],
      shortSha: parts[2],
      author: parts[3],
      date: parts[4],
      subject: parts.slice(5).join('\x1f'),
    });
  }
  return { ok: true, commits };
}

// ---------- 提交分类 ----------
export function classify(subject) {
  const s = subject.toLowerCase();
  if (/^feat/.test(s) || /新特性|新增|添加/.test(subject)) return 'feature';
  if (/^fix/.test(s) || /修复|bug|缺陷|fix/.test(s)) return 'fix';
  if (/^perf/.test(s) || /性能|优化|提速|加速/.test(subject)) return 'perf';
  if (/^refactor/.test(s) || /重构/.test(subject)) return 'refactor';
  if (/^docs/.test(s) || /文档|说明/.test(subject)) return 'docs';
  if (/^test/.test(s) || /测试/.test(subject)) return 'test';
  if (/^chore/.test(s) || /构建|依赖|配置|升级|ci|release|版本|发布/.test(subject)) return 'chore';
  if (/^style/.test(s) || /样式|格式化|空格|缩进/.test(subject)) return 'style';
  return 'other';
}

// ---------- 工作区文件状态（轻量 Git 客户端） ----------
// 解析 git status --porcelain=v1 -z：条目以 NUL 分隔，格式 "XY <path>"，
// rename/copy 时路径为 <new>，原路径是紧随其后的独立条目。
// X = 暂存区状态，Y = 工作区状态；"??" 表示未跟踪。
const STATUS_LABELS = { M: '修改', A: '新增', D: '删除', R: '重命名', C: '复制', U: '冲突', '?': '未跟踪' };

export async function getWorkingChanges(repoPath) {
  const [statusR, numstatR, stagedNumstatR, branchR, abR] = await Promise.all([
    runGit(repoPath, ['status', '--porcelain=v1', '-z']),
    runGit(repoPath, ['diff', '--numstat']),
    runGit(repoPath, ['diff', '--cached', '--numstat']),
    runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(repoPath, ['rev-list', '--left-right', '--count', '@{u}...HEAD']),
  ]);
  if (!statusR.ok) return { ok: false, error: statusR.error };

  // 文件 → 行数统计（工作区 diff 与暂存区 diff 各一份，暂存统计覆盖同 key）
  const statOf = new Map();
  for (const src of [numstatR.stdout, stagedNumstatR.stdout]) {
    for (const line of src.split('\n').filter(Boolean)) {
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (m) statOf.set(m[3], { insertions: m[1] === '-' ? null : +m[1], deletions: m[2] === '-' ? null : +m[2] });
    }
  }

  const files = [];
  const entries = statusR.stdout.split('\0').filter(Boolean);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    let file = entry.slice(3);
    let renamedFrom = null;
    if (xy[0] === 'R' || xy[0] === 'C') {
      // rename/copy：当前条目是新路径，下一条目是原路径
      renamedFrom = entries[i + 1] || null;
      i++;
    }
    const untracked = xy === '??';
    const staged = !untracked && xy[0] !== ' ';
    const unstaged = untracked || xy[1] !== ' ';
    const labelCode = untracked ? '?' : (xy[0] !== ' ' ? xy[0] : xy[1]);
    files.push({
      file,
      renamedFrom,
      status: xy,
      statusLabel: STATUS_LABELS[labelCode] || labelCode,
      untracked,
      staged,
      unstaged,
      ...(statOf.get(file) || { insertions: null, deletions: null }),
    });
  }
  files.sort((a, b) => a.file.localeCompare(b.file));

  let ahead = null, behind = null;
  if (abR.ok) {
    const m = abR.stdout.trim().match(/^(\d+)\s+(\d+)$/);
    if (m) { behind = parseInt(m[1], 10); ahead = parseInt(m[2], 10); }
  }

  return {
    ok: true,
    branch: branchR.ok ? branchR.stdout.trim() : '',
    ahead,
    behind,
    files,
  };
}

// 暂存：git add（对修改/新增/未跟踪文件均有效）
export async function stageFiles(repoPath, files) {
  const r = await runGit(repoPath, ['add', '--', ...files]);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

// 取消暂存：restore --staged（git < 2.23 回退 reset HEAD）
export async function unstageFiles(repoPath, files) {
  let r = await runGit(repoPath, ['restore', '--staged', '--', ...files]);
  if (!r.ok) r = await runGit(repoPath, ['reset', 'HEAD', '--', ...files]);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

// 撤销工作区改动：跟踪文件 checkout 恢复到暂存区版本，未跟踪文件 clean 删除。
// 只清工作区（Y 状态），已暂存的改动保留在暂存区。
export async function discardFileChanges(repoPath, files) {
  const s = await runGit(repoPath, ['status', '--porcelain=v1', '-z', '--', ...files]);
  if (!s.ok) return { ok: false, error: s.error };
  const untracked = [];
  const tracked = [];
  const entries = s.stdout.split('\0').filter(Boolean);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    if (xy[0] === 'R' || xy[0] === 'C') i++; // 跳过旧路径条目
    (xy === '??' ? untracked : tracked).push(entry.slice(3));
  }
  if (untracked.length) {
    const r = await runGit(repoPath, ['clean', '-f', '--', ...untracked]);
    if (!r.ok) return { ok: false, error: r.error };
  }
  if (tracked.length) {
    const r = await runGit(repoPath, ['checkout', '--', ...tracked]);
    if (!r.ok) return { ok: false, error: r.error };
  }
  return { ok: true, discarded: tracked.length + untracked.length };
}

// 提交暂存区
export async function commitStaged(repoPath, message) {
  const r = await runGit(repoPath, ['commit', '-m', message]);
  if (!r.ok) return { ok: false, error: r.error };
  const shaR = await runGit(repoPath, ['rev-parse', '--short', 'HEAD']);
  return { ok: true, sha: shaR.ok ? shaR.stdout.trim() : '' };
}

// 推送（进度输出在 stderr；超时 120s）
export async function pushRepo(repoPath) {
  const r = await runGit(repoPath, ['push'], { timeout: 120000 });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, output: (r.stderr || r.stdout || '推送完成').trim() };
}

// 拉取（--no-edit 避免弹出 merge 信息编辑器；超时 120s）
export async function pullRepo(repoPath) {
  const r = await runGit(repoPath, ['pull', '--no-edit'], { timeout: 120000 });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, output: [r.stdout, r.stderr].filter(Boolean).join('\n').trim() || '拉取完成' };
}

// 单文件 diff：staged 为 true 查暂存区 diff；未跟踪新文件用 --no-index 展示全文
export async function getFileDiff(repoPath, file, staged = false) {
  const args = staged ? ['diff', '--cached', '--no-color', '--', file] : ['diff', '--no-color', '--', file];
  const r = await runGit(repoPath, args);
  if (!r.ok) return { ok: false, error: r.error };
  if (r.stdout.trim()) return { ok: true, diff: r.stdout };
  const untrackedR = await runGit(repoPath, ['diff', '--no-index', '--no-color', '--', '/dev/null', file]);
  if (untrackedR.stdout.trim()) return { ok: true, diff: untrackedR.stdout };
  return { ok: true, diff: '' };
}

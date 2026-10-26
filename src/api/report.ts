import type { Commit, ReportType } from '../types';
import { classify, TYPE_LABELS } from '../utils';
import { streamChat } from '../api/cloud';

export const REPORT_TYPE_INFO: Record<ReportType, { label: string; since: string; intro: string }> = {
  daily: { label: '日报', since: '1 days ago', intro: '今天' },
  weekly: { label: '周报', since: '7 days ago', intro: '最近一周' },
  monthly: { label: '月度版本特性总结', since: '30 days ago', intro: '最近一个月' },
};

// 按类型分组
function groupCommits(commits: Commit[]) {
  const groups: Record<string, Commit[]> = {};
  for (const c of commits) {
    const t = classify(c.subject);
    if (!groups[t]) groups[t] = [];
    groups[t].push(c);
  }
  return groups;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('zh-CN');
}

// ---------- 固定模板渲染 ----------
export function renderTemplateReport(commits: Commit[], type: ReportType, branch: string): string {
  const now = new Date();
  const dateStr = fmtDate(now);
  const groups = groupCommits(commits);
  const contributors = [...new Set(commits.map(c => c.author))];

  const feat = groups.feature || [];
  const fix = groups.fix || [];
  const perf = groups.perf || [];
  const refactor = groups.refactor || [];
  const others = [
    ...(groups.docs || []),
    ...(groups.test || []),
    ...(groups.chore || []),
    ...(groups.style || []),
    ...(groups.other || []),
  ];

  if (type === 'daily') {
    let md = `# 研发日报（${dateStr}）\n\n`;
    md += `## 一、今日概览\n- 提交数：${commits.length}\n- 参与人：${contributors.join('、') || '无'}\n- 分支：${branch}\n\n`;
    md += `## 二、完成事项\n`;
    const items = [...feat, ...perf, ...refactor, ...others].map(c => `- [${TYPE_LABELS[classify(c.subject)]}] ${c.subject}（\`${c.sha.slice(0, 7)}\`）`);
    md += items.length ? items.join('\n') + '\n\n' : '- 无\n\n';
    md += `## 三、问题与修复\n`;
    md += fix.length ? fix.map(c => `- [修复] ${c.subject}（\`${c.sha.slice(0, 7)}\`）`).join('\n') + '\n\n' : '- 无\n\n';
    md += `## 四、明日计划\n- 待补充\n`;
    return md;
  }

  if (type === 'weekly') {
    const start = new Date(now.getTime() - 6 * 86400000);
    const range = `${fmtDate(start)} ~ ${dateStr}`;
    let md = `# 研发周报（${range}）\n\n`;
    md += `## 一、本周概览\n- 提交数：${commits.length}｜参与人：${contributors.join('、') || '无'}\n\n`;
    md += `## 二、本周进展\n### 新特性\n${feat.length ? feat.map(c => `- ${c.subject}（\`${c.sha.slice(0, 7)}\`）`).join('\n') : '- 无'}\n\n`;
    md += `### 优化改进\n${[...perf, ...refactor].length ? [...perf, ...refactor].map(c => `- ${c.subject}（\`${c.sha.slice(0, 7)}\`）`).join('\n') : '- 无'}\n\n`;
    md += `### 缺陷修复\n${fix.length ? fix.map(c => `- ${c.subject}（\`${c.sha.slice(0, 7)}\`）`).join('\n') : '- 无'}\n\n`;
    md += `## 三、风险与问题\n- 无\n\n## 四、下周计划\n- 待补充\n`;
    return md;
  }

  // monthly
  let md = `# ${now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })} 版本特性总结\n\n`;
  md += `## 一、版本概览\n- 分支：${branch}\n- 提交总数：${commits.length}｜贡献者：${contributors.join('、') || '无'}\n\n`;
  md += `## 二、新特性（Features）\n${feat.length ? feat.map(c => `- **${c.subject}**（\`${c.sha.slice(0, 7)}\`）`).join('\n') : '- 无'}\n\n`;
  md += `## 三、优化（Improvements）\n${[...perf, ...refactor].length ? [...perf, ...refactor].map(c => `- **${c.subject}**（\`${c.sha.slice(0, 7)}\`）`).join('\n') : '- 无'}\n\n`;
  md += `## 四、缺陷修复（Bug Fixes）\n${fix.length ? fix.map(c => `- **${c.subject}**（\`${c.sha.slice(0, 7)}\`）`).join('\n') : '- 无'}\n\n`;
  md += `## 五、其他\n${others.length ? others.map(c => `- ${c.subject}（\`${c.sha.slice(0, 7)}\`）`).join('\n') : '- 无'}\n`;
  return md;
}

// ---------- AI 总结 ----------
export async function generateReportAI(
  commits: Commit[],
  type: ReportType,
  projectName: string,
  branch: string,
  onChunk: (text: string) => void
): Promise<string> {
  const info = REPORT_TYPE_INFO[type];
  const commitsText = commits.map(c =>
    `- ${c.date} | ${c.author} | ${c.sha.slice(0, 7)} | ${c.subject}`
  ).join('\n');
  const contributors = [...new Set(commits.map(c => c.author))];

  const systemPrompt = '你是一名资深研发管理专家，擅长把零散的 Git 提交记录归纳成结构清晰、重点突出、语言专业的研发报告。你只依据提供的提交数据撰写，不虚构不存在的功能或内容，不编造提交信息里没有的细节。';

  const structure = type === 'daily'
    ? `   - # 研发日报（日期）\n   - ## 一、今日概览（一句话概括今天做了什么）\n   - ## 二、完成事项（按主题归纳，分点）\n   - ## 三、问题与修复（如有）\n   - ## 四、明日计划（根据已完成工作合理推测下一步，用「建议」语气）\n`
    : type === 'weekly'
      ? `   - # 研发周报（时间段）\n   - ## 一、本周概览\n   - ## 二、本周进展（分「新特性」「优化改进」「缺陷修复」等小标题）\n   - ## 三、风险与问题（根据提交合理判断）\n   - ## 四、下周计划（合理推测）\n`
      : `   - # 月度版本特性总结\n   - ## 一、版本概览\n   - ## 二、新特性\n   - ## 三、优化改进\n   - ## 四、缺陷修复\n   - ## 五、其他\n`;

  const userPrompt =
    `请根据以下 Git 提交记录，帮我生成一份${info.label}（覆盖${info.intro}）。\n\n` +
    `【项目信息】\n- 项目名：${projectName}\n- 分支：${branch || '—'}\n- 提交数：${commits.length}\n- 参与人：${contributors.join('、')}\n\n` +
    `【提交记录】\n${commitsText}\n\n` +
    `【要求】\n` +
    `1. 提交信息可能零散、不完整，请归纳提炼出真正的工作主题，合并相近的提交，按逻辑分块总结，而不是逐条罗列。\n` +
    `2. 用 Markdown 输出，结构如下：\n${structure}` +
    `3. 每一条总结后面用反引号标注关联的提交短哈希（如 \`abc1234\`），便于溯源。\n` +
    `4. 语言专业简洁，突出业务价值，避免流水账。\n` +
    `5. 只输出报告正文，不要额外的解释或客套话。`;

  let full = '';
  for await (const chunk of streamChat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])) {
    full += chunk;
    onChunk(full);
  }
  return full;
}

import type { CommitType } from './types';

export const TYPE_LABELS: Record<CommitType, string> = {
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

export const TYPE_COLORS: Record<CommitType, string> = {
  feature: '#52c41a',
  fix: '#ff4d4f',
  perf: '#1677ff',
  refactor: '#fa8c16',
  docs: '#8c8c8c',
  test: '#13c2c2',
  chore: '#8c8c8c',
  style: '#eb2f96',
  other: '#8c8c8c',
};

export function classify(subject: string): CommitType {
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

export function sinceParam(range: string): string {
  const map: Record<string, string> = {
    '1': '1 days ago',
    '3': '3 days ago',
    '7': '7 days ago',
    '30': '30 days ago',
    all: '',
  };
  return map[range] ?? '';
}

export async function copyToClipboard(text: string, successMsg: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 降级方案
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  void successMsg;
}

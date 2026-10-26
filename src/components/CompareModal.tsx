import { useEffect, useState } from 'react';
import { Modal, Select, List, Tag, Typography, Space, Empty, Spin, Button, message, Divider } from 'antd';
import { SwapOutlined, CopyOutlined, FileTextOutlined } from '@ant-design/icons';
import type { RefItem, CompareCommit } from '../types';
import { api } from '../api';
import { classify, TYPE_LABELS, TYPE_COLORS, copyToClipboard } from '../utils';

interface Props {
  projectPath: string;
  onClose: () => void;
}

// 按类型分组生成 changelog 文本
function buildChangelog(commits: CompareCommit[]): string {
  const groups: Record<string, string[]> = {};
  for (const c of commits) {
    const t = c.type;
    if (!groups[t]) groups[t] = [];
    groups[t].push(`- ${c.subject} (${c.sha.slice(0, 7)} by ${c.author})`);
  }
  const labelMap: Record<string, string> = {
    feature: '✨ 新特性', fix: '🐛 修复', perf: '⚡ 性能优化', refactor: '♻️ 重构',
    docs: '📝 文档', test: '✅ 测试', chore: '🔧 构建/配置', style: '💄 样式', other: '📦 其他',
  };
  const order = ['feature', 'fix', 'perf', 'refactor', 'docs', 'test', 'chore', 'style', 'other'];
  const sections = order.filter((t) => groups[t]?.length).map((t) => `### ${labelMap[t]}\n${groups[t].join('\n')}`);
  return sections.join('\n\n');
}

export default function CompareModal({ projectPath, onClose }: Props) {
  const [refs, setRefs] = useState<{ branches: RefItem[]; tags: RefItem[] }>({ branches: [], tags: [] });
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [result, setResult] = useState<CompareCommit[] | null>(null);
  const [stat, setStat] = useState<{ files: number; insertions: number; deletions: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingRefs(true);
      try {
        const d = await api.getRefs(projectPath);
        if (!alive) return;
        if (d.ok) setRefs({ branches: d.branches, tags: d.tags });
      } catch (e) {
        // 忽略
      } finally {
        if (alive) setLoadingRefs(false);
      }
    })();
    return () => { alive = false; };
  }, [projectPath]);

  // 构建下拉选项：分支 + tag 分组
  const options = [
    { label: '分支', options: refs.branches.map((b) => ({ label: b.name, value: b.name })) },
    { label: '标签', options: refs.tags.map((t) => ({ label: `🏷 ${t.name}`, value: t.name })) },
  ];

  const handleCompare = async () => {
    if (!from || !to) {
      message.warning('请选择起始和结束的版本');
      return;
    }
    if (from === to) {
      message.warning('两个版本不能相同');
      return;
    }
    setComparing(true);
    setError('');
    try {
      const d = await api.compare(projectPath, from, to);
      if (d.ok) {
        setResult(d.commits);
        setStat(d.stat);
      } else {
        setError(d.error || '对比失败');
        setResult(null);
        setStat(null);
      }
    } catch (e) {
      setError('对比失败');
      setResult(null);
      setStat(null);
    } finally {
      setComparing(false);
    }
  };

  const handleCopyChangelog = () => {
    if (!result || result.length === 0) return;
    const text = buildChangelog(result);
    copyToClipboard(text, '已复制 changelog');
    message.success('已复制 changelog');
  };

  return (
    <Modal
      open
      title={
        <Space>
          <SwapOutlined style={{ color: '#1677ff' }} />
          <span>版本对比</span>
        </Space>
      }
      onCancel={onClose}
      footer={null}
      width={760}
    >
      {/* 选择器 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span>从</span>
        <Select
          style={{ flex: 1 }}
          placeholder="起始版本（分支/tag）"
          value={from || undefined}
          onChange={setFrom}
          loading={loadingRefs}
          options={options}
          showSearch
          optionFilterProp="label"
        />
        <SwapOutlined style={{ color: '#8c8c8c' }} />
        <span>到</span>
        <Select
          style={{ flex: 1 }}
          placeholder="目标版本（分支/tag）"
          value={to || undefined}
          onChange={setTo}
          loading={loadingRefs}
          options={options}
          showSearch
          optionFilterProp="label"
        />
        <Button type="primary" loading={comparing} onClick={handleCompare}>对比</Button>
      </div>

      {error && <Empty description={error} />}

      {result && (
        <>
          {/* 统计 */}
          {stat && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              <div className="stat-card" style={{ flex: 1, minWidth: 100 }}>
                <div className="label">提交数</div>
                <div className="value">{result.length}</div>
              </div>
              <div className="stat-card" style={{ flex: 1, minWidth: 100 }}>
                <div className="label">改动文件</div>
                <div className="value">{stat.files}</div>
              </div>
              <div className="stat-card" style={{ flex: 1, minWidth: 100 }}>
                <div className="label" style={{ color: '#52c41a' }}>新增行</div>
                <div className="value" style={{ color: '#52c41a' }}>+{stat.insertions}</div>
              </div>
              <div className="stat-card" style={{ flex: 1, minWidth: 100 }}>
                <div className="label" style={{ color: '#ff4d4f' }}>删除行</div>
                <div className="value" style={{ color: '#ff4d4f' }}>-{stat.deletions}</div>
              </div>
            </div>
          )}

          {/* 操作 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Typography.Text type="secondary">
              {from} → {to} 共 {result.length} 条提交
            </Typography.Text>
            <Space>
              <Button size="small" icon={<FileTextOutlined />} onClick={handleCopyChangelog} disabled={result.length === 0}>
                复制 Changelog
              </Button>
            </Space>
          </div>

          <Divider style={{ margin: '8px 0' }} />

          {/* 提交列表 */}
          {result.length === 0 ? (
            <Empty description="两个版本之间没有差异提交" />
          ) : (
            <List
              size="small"
              dataSource={result}
              style={{ maxHeight: 420, overflow: 'auto' }}
              renderItem={(c) => (
                <List.Item style={{ padding: '8px 0' }}>
                  <List.Item.Meta
                    title={
                      <Space size={8}>
                        <Tag color={TYPE_COLORS[classify(c.subject)]} style={{ marginRight: 0 }}>
                          {TYPE_LABELS[classify(c.subject)]}
                        </Tag>
                        <Typography.Text code>{c.sha.slice(0, 7)}</Typography.Text>
                        <Typography.Text strong>{c.subject}</Typography.Text>
                      </Space>
                    }
                    description={
                      <Space size={16}>
                        <span>👤 {c.author}</span>
                        <span>🕐 {c.date}</span>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </>
      )}
    </Modal>
  );
}

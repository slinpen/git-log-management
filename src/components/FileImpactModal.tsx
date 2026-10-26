import { useEffect, useState } from 'react';
import { Modal, List, Tag, Typography, Space, Empty, Spin, Tooltip } from 'antd';
import { FileSearchOutlined } from '@ant-design/icons';
import type { FileHistoryCommit } from '../types';
import { api } from '../api';
import { classify, TYPE_LABELS, TYPE_COLORS } from '../utils';

interface Props {
  projectPath: string;
  branch: string;
  file: string;
  onClose: () => void;
}

export default function FileImpactModal({ projectPath, branch, file, onClose }: Props) {
  const [commits, setCommits] = useState<FileHistoryCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const d = await api.getFileHistory(projectPath, file, branch);
        if (!alive) return;
        if (d.ok) {
          setCommits(d.commits);
        } else {
          setError(d.error || '获取文件历史失败');
        }
      } catch (e) {
        if (alive) setError('获取文件历史失败');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [projectPath, branch, file]);

  // 统计贡献者
  const authorMap = new Map<string, number>();
  let totalIns = 0, totalDel = 0;
  for (const c of commits) {
    authorMap.set(c.author, (authorMap.get(c.author) || 0) + 1);
    totalIns += c.insertions;
    totalDel += c.deletions;
  }

  return (
    <Modal
      open
      title={
        <Space>
          <FileSearchOutlined style={{ color: '#1677ff' }} />
          <span>变更影响分析</span>
        </Space>
      }
      onCancel={onClose}
      footer={null}
      width={720}
    >
      <div style={{ marginBottom: 12 }}>
        <Tooltip title={file}>
          <Typography.Text
            code
            style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {file}
          </Typography.Text>
        </Tooltip>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : error ? (
        <Empty description={error} />
      ) : commits.length === 0 ? (
        <Empty description="该文件暂无改动记录" />
      ) : (
        <>
          {/* 概览 */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <div className="stat-card" style={{ flex: 1, minWidth: 100 }}>
              <div className="label">改动次数</div>
              <div className="value">{commits.length}</div>
            </div>
            <div className="stat-card" style={{ flex: 1, minWidth: 100 }}>
              <div className="label">贡献者</div>
              <div className="value">{authorMap.size}</div>
            </div>
            <div className="stat-card" style={{ flex: 1, minWidth: 100 }}>
              <div className="label" style={{ color: '#52c41a' }}>累计新增</div>
              <div className="value" style={{ color: '#52c41a' }}>+{totalIns}</div>
            </div>
            <div className="stat-card" style={{ flex: 1, minWidth: 100 }}>
              <div className="label" style={{ color: '#ff4d4f' }}>累计删除</div>
              <div className="value" style={{ color: '#ff4d4f' }}>-{totalDel}</div>
            </div>
          </div>

          {/* 贡献者分布 */}
          <div style={{ marginBottom: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>改动贡献者：</Typography.Text>
            {Array.from(authorMap.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([name, count]) => (
                <Tag key={name} color="blue" style={{ marginBottom: 4 }}>
                  {name} · {count} 次
                </Tag>
              ))}
          </div>

          {/* 改动历史 */}
          <List
            size="small"
            dataSource={commits}
            style={{ maxHeight: 400, overflow: 'auto' }}
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
                      <span style={{ color: '#52c41a' }}>+{c.insertions}</span>
                      <span style={{ color: '#ff4d4f' }}>-{c.deletions}</span>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        </>
      )}
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import { Modal, Spin, Row, Col, Card, List, Typography, Tooltip } from 'antd';
import type { ContributorProfile } from '../types';
import { api } from '../api';
import { TYPE_LABELS, TYPE_COLORS } from '../utils';

interface Props {
  projectPath: string;
  branch: string;
  author: string;
  onClose: () => void;
}

export default function ContributorProfileModal({ projectPath, branch, author, onClose }: Props) {
  const [profile, setProfile] = useState<ContributorProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api.getContributorProfile(projectPath, author, branch)
      .then((d) => {
        if (mounted) {
          if (d.ok) setProfile(d.profile);
        }
      })
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [projectPath, author, branch]);

  if (loading) {
    return (
      <Modal title={`贡献者画像 · ${author}`} open onCancel={onClose} footer={null} width={720}>
        <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
      </Modal>
    );
  }

  if (!profile) {
    return (
      <Modal title={`贡献者画像 · ${author}`} open onCancel={onClose} footer={null} width={720}>
        <div style={{ textAlign: 'center', padding: 40, color: '#8c8c8c' }}>加载失败</div>
      </Modal>
    );
  }

  const typeEntries = Object.entries(profile.typeDist).sort((a, b) => b[1] - a[1]);
  const typeTotal = typeEntries.reduce((s, [, v]) => s + v, 0) || 1;
  const maxHour = Math.max(...profile.hourDist, 1);
  const tl = profile.timeline.slice(-14);
  const maxTl = Math.max(...tl.map((t) => t.count), 1);

  return (
    <Modal title={`贡献者画像 · ${author}`} open onCancel={onClose} footer={null} width={720}>
      {/* 统计 */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col span={6}><div className="stat-card"><div className="label">提交数</div><div className="value">{profile.totalCommits}</div></div></Col>
        <Col span={6}><div className="stat-card"><div className="label">改动文件</div><div className="value">{profile.touchedFiles}</div></div></Col>
        <Col span={6}><div className="stat-card"><div className="label" style={{ color: '#52c41a' }}>新增行</div><div className="value" style={{ color: '#52c41a' }}>{profile.insertions}</div></div></Col>
        <Col span={6}><div className="stat-card"><div className="label" style={{ color: '#ff4d4f' }}>删除行</div><div className="value" style={{ color: '#ff4d4f' }}>{profile.deletions}</div></div></Col>
      </Row>

      {/* 提交类型分布 */}
      <Card size="small" title="提交类型分布" style={{ marginBottom: 12 }}>
        {typeEntries.map(([t, v]) => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 12 }}>
            <span style={{ width: 44, flexShrink: 0 }}>{TYPE_LABELS[t as keyof typeof TYPE_LABELS] || t}</span>
            <div style={{ flex: 1, height: 12, background: '#f0f0f0', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(v / typeTotal) * 100}%`, background: TYPE_COLORS[t as keyof typeof TYPE_COLORS] || '#8c8c8c' }} />
            </div>
            <span style={{ width: 24, textAlign: 'right', color: '#8c8c8c' }}>{v}</span>
          </div>
        ))}
      </Card>

      {/* 活跃时段 */}
      <Card size="small" title="活跃时段（24 小时）" style={{ marginBottom: 12 }}>
        <div className="hour-chart">
          {profile.hourDist.map((v, h) => (
            <div
              key={h}
              className={`hour-col ${v > 0 ? 'active' : ''}`}
              style={{ height: `${Math.max((v / maxHour) * 100, 4)}%` }}
              title={`${h}点: ${v} 次提交`}
            />
          ))}
        </div>
      </Card>

      {/* 近 14 天节奏 */}
      <Card size="small" title="近 14 天提交节奏" style={{ marginBottom: 12 }}>
        <div className="hour-chart">
          {tl.map((t) => (
            <div
              key={t.date}
              className="hour-col active"
              style={{ height: `${Math.max((t.count / maxTl) * 100, 4)}%` }}
              title={`${t.date}: ${t.count} 次`}
            />
          ))}
        </div>
      </Card>

      {/* 常改文件 */}
      <Card size="small" title="常改文件 Top 10" style={{ marginBottom: 12 }}>
        <List
          size="small"
          dataSource={profile.topFiles}
          locale={{ emptyText: '无数据' }}
          renderItem={(f) => (
            <List.Item>
              <Tooltip title={f.file}>
                <Typography.Text style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>
                  {f.file}
                </Typography.Text>
              </Tooltip>
              <Typography.Text type="secondary">{f.count}</Typography.Text>
            </List.Item>
          )}
        />
      </Card>

      {/* 最近提交 */}
      <Card size="small" title="最近提交">
        <List
          size="small"
          dataSource={profile.commits.slice(0, 20)}
          locale={{ emptyText: '无数据' }}
          renderItem={(c) => (
            <List.Item>
              <Typography.Text code>{c.sha.slice(0, 7)}</Typography.Text>
              <Typography.Text style={{ flex: 1, margin: '0 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.subject}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{c.date}</Typography.Text>
            </List.Item>
          )}
        />
      </Card>
    </Modal>
  );
}

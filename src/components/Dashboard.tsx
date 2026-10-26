import { useEffect, useState, useCallback } from 'react';
import { Row, Col, Card, Typography, Space, Tag, Button, Tooltip, Empty, Spin } from 'antd';
import {
  ReloadOutlined, DashboardOutlined, BranchesOutlined, CloudUploadOutlined,
  CloudDownloadOutlined, EditOutlined, TeamOutlined,
} from '@ant-design/icons';
import type { DashboardProjectInfo } from '../types';
import { api } from '../api';

interface Props {
  onOpenProject: (id: string) => void;
}

function formatAgo(dateStr: string): string {
  const t = new Date(dateStr.replace(' ', 'T')).getTime();
  if (isNaN(t)) return dateStr;
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return dateStr.slice(0, 10);
}

export default function Dashboard({ onOpenProject }: Props) {
  const [projects, setProjects] = useState<DashboardProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api.getDashboard();
      if (d.ok) setProjects(d.projects);
    } catch (e) {
      console.error('加载仪表盘失败', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);

  const validProjects = projects.filter((p) => p.valid);
  const totalToday = validProjects.reduce((s, p) => s + p.todayCount, 0);
  const totalWeek = validProjects.reduce((s, p) => s + p.weekCount, 0);
  // 需要关注：本地领先未推送、落后远程未拉取、或工作区有未提交改动
  const needAttention = validProjects.filter((p) => (p.ahead ?? 0) > 0 || (p.behind ?? 0) > 0 || p.dirty);

  return (
    <div style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
      <Card size="small" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <DashboardOutlined style={{ fontSize: 18, color: '#1677ff' }} />
            <Typography.Title level={4} style={{ margin: 0 }}>项目总览</Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>每分钟自动刷新</Typography.Text>
          </Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
        </div>
      </Card>

      {/* 汇总统计 */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col span={6}><div className="stat-card"><div className="label">项目数</div><div className="value">{validProjects.length}</div></div></Col>
        <Col span={6}><div className="stat-card"><div className="label">今日提交</div><div className="value">{totalToday}</div></div></Col>
        <Col span={6}><div className="stat-card"><div className="label">近 7 天提交</div><div className="value">{totalWeek}</div></div></Col>
        <Col span={6}>
          <div className="stat-card">
            <div className="label" style={{ color: needAttention.length > 0 ? '#faad14' : undefined }}>需要关注</div>
            <div className="value" style={{ color: needAttention.length > 0 ? '#faad14' : undefined }}>{needAttention.length}</div>
          </div>
        </Col>
      </Row>

      {/* 项目卡片 */}
      {loading && projects.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
      ) : validProjects.length === 0 ? (
        <Empty description={<Typography.Text type="secondary">暂无有效的 Git 项目，请在左侧添加</Typography.Text>} />
      ) : (
        <Row gutter={[12, 12]}>
          {validProjects.map((p) => (
            <Col span={8} key={p.id} xs={24} sm={12} md={8} lg={8} xl={6}>
              <Card
                size="small"
                hoverable
                onClick={() => onOpenProject(p.id)}
                title={
                  <Space size={6}>
                    <Typography.Text strong ellipsis style={{ maxWidth: 160 }}>{p.name}</Typography.Text>
                  </Space>
                }
                extra={
                  <Space size={4}>
                    {p.dirty && (
                      <Tooltip title="工作区有未提交改动">
                        <Tag icon={<EditOutlined />} color="warning" style={{ marginRight: 0 }}>未提交</Tag>
                      </Tooltip>
                    )}
                  </Space>
                }
              >
                <Space size={6} style={{ marginBottom: 10 }} wrap>
                  <Tag icon={<BranchesOutlined />} style={{ marginRight: 0 }}>{p.branch || '—'}</Tag>
                  {p.ahead !== null && p.ahead > 0 && (
                    <Tooltip title={`本地领先远程 ${p.ahead} 个提交，未推送`}>
                      <Tag icon={<CloudUploadOutlined />} color="blue" style={{ marginRight: 0 }}>↑{p.ahead}</Tag>
                    </Tooltip>
                  )}
                  {p.behind !== null && p.behind > 0 && (
                    <Tooltip title={`本地落后远程 ${p.behind} 个提交，未拉取`}>
                      <Tag icon={<CloudDownloadOutlined />} color="orange" style={{ marginRight: 0 }}>↓{p.behind}</Tag>
                    </Tooltip>
                  )}
                </Space>

                <Row gutter={8} style={{ marginBottom: 10 }}>
                  <Col span={8}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 600 }}>{p.todayCount}</div>
                      <div style={{ fontSize: 12, color: '#8c8c8c' }}>今日提交</div>
                    </div>
                  </Col>
                  <Col span={8}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 600 }}>{p.weekCount}</div>
                      <div style={{ fontSize: 12, color: '#8c8c8c' }}>近 7 天</div>
                    </div>
                  </Col>
                  <Col span={8}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 600 }}>{p.activeAuthors}</div>
                      <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                        <TeamOutlined /> 活跃
                      </div>
                    </div>
                  </Col>
                </Row>

                {p.lastCommit ? (
                  <Tooltip title={`${p.lastCommit.date} · ${p.lastCommit.author}`}>
                    <Typography.Text
                      type="secondary"
                      ellipsis
                      style={{ fontSize: 12, display: 'block' }}
                    >
                      {formatAgo(p.lastCommit.date)} · {p.lastCommit.subject}
                    </Typography.Text>
                  </Tooltip>
                ) : (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>暂无提交</Typography.Text>
                )}
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}

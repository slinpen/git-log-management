import { useEffect, useState } from 'react';
import { Card, Tabs, List, Tag, Typography, Empty, Spin, Space, Tooltip } from 'antd';
import { WarningOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { TrendPoint, CommitAlert, AlertSeverity } from '../types';

interface Props {
  projectPath: string;
  branch: string;
}

// 简单 SVG 趋势图（避免引入图表库）
function TrendChart({ data }: { data: TrendPoint[] }) {
  if (!data || data.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无数据" />;

  const width = 640;
  const height = 200;
  const padding = { top: 16, right: 16, bottom: 28, left: 32 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(...data.map((d) => d.count), 1);

  const x = (i: number) => padding.left + (i / (data.length - 1)) * innerW;
  const y = (v: number) => padding.top + innerH - (v / max) * innerH;

  const points = data.map((d, i) => `${x(i)},${y(d.count)}`).join(' ');
  const areaPath = `${padding.left},${padding.top + innerH} ${points} ${x(data.length - 1)},${padding.top + innerH}`;

  // 刻度标签（最多显示 6 个日期）
  const labelStep = Math.max(1, Math.ceil(data.length / 6));

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      {/* 网格线 */}
      {[0, 0.5, 1].map((t) => (
        <line
          key={t}
          x1={padding.left}
          y1={padding.top + innerH * t}
          x2={padding.left + innerW}
          y2={padding.top + innerH * t}
          stroke="#f0f0f0"
          strokeWidth={1}
        />
      ))}
      {/* 面积 */}
      <polygon points={areaPath} fill="rgba(22,119,255,0.08)" />
      {/* 折线 */}
      <polyline points={points} fill="none" stroke="#1677ff" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {/* 数据点 */}
      {data.map((d, i) => (
        <circle key={i} cx={x(i)} cy={y(d.count)} r={2.5} fill="#1677ff">
          <title>{`${d.date}: ${d.count} 次提交`}</title>
        </circle>
      ))}
      {/* X 轴日期 */}
      {data.map((d, i) =>
        i % labelStep === 0 ? (
          <text key={i} x={x(i)} y={height - 8} fontSize={10} fill="#8c8c8c" textAnchor="middle">
            {d.date.slice(5)}
          </text>
        ) : null
      )}
      {/* Y 轴最大值 */}
      <text x={padding.left - 6} y={padding.top + 4} fontSize={10} fill="#8c8c8c" textAnchor="end">
        {max}
      </text>
      <text x={padding.left - 6} y={padding.top + innerH} fontSize={10} fill="#8c8c8c" textAnchor="end">
        0
      </text>
    </svg>
  );
}

const SEVERITY_META: Record<AlertSeverity, { color: string; icon: React.ReactNode }> = {
  warning: { color: 'warning', icon: <WarningOutlined /> },
  info: { color: 'processing', icon: <InfoCircleOutlined /> },
};

const TYPE_LABEL: Record<CommitAlert['type'], string> = {
  empty_message: '空提交信息',
  short_message: '提交信息过短',
  late_night: '深夜提交',
  large_commit: '大提交',
};

export default function InsightsPanel({ projectPath, branch }: Props) {
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [alerts, setAlerts] = useState<CommitAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      api.getTrend(projectPath, branch, 30),
      api.getAlerts(projectPath, branch, '30 days ago', 500),
    ])
      .then(([t, a]) => {
        if (mounted) {
          if (t.ok) setTrend(t.trend);
          if (a.ok) setAlerts(a.alerts);
        }
      })
      .catch(() => {})
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [projectPath, branch]);

  if (loading) {
    return (
      <Card size="small" style={{ marginBottom: 16 }}>
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      </Card>
    );
  }

  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <Tabs
        size="small"
        items={[
          {
            key: 'trend',
            label: '提交趋势',
            children: <TrendChart data={trend} />,
          },
          {
            key: 'alerts',
            label: (
              <Space size={4}>
                异常告警
                {alerts.length > 0 && <Tag color="red" style={{ marginLeft: 0 }}>{alerts.length}</Tag>}
              </Space>
            ),
            children: alerts.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未发现异常提交" />
            ) : (
              <List
                size="small"
                dataSource={alerts}
                style={{ maxHeight: 300, overflow: 'auto' }}
                renderItem={(a) => (
                  <List.Item>
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      <Space size={8}>
                        <Tag color={SEVERITY_META[a.severity].color} style={{ marginRight: 0 }}>
                          {TYPE_LABEL[a.type]}
                        </Tag>
                        <Typography.Text code style={{ fontSize: 12 }}>{a.sha.slice(0, 7)}</Typography.Text>
                        <Typography.Text style={{ fontSize: 13 }}>{a.message}</Typography.Text>
                      </Space>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {a.subject || '(无提交信息)'} · {a.author} · {a.date}
                      </Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            ),
          },
        ]}
      />
    </Card>
  );
}

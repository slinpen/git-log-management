import { useEffect, useState, useCallback } from 'react';
import { Card, Button, Space, Tag, Typography, Tooltip, message, Spin } from 'antd';
import {
  CaretRightOutlined, PoweroffOutlined, CopyOutlined, SettingOutlined,
  ReloadOutlined, GlobalOutlined,
} from '@ant-design/icons';
import type { Project, ProjectRunStatus } from '../types';
import { api } from '../api';
import { copyToClipboard } from '../utils';

interface Props {
  project: Project;
  onOpenConfig: () => void;
  onConfigChanged: () => void;
}

const STATUS_META: Record<string, { label: string; color: string; dot: string }> = {
  running: { label: '运行中', color: 'green', dot: '#52c41a' },
  starting: { label: '启动中', color: 'gold', dot: '#faad14' },
  stopped: { label: '已停止', color: 'default', dot: '#d9d9d9' },
  error: { label: '启动失败', color: 'red', dot: '#ff4d4f' },
};

export default function RunStatusPanel({ project, onOpenConfig, onConfigChanged }: Props) {
  const [status, setStatus] = useState<ProjectRunStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const pollStatus = useCallback(async () => {
    try {
      const d = await api.getProjectStatus(project.id);
      if (d.ok) setStatus(d);
    } catch (e) {
      // 忽略轮询错误
    }
  }, [project.id]);

  // 定时轮询状态
  useEffect(() => {
    pollStatus();
    const timer = setInterval(pollStatus, 2500);
    return () => clearInterval(timer);
  }, [pollStatus]);

  const handleStart = async () => {
    setBusy(true);
    try {
      const d = await api.startProject(project.id);
      if (d.ok) {
        message.success('启动指令已下发');
        pollStatus();
      } else {
        message.error(d.error || '启动失败');
      }
    } catch (e) {
      message.error('启动失败');
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      const d = await api.stopProject(project.id);
      if (d.ok) {
        message.success('已停止');
        pollStatus();
      } else {
        message.error(d.error || '停止失败');
      }
    } catch (e) {
      message.error('停止失败');
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = () => {
    if (!status?.url) return;
    copyToClipboard(status.url, '已复制访问地址');
    message.success('已复制访问地址');
  };

  const meta = status ? STATUS_META[status.status] : STATUS_META.stopped;
  const configured = !!(project.config?.startCommand);
  const isRunning = status?.status === 'running';
  const isStarting = status?.status === 'starting';

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: meta.dot }} />
          <span>项目运行</span>
          <Tag color={meta.color} style={{ marginLeft: 0 }}>{meta.label}</Tag>
        </Space>
      }
      extra={
        <Space size={4}>
          <Button size="small" icon={<SettingOutlined />} onClick={onOpenConfig}>配置</Button>
          <Tooltip title="刷新状态">
            <Button size="small" icon={<ReloadOutlined />} onClick={pollStatus} />
          </Tooltip>
        </Space>
      }
      style={{ marginBottom: 16 }}
    >
      {!configured ? (
        <div style={{ color: '#8c8c8c', fontSize: 13, lineHeight: 1.8 }}>
          尚未配置启动命令，请先点击右上角「配置」设置，再一键启动。
        </div>
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space size={12} wrap>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              启动命令：
            </Typography.Text>
            <Typography.Text code>{project.config?.startCommand}</Typography.Text>
            {project.config?.port ? (
              <Tag>端口 {project.config.port}</Tag>
            ) : null}
          </Space>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {isRunning || isStarting ? (
              <Button danger size="middle" icon={<PoweroffOutlined />} loading={busy} onClick={handleStop}>
                停止
              </Button>
            ) : (
              <Button type="primary" size="middle" icon={<CaretRightOutlined />} loading={busy} onClick={handleStart}>
                启动
              </Button>
            )}

            {status?.url && (
              <Space.Compact style={{ maxWidth: 420 }}>
                <Button icon={<GlobalOutlined />} onClick={() => window.open(status.url, '_blank')} title="打开">
                  访问
                </Button>
                <Tooltip title={status.url}>
                  <Typography.Text
                    code
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '0 12px',
                      border: '1px solid #d9d9d9',
                      borderLeft: 0,
                      borderRadius: '0 6px 6px 0',
                      maxWidth: 320,
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                      cursor: 'pointer',
                    }}
                    onClick={copyUrl}
                  >
                    {status.url}
                  </Typography.Text>
                </Tooltip>
                <Button icon={<CopyOutlined />} onClick={copyUrl} title="一键复制地址" />
              </Space.Compact>
            )}
          </div>

          {isStarting && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <Spin size="small" style={{ marginRight: 6 }} />
              正在启动，若配置了端口会自动探测就绪…
            </Typography.Text>
          )}
          {isStarting && status.error && (
            <Typography.Text type="warning" style={{ fontSize: 12 }}>{status.error}</Typography.Text>
          )}
          {status?.status === 'error' && status.error && (
            <Typography.Text type="danger" style={{ fontSize: 12 }}>{status.error}</Typography.Text>
          )}
          {(status?.status === 'error' || isStarting) && status.logs && status.logs.length > 0 && (
            <pre style={{
              marginTop: 8,
              padding: '10px 12px',
              background: status.status === 'error' ? '#fff1f0' : '#fafafa',
              border: `1px solid ${status.status === 'error' ? '#ffccc7' : '#d9d9d9'}`,
              borderRadius: 6,
              fontSize: 12,
              lineHeight: 1.6,
              maxHeight: 160,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {status.logs.slice(-30).join('')}
            </pre>
          )}
        </Space>
      )}
    </Card>
  );
}

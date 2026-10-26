import { useEffect, useState } from 'react';
import { Button, List, Tag, Typography, Space, Modal, Input, message, Tooltip, Badge } from 'antd';
import { PlusOutlined, FolderOpenOutlined, DeleteOutlined, SettingOutlined, DashboardOutlined } from '@ant-design/icons';
import type { Project, ProjectRunStatus } from '../types';
import { api } from '../api';

interface Props {
  projects: Project[];
  currentProject: Project | null;
  loading: boolean;
  onSelect: (p: Project | null) => void;
  onAdd: (p: Project) => void;
  onConfigure: (p: Project) => void;
  onRemove: (id: string) => void;
}

export default function ProjectSidebar({ projects, currentProject, loading, onSelect, onAdd, onConfigure, onRemove }: Props) {
  const [manualOpen, setManualOpen] = useState(false);
  const [manualPath, setManualPath] = useState('');
  const [adding, setAdding] = useState(false);
  const [statusMap, setStatusMap] = useState<Record<string, ProjectRunStatus>>({});

  // 轮询所有项目运行状态
  useEffect(() => {
    const poll = async () => {
      const map: Record<string, ProjectRunStatus> = {};
      await Promise.all(projects.map(async (p) => {
        try {
          const d = await api.getProjectStatus(p.id);
          if (d.ok) map[p.id] = d;
        } catch (e) {
          // 忽略
        }
      }));
      setStatusMap(map);
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, [projects]);

  const handlePicker = async () => {
    setAdding(true);
    try {
      const data = await api.addProjectByPicker();
      if (data.ok && data.project) {
        message.success('项目已添加');
        onAdd(data.project);
      } else if (data.error && !data.error.includes('未选择')) {
        message.error(data.error);
      }
    } catch (e) {
      message.error('添加失败');
    } finally {
      setAdding(false);
    }
  };

  const handleManual = async () => {
    if (!manualPath.trim()) return;
    setAdding(true);
    try {
      const data = await api.addProject(manualPath.trim());
      if (data.ok && data.project) {
        message.success('项目已添加');
        setManualOpen(false);
        setManualPath('');
        onAdd(data.project);
      } else {
        message.error(data.error || '添加失败');
      }
    } catch (e) {
      message.error('添加失败');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = (p: Project) => {
    Modal.confirm({
      title: '移除项目',
      content: (
        <div>
          <div>确定要移除项目「<Typography.Text strong>{p.name}</Typography.Text>」吗？</div>
          <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 12 }}>
            仅从本工具的项目列表移除，不会删除磁盘上的项目文件。
          </div>
        </div>
      ),
      okText: '移除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => onRemove(p.id),
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16 }}>
      <Typography.Title level={4} style={{ margin: '0 0 16px' }}>
        Git 日志管理
      </Typography.Title>

      <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }} size={8}>
        <Button type="primary" icon={<FolderOpenOutlined />} block loading={adding} onClick={handlePicker}>
          添加项目
        </Button>
        <Button block onClick={() => setManualOpen(true)}>
          手动输入路径
        </Button>
      </Space>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* 项目总览入口：未选中任何项目时高亮 */}
        <List.Item
          onClick={() => onSelect(null)}
          style={{
            cursor: 'pointer',
            padding: '10px 12px',
            borderRadius: 8,
            background: currentProject === null ? '#e6f4ff' : 'transparent',
            marginBottom: 4,
          }}
        >
          <List.Item.Meta
            avatar={<DashboardOutlined style={{ fontSize: 18, color: currentProject === null ? '#1677ff' : '#8c8c8c' }} />}
            title={<Typography.Text strong={currentProject === null}>项目总览</Typography.Text>}
            description={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {projects.length > 0 ? `${projects.length} 个项目` : '—'}
              </Typography.Text>
            }
          />
        </List.Item>

        <List
          loading={loading}
          dataSource={projects}
          locale={{ emptyText: '暂无项目' }}
          renderItem={(p) => {
            const st = statusMap[p.id];
            const running = st?.status === 'running';
            const starting = st?.status === 'starting';
            const dotColor = running ? '#52c41a' : starting ? '#faad14' : '#d9d9d9';
            return (
              <List.Item
                onClick={() => onSelect(p)}
                style={{
                  cursor: 'pointer',
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: currentProject?.id === p.id ? '#e6f4ff' : 'transparent',
                  marginBottom: 4,
                }}
                extra={
                  <Space size={4} onClick={(e) => e.stopPropagation()}>
                    <Tooltip title={running ? '运行中' : starting ? '启动中' : '已停止'}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: dotColor }} />
                    </Tooltip>
                    <Tooltip title="运行配置">
                      <SettingOutlined
                        style={{ color: '#8c8c8c', fontSize: 13 }}
                        onClick={() => onConfigure(p)}
                      />
                    </Tooltip>
                    <Tooltip title="移除项目">
                      <DeleteOutlined
                        style={{ color: '#bfbfbf', fontSize: 13 }}
                        onClick={() => handleRemove(p)}
                      />
                    </Tooltip>
                  </Space>
                }
              >
                <List.Item.Meta
                  title={
                    <Space size={4}>
                      <Typography.Text ellipsis style={{ maxWidth: 110 }}>{p.name}</Typography.Text>
                      {p.valid === false && <Tag color="red" style={{ marginRight: 0 }}>失效</Tag>}
                    </Space>
                  }
                  description={
                    <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                      {p.branch || '—'}
                    </Typography.Text>
                  }
                />
              </List.Item>
            );
          }}
        />
      </div>

      <Modal
        title="手动添加项目"
        open={manualOpen}
        onOk={handleManual}
        onCancel={() => setManualOpen(false)}
        okText="添加"
        cancelText="取消"
        confirmLoading={adding}
      >
        <Input
          placeholder="请输入 Git 仓库的本地路径，如 /Users/you/project"
          value={manualPath}
          onChange={(e) => setManualPath(e.target.value)}
          onPressEnter={handleManual}
        />
      </Modal>
    </div>
  );
}

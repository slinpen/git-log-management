import { useEffect, useState, useCallback } from 'react';
import { Layout, Typography, message } from 'antd';
import type { Project } from './types';
import { api } from './api';
import ProjectSidebar from './components/ProjectSidebar';
import ProjectView from './components/ProjectView';
import Dashboard from './components/Dashboard';
import { Empty } from 'antd';

const { Sider, Content } = Layout;

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  // 记录「需要自动打开配置弹窗」的项目 id，仅点击侧边栏配置按钮时设置
  const [configTargetId, setConfigTargetId] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      const data = await api.getProjects();
      if (data.ok) setProjects(data.projects);
    } catch (e) {
      console.error('加载项目失败', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleSelectProject = (p: Project | null) => {
    // null 表示切换回项目总览
    setCurrentProject(p);
    // 切换项目时清除待打开配置的目标，避免误触发
    setConfigTargetId(null);
  };

  const handleOpenProjectById = (id: string) => {
    const p = projects.find((x) => x.id === id);
    if (p) setCurrentProject(p);
    setConfigTargetId(null);
  };

  const handleAddProject = async (p: Project) => {
    await loadProjects();
    setCurrentProject(p);
    setConfigTargetId(null);
  };

  const handleRemoveProject = async (id: string) => {
    try {
      const d = await api.removeProject(id);
      if (d.ok) {
        message.success('项目已移除');
        // 若移除的是当前项目，清空选中
        if (currentProject?.id === id) setCurrentProject(null);
        await loadProjects();
      } else {
        message.error('移除失败');
      }
    } catch (e) {
      message.error('移除失败');
    }
  };

  const handleConfigure = (p: Project) => {
    setCurrentProject(p);
    // 标记目标项目，触发 ProjectView 打开配置弹窗
    setConfigTargetId(p.id);
  };

  return (
    <Layout className="app-layout">
      <Sider width={240} className="sidebar" theme="light">
        <ProjectSidebar
          projects={projects}
          currentProject={currentProject}
          loading={loading}
          onSelect={handleSelectProject}
          onAdd={handleAddProject}
          onConfigure={handleConfigure}
          onRemove={handleRemoveProject}
        />
      </Sider>
      <Content className="main-content">
        {currentProject ? (
          <ProjectView
            key={currentProject.id}
            project={currentProject}
            configTargetId={configTargetId}
            onConfigHandled={() => setConfigTargetId(null)}
          />
        ) : projects.length > 0 ? (
          // 未选中项目时默认展示跨项目总览
          <Dashboard onOpenProject={handleOpenProjectById} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Empty description={<Typography.Text type="secondary">请从左侧选择或添加一个项目</Typography.Text>} />
          </div>
        )}
      </Content>
    </Layout>
  );
}

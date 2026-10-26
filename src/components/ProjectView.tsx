import { useEffect, useState, useCallback } from 'react';
import {
  Row, Col, Card, Typography, Tabs, Space, Select, Input, Button, Tag, message,
  Segmented, List, Tooltip, Divider, Pagination,
} from 'antd';
import {
  FileTextOutlined, BarChartOutlined, LineChartOutlined,
  SearchOutlined, ReloadOutlined, CopyOutlined, SwapOutlined, FileSearchOutlined, NodeIndexOutlined, EditOutlined,
} from '@ant-design/icons';
import type { Project, CommitsResponse, Branch, Commit, ReportType } from '../types';
import { api } from '../api';
import { classify, TYPE_LABELS, TYPE_COLORS, sinceParam, copyToClipboard } from '../utils';
import CommitDetailModal from './CommitDetailModal';
import ContributorProfileModal from './ContributorProfileModal';
import ReportModal from './ReportModal';
import InsightsPanel from './InsightsPanel';
import RunStatusPanel from './RunStatusPanel';
import ProjectConfigModal from './ProjectConfigModal';
import FileImpactModal from './FileImpactModal';
import CompareModal from './CompareModal';
import CommitGraphModal from './CommitGraphModal';
import WorkingChangesModal from './WorkingChangesModal';

interface Props {
  project: Project;
  configTargetId?: string | null;
  onConfigHandled?: () => void;
}

const RANGE_OPTIONS = [
  { label: '今天', value: '1' },
  { label: '近 3 天', value: '3' },
  { label: '近 7 天', value: '7' },
  { label: '近 30 天', value: '30' },
  { label: '全部', value: 'all' },
];

export default function ProjectView({ project, configTargetId, onConfigHandled }: Props) {
  const [range, setRange] = useState('7');
  const [branch, setBranch] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [filterAuthor, setFilterAuthor] = useState('');
  const [filterFile, setFilterFile] = useState('');

  const [data, setData] = useState<CommitsResponse | null>(null);
  const [files, setFiles] = useState<{ file: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // 搜索
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<Commit[] | null>(null);
  const [searching, setSearching] = useState(false);

  // 弹窗
  const [detailSha, setDetailSha] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [reportType, setReportType] = useState<ReportType | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [impactFile, setImpactFile] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [workOpen, setWorkOpen] = useState(false);
  // 运行配置（本地副本，保存后更新，供运行面板实时读取）
  const [runConfig, setRunConfig] = useState(project.config);
  const projectWithConfig: Project = { ...project, config: runConfig };

  const loadBranches = useCallback(async () => {
    try {
      const d = await api.getBranches(project.path);
      if (d.ok) {
        setBranches(d.branches);
        const cur = d.branches.find((b) => b.isCurrent);
        if (cur) setBranch(cur.name);
      }
    } catch (e) {
      // 忽略
    }
  }, [project.path]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const since = sinceParam(range);
      const [commitsData, filesData] = await Promise.all([
        api.getCommits({
          path: project.path, since, branch,
          author: filterAuthor, file: filterFile,
          n: pageSize, skip: (page - 1) * pageSize,
        }),
        api.getFiles(project.path, since, branch),
      ]);
      if (commitsData.ok) {
        setData(commitsData);
        setSearchResults(null);
      }
      if (filesData.ok) setFiles(filesData.files);
    } catch (e) {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [project.path, range, branch, page, pageSize, filterAuthor, filterFile]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 响应侧边栏「配置」入口：仅当目标明确指向当前项目时打开，并立即清除标记
  useEffect(() => {
    if (configTargetId && configTargetId === project.id) {
      setConfigOpen(true);
      onConfigHandled?.();
    }
  }, [configTargetId, project.id, onConfigHandled]);

  const handleSearch = async () => {
    if (!searchQ.trim()) {
      message.warning('请输入搜索内容');
      return;
    }
    setSearching(true);
    try {
      const d = await api.search(project.path, searchQ.trim(), branch);
      if (!d.ok) {
        message.error(d.error || '搜索失败');
        return;
      }
      if (d.candidates.length === 0) {
        setSearchResults([]);
        message.info('未找到相关提交');
        return;
      }
      // AI 精排（失败则用 --grep/近期候选 的原始顺序）
      let ranked: Commit[] = d.candidates.map((c) => ({
        ...c,
        email: '',
        body: '',
      }));
      let aiRanked = false;
      try {
        const { chatOnce, hasCloud } = await import('../api/cloud');
        if (hasCloud()) {
          const candText = d.candidates.map((c, i) => `${i}|${c.subject}`).join('\n');
          const content = await chatOnce([
            { role: 'system', content: '你是 Git 提交检索助手。根据用户的自然语言查询，从候选提交中选出语义相关的提交，返回相关性从高到低的编号列表。只输出数字编号（用逗号分隔），不要输出其他内容。' },
            { role: 'user', content: `用户查询：「${searchQ}」\n\n候选提交（编号|提交信息）：\n${candText}\n\n请输出最相关提交的编号，按相关度降序排列，用逗号分隔，例如：3,0,12。若都不相关，可输出空。` },
          ]);
          const order = (content.match(/\d+/g) || []).map(Number).filter((i) => i >= 0 && i < d.candidates.length);
          const seen = new Set<number>();
          const rankedList: Commit[] = [];
          for (const i of order) {
            if (!seen.has(i)) { seen.add(i); rankedList.push(ranked[i]); }
          }
          // 相关度靠后的补到末尾，保证不丢结果
          ranked.forEach((c, i) => {
            if (!seen.has(i)) rankedList.push(c);
          });
          ranked = rankedList;
          aiRanked = true;
        }
      } catch (e) {
        // AI 精排失败，用原始候选顺序
        aiRanked = false;
      }
      setSearchResults(ranked);
      message.success(aiRanked ? `AI 已为你匹配 ${ranked.length} 条相关提交` : `找到 ${ranked.length} 条相关提交`);
    } catch (e) {
      message.error('搜索失败');
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQ('');
    setSearchResults(null);
    loadData();
  };

  const commits: Commit[] = searchResults ?? data?.commits ?? [];
  const contributors = data?.contributors ?? [];
  const stat = data?.stat;

  const renderCommitList = (list: Commit[]) => {
    if (list.length === 0) {
      return (
        <div style={{ textAlign: 'center', padding: 40, color: '#8c8c8c' }}>
          {searchResults ? '未找到相关提交，换个说法试试' : '该时间段暂无提交记录'}
        </div>
      );
    }
    return (
      <List
        dataSource={list}
        renderItem={(c) => (
          <List.Item
            className="commit-item"
            onClick={() => setDetailSha(c.sha)}
            style={{ padding: '12px 16px' }}
          >
            <List.Item.Meta
              title={
                <Space size={8}>
                  <Tag color={TYPE_COLORS[classify(c.subject)]} style={{ marginRight: 0 }}>
                    {TYPE_LABELS[classify(c.subject)]}
                  </Tag>
                  <Tooltip title="复制完整 hash">
                    <Typography.Text
                      code
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(c.sha, '已复制提交 hash');
                        message.success('已复制提交 hash');
                      }}
                    >
                      {c.sha.slice(0, 7)}
                    </Typography.Text>
                  </Tooltip>
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
    );
  };

  return (
    <div>
      {/* 顶部 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <Space align="center">
            <Typography.Title level={3} style={{ margin: 0 }}>{project.name}</Typography.Title>
            <Select
              size="small"
              style={{ minWidth: 160 }}
              value={branch || undefined}
              onChange={(v) => { setBranch(v); setPage(1); }}
              placeholder="选择分支"
              options={branches.map((b) => ({ label: b.name, value: b.name }))}
              showSearch
              optionFilterProp="label"
            />
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{project.path}</Typography.Text>
        </div>
      </div>

      {/* 项目运行状态：启停 + 访问地址 */}
      <RunStatusPanel
        project={projectWithConfig}
        onOpenConfig={() => setConfigOpen(true)}
        onConfigChanged={loadData}
      />

      {/* 时间范围 + 报告 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <Segmented options={RANGE_OPTIONS} value={range} onChange={(v) => { setRange(v as string); setPage(1); }} />
          <Space>
            <Button icon={<FileTextOutlined />} onClick={() => setReportType('daily')}>日报</Button>
            <Button icon={<BarChartOutlined />} onClick={() => setReportType('weekly')}>周报</Button>
            <Button icon={<LineChartOutlined />} onClick={() => setReportType('monthly')}>月度总结</Button>
            <Button icon={<SwapOutlined />} onClick={() => setCompareOpen(true)}>版本对比</Button>
            <Button icon={<NodeIndexOutlined />} onClick={() => setGraphOpen(true)}>提交图谱</Button>
            <Button icon={<EditOutlined />} onClick={() => setWorkOpen(true)}>工作区</Button>
          </Space>
        </div>
      </Card>

      {/* 统计卡片 */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col span={4}><div className="stat-card"><div className="label">提交数</div><div className="value">{commits.length}</div></div></Col>
        <Col span={4}><div className="stat-card"><div className="label">参与人</div><div className="value">{contributors.length}</div></div></Col>
        <Col span={5}><div className="stat-card"><div className="label">改动文件</div><div className="value">{stat?.files ?? 0}</div></div></Col>
        <Col span={5}><div className="stat-card"><div className="label" style={{ color: '#52c41a' }}>新增行</div><div className="value" style={{ color: '#52c41a' }}>{stat?.insertions ?? 0}</div></div></Col>
        <Col span={6}><div className="stat-card"><div className="label" style={{ color: '#ff4d4f' }}>删除行</div><div className="value" style={{ color: '#ff4d4f' }}>{stat?.deletions ?? 0}</div></div></Col>
      </Row>

      {/* 主内容 */}
      <Row gutter={12}>
        <Col span={16}>
          {/* 洞察面板：提交趋势 + 异常告警 */}
          <InsightsPanel projectPath={project.path} branch={branch} />

          <Card
            size="small"
            title="提交记录"
            extra={
              <Space>
                <Input
                  size="small"
                  placeholder="按作者筛选"
                  value={filterAuthor}
                  onChange={(e) => setFilterAuthor(e.target.value)}
                  style={{ width: 120 }}
                  onPressEnter={() => { setPage(1); loadData(); }}
                />
                <Input
                  size="small"
                  placeholder="按文件筛选"
                  value={filterFile}
                  onChange={(e) => setFilterFile(e.target.value)}
                  style={{ width: 120 }}
                  onPressEnter={() => { setPage(1); loadData(); }}
                />
                <Button size="small" icon={<ReloadOutlined />} onClick={loadData}>刷新</Button>
              </Space>
            }
          >
            {/* 语义搜索 */}
            <div style={{ marginBottom: 12 }}>
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  placeholder="AI 语义搜索，如「谁改过登录逻辑」"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  onPressEnter={handleSearch}
                />
                <Button type="primary" icon={<SearchOutlined />} loading={searching} onClick={handleSearch}>搜索</Button>
                {searchResults && <Button onClick={clearSearch}>清除结果</Button>}
              </Space.Compact>
            </div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 40 }}>加载中…</div>
            ) : (
              renderCommitList(commits)
            )}
            {!searchResults && !loading && (data?.total ?? 0) > pageSize && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <Pagination
                  current={page}
                  pageSize={pageSize}
                  total={data?.total ?? 0}
                  showSizeChanger
                  showQuickJumper
                  showTotal={(t) => `共 ${t} 条`}
                  pageSizeOptions={[10, 20, 50, 100]}
                  onChange={(p, ps) => {
                    setPage(p);
                    if (ps !== pageSize) {
                      setPageSize(ps);
                      setPage(1);
                    }
                  }}
                />
              </div>
            )}
          </Card>
        </Col>

        <Col span={8}>
          <Card size="small" title="贡献者" style={{ marginBottom: 12 }}>
            <List
              size="small"
              dataSource={contributors.slice(0, 20)}
              locale={{ emptyText: '无数据' }}
              renderItem={(c) => (
                <List.Item
                  style={{ cursor: 'pointer' }}
                  onClick={() => setProfileName(c.name)}
                >
                  <Typography.Text>{c.name}</Typography.Text>
                  <Typography.Text type="secondary">{c.count} 次</Typography.Text>
                </List.Item>
              )}
            />
          </Card>

          <Card size="small" title="热门改动文件" extra={<Tooltip title="点击文件查看其改动历史与影响"><FileSearchOutlined style={{ color: '#8c8c8c' }} /></Tooltip>}>
            <List
              size="small"
              dataSource={files}
              locale={{ emptyText: '无数据' }}
              renderItem={(f) => (
                <List.Item
                  style={{ cursor: 'pointer' }}
                  onClick={() => setImpactFile(f.file)}
                >
                  <Tooltip title={f.file}>
                    <Typography.Text style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                      {f.file}
                    </Typography.Text>
                  </Tooltip>
                  <Typography.Text type="secondary">{f.count}</Typography.Text>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      {/* 弹窗 */}
      {detailSha && (
        <CommitDetailModal
          projectPath={project.path}
          sha={detailSha}
          onClose={() => setDetailSha(null)}
        />
      )}
      {profileName && (
        <ContributorProfileModal
          projectPath={project.path}
          branch={branch}
          author={profileName}
          onClose={() => setProfileName(null)}
        />
      )}
      {reportType && (
        <ReportModal
          project={project}
          branch={branch}
          type={reportType}
          onClose={() => setReportType(null)}
        />
      )}
      {impactFile && (
        <FileImpactModal
          projectPath={project.path}
          branch={branch}
          file={impactFile}
          onClose={() => setImpactFile(null)}
        />
      )}
      {compareOpen && (
        <CompareModal
          projectPath={project.path}
          onClose={() => setCompareOpen(false)}
        />
      )}
      {graphOpen && (
        <CommitGraphModal
          projectPath={project.path}
          projectLabel={project.name}
          branch={branch}
          onClose={() => setGraphOpen(false)}
          onOpenDetail={(sha) => setDetailSha(sha)}
        />
      )}
      {workOpen && (
        <WorkingChangesModal
          projectPath={project.path}
          projectLabel={project.name}
          onClose={() => setWorkOpen(false)}
        />
      )}
      <ProjectConfigModal
        project={project}
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        onSaved={(cfg) => {
          setRunConfig(cfg);
          setConfigOpen(false);
        }}
      />
    </div>
  );
}

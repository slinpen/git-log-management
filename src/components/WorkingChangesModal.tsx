import { useCallback, useEffect, useState } from 'react';
import {
  Modal, Spin, Button, Tag, Table, Space, Typography, Input, Popconfirm,
  message, Tooltip, Empty, Modal as AntModal,
} from 'antd';
import {
  ReloadOutlined, CloudUploadOutlined, CloudDownloadOutlined,
  PlusOutlined, MinusOutlined, UndoOutlined, RollbackOutlined,
} from '@ant-design/icons';
import type { WorkingFile } from '../types';
import { api } from '../api';
import { highlightDiff } from './CommitDetailModal';

interface Props {
  projectPath: string;
  projectLabel: string;
  onClose: () => void;
}

const STATUS_TAG_COLORS: Record<string, string> = {
  修改: 'orange', 新增: 'green', 删除: 'red', 重命名: 'blue',
  复制: 'cyan', 冲突: 'volcano', 未跟踪: 'default',
};

function FileDiffView({ diff }: { diff: string }) {
  if (!diff) return <div style={{ padding: 12, color: '#8c8c8c' }}>无差异内容（可能与暂存区一致）</div>;
  // maxWidth 约束 + overflow 滚动：diff 是不换行长行，不限制宽度会撑破表格
  return (
    <div style={{ maxWidth: '100%', maxHeight: 320, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 6 }}>
      {highlightDiff(diff)}
    </div>
  );
}

export default function WorkingChangesModal({ projectPath, projectLabel, onClose }: Props) {
  const [branch, setBranch] = useState('');
  const [ahead, setAhead] = useState<number | null>(null);
  const [behind, setBehind] = useState<number | null>(null);
  const [files, setFiles] = useState<WorkingFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // 当前执行中的操作名
  const [commitMsg, setCommitMsg] = useState('');
  const [diffs, setDiffs] = useState<Record<string, string>>({}); // key: `${staged?'s':'w'}|${file}`

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.getStatus(projectPath);
      if (d.ok) {
        setBranch(d.branch);
        setAhead(d.ahead);
        setBehind(d.behind);
        setFiles(d.files);
      } else {
        message.error(d.error || '加载工作区状态失败');
      }
    } catch {
      message.error('加载工作区状态失败');
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => { reload(); }, [reload]);

  const loadDiff = async (file: string, staged: boolean) => {
    const key = `${staged ? 's' : 'w'}|${file}`;
    if (diffs[key] !== undefined) return;
    try {
      const d = await api.getFileDiff(projectPath, file, staged);
      setDiffs((prev) => ({ ...prev, [key]: d.ok ? d.diff : (d.error || '加载失败') }));
    } catch {
      setDiffs((prev) => ({ ...prev, [key]: '加载失败' }));
    }
  };

  // 通用操作执行器：失败用 Modal 展示完整错误（git 输出往往较长）
  const runOp = async (name: string, fn: () => Promise<{ ok: boolean; error?: string; output?: string; sha?: string }>, successText: string) => {
    if (busy) return;
    setBusy(name);
    try {
      const r = await fn();
      if (r.ok) {
        const detail = r.output
          ? `：${r.output.split('\n').slice(-3).join(' ').slice(0, 120)}`
          : (r.sha ? `（${r.sha}）` : '');
        message.success(successText + detail);
        setDiffs({}); // 操作后 diff 缓存全部失效
        await reload();
      } else {
        AntModal.error({ title: '操作失败', content: <div style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{r.error}</div> });
      }
    } catch (e: any) {
      AntModal.error({ title: '操作失败', content: e?.message || '未知错误' });
    } finally {
      setBusy(null);
    }
  };

  const handleStage = (fs: string[]) => runOp('stage', () => api.stageFiles(projectPath, fs), '已暂存');
  const handleUnstage = (fs: string[]) => runOp('unstage', () => api.unstageFiles(projectPath, fs), '已取消暂存');
  const handleDiscard = (fs: string[]) => runOp('discard', () => api.discardChanges(projectPath, fs), '已撤销更改');

  const handleCommit = () => {
    const msg = commitMsg.trim();
    if (!msg) { message.warning('请填写提交信息'); return; }
    if (stagedFiles.length === 0) { message.warning('暂存区为空，请先暂存要提交的文件'); return; }
    runOp('commit', async () => {
      const r = await api.commit(projectPath, msg);
      if (r.ok) setCommitMsg('');
      return r;
    }, '已提交');
  };

  const handlePull = () => runOp('pull', () => api.pull(projectPath), '拉取完成');
  const handlePush = () => runOp('push', () => api.push(projectPath), '推送完成');

  const stagedFiles = files.filter((f) => f.staged);
  const unstagedFiles = files.filter((f) => !f.staged);

  const columns = (section: 'staged' | 'unstaged') => [
    {
      title: '状态',
      width: 90,
      render: (_: unknown, f: WorkingFile) => (
        <Tag color={STATUS_TAG_COLORS[f.statusLabel] || 'default'} style={{ marginRight: 0 }}>{f.statusLabel}</Tag>
      ),
    },
    {
      title: '文件',
      ellipsis: true,
      render: (_: unknown, f: WorkingFile) => (
        <Tooltip title={f.renamedFrom ? `${f.renamedFrom} → ${f.file}` : f.file}>
          <Typography.Text style={{ fontSize: 12 }} ellipsis>
            {f.renamedFrom ? `${f.renamedFrom} → ${f.file}` : f.file}
          </Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: '改动',
      width: 120,
      render: (_: unknown, f: WorkingFile) => (
        <Space size={4}>
          {f.insertions != null && <span style={{ color: '#52c41a', fontSize: 12 }}><PlusOutlined />{f.insertions}</span>}
          {f.deletions != null && <span style={{ color: '#ff4d4f', fontSize: 12 }}><MinusOutlined />{f.deletions}</span>}
          {f.insertions == null && f.deletions == null && <span style={{ color: '#bfbfbf', fontSize: 12 }}>—</span>}
        </Space>
      ),
    },
    {
      title: '操作',
      width: 190,
      render: (_: unknown, f: WorkingFile) => (
        <Space size={4}>
          {section === 'staged' ? (
            <Button size="small" icon={<RollbackOutlined />} onClick={() => handleUnstage([f.file])}>取消暂存</Button>
          ) : (
            <Button size="small" icon={<PlusOutlined />} onClick={() => handleStage([f.file])}>暂存</Button>
          )}
          {section === 'unstaged' && (
            <Popconfirm
              title="撤销该文件的更改？"
              description={f.untracked ? '未跟踪文件将被删除，不可恢复' : '文件将恢复到暂存区版本'}
              okText="撤销"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={() => handleDiscard([f.file])}
            >
              <Button size="small" danger icon={<UndoOutlined />}>撤销</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const expandedRowRender = (f: WorkingFile, section: 'staged' | 'unstaged') => {
    const key = `${section === 'staged' ? 's' : 'w'}|${f.file}`;
    const diff = diffs[key];
    if (diff === undefined) {
      void loadDiff(f.file, section === 'staged');
      return <div style={{ padding: 12 }}><Spin size="small" /></div>;
    }
    return <FileDiffView diff={diff} />;
  };

  return (
    <Modal
      title={`${projectLabel} · 工作区`}
      open
      onCancel={onClose}
      width={920}
      footer={null}
    >
      {/* 顶部：分支与同步操作 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Space size={8}>
          <Tag color="blue">{branch || '—'}</Tag>
          {ahead !== null && ahead > 0 && <Tag color="geekblue">↑{ahead} 待推送</Tag>}
          {behind !== null && behind > 0 && <Tag color="orange">↓{behind} 待拉取</Tag>}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {files.length === 0 ? '工作区干净' : `${files.length} 个文件有改动`}
          </Typography.Text>
        </Space>
        <Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={reload} loading={loading}>刷新</Button>
          <Button size="small" icon={<CloudDownloadOutlined />} loading={busy === 'pull'} onClick={handlePull}>拉取</Button>
          <Button size="small" icon={<CloudUploadOutlined />} loading={busy === 'push'} onClick={handlePush}>推送</Button>
        </Space>
      </div>

      {/* 提交区（顶部）：需填写提交信息且暂存区非空才可提交 */}
      <div style={{ marginBottom: 16 }}>
        <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
          提交（{stagedFiles.length} 个已暂存文件）
        </Typography.Text>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="提交信息必填，如：feat: 新增用户导出功能"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onPressEnter={handleCommit}
            disabled={busy === 'commit' || stagedFiles.length === 0}
          />
          <Button
            type="primary"
            loading={busy === 'commit'}
            disabled={stagedFiles.length === 0 || !commitMsg.trim()}
            onClick={handleCommit}
          >
            提交
          </Button>
        </Space.Compact>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
          先暂存文件，填写提交信息后提交；提交后可点上方「推送」同步到远程
        </Typography.Text>
      </div>

      {loading && files.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
      ) : files.length === 0 ? (
        <Empty description={<Typography.Text type="secondary">工作区干净，没有改动</Typography.Text>} />
      ) : (
        <>
          {/* 已暂存 */}
          {stagedFiles.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Typography.Text strong>已暂存（{stagedFiles.length}）</Typography.Text>
                <Button size="small" type="link" onClick={() => handleUnstage(stagedFiles.map((f) => f.file))}>全部取消暂存</Button>
              </div>
              <Table
                size="small"
                rowKey="file"
                columns={columns('staged')}
                dataSource={stagedFiles}
                pagination={false}
                tableLayout="fixed"
                expandable={{
                  expandedRowRender: (f: WorkingFile) => expandedRowRender(f, 'staged'),
                  rowExpandable: (f: WorkingFile) => !f.untracked,
                }}
              />
            </div>
          )}

          {/* 未暂存 / 未跟踪 */}
          {unstagedFiles.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Typography.Text strong>未暂存（{unstagedFiles.length}）</Typography.Text>
                <Button size="small" type="link" onClick={() => handleStage(unstagedFiles.map((f) => f.file))}>全部暂存</Button>
              </div>
              <Table
                size="small"
                rowKey="file"
                columns={columns('unstaged')}
                dataSource={unstagedFiles}
                pagination={false}
                tableLayout="fixed"
                expandable={{
                  expandedRowRender: (f: WorkingFile) => expandedRowRender(f, 'unstaged'),
                }}
              />
            </div>
          )}
        </>
      )}
    </Modal>
  );
}


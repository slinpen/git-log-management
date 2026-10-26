import { useEffect, useState, useCallback } from 'react';
import { Modal, Segmented, Button, Space, Spin, message, Alert, Tag, List, Typography, Popconfirm, Tooltip } from 'antd';
import {
  CopyOutlined, DownloadOutlined, FilePdfOutlined, SaveOutlined,
  HistoryOutlined, DeleteOutlined, RobotOutlined,
} from '@ant-design/icons';
import type { Project, Commit, ReportType, ReportMode, ReportMeta } from '../types';
import { api } from '../api';
import { copyToClipboard } from '../utils';
import { renderTemplateReport, generateReportAI, REPORT_TYPE_INFO } from '../api/report';
import MarkdownView from './MarkdownView';

interface Props {
  project: Project;
  branch: string;
  type: ReportType;
  onClose: () => void;
}

const TYPE_TAG_COLORS: Record<ReportType, string> = {
  daily: 'blue',
  weekly: 'green',
  monthly: 'purple',
};

export default function ReportModal({ project, branch, type, onClose }: Props) {
  const [mode, setMode] = useState<ReportMode>('template');
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [markdown, setMarkdown] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  // 报告历史
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ReportMeta[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null);

  const info = REPORT_TYPE_INFO[type];

  // 加载提交数据
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api.getCommits({ path: project.path, since: info.since, branch, n: 1000 })
      .then((d) => {
        if (!mounted) return;
        if (d.ok) setCommits(d.commits);
        else setError(d.error || '加载失败');
      })
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [project.path, branch, info.since]);

  // 生成报告
  const generate = useCallback(async (m: ReportMode) => {
    if (commits.length === 0) return;
    setError('');
    setViewingHistoryId(null);
    if (m === 'template') {
      setMarkdown(renderTemplateReport(commits, type, branch));
    } else {
      setGenerating(true);
      setMarkdown('');
      try {
        await generateReportAI(commits, type, project.name, branch, (text) => setMarkdown(text));
      } catch (e: any) {
        const msg = e?.error?.message || e?.message || '生成失败';
        setError(msg);
        message.error('AI 报告生成失败');
      } finally {
        setGenerating(false);
      }
    }
  }, [commits, type, branch, project.name]);

  useEffect(() => {
    if (!loading && commits.length > 0) {
      generate(mode);
    }
  }, [loading, commits, mode, generate]);

  const handleCopy = () => {
    copyToClipboard(markdown, '已复制');
    message.success('已复制到剪贴板');
  };

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name}-${type}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---------- 报告保存与历史 ----------

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const d = await api.getReports(project.id);
      if (d.ok) setHistory(d.reports);
    } catch (e) {
      // 忽略
    } finally {
      setHistoryLoading(false);
    }
  }, [project.id]);

  const handleToggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next) {
      setViewingHistoryId(null);
      loadHistory();
    }
  };

  const handleSave = async () => {
    if (!markdown) return;
    setSaving(true);
    try {
      const d = await api.saveReport({
        projectId: project.id,
        type,
        mode,
        branch,
        commitCount: commits.length,
        content: markdown,
      });
      if (d.ok) {
        message.success('报告已保存，可在「历史」中回看');
        if (historyOpen) loadHistory();
      } else {
        message.error(d.error || '保存失败');
      }
    } catch (e) {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleViewReport = async (id: string) => {
    try {
      const d = await api.getReportDetail(id);
      if (d.ok && d.report) {
        setMarkdown(d.report.content);
        setViewingHistoryId(id);
        setError('');
      } else {
        message.error(d.error || '加载失败');
      }
    } catch (e) {
      message.error('加载失败');
    }
  };

  const handleDeleteReport = async (id: string) => {
    try {
      const d = await api.deleteReport(id);
      if (d.ok) {
        message.success('已删除');
        if (viewingHistoryId === id) setViewingHistoryId(null);
        loadHistory();
      } else {
        message.error(d.error || '删除失败');
      }
    } catch (e) {
      message.error('删除失败');
    }
  };

  const handleExportPdf = () => {
    if (!markdown) return;
    // 通过隐藏 iframe 渲染 HTML 后调用浏览器打印，用户可「另存为 PDF」
    const html = markdownToHtml(markdown);
    const title = `${project.name} · ${info.label}`;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      message.error('无法导出 PDF');
      document.body.removeChild(iframe);
      return;
    }
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
      <style>
        body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f1f1f; padding: 32px; line-height: 1.7; }
        h1 { font-size: 24px; border-bottom: 2px solid #1677ff; padding-bottom: 8px; }
        h2 { font-size: 18px; margin-top: 24px; color: #1677ff; }
        h3 { font-size: 15px; margin-top: 16px; }
        ul { padding-left: 22px; }
        li { margin-bottom: 4px; }
        code { background: #f5f5f5; padding: 2px 5px; border-radius: 3px; font-size: 12px; font-family: ui-monospace, Menlo, monospace; }
        strong { color: #000; }
      </style></head><body>${html}</body></html>`);
    doc.close();
    iframe.onload = () => {
      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => document.body.removeChild(iframe), 1000);
      }, 100);
    };
  };

  return (
    <Modal
      title={`${project.name} · ${info.label}`}
      open
      onCancel={onClose}
      width={760}
      footer={null}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Segmented
          value={mode}
          onChange={(v) => { setMode(v as ReportMode); setViewingHistoryId(null); }}
          options={[
            { label: '固定模板', value: 'template' },
            { label: 'AI 总结', value: 'ai' },
          ]}
        />
        <Space>
          <Button icon={<SaveOutlined />} loading={saving} onClick={handleSave} disabled={!markdown}>保存</Button>
          <Button icon={<HistoryOutlined />} onClick={handleToggleHistory}>
            {historyOpen ? '收起历史' : '历史'}
          </Button>
          <Button icon={<CopyOutlined />} onClick={handleCopy} disabled={!markdown}>复制</Button>
          <Button icon={<DownloadOutlined />} onClick={handleDownload} disabled={!markdown}>下载 Markdown</Button>
          <Button icon={<FilePdfOutlined />} onClick={handleExportPdf} disabled={!markdown}>导出 PDF</Button>
        </Space>
      </div>

      {historyOpen && (
        <div style={{ marginBottom: 16, padding: 12, background: '#fafafa', borderRadius: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>历史报告（点击回看）</Typography.Text>
          <List
            size="small"
            loading={historyLoading}
            dataSource={history}
            locale={{ emptyText: '暂无保存的报告' }}
            style={{ maxHeight: 200, overflowY: 'auto', marginTop: 4 }}
            renderItem={(r) => (
              <List.Item
                style={{
                  padding: '6px 4px',
                  cursor: 'pointer',
                  background: viewingHistoryId === r.id ? '#e6f4ff' : 'transparent',
                  borderRadius: 6,
                }}
                onClick={() => handleViewReport(r.id)}
                extra={
                  <Space size={4} onClick={(e) => e.stopPropagation()}>
                    {r.source === 'auto' && (
                      <Tooltip title="定时任务自动生成">
                        <Tag style={{ marginRight: 0 }}>定时</Tag>
                      </Tooltip>
                    )}
                    <Popconfirm title="确定删除这份报告？" okText="删除" cancelText="取消" onConfirm={() => handleDeleteReport(r.id)}>
                      <Button type="text" size="small" icon={<DeleteOutlined />} style={{ color: '#bfbfbf' }} />
                    </Popconfirm>
                  </Space>
                }
              >
                <Space size={8}>
                  <Tag color={TYPE_TAG_COLORS[r.type]} style={{ marginRight: 0 }}>
                    {REPORT_TYPE_INFO[r.type]?.label || r.type}
                  </Tag>
                  {r.mode === 'ai' && (
                    <Tooltip title="AI 生成">
                      <RobotOutlined style={{ color: '#1677ff', fontSize: 12 }} />
                    </Tooltip>
                  )}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {new Date(r.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.commitCount} 个提交</Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        </div>
      )}

      {viewingHistoryId && (
        <Alert
          type="info"
          showIcon
          message="正在查看历史报告，切换模式或重新生成会退出回看"
          style={{ marginBottom: 12 }}
        />
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin tip="读取提交数据…" /></div>
      ) : commits.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#8c8c8c' }}>该时间段暂无提交记录，无法生成报告</div>
      ) : (
        <div className="report-markdown" style={{ maxHeight: '65vh', overflow: 'auto' }}>
          {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} />}
          {generating && (
            <div style={{ marginBottom: 12 }}>
              <Spin size="small" /> AI 正在生成报告…
            </div>
          )}
          <MarkdownView markdown={markdown} />
        </div>
      )}
    </Modal>
  );
}

// Markdown → HTML（用于导出 PDF）
function markdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) { out.push('</ul>'); inList = false; }
  };

  for (const line of lines) {
    if (/^###\s/.test(line)) { closeList(); out.push(`<h3>${escapeHtml(line.replace(/^###\s/, ''))}</h3>`); }
    else if (/^##\s/.test(line)) { closeList(); out.push(`<h2>${escapeHtml(line.replace(/^##\s/, ''))}</h2>`); }
    else if (/^#\s/.test(line)) { closeList(); out.push(`<h1>${escapeHtml(line.replace(/^#\s/, ''))}</h1>`); }
    else if (/^[-*]\s/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${escapeHtml(line.replace(/^[-*]\s/, ''))}</li>`);
    }
    else if (line.trim() === '') { closeList(); }
    else { closeList(); out.push(`<p>${escapeHtml(line)}</p>`); }
  }
  closeList();
  return out.join('');
}

function escapeHtml(s: string): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

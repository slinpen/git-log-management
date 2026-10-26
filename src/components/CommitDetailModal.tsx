import { useEffect, useState } from 'react';
import { Modal, Spin, Tabs, Button, message, Alert } from 'antd';
import { CopyOutlined, RobotOutlined } from '@ant-design/icons';
import { api } from '../api';
import { copyToClipboard } from '../utils';
import { streamChat, hasCloud } from '../api/cloud';
import MarkdownView from './MarkdownView';

interface Props {
  projectPath: string;
  sha: string;
  onClose: () => void;
}

// 简单 diff 行高亮（+ 绿色 / - 红色 / @@ 蓝色）
// 导出供 WorkingChangesModal 复用
export function highlightDiff(diff: string): React.ReactNode {
  const lines = diff.split('\n');
  return lines.map((line, i) => {
    let color = '#000000';
    let bg = 'transparent';
    if (line.startsWith('+') && !line.startsWith('+++')) {
      color = '#52c41a';
      bg = '#f6ffed';
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      color = '#ff4d4f';
      bg = '#fff2f0';
    } else if (line.startsWith('@@')) {
      color = '#1677ff';
      bg = '#f0f5ff';
    } else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
      color = '#8c8c8c';
    }
    return (
      <div key={i} style={{ color, background: bg, whiteSpace: 'pre', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.5, minHeight: 18 }}>
        {line || ' '}
      </div>
    );
  });
}

export default function CommitDetailModal({ projectPath, sha, onClose }: Props) {
  const [detail, setDetail] = useState<string>('');
  const [diff, setDiff] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [diffLoading, setDiffLoading] = useState(false);
  // AI 解读
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api.getCommitDetail(projectPath, sha)
      .then((d) => {
        if (mounted) {
          if (d.ok && d.detail) setDetail(d.detail);
          else setDetail(d.error || '加载失败');
        }
      })
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [projectPath, sha]);

  const loadDiff = () => {
    if (diff) return Promise.resolve(diff);
    setDiffLoading(true);
    return api.getCommitDiff(projectPath, sha)
      .then((d) => {
        const text = d.ok && d.diff ? d.diff : (d.error || '加载失败');
        if (d.ok && d.diff) setDiff(text);
        return text;
      })
      .catch(() => '加载失败')
      .finally(() => setDiffLoading(false));
  };

  // AI 解读：基于提交信息 + diff 生成改动说明
  const runAiExplain = async () => {
    if (aiLoading) return;
    setAiError('');
    setAiText('');
    setAiLoading(true);
    try {
      const diffText = await loadDiff();
      if (!diffText || diffText === '加载失败') {
        setAiError('无法获取该提交的 diff，AI 解读需要 diff 数据');
        return;
      }
      // 截断超长 diff，避免超出模型上下文
      const MAX_DIFF = 12000;
      const truncated = diffText.length > MAX_DIFF;
      const diffPart = truncated
        ? diffText.slice(0, MAX_DIFF) + '\n…（diff 过长已截断）'
        : diffText;

      const systemPrompt = '你是一名资深软件工程师，擅长快速理解 Git 提交的改动内容并给出清晰的中文解读。你只依据提供的提交数据解读，不虚构不存在的内容。';
      const userPrompt =
        `请解读以下 Git 提交。\n\n【提交】${sha}\n\n【提交内容（git show 输出，含提交信息与 diff）】\n${diffPart}\n\n` +
        `【要求】\n用 Markdown 输出，包含以下小节：\n` +
        `1. ## 改动摘要：这个提交做了什么（一两句话）\n` +
        `2. ## 实现方式：关键改动的实现思路（改了哪些文件/函数，怎么改的）\n` +
        `3. ## 影响范围：这次改动会影响哪些功能或模块\n` +
        `4. ## 潜在风险：值得注意的边界情况或风险点（如无则说明无明显风险）\n` +
        `语言简洁专业，避免逐行罗列 diff。只输出解读正文。`;

      let full = '';
      for await (const chunk of streamChat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ])) {
        full += chunk;
        setAiText(full);
      }
    } catch (e: any) {
      const msg = e?.error?.message || e?.message || '生成失败';
      setAiError(msg);
      message.error('AI 解读生成失败');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <Modal
      title={`提交详情 · ${sha.slice(0, 7)}`}
      open
      onCancel={onClose}
      footer={null}
      width={820}
    >
      <Tabs
        size="small"
        items={[
          {
            key: 'stat',
            label: '提交信息',
            children: loading ? (
              <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
            ) : (
              <pre style={{ maxHeight: '65vh', overflow: 'auto', fontSize: 12, lineHeight: 1.6, background: '#fafafa', padding: 16, borderRadius: 8 }}>
                {detail}
              </pre>
            ),
          },
          {
            key: 'diff',
            label: '代码 Diff',
            children: diff ? (
              <div style={{ maxHeight: '65vh', overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 8 }}>
                {highlightDiff(diff)}
              </div>
            ) : diffLoading ? (
              <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <Button type="primary" onClick={loadDiff}>加载代码 Diff</Button>
              </div>
            ),
          },
          {
            key: 'ai',
            label: (
              <span>
                <RobotOutlined style={{ marginRight: 4, color: '#1677ff' }} />
                AI 解读
              </span>
            ),
            children: !hasCloud() ? (
              <Alert type="warning" message="AI 能力未就绪，无法使用解读功能" showIcon />
            ) : aiText ? (
              <div className="report-markdown" style={{ maxHeight: '65vh', overflow: 'auto' }}>
                {aiError && <Alert type="error" message={aiError} style={{ marginBottom: 12 }} />}
                <MarkdownView markdown={aiText} />
                {aiLoading && (
                  <div style={{ marginTop: 8, color: '#8c8c8c' }}>
                    <Spin size="small" /> AI 正在生成…
                  </div>
                )}
                {!aiLoading && (
                  <Button
                    size="small"
                    style={{ marginTop: 12 }}
                    icon={<RobotOutlined />}
                    onClick={runAiExplain}
                  >
                    重新解读
                  </Button>
                )}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>
                {aiError && <Alert type="error" message={aiError} style={{ marginBottom: 16 }} showIcon />}
                <Button
                  type="primary"
                  icon={<RobotOutlined />}
                  loading={aiLoading}
                  onClick={runAiExplain}
                >
                  {aiLoading ? 'AI 正在解读…' : '生成 AI 解读'}
                </Button>
                <div style={{ marginTop: 12, color: '#8c8c8c', fontSize: 12 }}>
                  基于提交信息与代码 diff，解读改动内容、影响范围与潜在风险
                </div>
              </div>
            ),
          },
        ]}
        tabBarExtraContent={
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => {
              const text = diff || detail;
              copyToClipboard(text, '已复制');
              message.success('已复制');
            }}
          >
            复制
          </Button>
        }
      />
    </Modal>
  );
}

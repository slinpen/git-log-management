import type { ReactNode } from 'react';

// 简单的 Markdown 渲染（支持标题、列表、行内代码、加粗）
// 由 ReportModal 抽出，供报告预览与 AI 解读共用
export default function MarkdownView({ markdown }: { markdown: string }) {
  if (!markdown) return <div style={{ color: '#8c8c8c' }}>生成中…</div>;

  const lines = markdown.split('\n');
  const elements: ReactNode[] = [];
  let listBuffer: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listBuffer.length) {
      elements.push(
        <ul key={`ul-${key++}`}>
          {listBuffer.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
        </ul>
      );
      listBuffer = [];
    }
  };

  for (const line of lines) {
    if (/^###\s/.test(line)) {
      flushList();
      elements.push(<h3 key={`h-${key++}`}>{line.replace(/^###\s/, '')}</h3>);
    } else if (/^##\s/.test(line)) {
      flushList();
      elements.push(<h2 key={`h-${key++}`}>{line.replace(/^##\s/, '')}</h2>);
    } else if (/^#\s/.test(line)) {
      flushList();
      elements.push(<h1 key={`h-${key++}`}>{line.replace(/^#\s/, '')}</h1>);
    } else if (/^[-*]\s/.test(line)) {
      listBuffer.push(line.replace(/^[-*]\s/, ''));
    } else if (line.trim() === '') {
      flushList();
    } else {
      flushList();
      elements.push(<p key={`p-${key++}`}>{renderInline(line)}</p>);
    }
  }
  flushList();

  return <div>{elements}</div>;
}

function renderInline(text: string): ReactNode {
  // 处理 `code` 和 **bold**
  const parts: ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith('`')) {
      parts.push(<code key={i++}>{token.slice(1, -1)}</code>);
    } else {
      parts.push(<strong key={i++}>{token.slice(2, -2)}</strong>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

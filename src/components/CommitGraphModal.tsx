import { useEffect, useState, useMemo } from 'react';
import { Modal, Spin, Typography, Button, Space, Tag, Empty } from 'antd';
import { NodeIndexOutlined, FileSearchOutlined } from '@ant-design/icons';
import type { GraphCommit } from '../types';
import { api } from '../api';
import { classify, TYPE_LABELS, TYPE_COLORS } from '../utils';

interface Props {
  projectPath: string;
  projectLabel: string;
  branch: string;
  onClose: () => void;
  onOpenDetail?: (sha: string) => void;
}

const LANE_W = 26; // 泳道横向间距
const ROW_H = 34; // 提交行高
const LEFT_PAD = 16;

// 文本宽度估算：ASCII 字符约为字号的 0.6 倍，CJK 等全角字符约等于字号
function estTextWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    w += ch.charCodeAt(0) > 255 ? fontSize : fontSize * 0.6;
  }
  return w;
}

// 泳道分配：lanes[i] 存「该泳道期待出现的下一个 sha」。
// 提交出现时占据期待它的泳道（无则找空位/新开）；其第一个 parent 接管该泳道，
// merge 的其余 parent 各找空位开新泳道——由此自然形成分支/合并的视觉结构。
function assignLanes(commits: GraphCommit[]): Map<string, number> {
  const lanes: ( string | null )[] = [];
  const laneOf = new Map<string, number>();
  for (const c of commits) {
    let lane = lanes.indexOf(c.sha);
    if (lane === -1) {
      lane = lanes.indexOf(null);
      if (lane === -1) { lanes.push(null); lane = lanes.length - 1; }
    }
    laneOf.set(c.sha, lane);
    const [p1, ...rest] = c.parents;
    lanes[lane] = p1 ?? null;
    for (const p of rest) {
      if (lanes.includes(p)) continue;
      let l = lanes.indexOf(null);
      if (l === -1) { lanes.push(null); l = lanes.length - 1; }
      lanes[l] = p;
    }
  }
  return laneOf;
}

function laneColor(lane: number): string {
  const hue = (lane * 47) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

export default function CommitGraphModal({ projectPath, projectLabel, branch, onClose, onOpenDetail }: Props) {
  const [commits, setCommits] = useState<GraphCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api.getGraph(projectPath, branch, 100)
      .then((d) => {
        if (!mounted) return;
        if (d.ok) {
          setCommits(d.commits);
          setError('');
        } else {
          setError(d.error || '加载失败');
        }
      })
      .catch(() => mounted && setError('加载失败'))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [projectPath, branch]);

  const layout = useMemo(() => {
    if (commits.length === 0) return null;
    const laneOf = assignLanes(commits);
    const posOf = new Map<string, number>();
    commits.forEach((c, i) => posOf.set(c.sha, i));
    let maxLane = 0;
    for (const l of laneOf.values()) maxLane = Math.max(maxLane, l);
    // 文本区紧跟实际泳道宽度，避免泳道与文字间大片空白
    const textX = LEFT_PAD + (maxLane + 1) * LANE_W + 24;
    // SVG 宽度按最长一行文本撑开（sha 列 + subject / 作者日期行），长文本横向滚动查看
    let textW = 0;
    for (const c of commits) {
      textW = Math.max(
        textW,
        66 + estTextWidth(c.subject, 12),
        12 + estTextWidth(`${c.author} · ${c.date}`, 10),
      );
    }
    return { laneOf, posOf, maxLane, textX, width: textX + textW + 20 };
  }, [commits]);

  const sel = commits.find((c) => c.sha === selected) || null;

  const laneX = (sha: string) => LEFT_PAD + (layout!.laneOf.get(sha) || 0) * LANE_W + LANE_W / 2;
  const rowY = (i: number) => i * ROW_H + ROW_H / 2;

  return (
    <Modal
      title={`${projectLabel} · 提交图谱${branch ? `（${branch}）` : ''}`}
      open
      onCancel={onClose}
      width={900}
      footer={null}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin tip="读取提交拓扑…" /></div>
      ) : error ? (
        <Empty description={<Typography.Text type="secondary">{error}</Typography.Text>} />
      ) : commits.length === 0 ? (
        <Empty description="暂无提交" />
      ) : layout && (
        <>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
            最近 {commits.length} 个提交的分支拓扑（点 = 提交，线 = 父提交；双环 = merge 提交）。点击查看详情。
          </Typography.Paragraph>

          <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, maxHeight: '58vh', overflow: 'auto' }}>
            <svg width={layout.width} height={commits.length * ROW_H} style={{ display: 'block' }}>
              {/* 选中行背景 */}
              {sel && layout.posOf.has(sel.sha) && (
                <rect
                  x={0} y={layout.posOf.get(sel.sha)! * ROW_H}
                  width={layout.width} height={ROW_H}
                  fill="#e6f4ff"
                />
              )}

              {/* 连线：commit → parent */}
              {commits.map((c, i) =>
                c.parents.map((p, pi) => {
                  const x1 = laneX(c.sha);
                  const y1 = rowY(i);
                  const pj = layout.posOf.get(p);
                  const key = `${c.sha}-${pi}`;
                  if (pj === undefined) {
                    // parent 超出展示范围或根提交：短渐隐线示意
                    return (
                      <line
                        key={key} x1={x1} y1={y1} x2={x1} y2={y1 + ROW_H / 2}
                        stroke={laneColor(layout.laneOf.get(c.sha) || 0)} strokeWidth={2}
                        strokeOpacity={0.25}
                      />
                    );
                  }
                  const x2 = laneX(p);
                  const y2 = rowY(pj);
                  const midY = (y1 + y2) / 2;
                  return (
                    <path
                      key={key}
                      d={x1 === x2
                        ? `M ${x1} ${y1} L ${x2} ${y2}`
                        : `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                      fill="none"
                      stroke={laneColor(layout.laneOf.get(c.sha) || 0)}
                      strokeWidth={2}
                      strokeOpacity={0.75}
                    />
                  );
                })
              )}

              {/* 提交点与文字 */}
              {commits.map((c, i) => {
                const x = laneX(c.sha);
                const y = rowY(i);
                const color = laneColor(layout.laneOf.get(c.sha) || 0);
                const isMerge = c.parents.length > 1;
                const t = classify(c.subject);
                return (
                  <g
                    key={c.sha}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelected(c.sha === selected ? null : c.sha)}
                  >
                    <title>{`${c.author} · ${c.date}\n${c.subject}`}</title>
                    {isMerge && (
                      <circle cx={x} cy={y} r={9} fill="#fff" stroke={color} strokeWidth={2} />
                    )}
                    <circle cx={x} cy={y} r={5} fill={color} stroke="#fff" strokeWidth={1.5} />
                    <text
                      x={layout.textX + 6} y={y - 2}
                      fontSize={12} fontFamily="ui-monospace, Menlo, monospace" fill="#595959"
                    >
                      {c.shortSha}
                    </text>
                    <text x={layout.textX + 66} y={y - 2} fontSize={12} fill="#262626">
                      {c.subject}
                    </text>
                    <text x={layout.textX + 6} y={y + 11} fontSize={10} fill="#8c8c8c">
                      {c.author} · {c.date}
                    </text>
                    {/* 行点击热区：覆盖文本区全宽 */}
                    <rect
                      x={layout.textX - 8} y={y - ROW_H / 2 + 2}
                      width={layout.width - layout.textX + 8} height={ROW_H - 4}
                      fill="transparent"
                    />
                    {/* 类型色块（小竖条） */}
                    <rect x={layout.textX - 4} y={y - 7} width={3} height={14} rx={1.5} fill={TYPE_COLORS[t]} />
                  </g>
                );
              })}
            </svg>
          </div>

          {/* 选中提交详情 */}
          {sel && (
            <div style={{ marginTop: 12, padding: 12, background: '#fafafa', borderRadius: 8 }}>
              <Space size={8} wrap>
                <Tag color={TYPE_COLORS[classify(sel.subject)]} style={{ marginRight: 0 }}>
                  {TYPE_LABELS[classify(sel.subject)]}
                </Tag>
                {sel.parents.length > 1 && <Tag color="purple" style={{ marginRight: 0 }}>merge</Tag>}
                <Typography.Text code>{sel.shortSha}</Typography.Text>
                <Typography.Text strong>{sel.subject}</Typography.Text>
              </Space>
              <div style={{ marginTop: 6, color: '#8c8c8c', fontSize: 12 }}>
                {sel.author} · {sel.date} · 父提交 {sel.parents.map((p) => p.slice(0, 7)).join(' + ') || '（根提交）'}
              </div>
              {onOpenDetail && (
                <Button
                  size="small"
                  icon={<FileSearchOutlined />}
                  style={{ marginTop: 8 }}
                  onClick={() => onOpenDetail(sel.sha)}
                >
                  查看提交详情
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

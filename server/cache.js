import { runGit } from './git.js';

// ---------- git 查询结果缓存 ----------
// 以「仓库 + 查询 ref 当前指向的 commit sha + 查询参数」为缓存键：
// - ref 指向变化（新提交 / 切换分支 / force push）立即失效；
// - 另加 TTL 兜底，因为 --since 等相对时间条件会随墙钟移动，
//   以及新建分支/tag 这类不改变 HEAD 的仓库变化。
// 每次命中前仍需一次 rev-parse（轻量），换来跳过昂贵的 git log 全量遍历。

const cache = new Map(); // key -> { sha, value, expiresAt }
const inflight = new Map(); // key -> { sha, promise }，并发同参数请求只执行一次
const MAX_ENTRIES = 300;
const DEFAULT_TTL = 30_000;

async function resolveRefSha(repoPath, ref) {
  const r = await runGit(repoPath, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return r.ok ? r.stdout.trim() : null;
}

export async function cachedGit(repoPath, ref, key, fn, { ttl = DEFAULT_TTL } = {}) {
  const normalizedRef = ref || 'HEAD';
  const sha = await resolveRefSha(repoPath, normalizedRef);
  // ref 不可解析（如空仓库），直接执行不缓存
  if (!sha) return fn();

  const fullKey = `${repoPath}|${normalizedRef}|${key}`;
  const now = Date.now();
  const hit = cache.get(fullKey);
  if (hit && hit.sha === sha && now < hit.expiresAt) {
    return hit.value;
  }

  // 同参数并发请求合并为一次执行
  const pending = inflight.get(fullKey);
  if (pending && pending.sha === sha) {
    return pending.promise;
  }

  const promise = Promise.resolve()
    .then(fn)
    .then((value) => {
      // 遵循本项目的 { ok } 响应约定：失败结果不缓存，避免临时错误被"粘住"
      if (value && value.ok === false) return value;
      if (cache.size >= MAX_ENTRIES) {
        // 淘汰最早写入的条目，避免无限增长
        cache.delete(cache.keys().next().value);
      }
      cache.set(fullKey, { sha, value, expiresAt: Date.now() + ttl });
      return value;
    })
    .finally(() => inflight.delete(fullKey));
  inflight.set(fullKey, { sha, promise });
  return promise;
}

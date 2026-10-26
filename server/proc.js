import { spawn } from 'child_process';
import net from 'net';
import { detectProjectConfig } from './parse.js';

// ---------- 项目进程管理器 ----------
// 每个项目一个子进程，记录 pid、状态、启动时间、访问地址、最近日志。

const registry = new Map(); // projectId -> { child, pid, status, startedAt, port, url, logs, ... }

function checkPort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    if (!port) return resolve(false);
    const socket = net.connect({ port, host }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

// 探测端口是否就绪：同时尝试 IPv4(127.0.0.1) 和 IPv6(::1)。
// Vite/Next 等在 macOS 上常把 localhost 解析为 IPv6 ::1，只探 IPv4 会误报未就绪。
async function checkPortAny(port) {
  if (!port) return false;
  // 先探 IPv4，再探 IPv6，任一连通即就绪
  const hosts = ['127.0.0.1', '::1'];
  for (const host of hosts) {
    if (await checkPort(port, host)) return true;
  }
  return false;
}

// 探测进程是否真正存活（kill(pid, 0)）
function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // EPERM 说明进程存在但无权限，也视为存活
  }
}

function shellCommand(command) {
  // 用 shell 执行以便支持 npm run dev 等复合命令
  const cmd = spawn(command, {
    shell: true,
    env: { ...process.env },
    cwd: undefined,
  });
  return cmd;
}

function parseCommand(command) {
  // 从命令中尝试提取 --port / -p 参数（备用探测）
  const m = command.match(/(?:--port|-p)\s+(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

export function getProcess(projectId) {
  return registry.get(projectId) || null;
}

export function getAllProcesses() {
  return Array.from(registry.entries()).map(([id, p]) => ({
    id,
    status: p.status,
    pid: p.pid,
    startedAt: p.startedAt,
    port: p.port,
    url: p.url,
  }));
}

async function startProject(projectId, config) {
  const { startCommand = '', port, cwd, env = {}, autoOpen = false } = config || {};
  if (!startCommand || !startCommand.trim()) {
    return { ok: false, error: '未配置启动命令，请先在项目配置中设置' };
  }

  // 若已有进程在运行/启动中，则拒绝重复启动
  const existing = registry.get(projectId);
  if (existing && existing.child && isAlive(existing.pid)) {
    return { ok: false, error: '项目已在运行中' };
  }
  if (existing) registry.delete(projectId);

  const envVars = { ...process.env };
  for (const [k, v] of Object.entries(env || {})) {
    if (k && v != null) envVars[k] = String(v);
  }

  const spawnOpts = {
    shell: true,
    env: envVars,
    stdio: ['ignore', 'pipe', 'pipe'],
    // 关键：detached 让子进程进入独立进程组，脱离服务进程生命周期，
    // 避免服务重启/信号误杀正在运行的项目进程。
    detached: true,
  };
  if (cwd) spawnOpts.cwd = cwd;

  let child;
  try {
    child = spawn(startCommand.trim(), spawnOpts);
  } catch (e) {
    return { ok: false, error: '启动失败：' + (e.message || e) };
  }

  // 端口解析优先级：config.port > 命令参数 > package.json 脚本/vite.config 自动解析
  let resolvedPort = port ? parseInt(port, 10) : parseCommand(startCommand);
  if (!resolvedPort) {
    try {
      const detected = detectProjectConfig(cwd || process.cwd());
      if (detected && detected.port) resolvedPort = detected.port;
    } catch (e) {
      // 解析失败则忽略，端口保持 null
    }
  }

  const entry = {
    child,
    pid: child.pid,
    status: 'starting',
    startedAt: Date.now(),
    port: resolvedPort,
    url: '',
    logs: [],
    autoOpen,
  };
  registry.set(projectId, entry);

  // 捕获日志
  const pushLog = (stream, kind) => {
    stream.on('data', (chunk) => {
      const text = chunk.toString();
      entry.logs.push(text);
      if (entry.logs.length > 200) entry.logs.shift();
      // 尝试从输出中提取访问地址（备用）
      if (!entry.url) {
        const m = text.match(/(https?:\/\/[\w.-]+(?::\d+)?(?:\/[^\s"']*)?)/);
        if (m) entry.url = m[1].replace(/[.,;)]+$/, '');
      }
    });
  };
  pushLog(child.stdout, 'stdout');
  pushLog(child.stderr, 'stderr');

  child.on('exit', (code, signal) => {
    const e = registry.get(projectId);
    if (e && e.pid === child.pid) {
      e.status = code === 0 ? 'stopped' : 'error';
      e.exitCode = code;
      e.exitSignal = signal;
      e.exitedAt = Date.now();
      if (code !== 0) {
        e.error = `进程退出，退出码 ${code}${signal ? `（信号 ${signal}）` : ''}`;
      }
      // 释放 child 引用，但保留 entry（含日志）供状态查询诊断
      e.child = null;
    }
  });
  child.on('error', (err) => {
    const e = registry.get(projectId);
    if (e) {
      e.status = 'error';
      e.error = err.message;
    }
  });

  return { ok: true, pid: child.pid };
}

async function stopProject(projectId) {
  const entry = registry.get(projectId);
  if (!entry || !entry.child) {
    registry.delete(projectId);
    return { ok: true };
  }
  const { child, pid } = entry;
  // 用 shell 组杀，确保子进程（如 vite 的子进程）一并结束
  return new Promise((resolve) => {
    if (child && !child.killed) {
      try {
        // 杀掉整个进程组
        process.kill(-pid, 'SIGTERM');
      } catch (e) {
        try { child.kill('SIGTERM'); } catch (_) {}
      }
    }
    setTimeout(() => {
      if (child && !child.killed) {
        try { process.kill(-pid, 'SIGKILL'); } catch (_) {
          try { child.kill('SIGKILL'); } catch (__) {}
        }
      }
      registry.delete(projectId);
      resolve({ ok: true });
    }, 500);
  });
}

async function getStatus(projectId, config) {
  const entry = registry.get(projectId);
  const port = config?.port ? parseInt(config.port, 10) : (entry?.port || null);
  const url = port ? `http://localhost:${port}` : (entry?.url || '');

  if (!entry) {
    // 无进程记录：探测端口，判断是否有进程在监听（可能是外部启动的）
    if (port) {
      const alive = await checkPortAny(port);
      return { ok: true, status: alive ? 'running' : 'stopped', port, url, pid: null };
    }
    return { ok: true, status: 'stopped', port: null, url: '' };
  }

  // 若 exit 事件已触发（child 已释放），直接返回退出状态 + 日志
  if (!entry.child && entry.exitCode !== undefined) {
    const failed = entry.exitCode !== 0;
    return {
      ok: true,
      status: failed ? 'error' : 'stopped',
      port: entry.port || null,
      url: '',
      pid: entry.pid,
      startedAt: entry.startedAt,
      error: entry.error,
      logs: entry.logs,
    };
  }

  // 进程是否真正存活（用 kill(pid,0) 探测）
  const alive = isAlive(entry.pid);

  // 进程已死但 exit 事件尚未触发 → 标记退出
  if (!alive) {
    const failed = entry.exitCode !== undefined && entry.exitCode !== 0;
    return {
      ok: true,
      status: failed ? 'error' : 'stopped',
      port,
      url: '',
      pid: entry.pid,
      startedAt: entry.startedAt,
      error: failed ? entry.error || `进程退出，退出码 ${entry.exitCode}` : undefined,
      logs: entry.logs,
    };
  }

  // 进程存活：探测端口是否就绪（IPv4 + IPv6 都试）
  let ready = false;
  if (port) ready = await checkPortAny(port);

  if (ready) {
    entry.status = 'running';
    if (!entry.url) entry.url = `http://localhost:${port}`;
    // 自动打开浏览器（仅一次）
    if (entry.autoOpen && !entry.opened) {
      entry.opened = true;
      const openUrl = `http://localhost:${port}`;
      spawn('open', [openUrl], { detached: true, stdio: 'ignore' }).unref();
    }
  }

  // 启动超时提示：进程存活但端口长时间未就绪
  const elapsed = Date.now() - entry.startedAt;
  const timeoutHint = !ready && elapsed > 60000
    ? `启动已超过 ${Math.round(elapsed / 1000)}s，端口 ${port} 仍未就绪，请检查启动日志`
    : undefined;

  return {
    ok: true,
    status: ready ? 'running' : 'starting',
    port,
    url: ready ? `http://localhost:${port}` : (entry.url || ''),
    pid: entry.pid,
    startedAt: entry.startedAt,
    logs: entry.logs,
    error: timeoutHint,
  };
}

export async function runProjectAction(projectId, action, config) {
  if (action === 'start') return startProject(projectId, config);
  if (action === 'stop') return stopProject(projectId);
  if (action === 'status') return getStatus(projectId, config);
  return { ok: false, error: '未知操作' };
}

export function shutdownAll() {
  for (const id of Array.from(registry.keys())) {
    stopProject(id);
  }
}

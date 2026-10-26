import fs from 'fs';
import path from 'path';

// ---------- 项目配置自动解析 ----------
// 从项目目录读取 package.json / 锁文件 / vite.config / .env 等，
// 自动推断启动命令、访问端口、包管理器、工作目录。

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    return '';
  }
}

function exists(p) {
  return fs.existsSync(p);
}

// 检测包管理器：优先锁文件，其次 package.json 的 packageManager 字段
function detectPackageManager(root) {
  if (exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (exists(path.join(root, 'bun.lockb'))) return 'bun';
  if (exists(path.join(root, 'package-lock.json'))) return 'npm';

  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg && pkg.packageManager) {
    const name = String(pkg.packageManager).split('@')[0];
    if (name === 'yarn') return 'yarn';
    if (name === 'pnpm') return 'pnpm';
    if (name === 'bun') return 'bun';
  }
  return 'npm';
}

// 从 scripts 中挑选最合适的启动脚本
function pickScript(scripts) {
  if (!scripts || typeof scripts !== 'object') return null;
  const keys = Object.keys(scripts);
  // 优先级：dev > start > serve > dev:*
  const priority = ['dev', 'start', 'serve', 'dev:server', 'dev:client'];
  for (const k of priority) {
    if (keys.includes(k)) return { name: k, command: scripts[k] };
  }
  // 兜底：找第一个包含 dev 或 start 的
  const devKey = keys.find(k => /dev|start|serve/i.test(k));
  if (devKey) return { name: devKey, command: scripts[devKey] };
  // 都没有则取第一个非空脚本
  if (keys.length > 0) return { name: keys[0], command: scripts[keys[0]] };
  return null;
}

// 从脚本命令里提取 --port / -p 参数
function portFromCommand(command) {
  if (!command) return null;
  const m = command.match(/(?:--port|-p)\s+(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// 从 vite.config.* 提取 server.port
function portFromViteConfig(root) {
  const candidates = [
    'vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs',
    'vite.config.cjs',
  ];
  for (const name of candidates) {
    const content = readText(path.join(root, name));
    if (!content) continue;
    // 匹配 server: { port: 5173 } 或 port: 5173
    const m = content.match(/port\s*:\s*(\d{2,5})/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

// 从 .env 文件提取 PORT
function portFromEnv(root) {
  const files = ['.env', '.env.local', '.env.development', '.env.development.local'];
  for (const name of files) {
    const content = readText(path.join(root, name));
    if (!content) continue;
    const m = content.match(/^PORT\s*=\s*(\d{2,5})/m);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

// 检测框架类型（用于提示和端口默认值）
function detectFramework(root) {
  const pkg = readJson(path.join(root, 'package.json'));
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  if (deps.vite) return 'vite';
  if (deps.next) return 'next';
  if (deps.nuxt) return 'nuxt';
  if (deps['@nestjs/core']) return 'nest';
  if (deps.express) return 'express';
  if (deps['react-scripts']) return 'cra';
  if (deps['@angular/cli']) return 'angular';
  return 'unknown';
}

function frameworkDefaultPort(framework) {
  const map = {
    vite: 5173,
    next: 3000,
    nuxt: 3000,
    nest: 3000,
    express: 3000,
    cra: 3000,
    angular: 4200,
  };
  return map[framework] || null;
}

// 主解析入口
export function detectProjectConfig(root) {
  const result = {
    packageManager: 'npm',
    script: null,
    startCommand: '',
    port: null,
    framework: 'unknown',
    packageJsonFound: false,
    note: '',
  };

  if (!exists(root)) return { ...result, note: '项目目录不存在' };

  const pkgPath = path.join(root, 'package.json');
  if (!exists(pkgPath)) {
    return { ...result, note: '未找到 package.json' };
  }
  result.packageJsonFound = true;

  const pkg = readJson(pkgPath);
  const pm = detectPackageManager(root);
  result.packageManager = pm;

  const script = pickScript(pkg?.scripts);
  if (script) {
    result.script = script;
    const runCmd = pm === 'npm' ? 'npm run' : pm === 'bun' ? 'bun run' : pm;
    result.startCommand = `${runCmd} ${script.name}`;
  } else {
    result.note = 'package.json 中未找到 dev/start 脚本';
  }

  // 端口推断优先级：脚本命令 > vite.config > .env > 框架默认
  const framework = detectFramework(root);
  result.framework = framework;
  let port = portFromCommand(script?.command);
  if (!port) port = portFromViteConfig(root);
  if (!port) port = portFromEnv(root);
  if (!port) port = frameworkDefaultPort(framework);
  result.port = port;

  return result;
}

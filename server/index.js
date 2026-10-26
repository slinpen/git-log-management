import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import routes from './routes.js';
import { DATA_DIR } from './store.js';
import { shutdownAll } from './proc.js';
import { startScheduler } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const PORT = process.env.PORT || 4399;

// ---------- 前端热更新（HMR，仅 dev 模式，配合 Vite 时由 Vite 处理） ----------
const hmrClients = new Set();
function isHmrEnabled() {
  return process.env.GLM_HMR !== '0' && process.env.NODE_ENV !== 'production' && !process.env.GLM_PROD;
}

const app = express();
app.use(express.json());

// API 路由
app.use('/api', routes);

// 生产模式：托管 Vite 构建产物
app.use(express.static(DIST_DIR));
app.get('*', (req, res, next) => {
  // 仅处理非 API 请求，SPA 回退到 index.html
  if (req.path.startsWith('/api')) return next();
  const indexPath = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    next();
  }
});

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`\n  🚀 Git 日志管理已启动`);
  console.log(`  📍 访问地址: http://localhost:${PORT}`);
  console.log(`  📁 数据目录: ${DATA_DIR}`);
  console.log('');
  // 定时日报生成（可在环境变量中配置时刻或关闭）
  startScheduler();
});

// 进程退出时清理子进程
process.on('exit', () => shutdownAll());
process.on('SIGINT', () => { shutdownAll(); process.exit(0); });
process.on('SIGTERM', () => { shutdownAll(); process.exit(0); });

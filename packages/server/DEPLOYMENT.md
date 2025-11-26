# MCP Proxy Server 部署指南

## 部署方式

支持三种部署方式：本地开发、Docker 部署、云服务部署。

## 1. 本地开发部署

### 前置要求

- Node.js 20+
- pnpm (推荐) 或 npm

### 步骤

1. **安装依赖**：
```bash
cd packages/server
pnpm install
```

2. **配置环境变量**：
```bash
cp .env.example .env
# 编辑 .env 文件，填入实际配置
```

3. **启动开发服务器**：
```bash
pnpm run dev
```

服务器将在 `http://localhost:3000` 启动。

### 开发模式特性

- 自动重新编译 TypeScript
- 自动重启服务器（文件变化时）
- 详细的日志输出

## 2. Docker 部署

### 前置要求

- Docker
- Docker Compose

### 步骤

1. **构建镜像**：
```bash
cd packages/server
docker build -t mcp-proxy-server .
```

2. **配置环境变量**：
创建 `.env` 文件：
```bash
PORT=3000
CORS_ORIGIN=http://localhost:5173,http://localhost:3000
MCP_SERVERS_JSON='[{"id":"basic","url":"https://mcp.qcc.com/basic/stream?key=xxxx"}]'
MCP_DEFAULT="basic"
LLM_CONFIG='{"openai":{"apiKey":"sk-xxx"}}'
```

3. **启动容器**：
```bash
docker-compose up -d
```

### Docker Compose 配置

```yaml
version: '3.8'

services:
  mcp-proxy:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - CORS_ORIGIN=${CORS_ORIGIN}
      - MCP_SERVERS_JSON=${MCP_SERVERS_JSON}
      - MCP_DEFAULT=${MCP_DEFAULT}
      - LLM_CONFIG=${LLM_CONFIG}
    env_file:
      - .env
    restart: unless-stopped
```

### 多实例部署

如果需要运行多个实例：

```yaml
services:
  mcp-proxy-1:
    build: .
    ports:
      - "3000:3000"
    # ... 环境变量配置

  mcp-proxy-2:
    build: .
    ports:
      - "3001:3000"
    # ... 环境变量配置
```

然后通过负载均衡器（如 Nginx）分发请求。

## 3. 云服务部署

### 前置要求

- 云服务平台账号（AWS、阿里云、腾讯云等）
- Node.js 运行环境

### 通用步骤

1. **上传代码**到云服务器

2. **配置环境变量**：
   - 在云平台的环境变量配置中设置：
     - `MCP_SERVERS_JSON`
     - `MCP_DEFAULT`
     - `LLM_CONFIG`
     - `CORS_ORIGIN`
     - `PORT`

3. **安装依赖并构建**：
```bash
pnpm install
pnpm run build:ts
```

4. **启动服务**：
```bash
pnpm start
```

### PM2 部署（推荐）

使用 PM2 管理进程：

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start dist/app.js --name mcp-proxy

# 设置开机自启
pm2 startup
pm2 save
```

### 多实例部署

#### 使用 PM2 集群模式

```bash
pm2 start dist/app.js -i 4 --name mcp-proxy
```

#### 使用负载均衡器

配置 Nginx 作为反向代理：

```nginx
upstream mcp_proxy {
    server localhost:3000;
    server localhost:3001;
    server localhost:3002;
    server localhost:3003;
}

server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://mcp_proxy;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 环境变量配置（云服务）

在云平台的环境变量配置中设置：

```bash
PORT=3000
CORS_ORIGIN=https://your-frontend-domain.com
MCP_SERVERS_JSON='[{"id":"basic","url":"https://mcp.qcc.com/basic/stream?key=xxxx"}]'
MCP_DEFAULT="basic"
LLM_CONFIG='{"openai":{"apiKey":"sk-xxx"},"deepseek":{"apiKey":"sk-xxx"}}'
LOG_LEVEL=info
```

## 健康检查

### 健康检查端点

可以添加健康检查端点（可选）：

```typescript
// 在 routes 中添加
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: Date.now() };
});
```

### 监控

建议监控以下指标：
- 服务器 CPU/内存使用率
- MCP 连接状态
- API 响应时间
- 错误率

## 安全建议

1. **环境变量安全**：
   - 不要在代码中硬编码敏感信息
   - 使用云平台的环境变量管理
   - 定期轮换 API Key

2. **CORS 配置**：
   - 生产环境不要使用 `*`
   - 只允许信任的域名

3. **HTTPS**：
   - 生产环境必须使用 HTTPS
   - 配置 SSL 证书

4. **限流**：
   - 考虑添加请求限流
   - 防止滥用

## 故障排查

### 服务无法启动

1. 检查端口是否被占用：
```bash
lsof -i :3000
```

2. 检查环境变量是否正确：
```bash
echo $MCP_SERVERS_JSON
echo $LLM_CONFIG
```

3. 查看日志：
```bash
# PM2
pm2 logs mcp-proxy

# Docker
docker-compose logs -f
```

### MCP 连接失败

1. 检查 MCP URL 是否正确
2. 检查 API Key 是否有效
3. 检查网络连接

### LLM API 调用失败

1. 检查 `LLM_CONFIG` 中的 `apiKey` 是否正确
2. 检查 provider 和 model 是否匹配
3. 检查 API 配额是否用完

## 性能优化

1. **连接池**：每个 MCP 服务器独立连接管理
2. **工具缓存**：按 MCP ID 隔离缓存，减少重复请求
3. **消息截断**：自动截断旧消息，避免内存泄漏
4. **负载均衡**：多实例部署，提高并发处理能力


<div align="center">
  <h1>MapKit Token Fetcher</h1>
</div>

因业务需要在服务端调用 [MapKit Server API](https://developer.apple.com/documentation/AppleMapsServerAPI)，但此 API 需要创建 Token 后才能调用（并且 Token 过期时间很短）。由于身处中国大陆地区，无法直接通过 API 的方式创建/刷新 Token，需要频繁地在 [苹果开发者后台](https://developer.apple.com/account/resources/services/maps-tokens) 手动创建。手动创建的 Token 7 天过期，每一个星期都要创建一个并同步到服务端，十分繁琐。

`mapkit-token-fetcher` 应运而生，基于 Playwright，自动化完成 Token 创建与刷新。

## 功能特性

- 🐳 支持 Docker 部署（内置 Chromium）
- 🖥️ 支持 headed/headless 两种浏览器模式
- 📄 通过配置文件管理账号密码
- 🔐 自动处理两步验证和信任浏览器
- 📤 Token 直接输出到 stdout 或文件
- 🌐 **HTTP Server 模式** - 支持远程验证码输入
- 📱 **企业微信通知** - 遇到两步验证时自动发送通知

## 快速开始

### 方式一：Docker 部署（推荐）

#### 1. 克隆仓库

```bash
git clone https://github.com/GHkmmm/mapkit-token-fetcher.git
cd mapkit-token-fetcher
```

#### 2. 准备配置文件

```bash
cp config.yaml.example config.yaml
```

然后编辑 `config.yaml`，填写您的 Apple Developer 账户凭证：

```yaml
# config.yaml
apple:
  username: your-apple-id@example.com
  password: your-password
```

> ⚠️ **安全提示**: `config.yaml` 包含敏感凭证，该文件已自动添加到 `.gitignore`，请勿手动上传或分享。

#### 3. 构建镜像

```bash
docker-compose build
```

#### 4. 运行

> ⚠️ **重要**：如需输入两步验证码，必须使用交互式终端！

**首次运行（需要两步验证）：**

```bash
docker-compose run --rm mapkit-token-fetcher refresh --headless
```

**将 Token 输出到文件：**

```bash
docker-compose run --rm mapkit-token-fetcher refresh --headless -o /app/data/token.txt
```

> **提示**：`-o` 参数指定的路径是容器内路径。由于 `/app/data` 目录已挂载到宿主机的 `./data` 目录，Token 文件会自动同步到宿主机。

**查看帮助：**

```bash
docker-compose run --rm mapkit-token-fetcher --help
```

> **注意**：首次使用需要完成两步验证，生成 `.auth-state.json` 文件后会自动缓存到 `data` 目录。后续运行会自动使用缓存的登录状态，跳过两步验证。

---

### 方式二：本地安装

#### 1. 克隆仓库

```bash
git clone https://github.com/GHkmmm/mapkit-token-fetcher.git
cd mapkit-token-fetcher
```

#### 2. 安装依赖

```bash
# 安装依赖
npm install

# 安装 Playwright 浏览器
npx playwright install chromium

# 构建项目
npm run build
```

#### 3. 配置

```bash
cp config.yaml.example config.yaml
```

然后编辑 `config.yaml`，填写您的 Apple Developer 账户凭证：

```yaml
# config.yaml
apple:
  username: your-apple-id@example.com
  password: your-password
```

> ⚠️ **安全提示**: `config.yaml` 包含敏感凭证，该文件已自动添加到 `.gitignore`，请勿手动上传或分享。

#### 4. 使用方法

**刷新（创建新）Token：**

```bash
npm run dev -- refresh
```

**将 Token 输出到文件：**

```bash
npm run dev -- refresh -o ./token.txt
npm run dev -- refresh --out ./new-token.txt
```

---

## 🌐 Server 模式（远程验证码输入）

Server 模式适用于服务器定时任务场景。当遇到两步验证时，会通过企业微信机器人发送通知，您可以在手机上点击链接输入验证码，无需登录服务器。

### 配置

在 `config.yaml` 中添加以下配置：

```yaml
apple:
  username: your-apple-id@example.com
  password: your-password

# 通知配置
notification:
  wecom:
    enabled: true
    webhook_url: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=your-key

# Server 配置
server:
  port: 3010
  # base_url 用于生成验证码页面链接（发送到企业微信的链接）
  # 如果不填写，则使用内置页面 http://localhost:port
  base_url: https://your-domain.com/tools/mapkit-token-fetcher
```

### 启动 Server

```bash
# 本地开发
npm run dev -- serve

# Docker
docker-compose run -d -p 3010:3010 mapkit-token-fetcher serve --headless -o /app/data/token.txt
```

### 触发刷新任务

```bash
curl -X POST http://localhost:3010/api/refresh
```

返回：
```json
{
  "success": true,
  "taskId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending"
}
```

### 工作流程

1. 服务器配置定时任务，每 5 天调用 `POST /api/refresh`
2. 任务执行时，如遇两步验证，自动发送企业微信通知
3. 您在企业微信点击卡片，进入验证码输入页面
4. 输入 6 位验证码并提交
5. 任务继续执行，完成后再次发送完成通知

### API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/refresh` | POST | 触发刷新任务 |
| `/api/task/:taskId` | GET | 获取任务状态 |
| `/api/task/:taskId/verify` | POST | 提交验证码 `{"code":"123456"}` |
| `/api/task/:taskId/cancel` | POST | 取消任务 |
| `/api/task/:taskId/retry` | POST | 重新发起任务（超时后使用）|
| `/refresh?taskId=xxx` | GET | 验证码输入页面 |

### 验证码超时

验证码输入有 **5 分钟** 的时效。超时后任务标记为 `timeout` 并释放浏览器，需要重新发起。

---

## 命令行选项

```
Commands:
  open [options]     打开浏览器并跳转到 Apple Developer 后台
  get [options]      登录并获取现有 MapKit Token
  refresh [options]  登录并创建新的 MapKit Token
  serve [options]    启动 HTTP Server 模式

get/refresh 选项:
  -o, --out <path>           将 Token 输出到指定文件路径
  --headless                 使用无头模式（默认: false）
  --no-auth-cache            不使用缓存的登录状态（强制重新登录）

serve 选项:
  -p, --port <port>          服务端口（默认: 3000）
  -o, --out <path>           将 Token 输出到指定文件路径
  --headless                 使用无头模式（默认: true）
  --no-auth-cache            不使用缓存的登录状态（强制重新登录）
```



## 自动任务的超时与资源回收

`get`、`refresh` 和 Server 任务遇到错误后会退出并关闭浏览器，不再等待手动操作。需要人工浏览时使用 `open`；关闭窗口或按 Ctrl+C 退出。

- 每个自动任务总时限为 15 分钟，包含最多 5 分钟的验证码等待；导航上限为 60 秒，普通元素操作上限为 15 秒。
- 取消任务、验证码超时、任务超时或停止服务都会触发浏览器回收。取消响应表示已请求取消，实际回收期间仍保留任务占位。
- 单个 Server 实例同时只运行一个刷新任务。运行期间重复调用 `/api/refresh` 会返回同一 `taskId`，不会再启动浏览器。重试也需要等待旧浏览器释放。
- 浏览器关闭超过 10 秒或关闭失败时，实例停止接受刷新与重试，返回 HTTP 503 和 `BROWSER_RECOVERY_REQUIRED`。请检查诊断并重启该工具所属容器；不应通过继续重试来绕过此状态。
- 企业微信请求最多等待 10 秒。工具不执行内部自动重试，外部调度和重试间隔保持由调用方管理。

### Apple 协议或访问受限

检测到账号持有人需要接受新协议时，任务以 `AGREEMENT_REQUIRED` 失败并释放浏览器；不会自动同意协议。请账号持有人登录 Apple Developer 后台处理，再重新发起任务。其他会员资源访问受限以 `ACCESS_UNAVAILABLE` 报告。

页面操作失败时，在 `DATA_DIR/diagnostics` 下保存按时间区分的截图、页面 URL、frame URL 和脱敏结构；未设置 `DATA_DIR` 时使用当前目录。保留最近 20 次诊断。截图遮盖表单和 Token 单元格，结构仅保留必要的控件标签和可见错误提示，不保存输入值或脚本；包含 iframe 诊断，账号、长 Token 和六位验证码脱敏，URL 不保存查询参数。诊断失败不影响浏览器关闭。这些文件用于识别页面改版、协议弹窗和加载失败，不应公开发布。

### 过期 Token 清理

登录并确认列表可访问后，先尝试清理过期 Token，再获取或创建 Token。规则是清理所有来源的已过期记录，保留仍有效的记录，不限制有效 Token 的数量。

- 支持按表头识别标准 HTML / ARIA 表格，或使用 `data-field` / `data-column` 明确标识字段的行，并遍历下一页。
- 获取最新记录时优先比较创建时间；创建日期相同且没有具体时刻时，用 JWT 的 `iat` 区分。无法确认时明确报错，避免任意返回同日的旧 Token。JWT 内容仅用于排序，不作为签名或权限验证。
- 优先读取 `time[datetime]` 等机器可读字段；文本支持 `MM/DD/YY`、`MM/DD/YYYY` 和 ISO 日期/带时区时间。不能确定到期时间的记录保留并产生警告。
- 只有到期日期、没有具体时刻时，按 `Asia/Shanghai` 日期判断；当天到期的记录保留到次日再清理。
- 点击撤销后必须确认记录消失才计为成功。同一失败记录不会在本次任务中反复重试；清理最多执行 2 分钟，剩余记录会在后续正常任务中再次处理。
- 无法识别列表、分页失败或撤销失败会产生明确警告，不会显示成“没有发现过期 Token”。

新 Token 获取成功且指定的输出文件写入成功后，任务才进入 `completed`。清理失败时仍交付 Token，并在网页、CLI 和企业微信通知中显示警告。输出文件使用临时文件加重命名方式更新，写入失败报告 `TOKEN_OUTPUT_FAILED`，不会报告成功。

查询任务仍使用原有接口，`result.token` / `result.error` 保持兼容；新增可选的 `result.errorCode`、`result.warnings`、`result.cleanup`。清理摘要包含 `scanned`、`expired`、`revoked`、`failed`、`skipped` 和 `complete`。`deadlineAt` 表示任务总截止时间，`expiresAt` 仍用于验证码倒计时。

### 升级与验证

升级后重启工具所属容器，清除旧版本遗留的浏览器。人工确认协议已处理后，执行一次刷新，检查输出 Token、清理摘要、后台剩余记录及浏览器进程是否退出。页面改版导致的未知结构需要依据诊断调整定位器；不可据此假定没有过期记录。

```bash
npm run typecheck
npm run build
npm test
npm run test:browser
```

测试使用本地页面和模拟通知，不访问真实苹果账号或撤销真实 Token。浏览器测试包含连续 20 次失败后的进程回收检查。需要已安装 Playwright 对应的 Chromium；也可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定可执行文件。macOS 测试在默认浏览器缺失时尝试系统 Google Chrome。容器测试仍应在部署环境执行，以检查该环境的进程和内存行为。


需要复现容器内回归时，可使用独立测试镜像（不复制账号配置或登录状态）：

```bash
docker build -f Dockerfile.test -t mapkit-token-fetcher-test .
docker run --rm --init --ipc=host mapkit-token-fetcher-test
```


### 本机真实验收（macOS）

完成协议确认并在本地 `config.yaml` 填好账号后，可运行：

```bash
node --import tsx scripts/live-acceptance.ts
```

该脚本使用系统 Google Chrome，在 `127.0.0.1:3011` 提供验证码页面。它会真实清理过期 Token 并创建一个新 Token；不发送企业微信通知。登录状态、脱敏诊断和输出 Token 单独存放在被 Git 忽略的 `data/live-acceptance` 中，不覆盖原来的登录缓存或业务输出文件。请勿在同一账号有其他刷新任务运行时同时验收。

`--get` 仅执行正常的获取/清理流程，不创建 Token。`scripts/inspect-live.ts` 使用验收登录状态只读检查列表；如果创建已经成功、但读取结果失败，可用 `--recover-description=<本次唯一描述>` 精确取回同一记录并写入验收输出文件，避免重复创建。两种脚本均不在控制台打印密码、Cookie 或 Token 内容。

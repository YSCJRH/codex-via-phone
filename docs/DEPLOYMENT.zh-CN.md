# 部署说明

[中文](DEPLOYMENT.zh-CN.md) | [English](DEPLOYMENT.md)

这份文档面向第一次部署的人。目标是把整套服务跑起来，先守住默认安全边界，再在你明确选择时扩展访问范围。

## 目标结果

部署完成后，你应该能够：

- 在 Windows 电脑上启动本地 Codex 控制栈
- 在 `http://127.0.0.1:3001` 打开本地面板
- 在新手机第一次登录时，通过桌面工具完成审批
- 在你明确选择时，启用 `tailnet-private` 或 `public-funnel`

## 支持的访问模式

- `localhost`
  默认模式。应用绑定到 `127.0.0.1`，nginx 也只在本机工作，不对外发布。
- `tailnet-private`
  推荐的远程模式。通过 Tailscale Serve 把仅 tailnet 可访问的 HTTPS 路由转发到本机 nginx。
- `public-funnel`
  危险模式。通过 Tailscale Funnel 把公网 HTTPS 路由转发到本机 nginx。必须显式加 `-Yes` 才能开启。

`enable-mobile-codex-remote.ps1` 和 `*tailnet-direct*.ps1` 现在只保留为迁移提示脚本，不属于受支持的安装路径。

## 环境要求

- Windows 10 / 11
- Python 3.11+
- Node.js 22 LTS
- Git
- nginx for Windows
- 如果你要启用 `tailnet-private` 或 `public-funnel`，还需要 Tailscale

## 推荐目录结构

```text
codex-via-phone/
├── deploy/
├── docs/
├── scripts/
├── upstream-overrides/
├── vendor/
│   └── claudecodeui-1.25.2/
├── mobile_codex_control.py
└── requirements.txt
```

## 第 1 步：准备上游源码

下载上游 `siteboon/claudecodeui` `v1.25.2`，放到：

```text
vendor/claudecodeui-1.25.2
```

## 第 2 步：应用覆盖层

在仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/apply-upstream-overrides.ps1
```

如果你想先验证公开覆盖层是否完整，可以运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-test-override-flow.ps1 -UpstreamZip <你的上游 zip 路径>
```

## 第 3 步：安装 Node 依赖

```powershell
cd vendor/claudecodeui-1.25.2
npm install
cd ..\..
```

## 第 4 步：可选的 Python 打包依赖

如果你只是直接运行桌面工具，通常不需要额外 Python 包。

如果你要把桌面工具打包成 `.exe`：

```powershell
pip install -r requirements.txt
```

## 第 5 步：检查本地环境

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-mobile-codex-runtime.ps1
```

重点确认：

- 上游目录存在
- Node 可用
- nginx 可用
- 如果你要远程让手机访问，Tailscale 可用

## 第 6 步：启动本地服务栈

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-mobile-codex-stack.ps1
```

默认会保持在 `localhost` 模式：

- 应用服务：`127.0.0.1:3001`
- nginx 代理：`127.0.0.1:8080`

## 第 7 步：启动桌面控制工具

```powershell
python mobile_codex_control.py
```

或者：

```powershell
scripts\launch-mobile-codex-control.cmd
```

你应该能看到：

- PC 应用服务状态
- nginx 状态
- Tailscale 状态
- 当前访问模式
- 待审批设备
- 已批准设备白名单

## 第 8 步：完成首次注册

在电脑浏览器打开：

```text
http://127.0.0.1:3001
```

这是单用户部署。第一个注册账号会成为这套系统的主账号。

## 第 9 步：选择访问模式

### 方案 A：`localhost`

这是推荐的第一个里程碑：

- 确认可以登录
- 确认项目列表正常
- 确认发送消息正常

### 方案 B：`tailnet-private`

这是推荐的远程模式。

先确保：

- 电脑已经登录 Tailscale
- 手机也登录到同一个 tailnet
- 本机 nginx 健康正常

然后执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/enable-mobile-codex-tailnet-private.ps1
```

预期结果：

- 桌面工具显示模式为 `tailnet-private`
- Tailscale 显示的是仅 tailnet 可访问的 HTTPS 路由
- Funnel 保持关闭

### 方案 C：`public-funnel`

这是危险模式，会创建公网入口。

只有在你明确需要公网 HTTPS 暴露并理解边界扩大时，才执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/publish-mobile-codex-public-funnel.ps1 -Yes
```

预期结果：

- 桌面工具显示模式为 `public-funnel`
- 输出里明确出现 `PUBLIC INTERNET ENTRYPOINT`
- 应用本身仍然在本机 nginx 后面，而不是直接公网裸露

## 第 10 步：首次设备审批

当新设备第一次登录时：

1. 手机端会显示等待审批
2. 桌面工具会出现一条待审批设备
3. 你核对设备信息
4. 你在电脑上批准
5. 手机继续完成登录流程

不要跳过这一步。它属于默认信任边界的一部分。

## 可选环境变量

- `MOBILE_CODEX_UPSTREAM_DIR`
  自定义上游 `claudecodeui` 目录
- `MOBILE_CODEX_NODE`
  自定义 Node 可执行文件路径
- `MOBILE_CODEX_NGINX`
  自定义 nginx 可执行文件路径
- `MOBILE_CODEX_TAILSCALE`
  自定义 Tailscale 可执行文件路径
- `MOBILE_CODEX_ASCII_ALIAS`
  自定义 ASCII alias 路径，用于处理某些 Windows 路径兼容问题

## 最省时间的排障顺序

1. 先跑 `scripts/check-mobile-codex-runtime.ps1`
2. 确认电脑浏览器能打开 `http://127.0.0.1:3001`
3. 确认桌面工具里应用和 nginx 都健康
4. 再测试手机访问
5. 最后再测试封装 App 或 WebView 壳

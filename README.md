# codex-via-phone

[中文](README.md) | [English](README.en.md)

`codex-via-phone` 是一个自托管辅助层，用来让你通过手机访问、查看、续接、审批和同步运行在 Windows 电脑上的本地 Codex 会话。

它服务的是一条很明确的使用路径：

- Codex 运行在你自己的 Windows 电脑上
- 你希望用手机查看项目、会话和消息
- 你希望从手机发送下一条提示词，让电脑继续本地 Codex 会话
- 你希望每台新设备第一次登录时，都先经过桌面端审批

## 你可以用它做什么

- 在手机浏览器里查看 Codex 项目和会话
- 从手机续接一个已有的 Codex 会话
- 在桌面控制工具里批准新手机的首次登录
- 在 Windows 桌面控制工具里查看本地服务状态、访问模式和设备审批状态

## 访问模式

- `localhost`
  默认模式，也是推荐起点。应用保持绑定在 `127.0.0.1`，先把本机链路验证好。
- `tailnet-private`
  推荐的远程模式。Tailscale Serve 提供仅 tailnet 可访问的 HTTPS 入口，请求先到本机 nginx，应用本体仍保持 localhost-only。
- `public-funnel`
  危险模式。Tailscale Funnel 提供公网 HTTPS 入口，请求先到本机 nginx。它必须显式开启，绝不能成为默认值。

## 推荐架构

```text
手机浏览器
  -> 具名访问模式
  -> 本机 nginx
  -> 应用了本仓覆盖层的本地 claudecodeui
  -> 电脑上的本地 Codex 会话
```

## 安全默认模型

- 让应用保持绑定在 `127.0.0.1`
- 在应用前面放 nginx
- 默认从 `localhost` 开始
- 需要远程访问时，优先使用 `tailnet-private`
- 每台新设备第一次登录都必须经过桌面审批
- 审批轮询固定走 cookie-backed `/api/auth/device-approval`，不在 URL 中暴露 request token
- 已批准设备会绑定浏览器持有的设备密钥，而不是只依赖 localStorage UUID
- 旧的 legacy trusted device 需要重新审批一次，才能补齐设备密钥
- 浏览器会话默认走同源 cookie，不再要求把 bearer token 写进 localStorage
- 浏览器 Origin 白名单以 `.runtime/mode-config.json` 为准
- 默认保持 hardened mode 开启
- 把 `.runtime/mode-config.json` 视为边界配置源

## 快速开始

1. 获取上游 `siteboon/claudecodeui` `v1.25.2`
2. 放到 `vendor/claudecodeui-1.25.2`
3. 先预览安装计划：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-mobile-codex.ps1 -Mode localhost -DryRun -EmitPlanJson
```

4. 再执行真实的 localhost 安装：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-mobile-codex.ps1 -Mode localhost -EmitRedactedStatus
```

5. 如果你需要 Windows 控制面板，再启动桌面工具：

```powershell
python mobile_codex_control.py
```

6. 在桌面浏览器打开本地页面：

```text
http://127.0.0.1:3001
```

7. 只有在你明确需要手机接入时，再选择访问模式：

```powershell
# 推荐：tailnet-private HTTPS 模式
powershell -ExecutionPolicy Bypass -File scripts/install-mobile-codex.ps1 -Mode tailnet-private -EmitRedactedStatus

# 危险：public-funnel 公网 HTTPS 入口
powershell -ExecutionPolicy Bypass -File scripts/install-mobile-codex.ps1 -Mode public-funnel -Yes -EmitRedactedStatus
```

8. 用手机首次登录，并在桌面端审批该设备。

## 只读运维脚本

- `scripts/status-mobile-codex.ps1`
  只读的脱敏状态输出
- `scripts/doctor-mobile-codex.ps1`
  只读的环境与边界体检
- `scripts/export-mobile-codex-support-bundle.ps1`
  默认脱敏的支持包导出
- `scripts/export-mobile-codex-audit.ps1`
  兼容包装脚本，默认仍导出同样的脱敏支持包

## 文档

- 部署说明：[docs/DEPLOYMENT.zh-CN.md](docs/DEPLOYMENT.zh-CN.md)
- 架构说明：[docs/ARCHITECTURE.zh-CN.md](docs/ARCHITECTURE.zh-CN.md)
- 安全策略：[SECURITY.zh-CN.md](SECURITY.zh-CN.md)
- 贡献说明：[CONTRIBUTING.md](CONTRIBUTING.md)
- 私有本地内容排除清单：[docs/PRIVATE_LOCAL_ONLY.zh-CN.md](docs/PRIVATE_LOCAL_ONLY.zh-CN.md)
- 开源发布检查清单：[docs/OPEN_SOURCE_RELEASE_CHECKLIST.zh-CN.md](docs/OPEN_SOURCE_RELEASE_CHECKLIST.zh-CN.md)
- 供 Codex 等编程助手读取的入口文档：[AGENTS.md](AGENTS.md)

如果你准备发布自己的 fork，请先阅读 `docs/PRIVATE_LOCAL_ONLY.zh-CN.md` 和 `docs/OPEN_SOURCE_RELEASE_CHECKLIST.zh-CN.md`，再组装 staging 发布副本。

公开发布应来自脱敏后的 staging 副本，并通过 `Open Source Gate` 工作流和 `scripts/check-open-source-tree.ps1` 检查。

## 致谢

本项目建立在上游 [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) 的基础上，定位是一层更聚焦的辅助层，重点服务于手机访问、可信设备审批，以及本地 Codex 工作流的更安全接入。

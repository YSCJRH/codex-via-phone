# codex-via-phone

[中文](README.md) | [English](README.en.md)

`codex-via-phone` 是一个自托管辅助层，用来把你 Windows 电脑上本地运行的 Codex 会话，变成可以在手机上查看、续接、审批和同步的私有入口。

它面向的是一条很明确的使用路径：

- Codex 运行在你自己的 Windows 电脑上
- 你想用手机查看项目、线程和消息
- 你想从手机发下一条提示词，让电脑继续跑本地 Codex 会话
- 你希望新手机第一次登录时，必须经过桌面端审批

## 你可以用它做什么

- 在手机浏览器里查看 Codex 项目和线程
- 在手机上续接一个已经存在的 Codex 会话
- 在桌面控制工具里批准新手机的首次登录
- 在 Windows 桌面控制工具里查看本地服务状态、访问模式和设备审批状态

## 访问模式

- `localhost`
  默认模式，也是推荐起点。应用只绑定到 `127.0.0.1`，先在本机把流程跑通。
- `tailnet-private`
  推荐的远程模式。通过 Tailscale Serve 提供仅 tailnet 可访问的 HTTPS 入口，流量先到本机 nginx，应用本身仍保持 localhost-only。
- `public-funnel`
  危险模式。通过 Tailscale Funnel 提供公网 HTTPS 入口，流量先到本机 nginx。这个模式必须显式开启，绝不能当默认值。

## 推荐架构

```text
手机浏览器
  -> Tailscale HTTPS 入口
  -> 本机 nginx
  -> 已应用本仓覆盖层的本地 claudecodeui
  -> 电脑上的本地 Codex 会话
```

## 安全默认模型

- 让应用保持绑定在 `127.0.0.1`
- 在应用前面放 nginx
- 默认从 `localhost` 开始
- 如需远程访问，优先使用 `tailnet-private`
- 每台新设备第一次登录都要桌面审批
- 默认保持 hardened mode 开启

## 快速开始

1. 获取上游 `siteboon/claudecodeui` `v1.25.2`
2. 放到 `vendor/claudecodeui-1.25.2`
3. 应用本仓的覆盖层：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/apply-upstream-overrides.ps1
```

4. 安装上游依赖：

```powershell
cd vendor/claudecodeui-1.25.2
npm install
cd ..\..
```

5. 启动本地服务栈：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-mobile-codex-stack.ps1
```

6. 启动桌面控制工具：

```powershell
python mobile_codex_control.py
```

7. 在电脑浏览器打开本地页面：

```text
http://127.0.0.1:3001
```

8. 只有在你明确要让手机接入时，再选择一种访问模式：

```powershell
# 推荐：tailnet-private HTTPS 模式
powershell -ExecutionPolicy Bypass -File scripts/enable-mobile-codex-tailnet-private.ps1

# 危险：public-funnel 公网 HTTPS 入口
powershell -ExecutionPolicy Bypass -File scripts/publish-mobile-codex-public-funnel.ps1 -Yes
```

9. 用手机首次登录，并在桌面端批准该设备。

## 文档

- 部署说明：[docs/DEPLOYMENT.zh-CN.md](docs/DEPLOYMENT.zh-CN.md)
- 架构说明：[docs/ARCHITECTURE.zh-CN.md](docs/ARCHITECTURE.zh-CN.md)
- 安全策略：[SECURITY.zh-CN.md](SECURITY.zh-CN.md)
- 贡献说明：[CONTRIBUTING.md](CONTRIBUTING.md)
- 私有本地内容排除清单：[docs/PRIVATE_LOCAL_ONLY.zh-CN.md](docs/PRIVATE_LOCAL_ONLY.zh-CN.md)
- 开源发布检查清单：[docs/OPEN_SOURCE_RELEASE_CHECKLIST.zh-CN.md](docs/OPEN_SOURCE_RELEASE_CHECKLIST.zh-CN.md)
- 供 Codex 等编程助手读取的入口文档：[AGENTS.md](AGENTS.md)

如果你准备发布自己的 fork，请先阅读 `docs/PRIVATE_LOCAL_ONLY.zh-CN.md` 和 `docs/OPEN_SOURCE_RELEASE_CHECKLIST.zh-CN.md`，再组装 staging 发布副本。

## 致谢

本项目建立在上游 [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) 的基础上，定位是一个更聚焦的辅助层，重点服务于手机访问、可信设备审批，以及本地 Codex 工作流的更安全接入。

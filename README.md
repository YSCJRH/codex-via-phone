# mobileCodexHelper

[中文](README.md) | [English](README.en.md)

`mobileCodexHelper` 可以把你电脑上本地运行的 Codex 会话，变成一个可以在手机浏览器里安全查看和继续控制的私有 Web 面板。

它适合这样的使用方式：

- Codex 运行在你自己的 Windows 电脑上
- 你想离开电脑后用手机继续查看项目、线程和消息
- 你想从手机发下一条提示词，让电脑上的本地 Codex 接着执行
- 你希望第一次登录新设备时必须经过桌面端批准

这是一个单用户、自托管、私网优先的工具。  
如果你想看安全边界、部署架构或发布规则，请直接跳到下方文档链接。

## 你可以用它做什么

- 在手机浏览器中查看 Codex 项目和线程
- 在手机端继续一个已经存在的 Codex 会话
- 在桌面端批准第一次登录的新手机
- 在 Windows 桌面控制工具里查看本地服务、远程入口和设备审批状态


## 推荐架构

```text
手机浏览器
  -> 私有 HTTPS 入口（例如 Tailscale）
  -> 本机反向代理
  -> 已应用本仓覆盖层的本地 claudecodeui
  -> 电脑上的本地 Codex 会话
```

## 安全默认模型

- 应用只监听 `127.0.0.1`
- 前面放一层反向代理
- 优先使用私网入口
- 新设备首次登录必须经过桌面端批准
- hardened mode 默认保持开启

## 仓库边界

如果你准备发布自己的 fork，请先阅读：

- [docs/PRIVATE_LOCAL_ONLY.zh-CN.md](docs/PRIVATE_LOCAL_ONLY.zh-CN.md)
- [docs/OPEN_SOURCE_RELEASE_CHECKLIST.zh-CN.md](docs/OPEN_SOURCE_RELEASE_CHECKLIST.zh-CN.md)

## 快速开始

### 你需要准备

- Windows 10 / 11
- Python 3.11+
- Node.js 22 LTS
- Git
- nginx for Windows
- 可正常使用的本地 Codex 环境
- 强烈建议准备私网接入方案，例如 Tailscale

### 安装步骤

1. 获取上游 `siteboon/claudecodeui` `v1.25.2`
2. 把上游源码放到本地工作副本的 `vendor/claudecodeui-1.25.2`
3. 应用本仓库的覆盖层：

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

7. 在电脑浏览器打开：

```text
http://127.0.0.1:3001
```

8. 完成第一次账号注册
9. 配置一个私有远程入口
10. 用手机首次登录，并在桌面端批准该设备

## 文档

- 部署说明：[docs/DEPLOYMENT.zh-CN.md](docs/DEPLOYMENT.zh-CN.md)
- 架构说明：[docs/ARCHITECTURE.zh-CN.md](docs/ARCHITECTURE.zh-CN.md)
- 安全策略：[SECURITY.zh-CN.md](SECURITY.zh-CN.md)
- 贡献说明：[CONTRIBUTING.md](CONTRIBUTING.md)
- 私有本地内容排除清单：[docs/PRIVATE_LOCAL_ONLY.zh-CN.md](docs/PRIVATE_LOCAL_ONLY.zh-CN.md)
- 开源发布检查清单：[docs/OPEN_SOURCE_RELEASE_CHECKLIST.zh-CN.md](docs/OPEN_SOURCE_RELEASE_CHECKLIST.zh-CN.md)
- 给 Codex / 编程助手的仓库入口：[AGENTS.md](AGENTS.md)

## 致谢

本项目建立在上游 [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) 的基础上，它不是完整替代上游，而是一个更聚焦的辅助层。

本仓库中的手机控制、可信设备审批、远程入口 hardening 等能力，都是在上游 UI 和服务端基础上继续定制和收敛出来的。感谢上游作者与贡献者提供的原始项目与基础架构。

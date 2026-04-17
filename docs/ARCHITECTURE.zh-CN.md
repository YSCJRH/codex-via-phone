# 架构说明

[中文](ARCHITECTURE.zh-CN.md) | [English](ARCHITECTURE.md)

这份文档解释的是：这个仓库到底想守住什么边界。

## 一句话理解

把 Codex 留在你自己的 Windows 电脑上本地运行，在前面放 nginx，再让手机通过一个被明确命名的访问模式接入，而不是直接把 Node 应用裸露出去。

## 支持的访问模式

- `localhost`
  默认模式。应用绑定在 `127.0.0.1`，只有本机能直接访问。
- `tailnet-private`
  私网模式。通过 Tailscale Serve 把仅 tailnet 可访问的 HTTPS 路由转发到本机 nginx，Funnel 必须保持关闭。
- `public-funnel`
  公网模式。通过 Tailscale Funnel 把公网 HTTPS 路由转发到本机 nginx。这属于显式扩大边界，绝不是默认值。

legacy direct 只作为迁移状态保留，已经不再属于默认边界，也不再是公开推荐路线。

## 边界配置源

`.runtime/mode-config.json` 是本地边界配置源。

它保存：

- `requestedMode`
- `effectiveMode`
- `persistentRemotePublish`
- 确认元数据
- legacy 边界检测状态

正常安装和模式切换都应该通过 `scripts/install-mobile-codex.ps1` 这个受控入口来写入它。

只读的运维检查则应通过下面这些脚本完成：

- `scripts/status-mobile-codex.ps1`
- `scripts/doctor-mobile-codex.ps1`
- `scripts/export-mobile-codex-support-bundle.ps1`

## 运行时形态

```text
手机浏览器
  -> 被明确命名的访问模式（`tailnet-private` 或 `public-funnel`）
  -> 本机 nginx
  -> 已应用本仓覆盖层的本地 claudecodeui
  -> 电脑上的本地 Codex 会话
```

## 为什么默认必须是 `localhost`

因为这个项目最终控制的是你电脑上的本地 Codex 会话，这天然是一个高信任环境。

从 `localhost` 开始，有三个直接好处：

- 默认攻击面更小
- 审查路径更清晰
- 在你确认基础功能正常之前，不容易误把服务提前暴露出去

## 为什么推荐 `tailnet-private`

`tailnet-private` 是最符合这条主线的远程模式：

- 应用本身仍然保持 localhost-only
- nginx 继续做唯一的本地入口代理
- HTTPS 路由只对同一 tailnet 内的设备可见
- 完全不调用 Tailscale Funnel

如果你是长期自用，这应该是优先选择。

## 为什么 `public-funnel` 要被视为危险模式

`public-funnel` 会把边界明确扩大到公网。

这意味着：

- 来自公网的流量可以打到登录流程
- 配置错误的代价更高
- 错误截图、日志和支持包的风险也更高

所以它必须被显式命名、显式确认，而且绝不能默认开启。

## 为什么 nginx 必须留在中间

在所有受支持的模式里，nginx 都是稳定的入口层：

- 它让 Node 应用继续留在 localhost 后面
- 它统一处理代理和头部策略
- 它让 `tailnet-private` 和 `public-funnel` 在本机都指向同一种目标形态

仓库已经不再把“直接暴露应用”当成正常路线。

## 为什么首次设备审批很重要

这是项目里最有价值的信任边界之一。

没有它：

- 任何拿到账密的人，都可能立刻从新设备登录

有了它：

- 新设备必须等待桌面端批准
- 电脑主人可以检查待审批请求
- 只有批准后的设备才会进入可信列表

## 记住这四点就够了

1. 默认从 `localhost` 开始。
2. 需要手机远程访问时，优先选择 `tailnet-private`。
3. 把 `public-funnel` 当成显式的公网入口，而不是普通模式。
4. 让手机聚焦于查看、审批和续接本地 Codex 会话，而不是扩展成通用远程执行面板。

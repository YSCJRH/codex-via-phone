# 安全策略

[中文](SECURITY.zh-CN.md) | [English](SECURITY.md)

## 默认安全边界

这个仓库的默认安全边界是：

- 单用户
- 自托管
- localhost-first
- 在应用前面放 nginx
- 每台新设备第一次登录都需要桌面审批
- 默认保持 hardened mode 开启

如果你把它改造成公网开放、多用户共享，或者让新设备免审批登录，就已经超出默认安全边界。

## 支持的访问模式

- `localhost`
  默认模式。应用保持绑定在 `127.0.0.1`。
- `tailnet-private`
  允许的远程模式。通过 Tailscale Serve 把仅 tailnet 可访问的 HTTPS 路由转发到本机 nginx，绝不能调用 Funnel。
- `public-funnel`
  危险模式。通过 Tailscale Funnel 把公网 HTTPS 路由转发到本机 nginx。这个模式必须显式开启，绝不能当默认值。

legacy direct 已经不属于默认边界，只保留作迁移检测。

## 边界变化必须显式记录

边界变化应当持久化到 `.runtime/mode-config.json`。

正常的边界切换应该通过 `scripts/install-mobile-codex.ps1` 这个受控入口完成，这样才能保证：

- 模式选择是显式的
- `public-funnel` 确认是显式的
- 持久化意图是显式的
- legacy direct 状态会被拦下，而不是被偷偷保留

只读检查和支持包导出则应通过默认脱敏的脚本完成：

- `scripts/status-mobile-codex.ps1`
- `scripts/doctor-mobile-codex.ps1`
- `scripts/export-mobile-codex-support-bundle.ps1`

## 禁止成为默认值的行为

下面这些行为，不能在文档、脚本或默认配置里变成默认路线：

- 直接把 Node 应用暴露到公网
- 未经明确确认就启用 `public-funnel`
- 把 `tailnet-private` 写成 Funnel 或 tailnet IP 直连
- 让新设备免审批登录
- 默认公开 token、secret、诊断证据或审批痕迹

## 面向公开输出的脱敏规则

用户可见输出、截图、支持包、issue 附件和示例 JSON 默认都不应包含真实的：

- request token
- 审批痕迹
- Windows 用户名
- 本地绝对路径
- 私有主机名
- 私网 IP
- 设备 ID

请统一改成占位符。

## 私有本地内容

以下内容绝不能提交或公开：

- 认证数据库
- JWT secret
- 证书、私钥和本地 TLS 物料
- 运行日志和诊断导出
- session JSONL 和审批证据
- 维护者私有说明或一次性发布材料
- 父目录工作区里的 sibling project 和其他私有资产
- 在私有环境里打出来的二进制

详见 [docs/PRIVATE_LOCAL_ONLY.zh-CN.md](docs/PRIVATE_LOCAL_ONLY.zh-CN.md)。

## 发布前检查

公开推送前，至少要检查：

- `scripts/check-open-source-tree.ps1`
- `docs/OPEN_SOURCE_RELEASE_CHECKLIST.zh-CN.md`

这些检查应该在脱敏后的 staging 副本里执行，而不是把仍在运行的私有工作树直接当作可发布快照。

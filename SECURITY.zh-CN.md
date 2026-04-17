# 安全策略

[中文](SECURITY.zh-CN.md) | [English](SECURITY.md)

## 这份文件给谁看

这份文件主要面向两类人：

- 想长期自用部署的人
- 想把自己的 fork 安全公开发布的人

## 安全默认模型

本仓库支持的默认模型是：

- 应用只监听 `127.0.0.1`
- 前面加一层反向代理
- 优先使用私网入口
- 新设备第一次登录必须经过桌面端批准
- 除非重新审计信任边界，否则 hardened mode 默认保持开启

本仓库默认面向单用户、自托管场景。  
如果你把它改造成公网开放、多用户共享或免审批登录，就已经超出默认安全边界了。

## 不推荐做法

以下做法不属于安全默认模型：

- 将 Node 应用直接暴露到公网
- 未经过安全审查就放宽可信设备审批
- 发布运行时日志、诊断导出或审批痕迹
- 在文档、脚本或配置中写入真实 secret、真实域名或私人路径

## 公开文档的脱敏规则

准备公开仓库或公开 fork 时，文档必须使用占位符，而不是私人真实值。

需要替换的典型内容包括：

- 私有 HTTPS 入口
- tailnet 域名
- 私网 IP
- Windows 用户名和本机绝对路径
- 设备 ID、会话 ID、审批 token、运行时截图

推荐占位符写法：

- `https://mobile-codex.example.com`
- `<PRIVATE_HTTPS_ENTRYPOINT>`
- `<TAILNET_IP>`
- `<PATH_TO_MOBILE_CODEX_HELPER>`

## 私有本地内容

以下内容绝对不要提交或公开：

- 认证数据库
- JWT secret
- 证书和私钥
- 运行日志与诊断导出
- session JSONL 与审批证据
- 从私人环境打包出来的二进制

详见：

- [docs/PRIVATE_LOCAL_ONLY.zh-CN.md](docs/PRIVATE_LOCAL_ONLY.zh-CN.md)

## 发版前检查

公开推送前请至少检查：

- `scripts/check-open-source-tree.ps1`
- `docs/OPEN_SOURCE_RELEASE_CHECKLIST.zh-CN.md`

如果旧版私有构建曾暴露过 query token、认证 secret 或设备绑定材料，请先在真实环境中完成轮换。

## 漏洞反馈

- 普通问题可以走公开 GitHub issue
- 安全敏感问题建议在正式公开前先配置一个私密反馈渠道，再替换本文件中的说明

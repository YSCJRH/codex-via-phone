# 贡献说明

[中文](CONTRIBUTING.md) | [English](CONTRIBUTING.en.md)

欢迎帮助改进这个项目。这个仓库被刻意保持在一个很窄的范围内：安全地用手机控制本地 Codex，会话单用户自托管，以及清晰可解释的安全边界。

## 先读什么

开始前建议先阅读：

- `README.md`
- `docs/DEPLOYMENT.zh-CN.md`
- `SECURITY.zh-CN.md`
- `docs/PRIVATE_LOCAL_ONLY.zh-CN.md`

## 适合的贡献方向

- 修复手机查看、会话恢复、消息续接相关问题
- 改进可信设备审批与手机端同步体验
- 改进部署脚本和自检脚本
- 改进适合自托管场景的新手文档

## 默认不鼓励的改动

- 把更大私有工作区中的其它工具混进本仓库
- 把公网直连暴露改成默认部署路径
- 未经审查就放宽认证、可信设备审批或 hardened mode 假设
- 把维护者内部发布步骤、deploy key 细节或一次性运维说明写进公开入口文档
- 提交完整上游快照、运行数据、日志、数据库、二进制或私人部署痕迹

## 隐私安全的 issue / PR 习惯

提交复现信息时，请遵守这些规则：

- 真实主机名改成占位符
- 私网 IP 和本机绝对路径改成占位符
- 不要粘贴审批 token、设备 ID、认证 cookie 或 session 导出
- 如果截图里含有真实域名、机器名或运行痕迹，请先打码

## 提交前最低检查

请至少完成以下检查：

1. 确认没有真实 secret、日志、数据库、私有域名或个人路径
2. 运行 `scripts/check-open-source-tree.ps1`
3. 如果改了覆盖层，运行 `scripts/smoke-test-override-flow.ps1`
4. 如果改了桌面工具，运行 `python -m py_compile mobile_codex_control.py`
5. 如果改了文档，保持中英文入口一致
6. 如果你是维护者在准备公开发版，请在脱敏后的 staging 副本里做上述检查，而不是直接从私有工作树推送

## Pull Request 建议

- 一次 PR 只解决一类问题
- 标题尽量清楚，例如：
  - `fix: repair mobile session resync`
  - `docs: clarify first-time trusted-device approval`
- 如果改动触及信任边界，请在 PR 里明确写出风险

## 安全问题

如果你发现的是认证绕过、可信设备绕过、secret 泄露等问题，请不要先公开完整细节。请先按 `SECURITY.zh-CN.md` 中的说明处理。

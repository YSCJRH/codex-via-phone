# 开源发布检查清单

[中文](OPEN_SOURCE_RELEASE_CHECKLIST.zh-CN.md) | [English](OPEN_SOURCE_RELEASE_CHECKLIST.md)

这份清单用于第一次公开推送前，或者在脱敏后的 staging 副本里打 tag 之前做最终检查。

## staging-only 规则

- [ ] 确认当前审查对象是新导出的、已脱敏的 staging 发布副本，而不是仍在运行的私有工作树
- [ ] 确认发布根目录只包含本仓库本身
- [ ] 确认没有把父目录里的 sibling project 一起带进发布树
- [ ] 确认仓库叙事始终聚焦于手机访问、审批、续接、同步本地 Codex

## 必须剔除的目录和文件

- [ ] 删除 `vendor/`、`node_modules/`、`dist/`、`build/`、`.runtime/`、`tmp/`、`__pycache__/`、`.npm-cache/`、`private-docs/`、`logs/`、`diagnostics/`、`screenshots/`、`images/`
- [ ] 删除数据库及其伴随文件，例如 `*.db`、`*.db-wal`、`*.db-shm`、`*.sqlite`、`*.sqlite3`
- [ ] 删除本地环境文件，例如 `.env` 和 `.env.*`
- [ ] 删除日志、追踪和抓包文件，例如 `*.log`、`*.jsonl`、`*.har`、`*.pcap`
- [ ] 删除压缩包、二进制、证书和私钥
- [ ] 对照 [PRIVATE_LOCAL_ONLY.zh-CN.md](PRIVATE_LOCAL_ONLY.zh-CN.md) 确认没有遗漏

## 图片和运行证据

- [ ] 确认仓库里没有来自个人运行环境的截图和运行证据
- [ ] 确认图片文件默认不存在，除非它们属于显式 allowlist 的公开文档资源
- [ ] 当前 allowlist 的公开文档资源：
  - `docs/assets/mobile-codex-control-console.png`
  - `docs/assets/readme/mobile-hero-collage.png`
  - `docs/assets/readme/mobile-home-real-device.png`
  - `docs/assets/readme/mobile-chat-real-device.png`
  - `docs/assets/readme/mobile-approval-real-device.png`
- [ ] 确认 README 首页图和真机预览图库只使用以上 allowlist 资源

## 敏感文本扫描

- [ ] 确认没有真实 Windows 用户路径
- [ ] 确认没有真实 `*.ts.net` tailnet 域名
- [ ] 确认没有真实私网 IP、request token 值、session ID 值或 approval evidence 值
- [ ] 确认示例统一使用 `mobile-codex.example.com`、`<PRIVATE_HTTPS_ENTRYPOINT>` 之类的公开安全占位符

## 上游归属与用户向文档

- [ ] 确认 `README`、`NOTICE`、`LICENSE` 都完整保留了上游归属
- [ ] 确认仓库明确写清楚它基于 `siteboon/claudecodeui`
- [ ] 确认 README 仍然是用户入口，而不是维护者内部发布说明
- [ ] 确认部署、安全、架构文档与真实脚本和默认值保持一致

## 验证

- [ ] 在脱敏后的 staging 树里运行 `powershell -ExecutionPolicy Bypass -File scripts/check-open-source-tree.ps1`
- [ ] 确认 `Open Source Gate` 工作流通过
- [ ] 运行 `python -m py_compile mobile_codex_control.py`
- [ ] 如果覆盖层有改动，运行 `scripts/smoke-test-override-flow.ps1`
- [ ] 人工核对最终文件列表，确认公开仓仍然形成完整文档闭环

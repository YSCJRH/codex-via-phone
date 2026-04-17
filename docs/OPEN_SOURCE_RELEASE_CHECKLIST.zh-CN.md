# 开源发布检查清单

[中文](OPEN_SOURCE_RELEASE_CHECKLIST.zh-CN.md) | [English](OPEN_SOURCE_RELEASE_CHECKLIST.md)

这份清单用于第一次公开推送前，或者在一个已经脱敏的发布副本里打 tag 之前做最终检查。

## 仓库边界

- [ ] 确认发布根目录只有 `mobileCodexHelper/`
- [ ] 确认没有把更大私有工作目录中的同级项目一起复制进来
- [ ] 确认仓库叙事始终聚焦“手机控制本地 Codex”，而不是其它无关工具

## 私有本地内容

- [ ] 删除 `vendor/`、`node_modules/`、`dist/`、`build/`、`.runtime/`、`tmp/`、`__pycache__/`
- [ ] 删除数据库、日志、打包二进制、压缩包、session 导出、证书和私钥
- [ ] 删除从私人运行环境导出的诊断包、运行截图和审批证据
- [ ] 对照 [PRIVATE_LOCAL_ONLY.zh-CN.md](PRIVATE_LOCAL_ONLY.zh-CN.md) 确认没有遗漏

## 文档与示例

- [ ] 把真实主机名、tailnet 域名、私有 IP、用户名和绝对路径全部替换为占位符
- [ ] 确认示例统一使用 `mobile-codex.example.com` 或 `<PRIVATE_HTTPS_ENTRYPOINT>` 之类的公开安全占位符
- [ ] 确认截图和粘贴日志里没有机器专属信息
- [ ] 确认部署文档只展示示例配置，而不是私人运行时值
- [ ] 确认 `deploy/` 目录的说明里已经写清楚哪些文件是示例、哪些值必须本地定制

## 上游归属与许可

- [ ] 确认 `README`、`NOTICE`、`LICENSE` 对上游归属的表述一致
- [ ] 确认仓库明确说明它建立在 `siteboon/claudecodeui` 之上
- [ ] 确认致谢区块感谢了上游作者与贡献者

## 验证

- [ ] 在脱敏后的发布副本中运行 `powershell -ExecutionPolicy Bypass -File scripts/check-open-source-tree.ps1`
- [ ] 如果覆盖层有改动，运行 `scripts/smoke-test-override-flow.ps1`
- [ ] 运行 `python -m py_compile mobile_codex_control.py`
- [ ] 人工核对最终文件列表，确认公开仓库仍然构成完整资料闭环：
  - `README`
  - 部署说明
  - 安全策略
  - 贡献说明
  - 发布清单
  - 说明和许可证

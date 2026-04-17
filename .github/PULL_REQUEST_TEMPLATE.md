# 边界变化说明

请说明这次改动是否改变了默认安全边界、访问模式、发布面，或者只是边界收口。

## 计划修改的文件

请列出本次主要改动文件。

## 具体改动

请说明这次改动做了什么，以及为什么这样改。

## 风险回归点

请列出：

- 可能影响的旧行为
- 兼容性风险
- 是否存在 legacy 状态迁移成本

## 验证步骤

- [ ] 本地手动验证
- [ ] 运行相关脚本语法检查
- [ ] 运行 `python -m py_compile mobile_codex_control.py`
- [ ] 运行 `scripts/check-open-source-tree.ps1`
- [ ] 运行 `scripts/smoke-test-override-flow.ps1`（如适用）

请补充必要的验证说明：

```text
例如：
- 默认启动后只监听 127.0.0.1
- tailnet-private 未调用 Funnel
- public-funnel 需要显式确认
```

## 文档同步点

- [ ] README 已同步
- [ ] DEPLOYMENT 已同步
- [ ] ARCHITECTURE 已同步
- [ ] SECURITY 已同步
- [ ] AGENTS.md 已同步
- [ ] 无需同步文档

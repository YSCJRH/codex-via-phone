# 真机测试检查清单

这份清单用于在真实手机上验证移动端体验，并为 README 产出可公开展示的脱敏截图。

## 设备矩阵

- iPhone Safari
- iOS PWA
- 窄屏 Android Chrome

## 必测场景

- 打开手机首页、进入项目、进入会话、返回项目列表
- 打开搜索 sheet 和更多 sheet，确认布局与 safe-area 正常
- 验证聊天头部状态、外部同步提示、provider / session 空状态
- 验证权限卡、桌面审批卡和 desktop-review-only 提示
- 在 iOS PWA 中验证冷启动、回到最近会话、键盘弹起后的 composer 安全区
- 在 iOS PWA 中验证 composer、审批浮层、底部导航不会互相覆盖
- 在 Android Chrome 中验证首页、会话页、搜索/更多页在窄屏下布局稳定
- 验证长中文标题、混合中英标题、长项目名都能 clamp，不会穿出卡片

## 截图脱敏

- 原始真机截图保存在公开仓之外
- 只把脱敏后的 PNG 成品图放进 `docs/assets/readme/`
- 去除或替换真实用户名、项目名、绝对路径、私网 IP、`*.ts.net` 域名、request token、session ID、设备 ID、审批痕迹、个人通知内容
- 如果状态栏暴露运营商、精确时间、位置或通知内容，统一做中性化处理
- 不要混入旧版 UI 截图

## README 图片产出

- 生成 1 张首页拼贴图：`docs/assets/readme/mobile-hero-collage.png`
- 生成 3 张单图：
  - `docs/assets/readme/mobile-home-real-device.png`
  - `docs/assets/readme/mobile-chat-real-device.png`
  - `docs/assets/readme/mobile-approval-real-device.png`
- README 里统一使用仓库内相对路径引用图片，并保证 GitHub 网页可正常渲染
- `README.md` 与 `README.en.md` 使用同一套图片资产

## 发布前验证

- 运行 `powershell -ExecutionPolicy Bypass -File scripts/check-open-source-tree.ps1`
- 运行 `python -m py_compile mobile_codex_control.py`
- 如果覆盖层有改动，运行 `scripts/smoke-test-override-flow.ps1`
- 确认 `Open Source Gate` 工作流通过
- 在 GitHub 网页中人工检查中英文 README 的图片渲染结果

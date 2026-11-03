# Codex Float

[English](README.md) | 简体中文

连接 Codex 桌面端已有本地聊天的窄幅置顶窗口，基于 Tauri、React 和 Rust 构建。

Windows 已在本机验证。macOS 为实验性支持，仍需在 Mac 上完成编译与实机验收。当前应用界面为简体中文。

## 功能

- 实时同步聊天与任务状态，支持发送提示词、追加指令和停止任务。
- 显示 Markdown、图片、语法高亮、文件预览，以及每轮任务的修改文件和 Diff。
- 在聊天中处理审批与提问，显示账号额度。
- 支持亮暗主题、背景透明度，以及 Windows 背景模糊调节。
- 可缩小为悬浮状态球，点击恢复聊天窗口。

## 使用

1. 保持 Codex 桌面端运行，并在主窗口打开目标聊天。
2. 启动 Codex Float，选择该聊天；需要重新连接时点击同步按钮。
3. **Enter** 发送，**Shift+Enter** 换行。任务执行中发送内容会追加指令。

拖动标题栏移动窗口，图钉切换置顶，最小化按钮切换为悬浮状态球。

## 构建

需要 Node.js 24、Rust stable 和对应平台的原生构建依赖。在项目根目录执行以下命令。

### Windows

需要 MSVC 工具链、Microsoft C++ Build Tools、Windows SDK 和 WebView2。

```powershell
npm.cmd ci
npm.cmd run build:windows
```

产物：`src-tauri/target/release/codex-float.exe`。

### macOS（实验性）

需要 macOS 13+、Xcode Command Line Tools，并在 Mac 上构建。

```bash
npm ci
npm run build:macos
```

`.app` 和 `.dmg` 产物位于 `src-tauri/target/release/bundle/`。当前使用 ad-hoc 签名，公开发布前需配置正式签名与公证。

开发模式使用 `npm run dev:windows` 或 `npm run dev:macos`。前端测试使用 `npm test`，原生测试使用 `cargo test --manifest-path src-tauri/Cargo.toml`。

## 限制

- 使用桌面端内部的本地 IPC 协议，可能随 App 更新变化；仅能连接已有运行实例的本地聊天。
- 上传附件、切换模型、登录及不支持的弹窗仍需在 Codex 主窗口处理。发送内容沿用所选聊天的设置。
- 数值模糊调节仅支持 Windows；macOS 使用系统 Vibrancy 材质。
- Git 不包含可执行文件和构建缓存，请从源码构建。

## 文档

- [构建说明与 CI](docs/build.md)
- [项目结构](docs/architecture.md)
- [macOS 状态与验收](docs/macos.md)

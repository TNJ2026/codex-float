CodexFloat 将 Codex 聊天放入轻量悬浮窗口，支持置顶、迷你状态球、中英文界面，以及玻璃质感背景。

### v0.1.1 修复

- 修复独立启动时误选没有运行实例的历史聊天，导致提示“未找到运行中的聊天”的问题；现在会优先连接可用的聊天，并保留可用的上次选择。
- 连接中断、超时等错误会显示实际原因。

### 下载

| 平台 | 安装包 | App / 便携包 |
| --- | --- | --- |
| Windows x64 | `CodexFloat-windows-x64-setup.exe` | `CodexFloat-windows-x64-portable.zip` |
| macOS Apple Silicon | `codex-float-macos-arm64.dmg` | `codex-float-macos-arm64.zip`（包含 `.app`） |
| macOS Intel | `codex-float-macos-x64.dmg` | `codex-float-macos-x64.zip`（包含 `.app`） |

需先安装并运行 Codex 桌面应用。当前仅开放 Codex 聊天，ChatGPT 聊天入口暂未启用。

Windows 安装包未使用商业代码签名；macOS App 使用本地签名，尚未经过 Apple 公证，首次打开可能需要在“系统设置 → 隐私与安全性”中允许打开。

附件 `SHA256SUMS.txt` 可用于核对下载完整性；源码压缩包由 GitHub 自动提供。

---

CodexFloat brings your Codex chats into an always-on-top floating window with a mini status ball, Chinese/English UI, and a glass backdrop.

v0.1.1 fixes standalone startup selecting inactive history instead of a live chat. It also preserves the real cause of connection failures.

Choose the Windows installer or portable ZIP, or the macOS DMG / ZIP matching your Mac's architecture. macOS ZIPs contain the `.app` bundle. The Codex desktop app must be installed and running. ChatGPT integration is currently disabled.

Windows downloads are unsigned. macOS apps are ad-hoc signed and are not notarized. Check `SHA256SUMS.txt` to verify downloaded files.

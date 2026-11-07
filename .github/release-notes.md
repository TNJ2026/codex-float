CodexFloat 将 Codex 聊天放入轻量悬浮窗口，支持置顶、迷你状态球、中英文界面，以及玻璃质感背景。

### v0.1.2 更新

- 修复 macOS Release 版标题栏右上角按钮挤在一起的问题，设置和置顶按钮使用固定尺寸约束。
- macOS 下载仅提供 DMG 安装包，不再提供 App ZIP 包；Windows 安装包和便携 ZIP 保持不变。

### 下载

| 平台 | 安装包 | App / 便携包 |
| --- | --- | --- |
| Windows x64 | `CodexFloat-windows-x64-setup.exe` | `CodexFloat-windows-x64-portable.zip` |
| macOS Apple Silicon | `codex-float-macos-arm64.dmg` | — |
| macOS Intel | `codex-float-macos-x64.dmg` | — |

需先安装并运行 Codex 桌面应用。当前仅开放 Codex 聊天，ChatGPT 聊天入口暂未启用。

Windows 安装包未使用商业代码签名；macOS App 使用本地签名，尚未经过 Apple 公证，首次打开可能需要在“系统设置 → 隐私与安全性”中允许打开。

附件 `SHA256SUMS.txt` 可用于核对下载完整性；源码压缩包由 GitHub 自动提供。

---

CodexFloat brings your Codex chats into an always-on-top floating window with a mini status ball, Chinese/English UI, and a glass backdrop.

v0.1.2 fixes crowded macOS titlebar actions by constraining custom toolbar button sizes. macOS downloads now provide DMG installers only; Windows installer and portable ZIP downloads are unchanged.

Choose the Windows installer or portable ZIP, or the macOS DMG matching your Mac's architecture. The Codex desktop app must be installed and running. ChatGPT integration is currently disabled.

Windows downloads are unsigned. macOS apps are ad-hoc signed and are not notarized. Check `SHA256SUMS.txt` to verify downloaded files.

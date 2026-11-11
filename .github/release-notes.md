CodexFloat 将 Codex 聊天放入轻量悬浮窗口，支持置顶、迷你状态球、中英文界面，以及玻璃质感背景。

### v0.1.5 更新

- 修复聊天切换和连接清理中的竞态，并将断连通知限定到对应聊天。
- 选择尚未加载的聊天时显示手动打开指引，支持在主应用打开后同步。
- 聊天列表过滤内部子代理记录，并兼容来源为空的历史聊天。
- 修复 Windows Shell 路径解析，以及混合 DPI 多屏环境下的窗口恢复尺寸和位置。
- 改善 macOS 冷启动输入框焦点、光标显示及窗口激活行为。
- 改善附件缓存、预览、音频播放及悬浮球状态显示，并修复架构文档中的乱码。

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

v0.1.5 fixes chat connection races and cleanup, scopes disconnect notifications to their chat, and guides users to open unloaded chats before syncing. It filters internal agent threads while preserving legacy chats with a null source, corrects Windows shell paths and mixed-DPI window restoration, improves macOS composer focus and window activation, and refines attachment caching, previews, inline audio playback, and status indicators. Architecture documentation is available in `docs/architecture.md`.

Choose the Windows installer or portable ZIP, or the macOS DMG matching your Mac's architecture. The Codex desktop app must be installed and running. ChatGPT integration is currently disabled.

Windows downloads are unsigned. macOS apps are ad-hoc signed and are not notarized. Check `SHA256SUMS.txt` to verify downloaded files.

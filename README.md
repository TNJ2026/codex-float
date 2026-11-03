# Codex Float

English | [简体中文](README.zh-CN.md)

A compact, always-on-top chat window for your existing local chats in the Codex desktop app. Built with Tauri, React, and Rust.

Windows has been tested locally. macOS support is experimental and still needs build and runtime verification on a Mac. The interface is currently in Simplified Chinese.

## Features

- Live chat history and task status; send prompts, add instructions, and stop tasks.
- Markdown, images, syntax highlighting, file previews, and per-task file changes with diffs.
- In-chat approvals and questions, plus account usage indicators.
- Light and dark themes, adjustable background opacity, and background blur on Windows.
- A compact floating status ball that restores the chat when clicked.

## Usage

1. Keep the Codex desktop app running and open the chat you want to use there.
2. Launch Codex Float and select that chat. Use the sync button to reconnect if needed.
3. Press **Enter** to send or **Shift+Enter** for a new line. Sending during a task adds instructions to that task.

Use the title bar to move or pin the window. The minimize button switches to the floating status ball.

## Build

Use Node.js 24 and Rust stable, plus the native prerequisites below. Run commands from the repository root.

### Windows

Requires the MSVC toolchain, Microsoft C++ Build Tools, Windows SDK, and WebView2.

```powershell
npm.cmd ci
npm.cmd run build:windows
```

Output: `src-tauri/target/release/codex-float.exe`.

### macOS (experimental)

Requires macOS 13+, Xcode Command Line Tools, and a Mac to build.

```bash
npm ci
npm run build:macos
```

Output: `.app` and `.dmg` bundles under `src-tauri/target/release/bundle/`. Current builds use ad-hoc signing; public distribution needs signing and notarization.

For development, use `npm run dev:windows` or `npm run dev:macos`. Run frontend tests with `npm test` and native tests with `cargo test --manifest-path src-tauri/Cargo.toml`.

## Limitations

- Uses the desktop app's internal local IPC protocol, which may change with app updates. Only existing local chats with a running instance can connect.
- Upload attachments, switch models, and handle sign-in or unsupported dialogs in the main Codex app. Prompts inherit the selected chat's settings.
- Numeric blur adjustment is Windows-only; macOS uses system Vibrancy.
- Executables and build caches are excluded from Git. Build the app from source.

## Documentation

The detailed documentation is currently in Chinese:

- [Build instructions and CI](docs/build.md)
- [Project structure](docs/architecture.md)
- [macOS status and validation](docs/macos.md)

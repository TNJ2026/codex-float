# 构建与产物

源码、锁文件、图标和构建配置应进入 Git；`node_modules`、`dist`、`.tools`、`target`、exe / app / dmg 等产物已列入忽略规则。exe 和 Mac 应用适合随版本上传为 Release 附件。

## Windows

需要 Node.js 24、Rust stable MSVC、Microsoft C++ Build Tools、Windows SDK 和 WebView2。

Windows 11 可选安装 [Windows App Runtime 1.8](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/downloads-archive) 以启用 `DesktopAcrylicController`。运行库不可用时，窗口会尝试使用 DWM 系统亚克力。

```powershell
npm.cmd ci
npm.cmd test

# 保持原有 Debug 构建入口
powershell -ExecutionPolicy Bypass -File scripts/build.ps1

# Release exe
npm.cmd run build:windows

# 开发
npm.cmd run dev:windows
```

Debug 产物：`src-tauri/target/debug/codex-float.exe`。
Release 产物：`src-tauri/target/release/codex-float.exe`。
构建脚本不会结束运行中的程序或自动覆盖根目录的启动副本。

`.tools` 仅是这台开发机的可选工具链缓存，不是构建所需的源码依赖。另一台机器安装标准 Rust / Visual Studio / Windows SDK 后即可构建；脚本仅在本地缓存存在时使用它。

## macOS（实验性基础）

需要 macOS 13 或以上、Node.js 24、Rust stable、Xcode Command Line Tools。请在 Mac 上执行：

```bash
npm ci
npm test
npm run build:macos

# 开发
npm run dev:macos
```

当前机器架构决定默认产物架构。Apple Silicon 与 Intel 可分别构建；Universal 构建需先安装两个 Rust target：

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run build:macos -- --target universal-apple-darwin
```

普通构建的 `.app` / `.dmg` 位于 `src-tauri/target/release/bundle/`；指定 `--target` 后位于对应 target 子目录下。当前 Mac 配置使用 ad-hoc 签名供开发验收；公开发布前需配置正式签名与公证。[Tauri macOS 构建说明](https://v2.tauri.app/distribute/macos-application-bundle/)

Windows 机器不能代替 Mac 进行 `.app` / `.dmg` 构建与运行验收。已在 Apple Silicon Mac 上完成原生构建及基础运行验收，范围见 [macOS 接入说明](macos.md)。Mac 构建脚本还包含本机 Xcode beta 的过程宏动态库兼容设置。

## GitHub Actions

工作流在 `main` 推送、`v*` tag、PR 或手动触发时运行；分别检查 Windows x64、macOS Apple Silicon 与 macOS Intel。流程执行前端测试、Rust 测试和原生构建，并保存 exe / Mac app zip 为构建附件。它不创建 Release、不自动上传公开版本、不调用真实聊天或账号查询。

本地没有运行过 Mac CI；上传 GitHub 后需检查两个 Mac job 的结果。Mac `.app` 使用 `ditto` 打包后上传以保留执行权限。所用 `macos-15` 与 `macos-15-intel` 标签对应 GitHub 的 ARM / Intel runner。[GitHub runner 说明](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

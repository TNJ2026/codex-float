# macOS 接入状态

当前状态：**平台结构、构建入口与基于桌面端共享源码的接入实现已准备，尚未在 Mac 上编译或实机验收。不能把它视为已验证的完整 macOS 版本。**

## 已准备的实现

- React 聊天、Markdown / 图片、文件列表、Diff、主题与透明度设置共用一套代码。
- 本地索引使用 `PathBuf::join` 与 `HOME/.codex`，支持 `CODEX_HOME` 覆盖。
- 默认浏览器和 Finder 定位使用 `/usr/bin/open`，通过独立参数传递地址或路径。
- CLI 从 `PATH`、Homebrew 常见目录或 `CODEX_FLOAT_CLI_PATH` 查找。
- 背景使用 macOS 系统 Vibrancy；不把 Windows Composition 的连续模糊值直接套用到 Mac。系统材质模式下禁用该滑块，主题和背景 Alpha 仍可调整。
- 状态球窗口状态与恢复逻辑共享，macOS 使用自己的圆角材质接口。
- 配置包含 `.icns` 图标、`.app` / `.dmg` 目标、Apple Silicon / Intel CI。

## 聊天连接来源与待确认项

Windows 已使用本机验证过的 `\\.\pipe\codex-ipc`。2026-11-03 对本机桌面端 26.1027.3384 的共享 IPC 模块做了只读核对（`early-bootstrap` 中的模块 92272 与 Codex home 解析模块 34338）：非 Windows 分支以 `$CODEX_HOME/ipc/ipc.sock` 为主要入口，未配置 home 时使用 `~/.codex`；旧兼容入口位于系统临时目录的 `codex-ipc/ipc-<uid>.sock`。两者使用与 Windows 相同的四字节小端长度分帧。

Mac 实现依照上述共享代码选择默认路径，并检查 socket 类型、所属用户和父目录写权限；不创建、删除或修改桌面端 socket。**这是当前桌面端共享源码所提供的依据，Mac 发行包及实机运行结果仍需确认。**

```bash
npm run dev:macos

# 对已有聊天做只读订阅验收，不发送消息
node scripts/live-smoke.mjs <thread-uuid>
```

若某个桌面版本改变了路径，可用 `CODEX_FLOAT_IPC_PATH=/absolute/path/to/verified/socket npm run dev:macos` 显式覆盖。连接失败会明确提示；不会建立新聊天、接管原聊天或自动发送测试提示词。只读 Node 验收脚本默认使用主要入口，旧临时路径可通过同一变量覆盖。

可选环境变量：

| 变量 | 用途 |
| --- | --- |
| `CODEX_HOME` | 本地 Codex 索引 / 状态所在目录，使用绝对路径 |
| `CODEX_FLOAT_IPC_PATH` | 可选，覆盖 macOS 默认桌面 IPC Unix socket 绝对路径 |
| `CODEX_FLOAT_CLI_PATH` | 额度查询使用的 Codex CLI 可执行文件完整路径 |
| `CODEX_THREAD_ID` | 启动后优先选中的已有聊天 |

Finder 启动的 App 不一定继承终端环境变量。使用默认路径时不需要额外配置；如果依赖覆盖变量，接入阶段先通过上述 `dev:macos` 入口运行。

## Mac 验收顺序

1. 在 Apple Silicon 和 Intel runner 上完成构建；确认 `.app` 启动、字体、主题和透明背景。
2. 实机核对当前 Mac 发行版的 IPC 端点和完整快照 / 增量协议，执行只读订阅验收。
3. 核对聊天恢复、状态球位置与圆角、Finder / 浏览器打开、文件及 Diff 预览。
4. 用户明确授权后再验证发送、追加指令、停止、审批 / 提问回复。
5. 核对 CLI 账号额度查询，并完成正式发布签名 / 公证配置。

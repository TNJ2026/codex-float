# macOS 接入状态

2026-11-05 在 Apple Silicon（arm64，macOS 27.2）上完成本轮验收。Intel 不在本轮范围内。

| 验收方式 | 覆盖与结果 |
| --- | --- |
| Mac Release 实机 | 应用启动与真实聊天同步、Liquid Glass 设置与关闭按钮、原生选择菜单、推理强度和速度保存、置顶、标题栏拖动、悬浮球恢复、系统附件窗口选取与移除。真实 IPC 订阅收到 2 个快照和 16 个增量，未发现补丁错误。 |
| 真实后端联调 | 模型目录、账号额度、技能与插件目录、输入预测生成，以及不保留历史副本的临时分叉，5 项通过。 |
| 模拟与自动化 | 140 项前端和 35 项 Rust 测试通过。覆盖发送及附件载荷、追加消息、停止、审批、提问回复、权限、编辑与持久分叉、网页上下文、子代理、富文本、文件与 Diff。旧系统的设置面板按 Vibrancy 模式模拟。 |
| 浏览器验收 | 14 项 MCP 卡片模拟通过。使用本地 Rust 预览服务和沙箱 iframe 验证 Mermaid 渲染与缩放、ECharts 渲染和 HTML 交互。 |
| 构建校验 | arm64 Release 应用可启动，本地代码签名校验及 DMG 校验和验证通过。 |

实机联调中的三个 MCP 探针依赖 `cities-skylines2` 服务或专用浏览器脚本，本机环境未满足这些条件。对应的卡片与工具交互使用隔离模拟。macOS 13–25 的 AppKit Vibrancy 实际外观、网页上下文的系统授权流程、正式发布公证仍需对应环境复验。

本轮修复了 Mac 本地预览服务可能截断较大资源的问题。每条已接受连接在独立工作线程中使用带超时的阻塞读写，Rust 回归检查对照了完整 Mermaid 脚本。

## 构建兼容性

- 当前锁定的 Tauri 2.12.5 已默认支持透明窗口；移除了过时的 `macOSPrivateApi` 配置，直接运行 `cargo test --locked --manifest-path src-tauri/Cargo.toml` 也可通过依赖特性检查。
- Mac Release 构建脚本默认保留 host 构建工具和过程宏的调试信息，避免本机 Xcode beta 工具链生成的动态库出现 `mis-aligned LINKEDIT string pool` 加载错误。这不为最终应用启用调试信息；可通过 `CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_DEBUG` 显式覆盖。

## 已准备的实现

- React 聊天、Markdown / 图片、文件列表、Diff、主题与透明度设置共用一套代码。
- 本地索引使用 `PathBuf::join` 与 `HOME/.codex`，支持 `CODEX_HOME` 覆盖。
- 默认浏览器和 Finder 定位使用 `/usr/bin/open`，通过独立参数传递地址或路径。
- CLI 优先使用 `CODEX_FLOAT_CLI_PATH` 指定路径，其次使用桌面 App（ChatGPT / Codex）自带的 CLI，最后回退到 `PATH` 和 Homebrew 常见目录，避免旧 CLI 的模型目录与主窗口不一致。
- 权限、速度和主题使用系统原生菜单。模型和推理强度共用自定义弹窗与滑块。macOS 由 AppKit 渲染，Windows 由 Win32 渲染。macOS 的会话选择使用自定义项目分组列表，Windows 的会话选择使用系统菜单。工具调用详情的长命令列表继续共用网页组件，以限制宽度并截断超长条目。
- macOS 26+ 背景使用原生 `NSGlassEffectView` Clear Liquid Glass，运行时查找类，macOS 13–25 自动回退为 Vibrancy。聊天视图放入玻璃视图的 `contentView`，窗口缩放由原生 autoresizing 跟随；状态球复用同一视图并调整圆角，不重复叠加材质。设置面板提供主题和背景 Alpha 调整，不提供模糊程度调节；Clear 材质透出更多背景，聊天窗口使用 20pt 圆角；前端底色强度直接跟随透明度滑块，默认保留 60% 底色以维持文字对比度。
- 状态球窗口状态与恢复逻辑共享，macOS 使用自己的圆角材质接口。
- 配置包含 `.icns` 图标、`.app` / `.dmg` 目标、Apple Silicon / Intel CI。
- 设置弹窗在 macOS 26+ 使用独立的原生 Liquid Glass 底层，按面板位置和尺寸更新，关闭时移除。网页控件保留在 WebView 内接收输入；仅裁去面板下方重叠的聊天内容，防止文字透叠。原生底层不可用时回退为原有网页背景。
- 主窗口使用 AppKit 原生 `NSToolbar` 的 Unified 样式，由系统统一布局红黄绿按钮、窗口标题和 SF Symbols 操作按钮；不再移动系统私有标题栏视图，也不设置 `trafficLightPosition`。移除 Mac 网页标题行及装饰性应用图标。内容区按主线程测得的 `contentLayoutRect` 留出空间，支持系统布局变化。设置、置顶、悬浮球都有菜单入口；进入悬浮球时隐藏工具栏，恢复后由 AppKit 重新布局。Windows 使用系统标题栏的最小化、最大化和关闭按钮。设置、置顶和悬浮球位于应用工具栏。

2026-11-05 已在本机 macOS 27.2 上实机确认 Liquid Glass 模式、聊天同步、设置面板交互，以及状态球缩小和恢复。旧版系统的 Vibrancy 回退尚未在旧系统实机复测。原生接口依据 [Apple NSGlassEffectView 文档](https://developer.apple.com/documentation/appkit/nsglasseffectview)。

## 聊天连接来源与待确认项

Windows 已使用本机验证过的 `\\.\pipe\codex-ipc`。2026-11-03 对本机桌面端 26.1027.3384 的共享 IPC 模块做了只读核对（`early-bootstrap` 中的模块 92272 与 Codex home 解析模块 34338）：非 Windows 分支以 `$CODEX_HOME/ipc/ipc.sock` 为主要入口，未配置 home 时使用 `~/.codex`；旧兼容入口位于系统临时目录的 `codex-ipc/ipc-<uid>.sock`。两者使用与 Windows 相同的四字节小端长度分帧。

Mac 实现依照上述共享代码选择默认路径，并检查 socket 类型、所属用户和父目录写权限；不创建、删除或修改桌面端 socket。2026-11-05 已在本机通过默认 socket 完成真实聊天订阅，收到 2 个完整快照及 2 个增量更新，补丁错误数为 0；未发送提示词。

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
| `CODEX_FLOAT_CLI_PATH` | 模型、速度、上下文和额度查询使用的 Codex CLI 可执行文件完整路径 |
| `CODEX_THREAD_ID` | 启动后优先选中的已有聊天 |

Finder 启动的 App 不一定继承终端环境变量。使用默认路径时不需要额外配置；如果依赖覆盖变量，接入阶段先通过上述 `dev:macos` 入口运行。

## Mac 验收顺序

1. 在 Apple Silicon 上完成构建，确认 `.app` 启动、字体、主题和透明背景。
2. 实机核对当前 Mac 发行版的 IPC 端点和完整快照 / 增量协议，执行只读订阅验收。
3. 核对聊天恢复、状态球位置与圆角、Finder / 浏览器打开、文件及 Diff 预览。
4. 在隔离的模拟聊天中验证发送、追加指令、停止、审批和提问回复。
5. 核对 CLI 账号额度查询，并完成正式发布签名 / 公证配置。

标题栏设计依据：[Apple HIG Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)、[Apple HIG Windows](https://developer.apple.com/design/human-interface-guidelines/windows)。2026-11-05 已实机检查原生工具栏、设置面板、置顶状态切换、菜单入口，以及悬浮球恢复。

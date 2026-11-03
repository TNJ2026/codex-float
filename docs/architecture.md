# 项目结构与平台边界

```text
src/                              React 共享界面与状态模型
  assets/                         应用内图片与标志
src-tauri/
  src/
    main.rs                       程序入口（仅声明模块）
    app.rs                        Tauri 命令、状态与生命周期注册
    codex/
      client.rs                   分帧、请求关联、订阅与连接生命周期
      commands.rs                 连接聊天、发送消息、交互回复
      index.rs                    本地聊天 / 项目 / 模型索引
      paths.rs                    CODEX_HOME 与用户目录解析
    services/
      links.rs                    文件检查、文本解码与链接命令
      mini_mode.rs                状态球与窗口位置 / 尺寸恢复
      usage.rs                    只读 CLI 额度查询与超时清理
      interactions.rs             审批 / 表单回复格式
      stop.rs                     当前任务中断
    platform/
      mod.rs                      根据 target_os 选择平台实现
      windows/
        background.rs             背景设置命令与原生材质回退
        custom_blur.rs            Windows Composition 高斯模糊
        window.rs                 DWM 边框、圆形裁剪与窗口事件
        transport.rs              Windows 命名管道
        process.rs                CLI 查找与隐藏子进程
        shell.rs                  默认浏览器与 Explorer 文件定位
      macos/
        background.rs             系统 Vibrancy 材质
        window.rs                 macOS 窗口效果与状态球圆角
        transport.rs              Unix socket 默认发现 / 用户验证 / 手动覆盖
        process.rs                macOS CLI 查找
        shell.rs                  默认浏览器与 Finder 文件定位
  tauri.conf.json                 共享配置
  tauri.windows.conf.json         Windows 窗口覆盖配置
  tauri.macos.conf.json           macOS 窗口、.app / .dmg 配置
  capabilities/                  前端命令权限
  icons/                         构建图标，含 .ico 与 .icns
scripts/
  windows/                       Windows 构建、开发与本地工具链环境
  macos/                         macOS 构建与开发入口
  lib/platform.mjs               Node 只读集成脚本的平台入口解析
  *.test.mjs                     共享模型与界面测试
  live-smoke.mjs                  只读聊天订阅验收
docs/                            构建说明、macOS 接入状态、架构说明
.github/workflows/build.yml       Windows / macOS ARM / macOS Intel 构建矩阵
```

前端、IPC 消息格式、请求路由和业务规则保持共享；平台目录只处理 OS API、传输端点及进程 / 文件管理器差异。Windows SDK / WinRT 依赖放在 Cargo 的 Windows target 依赖段中，macOS 不编译这些依赖。

Tauri 的平台配置会覆盖共享配置，`windows` 数组整体替换，因此两个平台配置各自保留完整的窗口定义。修改窗口通用尺寸时要同步两个平台配置；测试会检查基本定义的一致性。[Tauri 平台配置说明](https://v2.tauri.app/reference/config/#platform-specific-configuration)

现有 `scripts/build.ps1`、`scripts/dev.ps1`、`scripts/env.ps1` 保留为兼容入口，实际实现位于 `scripts/windows/`。现有前端模块路径保持稳定，避免这次平台整理影响消息、Diff、预览与设置功能。

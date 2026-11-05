use std::{path::PathBuf, process::Command};

pub fn configure(command: &mut Command) {
    let mut paths: Vec<_> = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default();
    for path in ["/opt/homebrew/bin", "/usr/local/bin"] {
        let path = PathBuf::from(path);
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    if let Ok(path) = std::env::join_paths(paths) {
        command.env("PATH", path);
    }
}
pub fn codex_binary() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("CODEX_FLOAT_CLI_PATH") {
        let executable = PathBuf::from(path);
        return if executable.is_file() {
            Ok(executable)
        } else {
            Err("CODEX_FLOAT_CLI_PATH 指向的文件不存在".into())
        };
    }
    // Match the desktop host's model catalog instead of an older Homebrew CLI.
    let mut roots = vec![PathBuf::from("/Applications")];
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(PathBuf::from(home).join("Applications"));
    }
    for root in roots {
        for relative in [
            "ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
            "Codex.app/Contents/Resources/codex",
            "Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
        ] {
            let executable = root.join(relative);
            if executable.is_file() {
                return Ok(executable);
            }
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let executable = dir.join("codex");
            if executable.is_file() {
                return Ok(executable);
            }
        }
    }
    for path in ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"] {
        let executable = PathBuf::from(path);
        if executable.is_file() {
            return Ok(executable);
        }
    }
    Err("未找到 Codex CLI，请安装 CLI 或设置 CODEX_FLOAT_CLI_PATH".into())
}

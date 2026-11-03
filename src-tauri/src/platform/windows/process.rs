use std::{os::windows::process::CommandExt, path::PathBuf, process::Command};

pub fn configure(command: &mut Command) {
    command.creation_flags(0x08000000);
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
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let executable = dir.join("codex.exe");
            if executable.is_file() {
                return Ok(executable);
            }
        }
    }
    let root = PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("未找到 Codex CLI")?)
        .join("OpenAI/Codex/bin");
    let mut candidates: Vec<_> = std::fs::read_dir(root)
        .map_err(|_| "未找到 Codex CLI")?
        .filter_map(Result::ok)
        .map(|entry| entry.path().join("codex.exe"))
        .filter(|path| path.is_file())
        .collect();
    candidates.sort_by_key(|path| std::fs::metadata(path).and_then(|m| m.modified()).ok());
    candidates
        .pop()
        .ok_or_else(|| "未找到 Codex CLI，可设置 CODEX_FLOAT_CLI_PATH".into())
}

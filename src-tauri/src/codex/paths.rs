use std::{ffi::OsString, path::PathBuf};

fn resolve_home(
    configured: Option<OsString>,
    user_home: Option<OsString>,
) -> Result<PathBuf, String> {
    if let Some(path) = configured.filter(|value| !value.is_empty()) {
        let path = PathBuf::from(path);
        if !path.is_absolute() {
            return Err("CODEX_HOME 必须为绝对路径".into());
        }
        return Ok(path);
    }
    user_home
        .filter(|value| !value.is_empty())
        .map(|path| PathBuf::from(path).join(".codex"))
        .ok_or_else(|| "无法确定用户目录，请配置 CODEX_HOME".into())
}

pub fn codex_home() -> Result<PathBuf, String> {
    let home = if cfg!(target_os = "windows") {
        "USERPROFILE"
    } else {
        "HOME"
    };
    resolve_home(std::env::var_os("CODEX_HOME"), std::env::var_os(home))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn home_paths_are_joined_with_the_host_platform_separator() {
        let root = std::env::temp_dir();
        assert_eq!(
            resolve_home(None, Some(root.clone().into_os_string())).unwrap(),
            root.join(".codex")
        );
        assert_eq!(
            resolve_home(Some(root.clone().into_os_string()), None).unwrap(),
            root
        );
        assert!(resolve_home(None, None).is_err());
        assert!(resolve_home(Some("relative/path".into()), None).is_err());
    }
}

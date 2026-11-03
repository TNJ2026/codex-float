use std::{path::Path, process::Command};

pub fn open_url(url: &str) -> Result<(), String> {
    let status = Command::new("/usr/bin/open")
        .arg(url)
        .status()
        .map_err(|_| "无法启动默认浏览器")?;
    if status.success() {
        Ok(())
    } else {
        Err("默认浏览器未能打开链接".into())
    }
}
pub fn reveal_file(path: &Path) -> Result<(), String> {
    let status = Command::new("/usr/bin/open")
        .arg("-R")
        .arg(path)
        .status()
        .map_err(|_| "无法启动 Finder")?;
    if status.success() {
        Ok(())
    } else {
        Err("Finder 未能定位此文件".into())
    }
}

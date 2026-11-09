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

pub fn open_file(path: &Path) -> Result<(), String> {
    let status = Command::new("/usr/bin/open")
        .arg(path)
        .status()
        .map_err(|_| "无法启动系统默认 App")?;
    if status.success() {
        Ok(())
    } else {
        Err("无法使用默认 App 打开文件，请检查系统文件关联设置".into())
    }
}

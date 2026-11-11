use std::{os::windows::ffi::OsStrExt, path::Path};

pub fn open_url(url: &str) -> Result<(), String> {
    let operation: Vec<u16> = "open\0".encode_utf16().collect();
    let target: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
    let result = unsafe {
        windows_sys::Win32::UI::Shell::ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        )
    };
    if result as isize <= 32 {
        return Err("无法启动默认浏览器，请检查系统默认应用设置".into());
    }
    Ok(())
}
fn explorer_path(path: &Path) -> Result<Vec<u16>, String> {
    let canonical = path.canonicalize().map_err(|_| "文件不存在或无法访问")?;
    let wide: Vec<u16> = canonical.as_os_str().encode_wide().collect();
    Ok(crate::platform::windows_path::shell_path(&wide))
}
pub fn open_file(path: &Path) -> Result<(), String> {
    let operation: Vec<u16> = "open\0".encode_utf16().collect();
    let target = explorer_path(path)?;
    let result = unsafe {
        windows_sys::Win32::UI::Shell::ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        )
    };
    if result as isize <= 32 {
        return Err("无法使用默认 App 打开文件，请检查系统文件关联设置".into());
    }
    Ok(())
}
pub fn reveal_file(path: &Path) -> Result<(), String> {
    use windows_sys::Win32::{
        System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
        UI::Shell::{ILCreateFromPathW, ILFree, SHOpenFolderAndSelectItems},
    };
    let wide = explorer_path(path)?;
    unsafe {
        let initialized = CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
        if initialized < 0 {
            return Err("无法初始化资源管理器".into());
        }
        let item = ILCreateFromPathW(wide.as_ptr());
        let result = if item.is_null() {
            Err("无法定位此文件".into())
        } else {
            let result = SHOpenFolderAndSelectItems(item, 0, std::ptr::null(), 0);
            ILFree(item);
            if result < 0 {
                Err("无法打开文件所在的文件夹".into())
            } else {
                Ok(())
            }
        };
        CoUninitialize();
        result
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explorer_receives_normalized_windows_paths() {
        let root = std::env::temp_dir();
        let slash = root.to_string_lossy().replace('\\', "/");
        let wide = explorer_path(Path::new(&slash)).unwrap();
        let value = String::from_utf16(&wide[..wide.len() - 1]).unwrap();
        assert!(!value.contains('/'));
        assert!(!value.starts_with(r"\\?\"));
    }
}

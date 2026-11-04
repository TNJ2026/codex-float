use windows_sys::Win32::{
    System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    },
    UI::Shell::DragQueryFileW,
};

pub fn write_text(text: &str, owner: isize) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::GlobalFree,
        System::{
            DataExchange::{EmptyClipboard, SetClipboardData},
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
        },
    };
    unsafe {
        let encoded: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let memory = GlobalAlloc(GMEM_MOVEABLE, encoded.len() * std::mem::size_of::<u16>());
        if memory.is_null() {
            return Err("无法分配剪贴板内存".into());
        }
        struct Memory(*mut std::ffi::c_void);
        impl Drop for Memory {
            fn drop(&mut self) {
                if !self.0.is_null() {
                    unsafe {
                        GlobalFree(self.0);
                    }
                }
            }
        }
        let mut allocation = Memory(memory);
        let pointer = GlobalLock(memory) as *mut u16;
        if pointer.is_null() {
            return Err("无法写入剪贴板内存".into());
        }
        std::ptr::copy_nonoverlapping(encoded.as_ptr(), pointer, encoded.len());
        GlobalUnlock(memory);
        if OpenClipboard(owner as *mut std::ffi::c_void) == 0 {
            return Err("剪贴板被占用，请重试复制".into());
        }
        struct Clipboard;
        impl Drop for Clipboard {
            fn drop(&mut self) {
                unsafe {
                    CloseClipboard();
                }
            }
        }
        let _guard = Clipboard;
        if EmptyClipboard() == 0 || SetClipboardData(13, memory).is_null() {
            return Err("无法写入剪贴板，请重试".into());
        }
        allocation.0 = std::ptr::null_mut();
        Ok(())
    }
}

pub fn file_paths() -> Result<Vec<String>, String> {
    unsafe {
        const CF_HDROP: u32 = 15;
        if IsClipboardFormatAvailable(CF_HDROP) == 0 {
            return Ok(Vec::new());
        }
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return Err("剪贴板暂时被占用，请重试粘贴".into());
        }
        struct Clipboard;
        impl Drop for Clipboard {
            fn drop(&mut self) {
                unsafe {
                    CloseClipboard();
                }
            }
        }
        let _guard = Clipboard;
        let handle = GetClipboardData(CF_HDROP);
        if handle.is_null() {
            return Err("无法读取剪贴板文件".into());
        }
        let count = DragQueryFileW(handle, u32::MAX, std::ptr::null_mut(), 0);
        if count > 20 {
            return Err("一次最多添加 20 个附件".into());
        }
        let mut paths = Vec::new();
        for index in 0..count {
            let length = DragQueryFileW(handle, index, std::ptr::null_mut(), 0);
            let mut path = vec![0u16; length as usize + 1];
            DragQueryFileW(handle, index, path.as_mut_ptr(), path.len() as u32);
            paths.push(String::from_utf16_lossy(&path[..length as usize]));
        }
        Ok(paths)
    }
}

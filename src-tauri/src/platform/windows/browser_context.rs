use crate::services::context::ContextItem;
use windows::{
    core::{Interface, PWSTR},
    Win32::{
        Foundation::CloseHandle,
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_MULTITHREADED,
            },
            Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
            Variant::VARIANT,
        },
        UI::{Accessibility::*, WindowsAndMessaging::GetWindowThreadProcessId},
    },
};

unsafe fn browser_name(element: &IUIAutomationElement) -> Option<String> {
    let hwnd = element.CurrentNativeWindowHandle().ok()?;
    let mut pid = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
    let mut buffer = vec![0u16; 4096];
    let mut length = buffer.len() as u32;
    let result = QueryFullProcessImageNameW(
        process,
        PROCESS_NAME_WIN32,
        PWSTR(buffer.as_mut_ptr()),
        &mut length,
    );
    let _ = CloseHandle(process);
    result.ok()?;
    let name = String::from_utf16_lossy(&buffer[..length as usize]);
    match std::path::Path::new(&name)
        .file_name()?
        .to_str()?
        .to_lowercase()
        .as_str()
    {
        "chrome.exe" => Some("Chrome".into()),
        "msedge.exe" => Some("Edge".into()),
        "brave.exe" => Some("Brave".into()),
        "firefox.exe" => Some("Firefox".into()),
        _ => None,
    }
}
unsafe fn read_window(
    automation: &IUIAutomation,
    window: &IUIAutomationElement,
    browser: String,
    limit: usize,
) -> Option<ContextItem> {
    let hwnd = window.CurrentNativeWindowHandle().ok()?;
    let mut pid = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    let browser_window_id = format!("{browser}:{pid}:{:x}", hwnd.0 as usize);
    let edits = automation
        .CreatePropertyCondition(
            UIA_ControlTypePropertyId,
            &VARIANT::from(UIA_EditControlTypeId.0),
        )
        .ok()?;
    let edits = window.FindAll(TreeScope_Descendants, &edits).ok()?;
    let mut url = String::new();
    let mut address_snapshot = None;
    for i in 0..edits.Length().ok()?.min(40) {
        let edit = edits.GetElement(i).ok()?;
        let name = edit
            .CurrentName()
            .unwrap_or_default()
            .to_string()
            .to_lowercase();
        if !(name.contains("地址") || name.contains("address") || name.contains("search or enter"))
        {
            continue;
        }
        if edit.CurrentIsPassword().unwrap_or_default().as_bool() {
            continue;
        }
        if let Ok(value) = edit.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
        {
            let value = value.CurrentValue().unwrap_or_default().to_string();
            let candidate = if value.contains("://") {
                value.clone()
            } else {
                format!("https://{value}")
            };
            if let Ok(parsed) = tauri::Url::parse(&candidate) {
                if matches!(parsed.scheme(), "http" | "https") && parsed.host_str().is_some() {
                    url = parsed.to_string();
                    address_snapshot = Some((edit.clone(), value));
                    break;
                }
            }
        }
    }
    if url.is_empty() {
        return None;
    }
    let condition = automation
        .CreatePropertyCondition(
            UIA_ControlTypePropertyId,
            &VARIANT::from(UIA_DocumentControlTypeId.0),
        )
        .ok()?;
    let docs = window.FindAll(TreeScope_Descendants, &condition).ok()?;
    let mut title = window.CurrentName().unwrap_or_default().to_string();
    let mut selection = String::new();
    let mut body = String::new();
    let mut truncated = false;
    for i in 0..docs.Length().ok()?.min(8) {
        let doc = docs.GetElement(i).ok()?;
        if doc.CurrentIsOffscreen().unwrap_or_default().as_bool() {
            continue;
        }
        let name = doc.CurrentName().unwrap_or_default().to_string();
        if !name.is_empty() {
            title = name;
        }
        if let Ok(pattern) = doc.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
        {
            if let Ok(range) = pattern.DocumentRange() {
                if let Ok(text) = range.GetText((limit + 1) as i32) {
                    let text = text.to_string();
                    truncated = text.chars().count() > limit;
                    body = text.trim().chars().take(limit).collect();
                }
            }
            if let Ok(ranges) = pattern.GetSelection() {
                for j in 0..ranges.Length().unwrap_or(0).min(4) {
                    if let Ok(range) = ranges.GetElement(j) {
                        let value = range.GetText(limit as i32).unwrap_or_default().to_string();
                        if !value.trim().is_empty() {
                            selection.push_str(&value);
                            selection.push('\n');
                        }
                    }
                }
            }
        }
        // Some browser accessibility providers expose text nodes instead of TextPattern.
        if body.is_empty() {
            if let Ok(condition) = automation.CreatePropertyCondition(
                UIA_ControlTypePropertyId,
                &VARIANT::from(UIA_TextControlTypeId.0),
            ) {
                if let Ok(nodes) = doc.FindAll(TreeScope_Descendants, &condition) {
                    let count = nodes.Length().unwrap_or(0);
                    let mut remaining = limit;
                    for index in 0..count.min(3000) {
                        let Ok(node) = nodes.GetElement(index) else {
                            continue;
                        };
                        if node.CurrentIsPassword().unwrap_or_default().as_bool() {
                            continue;
                        }
                        let text = node.CurrentName().unwrap_or_default().to_string();
                        let text = text.trim();
                        if text.is_empty() {
                            continue;
                        }
                        if remaining == 0 {
                            truncated = true;
                            break;
                        }
                        let part: String = text.chars().take(remaining).collect();
                        remaining -= part.chars().count();
                        body.push_str(&part);
                        if text.chars().count() > part.chars().count() {
                            truncated = true;
                        }
                        if remaining > 0 {
                            body.push('\n');
                            remaining -= 1;
                        }
                    }
                    if count > 3000 {
                        truncated = true;
                    }
                }
            }
        }
        break;
    }
    if let Some((edit, original)) = address_snapshot {
        let current = edit
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            .ok()?
            .CurrentValue()
            .ok()?
            .to_string();
        if current != original {
            return None;
        }
    }
    Some(ContextItem {
        kind: "browser".into(),
        label: if title.is_empty() { url.clone() } else { title },
        url,
        content: if body.is_empty() {
            selection.trim().chars().take(limit).collect()
        } else {
            body.trim().into()
        },
        content_type: if body.is_empty() {
            "selection".into()
        } else {
            "body".into()
        },
        browser_window_id,
        auto_update: true,
        truncated,
        description: if body.is_empty() {
            "未能读取正文，仅包含网址或选中文字".into()
        } else if truncated {
            format!("正文已截断，上限 {limit} 字符")
        } else {
            "已读取网页正文".into()
        },
        source: browser,
        ..Default::default()
    })
}
#[cfg(test)]
pub fn read_pages() -> Result<Vec<ContextItem>, String> {
    read_pages_with_limit(32_000)
}
pub fn read_pages_with_limit(limit: usize) -> Result<Vec<ContextItem>, String> {
    let limit = limit.clamp(1000, 100_000);
    // Keep the UI Automation apartment independent of native file dialogs on the worker pool.
    std::thread::spawn(move || scan_pages(limit))
        .join()
        .map_err(|_| "读取浏览器上下文失败".to_string())?
}
fn scan_pages(limit: usize) -> Result<Vec<ContextItem>, String> {
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_MULTITHREADED);
        initialized.ok().map_err(|e| e.to_string())?;
        struct Apartment;
        impl Drop for Apartment {
            fn drop(&mut self) {
                unsafe {
                    CoUninitialize();
                }
            }
        }
        let _apartment = Apartment;
        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| e.to_string())?;
        if let Ok(settings) = automation.cast::<IUIAutomation2>() {
            let _ = settings.SetConnectionTimeout(1500);
            let _ = settings.SetTransactionTimeout(2000);
        }
        let root = automation.GetRootElement().map_err(|e| e.to_string())?;
        let condition = automation
            .CreateTrueCondition()
            .map_err(|e| e.to_string())?;
        let windows = root
            .FindAll(TreeScope_Children, &condition)
            .map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for i in 0..windows.Length().unwrap_or(0).min(100) {
            let Ok(window) = windows.GetElement(i) else {
                continue;
            };
            if let Some(browser) = browser_name(&window) {
                if let Some(page) = read_window(&automation, &window, browser, limit) {
                    result.push(page);
                }
            }
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "read-only browser accessibility integration check"]
    fn live_browser_context() {
        let pages = super::read_pages().expect("read browser context");
        println!("browser contexts: {}", pages.len());
        println!(
            "pages with body: {}, body characters: {}",
            pages
                .iter()
                .filter(|page| page.content_type == "body")
                .count(),
            pages
                .iter()
                .filter(|page| page.content_type == "body")
                .map(|page| page.content.chars().count())
                .sum::<usize>()
        );
        assert!(
            !pages.is_empty(),
            "open a supported browser page before running this check"
        );
        assert!(pages
            .iter()
            .all(|page| page.url.starts_with("http://") || page.url.starts_with("https://")));
    }
}

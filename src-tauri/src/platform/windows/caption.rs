use resvg::{
    tiny_skia::{Pixmap, Transform},
    usvg::{Options, Tree},
};
use std::{cell::Cell, io, mem::size_of, ptr::null_mut, slice, sync::OnceLock};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows_sys::w;
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM},
    Graphics::{
        Dwm::{DwmGetWindowAttribute, DWMWA_CAPTION_BUTTON_BOUNDS, DWMWA_USE_IMMERSIVE_DARK_MODE},
        Gdi::*,
    },
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Controls::WM_MOUSELEAVE,
        HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi},
        Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TRACKMOUSEEVENT},
        Shell::{DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::*,
    },
};

const CLASS: *const u16 = w!("CodexFloatCaptionActions");
const SETTINGS: u32 = 0x1fe0;
const PIN: u32 = 0x1ff0;
const SUBCLASS: usize = 1;
static ICONS: OnceLock<[Tree; 2]> = OnceLock::new();

struct Caption {
    overlay: HWND,
    app: AppHandle,
    icons: WindowIcons,
}

#[derive(Default)]
struct WindowIcons {
    handles: Cell<[HICON; 2]>,
    dpi: Cell<u32>,
}

impl WindowIcons {
    unsafe fn refresh(&self, hwnd: HWND) {
        let dpi = GetDpiForWindow(hwnd).max(96);
        if self.dpi.get() == dpi {
            return;
        }
        let instance = GetModuleHandleW(std::ptr::null());
        let resource = tauri::utils::platform::WINDOWS_APP_ICON_RESOURCE_ID as usize as *const u16;
        let small = LoadImageW(
            instance,
            resource,
            IMAGE_ICON,
            GetSystemMetricsForDpi(SM_CXSMICON, dpi),
            GetSystemMetricsForDpi(SM_CYSMICON, dpi),
            LR_DEFAULTCOLOR,
        );
        let large = LoadImageW(
            instance,
            resource,
            IMAGE_ICON,
            GetSystemMetricsForDpi(SM_CXICON, dpi),
            GetSystemMetricsForDpi(SM_CYICON, dpi),
            LR_DEFAULTCOLOR,
        );
        if small.is_null() || large.is_null() {
            for icon in [small, large] {
                if !icon.is_null() {
                    DestroyIcon(icon);
                }
            }
            return;
        }
        // Keep the native ICO alpha and per-DPI sizes, without an RGBA round trip.
        let previous = self.handles.replace([small, large]);
        self.dpi.set(dpi);
        SendMessageW(hwnd, WM_SETICON, ICON_SMALL as usize, small as isize);
        SendMessageW(hwnd, WM_SETICON, ICON_BIG as usize, large as isize);
        for icon in previous {
            if !icon.is_null() {
                DestroyIcon(icon);
            }
        }
    }
}

impl Drop for WindowIcons {
    fn drop(&mut self) {
        for icon in self.handles.get() {
            if !icon.is_null() {
                unsafe {
                    DestroyIcon(icon);
                }
            }
        }
    }
}

pub fn install(window: &WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    let owner = window.hwnd()?.0;
    unsafe {
        let instance = GetModuleHandleW(std::ptr::null());
        if RegisterClassW(&WNDCLASSW {
            lpfnWndProc: Some(overlay_proc),
            hInstance: instance,
            hCursor: LoadCursorW(null_mut(), IDC_ARROW),
            lpszClassName: CLASS,
            ..Default::default()
        }) == 0
        {
            return Err(io::Error::last_os_error().into());
        }
        // The owned layer follows the window's stacking order without stealing focus
        // or replacing the system's caption, hit targets, or Snap Layouts.
        let overlay = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
            CLASS,
            w!("CodexFloat 标题栏操作"),
            WS_POPUP,
            0,
            0,
            0,
            0,
            owner,
            null_mut(),
            instance,
            std::ptr::null(),
        );
        if overlay.is_null() {
            return Err(io::Error::last_os_error().into());
        }
        let caption = Box::into_raw(Box::new(Caption {
            overlay,
            app: window.app_handle().clone(),
            icons: WindowIcons::default(),
        }));
        if SetWindowSubclass(owner, Some(owner_proc), SUBCLASS, caption as usize) == 0 {
            let error = io::Error::last_os_error();
            drop(Box::from_raw(caption));
            DestroyWindow(overlay);
            return Err(error.into());
        }
        let menu = GetSystemMenu(owner, 0);
        if !menu.is_null() {
            AppendMenuW(menu, MF_SEPARATOR, 0, std::ptr::null());
            AppendMenuW(menu, MF_STRING, SETTINGS as usize, w!("设置"));
            AppendMenuW(menu, MF_STRING, PIN as usize, w!("切换置顶"));
        }
        (*caption).icons.refresh(owner);
        update(owner, overlay);
    }
    Ok(())
}

pub fn refresh(hwnd: HWND) {
    unsafe {
        let mut data = 0;
        if GetWindowSubclass(hwnd, Some(owner_proc), SUBCLASS, &mut data) != 0 {
            update(hwnd, (*(data as *const Caption)).overlay);
        }
    }
}

pub fn refresh_language(hwnd: HWND) {
    let text = crate::services::ui_language::text;
    unsafe {
        let menu = GetSystemMenu(hwnd, 0);
        for (id, label) in [
            (SETTINGS, text("设置", "Settings")),
            (PIN, text("切换置顶", "Toggle always on top")),
        ] {
            let label: Vec<u16> = label.encode_utf16().chain(Some(0)).collect();
            ModifyMenuW(
                menu,
                id,
                MF_BYCOMMAND | MF_STRING,
                id as usize,
                label.as_ptr(),
            );
        }
        DrawMenuBar(hwnd);
    }
}

unsafe extern "system" fn owner_proc(
    hwnd: HWND,
    msg: u32,
    wp: WPARAM,
    lp: LPARAM,
    _: usize,
    data: usize,
) -> LRESULT {
    let caption = &*(data as *const Caption);
    let overlay = caption.overlay;
    if msg == WM_NCDESTROY {
        RemoveWindowSubclass(hwnd, Some(owner_proc), SUBCLASS);
        DestroyWindow(overlay);
        drop(Box::from_raw(data as *mut Caption));
        return DefSubclassProc(hwnd, msg, wp, lp);
    }
    if msg == WM_NCHITTEST && crate::services::mini_mode::is_compact(&caption.app) {
        return HTCLIENT as LRESULT;
    }
    if msg == WM_SYSCOMMAND {
        match wp as u32 & 0xfff0 {
            SC_MINIMIZE => {
                if !crate::services::mini_mode::is_compact(&caption.app) {
                    let _ = caption.app.emit("windows-caption-action", "mini");
                    return 0;
                }
            }
            SETTINGS => {
                let _ = caption.app.emit("windows-caption-action", "settings");
                return 0;
            }
            PIN => {
                if let Some(window) = caption.app.get_webview_window("main") {
                    if let Ok(pinned) = window.is_always_on_top() {
                        let _ = window.set_always_on_top(!pinned);
                    }
                }
                return 0;
            }
            _ => {}
        }
    }
    let result = DefSubclassProc(hwnd, msg, wp, lp);
    if matches!(msg, WM_DPICHANGED | WM_SETTINGCHANGE) {
        caption.icons.refresh(hwnd);
    }
    if matches!(
        msg,
        WM_WINDOWPOSCHANGED
            | WM_STYLECHANGED
            | WM_ACTIVATE
            | WM_THEMECHANGED
            | WM_SETTINGCHANGE
            | WM_DPICHANGED
            | WM_DWMCOMPOSITIONCHANGED
            | WM_DWMCOLORIZATIONCOLORCHANGED
    ) && IsWindow(overlay) != 0
    {
        update(hwnd, overlay);
    }
    result
}

unsafe extern "system" fn overlay_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    let owner = GetWindow(hwnd, GW_OWNER);
    match msg {
        WM_MOUSEACTIVATE => return MA_NOACTIVATE as LRESULT,
        WM_MOUSEMOVE | WM_LBUTTONDOWN | WM_LBUTTONUP => {
            let mut bounds = RECT::default();
            GetClientRect(hwnd, &mut bounds);
            let x = lp as i16 as i32;
            let action = if x < bounds.right / 2 { 1 } else { 2 };
            let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA);
            let pressed = state >> 2;
            if msg == WM_LBUTTONDOWN {
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, action | (action << 2));
            } else if msg == WM_LBUTTONUP {
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, action);
                if pressed == action {
                    SetForegroundWindow(owner);
                    PostMessageW(
                        owner,
                        WM_SYSCOMMAND,
                        if action == 1 { SETTINGS } else { PIN } as usize,
                        0,
                    );
                }
            } else if state & 3 != action {
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, action | (pressed << 2));
                TrackMouseEvent(&mut TRACKMOUSEEVENT {
                    cbSize: size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: TME_LEAVE,
                    hwndTrack: hwnd,
                    dwHoverTime: 0,
                });
                update(owner, hwnd);
            }
            return 0;
        }
        WM_MOUSELEAVE => {
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            update(owner, hwnd);
            return 0;
        }
        _ => {}
    }
    DefWindowProcW(hwnd, msg, wp, lp)
}

unsafe fn update(owner: HWND, overlay: HWND) {
    if IsWindowVisible(owner) == 0 || IsIconic(owner) != 0 {
        ShowWindow(overlay, SW_HIDE);
        return;
    }
    let dpi = GetDpiForWindow(owner).max(96) as i32;
    let width = 2 * (40 * dpi / 96);
    let Some((right, top, height)) = caption_anchor(owner) else {
        ShowWindow(overlay, SW_HIDE);
        return;
    };
    let position = POINT {
        x: right - width,
        y: top,
    };
    let mut dark = 0i32;
    DwmGetWindowAttribute(
        owner,
        DWMWA_USE_IMMERSIVE_DARK_MODE as u32,
        (&mut dark as *mut i32).cast(),
        size_of::<i32>() as u32,
    );
    let pinned = GetWindowLongW(owner, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST != 0;
    let painted = paint(
        overlay,
        position,
        SIZE {
            cx: width,
            cy: height,
        },
        dpi,
        dark != 0,
        pinned,
    );
    if painted && IsWindowVisible(overlay) == 0 {
        ShowWindow(overlay, SW_SHOWNOACTIVATE);
    }
}

unsafe fn caption_anchor(owner: HWND) -> Option<(i32, i32, i32)> {
    if let Some((height, right_inset)) = super::desktop_acrylic::caption_metrics() {
        let mut client = RECT::default();
        let mut origin = POINT::default();
        if GetClientRect(owner, &mut client) != 0 && ClientToScreen(owner, &mut origin) != 0 {
            return Some((origin.x + client.right - right_inset, origin.y, height));
        }
    }
    let mut window = RECT::default();
    let mut buttons = RECT::default();
    let style = GetWindowLongW(owner, GWL_STYLE) as u32;
    if style & WS_CAPTION != WS_CAPTION
        || GetWindowRect(owner, &mut window) == 0
        || DwmGetWindowAttribute(
            owner,
            DWMWA_CAPTION_BUTTON_BOUNDS as u32,
            (&mut buttons as *mut RECT).cast(),
            size_of::<RECT>() as u32,
        ) < 0
        || buttons.right <= buttons.left
        || buttons.bottom <= buttons.top
    {
        return None;
    }
    Some((
        window.left + buttons.left,
        window.top + buttons.top,
        buttons.bottom - buttons.top,
    ))
}

unsafe fn paint(
    hwnd: HWND,
    position: POINT,
    size: SIZE,
    dpi: i32,
    dark: bool,
    pinned: bool,
) -> bool {
    let dc = CreateCompatibleDC(null_mut());
    if dc.is_null() {
        return false;
    }
    let mut bits = null_mut();
    let bitmap = CreateDIBSection(
        dc,
        &BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: size.cx,
                biHeight: -size.cy,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..Default::default()
            },
            ..Default::default()
        },
        DIB_RGB_COLORS,
        &mut bits,
        null_mut(),
        0,
    );
    if bitmap.is_null() {
        DeleteDC(dc);
        return false;
    }
    let previous = SelectObject(dc, bitmap);
    let pixels = slice::from_raw_parts_mut(bits.cast::<u32>(), (size.cx * size.cy) as usize);
    pixels.fill(0);
    let half = size.cx / 2;
    let side = (14 * dpi / 96).min(half).min(size.cy);
    let icons = ICONS.get_or_init(|| {
        [
            include_str!("../../../../src/assets/settings.svg"),
            include_str!("../../../../src/assets/pin.svg"),
        ]
        .map(|svg| Tree::from_str(svg, &Options::default()).expect("valid caption icon SVG"))
    });
    if let Some(mut icon) = Pixmap::new(side as u32, side as u32) {
        for (button, tree) in icons.iter().enumerate() {
            icon.fill(resvg::tiny_skia::Color::TRANSPARENT);
            let scale = side as f32 / tree.size().width().max(tree.size().height());
            resvg::render(
                tree,
                Transform::from_scale(scale, scale),
                &mut icon.as_mut(),
            );
            let left = button as i32 * half + (half - side) / 2;
            let top = (size.cy - side) / 2;
            for (row, icon_row) in icon.pixels().chunks_exact(side as usize).enumerate() {
                let start = ((top + row as i32) * size.cx + left) as usize;
                for (pixel, source) in pixels[start..start + side as usize]
                    .iter_mut()
                    .zip(icon_row)
                {
                    *pixel = u32::from(source.alpha());
                }
            }
        }
    }
    let hover = GetWindowLongPtrW(hwnd, GWLP_USERDATA) & 3;
    let pin_blue = if dark {
        [0x60, 0xb9, 0xff]
    } else {
        [0x00, 0x78, 0xd4]
    };
    for (index, pixel) in pixels.iter_mut().enumerate() {
        let button = 1 + (index as i32 % size.cx / half) as isize;
        let ink = *pixel & 0xff;
        // Nonzero alpha keeps the entire button clickable on a layered window.
        let wash = if hover == button { 28 } else { 1 };
        let background_alpha = (255 - ink) * wash / 255;
        let alpha = ink + background_alpha;
        let color = if button == 2 && pinned {
            let background = if dark { background_alpha } else { 0 };
            let [red, green, blue] = pin_blue.map(|channel| channel * ink / 255 + background);
            (red << 16) | (green << 8) | blue
        } else if dark {
            alpha * 0x010101
        } else {
            0
        };
        *pixel = (alpha << 24) | color;
    }
    let blend = BLENDFUNCTION {
        BlendOp: AC_SRC_OVER as u8,
        BlendFlags: 0,
        SourceConstantAlpha: 255,
        AlphaFormat: AC_SRC_ALPHA as u8,
    };
    let painted = UpdateLayeredWindow(
        hwnd,
        null_mut(),
        &position,
        &size,
        dc,
        &POINT::default(),
        0,
        &blend,
        ULW_ALPHA,
    ) != 0;
    SelectObject(dc, previous);
    DeleteObject(bitmap);
    DeleteDC(dc);
    painted
}

use objc2::{
    define_class, msg_send, rc::Retained, runtime::ProtocolObject, sel, AnyThread, DefinedClass,
    MainThreadMarker, MainThreadOnly,
};
use objc2_app_kit::{
    NSButton, NSButtonType, NSCellImagePosition, NSColor, NSImage, NSImageScaling,
    NSImageSymbolConfiguration, NSImageSymbolScale, NSToolbar, NSToolbarDelegate,
    NSToolbarDisplayMode, NSToolbarItem, NSToolbarItemIdentifier, NSWindow, NSWindowStyleMask,
    NSWindowTitleVisibility, NSWindowToolbarStyle,
};
use objc2_foundation::{
    NSArray, NSData, NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString,
};
use std::cell::RefCell;
use tauri::{Emitter, Manager, WebviewWindow};

struct Context {
    app: tauri::AppHandle,
}
thread_local! {
    // NSToolbar's delegate and item targets are weak references. Retain them
    // on the AppKit thread for the lifetime of the main window.
    static TOOLBAR: RefCell<Option<(Retained<NSToolbar>, Retained<ToolbarDelegate>)>> = const { RefCell::new(None) };
}

fn identifiers() -> Retained<NSArray<NSString>> {
    NSArray::from_retained_slice(&[
        NSString::from_str("NSToolbarFlexibleSpaceItem"),
        NSString::from_str("float.settings"),
        NSString::from_str("float.pin"),
        NSString::from_str("float.mini"),
    ])
}
fn image(symbol: &str, label: &str) -> Option<Retained<NSImage>> {
    let image = NSImage::imageWithSystemSymbolName_accessibilityDescription(
        &NSString::from_str(symbol),
        Some(&NSString::from_str(label)),
    )?;
    let configuration = NSImageSymbolConfiguration::configurationWithPointSize_weight_scale(
        16.0,
        0.0,
        NSImageSymbolScale::Medium,
    );
    image
        .imageWithSymbolConfiguration(&configuration)
        .or(Some(image))
}
fn vector_image(bytes: &[u8], label: &str) -> Option<Retained<NSImage>> {
    let data = NSData::with_bytes(bytes);
    let icon = NSImage::initWithData(NSImage::alloc(), &data);
    if let Some(icon) = &icon {
        icon.setSize(NSSize::new(16.0, 16.0));
        icon.setTemplate(true);
        icon.setAccessibilityDescription(Some(&NSString::from_str(label)));
    }
    icon
}
fn pin_item(item: &NSToolbarItem, pinned: bool) {
    let label = if pinned { "取消置顶" } else { "置顶" };
    item.setLabel(&NSString::from_str(label));
    item.setToolTip(Some(&NSString::from_str(label)));
    let icon = vector_image(include_bytes!("../../../icons/pin-template.pdf"), label);
    item.setImage(icon.as_deref());
    if let Some(view) = item.view() {
        if let Some(button) = view.downcast_ref::<NSButton>() {
            button.setImage(icon.as_deref());
            button.setState(if pinned { 1 } else { 0 });
            let tint = pinned.then(NSColor::controlAccentColor);
            button.setContentTintColor(tint.as_deref());
            button.setToolTip(Some(&NSString::from_str(label)));
            unsafe {
                let _: () = msg_send![button, setAccessibilityLabel: &*NSString::from_str(label)];
            }
        }
    }
}
fn perform(app: &tauri::AppHandle, action: &str) {
    if action == "pin" {
        if let Some(window) = app.get_webview_window("main") {
            let pinned = !window.is_always_on_top().unwrap_or(false);
            if window.set_always_on_top(pinned).is_ok() {
                TOOLBAR.with(|slot| {
                    if let Some((toolbar, _)) = slot.borrow().as_ref() {
                        for item in toolbar.items() {
                            if item.itemIdentifier().to_string() == "float.pin" {
                                pin_item(&item, pinned);
                            }
                        }
                    }
                });
            }
        }
    } else {
        let _ = app.emit("native-titlebar-action", action);
    }
}

define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = Context]
    struct ToolbarDelegate;
    unsafe impl NSObjectProtocol for ToolbarDelegate {}
    unsafe impl NSToolbarDelegate for ToolbarDelegate {
        #[unsafe(method_id(toolbarDefaultItemIdentifiers:))]
        fn defaults(&self, _toolbar: &NSToolbar) -> Retained<NSArray<NSToolbarItemIdentifier>> { identifiers() }
        #[unsafe(method_id(toolbarAllowedItemIdentifiers:))]
        fn allowed(&self, _toolbar: &NSToolbar) -> Retained<NSArray<NSToolbarItemIdentifier>> { identifiers() }
        #[unsafe(method_id(toolbar:itemForItemIdentifier:willBeInsertedIntoToolbar:))]
        fn item(&self, _toolbar: &NSToolbar, identifier: &NSToolbarItemIdentifier, _inserted: bool) -> Option<Retained<NSToolbarItem>> {
            self.make_item(identifier)
        }
    }
    impl ToolbarDelegate {
        #[unsafe(method(openSettings:))]
        fn open_settings(&self, _sender: &objc2::runtime::AnyObject) { perform(&self.ivars().app, "settings"); }
        #[unsafe(method(togglePin:))]
        fn toggle_pin(&self, _sender: &objc2::runtime::AnyObject) { perform(&self.ivars().app, "pin"); }
        #[unsafe(method(activate:))]
        fn activate(&self, sender: &NSToolbarItem) {
            if let Some(action) = sender.itemIdentifier().to_string().strip_prefix("float.") { perform(&self.ivars().app, action); }
        }
    }
);

impl ToolbarDelegate {
    fn make_item(&self, identifier: &NSToolbarItemIdentifier) -> Option<Retained<NSToolbarItem>> {
        let (label, symbol) = match identifier.to_string().as_str() {
            "float.settings" => ("设置", "gearshape"),
            "float.pin" => ("置顶", "pin"),
            "float.mini" => ("切换为悬浮状态球", "smallcircle.filled.circle"),
            _ => return None,
        };
        let item =
            NSToolbarItem::initWithItemIdentifier(NSToolbarItem::alloc(self.mtm()), identifier);
        item.setLabel(&NSString::from_str(label));
        item.setToolTip(Some(&NSString::from_str(label)));
        item.setImage(image(symbol, label).as_deref());
        item.setBordered(false);
        if matches!(
            identifier.to_string().as_str(),
            "float.pin" | "float.settings"
        ) {
            let button = NSButton::new(self.mtm());
            button.setTitle(&NSString::from_str(""));
            button.setButtonType(if identifier.to_string() == "float.pin" {
                NSButtonType::PushOnPushOff
            } else {
                NSButtonType::MomentaryLight
            });
            button.setImagePosition(NSCellImagePosition::ImageOnly);
            button.setBordered(false);
            button.setImageScaling(NSImageScaling::ScaleNone);
            button.setFrame(NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(28.0, 28.0)));
            item.setView(Some(&button));
            if identifier.to_string() == "float.settings" {
                let icon = vector_image(
                    include_bytes!("../../../icons/settings-template.pdf"),
                    label,
                );
                item.setImage(icon.as_deref());
                button.setImage(icon.as_deref());
                button.setToolTip(Some(&NSString::from_str(label)));
                unsafe {
                    let _: () =
                        msg_send![&*button, setAccessibilityLabel: &*NSString::from_str(label)];
                }
            }
        }
        if identifier.to_string() == "float.pin" {
            pin_item(
                &item,
                self.ivars()
                    .app
                    .get_webview_window("main")
                    .is_some_and(|w| w.is_always_on_top().unwrap_or(false)),
            );
        }
        // SAFETY: This retained delegate implements the exact target selector.
        unsafe {
            item.setTarget(Some(self));
            item.setAction(Some(if identifier.to_string() == "float.pin" {
                sel!(togglePin:)
            } else if identifier.to_string() == "float.settings" {
                sel!(openSettings:)
            } else {
                sel!(activate:)
            }));
        }
        Some(item)
    }
}

pub fn install(window: &WebviewWindow) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("工具栏必须在主线程创建")?;
    let pointer = window.ns_window().map_err(|e| e.to_string())?;
    if pointer.is_null() {
        return Err("无法获取原生窗口".into());
    }
    let object = ToolbarDelegate::alloc(mtm).set_ivars(Context {
        app: window.app_handle().clone(),
    });
    // SAFETY: NSObject init and Tauri's NSWindow are valid on the AppKit thread.
    unsafe {
        let delegate: Retained<ToolbarDelegate> = msg_send![super(object), init];
        let toolbar = NSToolbar::initWithIdentifier(
            NSToolbar::alloc(mtm),
            &NSString::from_str("local.codex.float.toolbar"),
        );
        toolbar.setAllowsUserCustomization(false);
        toolbar.setDisplayMode(NSToolbarDisplayMode::IconOnly);
        toolbar.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        let native = &*pointer.cast::<NSWindow>();
        native.setTitle(&NSString::from_str("Codex Float"));
        native.setTitleVisibility(NSWindowTitleVisibility::Visible);
        native.setTitlebarAppearsTransparent(true);
        native.setToolbarStyle(NSWindowToolbarStyle::Unified);
        native.setToolbar(Some(&toolbar));
        native.setStyleMask(native.styleMask() | NSWindowStyleMask::FullSizeContentView);
        TOOLBAR.with(|slot| *slot.borrow_mut() = Some((toolbar, delegate)));
    }
    Ok(())
}

pub fn set_visible(visible: bool) {
    TOOLBAR.with(|slot| {
        if let Some((toolbar, _)) = slot.borrow().as_ref() {
            toolbar.setVisible(visible);
        }
    });
}
pub fn height(window: &WebviewWindow) -> f64 {
    if MainThreadMarker::new().is_none() {
        return 52.0;
    }
    let Ok(pointer) = window.ns_window() else {
        return 52.0;
    };
    if pointer.is_null() {
        return 52.0;
    }
    // AppKit owns the toolbar's actual height; no assumed traffic-light offsets.
    unsafe {
        let native = &*pointer.cast::<NSWindow>();
        let layout = native.contentLayoutRect();
        let Some(view) = native.contentView() else {
            return 0.0;
        };
        let bounds = view.bounds();
        let safe = view.convertRect_fromView(layout, None);
        let inset = if view.isFlipped() {
            safe.origin.y - bounds.origin.y
        } else {
            bounds.origin.y + bounds.size.height - safe.origin.y - safe.size.height
        };
        inset.clamp(0.0, 200.0)
    }
}
pub fn publish_layout(window: &WebviewWindow) {
    let _ = window.emit("native-titlebar-layout", height(window));
}

pub fn install_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuItem, MenuItemKind, PredefinedMenuItem};
    if let Some(menu) = app.menu() {
        for (index, item) in menu.items()?.into_iter().enumerate() {
            if let MenuItemKind::Submenu(submenu) = item {
                if index == 0 {
                    submenu.insert(
                        &MenuItem::with_id(
                            app,
                            "float.settings",
                            "设置…",
                            true,
                            Some("CmdOrCtrl+,"),
                        )?,
                        2,
                    )?;
                    submenu.insert(&PredefinedMenuItem::separator(app)?, 3)?;
                }
                if ["Window", "窗口"].contains(&submenu.text()?.as_str()) {
                    submenu.append(&MenuItem::with_id(
                        app,
                        "float.pin",
                        "切换置顶",
                        true,
                        None::<&str>,
                    )?)?;
                    submenu.append(&MenuItem::with_id(
                        app,
                        "float.mini",
                        "切换为悬浮状态球",
                        true,
                        None::<&str>,
                    )?)?;
                }
            }
        }
    }
    app.on_menu_event(|app, event| {
        if let Some(action) = event.id().as_ref().strip_prefix("float.") {
            perform(app, action);
        }
    });
    Ok(())
}

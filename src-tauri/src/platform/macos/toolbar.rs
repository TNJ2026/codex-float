use crate::services::ui_language::text;
use objc2::{
    define_class, msg_send, rc::Retained, runtime::ProtocolObject, sel, AnyThread, DefinedClass,
    MainThreadMarker, MainThreadOnly,
};
use objc2_app_kit::{
    NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSButton,
    NSButtonType, NSCellImagePosition, NSColor, NSImage, NSImageScaling,
    NSImageSymbolConfiguration, NSImageSymbolScale, NSLayoutAttribute, NSStackView, NSToolbar,
    NSToolbarDelegate, NSToolbarDisplayMode, NSToolbarItem, NSToolbarItemIdentifier,
    NSUserInterfaceLayoutOrientation, NSView, NSWindow, NSWindowButton, NSWindowStyleMask,
    NSWindowTitleVisibility, NSWindowToolbarStyle,
};
use objc2_foundation::{
    NSArray, NSData, NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString,
};
use std::cell::RefCell;
use tauri::{Emitter, Manager, WebviewWindow};

struct Context {
    app: tauri::AppHandle,
    actions: RefCell<Vec<Retained<NSToolbarItem>>>,
}
thread_local! {
    // NSToolbar's delegate and item targets are weak references. Retain them
    // on the AppKit thread for the lifetime of the main window.
    static TOOLBAR: RefCell<Option<(Retained<NSToolbar>, Retained<ToolbarDelegate>)>> = const { RefCell::new(None) };
}

fn identifiers() -> Retained<NSArray<NSString>> {
    NSArray::from_retained_slice(&[
        NSString::from_str("NSToolbarFlexibleSpaceItem"),
        NSString::from_str("float.actions"),
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
fn apply_button_tint(button: &NSButton) {
    // Resolve the window's actual appearance, including an explicit app theme.
    let names = NSArray::from_slice(unsafe { &[NSAppearanceNameAqua, NSAppearanceNameDarkAqua] });
    let light = button
        .effectiveAppearance()
        .bestMatchFromAppearancesWithNames(&names)
        .is_some_and(|name| name.isEqualToString(unsafe { NSAppearanceNameAqua }));
    let pinned = button.tag() == 1 && button.state() == 1;
    let tint = if light {
        Some(if pinned {
            NSColor::colorWithSRGBRed_green_blue_alpha(0.0, 0.32, 0.66, 1.0)
        } else {
            NSColor::colorWithSRGBRed_green_blue_alpha(0.20, 0.22, 0.25, 1.0)
        })
    } else {
        pinned.then(NSColor::controlAccentColor)
    };
    button.setContentTintColor(tint.as_deref());
}

define_class!(
    #[unsafe(super = NSView)]
    #[thread_kind = MainThreadOnly]
    #[ivars = Retained<NSStackView>]
    struct ToolbarActionsView;
    unsafe impl NSObjectProtocol for ToolbarActionsView {}
    impl ToolbarActionsView {
        #[unsafe(method(layout))]
        fn layout_actions(&self) {
            unsafe { let _: () = msg_send![super(self), layout]; }
            let bounds = self.bounds();
            let mut inset = 0.0_f64;
            if let Some(window) = self.window() {
                if let Some(close) = window.standardWindowButton(NSWindowButton::CloseButton) {
                    let left = close.convertRect_toView(close.bounds(), None).origin.x;
                    let frame = self.convertRect_toView(bounds, None);
                    let right = window.frame().size.width - frame.origin.x - frame.size.width;
                    // Include the icon's six-point inset inside its 28-point
                    // hit target, so the visible edges mirror the system controls.
                    inset = (left - right - 6.0).clamp(0.0, 24.0);
                }
            }
            self.ivars().setFrame(NSRect::new(
                NSPoint::new(bounds.size.width - 92.0 - inset, (bounds.size.height - 28.0) / 2.0),
                NSSize::new(92.0, 28.0),
            ));
        }
        #[unsafe(method(viewDidMoveToWindow))]
        fn moved_to_window(&self) {
            unsafe { let _: () = msg_send![super(self), viewDidMoveToWindow]; }
            self.setNeedsLayout(true);
        }
    }
);

define_class!(
    #[unsafe(super = NSButton)]
    #[thread_kind = MainThreadOnly]
    struct ToolbarButton;
    unsafe impl NSObjectProtocol for ToolbarButton {}
    impl ToolbarButton {
        #[unsafe(method(viewDidChangeEffectiveAppearance))]
        fn appearance_changed(&self) {
            // SAFETY: Preserve AppKit's appearance update before applying our tint.
            unsafe { let _: () = msg_send![super(self), viewDidChangeEffectiveAppearance]; }
            apply_button_tint(self);
        }
    }
);

fn pin_item(item: &NSToolbarItem, pinned: bool) {
    let label = if pinned {
        text("取消置顶", "Disable always on top")
    } else {
        text("置顶", "Always on top")
    };
    item.setLabel(&NSString::from_str(label));
    item.setToolTip(Some(&NSString::from_str(label)));
    let icon = vector_image(include_bytes!("../../../icons/pin-template.pdf"), label);
    item.setImage(icon.as_deref());
    if let Some(view) = item.view() {
        if let Some(button) = view.downcast_ref::<NSButton>() {
            button.setImage(icon.as_deref());
            button.setState(if pinned { 1 } else { 0 });
            apply_button_tint(button);
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
            let pinned = !super::window::is_pinned(&window).unwrap_or(false);
            if super::window::set_pinned(&window, pinned).is_ok() {
                TOOLBAR.with(|slot| {
                    if let Some((_, delegate)) = slot.borrow().as_ref() {
                        for item in delegate.ivars().actions.borrow().iter() {
                            if item.itemIdentifier().to_string() == "float.pin" {
                                pin_item(item, pinned);
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
        #[unsafe(method(toggleMini:))]
        fn toggle_mini(&self, _sender: &objc2::runtime::AnyObject) { perform(&self.ivars().app, "mini"); }
    }
);

impl ToolbarDelegate {
    fn make_item(&self, identifier: &NSToolbarItemIdentifier) -> Option<Retained<NSToolbarItem>> {
        if identifier.to_string() == "float.actions" {
            // A single toolbar item prevents newer AppKit versions from adding
            // glass group separators or extra padding between our action buttons.
            let actions = ["float.settings", "float.pin", "float.mini"]
                .into_iter()
                .map(|id| self.make_item(&NSString::from_str(id)))
                .collect::<Option<Vec<_>>>()?;
            let views = actions
                .iter()
                .map(|item| item.view())
                .collect::<Option<Vec<_>>>()?;
            let stack =
                NSStackView::stackViewWithViews(&NSArray::from_retained_slice(&views), self.mtm());
            stack.setOrientation(NSUserInterfaceLayoutOrientation::Horizontal);
            stack.setAlignment(NSLayoutAttribute::CenterY);
            stack.setSpacing(4.0);
            stack.setFrame(NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(92.0, 28.0)));
            let container = ToolbarActionsView::alloc(self.mtm()).set_ivars(stack.clone());
            let container: Retained<ToolbarActionsView> = unsafe {
                msg_send![super(container), initWithFrame: NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(116.0, 28.0))]
            };
            container.addSubview(&stack);
            container.setTranslatesAutoresizingMaskIntoConstraints(false);
            container
                .widthAnchor()
                .constraintEqualToConstant(116.0)
                .setActive(true);
            container
                .heightAnchor()
                .constraintEqualToConstant(28.0)
                .setActive(true);
            let item =
                NSToolbarItem::initWithItemIdentifier(NSToolbarItem::alloc(self.mtm()), identifier);
            item.setBordered(false);
            item.setView(Some(&container));
            self.ivars().actions.replace(actions);
            return Some(item);
        }
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
        // Use identical custom button views for all three actions. Mixing
        // these with a standard image toolbar item gives unequal center spacing.
        {
            // SAFETY: This native button subclass only adds appearance-aware tinting.
            let button: Retained<ToolbarButton> =
                unsafe { msg_send![ToolbarButton::alloc(self.mtm()), init] };
            button.setTag(if identifier.to_string() == "float.pin" {
                1
            } else {
                0
            });
            button.setTitle(&NSString::from_str(""));
            button.setButtonType(if identifier.to_string() == "float.pin" {
                NSButtonType::PushOnPushOff
            } else {
                NSButtonType::MomentaryLight
            });
            button.setImagePosition(NSCellImagePosition::ImageOnly);
            button.setBordered(false);
            button.setImageScaling(NSImageScaling::ScaleNone);
            button.setImage(image(symbol, label).as_deref());
            apply_button_tint(&button);
            button.setFrame(NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(28.0, 28.0)));
            // A frame is only an initial size. In the SDK 15 compatibility
            // layout AppKit otherwise shrinks these image-only custom views
            // to their 16-point images, crowding the three toolbar actions.
            button.setTranslatesAutoresizingMaskIntoConstraints(false);
            button
                .widthAnchor()
                .constraintEqualToConstant(28.0)
                .setActive(true);
            button
                .heightAnchor()
                .constraintEqualToConstant(28.0)
                .setActive(true);
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
                    .is_some_and(|w| super::window::is_pinned(&w).unwrap_or(false)),
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
                sel!(toggleMini:)
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
        actions: RefCell::new(Vec::new()),
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
        native.setTitle(&NSString::from_str("CodexFloat"));
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

pub fn refresh_language(window: &WebviewWindow) {
    TOOLBAR.with(|slot| {
        if let Some((_, delegate)) = slot.borrow().as_ref() {
            for item in delegate.ivars().actions.borrow().iter() {
                let identifier = item.itemIdentifier().to_string();
                if identifier == "float.pin" {
                    pin_item(item, super::window::is_pinned(window).unwrap_or(false));
                    continue;
                }
                let label = match identifier.as_str() {
                    "float.settings" => text("设置", "Settings"),
                    "float.mini" => text("切换为悬浮状态球", "Switch to status ball"),
                    _ => continue,
                };
                let label = NSString::from_str(label);
                item.setLabel(&label);
                item.setToolTip(Some(&label));
                if let Some(view) = item.view() {
                    if let Some(button) = view.downcast_ref::<NSButton>() {
                        button.setToolTip(Some(&label));
                        unsafe {
                            let _: () = msg_send![button, setAccessibilityLabel: &*label];
                        }
                    }
                }
            }
        }
    });
    if let Some(menu) = window.app_handle().menu() {
        for (id, label) in [
            ("float.settings", text("设置…", "Settings…")),
            ("float.pin", text("切换置顶", "Toggle always on top")),
            (
                "float.mini",
                text("切换为悬浮状态球", "Switch to status ball"),
            ),
        ] {
            if let Some(tauri::menu::MenuItemKind::MenuItem(item)) = menu.get(id) {
                let _ = item.set_text(label);
            }
        }
    }
}

use std::{cell::RefCell, ffi::c_void, mem::size_of, ptr::null_mut};
use windows::{
    core::{
        define_interface, implement, IInspectable, IInspectable_Vtbl, IUnknown, IUnknownImpl,
        Interface, RuntimeName, GUID, HRESULT, HSTRING,
    },
    Foundation::{IClosable, IReference},
    System::{DispatcherQueue, DispatcherQueueController},
    Win32::{
        Foundation::HWND,
        System::WinRT::{
            Composition::ICompositorDesktopInterop, CreateDispatcherQueueController,
            DispatcherQueueOptions, RoActivateInstance, RoGetActivationFactory, DQTAT_COM_STA,
            DQTYPE_THREAD_CURRENT,
        },
    },
    UI::{
        Color,
        Composition::{CompositionTarget, Compositor},
    },
};
use windows_sys::{
    w,
    Win32::{
        Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_USE_HOSTBACKDROPBRUSH},
        System::{
            LibraryLoader::{GetModuleHandleW, GetProcAddress},
            Memory::{GetProcessHeap, HeapFree},
        },
    },
};

// ISystemBackdropController from the Windows App SDK Microsoft.UI.winmd.
// SetTarget(WindowId, Windows.UI.Composition.CompositionTarget) is the first method.
define_interface!(
    ISystemBackdropController,
    ISystemBackdropController_Vtbl,
    0x5632d76c_0b74_5b52_aa33_80262068aeb2
);
#[repr(C)]
pub struct ISystemBackdropController_Vtbl {
    base: IInspectable_Vtbl,
    set_target: unsafe extern "system" fn(*mut c_void, u64, *mut c_void, *mut bool) -> HRESULT,
    _set_core_window_target:
        unsafe extern "system" fn(*mut c_void, *mut c_void, *mut c_void, *mut bool) -> HRESULT,
}

// ABI prefixes from Microsoft.UI.winmd (Windows App SDK 1.8).
define_interface!(
    IAppWindowStatics,
    IAppWindowStatics_Vtbl,
    0x3c315c24_d540_5d72_b518_b226b83627cb
);
#[repr(C)]
pub struct IAppWindowStatics_Vtbl {
    base: IInspectable_Vtbl,
    _create_overloads: [usize; 3],
    get_from_window_id: unsafe extern "system" fn(*mut c_void, u64, *mut *mut c_void) -> HRESULT,
}
define_interface!(
    IAppWindow,
    IAppWindow_Vtbl,
    0xcfa788b3_643b_5c5e_ad4e_321d48a82acd
);
#[repr(C)]
pub struct IAppWindow_Vtbl {
    base: IInspectable_Vtbl,
    _properties_before_presenter: [usize; 6],
    get_presenter: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
    _properties_before_title_bar: [usize; 3],
    get_title_bar: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
}
define_interface!(
    IAppWindowTitleBar,
    IAppWindowTitleBar_Vtbl,
    0x5574efa2_c91c_5700_a363_539c71a7aaf4
);
#[repr(C)]
pub struct IAppWindowTitleBar_Vtbl {
    base: IInspectable_Vtbl,
    _properties_before_button_background: [usize; 3],
    set_button_background: unsafe extern "system" fn(*mut c_void, *mut c_void) -> HRESULT,
    _get_button_foreground: usize,
    set_button_foreground: unsafe extern "system" fn(*mut c_void, *mut c_void) -> HRESULT,
    _properties_before_inactive_button_background: [usize; 5],
    set_inactive_button_background: unsafe extern "system" fn(*mut c_void, *mut c_void) -> HRESULT,
    _get_inactive_button_foreground: usize,
    set_inactive_button_foreground: unsafe extern "system" fn(*mut c_void, *mut c_void) -> HRESULT,
    _remaining_color_properties: [usize; 4],
    _get_extends_content: usize,
    set_extends_content: unsafe extern "system" fn(*mut c_void, bool) -> HRESULT,
    _foreground_color: [usize; 2],
    get_height: unsafe extern "system" fn(*mut c_void, *mut i32) -> HRESULT,
    _properties_before_right_inset: [usize; 7],
    get_right_inset: unsafe extern "system" fn(*mut c_void, *mut i32) -> HRESULT,
}

// WinRT's color setters take a boxed Windows.UI.Color. This immutable box
// implements the IReference<Color> ABI.
#[repr(transparent)]
#[derive(Clone)]
struct ColorReference(IUnknown);
unsafe impl Interface for ColorReference {
    type Vtable = ColorReference_Vtbl;
    const IID: GUID = <IReference<Color> as Interface>::IID;
}
impl RuntimeName for ColorReference {}
#[repr(C)]
struct ColorReference_Vtbl {
    base: IInspectable_Vtbl,
    value: unsafe extern "system" fn(*mut c_void, *mut Color) -> HRESULT,
}
impl ColorReference_Vtbl {
    const fn new<Identity: IUnknownImpl<Impl = BoxedColor>, const OFFSET: isize>() -> Self {
        unsafe extern "system" fn value<
            Identity: IUnknownImpl<Impl = BoxedColor>,
            const OFFSET: isize,
        >(
            this: *mut c_void,
            out: *mut Color,
        ) -> HRESULT {
            let identity =
                unsafe { &*((this as *const *const ()).offset(OFFSET) as *const Identity) };
            unsafe { out.write(identity.get_impl().0) };
            HRESULT(0)
        }
        Self {
            base: IInspectable_Vtbl::new::<Identity, ColorReference, OFFSET>(),
            value: value::<Identity, OFFSET>,
        }
    }
    fn matches(iid: &GUID) -> bool {
        *iid == ColorReference::IID
    }
}
#[implement(ColorReference)]
struct BoxedColor(Color);

impl IAppWindow {
    fn for_window(window_id: u64) -> windows::core::Result<Self> {
        let class = HSTRING::from("Microsoft.UI.Windowing.AppWindow");
        unsafe {
            let factory: IAppWindowStatics = RoGetActivationFactory(&class)?;
            let mut raw = null_mut();
            (factory.vtable().get_from_window_id)(factory.as_raw(), window_id, &mut raw).ok()?;
            IInspectable::from_raw(raw).cast()
        }
    }
    fn title_bar(&self) -> windows::core::Result<IAppWindowTitleBar> {
        unsafe {
            let mut raw = null_mut();
            (self.vtable().get_title_bar)(self.as_raw(), &mut raw).ok()?;
            IInspectable::from_raw(raw).cast()
        }
    }
}

define_interface!(
    IOverlappedPresenter,
    IOverlappedPresenter_Vtbl,
    0x21693970_4f4c_5172_9e9d_682a2d174884
);
#[repr(C)]
pub struct IOverlappedPresenter_Vtbl {
    base: IInspectable_Vtbl,
    _methods_before_set_border_and_title_bar: [usize; 16],
    set_border_and_title_bar: unsafe extern "system" fn(*mut c_void, bool, bool) -> HRESULT,
}

pub(super) fn set_window_frame(hwnd: HWND, visible: bool) -> windows::core::Result<()> {
    let window = IAppWindow::for_window(hwnd.0 as usize as u64)?;
    unsafe {
        let mut raw = null_mut();
        (window.vtable().get_presenter)(window.as_raw(), &mut raw).ok()?;
        let presenter: IOverlappedPresenter = IInspectable::from_raw(raw).cast()?;
        (presenter.vtable().set_border_and_title_bar)(presenter.as_raw(), visible, visible).ok()
    }
}

impl IAppWindowTitleBar {
    fn extend(&self, enabled: bool) -> windows::core::Result<()> {
        unsafe { (self.vtable().set_extends_content)(self.as_raw(), enabled).ok() }
    }

    fn make_button_backgrounds_transparent(&self) -> windows::core::Result<()> {
        let color: ColorReference = BoxedColor(Color::default()).into();
        let vtable = self.vtable();
        unsafe {
            (vtable.set_button_background)(self.as_raw(), color.as_raw()).ok()?;
            (vtable.set_inactive_button_background)(self.as_raw(), color.as_raw()).ok()
        }
    }

    fn set_button_foreground(&self, dark: bool) -> windows::core::Result<()> {
        let channel = if dark { 255 } else { 0 };
        let color: ColorReference = BoxedColor(Color {
            A: 255,
            R: channel,
            G: channel,
            B: channel,
        })
        .into();
        let vtable = self.vtable();
        unsafe {
            (vtable.set_button_foreground)(self.as_raw(), color.as_raw()).ok()?;
            (vtable.set_inactive_button_foreground)(self.as_raw(), color.as_raw()).ok()
        }
    }

    fn height(&self) -> i32 {
        let mut height = 0;
        let _ = unsafe { (self.vtable().get_height)(self.as_raw(), &mut height) };
        height
    }

    fn right_inset(&self) -> i32 {
        let mut inset = 0;
        let _ = unsafe { (self.vtable().get_right_inset)(self.as_raw(), &mut inset) };
        inset
    }
}

define_interface!(
    IBackdropConfiguration,
    IBackdropConfiguration_Vtbl,
    0xebcce1b9_0e0c_5431_ab0e_00f3f0669962
);
#[repr(C)]
pub struct IBackdropConfiguration_Vtbl {
    base: IInspectable_Vtbl,
    _properties_before_input_active: [usize; 5],
    set_input_active: unsafe extern "system" fn(*mut c_void, bool) -> HRESULT,
    _get_theme: usize,
    set_theme: unsafe extern "system" fn(*mut c_void, i32) -> HRESULT,
}
define_interface!(
    IControllerWithTargets,
    IControllerWithTargets_Vtbl,
    0x9c56fe7c_98eb_5f89_ad97_dad57fc30c8c
);
#[repr(C)]
pub struct IControllerWithTargets_Vtbl {
    base: IInspectable_Vtbl,
    _methods_before_configuration: [usize; 4],
    set_configuration: unsafe extern "system" fn(*mut c_void, *mut c_void) -> HRESULT,
}

define_interface!(
    IAcrylicProperties,
    IAcrylicProperties_Vtbl,
    0x7c20a6af_8eb3_5f08_bdfc_6d35e35dfe45
);
#[repr(C)]
pub struct IAcrylicProperties_Vtbl {
    base: IInspectable_Vtbl,
    _get_fallback_color: usize,
    set_fallback_color: unsafe extern "system" fn(*mut c_void, Color) -> HRESULT,
    get_luminosity_opacity: unsafe extern "system" fn(*mut c_void, *mut f32) -> HRESULT,
    set_luminosity_opacity: unsafe extern "system" fn(*mut c_void, f32) -> HRESULT,
    _get_tint_color: usize,
    set_tint_color: unsafe extern "system" fn(*mut c_void, Color) -> HRESULT,
    get_tint_opacity: unsafe extern "system" fn(*mut c_void, *mut f32) -> HRESULT,
    set_tint_opacity: unsafe extern "system" fn(*mut c_void, f32) -> HRESULT,
}

#[derive(Clone, Copy, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opacity {
    pub tint_opacity: f32,
    pub luminosity_opacity: f32,
}

impl IAcrylicProperties {
    fn set_theme_colors(&self, dark: bool) -> windows::core::Result<()> {
        let channel = if dark { 0 } else { 255 };
        let color = Color {
            A: 255,
            R: channel,
            G: channel,
            B: channel,
        };
        unsafe {
            (self.vtable().set_tint_color)(self.as_raw(), color).ok()?;
            (self.vtable().set_fallback_color)(self.as_raw(), color).ok()
        }
    }

    fn opacity(&self) -> windows::core::Result<Opacity> {
        let (mut tint_opacity, mut luminosity_opacity) = (0.0, 0.0);
        unsafe {
            (self.vtable().get_tint_opacity)(self.as_raw(), &mut tint_opacity).ok()?;
            (self.vtable().get_luminosity_opacity)(self.as_raw(), &mut luminosity_opacity).ok()?;
        }
        Ok(Opacity {
            tint_opacity,
            luminosity_opacity,
        })
    }

    fn set_opacity(&self, opacity: Opacity) -> windows::core::Result<()> {
        let previous = self.opacity()?;
        unsafe {
            let set_tint = self.vtable().set_tint_opacity;
            set_tint(self.as_raw(), opacity.tint_opacity).ok()?;
            let result =
                (self.vtable().set_luminosity_opacity)(self.as_raw(), opacity.luminosity_opacity)
                    .ok();
            if result.is_err() {
                let _ = set_tint(self.as_raw(), previous.tint_opacity);
            }
            result
        }
    }
}

struct Acrylic {
    controller: IClosable,
    properties: IAcrylicProperties,
    title_bar: IAppWindowTitleBar,
    configuration: IBackdropConfiguration,
    _target: CompositionTarget,
    _compositor: Compositor,
}

impl Drop for Acrylic {
    fn drop(&mut self) {
        let _ = self.controller.Close();
    }
}

thread_local! {
    static CUSTOM_TITLE_BAR: RefCell<Option<IAppWindowTitleBar>> = const { RefCell::new(None) };
    static OPACITY: std::cell::Cell<Option<Opacity>> = const { std::cell::Cell::new(None) };
    static ACRYLIC: RefCell<Option<Acrylic>> = const { RefCell::new(None) };
    static QUEUE: RefCell<Option<DispatcherQueueController>> = const { RefCell::new(None) };
    static RUNTIME: Option<Runtime> = Runtime::load();
}

pub(super) fn extend_custom_title_bar(hwnd: HWND, dark: bool) -> windows::core::Result<()> {
    RUNTIME.with(|_| ());
    let title_bar = IAppWindow::for_window(hwnd.0 as usize as u64)?.title_bar()?;
    title_bar.extend(true)?;
    if let Err(error) = title_bar.make_button_backgrounds_transparent() {
        let _ = title_bar.extend(false);
        return Err(error);
    }
    let _ = title_bar.set_button_foreground(dark);
    CUSTOM_TITLE_BAR.with(|state| *state.borrow_mut() = Some(title_bar));
    Ok(())
}

pub(super) fn clear_custom_title_bar() {
    CUSTOM_TITLE_BAR.with(|state| {
        state.borrow_mut().take();
    });
}

// Resolve the Windows 11 package-graph APIs dynamically so older systems can
// still start the executable and use the existing backdrop fallback.
struct Runtime {
    context: *mut c_void,
    remove: unsafe extern "system" fn(*mut c_void) -> i32,
}

impl Runtime {
    fn load() -> Option<Self> {
        type Create = unsafe extern "system" fn(
            *mut c_void,
            *const u16,
            u64,
            i32,
            i32,
            *const u16,
            i32,
            *mut *mut u16,
        ) -> i32;
        type Add =
            unsafe extern "system" fn(*const u16, i32, i32, *mut *mut c_void, *mut *mut u16) -> i32;
        type Delete = unsafe extern "system" fn(*const u16) -> i32;
        type Remove = unsafe extern "system" fn(*mut c_void) -> i32;
        unsafe {
            let kernel = GetModuleHandleW(w!("kernelbase.dll"));
            if kernel.is_null() {
                return None;
            }
            let create: Create = std::mem::transmute(GetProcAddress(
                kernel,
                c"TryCreatePackageDependency".as_ptr().cast(),
            )?);
            let add: Add = std::mem::transmute(GetProcAddress(
                kernel,
                c"AddPackageDependency".as_ptr().cast(),
            )?);
            let delete: Delete = std::mem::transmute(GetProcAddress(
                kernel,
                c"DeletePackageDependency".as_ptr().cast(),
            )?);
            let remove: Remove = std::mem::transmute(GetProcAddress(
                kernel,
                c"RemovePackageDependency".as_ptr().cast(),
            )?);
            let mut id = null_mut();
            // Current user, native architecture, and a process-scoped dependency.
            if create(
                null_mut(),
                w!("Microsoft.WindowsAppRuntime.1.8_8wekyb3d8bbwe"),
                0,
                0,
                0,
                std::ptr::null(),
                0,
                &mut id,
            ) < 0
            {
                return None;
            }
            let mut context = null_mut();
            let result = add(id, 0, 0, &mut context, null_mut());
            let _ = delete(id);
            HeapFree(GetProcessHeap(), 0, id.cast());
            (result >= 0).then(|| Self { context, remove })
        }
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        unsafe { (self.remove)(self.context) };
    }
}

fn create(hwnd: HWND, dark: bool) -> windows::core::Result<Option<Acrylic>> {
    let name = HSTRING::from("Microsoft.UI.Composition.SystemBackdrops.DesktopAcrylicController");
    RUNTIME.with(|_| ());
    if DispatcherQueue::GetForCurrentThread().is_err() {
        let queue = unsafe {
            CreateDispatcherQueueController(DispatcherQueueOptions {
                dwSize: size_of::<DispatcherQueueOptions>() as u32,
                threadType: DQTYPE_THREAD_CURRENT,
                apartmentType: DQTAT_COM_STA,
            })?
        };
        QUEUE.with(|state| *state.borrow_mut() = Some(queue));
    }
    let instance = unsafe { RoActivateInstance(&name)? };
    host_backdrop(hwnd, true).ok()?;
    let compositor = Compositor::new()?;
    let interop: ICompositorDesktopInterop = compositor.cast()?;
    let target: CompositionTarget =
        unsafe { interop.CreateDesktopWindowTarget(hwnd, false)? }.cast()?;
    // Keep a root attached before the controller's asynchronous updates run.
    target.SetRoot(&compositor.CreateContainerVisual()?)?;
    let controller: ISystemBackdropController = instance.cast()?;
    let with_targets: IControllerWithTargets = instance.cast()?;
    let configuration: IBackdropConfiguration = unsafe {
        RoActivateInstance(&HSTRING::from(
            "Microsoft.UI.Composition.SystemBackdrops.SystemBackdropConfiguration",
        ))?
    }
    .cast()?;
    set_theme(&configuration, dark);
    unsafe {
        (configuration.vtable().set_input_active)(configuration.as_raw(), true).ok()?;
        (with_targets.vtable().set_configuration)(with_targets.as_raw(), configuration.as_raw())
            .ok()?;
    }
    let window_id = hwnd.0 as usize as u64;
    let backdrop = Acrylic {
        controller: instance.cast()?,
        properties: instance.cast()?,
        title_bar: IAppWindow::for_window(window_id)?.title_bar()?,
        configuration,
        _target: target,
        _compositor: compositor,
    };
    let mut attached = false;
    unsafe {
        (controller.vtable().set_target)(
            controller.as_raw(),
            window_id,
            backdrop._target.as_raw(),
            &mut attached,
        )
    }
    .ok()?;
    if attached {
        backdrop.properties.set_theme_colors(dark)?;
        if let Some(opacity) = OPACITY.get() {
            backdrop.properties.set_opacity(opacity)?;
        }
        backdrop.title_bar.extend(true)?;
        if let Err(error) = backdrop.title_bar.make_button_backgrounds_transparent() {
            let _ = backdrop.title_bar.extend(false);
            return Err(error);
        }
        let _ = backdrop.title_bar.set_button_foreground(dark);
    }
    Ok(attached.then_some(backdrop))
}

pub(super) fn opacity_settings(requested: Option<Opacity>) -> Result<Opacity, String> {
    if requested.is_some_and(|opacity| {
        !(0.0..=1.0).contains(&opacity.tint_opacity)
            || !(0.0..=1.0).contains(&opacity.luminosity_opacity)
    }) {
        return Err("亚克力不透明度必须在 0 到 1 之间".into());
    }
    ACRYLIC.with(|state| {
        let state = state.borrow();
        let backdrop = state.as_ref().ok_or("亚克力控制器未启用")?;
        if let Some(opacity) = requested {
            backdrop
                .properties
                .set_opacity(opacity)
                .map_err(|error| error.to_string())?;
            OPACITY.set(Some(opacity));
        }
        backdrop
            .properties
            .opacity()
            .map_err(|error| error.to_string())
    })
}

fn host_backdrop(hwnd: HWND, enabled: bool) -> HRESULT {
    let enabled = i32::from(enabled);
    HRESULT(unsafe {
        DwmSetWindowAttribute(
            hwnd.0,
            DWMWA_USE_HOSTBACKDROPBRUSH as u32,
            (&enabled as *const i32).cast(),
            size_of::<i32>() as u32,
        )
    })
}

pub(super) fn install(hwnd: HWND, dark: bool) -> bool {
    match create(hwnd, dark) {
        Ok(Some(backdrop)) => {
            ACRYLIC.with(|state| *state.borrow_mut() = Some(backdrop));
            #[cfg(debug_assertions)]
            eprintln!("DesktopAcrylicController attached");
            true
        }
        _ => {
            let _ = host_backdrop(hwnd, false);
            false
        }
    }
}

fn set_theme(configuration: &IBackdropConfiguration, dark: bool) {
    // SystemBackdropTheme::Light = 1, Dark = 2.
    let _ = unsafe {
        (configuration.vtable().set_theme)(configuration.as_raw(), if dark { 2 } else { 1 })
    };
}

pub(super) fn update_theme(dark: bool) {
    CUSTOM_TITLE_BAR.with(|state| {
        if let Some(title_bar) = state.borrow().as_ref() {
            let _ = title_bar.set_button_foreground(dark);
        }
    });
    ACRYLIC.with(|state| {
        if let Some(backdrop) = state.borrow().as_ref() {
            set_theme(&backdrop.configuration, dark);
            let _ = backdrop.properties.set_theme_colors(dark);
            let _ = backdrop.title_bar.set_button_foreground(dark);
        }
    });
}

pub(super) fn suspend(hwnd: HWND) {
    // Leaving the extended layout enabled avoids reviving the default caption
    // and its window icon while Tauri switches to the borderless status ball.
    if ACRYLIC.with(|state| state.borrow_mut().take()).is_some() {
        let _ = host_backdrop(hwnd, false);
    }
}

pub(super) fn title_bar_height(scale: f64) -> f64 {
    let height = active_title_bar().map_or(0, |title_bar| title_bar.height());
    if height > 0 {
        height as f64 / scale
    } else {
        32.0
    }
}

pub(super) fn caption_metrics() -> Option<(i32, i32)> {
    let title_bar = active_title_bar()?;
    let height = title_bar.height();
    let right_inset = title_bar.right_inset();
    (height > 0 && right_inset > 0).then_some((height, right_inset))
}

fn active_title_bar() -> Option<IAppWindowTitleBar> {
    CUSTOM_TITLE_BAR
        .with(|state| state.try_borrow().ok()?.clone())
        .or_else(|| {
            ACRYLIC.with(|state| Some(state.try_borrow().ok()?.as_ref()?.title_bar.clone()))
        })
}

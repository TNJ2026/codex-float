use std::{cell::RefCell, sync::Mutex};
use windows::{
    core::{implement, Error, Interface, Result, GUID, HRESULT, HSTRING, PCWSTR},
    Foundation::{IPropertyValue, PropertyValue},
    Graphics::Effects::{
        IGraphicsEffect, IGraphicsEffectSource, IGraphicsEffectSource_Impl, IGraphicsEffect_Impl,
    },
    System::{DispatcherQueue, DispatcherQueueController},
    Win32::{
        Foundation::HWND,
        System::WinRT::{
            Composition::ICompositorDesktopInterop,
            CreateDispatcherQueueController, DispatcherQueueOptions,
            Graphics::Direct2D::{
                IGraphicsEffectD2D1Interop, IGraphicsEffectD2D1Interop_Impl,
                GRAPHICS_EFFECT_PROPERTY_MAPPING, GRAPHICS_EFFECT_PROPERTY_MAPPING_DIRECT,
            },
            DQTAT_COM_STA, DQTYPE_THREAD_CURRENT,
        },
    },
    UI::Composition::{
        CompositionEffectBrush, CompositionEffectSourceParameter,
        CompositionRoundedRectangleGeometry, Compositor, Desktop::DesktopWindowTarget,
        SpriteVisual,
    },
};
use windows_numerics::Vector2;

pub const DEFAULT_AMOUNT: f32 = 10.0;
fn invalid() -> Error {
    Error::from_hresult(HRESULT(0x80070057u32 as i32))
}

#[implement(IGraphicsEffect, IGraphicsEffectSource, IGraphicsEffectD2D1Interop)]
struct GaussianBlur {
    amount: f32,
    source: IGraphicsEffectSource,
    name: Mutex<HSTRING>,
}
impl IGraphicsEffectSource_Impl for GaussianBlur_Impl {}
impl IGraphicsEffect_Impl for GaussianBlur_Impl {
    fn Name(&self) -> Result<HSTRING> {
        Ok(self.name.lock().unwrap().clone())
    }
    fn SetName(&self, value: &HSTRING) -> Result<()> {
        *self.name.lock().unwrap() = value.clone();
        Ok(())
    }
}
impl IGraphicsEffectD2D1Interop_Impl for GaussianBlur_Impl {
    fn GetEffectId(&self) -> Result<GUID> {
        Ok(GUID::from_u128(0x1feb6d69_2fe6_4ac9_8c58_1d7f93e7a6a5))
    }
    fn GetNamedPropertyMapping(
        &self,
        name: &PCWSTR,
        index: *mut u32,
        mapping: *mut GRAPHICS_EFFECT_PROPERTY_MAPPING,
    ) -> Result<()> {
        if name.is_null() || index.is_null() || mapping.is_null() {
            return Err(invalid());
        }
        let property = match unsafe { name.to_string()? }.as_str() {
            "BlurAmount" => 0,
            "Optimization" => 1,
            "BorderMode" => 2,
            _ => return Err(invalid()),
        };
        unsafe {
            *index = property;
            *mapping = GRAPHICS_EFFECT_PROPERTY_MAPPING_DIRECT;
        }
        Ok(())
    }
    fn GetPropertyCount(&self) -> Result<u32> {
        Ok(3)
    }
    fn GetProperty(&self, index: u32) -> Result<IPropertyValue> {
        match index {
            0 => PropertyValue::CreateSingle(self.amount)?.cast(),
            1 | 2 => PropertyValue::CreateUInt32(1)?.cast(),
            _ => Err(invalid()),
        }
    }
    fn GetSource(&self, index: u32) -> Result<IGraphicsEffectSource> {
        if index == 0 {
            Ok(self.source.clone())
        } else {
            Err(invalid())
        }
    }
    fn GetSourceCount(&self) -> Result<u32> {
        Ok(1)
    }
}

struct CustomBackdrop {
    _queue: Option<DispatcherQueueController>,
    _target: DesktopWindowTarget,
    _compositor: Compositor,
    visual: SpriteVisual,
    geometry: CompositionRoundedRectangleGeometry,
    _brush: CompositionEffectBrush,
    compact: bool,
}
thread_local! { static BACKDROP: RefCell<Option<CustomBackdrop>> = const { RefCell::new(None) }; }

fn brush(compositor: &Compositor, amount: f32) -> Result<CompositionEffectBrush> {
    let source = CompositionEffectSourceParameter::Create(&HSTRING::from("Backdrop"))?;
    let effect: IGraphicsEffect = GaussianBlur {
        amount,
        source: source.cast()?,
        name: Mutex::new(HSTRING::from("Blur")),
    }
    .into();
    let properties: windows_collections::IIterable<HSTRING> =
        vec![HSTRING::from("Blur.BlurAmount")].into();
    let factory = compositor.CreateEffectFactoryWithProperties(&effect, &properties)?;
    let brush = factory.CreateBrush()?;
    // Unlike HostBackdropBrush, BackdropBrush samples before the OS's fixed blur.
    brush.SetSourceParameter(
        &HSTRING::from("Backdrop"),
        &compositor.CreateBackdropBrush()?,
    )?;
    Ok(brush)
}
pub fn install(hwnd: HWND, width: u32, height: u32, scale: f64) -> Result<()> {
    let queue = if DispatcherQueue::GetForCurrentThread().is_ok() {
        None
    } else {
        Some(unsafe {
            CreateDispatcherQueueController(DispatcherQueueOptions {
                dwSize: std::mem::size_of::<DispatcherQueueOptions>() as u32,
                threadType: DQTYPE_THREAD_CURRENT,
                apartmentType: DQTAT_COM_STA,
            })?
        })
    };
    let compositor = Compositor::new()?;
    let interop: ICompositorDesktopInterop = compositor.cast()?;
    let target = unsafe { interop.CreateDesktopWindowTarget(hwnd, false)? };
    let visual = compositor.CreateSpriteVisual()?;
    let geometry = compositor.CreateRoundedRectangleGeometry()?;
    geometry.SetCornerRadius(Vector2 {
        X: (8.0 * scale) as f32,
        Y: (8.0 * scale) as f32,
    })?;
    geometry.SetSize(Vector2 {
        X: width as f32,
        Y: height as f32,
    })?;
    visual.SetSize(Vector2 {
        X: width as f32,
        Y: height as f32,
    })?;
    visual.SetClip(&compositor.CreateGeometricClipWithGeometry(&geometry)?)?;
    let brush = brush(&compositor, DEFAULT_AMOUNT)?;
    visual.SetBrush(&brush)?;
    target.SetRoot(&visual)?;
    super::background::disable_accent(hwnd.0);
    BACKDROP.with(|state| {
        *state.borrow_mut() = Some(CustomBackdrop {
            _queue: queue,
            _target: target,
            _compositor: compositor,
            visual,
            geometry,
            _brush: brush,
            compact: false,
        })
    });
    Ok(())
}
pub fn active() -> bool {
    BACKDROP.with(|state| state.borrow().is_some())
}
pub fn set_visible(visible: bool) {
    BACKDROP.with(|state| {
        if let Some(backdrop) = state.borrow().as_ref() {
            let _ = backdrop.visual.SetIsVisible(visible);
        }
    });
}
pub fn set_amount(amount: f32) -> Result<()> {
    BACKDROP.with(|state| {
        let state = state.borrow();
        let backdrop = state.as_ref().ok_or_else(invalid)?;
        // Keep the original backdrop source bound while updating the Gaussian parameter.
        backdrop
            ._brush
            .Properties()?
            .InsertScalar(&HSTRING::from("Blur.BlurAmount"), amount)
    })
}
pub fn clear() {
    BACKDROP.with(|state| {
        state.borrow_mut().take();
    });
}
pub fn set_compact(compact: bool, width: u32, height: u32, scale: f64) {
    BACKDROP.with(|state| {
        if let Some(backdrop) = state.borrow_mut().as_mut() {
            backdrop.compact = compact;
        }
    });
    resize(width, height, scale);
}
pub fn resize(width: u32, height: u32, scale: f64) {
    BACKDROP.with(|state| {
        if let Some(backdrop) = state.borrow().as_ref() {
            let size = Vector2 {
                X: width as f32,
                Y: height as f32,
            };
            let _ = backdrop.visual.SetSize(size);
            // Leave the outer SVG ring to WebView's antialiasing. A native hard clip
            // at the same radius would otherwise darken/cut its partially clear pixels.
            let inset = if backdrop.compact {
                (2.0 * scale) as f32
            } else {
                0.0
            };
            let clipped = Vector2 {
                X: (size.X - 2.0 * inset).max(0.0),
                Y: (size.Y - 2.0 * inset).max(0.0),
            };
            let _ = backdrop.geometry.SetOffset(Vector2 { X: inset, Y: inset });
            let _ = backdrop.geometry.SetSize(clipped);
            let radius = if backdrop.compact {
                clipped.X.min(clipped.Y) / 2.0
            } else {
                (8.0 * scale) as f32
            };
            let _ = backdrop.geometry.SetCornerRadius(Vector2 {
                X: radius,
                Y: radius,
            });
        }
    });
}

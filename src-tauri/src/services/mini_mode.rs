use crate::platform::window as native_window;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

const MINI_SIZE: f64 = 52.0;
#[derive(Clone)]
struct WindowSnapshot {
    size: PhysicalSize<u32>,
    #[cfg(not(target_os = "windows"))]
    position: PhysicalPosition<i32>,
    #[cfg(target_os = "windows")]
    content_position: PhysicalPosition<i32>,
    #[cfg(target_os = "windows")]
    scale: f64,
    resizable: bool,
    pinned: bool,
    maximized: bool,
}

#[cfg(any(target_os = "windows", test))]
fn restored_content_bounds(
    saved_size: PhysicalSize<u32>,
    saved_scale: f64,
    scale: f64,
    ball_position: PhysicalPosition<i32>,
    ball_size: PhysicalSize<u32>,
) -> (PhysicalSize<u32>, PhysicalPosition<i32>) {
    let size = saved_size.to_logical::<f64>(saved_scale).to_physical(scale);
    let position = PhysicalPosition::new(
        ball_position.x + ball_size.width as i32 - size.width as i32,
        ball_position.y,
    );
    (size, position)
}

#[cfg(any(target_os = "windows", test))]
fn restored_outer_position(
    content_position: PhysicalPosition<i32>,
    current_inner_position: PhysicalPosition<i32>,
    current_outer_position: PhysicalPosition<i32>,
) -> PhysicalPosition<i32> {
    PhysicalPosition::new(
        content_position.x - (current_inner_position.x - current_outer_position.x),
        content_position.y - (current_inner_position.y - current_outer_position.y),
    )
}
#[derive(Default)]
pub struct MiniModeState {
    snapshot: Mutex<Option<WindowSnapshot>>,
    compact: AtomicBool,
    transitioning: AtomicBool,
}
struct ModeTransition<'a>(&'a AtomicBool);
impl Drop for ModeTransition<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
#[cfg(target_os = "macos")]
pub fn is_transitioning(app: &tauri::AppHandle) -> bool {
    app.try_state::<MiniModeState>()
        .is_some_and(|state| state.transitioning.load(Ordering::Acquire))
}
pub fn is_compact(app: &tauri::AppHandle) -> bool {
    app.try_state::<MiniModeState>()
        .is_some_and(|state| state.compact.load(Ordering::Relaxed))
}
#[tauri::command]
pub fn get_mini_mode(window: WebviewWindow) -> bool {
    is_compact(window.app_handle())
}
fn prepare_enter(window: &WebviewWindow) -> tauri::Result<u32> {
    if window.is_maximized()? {
        window.unmaximize()?;
    }
    window.set_min_size(None::<LogicalSize<f64>>)?;
    window.set_resizable(false)?;
    let scale = window.scale_factor()?;
    let physical = (MINI_SIZE * scale).round() as u32;
    native_window::prepare_compact(window, true, physical, physical, scale)?;
    window.set_shadow(false)?;
    native_window::border(window, true);
    Ok(physical)
}
fn enter(
    window: &WebviewWindow,
    normal: &WindowSnapshot,
    position: Option<PhysicalPosition<i32>>,
) -> tauri::Result<()> {
    let physical = prepare_enter(window)?;
    #[cfg(target_os = "windows")]
    native_window::set_compact_bounds(
        window,
        position.unwrap_or_else(|| {
            PhysicalPosition::new(
                normal.content_position.x + normal.size.width as i32 - physical as i32,
                normal.content_position.y,
            )
        }),
        physical,
    )?;
    #[cfg(target_os = "macos")]
    native_window::animate_bounds(
        window,
        position.unwrap_or_else(|| {
            PhysicalPosition::new(
                normal.position.x + normal.size.width as i32 - physical as i32,
                normal.position.y,
            )
        }),
        PhysicalSize::new(physical, physical),
    )?;
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        window.set_size(LogicalSize::new(MINI_SIZE, MINI_SIZE))?;
        window.set_position(position.unwrap_or_else(|| {
            PhysicalPosition::new(
                normal.position.x + normal.size.width as i32 - physical as i32,
                normal.position.y,
            )
        }))?;
    }
    native_window::set_pinned(window, true)?;
    Ok(())
}
fn restore(window: &WebviewWindow, normal: &WindowSnapshot) -> tauri::Result<()> {
    native_window::prepare_compact(
        window,
        false,
        normal.size.width,
        normal.size.height,
        window.scale_factor()?,
    )?;
    window.set_resizable(normal.resizable)?;
    // Shadow changes non-client frame offsets; restore it before measuring size.
    window.set_shadow(true)?;
    #[cfg(target_os = "windows")]
    {
        // Decorations, resizability and shadow now reflect the destination
        // monitor. Measure its actual frame instead of reusing old DPI offsets.
        let position = restored_outer_position(
            normal.content_position,
            window.inner_position()?,
            window.outer_position()?,
        );
        native_window::set_restored_bounds(window, position, normal.size)?;
    }
    #[cfg(target_os = "macos")]
    native_window::animate_bounds(window, normal.position, normal.size)?;
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        window.set_size(normal.size)?;
        window.set_position(normal.position)?;
    }
    // Apply the size constraint after placement to avoid an intermediate resize
    // from the ball to the minimum window size at the ball's screen position.
    window.set_min_size(Some(LogicalSize::new(360.0, 480.0)))?;
    native_window::set_pinned(window, normal.pinned)?;
    native_window::border(window, false);
    if normal.maximized {
        window.maximize()?;
    }
    native_window::finish_restore(window);
    Ok(())
}
#[tauri::command]
pub async fn set_mini_mode(window: WebviewWindow, compact: bool) -> Result<bool, String> {
    let state = window.state::<MiniModeState>();
    state
        .transitioning
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| "窗口正在切换模式".to_string())?;
    let _transition = ModeTransition(&state.transitioning);
    if state.compact.load(Ordering::Relaxed) == compact {
        return Ok(compact);
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let handle = window.clone();
    window
        .run_on_main_thread(move || {
            let result = (|| -> tauri::Result<bool> {
                let state = handle.state::<MiniModeState>();
                let mut saved = state.snapshot.lock().unwrap();
                if state.compact.load(Ordering::Relaxed) == compact {
                    return Ok(compact);
                }
                let normal = match saved.as_ref() {
                    Some(value) => value.clone(),
                    None => WindowSnapshot {
                        size: handle.inner_size()?,
                        #[cfg(not(target_os = "windows"))]
                        position: handle.outer_position()?,
                        #[cfg(target_os = "windows")]
                        content_position: handle.inner_position()?,
                        #[cfg(target_os = "windows")]
                        scale: handle.scale_factor()?,
                        resizable: handle.is_resizable()?,
                        pinned: native_window::is_pinned(&handle)?,
                        maximized: handle.is_maximized()?,
                    },
                };
                // Retain the ball position only to roll back a failed restore.
                // Each new minimization anchors to the current window's top right.
                let mini_position = if compact {
                    None
                } else {
                    Some(handle.outer_position()?)
                };
                #[cfg(target_os = "windows")]
                let normal = if let Some(ball_position) = mini_position {
                    let ball_size = handle.inner_size()?;
                    let scale = handle.scale_factor()?;
                    let mut normal = normal;
                    (normal.size, normal.content_position) = restored_content_bounds(
                        normal.size,
                        normal.scale,
                        scale,
                        ball_position,
                        ball_size,
                    );
                    normal.scale = scale;
                    normal
                } else {
                    normal
                };
                state.compact.store(compact, Ordering::Relaxed);
                let operation = if compact {
                    enter(&handle, &normal, mini_position)
                } else {
                    restore(&handle, &normal)
                };
                if let Err(error) = operation {
                    state.compact.store(!compact, Ordering::Relaxed);
                    let _ = if compact {
                        restore(&handle, &normal)
                    } else {
                        enter(&handle, &normal, mini_position)
                    };
                    return Err(error);
                }
                *saved = if compact { Some(normal) } else { None };
                Ok(compact)
            })()
            .map_err(|error| error.to_string());
            let _ = tx.send(result);
        })
        .map_err(|error| error.to_string())?;
    rx.await.map_err(|_| "窗口线程已关闭".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moving_the_ball_between_monitors_preserves_logical_size_and_right_anchor() {
        for (source_scale, target_scale) in [(1.0, 2.0), (2.0, 1.0), (1.25, 1.5), (1.5, 1.5)] {
            let original = LogicalSize::new(450.0, 720.0).to_physical(source_scale);
            let ball = LogicalSize::new(MINI_SIZE, MINI_SIZE).to_physical(target_scale);
            let anchor = PhysicalPosition::new(-800, 200);
            let (size, content) =
                restored_content_bounds(original, source_scale, target_scale, anchor, ball);
            let expected = original.to_logical::<f64>(source_scale);
            let actual = size.to_logical::<f64>(target_scale);
            // Fractional DPI requires rounding to physical pixels. Preserve
            // the captured logical size to within half a destination pixel.
            let tolerance = 0.5 / target_scale + f64::EPSILON * 1024.0;
            assert!((actual.width - expected.width).abs() <= tolerance);
            assert!((actual.height - expected.height).abs() <= tolerance);
            assert_eq!(content.x + size.width as i32, anchor.x + ball.width as i32);
            assert_eq!(content.y, anchor.y);
        }
    }

    #[test]
    fn restore_uses_the_destination_frame_including_extended_titlebars() {
        let content = PhysicalPosition::new(-1596, 200);
        // Standard frame at 200% DPI, including its title bar.
        assert_eq!(
            restored_outer_position(
                content,
                PhysicalPosition::new(116, 162),
                PhysicalPosition::new(100, 100)
            ),
            PhysicalPosition::new(-1612, 138),
        );
        // Extended content shares the outer origin and requires no old inset.
        assert_eq!(
            restored_outer_position(
                content,
                PhysicalPosition::new(100, 100),
                PhysicalPosition::new(100, 100)
            ),
            content,
        );
    }
}

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
    position: PhysicalPosition<i32>,
    #[cfg(target_os = "windows")]
    content_position: PhysicalPosition<i32>,
    resizable: bool,
    pinned: bool,
    maximized: bool,
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
    #[cfg(not(target_os = "windows"))]
    {
        window.set_size(LogicalSize::new(MINI_SIZE, MINI_SIZE))?;
        window.set_position(position.unwrap_or_else(|| {
            PhysicalPosition::new(
                normal.position.x + normal.size.width as i32 - physical as i32,
                normal.position.y,
            )
        }))?;
    }
    window.set_always_on_top(true)?;
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
    native_window::set_restored_bounds(window, normal.position, normal.size)?;
    #[cfg(not(target_os = "windows"))]
    {
        window.set_size(normal.size)?;
        window.set_position(normal.position)?;
    }
    // Apply the size constraint after placement to avoid an intermediate resize
    // from the ball to the minimum window size at the ball's screen position.
    window.set_min_size(Some(LogicalSize::new(360.0, 480.0)))?;
    window.set_always_on_top(normal.pinned)?;
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
                        position: handle.outer_position()?,
                        #[cfg(target_os = "windows")]
                        content_position: handle.inner_position()?,
                        resizable: handle.is_resizable()?,
                        pinned: handle.is_always_on_top()?,
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
                    let frame_x = normal.content_position.x - normal.position.x;
                    let frame_y = normal.content_position.y - normal.position.y;
                    let mut normal = normal;
                    normal.content_position = PhysicalPosition::new(
                        ball_position.x + ball_size.width as i32 - normal.size.width as i32,
                        ball_position.y,
                    );
                    normal.position = PhysicalPosition::new(
                        normal.content_position.x - frame_x,
                        normal.content_position.y - frame_y,
                    );
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

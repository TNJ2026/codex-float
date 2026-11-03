#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod app;
mod codex;
mod platform;
mod services;

fn main() {
    app::run();
}

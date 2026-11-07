fn main() {
    // Rebuild native icon resources when artwork changes without a config edit.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}

//! Local App Tools transport for the currently disabled ChatGPT experiment.
#[cfg(target_os = "windows")]
pub async fn connect(
    endpoint: &str,
) -> Result<tokio::net::windows::named_pipe::NamedPipeClient, String> {
    if !endpoint.starts_with(r"\\.\pipe\") {
        return Err("App Tools 必须使用本地命名管道".into());
    }
    tokio::net::windows::named_pipe::ClientOptions::new()
        .open(endpoint)
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
pub async fn connect(endpoint: &str) -> Result<tokio::net::UnixStream, String> {
    if !std::path::Path::new(endpoint).is_absolute() {
        return Err("App Tools 必须使用本地绝对路径".into());
    }
    tokio::net::UnixStream::connect(endpoint)
        .await
        .map_err(|error| error.to_string())
}

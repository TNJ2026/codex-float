pub type Stream = tokio::net::windows::named_pipe::NamedPipeClient;

pub async fn connect() -> Result<Stream, String> {
    let endpoint =
        std::env::var("CODEX_FLOAT_IPC_PATH").unwrap_or_else(|_| r"\\.\pipe\codex-ipc".into());
    if !endpoint.starts_with(r"\\.\pipe\") {
        return Err("Windows IPC 地址必须为本地命名管道".into());
    }
    tokio::net::windows::named_pipe::ClientOptions::new()
        .open(endpoint)
        .map_err(|error| error.to_string())
}

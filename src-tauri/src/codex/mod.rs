mod client;
mod discovery;
pub(crate) mod commands;
pub(crate) mod index;
pub(crate) mod paths;
mod projects;

pub(crate) use client::{get_client, shutdown, Bridge};

use std::collections::HashSet;

pub(super) fn owner_for_connection(
    thread: &str,
    open_if_needed: bool,
    mut owner: impl FnMut(&str) -> Result<String, String>,
    open: impl FnOnce(&str) -> Result<(), String>,
    mut wait_for_retry: impl FnMut() -> bool,
) -> Result<String, String> {
    match owner(thread) {
        Ok(owner) => return Ok(owner),
        Err(error) if open_if_needed && error == "no-client-found" => {}
        Err(error) => return Err(error),
    }
    open(thread)?;
    while wait_for_retry() {
        match owner(thread) {
            Ok(owner) => return Ok(owner),
            Err(error) if error == "no-client-found" => {}
            Err(error) => return Err(error),
        }
    }
    Err("已请求在 Codex 主窗口打开聊天，但尚未就绪，请稍后重试同步".into())
}

pub(super) fn first_running(
    candidates: Vec<String>,
    mut owner: impl FnMut(&str) -> Result<String, String>,
) -> Result<Option<String>, String> {
    if candidates.len() > 64 {
        return Err("Too many chat candidates".into());
    }
    let mut seen = HashSet::new();
    for id in candidates {
        // A stale or corrupted saved selection must not block valid index entries.
        if uuid::Uuid::parse_str(&id).is_err() || !seen.insert(id.clone()) {
            continue;
        }
        match owner(&id) {
            Ok(_) => return Ok(Some(id)),
            Err(error) if error == "no-client-found" => continue,
            Err(error) => return Err(error),
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_selection_opens_an_unloaded_chat_once_and_waits_for_its_owner() {
        let thread = id(1);
        let mut opened = Vec::new();
        let mut attempts = 0;
        let owner = owner_for_connection(
            &thread,
            true,
            |queried| {
                assert_eq!(queried, thread);
                attempts += 1;
                if attempts < 3 {
                    Err("no-client-found".into())
                } else {
                    Ok("new-owner".into())
                }
            },
            |requested| {
                opened.push(requested.to_string());
                Ok(())
            },
            || true,
        )
        .unwrap();
        assert_eq!(owner, "new-owner");
        assert_eq!(opened, [thread]);
        assert_eq!(attempts, 3);
    }
    #[test]
    fn live_chats_background_connections_and_transport_errors_never_open_a_window() {
        for (open_if_needed, result) in [
            (true, Ok("owner".into())),
            (false, Err("no-client-found".into())),
            (true, Err("connection closed".into())),
        ] {
            assert_eq!(
                owner_for_connection(
                    &id(1),
                    open_if_needed,
                    |_| result.clone(),
                    |_| panic!("must not open a window"),
                    || panic!("must not retry")
                ),
                result
            );
        }
    }
    #[test]
    fn open_failures_and_retry_timeouts_are_reported_without_repeated_launches() {
        assert_eq!(
            owner_for_connection(
                &id(1),
                true,
                |_| Err("no-client-found".into()),
                |_| Err("could not open chat".into()),
                || panic!("must not retry")
            ),
            Err("could not open chat".into())
        );
        let mut retries = 0;
        let mut launches = 0;
        let result = owner_for_connection(
            &id(1),
            true,
            |_| Err("no-client-found".into()),
            |_| {
                launches += 1;
                Ok(())
            },
            || {
                retries += 1;
                retries <= 2
            },
        );
        assert_eq!(launches, 1);
        assert_eq!(
            result,
            Err("已请求在 Codex 主窗口打开聊天，但尚未就绪，请稍后重试同步".into())
        );
    }
    fn id(n: usize) -> String {
        format!("00000000-0000-4000-8000-{n:012}")
    }
    #[test]
    fn standalone_launch_skips_inactive_history_and_keeps_live_saved_selection() {
        let mut queried = Vec::new();
        let found = first_running(vec!["invalid".into(), id(1), id(1), id(2), id(3)], |id| {
            queried.push(id.to_owned());
            if id.ends_with('2') {
                Ok("owner".into())
            } else {
                Err("no-client-found".into())
            }
        })
        .unwrap();
        assert_eq!(found, Some(id(2)));
        assert_eq!(queried, vec![id(1), id(2)]);
        let found = first_running(vec![id(3), id(2)], |_| Ok("owner".into())).unwrap();
        assert_eq!(found, Some(id(3)));
    }
    #[test]
    fn missing_owners_and_transport_errors_are_distinct() {
        assert_eq!(
            first_running(vec![id(1)], |_| Err("no-client-found".into())),
            Ok(None)
        );
        let mut calls = 0;
        let result = first_running(vec![id(1), id(2)], |_| {
            calls += 1;
            Err("connection closed".into())
        });
        assert_eq!(result, Err("connection closed".into()));
        assert_eq!(calls, 1);
        assert!(first_running(vec![id(1); 65], |_| panic!("must not query")).is_err());
    }
}

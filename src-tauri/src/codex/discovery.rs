use std::collections::HashSet;

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

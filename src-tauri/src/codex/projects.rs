use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::{collections::HashMap, path::Path};

#[derive(Debug)]
struct Project {
    id: String,
    name: String,
    order: i64,
    roots: Vec<String>,
}
#[derive(Default)]
struct Catalog {
    projects: Vec<Project>,
    threads: HashMap<String, (String, Option<String>)>,
    aliases: HashMap<String, String>,
}

fn read_catalog(path: &Path) -> rusqlite::Result<Catalog> {
    // Read the live WAL snapshot without changing the desktop app's database.
    let mut db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    db.busy_timeout(std::time::Duration::from_millis(200))?;
    let tx = db.transaction()?;
    let mut catalog = Catalog::default();
    {
        let mut query =
            tx.prepare("SELECT id, name, position FROM projects ORDER BY position, id")?;
        for row in query.query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                order: row.get(2)?,
                roots: vec![],
            })
        })? {
            catalog.projects.push(row?);
        }
        let mut query =
            tx.prepare("SELECT project_id, path FROM project_roots ORDER BY position")?;
        for row in query.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })? {
            let (id, root) = row?;
            if let Some(project) = catalog.projects.iter_mut().find(|project| project.id == id) {
                project.roots.push(root);
            }
        }
        let mut query = tx.prepare("SELECT id, cwd, project_id FROM threads")?;
        for row in query.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                (row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?),
            ))
        })? {
            let (id, metadata) = row?;
            catalog.threads.insert(id, metadata);
        }
    }
    tx.commit()?;
    Ok(catalog)
}

fn normalized(path: &str) -> String {
    let path = path.replace('\\', "/");
    let path = if let Some(unc) = path.strip_prefix("//?/UNC/") {
        format!("//{unc}")
    } else {
        path.strip_prefix("//?/").unwrap_or(&path).to_string()
    };
    let path = if path.starts_with("//") || path.as_bytes().get(1) == Some(&b':') {
        path.to_lowercase()
    } else {
        path
    };
    if path == "/" {
        path
    } else {
        path.trim_end_matches('/').to_string()
    }
}

fn matching_root(cwd: &str, root: &str) -> Option<usize> {
    let cwd = normalized(cwd);
    let root = normalized(root);
    (!root.is_empty()
        && (cwd == root
            || cwd
                .strip_prefix(&root)
                .is_some_and(|suffix| root == "/" || suffix.starts_with('/'))))
    .then_some(root.len())
}

fn enrich(threads: &mut [Value], desktop: &Value, catalog: &Catalog) {
    for thread in threads {
        let id = thread["id"].as_str().unwrap_or_default().to_string();
        let metadata = catalog.threads.get(&id);
        if let Some((cwd, _)) = metadata {
            thread["cwd"] = json!(cwd);
        }
        let explicit = metadata.and_then(|(_, id)| id.as_deref());
        let projectless = desktop["projectless-thread-ids"]
            .as_array()
            .is_some_and(|ids| ids.iter().any(|v| v.as_str() == Some(&id)));
        let assignment = &desktop["thread-project-assignments"][&id];
        let legacy = (assignment["projectKind"] == "local")
            .then(|| assignment["projectId"].as_str())
            .flatten();
        let selected = if let Some(id) = explicit {
            catalog
                .projects
                .iter()
                .find(|project| project.id == id)
                .map(|project| (project, "assignment"))
        } else if projectless {
            None
        } else if let Some(id) = legacy {
            let id = catalog.aliases.get(id).map(String::as_str).unwrap_or(id);
            catalog
                .projects
                .iter()
                .find(|project| project.id == id)
                .map(|project| (project, "assignment"))
        } else if !assignment.is_null() {
            None
        } else {
            let cwd = metadata
                .map(|(cwd, _)| cwd.as_str())
                .or_else(|| thread["cwd"].as_str())
                .unwrap_or_default();
            catalog
                .projects
                .iter()
                .filter_map(|project| {
                    project
                        .roots
                        .iter()
                        .filter_map(|root| matching_root(cwd, root))
                        .max()
                        .map(|length| (project, length))
                })
                .max_by(|(a, al), (b, bl)| {
                    al.cmp(bl)
                        .then_with(|| b.order.cmp(&a.order))
                        .then_with(|| b.id.cmp(&a.id))
                })
                .map(|(project, _)| (project, "workspace"))
        };
        if let Some((project, source)) = selected {
            thread["project_id"] = json!(project.id);
            thread["project_name"] = json!(project.name);
            thread["project_order"] = json!(project.order);
            thread["project_source"] = json!(source);
        } else if explicit.is_none() && !projectless && assignment["projectKind"] == "local" {
            if let Some(id) = assignment["projectId"].as_str() {
                if let Some(name) = desktop["local-projects"][id]["name"].as_str() {
                    thread["project_id"] = json!(id);
                    thread["project_name"] = json!(name);
                    thread["project_order"] = json!(desktop["project-order"]
                        .as_array()
                        .and_then(|ids| ids.iter().position(|v| v.as_str() == Some(id)))
                        .unwrap_or(usize::MAX));
                    thread["project_source"] = json!("assignment");
                }
            }
        }
    }
}

pub(super) fn enrich_threads(threads: &mut [Value], desktop: &Value, home: &Path) {
    // Old installations or an unavailable database retain the legacy project assignments.
    let mut catalog = read_catalog(&home.join("state_5.sqlite")).unwrap_or_default();
    let host = format!("local:{}", home.display());
    if let Some(aliases) =
        desktop["app-server-project-id-by-legacy-project-id-by-host"][&host].as_object()
    {
        catalog.aliases.extend(
            aliases
                .iter()
                .filter_map(|(old, new)| new.as_str().map(|new| (old.clone(), new.to_string()))),
        );
    }
    enrich(threads, desktop, &catalog);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_resolution_uses_explicit_membership_then_deepest_workspace_and_respects_projectless()
    {
        let catalog = Catalog {
            aliases: HashMap::from([("old-root".into(), "root".into())]),
            projects: vec![
                Project {
                    id: "root".into(),
                    name: "项目".into(),
                    order: 1,
                    roots: vec!["D:\\Develop".into()],
                },
                Project {
                    id: "nested".into(),
                    name: "项目".into(),
                    order: 0,
                    roots: vec!["D:\\Develop\\codex-float-window".into()],
                },
            ],
            threads: HashMap::from([
                (
                    "current".into(),
                    ("\\\\?\\D:\\Develop\\CODEX-float-window\\src".into(), None),
                ),
                (
                    "explicit".into(),
                    (
                        "D:\\Develop\\codex-float-window".into(),
                        Some("root".into()),
                    ),
                ),
                (
                    "free".into(),
                    ("D:\\Develop\\codex-float-window".into(), None),
                ),
                ("similar".into(), ("D:\\Develop-other".into(), None)),
                (
                    "legacy".into(),
                    ("D:\\Develop\\codex-float-window".into(), None),
                ),
            ]),
        };
        let mut threads = vec![
            json!({"id":"current"}),
            json!({"id":"explicit"}),
            json!({"id":"free"}),
            json!({"id":"similar"}),
            json!({"id":"legacy"}),
        ];
        enrich(
            &mut threads,
            &json!({"projectless-thread-ids":["free"],"thread-project-assignments":{"legacy":{"projectKind":"local","projectId":"old-root"}}}),
            &catalog,
        );
        assert_eq!(threads[0]["project_id"], "nested");
        assert_eq!(threads[0]["project_source"], "workspace");
        assert_eq!(threads[1]["project_id"], "root");
        assert_eq!(threads[1]["project_source"], "assignment");
        assert!(threads[2]["project_id"].is_null());
        assert!(threads[3]["project_id"].is_null());
        assert_eq!(threads[4]["project_id"], "root", "explicit legacy assignments override workspace inference and share migrated project identities");
        assert_eq!(matching_root("/app/one", "/app"), Some(4));
        assert_eq!(matching_root("/APP/one", "/app"), None);
        assert_eq!(
            matching_root("\\\\?\\UNC\\host\\share\\src", "\\\\HOST\\share"),
            Some(12)
        );
    }

    #[test]
    fn live_database_is_opened_read_only_and_old_versions_keep_legacy_membership() {
        let path = std::env::temp_dir().join(format!(
            "codex-float-projects-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        {
            let db = Connection::open(&path).unwrap();
            db.execute_batch("CREATE TABLE projects(id TEXT,name TEXT,position INTEGER); CREATE TABLE project_roots(project_id TEXT,path TEXT,position INTEGER); CREATE TABLE threads(id TEXT,cwd TEXT,project_id TEXT); INSERT INTO projects VALUES('p','Current project',0); INSERT INTO project_roots VALUES('p','/workspace',0); INSERT INTO threads VALUES('t','/workspace/src',NULL);").unwrap();
        }
        let before = std::fs::read(&path).unwrap();
        let catalog = read_catalog(&path).unwrap();
        let mut threads = vec![json!({"id":"t"})];
        enrich(&mut threads, &Value::Null, &catalog);
        assert_eq!(threads[0]["project_name"], "Current project");
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::remove_file(path).unwrap();
        let mut threads = vec![json!({"id":"legacy"})];
        enrich(
            &mut threads,
            &json!({"thread-project-assignments":{"legacy":{"projectKind":"local","projectId":"old"}},"local-projects":{"old":{"name":"Legacy project"}}}),
            &Catalog::default(),
        );
        assert_eq!(threads[0]["project_name"], "Legacy project");
    }

    #[test]
    #[ignore = "Reads the current desktop installation without changing it"]
    fn installed_current_thread_project() {
        let id = std::env::var("CODEX_THREAD_ID").unwrap();
        let threads = super::super::index::indexed_threads(60).unwrap();
        let thread = threads
            .iter()
            .find(|thread| thread["id"] == id)
            .expect("current thread is listed");
        println!("{}", thread);
        assert_eq!(thread["project_name"], "codex-float-window");
    }
}

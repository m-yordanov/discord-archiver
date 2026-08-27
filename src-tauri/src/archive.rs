use std::collections::HashMap;
use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

const MESSAGES_DIR_NAMES: [&str; 3] = ["messages", "Messages", "MESSAGES"];

pub enum Source {
    Dir {
        root: PathBuf,
        messages_dir: PathBuf,
    },
    Zip {
        archive: zip::ZipArchive<BufReader<fs::File>>,
        index: HashMap<String, usize>,
        prefix: String,
        messages_name: String,
        folders: Vec<String>,
    },
}

fn is_zip(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("zip"))
}

fn detect_layout(names: &[String]) -> Option<(String, String)> {
    for name in names {
        let parts: Vec<&str> = name.split('/').collect();
        for depth in 0..parts.len().min(2) {
            if parts[depth].eq_ignore_ascii_case("messages") && parts.len() > depth + 1 {
                let prefix = if depth == 0 {
                    String::new()
                } else {
                    format!("{}/", parts[0])
                };
                return Some((prefix, parts[depth].to_string()));
            }
        }
    }
    None
}

fn collect_folders(names: &[String], messages_root: &str) -> Vec<String> {
    let lowered = messages_root.to_lowercase();
    let mut seen = Vec::new();

    for name in names {
        let lower = name.to_lowercase();
        let Some(rest) = lower.strip_prefix(&lowered) else {
            continue;
        };
        let original_rest = &name[messages_root.len()..];
        let mut segments = original_rest.splitn(2, '/');
        let Some(folder) = segments.next() else {
            continue;
        };
        if folder.is_empty() || segments.next().is_none() || !rest.contains('/') {
            continue;
        }
        if !seen.iter().any(|f: &String| f.eq_ignore_ascii_case(folder)) {
            seen.push(folder.to_string());
        }
    }

    seen
}

impl Source {
    pub fn open(path: &str) -> Result<Self, String> {
        let path = Path::new(path);

        if path.is_dir() {
            let messages_dir = MESSAGES_DIR_NAMES
                .iter()
                .map(|name| path.join(name))
                .find(|p| p.is_dir())
                .or_else(|| {
                    let looks_like_messages = path.join("index.json").exists()
                        || path
                            .file_name()
                            .is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case("messages"));
                    looks_like_messages.then(|| path.to_path_buf())
                })
                .ok_or_else(|| {
                    "Could not find a messages folder in that data package.".to_string()
                })?;

            let root = messages_dir.parent().unwrap_or(path).to_path_buf();
            return Ok(Source::Dir { root, messages_dir });
        }

        if !path.exists() {
            return Err(format!("{} does not exist", path.display()));
        }
        if !is_zip(path) {
            return Err(format!(
                "{} is not a folder or a .zip archive",
                path.display()
            ));
        }

        let file = fs::File::open(path)
            .map_err(|e| format!("Could not open {}: {}", path.display(), e))?;
        let archive = zip::ZipArchive::new(BufReader::new(file))
            .map_err(|e| format!("{} is not a readable zip archive: {}", path.display(), e))?;

        let names: Vec<String> = archive.file_names().map(str::to_string).collect();
        let (prefix, messages_name) = detect_layout(&names).ok_or_else(|| {
            "Could not find a messages folder in that archive.".to_string()
        })?;

        let mut index = HashMap::with_capacity(names.len());
        for (i, name) in names.iter().enumerate() {
            index.insert(name.to_lowercase(), i);
        }

        let messages_root = format!("{}{}/", prefix, messages_name);
        let folders = collect_folders(&names, &messages_root);

        Ok(Source::Zip {
            archive,
            index,
            prefix,
            messages_name,
            folders,
        })
    }

    fn read_zip(&mut self, name: &str) -> Option<String> {
        let Source::Zip { archive, index, .. } = self else {
            return None;
        };
        let position = *index.get(&name.to_lowercase())?;
        let mut entry = archive.by_index(position).ok()?;
        let mut out = String::new();
        entry.read_to_string(&mut out).ok()?;
        Some(out)
    }

    pub fn read_root(&mut self, dirs: &[&str], file: &str) -> Option<String> {
        match self {
            Source::Dir { root, .. } => {
                let root = root.clone();
                dirs.iter()
                    .map(|d| {
                        if d.is_empty() {
                            root.join(file)
                        } else {
                            root.join(d).join(file)
                        }
                    })
                    .find_map(|p| fs::read_to_string(p).ok())
            }
            Source::Zip { prefix, .. } => {
                let prefix = prefix.clone();
                let candidates: Vec<String> = dirs
                    .iter()
                    .map(|d| {
                        if d.is_empty() {
                            format!("{}{}", prefix, file)
                        } else {
                            format!("{}{}/{}", prefix, d, file)
                        }
                    })
                    .collect();
                candidates.into_iter().find_map(|name| self.read_zip(&name))
            }
        }
    }

    pub fn read_messages_index(&mut self) -> Option<String> {
        match self {
            Source::Dir { messages_dir, .. } => {
                fs::read_to_string(messages_dir.join("index.json")).ok()
            }
            Source::Zip {
                prefix,
                messages_name,
                ..
            } => {
                let name = format!("{}{}/index.json", prefix, messages_name);
                self.read_zip(&name)
            }
        }
    }

    pub fn read_channel(&mut self, folder: &str, file: &str) -> Option<String> {
        match self {
            Source::Dir { messages_dir, .. } => {
                fs::read_to_string(messages_dir.join(folder).join(file)).ok()
            }
            Source::Zip {
                prefix,
                messages_name,
                ..
            } => {
                let name = format!("{}{}/{}/{}", prefix, messages_name, folder, file);
                self.read_zip(&name)
            }
        }
    }

    pub fn channel_folders(&self) -> Vec<String> {
        match self {
            Source::Dir { messages_dir, .. } => {
                let Ok(entries) = fs::read_dir(messages_dir) else {
                    return Vec::new();
                };
                entries
                    .flatten()
                    .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .collect()
            }
            Source::Zip { folders, .. } => folders.clone(),
        }
    }
}

pub fn remove_legacy_cache() {
    let legacy = std::env::temp_dir().join("discord-archiver");
    if legacy.is_dir() {
        let _ = fs::remove_dir_all(legacy);
    }
}

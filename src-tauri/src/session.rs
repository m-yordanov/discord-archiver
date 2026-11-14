use crate::archive::Source;
use crate::models::{DataIndex, Message};
use crate::parser;
use crate::search::{self, GlobalSearchResponse, SearchChannel, SearchCorpus};
use crate::stats::PackageStats;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

struct CachedChannel {
    folder_names: Vec<String>,
    messages: Vec<Message>,
}

pub struct Session {
    source: Mutex<Source>,
    folders: HashSet<String>,
    stats: PackageStats,
    search_channels: Vec<SearchChannel>,
    channel_cache: Mutex<Option<CachedChannel>>,
    search_corpus: Mutex<Option<SearchCorpus>>,
}

impl Session {
    pub fn open(path: &str) -> Result<(Self, DataIndex), String> {
        let (index, source, stats) = parser::parse_package_source(path)?;
        let folders = index
            .direct_messages
            .iter()
            .chain(index.servers.iter().flat_map(|server| &server.channels))
            .flat_map(|channel| channel.folder_names.iter().cloned())
            .collect();
        let session = Session {
            source: Mutex::new(source),
            folders,
            stats,
            search_channels: search::channels_of(&index),
            channel_cache: Mutex::new(None),
            search_corpus: Mutex::new(None),
        };
        Ok((session, index))
    }

    pub fn stats(&self) -> &PackageStats {
        &self.stats
    }

    fn check_folders(&self, folder_names: &[String]) -> Result<(), String> {
        if folder_names.iter().all(|folder| self.folders.contains(folder)) {
            Ok(())
        } else {
            Err("That conversation is not part of the open data package.".to_string())
        }
    }

    pub fn with_channel_messages<T>(
        &self,
        folder_names: &[String],
        read: impl FnOnce(&[Message]) -> T,
    ) -> Result<T, String> {
        self.check_folders(folder_names)?;
        let mut cache = self.channel_cache.lock().map_err(|e| e.to_string())?;

        let cached = match cache.take() {
            Some(cached) if cached.folder_names == folder_names => cached,
            _ => {
                let (texts, default_user_id) = {
                    let mut source = self.source.lock().map_err(|e| e.to_string())?;
                    parser::read_channel_texts_from_source(&mut source, folder_names)
                };
                CachedChannel {
                    folder_names: folder_names.to_vec(),
                    messages: parser::parse_channel_messages(&texts, default_user_id.as_ref()),
                }
            }
        };

        let result = read(&cached.messages);
        *cache = Some(cached);
        Ok(result)
    }

    pub fn raw_message(&self, folder_names: &[String], message_id: &str) -> Result<String, String> {
        self.check_folders(folder_names)?;
        let mut source = self.source.lock().map_err(|e| e.to_string())?;
        parser::load_raw_message_from_source(&mut source, folder_names, message_id)
    }

    pub fn search_all(
        &self,
        query: &str,
        scope: &str,
        limit: usize,
    ) -> Result<GlobalSearchResponse, String> {
        let mut guard = self.search_corpus.lock().map_err(|e| e.to_string())?;
        let corpus = match guard.take() {
            Some(corpus) => corpus,
            None => {
                let mut source = self.source.lock().map_err(|e| e.to_string())?;
                SearchCorpus::build(&mut source, self.search_channels.clone())
            }
        };
        let result = corpus.search(query, scope, limit);
        *guard = Some(corpus);
        Ok(result)
    }

    pub fn clear_channel_cache(&self) {
        if let Ok(mut cache) = self.channel_cache.lock() {
            *cache = None;
        }
    }
}

#[derive(Default)]
pub struct AppState {
    session: Mutex<Option<Arc<Session>>>,
}

impl AppState {
    pub fn session(&self) -> Result<Arc<Session>, String> {
        self.session
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or_else(|| "No data package loaded.".to_string())
    }

    pub fn replace(&self, session: Option<Session>) -> Result<(), String> {
        let _previous = std::mem::replace(
            &mut *self.session.lock().map_err(|e| e.to_string())?,
            session.map(Arc::new),
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::tests::fixture;

    fn alice_folders(index: &DataIndex) -> Vec<String> {
        index
            .direct_messages
            .iter()
            .find(|dm| dm.name == "Alice")
            .expect("Alice DM")
            .folder_names
            .clone()
    }

    #[test]
    fn only_folders_of_the_open_package_are_readable() {
        let (session, index) = Session::open(&fixture()).expect("fixture should open");
        let alice = alice_folders(&index);
        assert_eq!(session.with_channel_messages(&alice, |m| m.len()), Ok(5));
        assert!(session.raw_message(&alice, "m1").is_ok());

        for folder in ["..", "../messages/c001", "c001/..", "C:/Windows", "/etc", "c999", ""] {
            let folders = vec![folder.to_string()];
            assert!(session.with_channel_messages(&folders, |m| m.len()).is_err(), "{folder}");
            assert!(session.raw_message(&folders, "m1").is_err(), "{folder}");
        }

        let mixed = vec![alice[0].clone(), "../c002".to_string()];
        assert!(session.with_channel_messages(&mixed, |m| m.len()).is_err());
    }

    #[test]
    fn work_started_on_a_package_stays_on_that_package() {
        let state = AppState::default();
        assert!(state.session().is_err());

        let (session, index) = Session::open(&fixture()).expect("fixture should open");
        let alice = alice_folders(&index);
        state.replace(Some(session)).unwrap();
        let in_flight = state.session().unwrap();

        state.replace(None).unwrap();
        assert!(state.session().is_err());
        assert_eq!(in_flight.with_channel_messages(&alice, |m| m.len()), Ok(5));
        assert_eq!(in_flight.search_all("first", "all", 0).unwrap().total_matches, 1);
    }
}

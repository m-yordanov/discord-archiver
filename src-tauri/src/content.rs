use crate::media::{is_audio, is_image, is_video};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

const TOP_WORDS: usize = 30;
const TOP_EMOJI: usize = 15;
const TOP_DOMAINS: usize = 10;
const TOP_MENTIONS: usize = 10;

type Counts = HashMap<String, u32>;

static STOP_WORDS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    HashSet::from([
        "a", "about", "after", "again", "all", "also", "am", "an", "and", "any", "are", "as", "at",
        "be", "because", "been", "before", "being", "but", "by", "can", "could", "did", "do", "does",
        "doing", "don't", "for", "from", "get", "got", "had", "has", "have", "having", "he", "her",
        "here", "him", "his", "how", "i", "i'm", "if", "in", "into", "is", "it", "it's", "its",
        "just", "me", "more", "my", "no", "not", "now", "of", "on", "one", "only", "or", "our",
        "out", "over", "she", "so", "some", "than", "that", "that's", "the", "their", "them",
        "then", "there", "these", "they", "this", "those", "to", "too", "up", "us", "very", "was",
        "we", "were", "what", "when", "where", "which", "who", "why", "will", "with", "would",
        "you", "you're", "your",
    ])
});

#[derive(Serialize, Clone)]
pub struct CountedTerm {
    pub term: String,
    pub count: u32,
}

#[derive(Serialize, Clone, Default)]
pub struct AttachmentCounts {
    pub images: u32,
    pub videos: u32,
    pub audio: u32,
    pub files: u32,
}

#[derive(Serialize, Clone, Default)]
pub struct ContentStats {
    pub text_messages: u32,
    pub characters: u64,
    pub words: u64,
    pub top_words: Vec<CountedTerm>,
    pub top_emoji: Vec<CountedTerm>,
    pub attachments: AttachmentCounts,
    pub links: u32,
    pub top_domains: Vec<CountedTerm>,
    pub top_mentions: Vec<CountedTerm>,
    pub calls: u32,
    pub call_seconds: u64,
}

#[derive(Default)]
pub struct ContentTally {
    text_messages: u32,
    characters: u64,
    words: u64,
    word_counts: Counts,
    emoji_counts: Counts,
    domain_counts: Counts,
    mention_counts: Counts,
    attachments: AttachmentCounts,
    links: u32,
    calls: u32,
    call_seconds: u64,
}

fn bump(counts: &mut Counts, term: &str) {
    match counts.get_mut(term) {
        Some(count) => *count += 1,
        None => {
            counts.insert(term.to_string(), 1);
        }
    }
}

fn top_terms(counts: Counts, limit: usize) -> Vec<CountedTerm> {
    let mut terms: Vec<CountedTerm> = counts
        .into_iter()
        .map(|(term, count)| CountedTerm { term, count })
        .collect();
    terms.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.term.cmp(&b.term)));
    terms.truncate(limit);
    terms
}

fn link_domain(token: &str) -> Option<String> {
    let start = token.find("http")?;
    let rest = &token[start..];
    let rest = rest.strip_prefix("https://").or_else(|| rest.strip_prefix("http://"))?;
    let host = rest
        .split(['/', '?', '#', '>', ')', ']', ':', '|', '"'])
        .next()?
        .to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    (host.contains('.') && !host.starts_with('.')).then(|| host.to_string())
}

fn is_emoji_start(c: char) -> bool {
    matches!(
        c as u32,
        0x1F000..=0x1FAFF | 0x2600..=0x27BF | 0x2300..=0x23FF | 0x2B00..=0x2BFF
    )
}

fn is_regional_indicator(c: char) -> bool {
    matches!(c as u32, 0x1F1E6..=0x1F1FF)
}

fn is_skin_tone(c: char) -> bool {
    matches!(c as u32, 0x1F3FB..=0x1F3FF)
}

fn emoji_in(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut chars = text.chars().peekable();

    while let Some(c) = chars.next() {
        if !is_emoji_start(c) {
            continue;
        }

        let mut cluster = String::from(c);
        if is_regional_indicator(c) {
            if let Some(next) = chars.next_if(|&n| is_regional_indicator(n)) {
                cluster.push(next);
            }
            found.push(cluster);
            continue;
        }

        loop {
            if chars.next_if(|&n| n == '\u{FE0F}').is_some() {
                continue;
            }
            if let Some(tone) = chars.next_if(|&n| is_skin_tone(n)) {
                cluster.push(tone);
                continue;
            }
            if chars.next_if(|&n| n == '\u{200D}').is_some() {
                cluster.push('\u{200D}');
                if let Some(joined) = chars.next() {
                    cluster.push(joined);
                }
                continue;
            }
            break;
        }

        if cluster.chars().count() == 1 && (c as u32) < 0x1F000 {
            cluster.push('\u{FE0F}');
        }
        found.push(cluster);
    }

    found
}

fn custom_emoji_in(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = text;
    while let Some(at) = rest.find('<') {
        rest = &rest[at + 1..];
        let body = rest.strip_prefix("a:").or_else(|| rest.strip_prefix(':'));
        let Some(body) = body else { continue };
        let Some(end) = body.find('>') else { break };
        if let Some((name, id)) = body[..end].split_once(':') {
            if !name.is_empty() && !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()) {
                found.push(format!(":{}:", name));
            }
        }
    }
    found
}

fn mentions_in(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = text;
    while let Some(at) = rest.find("<@") {
        rest = &rest[at + 2..];
        let body = rest.strip_prefix('!').unwrap_or(rest);
        let Some(end) = body.find('>') else { break };
        let id = &body[..end];
        if !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()) {
            found.push(id.to_string());
        }
    }
    found
}

impl ContentTally {
    pub fn add_message(
        &mut self,
        contents: Option<&str>,
        attachments: Option<&str>,
        call: Option<&serde_json::Value>,
        message_type: Option<&serde_json::Value>,
    ) {
        if let Some(text) = contents.filter(|t| !t.trim().is_empty()) {
            self.add_text(text);
        }

        for url in attachments
            .unwrap_or_default()
            .split([',', ' ', '\n'])
            .map(str::trim)
            .filter(|u| !u.is_empty())
        {
            if is_image(url) {
                self.attachments.images += 1;
            } else if is_video(url) {
                self.attachments.videos += 1;
            } else if is_audio(url) {
                self.attachments.audio += 1;
            } else {
                self.attachments.files += 1;
            }
        }

        match call {
            Some(serde_json::Value::Object(map)) => {
                self.calls += 1;
                self.call_seconds += map
                    .get("duration")
                    .and_then(|d| d.as_u64().or_else(|| d.as_f64().map(|f| f as u64)))
                    .unwrap_or(0);
            }
            _ if message_type.is_some_and(|t| t.as_i64() == Some(3) || t.as_str() == Some("CALL")) => {
                self.calls += 1;
            }
            _ => {}
        }
    }

    fn add_text(&mut self, text: &str) {
        self.text_messages += 1;
        self.characters += text.chars().count() as u64;
        let mut word_buf = String::new();

        for token in text.split_whitespace() {
            if let Some(domain) = link_domain(token) {
                self.links += 1;
                bump(&mut self.domain_counts, &domain);
                continue;
            }
            if token.contains('<') {
                continue;
            }

            for word in token
                .split(|c: char| !(c.is_alphanumeric() || c == '\'' || c == '’'))
                .map(|w| w.trim_matches(|c| c == '\'' || c == '’'))
                .filter(|w| !w.is_empty())
            {
                self.words += 1;
                word_buf.clear();
                if word.is_ascii() {
                    word_buf.push_str(word);
                    word_buf.make_ascii_lowercase();
                } else {
                    for c in word.chars() {
                        if c == '’' {
                            word_buf.push('\'');
                        } else {
                            word_buf.extend(c.to_lowercase());
                        }
                    }
                }
                if word_buf.chars().nth(1).is_none()
                    || word_buf.chars().all(|c| c.is_numeric())
                    || STOP_WORDS.contains(word_buf.as_str())
                {
                    continue;
                }
                bump(&mut self.word_counts, &word_buf);
            }
        }

        for emoji in emoji_in(text).iter().chain(&custom_emoji_in(text)) {
            bump(&mut self.emoji_counts, emoji);
        }
        for id in mentions_in(text) {
            bump(&mut self.mention_counts, &id);
        }
    }

    pub fn finish(self, user_map: &HashMap<String, String>) -> ContentStats {
        let top_mentions = top_terms(self.mention_counts, TOP_MENTIONS)
            .into_iter()
            .map(|mention| CountedTerm {
                term: user_map.get(&mention.term).cloned().unwrap_or(mention.term),
                count: mention.count,
            })
            .collect();

        ContentStats {
            text_messages: self.text_messages,
            characters: self.characters,
            words: self.words,
            top_words: top_terms(self.word_counts, TOP_WORDS),
            top_emoji: top_terms(self.emoji_counts, TOP_EMOJI),
            attachments: self.attachments,
            links: self.links,
            top_domains: top_terms(self.domain_counts, TOP_DOMAINS),
            top_mentions,
            calls: self.calls,
            call_seconds: self.call_seconds,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tally(messages: &[&str]) -> ContentStats {
        let mut tally = ContentTally::default();
        for text in messages {
            tally.add_message(Some(text), None, None, None);
        }
        tally.finish(&HashMap::from([("555".to_string(), "Sam".to_string())]))
    }

    fn terms(list: &[CountedTerm]) -> Vec<(&str, u32)> {
        list.iter().map(|t| (t.term.as_str(), t.count)).collect()
    }

    #[test]
    fn counts_words_without_stop_words_links_or_markup() {
        let stats = tally(&[
            "The Rust borrow checker, honestly!",
            "rust again <@555> see https://www.example.com/page and <:pepe:123>",
            "I'm 100% sure it's Rust’s fault",
        ]);

        assert_eq!(stats.text_messages, 3);
        assert_eq!(stats.top_words[0].term, "rust");
        assert_eq!(stats.top_words[0].count, 2);
        assert!(stats.top_words.iter().all(|w| w.term != "the" && w.term != "100"));
        assert!(stats.top_words.iter().any(|w| w.term == "rust's"));
        assert!(stats.top_words.iter().all(|w| !w.term.contains("example")));
        assert_eq!(stats.words, 15);
    }

    #[test]
    fn finds_links_and_their_domains() {
        let stats = tally(&[
            "look https://www.youtube.com/watch?v=1 and http://YouTube.com/x",
            "[docs](https://docs.rs/serde) <https://example.com>",
            "not a link: https:// or www.nothing",
        ]);

        assert_eq!(stats.links, 4);
        assert_eq!(
            terms(&stats.top_domains),
            vec![("youtube.com", 2), ("docs.rs", 1), ("example.com", 1)]
        );
    }

    #[test]
    fn groups_emoji_sequences_and_custom_emoji() {
        let stats = tally(&[
            "\u{1F602}\u{1F602} \u{1F44D}\u{1F3FD} \u{2764}\u{FE0F} \u{2764} \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467} \u{1F1E7}\u{1F1EC} <a:party:42> <:party:43>",
        ]);

        assert_eq!(
            terms(&stats.top_emoji),
            vec![
                (":party:", 2),
                ("\u{2764}\u{FE0F}", 2),
                ("\u{1F602}", 2),
                ("\u{1F1E7}\u{1F1EC}", 1),
                ("\u{1F44D}\u{1F3FD}", 1),
                ("\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}", 1),
            ]
        );
    }

    #[test]
    fn resolves_mentions_and_ignores_roles() {
        let stats = tally(&["<@555> <@!555> <@&999> <@777>"]);
        assert_eq!(terms(&stats.top_mentions), vec![("Sam", 2), ("777", 1)]);
    }

    #[test]
    fn counts_attachments_and_calls() {
        let mut tally = ContentTally::default();
        tally.add_message(
            Some(""),
            Some("https://cdn.x/a.png https://cdn.x/b.mp4,https://cdn.x/voice-message.ogg https://cdn.x/c.pdf"),
            None,
            None,
        );
        tally.add_message(
            Some(""),
            None,
            Some(&serde_json::json!({ "duration": 1920 })),
            Some(&serde_json::json!(3)),
        );
        tally.add_message(None, None, None, Some(&serde_json::json!("CALL")));
        let stats = tally.finish(&HashMap::new());

        assert_eq!(stats.text_messages, 0);
        assert_eq!(stats.attachments.images, 1);
        assert_eq!(stats.attachments.videos, 1);
        assert_eq!(stats.attachments.audio, 1);
        assert_eq!(stats.attachments.files, 1);
        assert_eq!(stats.calls, 2);
        assert_eq!(stats.call_seconds, 1920);
    }
}

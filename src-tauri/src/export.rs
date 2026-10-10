use crate::media::{is_audio, is_image, is_video};
use crate::models::Message;
use crate::stats::epoch_seconds;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{self, BufWriter, Write};

#[derive(Serialize)]
pub struct ExportResult {
    pub count: usize,
    pub file_path: String,
    pub total_bytes: u64,
}

#[derive(Serialize)]
struct JsonExport<'a> {
    title: &'a str,
    message_count: usize,
    messages: &'a [Message],
}

const HTML_STYLE: &str = "
body{margin:0;background:#313338;color:#dbdee1;font:15px/1.4 'gg sans','Helvetica Neue',Helvetica,Arial,sans-serif}
header{position:sticky;top:0;background:#2b2d31;padding:14px 24px;border-bottom:1px solid #1e1f22}
header h1{margin:0;font-size:17px;color:#f2f3f5}
header p{margin:2px 0 0;font-size:12px;color:#949ba4}
main{padding:8px 24px 32px;max-width:1100px}
.day{display:flex;align-items:center;gap:8px;margin:24px 0 8px;font-size:12px;font-weight:600;color:#949ba4}
.day::before,.day::after{content:'';flex:1;border-top:1px solid #3f4147}
.msg{display:flex;gap:12px;padding:2px 0}
.msg.first{margin-top:14px}
.time{width:52px;flex-shrink:0;text-align:right;font-size:11px;color:#949ba4;padding-top:3px}
.body{min-width:0;flex:1}
.author{font-weight:600;color:#f2f3f5;margin-right:6px}
.text{white-space:pre-wrap;word-wrap:break-word}
.reply{font-size:13px;color:#949ba4;margin-bottom:2px}
.media img,.media video{max-width:400px;max-height:300px;border-radius:8px;display:block;margin-top:6px}
.media audio{display:block;margin-top:6px}
.file,.sticker,.call{font-size:13px;color:#b5bac1;margin-top:4px}
.embed{border-left:4px solid #5865f2;background:#2b2d31;border-radius:4px;padding:8px 12px;margin-top:6px;max-width:520px}
.embed .provider{font-size:12px;color:#949ba4}
.embed .description{font-size:13px;white-space:pre-wrap}
a{color:#00a8fc;text-decoration:none}
a:hover{text-decoration:underline}
";

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 { month_index + 3 } else { month_index - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn utc_date_and_time(timestamp: &str) -> (String, String) {
    match epoch_seconds(timestamp) {
        Some(seconds) => {
            let (year, month, day) = civil_from_days(seconds.div_euclid(86_400));
            let in_day = seconds.rem_euclid(86_400);
            (
                format!("{:04}-{:02}-{:02}", year, month, day),
                format!("{:02}:{:02}", in_day / 3600, in_day % 3600 / 60),
            )
        }
        None => (timestamp.to_string(), String::new()),
    }
}

fn format_duration(seconds: u64) -> String {
    match (seconds / 3600, seconds % 3600 / 60) {
        (0, minutes) => format!("{}m", minutes.max(1)),
        (hours, 0) => format!("{}h", hours),
        (hours, minutes) => format!("{}h {}m", hours, minutes),
    }
}

fn reply_summary(message: &Message, by_id: &HashMap<&str, &Message>) -> Option<String> {
    let reference = message.message_reference.as_ref()?;
    let original = by_id.get(reference.message_id.as_str());
    let author = reference
        .author
        .clone()
        .or_else(|| original.map(|m| m.author.clone()));
    let snippet = reference
        .contents
        .clone()
        .or_else(|| original.map(|m| m.contents.clone()))
        .filter(|c| !c.trim().is_empty())
        .map(|c| {
            let flat = c.split_whitespace().collect::<Vec<_>>().join(" ");
            if flat.chars().count() > 80 {
                format!("{}…", flat.chars().take(80).collect::<String>())
            } else {
                flat
            }
        });

    Some(match (author, snippet) {
        (Some(author), Some(snippet)) => format!("{}: {}", author, snippet),
        (Some(author), None) => author,
        (None, Some(snippet)) => snippet,
        (None, None) => format!("message {}", reference.message_id),
    })
}

fn write_text(out: &mut impl Write, messages: &[Message], title: &str) -> io::Result<()> {
    let by_id: HashMap<&str, &Message> = messages.iter().map(|m| (m.id.as_str(), m)).collect();
    writeln!(out, "{}", title)?;
    writeln!(out, "{} messages, times in UTC", messages.len())?;

    for message in messages {
        let (date, time) = utc_date_and_time(&message.timestamp);
        writeln!(out)?;
        if let Some(reply) = reply_summary(message, &by_id) {
            writeln!(out, "  ↪ replying to {}", reply)?;
        }

        let mut lines = message.contents.lines();
        writeln!(out, "[{} {}] {}: {}", date, time, message.author, lines.next().unwrap_or(""))?;
        for line in lines {
            writeln!(out, "  {}", line)?;
        }

        for url in &message.attachments {
            writeln!(out, "  Attachment: {}", url)?;
        }
        for sticker in &message.stickers {
            writeln!(out, "  Sticker: {}", sticker.name)?;
        }
        for embed in &message.embeds {
            let label = embed.title.as_deref().or(embed.provider_name.as_deref()).unwrap_or("Embed");
            match &embed.url {
                Some(url) => writeln!(out, "  Embed: {} ({})", label, url)?,
                None => writeln!(out, "  Embed: {}", label)?,
            }
        }
        if let Some(call) = &message.call_info {
            match call.duration_seconds.filter(|&s| s > 0) {
                Some(seconds) => writeln!(out, "  Call, {}", format_duration(seconds))?,
                None => writeln!(out, "  Call")?,
            }
        }
    }
    Ok(())
}

fn escape_html(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            other => escaped.push(other),
        }
    }
    escaped
}

fn link(url: &str, label: &str) -> String {
    format!(
        "<a href=\"{}\" target=\"_blank\" rel=\"noopener noreferrer\">{}</a>",
        escape_html(url),
        escape_html(label)
    )
}

fn next_url_start(text: &str) -> Option<usize> {
    [text.find("http://"), text.find("https://")]
        .into_iter()
        .flatten()
        .min()
}

fn linkify(text: &str) -> String {
    let mut html = String::with_capacity(text.len() + 16);
    let mut rest = text;
    while let Some(start) = next_url_start(rest) {
        html.push_str(&escape_html(&rest[..start]));
        let tail = &rest[start..];
        let end = tail
            .find(|c: char| c.is_whitespace() || matches!(c, '<' | '>' | '"'))
            .unwrap_or(tail.len());
        let url = tail[..end].trim_end_matches(['.', ',', '!', '?', ')', ']', ':', ';']);
        html.push_str(&link(url, url));
        rest = &tail[url.len()..];
    }
    html.push_str(&escape_html(rest));
    html
}

fn write_html(out: &mut impl Write, messages: &[Message], title: &str) -> io::Result<()> {
    let by_id: HashMap<&str, &Message> = messages.iter().map(|m| (m.id.as_str(), m)).collect();
    let title = escape_html(title);
    write!(
        out,
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>{title}</title>\n<style>{HTML_STYLE}</style>\n</head>\n<body>\n<header><h1>{title}</h1><p>{} messages · times in UTC · exported with Discord Archiver</p></header>\n<main>\n",
        messages.len()
    )?;

    let mut previous: Option<(String, &str, i64)> = None;
    for message in messages {
        let (date, time) = utc_date_and_time(&message.timestamp);
        let seconds = epoch_seconds(&message.timestamp).unwrap_or(0);
        let reply = reply_summary(message, &by_id);

        let new_day = previous.as_ref().is_none_or(|(day, _, _)| *day != date);
        if new_day {
            writeln!(out, "<div class=\"day\">{}</div>", escape_html(&date))?;
        }
        let starts_group = new_day
            || reply.is_some()
            || previous
                .as_ref()
                .is_none_or(|(_, author, at)| *author != message.author || seconds - at > 7 * 60);

        write!(
            out,
            "<div class=\"msg{}\" id=\"m{}\"><div class=\"time\">{}</div><div class=\"body\">",
            if starts_group { " first" } else { "" },
            escape_html(&message.id),
            escape_html(&time)
        )?;
        if let Some(reply) = reply {
            write!(out, "<div class=\"reply\">↪ {}</div>", escape_html(&reply))?;
        }
        if starts_group {
            write!(out, "<span class=\"author\">{}</span>", escape_html(&message.author))?;
        }
        if !message.contents.is_empty() {
            write!(out, "<span class=\"text\">{}</span>", linkify(&message.contents))?;
        }

        for url in &message.attachments {
            let src = escape_html(url);
            if is_image(url) {
                write!(out, "<div class=\"media\"><a href=\"{src}\" target=\"_blank\" rel=\"noopener noreferrer\"><img src=\"{src}\" loading=\"lazy\" alt=\"\"></a></div>")?;
            } else if is_video(url) {
                write!(out, "<div class=\"media\"><video src=\"{src}\" controls preload=\"none\"></video></div>")?;
            } else if is_audio(url) {
                write!(out, "<div class=\"media\"><audio src=\"{src}\" controls preload=\"none\"></audio></div>")?;
            } else {
                let name = url.split('?').next().unwrap_or(url).rsplit('/').next().unwrap_or(url);
                write!(out, "<div class=\"file\">📎 {}</div>", link(url, name))?;
            }
        }
        for sticker in &message.stickers {
            write!(
                out,
                "<div class=\"sticker\"><img src=\"{}\" alt=\"{}\" title=\"{}\" width=\"96\" loading=\"lazy\"></div>",
                escape_html(&sticker.url),
                escape_html(&sticker.name),
                escape_html(&sticker.name)
            )?;
        }
        for embed in &message.embeds {
            write!(out, "<div class=\"embed\">")?;
            if let Some(provider) = &embed.provider_name {
                write!(out, "<div class=\"provider\">{}</div>", escape_html(provider))?;
            }
            match (&embed.title, &embed.url) {
                (Some(title), Some(url)) => write!(out, "<div>{}</div>", link(url, title))?,
                (Some(title), None) => write!(out, "<div>{}</div>", escape_html(title))?,
                (None, Some(url)) => write!(out, "<div>{}</div>", link(url, url))?,
                (None, None) => {}
            }
            if let Some(description) = &embed.description {
                write!(out, "<div class=\"description\">{}</div>", linkify(description))?;
            }
            write!(out, "</div>")?;
        }
        if let Some(call) = &message.call_info {
            let duration = call
                .duration_seconds
                .filter(|&s| s > 0)
                .map(|s| format!(", {}", format_duration(s)))
                .unwrap_or_default();
            write!(out, "<div class=\"call\">📞 Call{}</div>", duration)?;
        }

        writeln!(out, "</div></div>")?;
        previous = Some((date, message.author.as_str(), seconds));
    }

    writeln!(out, "</main>\n</body>\n</html>")
}

pub fn write_export(
    messages: &[Message],
    format: &str,
    title: &str,
    save_path: &str,
) -> Result<ExportResult, String> {
    let file = fs::File::create(save_path)
        .map_err(|e| format!("Could not create {}: {}", save_path, e))?;
    let mut out = BufWriter::new(file);

    let written = match format {
        "text" => write_text(&mut out, messages, title),
        "html" => write_html(&mut out, messages, title),
        "json" => serde_json::to_writer_pretty(
            &mut out,
            &JsonExport {
                title,
                message_count: messages.len(),
                messages,
            },
        )
        .map_err(io::Error::other),
        other => return Err(format!("Unknown export format: {}", other)),
    };
    written
        .and_then(|_| out.flush())
        .map_err(|e| format!("Could not write {}: {}", save_path, e))?;

    Ok(ExportResult {
        count: messages.len(),
        file_path: save_path.to_string(),
        total_bytes: fs::metadata(save_path).map(|m| m.len()).unwrap_or(0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CallInfo, MessageReference};

    fn message(id: &str, timestamp: &str, contents: &str) -> Message {
        Message {
            id: id.into(),
            timestamp: timestamp.into(),
            contents: contents.into(),
            attachments: vec![],
            stickers: vec![],
            embeds: vec![],
            call_info: None,
            message_type: "DEFAULT".into(),
            author: "You".into(),
            author_id: None,
            message_reference: None,
        }
    }

    fn sample() -> Vec<Message> {
        let first = message("1", "2024-02-29T23:58:00.000+00:00", "hello\nsecond line");
        let reply = Message {
            attachments: vec!["https://cdn.example.com/a/photo.png?ex=1".into()],
            message_reference: Some(MessageReference {
                message_id: "1".into(),
                ..Default::default()
            }),
            ..message("2", "2024-03-01T02:05:00.000+02:00", "see https://example.com/x).")
        };
        let call = Message {
            call_info: Some(CallInfo {
                duration_seconds: Some(1920),
                ..Default::default()
            }),
            ..message("3", "2024-03-01T09:00:00Z", "")
        };
        vec![first, reply, call]
    }

    #[test]
    fn converts_timestamps_to_utc_dates() {
        assert_eq!(utc_date_and_time("1970-01-01T00:00:00Z"), ("1970-01-01".into(), "00:00".into()));
        assert_eq!(utc_date_and_time("2024-02-29T23:58:00.000+00:00"), ("2024-02-29".into(), "23:58".into()));
        assert_eq!(utc_date_and_time("2024-03-01T02:05:00.000+02:00"), ("2024-03-01".into(), "00:05".into()));
        assert_eq!(utc_date_and_time("1999-12-31T23:59:59-01:00"), ("2000-01-01".into(), "00:59".into()));
        assert_eq!(utc_date_and_time("garbage").0, "garbage");
    }

    #[test]
    fn writes_a_readable_text_transcript() {
        let mut out = Vec::new();
        write_text(&mut out, &sample(), "@Alice").unwrap();
        let text = String::from_utf8(out).unwrap();

        assert!(text.starts_with("@Alice\n3 messages, times in UTC\n"));
        assert!(text.contains("[2024-02-29 23:58] You: hello\n  second line\n"));
        assert!(text.contains("  ↪ replying to You: hello second line\n[2024-03-01 00:05] You: see"));
        assert!(text.contains("  Attachment: https://cdn.example.com/a/photo.png?ex=1\n"));
        assert!(text.contains("[2024-03-01 09:00] You: \n  Call, 32m\n"));
    }

    #[test]
    fn writes_escaped_html_with_links_and_media() {
        let mut messages = sample();
        messages.push(message("4", "2024-03-01T09:01:00Z", "<script>alert('x')</script> & co"));
        let mut out = Vec::new();
        write_html(&mut out, &messages, "<b>@Alice</b>").unwrap();
        let html = String::from_utf8(out).unwrap();

        assert!(html.contains("<title>&lt;b&gt;@Alice&lt;/b&gt;</title>"));
        assert!(html.contains("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; co"));
        assert!(!html.contains("<script>"));
        assert!(html.contains("<a href=\"https://example.com/x\" target=\"_blank\" rel=\"noopener noreferrer\">https://example.com/x</a>)."));
        assert!(html.contains("<img src=\"https://cdn.example.com/a/photo.png?ex=1\""));
        assert!(html.contains("📞 Call, 32m"));
        assert_eq!(html.matches("<div class=\"day\">").count(), 2);
    }

    #[test]
    fn writes_json_that_reads_back() {
        let path = std::env::temp_dir().join("discord-archiver-export-test.json");
        let result = write_export(&sample(), "json", "@Alice", &path.to_string_lossy()).unwrap();
        assert_eq!(result.count, 3);
        assert!(result.total_bytes > 0);

        let parsed: serde_json::Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(parsed["title"], "@Alice");
        assert_eq!(parsed["message_count"], 3);
        assert_eq!(parsed["messages"][1]["message_reference"]["message_id"], "1");
        let _ = fs::remove_file(path);

        assert!(write_export(&sample(), "pdf", "x", &std::env::temp_dir().join("x.pdf").to_string_lossy()).is_err());
    }
}

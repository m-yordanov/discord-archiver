use crate::archive::Source;
use crate::models::RawMessage;
use crate::parser;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Serialize, Clone)]
pub struct HourBucket {
    pub hour: i64,
    pub count: u32,
}

#[derive(Serialize, Clone)]
pub struct ChannelStats {
    pub id: String,
    pub name: String,
    pub channel_type: String,
    pub folder_name: String,
    pub message_count: usize,
    pub hours: Vec<HourBucket>,
}

#[derive(Serialize, Clone)]
pub struct PackageStats {
    pub total_messages: usize,
    pub username: String,
    pub server_count: usize,
    pub channels: Vec<ChannelStats>,
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month_index = (month + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146097 + day_of_era - 719468
}

pub fn epoch_seconds(timestamp: &str) -> Option<i64> {
    if timestamp.len() < 19 || !timestamp.is_char_boundary(19) {
        return None;
    }
    let field = |from: usize, to: usize| timestamp.get(from..to)?.parse::<i64>().ok();

    let seconds = days_from_civil(field(0, 4)?, field(5, 7)?, field(8, 10)?) * 86_400
        + field(11, 13)? * 3600
        + field(14, 16)? * 60
        + field(17, 19)?;

    let tail = &timestamp[19..];
    let offset = match tail.rfind(['+', '-']) {
        Some(at) => {
            let sign = if tail.as_bytes()[at] == b'-' { -1 } else { 1 };
            let rest = &tail[at + 1..];
            let hours: i64 = rest.get(0..2).and_then(|s| s.parse().ok()).unwrap_or(0);
            let minutes: i64 = rest.get(3..5).and_then(|s| s.parse().ok()).unwrap_or(0);
            sign * (hours * 3600 + minutes * 60)
        }
        None => 0,
    };

    Some(seconds - offset)
}

fn hourly_buckets(source: &mut Source, folders: &[String]) -> Vec<HourBucket> {
    let mut counts: HashMap<i64, u32> = HashMap::new();

    for folder in folders {
        let Some(text) = source.read_channel(folder, "messages.json") else {
            continue;
        };
        let Ok(messages) = serde_json::from_str::<Vec<RawMessage>>(&text) else {
            continue;
        };
        for message in messages {
            if let Some(seconds) = epoch_seconds(&message.timestamp) {
                *counts.entry(seconds.div_euclid(3600)).or_insert(0) += 1;
            }
        }
    }

    let mut buckets: Vec<HourBucket> = counts
        .into_iter()
        .map(|(hour, count)| HourBucket { hour, count })
        .collect();
    buckets.sort_by_key(|bucket| bucket.hour);
    buckets
}

pub fn compute_stats(path: &str) -> Result<PackageStats, String> {
    let index = parser::parse_data_package(path)?;
    let mut source = Source::open(path)?;

    let listed = index
        .direct_messages
        .iter()
        .chain(index.servers.iter().flat_map(|server| &server.channels));

    let mut channels = Vec::new();
    let mut total_messages = 0;

    for channel in listed {
        let hours = hourly_buckets(&mut source, &channel.folder_names);
        total_messages += channel.message_count;
        channels.push(ChannelStats {
            id: channel.id.clone(),
            name: channel.name.clone(),
            channel_type: channel.channel_type.clone(),
            folder_name: channel.folder_name.clone(),
            message_count: channel.message_count,
            hours,
        });
    }

    Ok(PackageStats {
        total_messages,
        username: index.username,
        server_count: index.servers.len(),
        channels,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_discord_timestamp_formats() {
        assert_eq!(epoch_seconds("1970-01-01T00:00:00.000+00:00"), Some(0));
        assert_eq!(epoch_seconds("2024-01-15T10:30:00.000+00:00"), Some(1_705_314_600));
        assert_eq!(epoch_seconds("2024-01-15T10:30:00Z"), Some(1_705_314_600));
        assert_eq!(epoch_seconds("2024-01-15 10:30:00"), Some(1_705_314_600));
    }

    #[test]
    fn applies_the_utc_offset() {
        let utc = epoch_seconds("2024-01-15T10:30:00.000+00:00").unwrap();
        assert_eq!(epoch_seconds("2024-01-15T12:30:00.000+02:00"), Some(utc));
        assert_eq!(epoch_seconds("2024-01-15T05:30:00.000-05:00"), Some(utc));
    }

    #[test]
    fn handles_leap_days_and_rejects_junk() {
        let feb29 = epoch_seconds("2024-02-29T00:00:00Z").unwrap();
        let feb28 = epoch_seconds("2024-02-28T00:00:00Z").unwrap();
        assert_eq!(feb29 - feb28, 86_400);

        let mar01 = epoch_seconds("2023-03-01T00:00:00Z").unwrap();
        let feb28_2023 = epoch_seconds("2023-02-28T00:00:00Z").unwrap();
        assert_eq!(mar01 - feb28_2023, 86_400);

        assert_eq!(epoch_seconds("not a timestamp"), None);
        assert_eq!(epoch_seconds("2024-01"), None);
    }

    #[test]
    fn buckets_land_on_the_right_hour() {
        let base = epoch_seconds("2024-01-15T10:00:00Z").unwrap();
        let same_hour = epoch_seconds("2024-01-15T10:59:59Z").unwrap();
        let next_hour = epoch_seconds("2024-01-15T11:00:00Z").unwrap();

        assert_eq!(base.div_euclid(3600), same_hour.div_euclid(3600));
        assert_eq!(next_hour.div_euclid(3600), base.div_euclid(3600) + 1);
    }
}

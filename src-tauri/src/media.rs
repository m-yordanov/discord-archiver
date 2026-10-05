pub fn is_image(url: &str) -> bool {
    let clean = url.split('?').next().unwrap_or(url).to_lowercase();
    clean.ends_with(".png")
        || clean.ends_with(".jpg")
        || clean.ends_with(".jpeg")
        || clean.ends_with(".gif")
        || clean.ends_with(".webp")
        || clean.ends_with(".bmp")
        || clean.ends_with(".svg")
}

pub fn is_video(url: &str) -> bool {
    let clean = url.split('?').next().unwrap_or(url).to_lowercase();
    clean.ends_with(".mp4")
        || clean.ends_with(".webm")
        || clean.ends_with(".mov")
        || clean.ends_with(".mkv")
}

pub fn is_audio(url: &str) -> bool {
    let clean = url.split('?').next().unwrap_or(url).to_lowercase();
    clean.ends_with(".mp3")
        || clean.ends_with(".ogg")
        || clean.ends_with(".wav")
        || clean.ends_with(".m4a")
        || clean.ends_with(".aac")
        || clean.ends_with(".flac")
        || clean.ends_with(".opus")
        || clean.ends_with(".oga")
        || clean.contains("voice-message")
        || clean.contains("voice_message")
}

pub fn is_other_file(url: &str) -> bool {
    !is_image(url) && !is_video(url) && !is_audio(url)
}

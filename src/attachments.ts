export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
export const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov'];
export const AUDIO_EXTENSIONS = ['.mp3', '.ogg', '.wav', '.m4a', '.aac', '.flac', '.opus', '.oga'];

export const hasExtension = (url: string, extensions: string[]) => {
  const path = url.split('?')[0].toLowerCase();
  return extensions.some(ext => path.endsWith(ext));
};

export const isImage = (url: string) => hasExtension(url, IMAGE_EXTENSIONS);
export const isVideo = (url: string) => hasExtension(url, VIDEO_EXTENSIONS);
export const isAudio = (url: string) => {
  const clean = url.split('?')[0].toLowerCase();
  return (
    hasExtension(url, AUDIO_EXTENSIONS) ||
    clean.includes('voice-message') ||
    clean.includes('voice_message')
  );
};
export const isOtherFile = (url: string) => !isImage(url) && !isVideo(url) && !isAudio(url);

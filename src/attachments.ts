export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
export const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov'];

export const hasExtension = (url: string, extensions: string[]) => {
  const path = url.split('?')[0].toLowerCase();
  return extensions.some(ext => path.endsWith(ext));
};

export const isImage = (url: string) => hasExtension(url, IMAGE_EXTENSIONS);
export const isVideo = (url: string) => hasExtension(url, VIDEO_EXTENSIONS);
export const isOtherFile = (url: string) => !isImage(url) && !isVideo(url);

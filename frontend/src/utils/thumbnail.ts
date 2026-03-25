/**
 * Client-side thumbnail generation for images and videos.
 *
 * Thumbnails are generated entirely in the browser (zero-knowledge),
 * encrypted separately, and uploaded as their own file blobs.
 */

const DEFAULT_MAX_SIZE = 200;
const JPEG_QUALITY = 0.7;
const DEFAULT_VIDEO_CAPTURE_TIME = 1.0;

/**
 * Generates a JPEG thumbnail for an image file.
 *
 * Resizes to fit within maxSize×maxSize while preserving aspect ratio.
 * Output format: JPEG, quality 0.7 (typically < 50 KB).
 *
 * @param file     - Source image file (jpeg, png, gif, webp)
 * @param maxSize  - Max width/height in pixels (default 200)
 * @returns JPEG Blob or null if generation fails
 */
export async function generateImageThumbnail(
  file: File,
  maxSize: number = DEFAULT_MAX_SIZE,
): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const blob = renderToJpegBlob(bitmap, maxSize);
    bitmap.close();
    return blob;
  } catch {
    return null;
  }
}

/**
 * Generates a JPEG poster-frame thumbnail for a video file.
 *
 * Loads the video off-screen, seeks to `captureTime` (falls back to 0
 * for very short videos), draws the frame onto a canvas and exports JPEG.
 *
 * @param file        - Source video file (mp4, webm)
 * @param captureTime - Time in seconds to capture (default 1.0)
 * @returns JPEG Blob or null if capture fails
 */
export async function generateVideoThumbnail(
  file: File,
  captureTime: number = DEFAULT_VIDEO_CAPTURE_TIME,
): Promise<Blob | null> {
  try {
    const bitmap = await captureVideoFrame(file, captureTime);
    if (!bitmap) return null;
    const blob = renderToJpegBlob(bitmap, DEFAULT_MAX_SIZE);
    bitmap.close();
    return blob;
  } catch {
    return null;
  }
}

// ============================================
// Internals
// ============================================

/**
 * Renders an ImageBitmap into a JPEG Blob, scaling to fit within maxSize.
 */
function renderToJpegBlob(
  bitmap: ImageBitmap,
  maxSize: number,
): Promise<Blob | null> {
  const { width, height } = computeFitDimensions(
    bitmap.width,
    bitmap.height,
    maxSize,
  );

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);

  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
}

/**
 * Computes dimensions that fit within maxSize×maxSize while preserving
 * the original aspect ratio. Returns at least 1×1.
 */
function computeFitDimensions(
  srcWidth: number,
  srcHeight: number,
  maxSize: number,
): { width: number; height: number } {
  if (srcWidth <= maxSize && srcHeight <= maxSize) {
    return { width: srcWidth || 1, height: srcHeight || 1 };
  }
  const ratio = Math.min(maxSize / srcWidth, maxSize / srcHeight);
  return {
    width: Math.max(1, Math.round(srcWidth * ratio)),
    height: Math.max(1, Math.round(srcHeight * ratio)),
  };
}

/**
 * Loads a video file into an off-screen <video>, seeks to the requested
 * time, and captures the frame as an ImageBitmap.
 */
function captureVideoFrame(
  file: File,
  captureTime: number,
): Promise<ImageBitmap | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 10_000);

    video.addEventListener('error', () => {
      clearTimeout(timeoutId);
      cleanup();
      resolve(null);
    });

    video.addEventListener('loadedmetadata', () => {
      const seekTarget =
        video.duration > captureTime ? captureTime : 0;
      video.currentTime = seekTarget;
    });

    video.addEventListener('seeked', async () => {
      clearTimeout(timeoutId);
      try {
        const bitmap = await createImageBitmap(video);
        cleanup();
        resolve(bitmap);
      } catch {
        cleanup();
        resolve(null);
      }
    });

    video.src = url;
  });
}

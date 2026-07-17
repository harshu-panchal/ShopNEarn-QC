function inferExtension(url, blobType) {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split('.').pop()?.split('?')[0]?.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) {
      return ext === 'jpeg' ? 'jpg' : ext;
    }
  } catch {
    /* ignore */
  }

  if (blobType?.includes('png')) return 'png';
  if (blobType?.includes('webp')) return 'webp';
  if (blobType?.includes('gif')) return 'gif';
  return 'jpg';
}

function withCloudinaryAttachment(url) {
  if (!url.includes('cloudinary.com') || url.includes('/fl_attachment')) {
    return url;
  }
  return url.replace('/upload/', '/upload/fl_attachment/');
}

/**
 * Download a remote file (e.g. payment screenshot URL) as a local save.
 * Falls back to Cloudinary attachment URL when fetch is blocked by CORS.
 */
export async function downloadRemoteFile(url, filenameBase = 'download') {
  if (!url) throw new Error('Missing file URL');

  const safeBase = String(filenameBase)
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'download';

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Download failed');
    const blob = await response.blob();
    const ext = inferExtension(url, blob.type);
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `${safeBase}.${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    return;
  } catch {
    const attachmentUrl = withCloudinaryAttachment(url);
    const link = document.createElement('a');
    link.href = attachmentUrl;
    link.download = safeBase;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}

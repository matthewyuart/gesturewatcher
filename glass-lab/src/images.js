// User-supplied background photos, kept in localStorage as downscaled data URLs
// so they survive reloads. Photos never leave the browser.

const KEY = 'glasslab:images';
const MAX_EDGE = 2048;
const QUALITY = 0.85;

export function listImages() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((i) => i && typeof i.url === 'string') : [];
  } catch {
    return [];
  }
}

function persist(images) {
  localStorage.setItem(KEY, JSON.stringify(images));
}

// Read a File, downscale it so localStorage can hold a few, return {name, url}.
export function fileToEntry(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('not an image'));
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve({
          name: file.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'image',
          url: c.toDataURL('image/jpeg', QUALITY),
        });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Returns the index of the added image, or throws if storage is full.
export function addImage(entry) {
  const images = listImages();
  images.push(entry);
  try {
    persist(images);
  } catch {
    throw new Error('storage full — remove an image first');
  }
  return images.length - 1;
}

export function removeImage(index) {
  const images = listImages();
  if (index < 0 || index >= images.length) return;
  images.splice(index, 1);
  try { persist(images); } catch {}
}

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scanResultsPath = path.resolve(__dirname, '../cloudinary_scan_results.json');
const scanData = JSON.parse(fs.readFileSync(scanResultsPath, 'utf8'));

const cloudinaryDir = path.resolve(__dirname, '../../cloudinary');

// Index all files in local cloudinary backup folder
const diskFilesMap = new Map(); // relPath.toLowerCase() -> fullPath
const diskFilesByName = new Map(); // filename.toLowerCase() -> array of fullPaths

function indexDiskDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      indexDiskDir(fullPath);
    } else if (entry.isFile() && !entry.name.endsWith('.meta.json') && entry.name !== 'index.json') {
      const relPath = path.relative(cloudinaryDir, fullPath).replace(/\\/g, '/');
      diskFilesMap.set(relPath.toLowerCase(), fullPath);
      
      const fn = entry.name.toLowerCase();
      if (!diskFilesByName.has(fn)) diskFilesByName.set(fn, []);
      diskFilesByName.get(fn).push(fullPath);
    }
  }
}
indexDiskDir(cloudinaryDir);

console.log(`Total files in local backup folder: ${diskFilesMap.size}`);

// Also parse index.json to map old URLs / public_ids to local files if possible
let indexJsonRaw = fs.readFileSync(path.join(cloudinaryDir, 'index.json'), 'utf8');
if (indexJsonRaw.charCodeAt(0) === 0xFEFF) indexJsonRaw = indexJsonRaw.slice(1);
const indexEntries = JSON.parse(indexJsonRaw);

const indexByPublicId = new Map();
const indexByUrl = new Map();
for (const entry of indexEntries) {
  if (entry.public_id) indexByPublicId.set(entry.public_id.toLowerCase(), entry);
  if (entry.secure_url) indexByUrl.set(entry.secure_url.toLowerCase(), entry);
  if (entry.delivery_url) indexByUrl.set(entry.delivery_url.toLowerCase(), entry);
  if (entry.url) indexByUrl.set(entry.url.toLowerCase(), entry);
}

function findLocalFileForUrl(url) {
  // Try 1: check index.json by exact URL
  const idxEntry = indexByUrl.get(url.toLowerCase());
  if (idxEntry && idxEntry.public_id) {
    const fn = path.basename(idxEntry.public_id).toLowerCase();
    // check if fn or fn+format exists on disk
    if (diskFilesByName.has(fn)) return diskFilesByName.get(fn)[0];
    if (idxEntry.format && diskFilesByName.has(`${fn}.${idxEntry.format}`.toLowerCase())) {
      return diskFilesByName.get(`${fn}.${idxEntry.format}`.toLowerCase())[0];
    }
  }

  // Try 2: Extract upload path from URL
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\?.*)?$/);
  if (match) {
    const relUrlPath = match[1]; // e.g. categories/aeatqgaevxoxolzkt086.png or products/...
    if (diskFilesMap.has(relUrlPath.toLowerCase())) {
      return diskFilesMap.get(relUrlPath.toLowerCase());
    }
    // Try extensions
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.svg']) {
      if (diskFilesMap.has((relUrlPath + ext).toLowerCase())) {
        return diskFilesMap.get((relUrlPath + ext).toLowerCase());
      }
    }
    // Try by filename
    const filename = path.basename(relUrlPath);
    if (diskFilesByName.has(filename.toLowerCase())) {
      return diskFilesByName.get(filename.toLowerCase())[0];
    }
    const nameWithoutExt = path.basename(filename, path.extname(filename));
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.svg']) {
      if (diskFilesByName.has((nameWithoutExt + ext).toLowerCase())) {
        return diskFilesByName.get((nameWithoutExt + ext).toLowerCase())[0];
      }
    }
  }

  return null;
}

// Group dbRefs by collection
const collectionStats = {};

scanData.dbRefs.forEach(ref => {
  if (!collectionStats[ref.collection]) {
    collectionStats[ref.collection] = { total: 0, matched: 0, missing: 0, urls: new Set() };
  }
  const stats = collectionStats[ref.collection];
  stats.total++;
  stats.urls.add(ref.url);
});

console.log('\n--- COLLECTION MATCH BREAKDOWN ---');
for (const [col, stats] of Object.entries(collectionStats)) {
  let matchedUnique = 0;
  let missingUnique = 0;
  for (const url of stats.urls) {
    const localFile = findLocalFileForUrl(url);
    if (localFile) {
      matchedUnique++;
    } else {
      missingUnique++;
    }
  }
  console.log(JSON.stringify({
    collection: col,
    totalDbRefs: stats.total,
    uniqueUrls: stats.urls.size,
    matchedOnDisk: matchedUnique,
    missingOnDisk: missingUnique
  }));
}

const fileStats = { total: scanData.fileRefs.length, urls: new Set(scanData.fileRefs.map(r => r.url)) };
let fileMatched = 0;
for (const url of fileStats.urls) {
  if (findLocalFileForUrl(url)) fileMatched++;
}
console.log(JSON.stringify({
  source: "codebase_files",
  totalFileRefs: fileStats.total,
  uniqueUrls: fileStats.urls.size,
  matchedOnDisk: fileMatched,
  missingOnDisk: fileStats.urls.size - fileMatched
}));



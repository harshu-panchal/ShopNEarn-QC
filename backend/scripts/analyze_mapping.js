import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scanResultsPath = path.resolve(__dirname, '../cloudinary_scan_results.json');
const scanData = JSON.parse(fs.readFileSync(scanResultsPath, 'utf8'));

const cloudinaryDir = path.resolve(__dirname, '../../cloudinary');
let indexJsonRaw = fs.readFileSync(path.join(cloudinaryDir, 'index.json'), 'utf8');
if (indexJsonRaw.charCodeAt(0) === 0xFEFF) {
  indexJsonRaw = indexJsonRaw.slice(1);
}
const indexEntries = JSON.parse(indexJsonRaw);

console.log(`Total index.json entries: ${indexEntries.length}`);

// Map index.json by public_id, filename, delivery_url, url, secure_url
const indexByPublicId = new Map();
const indexByFilename = new Map();
const indexByUrlPath = new Map(); // e.g. path after upload/

for (const entry of indexEntries) {
  if (entry.public_id) {
    indexByPublicId.set(entry.public_id.toLowerCase(), entry);
    const fname = path.basename(entry.public_id).toLowerCase();
    if (!indexByFilename.has(fname)) {
      indexByFilename.set(fname, entry);
    }
  }
  const url = entry.secure_url || entry.delivery_url || entry.url;
  if (url) {
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+)$/);
    if (match) {
      indexByUrlPath.set(match[1].toLowerCase(), entry);
    }
  }
}

// Build disk file map (case insensitive)
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

      // also store without extension if any
      const nameWithoutExt = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
      if (!diskFilesByName.has(nameWithoutExt)) diskFilesByName.set(nameWithoutExt, []);
      diskFilesByName.get(nameWithoutExt).push(fullPath);
    }
  }
}

indexDiskDir(cloudinaryDir);
console.log(`Indexed ${diskFilesMap.size} files on disk.`);

// Analyze each unique URL found in DB & codebase
const allUrls = new Set([...scanData.dbRefs.map(r => r.url), ...scanData.fileRefs.map(r => r.url)]);
console.log(`Analyzing ${allUrls.size} unique project URLs...`);

let foundOnDisk = 0;
let missingOnDisk = 0;
const missingUrls = [];
const matchedDetails = [];

for (const url of allUrls) {
  // Extract path from URL
  // e.g. https://res.cloudinary.com/dvjxvvpcx/image/upload/v1727771725/categories/aeatqgaevxoxolzkt086.png
  // or https://res.cloudinary.com/dv1l9sb4p/image/upload/v1784875570/media/images/vhdwbgmqleeswoezrl4c.png
  const uploadMatch = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\?.*)?$/);
  let relUrlPath = uploadMatch ? uploadMatch[1] : '';
  let filename = relUrlPath ? path.basename(relUrlPath) : path.basename(url);
  let filenameWithoutExt = path.basename(filename, path.extname(filename));

  let localDiskPath = null;

  // Strategy 1: Check relUrlPath on disk
  if (relUrlPath && diskFilesMap.has(relUrlPath.toLowerCase())) {
    localDiskPath = diskFilesMap.get(relUrlPath.toLowerCase());
  }

  // Strategy 2: Check relUrlPath without extension or with different extensions on disk
  if (!localDiskPath && relUrlPath) {
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.svg']) {
      if (diskFilesMap.has((relUrlPath + ext).toLowerCase())) {
        localDiskPath = diskFilesMap.get((relUrlPath + ext).toLowerCase());
        break;
      }
    }
  }

  // Strategy 3: Check filename on disk
  if (!localDiskPath && filename) {
    const matches = diskFilesByName.get(filename.toLowerCase());
    if (matches && matches.length > 0) {
      localDiskPath = matches[0];
    }
  }

  // Strategy 4: Check filenameWithoutExt on disk
  if (!localDiskPath && filenameWithoutExt) {
    const matches = diskFilesByName.get(filenameWithoutExt.toLowerCase());
    if (matches && matches.length > 0) {
      localDiskPath = matches[0];
    }
  }

  // Strategy 5: Lookup in index.json to get public_id or url, then check disk
  if (!localDiskPath && relUrlPath) {
    const idxEntry = indexByUrlPath.get(relUrlPath.toLowerCase()) || 
                     indexByPublicId.get(relUrlPath.toLowerCase()) || 
                     indexByFilename.get(filename.toLowerCase()) || 
                     indexByFilename.get(filenameWithoutExt.toLowerCase());
    if (idxEntry && idxEntry.public_id) {
      const pubId = idxEntry.public_id;
      const pubIdFilename = path.basename(pubId);
      const matches = diskFilesByName.get(pubIdFilename.toLowerCase()) || 
                      diskFilesByName.get((pubIdFilename + '.' + (idxEntry.format || 'jpg')).toLowerCase());
      if (matches && matches.length > 0) {
        localDiskPath = matches[0];
      }
    }
  }

  if (localDiskPath) {
    foundOnDisk++;
    matchedDetails.push({ url, relUrlPath, localDiskPath });
  } else {
    missingOnDisk++;
    missingUrls.push({ url, relUrlPath, filename });
  }
}

console.log(`\n--- MAPPING RESULTS ---`);
console.log(`Found on disk: ${foundOnDisk}`);
console.log(`Missing on disk: ${missingOnDisk}`);

if (missingUrls.length > 0) {
  console.log('\nSample Missing URLs (first 15):');
  missingUrls.slice(0, 15).forEach(m => console.log(` - ${m.url} (relPath: ${m.relUrlPath}, fn: ${m.filename})`));
}

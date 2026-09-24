import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const CLOUDINARY_DIR = path.resolve(__dirname, '../../cloudinary');
const CACHE_FILE = path.resolve(__dirname, '../cloudinary_migration_cache.json');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

console.log(`Cloudinary Configured for Cloud Name: ${process.env.CLOUDINARY_CLOUD_NAME}`);

// Load cache if exists
let migrationCache = {};
if (fs.existsSync(CACHE_FILE)) {
  try {
    migrationCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    console.log(`Loaded migration cache with ${Object.keys(migrationCache).length} entries.`);
  } catch (e) {
    console.warn('Could not read cache file, starting fresh.');
  }
}

function saveCache() {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(migrationCache, null, 2));
}

// 1. Index local backup files
const diskFilesMap = new Map(); // relPath.toLowerCase() -> fullPath
const diskFilesByName = new Map(); // filename.toLowerCase() -> fullPath array

function indexDiskDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      indexDiskDir(fullPath);
    } else if (entry.isFile() && !entry.name.endsWith('.meta.json') && entry.name !== 'index.json') {
      const relPath = path.relative(CLOUDINARY_DIR, fullPath).replace(/\\/g, '/');
      diskFilesMap.set(relPath.toLowerCase(), fullPath);

      const fn = entry.name.toLowerCase();
      if (!diskFilesByName.has(fn)) diskFilesByName.set(fn, []);
      diskFilesByName.get(fn).push(fullPath);

      const nameWithoutExt = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
      if (!diskFilesByName.has(nameWithoutExt)) diskFilesByName.set(nameWithoutExt, []);
      diskFilesByName.get(nameWithoutExt).push(fullPath);
    }
  }
}

indexDiskDir(CLOUDINARY_DIR);
console.log(`Indexed ${diskFilesMap.size} local backup files.`);

// Index index.json if present
let indexByUrl = new Map();
let indexByPublicId = new Map();
const indexJsonPath = path.join(CLOUDINARY_DIR, 'index.json');
if (fs.existsSync(indexJsonPath)) {
  let text = fs.readFileSync(indexJsonPath, 'utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  try {
    const idxData = JSON.parse(text);
    for (const entry of idxData) {
      if (entry.public_id) indexByPublicId.set(entry.public_id.toLowerCase(), entry);
      if (entry.secure_url) indexByUrl.set(entry.secure_url.toLowerCase(), entry);
      if (entry.delivery_url) indexByUrl.set(entry.delivery_url.toLowerCase(), entry);
      if (entry.url) indexByUrl.set(entry.url.toLowerCase(), entry);
    }
    console.log(`Parsed index.json with ${idxData.length} entries.`);
  } catch (e) {
    console.warn('Failed to parse index.json:', e.message);
  }
}

function findLocalFileForUrl(url) {
  if (!url || typeof url !== 'string') return null;

  // Check index.json by exact URL
  const idxEntry = indexByUrl.get(url.toLowerCase());
  if (idxEntry && idxEntry.public_id) {
    const fn = path.basename(idxEntry.public_id).toLowerCase();
    if (diskFilesByName.has(fn)) return diskFilesByName.get(fn)[0];
    if (idxEntry.format && diskFilesByName.has(`${fn}.${idxEntry.format}`.toLowerCase())) {
      return diskFilesByName.get(`${fn}.${idxEntry.format}`.toLowerCase())[0];
    }
  }

  // Extract path from URL
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\?.*)?$/);
  if (match) {
    const relUrlPath = match[1];
    if (diskFilesMap.has(relUrlPath.toLowerCase())) {
      return diskFilesMap.get(relUrlPath.toLowerCase());
    }
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif']) {
      if (diskFilesMap.has((relUrlPath + ext).toLowerCase())) {
        return diskFilesMap.get((relUrlPath + ext).toLowerCase());
      }
    }
    const filename = path.basename(relUrlPath);
    if (diskFilesByName.has(filename.toLowerCase())) {
      return diskFilesByName.get(filename.toLowerCase())[0];
    }
    const nameWithoutExt = path.basename(filename, path.extname(filename));
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif']) {
      if (diskFilesByName.has((nameWithoutExt + ext).toLowerCase())) {
        return diskFilesByName.get((nameWithoutExt + ext).toLowerCase())[0];
      }
    }
  }

  return null;
}

// Upload a local file to Cloudinary
async function uploadToCloudinary(localPath) {
  if (migrationCache[localPath]) {
    return migrationCache[localPath];
  }

  const relPath = path.relative(CLOUDINARY_DIR, localPath).replace(/\\/g, '/');
  const dirName = path.dirname(relPath);
  const ext = path.extname(localPath);
  const baseName = path.basename(localPath, ext);

  const folder = dirName !== '.' ? dirName : 'uploads';
  const publicId = baseName;

  try {
    const res = await cloudinary.uploader.upload(localPath, {
      folder,
      public_id: publicId,
      overwrite: true,
      resource_type: 'auto'
    });

    const newUrl = res.secure_url;
    migrationCache[localPath] = newUrl;
    saveCache();
    return newUrl;
  } catch (err) {
    console.error(`Failed to upload ${localPath}:`, err.message);
    return null;
  }
}

// Batch upload helper with concurrency limit
async function uploadAllFiles(localFiles, concurrency = 5) {
  console.log(`Starting upload for ${localFiles.length} files with concurrency ${concurrency}...`);
  const results = new Map(); // localPath -> newUrl
  let completed = 0;

  for (let i = 0; i < localFiles.length; i += concurrency) {
    const chunk = localFiles.slice(i, i + concurrency);
    await Promise.all(chunk.map(async (file) => {
      const url = await uploadToCloudinary(file);
      if (url) {
        results.set(file, url);
      }
      completed++;
      if (completed % 25 === 0 || completed === localFiles.length) {
        console.log(`Upload Progress: ${completed}/${localFiles.length} files completed.`);
      }
    }));
  }

  return results;
}

async function main() {
  console.log('=== STARTING CLOUDINARY IMAGE MIGRATION ===\n');

  // 1. Connect to MongoDB
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB.\n');

  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();

  // Map of url -> localFile
  const urlToLocalFile = new Map();
  // Store references in DB: { collection, docId, fieldPath, oldUrl }
  const dbImageReferences = [];

  console.log('Scanning all MongoDB collections for image URLs...');

  for (const colInfo of collections) {
    const colName = colInfo.name;
    const col = db.collection(colName);
    const cursor = col.find({});

    while (await cursor.hasNext()) {
      const doc = await cursor.next();

      function scanDoc(val, fieldPath = '') {
        if (!val) return;
        if (typeof val === 'string') {
          if (val.includes('cloudinary.com') || val.match(/https?:\/\/[^\s"'`<>]+/)) {
            const localFile = findLocalFileForUrl(val);
            if (localFile) {
              urlToLocalFile.set(val, localFile);
              dbImageReferences.push({
                collection: colName,
                docId: doc._id,
                fieldPath,
                oldUrl: val,
                localFile
              });
            }
          }
        } else if (Array.isArray(val)) {
          val.forEach((item, idx) => scanDoc(item, fieldPath ? `${fieldPath}.${idx}` : `${idx}`));
        } else if (typeof val === 'object' && !(val instanceof mongoose.Types.ObjectId) && !(val instanceof Date)) {
          for (const [k, v] of Object.entries(val)) {
            scanDoc(v, fieldPath ? `${fieldPath}.${k}` : k);
          }
        }
      }

      scanDoc(doc);
    }
  }

  console.log(`Found ${dbImageReferences.length} database image references matching local backup files.`);
  console.log(`Unique old URLs to update: ${urlToLocalFile.size}`);

  // 2. Identify unique local files to upload
  const uniqueLocalFiles = Array.from(new Set(urlToLocalFile.values()));
  console.log(`Unique local backup image files to upload: ${uniqueLocalFiles.length}\n`);

  // 3. Upload unique local files to Cloudinary
  const fileToNewUrlMap = await uploadAllFiles(uniqueLocalFiles, 5);
  console.log(`\nAll uploads completed! ${fileToNewUrlMap.size} files successfully mapped to new Cloudinary URLs.\n`);

  // Build oldUrl -> newUrl map
  const oldUrlToNewUrl = new Map();
  for (const [oldUrl, localFile] of urlToLocalFile.entries()) {
    const newUrl = fileToNewUrlMap.get(localFile);
    if (newUrl) {
      oldUrlToNewUrl.set(oldUrl, newUrl);
    }
  }

  console.log(`Ready to update ${oldUrlToNewUrl.size} unique URLs in MongoDB database.\n`);

  // 4. Update MongoDB Documents
  console.log('Updating MongoDB documents...');
  let updatedDocsCount = 0;

  // Group updates by collection & docId
  const updatesByColAndDoc = new Map(); // colName -> Map(docId -> { fieldPath: newUrl })

  for (const ref of dbImageReferences) {
    const newUrl = oldUrlToNewUrl.get(ref.oldUrl);
    if (!newUrl) continue;

    if (!updatesByColAndDoc.has(ref.collection)) {
      updatesByColAndDoc.set(ref.collection, new Map());
    }
    const docMap = updatesByColAndDoc.get(ref.collection);
    const docIdStr = ref.docId.toString();
    if (!docMap.has(docIdStr)) {
      docMap.set(docIdStr, { docId: ref.docId, setObj: {} });
    }
    docMap.get(docIdStr).setObj[ref.fieldPath] = newUrl;
  }

  for (const [colName, docMap] of updatesByColAndDoc.entries()) {
    const col = db.collection(colName);
    let colUpdated = 0;

    for (const { docId, setObj } of docMap.values()) {
      await col.updateOne({ _id: docId }, { $set: setObj });
      colUpdated++;
      updatedDocsCount++;
    }

    console.log(`Updated ${colUpdated} documents in collection '${colName}'.`);
  }

  console.log(`\nTotal MongoDB documents updated: ${updatedDocsCount}\n`);

  await mongoose.disconnect();

  // 5. Update Codebase Files if any
  console.log('Scanning codebase files to update static Cloudinary URLs...');
  const rootDir = path.resolve(__dirname, '../..');
  let updatedFilesCount = 0;

  function updateCodebaseFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'cloudinary', 'dist', 'build', '.cursor'].includes(entry.name)) continue;
        updateCodebaseFiles(fullPath);
      } else if (entry.isFile() && /\.(js|jsx|ts|tsx|json|html|md)$/.test(entry.name)) {
        try {
          let content = fs.readFileSync(fullPath, 'utf8');
          let modified = false;

          for (const [oldUrl, newUrl] of oldUrlToNewUrl.entries()) {
            if (content.includes(oldUrl)) {
              content = content.replaceAll(oldUrl, newUrl);
              modified = true;
            }
          }

          if (modified) {
            fs.writeFileSync(fullPath, content, 'utf8');
            console.log(`Updated codebase file: ${path.relative(rootDir, fullPath)}`);
            updatedFilesCount++;
          }
        } catch (e) {
          // ignore
        }
      }
    }
  }

  updateCodebaseFiles(rootDir);
  console.log(`Total codebase files updated: ${updatedFilesCount}\n`);

  // 6. Verify Sample URLs
  console.log('Verifying uploaded Cloudinary URLs...');
  const sampleNewUrls = Array.from(new Set(oldUrlToNewUrl.values())).slice(0, 10);
  let verifiedCount = 0;

  for (const url of sampleNewUrls) {
    try {
      const res = await fetch(url);
      if (res.status === 200) {
        verifiedCount++;
      } else {
        console.warn(`Verification warning for ${url}: status ${res.status}`);
      }
    } catch (err) {
      console.warn(`Verification error for ${url}:`, err.message);
    }
  }

  console.log(`Verified ${verifiedCount}/${sampleNewUrls.length} sample URLs successfully returning HTTP 200.\n`);

  console.log('=== MIGRATION COMPLETED SUCCESSFULLY ===');
  console.log(`Summary:`);
  console.log(` - Backup Images Uploaded: ${fileToNewUrlMap.size}`);
  console.log(` - DB Documents Updated:   ${updatedDocsCount}`);
  console.log(` - Codebase Files Updated:  ${updatedFilesCount}`);
}

main().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});

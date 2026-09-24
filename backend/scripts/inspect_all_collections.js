import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cloudinaryDir = path.resolve(__dirname, '../../cloudinary');

// Index disk files
const diskFilesMap = new Map(); // relPath.toLowerCase() -> fullPath
const diskFilesByName = new Map(); // filename.toLowerCase() -> fullPath

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
      if (!diskFilesByName.has(fn)) diskFilesByName.set(fn, fullPath);
      
      const nameWithoutExt = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
      if (!diskFilesByName.has(nameWithoutExt)) diskFilesByName.set(nameWithoutExt, fullPath);
    }
  }
}
indexDiskDir(cloudinaryDir);

function findLocalFile(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\?.*)?$/);
  if (match) {
    const relUrlPath = match[1];
    if (diskFilesMap.has(relUrlPath.toLowerCase())) return diskFilesMap.get(relUrlPath.toLowerCase());
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.svg']) {
      if (diskFilesMap.has((relUrlPath + ext).toLowerCase())) return diskFilesMap.get((relUrlPath + ext).toLowerCase());
    }
    const filename = path.basename(relUrlPath);
    if (diskFilesByName.has(filename.toLowerCase())) return diskFilesByName.get(filename.toLowerCase());
  }
  return null;
}

async function main() {
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.resolve(__dirname, '../.env') });

  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();

  console.log(`Found ${collections.length} collections in DB.\n`);

  for (const colInfo of collections) {
    const colName = colInfo.name;
    const col = db.collection(colName);
    const totalDocs = await col.countDocuments();
    if (totalDocs === 0) continue;

    let imageCount = 0;
    let imageDocsCount = 0;
    let matchedOnDiskCount = 0;

    const cursor = col.find({});
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      let hasImage = false;

      function checkObject(obj) {
        if (!obj) return;
        if (typeof obj === 'string') {
          if (obj.includes('cloudinary.com') || obj.match(/\.(png|jpg|jpeg|webp|svg)$/i)) {
            hasImage = true;
            imageCount++;
            if (findLocalFile(obj)) {
              matchedOnDiskCount++;
            }
          }
        } else if (Array.isArray(obj)) {
          obj.forEach(checkObject);
        } else if (typeof obj === 'object') {
          Object.values(obj).forEach(checkObject);
        }
      }

      checkObject(doc);
      if (hasImage) imageDocsCount++;
    }

    if (imageDocsCount > 0) {
      console.log(`Collection: ${colName.padEnd(30)} Docs: ${String(totalDocs).padEnd(6)} Docs w/ Images: ${String(imageDocsCount).padEnd(6)} Total Images: ${String(imageCount).padEnd(6)} Matched on Disk: ${matchedOnDiskCount}`);
    }
  }

  await mongoose.disconnect();
}

main().catch(console.error);

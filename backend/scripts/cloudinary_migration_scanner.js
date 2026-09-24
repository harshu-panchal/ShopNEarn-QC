import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const CLOUDINARY_DIR = path.resolve(__dirname, '../../cloudinary');

async function scanMongoDB() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('MONGO_URI is missing');
    return [];
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB.');

  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  
  const foundDbReferences = [];

  function searchDoc(doc, collectionName, docId, currentPath = '') {
    if (!doc) return;
    if (typeof doc === 'string') {
      if (doc.includes('cloudinary.com') || doc.includes('res.cloudinary')) {
        foundDbReferences.push({
          type: 'db',
          collection: collectionName,
          docId: docId.toString(),
          path: currentPath,
          url: doc
        });
      }
    } else if (Array.isArray(doc)) {
      doc.forEach((item, index) => {
        searchDoc(item, collectionName, docId, `${currentPath}[${index}]`);
      });
    } else if (typeof doc === 'object') {
      for (const [key, value] of Object.entries(doc)) {
        searchDoc(value, collectionName, docId, currentPath ? `${currentPath}.${key}` : key);
      }
    }
  }

  for (const colInfo of collections) {
    const colName = colInfo.name;
    const col = db.collection(colName);
    const cursor = col.find({});
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      searchDoc(doc, colName, doc._id);
    }
  }

  await mongoose.disconnect();
  console.log(`Scanned DB: found ${foundDbReferences.length} Cloudinary image URLs.`);
  return foundDbReferences;
}

function scanFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file === 'node_modules' || file === '.git' || file === 'cloudinary' || file === 'dist' || file === 'build') continue;
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      scanFiles(filePath, fileList);
    } else if (stat.isFile() && (file.endsWith('.js') || file.endsWith('.jsx') || file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.json') || file.endsWith('.html') || file.endsWith('.md'))) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const matches = content.match(/https?:\/\/res\.cloudinary\.com\/[^\s"'`<>]+/g);
        if (matches) {
          matches.forEach(url => {
            fileList.push({
              type: 'file',
              filePath,
              url
            });
          });
        }
      } catch (err) {
        // ignore read error
      }
    }
  }
  return fileList;
}

function scanLocalCloudinaryBackup(dir) {
  const backupFiles = new Map(); // relative path or filename -> absolute path
  function traverse(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        traverse(fullPath);
      } else if (entry.isFile() && !entry.name.endsWith('.meta.json') && entry.name !== 'index.json') {
        const relPath = path.relative(CLOUDINARY_DIR, fullPath).replace(/\\/g, '/');
        backupFiles.set(relPath.toLowerCase(), fullPath);
        backupFiles.set(entry.name.toLowerCase(), fullPath);
      }
    }
  }
  traverse(dir);
  return backupFiles;
}

async function main() {
  console.log('--- SCANNING PROJECT FOR CLOUDINARY IMAGES ---');
  const dbRefs = await scanMongoDB();
  
  console.log('Scanning codebase files...');
  const rootDir = path.resolve(__dirname, '../..');
  const fileRefs = scanFiles(rootDir);
  console.log(`Scanned files: found ${fileRefs.length} Cloudinary image URLs.`);

  console.log('Scanning local backup directory...');
  const backupFilesMap = scanLocalCloudinaryBackup(CLOUDINARY_DIR);
  console.log(`Found ${backupFilesMap.size / 2} image files in backup folder.`);

  const allUrls = new Set([...dbRefs.map(r => r.url), ...fileRefs.map(r => r.url)]);
  console.log(`Total unique Cloudinary URLs found across project: ${allUrls.size}`);

  const matched = [];
  const missingInBackup = [];

  for (const url of allUrls) {
    // Extract path/filename from Cloudinary URL
    // e.g. https://res.cloudinary.com/cloudname/image/upload/v12345/folder/subfolder/file.jpg
    // or https://res.cloudinary.com/cloudname/image/upload/folder/subfolder/file.jpg
    const match = url.match(/res\.cloudinary\.com\/[^/]+\/image\/upload\/(?:v\d+\/)?(.+)/);
    if (match) {
      let relativeCloudPath = match[1]; // e.g. categories/abc.jpg or categories/abc
      let filename = path.basename(relativeCloudPath);
      
      let localPath = backupFilesMap.get(relativeCloudPath.toLowerCase()) || backupFilesMap.get(filename.toLowerCase());
      
      // If extension missing in relativeCloudPath, try adding extension from filename matches
      if (!localPath) {
        for (const ext of ['.jpg', '.png', '.webp', '.jpeg', '.svg', '.gif']) {
          if (backupFilesMap.get((relativeCloudPath + ext).toLowerCase())) {
            localPath = backupFilesMap.get((relativeCloudPath + ext).toLowerCase());
            break;
          }
          if (backupFilesMap.get((filename + ext).toLowerCase())) {
            localPath = backupFilesMap.get((filename + ext).toLowerCase());
            break;
          }
        }
      }

      if (localPath) {
        matched.push({ url, relativeCloudPath, localPath });
      } else {
        missingInBackup.push({ url, relativeCloudPath });
      }
    } else {
      missingInBackup.push({ url, rawUrl: url });
    }
  }

  console.log('\n--- SCAN MATCH RESULTS ---');
  console.log(`Matched URLs to local backup files: ${matched.length}`);
  console.log(`URLs missing in local backup: ${missingInBackup.length}`);

  const summaryData = {
    totalDbRefs: dbRefs.length,
    totalFileRefs: fileRefs.length,
    totalUniqueUrls: allUrls.size,
    matchedCount: matched.length,
    missingCount: missingInBackup.length,
    dbRefs,
    fileRefs,
    matched,
    missingInBackup
  };

  const outputPath = path.resolve(__dirname, '../cloudinary_scan_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(summaryData, null, 2));
  console.log(`Saved detailed scan results to ${outputPath}`);
}

main().catch(console.error);

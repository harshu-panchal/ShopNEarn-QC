require('dotenv').config();
const mongoose = require('mongoose');

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  
  const LedgerEntry = mongoose.model('LedgerEntry', new mongoose.Schema({}, { strict: false }));
  const entries = await LedgerEntry.find({ ownerId: '6a2ec3b30e129c1ec5584679', bucket: 'shopping' }).sort({ createdAt: 1 });
  
  console.log(JSON.stringify(entries, null, 2));
  process.exit(0);
}

check().catch(console.error);

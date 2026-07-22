import mongoose from 'mongoose';
import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve('./.env') });
import Setting from './app/models/setting.js';

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const setting = await Setting.findOne();
  console.log(JSON.stringify(setting.mlm.binaryPairIncomeTiers, null, 2));
  process.exit(0);
}).catch(console.error);

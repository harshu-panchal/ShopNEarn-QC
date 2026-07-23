import mongoose from 'mongoose';
import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve('./.env') });
import Setting from './app/models/setting.js';
import MlmCommissionEvent from './app/models/mlmCommissionEvent.js';

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const setting = await Setting.findOne();
  console.log("MLM Settings:", JSON.stringify({
    planAPairBonusTiers: setting.mlm.planAPairBonusTiers,
    planAPairBonusFixedAfterPair: setting.mlm.planAPairBonusFixedAfterPair,
    planAPairBonusFixedAmount: setting.mlm.planAPairBonusFixedAmount
  }, null, 2));

  const events = await MlmCommissionEvent.find({
    bonusType: 'BINARY_PAIR_MATCH'
  }).sort({ createdAt: -1 }).limit(15).lean();

  console.log("Recent Pair Match Events:");
  events.forEach(e => {
    console.log(`User: ${e.recipientId}, PairIndex: ${e.meta?.pairIndex}, Amount: ${e.bonusAmount}, Created: ${e.createdAt}`);
  });

  process.exit(0);
}).catch(console.error);

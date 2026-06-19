require('dotenv').config();
const mongoose = require('mongoose');

async function fix() {
  await mongoose.connect(process.env.MONGO_URI);
  
  const MlmConfig = mongoose.model('MlmConfig', new mongoose.Schema({}, { strict: false }));
  await MlmConfig.updateOne({}, { $set: { joiningPackageShoppingWalletCredit: 5000 } });
  
  // Find any user wallet with 250 shopping balance and add 4750 to make it 5000.
  const Wallet = mongoose.model('Wallet', new mongoose.Schema({}, { strict: false }));
  const wallets = await Wallet.find({ shoppingBalance: 250 });
  for (const w of wallets) {
      await Wallet.updateOne({ _id: w._id }, { $inc: { shoppingBalance: 4750 } });
      console.log('Fixed wallet for owner:', w.ownerId);
  }
  
  console.log('Done');
  process.exit(0);
}

fix().catch(console.error);

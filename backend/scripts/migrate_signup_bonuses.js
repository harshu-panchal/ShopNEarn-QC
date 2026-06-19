import mongoose from 'mongoose';

async function migrate() {
  const uri = 'mongodb+srv://samyakresorts_db_user:WruASKXnrLvf8cFc@cluster0.h9itviq.mongodb.net/Quick_commerce?retryWrites=true&w=majority&appName=Cluster0';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const Comm = mongoose.connection.collection('mlmcommissionevents');
  const Wallet = mongoose.connection.collection('wallets');
  const Ledger = mongoose.connection.collection('ledgerentries');

  const events = await Comm.find({
    bonusType: { $in: ['SIGNUP_BONUS_SPONSOR', 'SIGNUP_BONUS_SELF'] },
    walletBucket: 'earnings'
  }).toArray();

  console.log(`Found ${events.length} events to migrate.`);

  // Group by recipientId
  const userMap = {};
  for (const event of events) {
    const rId = String(event.recipientId);
    if (!userMap[rId]) {
      userMap[rId] = { recipientId: event.recipientId, events: [], totalAmount: 0 };
    }
    userMap[rId].events.push(event);
    userMap[rId].totalAmount += event.bonusAmount;
  }

  let totalDeducted = 0;
  let totalUsers = 0;

  for (const [rId, data] of Object.entries(userMap)) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // Find wallet
        const wallet = await Wallet.findOne({ ownerId: data.recipientId }, { session });
        if (!wallet) {
          throw new Error(`Wallet not found for user ${rId}`);
        }

        // We will force migration (allow negative earnings)
        const newEarnings = wallet.earningsBalance - data.totalAmount;
        const newShopping = wallet.shoppingBalance + data.totalAmount;

        const updatedWallet = await Wallet.findOneAndUpdate(
          { _id: wallet._id },
          { 
            $inc: { 
              earningsBalance: -data.totalAmount, 
              shoppingBalance: data.totalAmount 
            },
            $set: { updatedAt: new Date() }
          },
          { session, returnDocument: 'after' }
        );

        // Create Ledger entries
        const now = new Date();
        const baseLedger = {
          actorType: 'CUSTOMER',
          actorId: data.recipientId,
          currency: 'INR',
          status: 'COMPLETED',
          walletId: wallet._id,
          reference: 'MIGRATION',
          createdAt: now,
          updatedAt: now,
          __v: 0
        };

        await Ledger.insertMany([
          {
            ...baseLedger,
            transactionId: `MIGRATE-DEBIT-${Date.now()}-${rId}`,
            type: 'ADJUSTMENT',
            direction: 'DEBIT',
            amount: data.totalAmount,
            description: 'Migration: Correcting signup bonus from Earnings to Shopping',
            balanceBefore: wallet.earningsBalance,
            balanceAfter: newEarnings
          },
          {
            ...baseLedger,
            transactionId: `MIGRATE-CREDIT-${Date.now()}-${rId}`,
            type: 'ADJUSTMENT',
            direction: 'CREDIT',
            amount: data.totalAmount,
            description: 'Migration: Correcting signup bonus from Earnings to Shopping',
            balanceBefore: wallet.shoppingBalance,
            balanceAfter: newShopping
          }
        ], { session });

        // Update events
        const eventIds = data.events.map(e => e._id);
        await Comm.updateMany(
          { _id: { $in: eventIds } },
          { $set: { walletBucket: 'shopping', updatedAt: now } },
          { session }
        );

      });
      console.log(`Successfully migrated user ${rId}: Moved ${data.totalAmount}`);
      totalDeducted += data.totalAmount;
      totalUsers++;
    } catch (err) {
      console.error(`Failed to migrate user ${rId}:`, err);
    } finally {
      await session.endSession();
    }
  }

  console.log(`Migration complete. Moved total ${totalDeducted} for ${totalUsers} users.`);
  process.exit(0);
}

migrate().catch(console.error);

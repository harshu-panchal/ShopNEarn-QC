import "dotenv/config";
import mongoose from "mongoose";
import Customer from "../app/models/customer.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";

const MEMBER_PUBLIC = "SE24347887"; // Meena Sisodia

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  await mongoose.connect(mongoUri);

  const memberUser = await Customer.findOne({ userId: MEMBER_PUBLIC })
    .select("_id name userId")
    .lean();

  const events = await MlmCommissionEvent.find({ sourceUserId: memberUser._id })
    .sort({ bonusType: 1, createdAt: 1 })
    .lean();

  console.log(`=== ALL MlmCommissionEvent rows sourced from ${MEMBER_PUBLIC} (${events.length}) ===\n`);
  for (const ev of events) {
    const recipient = await Customer.findById(ev.recipientId).select("name userId").lean();
    console.log({
      eventId: String(ev._id),
      bonusType: ev.bonusType,
      recipient: recipient ? `${recipient.name} (${recipient.userId})` : String(ev.recipientId),
      status: ev.status,
      bonusAmount: ev.bonusAmount,
      cappedAmount: ev.cappedAmount,
      idempotencyKey: ev.idempotencyKey,
      createdAt: ev.createdAt,
    });
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

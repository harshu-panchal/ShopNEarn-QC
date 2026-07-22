import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const uri = process.env.MONGO_URI;

async function run() {
  try {
    await mongoose.connect(uri);
    console.log("Connected to MongoDB");

    const collections = await mongoose.connection.db.listCollections().toArray();
    
    // We will search across all collections just to be safe
    for (let c of collections) {
      const cName = c.name;
      const result = await mongoose.connection.db.collection(cName).find({ 
        $or: [
          { phone: '9909035007' },
          { phone: 9909035007 },
          { phoneNumber: '9909035007' },
          { phoneNumber: 9909035007 },
          { "contact.phone": '9909035007' },
          { "contactInfo.phone": '9909035007' },
          { mobile: '9909035007' },
          { mobileNumber: '9909035007' }
        ]
      }).toArray();
      if (result.length > 0) {
          console.log(`Found in collection ${cName}:`, JSON.stringify(result, null, 2));
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

run();

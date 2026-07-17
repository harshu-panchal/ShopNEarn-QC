import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Admin from '../app/models/admin.js';
import Seller from '../app/models/seller.js';
import { ensureSuperAdminRole } from '../app/services/admin/adminRbacService.js';

dotenv.config();

const admins = [
    { name: 'Ankit Ahirwar', email: 'ankit@appzeto.com', password: 'Admin!@#123' },
    { name: 'Harshvardhan Panchal', email: 'harshvardhanpanc145@gmail.com', password: 'Admin!@#123' }
];

const sellers = [
    { name: 'Harsh', email: 'harsh@appzeto.com', password: 'Admin!@#123', shopName: 'Appzeto Store' }
];

async function seed() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const superRole = await ensureSuperAdminRole();
        console.log('Ensured super_admin role');

        for (const adminData of admins) {
            // Find existing
            let admin = await Admin.findOne({ email: adminData.email });
            if (admin) {
                admin.password = adminData.password;
                admin.roleId = superRole._id;
                admin.isActive = true;
                if (admin.tokenVersion == null) admin.tokenVersion = 0;
                await admin.save();
                console.log(`Updated Admin: ${adminData.email}`);
            } else {
                await Admin.create({
                    ...adminData,
                    role: 'admin',
                    roleId: superRole._id,
                    isVerified: true,
                    isActive: true,
                    tokenVersion: 0,
                });
                console.log(`Created Admin: ${adminData.email}`);
            }
        }

        for (const sellerData of sellers) {
            let seller = await Seller.findOne({ email: sellerData.email });
            if (seller) {
                seller.password = sellerData.password;
                seller.isVerified = true;
                seller.isActive = true;
                seller.applicationStatus = 'approved';
                await seller.save();
                console.log(`Updated Seller: ${sellerData.email}`);
            } else {
                await Seller.create({ 
                    ...sellerData, 
                    role: 'seller', 
                    isVerified: true, 
                    isActive: true, 
                    applicationStatus: 'approved',
                    phone: '9999999999' 
                });
                console.log(`Created Seller: ${sellerData.email}`);
            }
        }

        console.log('Seeding completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('Error seeding:', error);
        process.exit(1);
    }
}

seed();

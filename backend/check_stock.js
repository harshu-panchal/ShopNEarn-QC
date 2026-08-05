import mongoose from 'mongoose';
import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve('./.env') });

import FranchiseStockLedger from './app/models/franchiseStockLedger.js';
import Product from './app/models/product.js';
import FranchisePartner from './app/models/franchisePartner.js';
import { listHubCatalogProducts } from './app/services/franchise/franchiseCatalogService.js';
import { getFranchiseConfig, resolveHubSellerId } from './app/services/franchise/franchiseConfigService.js';

async function test() {
  await mongoose.connect(process.env.MONGO_URI);
  const cfg = await getFranchiseConfig();
  const hubId = await resolveHubSellerId(cfg);
  console.log('Hub Seller ID:', hubId);

  const totalProductsForHub = await Product.countDocuments({ sellerId: hubId });
  console.log('Total products with hub sellerId:', totalProductsForHub);

  const partners = await FranchisePartner.find().lean();
  console.log('Partners count:', partners.length);
  for (const p of partners) {
    const ledgers = await FranchiseStockLedger.find({ franchisePartnerId: p._id, quantity: { $gt: 0 } }).lean();
    console.log('Partner:', p._id, 'Name:', p.displayName, 'In-stock SKUs count:', ledgers.length);
    for (const l of ledgers) {
      const prod = await Product.findById(l.productId).lean();
      console.log('  - SKU Product ID:', l.productId, 'Qty:', l.quantity, 'Name:', prod?.name, 'SellerId:', prod?.sellerId, 'Status:', prod?.status);
    }
  }

  const catalog = await listHubCatalogProducts({ page: 1, limit: 50 });
  console.log('Hub Catalog Total Items:', catalog.total, 'Returned on page 1:', catalog.items.length);
  console.log('First 5 items on Page 1:');
  catalog.items.slice(0, 5).forEach(i => console.log('  -', i._id, i.name));

  process.exit(0);
}
test().catch(err => {
  console.error(err);
  process.exit(1);
});

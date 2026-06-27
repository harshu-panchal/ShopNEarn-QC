import FranchisePartner from "../../models/franchisePartner.js";
import Seller from "../../models/seller.js";
import { cartIsHubOnly } from "./franchiseCatalogService.js";
import { getHubSellerId } from "./franchiseConfigService.js";

import { FRANCHISE_ORDER_STATUS, FRANCHISE_PARTNER_STATUS } from "../../constants/franchise.js";



function extractDeliveryCoordinates(address = {}) {

  const lat = Number(address?.location?.lat ?? address?.lat);

  const lng = Number(address?.location?.lng ?? address?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { lat, lng };

}



/**

 * Route hub orders to the nearest active franchise partner by delivery

 * coordinates. Falls back to pincode match when coordinates are unavailable.

 */

export async function resolveFranchisePartner({ address, customerId } = {}) {

  void customerId;



  const coords = extractDeliveryCoordinates(address);

  if (coords) {

    const partner = await FranchisePartner.findOne({

      status: FRANCHISE_PARTNER_STATUS.ACTIVE,

      location: {

        $near: {

          $geometry: { type: "Point", coordinates: [coords.lng, coords.lat] },

        },

      },

    }).lean();



    if (partner) return partner;

  }



  const pincode = String(address?.pincode || address?.zip || "").trim();

  if (!pincode) return null;



  return FranchisePartner.findOne({

    status: FRANCHISE_PARTNER_STATUS.ACTIVE,

    territoryPincodes: pincode,

  })

    .sort({ registeredAt: 1 })

    .lean();

}



export function buildFranchiseOrderFields(franchisePartner) {

  if (!franchisePartner?._id) {

    return {

      franchisePartnerId: null,

      franchiseRoutedAt: null,

      franchiseStatus: null,

    };

  }

  return {

    franchisePartnerId: franchisePartner._id,

    franchiseRoutedAt: new Date(),

    franchiseStatus: FRANCHISE_ORDER_STATUS.PENDING,

  };

}

export async function shouldRouteOrderToFranchise(hydratedItems = []) {
  if (!Array.isArray(hydratedItems) || hydratedItems.length === 0) return false;

  const sellerIds = [
    ...new Set(
      hydratedItems
        .map((item) => String(item?.sellerId || "").trim())
        .filter(Boolean),
    ),
  ];
  // Mixed-seller carts stay on the standard seller workflow.
  if (sellerIds.length !== 1) return false;

  if (await cartIsHubOnly(hydratedItems)) return true;

  const soleSellerId = sellerIds[0];
  const configuredHubId = await getHubSellerId();
  if (configuredHubId && String(configuredHubId) === soleSellerId) return true;

  return !!(await Seller.exists({ _id: soleSellerId, isPlatformHub: true }));
}

export async function resolveFranchiseOrderRouting({ hydratedItems, address, customerId } = {}) {
  const shouldRoute = await shouldRouteOrderToFranchise(hydratedItems);
  if (!shouldRoute) {
    return { franchisePartner: null, fields: buildFranchiseOrderFields(null) };
  }
  const franchisePartner = await resolveFranchisePartner({ address, customerId });
  return {
    franchisePartner,
    fields: buildFranchiseOrderFields(franchisePartner),
  };
}


/**
 * Normalize franchise registration / partner address payloads.
 * Pincode is stored for display; order routing uses nearest franchise location.
 */
export function parseFranchiseRegistrationAddress(input = {}) {
  const address = String(input.address || "").trim();
  const locality = String(input.locality || "").trim();
  const pincode = String(input.pincode || "").trim();
  const city = String(input.city || "").trim();
  const state = String(input.state || "").trim();
  const latRaw = input.lat;
  const lngRaw = input.lng;
  const lat =
    latRaw !== undefined && latRaw !== null && latRaw !== ""
      ? Number(latRaw)
      : null;
  const lng =
    lngRaw !== undefined && lngRaw !== null && lngRaw !== ""
      ? Number(lngRaw)
      : null;

  if (!address || !locality || !pincode || !city || !state) {
    const err = new Error(
      "Complete franchise address is required (locality, pincode, city, state, and full address).",
    );
    err.statusCode = 400;
    throw err;
  }

  if (!/^\d{6}$/.test(pincode)) {
    const err = new Error("Enter a valid 6-digit pincode.");
    err.statusCode = 400;
    throw err;
  }

  if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) {
    const err = new Error("Invalid latitude.");
    err.statusCode = 400;
    throw err;
  }
  if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) {
    const err = new Error("Invalid longitude.");
    err.statusCode = 400;
    throw err;
  }

  const snapshot = {
    address,
    locality,
    pincode,
    city,
    state,
    lat,
    lng,
  };

  return {
    snapshot,
    territoryPincodes: [pincode],
  };
}

export function formatFranchiseAddress(parts = {}) {
  return [parts.address, parts.locality, parts.city, parts.state, parts.pincode]
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .join(", ");
}

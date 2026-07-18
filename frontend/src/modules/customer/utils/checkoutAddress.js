/**
 * Pure helpers for checkout delivery-address hydration and validation.
 */

export function createEmptyCheckoutAddress(overrides = {}) {
  return {
    type: "Home",
    name: "",
    address: "",
    landmark: "",
    city: "",
    state: "",
    pincode: "",
    phone: "",
    location: null,
    placeId: null,
    formattedAddress: null,
    ...overrides,
  };
}

export function normalizeProfileAddress(profile, addr, index = 0) {
  if (!addr || typeof addr !== "object") return null;

  const labelRaw = String(addr.label || "Home");
  const label = labelRaw.charAt(0).toUpperCase() + labelRaw.slice(1);
  const addressText =
    addr.fullAddress ||
    addr.formattedAddress ||
    addr.address ||
    [addr.landmark, addr.city, addr.state, addr.pincode].filter(Boolean).join(", ") ||
    "";

  const hasLocation =
    addr?.location &&
    typeof addr.location.lat === "number" &&
    typeof addr.location.lng === "number" &&
    Number.isFinite(addr.location.lat) &&
    Number.isFinite(addr.location.lng);

  return {
    id: addr._id ?? String(index),
    type: label,
    label,
    address: addressText,
    landmark: addr.landmark || "",
    city: addr.city || "",
    state: addr.state || "",
    pincode: addr.pincode || "",
    formattedAddress: addr.formattedAddress || null,
    placeId: typeof addr.placeId === "string" ? addr.placeId : null,
    location: hasLocation
      ? { lat: addr.location.lat, lng: addr.location.lng }
      : null,
    name: profile?.name || "",
    phone: profile?.phone || "",
    isCurrent: index === 0,
  };
}

export function profileAddressToCheckoutAddress(savedAddr, user = {}) {
  if (!savedAddr) return null;
  const cityParts = [savedAddr.city, savedAddr.state, savedAddr.pincode].filter(
    Boolean,
  );
  return createEmptyCheckoutAddress({
    type: savedAddr.label || savedAddr.type || "Home",
    name: savedAddr.name || user?.name || "",
    address: savedAddr.address || "",
    landmark: savedAddr.landmark || "",
    city: cityParts.join(", ") || savedAddr.city || "",
    state: savedAddr.state || "",
    pincode: savedAddr.pincode || "",
    phone: savedAddr.phone || user?.phone || "",
    location: savedAddr.location || null,
    placeId: savedAddr.placeId || null,
    formattedAddress: savedAddr.formattedAddress || null,
  });
}

export function isValidLatLng(loc) {
  return (
    loc &&
    typeof loc.lat === "number" &&
    typeof loc.lng === "number" &&
    Number.isFinite(loc.lat) &&
    Number.isFinite(loc.lng)
  );
}

export function isCheckoutAddressComplete(address) {
  if (!address || typeof address !== "object") return false;
  const name = String(address.name || "").trim();
  const line = String(address.address || "").trim();
  const phone = String(address.phone || "").replace(/\D/g, "");
  const hasIdentity = Boolean(name && line && phone.length >= 10);
  const hasCoords = isValidLatLng(address.location);
  return hasIdentity && hasCoords;
}

export function isRecipientComplete(recipient) {
  if (!recipient || typeof recipient !== "object") return false;
  const name = String(recipient.name || "").trim();
  const line = String(recipient.completeAddress || "").trim();
  const phone = String(recipient.phone || "").replace(/\D/g, "");
  return Boolean(name && line && phone.length === 10 && isValidLatLng(recipient.location));
}

export function buildAddressForOrder({
  currentAddress,
  savedRecipient,
  currentLocation,
} = {}) {
  if (savedRecipient && isRecipientComplete(savedRecipient)) {
    const pincode = String(savedRecipient.pincode || "").trim();
    return {
      type: "Other",
      name: savedRecipient.name,
      address: savedRecipient.completeAddress,
      landmark: savedRecipient.landmark || "",
      city: pincode || savedRecipient.city || "",
      pincode: pincode || undefined,
      phone: savedRecipient.phone,
      location: {
        lat: savedRecipient.location.lat,
        lng: savedRecipient.location.lng,
      },
    };
  }

  if (!currentAddress) return null;

  const addrLoc = currentAddress.location;
  const hasAddrLoc = isValidLatLng(addrLoc);
  const locationFromContext =
    Number.isFinite(currentLocation?.latitude) &&
    Number.isFinite(currentLocation?.longitude)
      ? { lat: currentLocation.latitude, lng: currentLocation.longitude }
      : undefined;

  const cityText = String(currentAddress.city || "").trim();
  const pincodeMatch = cityText.match(/\b(\d{6})\b/);

  return {
    type: currentAddress.type || "Home",
    name: currentAddress.name || "",
    address: currentAddress.address || "",
    landmark: currentAddress.landmark || "",
    city: currentAddress.city || "",
    state: currentAddress.state || "",
    pincode:
      currentAddress.pincode ||
      (pincodeMatch ? pincodeMatch[1] : undefined),
    phone: currentAddress.phone || "",
    placeId: currentAddress.placeId || undefined,
    formattedAddress: currentAddress.formattedAddress || undefined,
    location: hasAddrLoc
      ? { lat: addrLoc.lat, lng: addrLoc.lng }
      : locationFromContext,
  };
}

export function canProceedWithCheckoutAddress({
  currentAddress,
  savedRecipient,
} = {}) {
  if (savedRecipient) return isRecipientComplete(savedRecipient);
  return isCheckoutAddressComplete(currentAddress);
}

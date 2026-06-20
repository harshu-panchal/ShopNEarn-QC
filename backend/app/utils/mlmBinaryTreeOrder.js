/**
 * Registration-time ordering helpers for binary tree placement and
 * conflict resolution. The genealogy chart should reflect who registered
 * first under a sponsor's chosen leg — not who has the largest downline.
 */

/**
 * Side pointer for a chosen leg (L → binaryLeftChildId, R → binaryRightChildId).
 */
export function legSideKey(leg) {
  return leg === "L" ? "binaryLeftChildId" : "binaryRightChildId";
}

/**
 * Same-leg spine spill: first joiner sits on the sponsor's chosen leg;
 * each subsequent joiner on that leg extends the spine (L→L→… or R→R→…).
 */
export async function findSameLegSpineSlot(
  sponsor,
  leg,
  getChild,
  maxHops = 5000,
) {
  if (!sponsor || (leg !== "L" && leg !== "R")) return null;

  const sideKey = legSideKey(leg);

  if (!sponsor[sideKey]) {
    return { parent: sponsor, position: leg, legUnderSponsor: leg };
  }

  let node = sponsor;
  let hops = 0;
  while (node[sideKey] && hops < maxHops) {
    hops += 1;
    const next = await getChild(node[sideKey]);
    if (!next) break;
    node = next;
  }

  return { parent: node, position: leg, legUnderSponsor: leg };
}

/** Sync variant for in-memory rebuild / repair scripts. */
export function findSameLegSpineSlotSync(
  sponsor,
  leg,
  getChild,
  maxHops = 5000,
) {
  if (!sponsor || (leg !== "L" && leg !== "R")) return null;

  const sideKey = legSideKey(leg);

  if (!sponsor[sideKey]) {
    return { parent: sponsor, position: leg, legUnderSponsor: leg };
  }

  let node = sponsor;
  let hops = 0;
  while (node[sideKey] && hops < maxHops) {
    hops += 1;
    const next = getChild(node[sideKey]);
    if (!next) break;
    node = next;
  }

  return { parent: node, position: leg, legUnderSponsor: leg };
}

/**
 * Canonical registration timestamp for a membership row.
 * Prefers the linked Customer.createdAt (account registration), then
 * membership.joinedAt as a fallback for legacy rows.
 */
export function getMemberRegistrationTime(membership) {
  if (!membership) return Infinity;
  const user = membership.userId;
  const customerCreated =
    user && typeof user === "object" && user.createdAt
      ? new Date(user.createdAt).getTime()
      : null;
  if (Number.isFinite(customerCreated)) return customerCreated;
  const joined = membership.joinedAt
    ? new Date(membership.joinedAt).getTime()
    : null;
  return Number.isFinite(joined) ? joined : Infinity;
}

/**
 * When two members claim the same binary slot, keep the earliest
 * registrant visible in the tree. Tie-break with the parent's top-down
 * pointer, then deterministic `_id`.
 */
export function pickBinarySlotWinner(existing, candidate, parentDoc, slotKey) {
  if (!existing) return candidate;
  if (!candidate) return existing;

  const existingReg = getMemberRegistrationTime(existing);
  const candidateReg = getMemberRegistrationTime(candidate);
  if (candidateReg !== existingReg) {
    return candidateReg < existingReg ? candidate : existing;
  }

  const topDownId = parentDoc
    ? String(
        slotKey === "L"
          ? parentDoc.binaryLeftChildId
          : parentDoc.binaryRightChildId,
      )
    : null;
  if (topDownId) {
    const candidateMatches =
      String(candidate.userId?._id || candidate.userId) === topDownId;
    const existingMatches =
      String(existing.userId?._id || existing.userId) === topDownId;
    if (candidateMatches !== existingMatches) {
      return candidateMatches ? candidate : existing;
    }
  }

  return String(candidate._id) < String(existing._id) ? candidate : existing;
}

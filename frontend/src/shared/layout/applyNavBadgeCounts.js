/**
 * Apply path→count badge map onto a DashboardLayout navItems tree.
 * Parent groups get the sum of their children's badgeCounts.
 */
export function applyNavBadgeCounts(navItems, countsByPath = {}) {
  return (navItems || []).map((item) => {
    if (Array.isArray(item.children) && item.children.length > 0) {
      const children = item.children.map((child) => {
        const count = Number(countsByPath[child.path] || 0);
        return count > 0 ? { ...child, badgeCount: count } : { ...child };
      });
      const childSum = children.reduce(
        (sum, child) => sum + Number(child.badgeCount || 0),
        0,
      );
      const own = Number(countsByPath[item.path] || 0);
      const badgeCount = childSum + own;
      const next = { ...item, children };
      if (badgeCount > 0) next.badgeCount = badgeCount;
      else delete next.badgeCount;
      return next;
    }

    const count = Number(countsByPath[item.path] || 0);
    if (count > 0) return { ...item, badgeCount: count };
    const { badgeCount: _drop, ...rest } = item;
    return rest;
  });
}

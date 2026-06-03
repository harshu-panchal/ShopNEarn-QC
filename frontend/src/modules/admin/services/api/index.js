/**
 * Aggregate barrel that reassembles the original `adminApi` shape from the
 * per-domain slices introduced in refactor P4.5.
 *
 * Consumers who only need one slice (e.g. orders) should prefer importing
 * directly:
 *
 *   import { adminOrdersApi } from '../services/api/ordersApi';
 *
 * Consumers who relied on the original `import { adminApi } from
 * '../services/adminApi'` continue to work unchanged — the legacy entry-point
 * at `../adminApi.js` re-exports the aggregate from here.
 */

import { adminAuthApi } from './authApi';
import { adminUsersApi } from './usersApi';
import { adminSettingsApi } from './settingsApi';
import { adminFinanceApi } from './financeApi';
import { adminCatalogApi } from './catalogApi';
import { adminOrdersApi } from './ordersApi';
import { adminSupportApi } from './supportApi';
import { adminDeliveryApi } from './deliveryApi';
import { adminContentApi } from './contentApi';
import { adminMlmApi } from './mlmApi';
import { adminLegalPagesApi } from './legalPagesApi';

export {
    adminAuthApi,
    adminUsersApi,
    adminSettingsApi,
    adminFinanceApi,
    adminCatalogApi,
    adminOrdersApi,
    adminSupportApi,
    adminDeliveryApi,
    adminContentApi,
    adminMlmApi,
    adminLegalPagesApi,
};

/**
 * Aggregate `adminApi` matching the original flat-object shape. Preserves
 * every existing call-site like `adminApi.getOrders(...)`.
 *
 * Collision guard: when two slices declare the same method name, the
 * spread that lands last silently wins. That has bitten us in the past
 * (e.g. `adminMlmApi.getSettings` overriding `adminSettingsApi.getSettings`
 * and sending AdminSettings saves to the MLM endpoint). `mergeApiSlices`
 * throws at module load if it detects a collision so the bug fails loud
 * during development instead of silently in production.
 */
function mergeApiSlices(slicesByName) {
    const merged = {};
    const ownerByMethod = new Map();
    for (const [sliceName, slice] of Object.entries(slicesByName)) {
        for (const [method, fn] of Object.entries(slice || {})) {
            if (ownerByMethod.has(method)) {
                const existingOwner = ownerByMethod.get(method);
                throw new Error(
                    `adminApi method collision: "${method}" is declared by both `
                    + `${existingOwner} and ${sliceName}. Rename one (e.g. `
                    + `\`${method}\` → \`${sliceName.replace(/Api$/, '')}${method.charAt(0).toUpperCase()}${method.slice(1)}\`) `
                    + `or stop spreading the conflicting slice into adminApi.`
                );
            }
            ownerByMethod.set(method, sliceName);
            merged[method] = fn;
        }
    }
    return merged;
}

export const adminApi = mergeApiSlices({
    adminAuthApi,
    adminUsersApi,
    adminSettingsApi,
    adminFinanceApi,
    adminCatalogApi,
    adminOrdersApi,
    adminSupportApi,
    adminDeliveryApi,
    adminContentApi,
    adminMlmApi,
    adminLegalPagesApi,
});

export default adminApi;

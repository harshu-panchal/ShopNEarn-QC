import mongoose from "mongoose";
import {
    ALL_DELIVERY_PRICING_MODES,
    ALL_HANDLING_FEE_STRATEGIES,
} from "../constants/finance.js";
import {
    ALL_MLM_BINARY_PLACEMENT_STRATEGIES,
    ALL_MLM_PAYMENT_MODES,
    ALL_MLM_PLAN_TYPES,
    ALL_MLM_RETURN_CLAWBACK_MODES,
    MLM_DEFAULTS,
} from "../constants/mlm.js";
import {
    ALL_FRANCHISE_PAYMENT_MODES,
    FRANCHISE_DEFAULTS,
    FRANCHISE_PAYMENT_MODE,
} from "../constants/franchise.js";

const settingSchema = new mongoose.Schema(
    {
        // General
        appName: {
            type: String,
            default: "Appzeto Quick Commerce",
        },
        supportEmail: {
            type: String,
            default: "support@appzeto.com",
        },
        supportPhone: {
            type: String,
            default: "",
        },
        currencySymbol: {
            type: String,
            default: "₹",
        },
        currencyCode: {
            type: String,
            default: "INR",
        },
        timezone: {
            type: String,
            default: "Asia/Kolkata",
        },

        // Customer storefront promo marquee (scrolling ticker on Home).
        // Each string is one message; the UI joins them with separators.
        marqueeMessages: {
            type: [String],
            default: ["24/7 Delivery", "Minimum Order ₹99", "Save Big on Essentials!"],
        },

        // Branding
        logoUrl: String,
        faviconUrl: String,
        primaryColor: {
            type: String,
            default: "#0ea5e9",
        },
        secondaryColor: {
            type: String,
            default: "#64748b",
        },

        // Legal
        companyName: String,
        taxId: String,
        address: String,

        // Social
        facebook: String,
        twitter: String,
        instagram: String,
        linkedin: String,
        youtube: String,

        // Apps
        playStoreLink: String,
        appStoreLink: String,

        // SEO
        metaTitle: String,
        metaDescription: String,
        metaKeywords: String,
        keywords: [{ type: String }], // Array for structured SEO keywords

        // Optional: multi-tenant (null = default tenant)
        tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
            index: true,
        },

        // Returns / logistics configuration
        returnDeliveryCommission: {
            // Flat amount per return pickup, paid by seller
            type: Number,
            default: 0,
        },

        /**
         * Finance / delivery pricing rules (single source of truth).
         * Existing keys are kept for backward compatibility.
         */
        deliveryPricingMode: {
            type: String,
            enum: ALL_DELIVERY_PRICING_MODES,
            default: "distance_based",
        },
        pricingMode: {
            type: String,
            enum: ALL_DELIVERY_PRICING_MODES,
            default: "distance_based",
        },
        customerBaseDeliveryFee: {
            type: Number,
            default: 30,
            min: 0,
        },
        riderBasePayout: {
            type: Number,
            default: 30,
            min: 0,
        },
        baseDeliveryCharge: {
            type: Number,
            default: 30,
            min: 0,
        },
        baseDistanceCapacityKm: {
            type: Number,
            default: 0.5,
            min: 0,
        },
        incrementalKmSurcharge: {
            type: Number,
            default: 10,
            min: 0,
        },
        deliveryPartnerRatePerKm: {
            type: Number,
            default: 5,
            min: 0,
        },
        fleetCommissionRatePerKm: {
            type: Number,
            default: 5,
            min: 0,
        },
        fixedDeliveryFee: {
            type: Number,
            default: 30,
            min: 0,
        },
        /**
         * Cart product-subtotal at/above which customer delivery fee is waived.
         * 0 disables the promotion (backward-compatible default).
         */
        freeDeliveryThreshold: {
            type: Number,
            default: 0,
            min: 0,
        },
        handlingFeeStrategy: {
            type: String,
            enum: ALL_HANDLING_FEE_STRATEGIES,
            default: "highest_category_fee",
        },
        codEnabled: {
            type: Boolean,
            default: true,
        },
        onlineEnabled: {
            type: Boolean,
            default: true,
        },
        lowStockAlertsEnabled: {
            type: Boolean,
            default: true,
        },
        productApproval: {
            sellerCreateRequiresApproval: {
                type: Boolean,
                default: false,
            },
            sellerEditRequiresApproval: {
                type: Boolean,
                default: false,
            },
        },

        // MLM Phase 1: full rate sheet + feature toggles for the
        // two-plan customer compensation engine. Every runtime decision
        // in `services/mlm/*` reads from here (via mlmConfigService).
        // The defaults are mirrored from `constants/mlm.js` so a freshly
        // created Setting row immediately works without an admin save.
        mlm: {
            enabled: {
                type: Boolean,
                default: MLM_DEFAULTS.enabled,
            },
            signupBonusEnabled: {
                type: Boolean,
                default: MLM_DEFAULTS.signupBonusEnabled,
            },
            signupBonusSelfAmount: {
                type: Number,
                default: MLM_DEFAULTS.signupBonusSelfAmount,
                min: 0,
            },
            signupBonusSponsorAmount: {
                type: Number,
                default: MLM_DEFAULTS.signupBonusSponsorAmount,
                min: 0,
            },
            // Hard requirement: when true, new customer signup is
            // gated on a valid sponsor referral code. Default true.
            // Admins toggle off only to bootstrap the very first member
            // (or for offline testing on staging).
            signupRequiresReferralCode: {
                type: Boolean,
                default: MLM_DEFAULTS.signupRequiresReferralCode,
            },
            joiningPackagePrice: {
                type: Number,
                default: MLM_DEFAULTS.joiningPackagePrice,
                min: 0,
            },
            joiningPackageShoppingWalletCredit: {
                type: Number,
                default: MLM_DEFAULTS.joiningPackageShoppingWalletCredit,
                min: 0,
            },
            // Joining payment mode toggle. `manual_qr` keeps the
            // PhonePe gateway code path completely dormant so the
            // app stays functional during KYC delays.
            joiningPaymentMode: {
                type: String,
                enum: ALL_MLM_PAYMENT_MODES,
                default: MLM_DEFAULTS.joiningPaymentMode,
            },
            // Manual-QR display config. All fields optional. The QR
            // image URL falls back to a bundled frontend asset on the
            // customer page when empty so the feature stays usable
            // before an admin uploads a real QR.
            manualQr: {
                imageUrl: {
                    type: String,
                    default: MLM_DEFAULTS.manualQr.imageUrl,
                    trim: true,
                },
                upiId: {
                    type: String,
                    default: MLM_DEFAULTS.manualQr.upiId,
                    trim: true,
                },
                merchantName: {
                    type: String,
                    default: MLM_DEFAULTS.manualQr.merchantName,
                    trim: true,
                },
                instructions: {
                    type: String,
                    default: MLM_DEFAULTS.manualQr.instructions,
                    trim: true,
                },
            },
            premiumUpgradeShoppingWalletTopup: {
                type: Number,
                default: MLM_DEFAULTS.premiumUpgradeShoppingWalletTopup,
                min: 0,
            },
            planBAutoUpgradeAtPlanALifetimeEarnings: {
                type: Number,
                default: MLM_DEFAULTS.planBAutoUpgradeAtPlanALifetimeEarnings,
                min: 0,
            },
            binaryPairIncomeTiers: {
                type: [
                    {
                        _id: false,
                        minDirectCount: { type: Number, required: true, min: 1 },
                        pairIncome: { type: Number, required: true, min: 0 },
                        dailyPairCap: { type: Number, required: true, min: 0 },
                    },
                ],
                default: () =>
                    MLM_DEFAULTS.binaryPairIncomeTiers.map((t) => ({ ...t })),
            },
            binaryTopupPairIncome: {
                type: {
                    _id: false,
                    pairIncome: {
                        type: Number,
                        default: MLM_DEFAULTS.binaryTopupPairIncome.pairIncome,
                        min: 0,
                    },
                    dailyPairCap: {
                        type: Number,
                        default: MLM_DEFAULTS.binaryTopupPairIncome.dailyPairCap,
                        min: 0,
                    },
                    eligibilityLifetimeEarnings: {
                        type: Number,
                        default:
                            MLM_DEFAULTS.binaryTopupPairIncome.eligibilityLifetimeEarnings,
                        min: 0,
                    },
                    payAmount: {
                        type: Number,
                        default: MLM_DEFAULTS.binaryTopupPairIncome.payAmount,
                        min: 0,
                    },
                    shoppingWalletCredit: {
                        type: Number,
                        default:
                            MLM_DEFAULTS.binaryTopupPairIncome.shoppingWalletCredit,
                        min: 0,
                    },
                },
                default: () => ({ ...MLM_DEFAULTS.binaryTopupPairIncome }),
            },
            directReferralMilestones: {
                type: [
                    {
                        _id: false,
                        atDirectCount: { type: Number, required: true, min: 1 },
                        bonusAmount: { type: Number, required: true, min: 0 },
                        planRequired: {
                            type: String,
                            enum: ALL_MLM_PLAN_TYPES,
                            default: "A",
                        },
                    },
                ],
                default: () => MLM_DEFAULTS.directReferralMilestones.map((m) => ({ ...m })),
            },
            // Plan A binary pair-match bonus tiers — admin-editable
            // table mapping `pairIndex -> bonusAmount`. Pair index is
            // 1-based and represents the sponsor's nth completed pair
            // (`min(leftLegDirectCount, rightLegDirectCount)`). Pairs
            // not listed here fall back to `planAPairBonusFixedAmount`
            // when their index exceeds `planAPairBonusFixedAfterPair`.
            planAPairBonusTiers: {
                type: [
                    {
                        _id: false,
                        pairIndex: { type: Number, required: true, min: 1 },
                        bonusAmount: { type: Number, required: true, min: 0 },
                    },
                ],
                default: () => MLM_DEFAULTS.planAPairBonusTiers.map((t) => ({ ...t })),
            },
            planAPairBonusFixedAfterPair: {
                type: Number,
                default: MLM_DEFAULTS.planAPairBonusFixedAfterPair,
                min: 0,
            },
            planAPairBonusFixedAmount: {
                type: Number,
                default: MLM_DEFAULTS.planAPairBonusFixedAmount,
                min: 0,
            },
            planAPairBonusReleaseCooldownDays: {
                type: Number,
                default: MLM_DEFAULTS.planAPairBonusReleaseCooldownDays,
                min: 0,
                max: 365,
            },
            repurchaseBonusLevels: {
                type: [
                    {
                        _id: false,
                        level: { type: Number, required: true, min: 1, max: 12 },
                        ratePercent: { type: Number, required: true, min: 0, max: 100 },
                    },
                ],
                default: () => MLM_DEFAULTS.repurchaseBonusLevels.map((l) => ({ ...l })),
            },
            mentorRoyaltyLevels: {
                type: [
                    {
                        _id: false,
                        level: { type: Number, required: true, min: 1, max: 6 },
                        ratePercent: { type: Number, required: true, min: 0, max: 100 },
                    },
                ],
                default: () => MLM_DEFAULTS.mentorRoyaltyLevels.map((l) => ({ ...l })),
            },
            homeShoppingProductId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Product",
                default: null,
            },
            homeShoppingPrice: {
                type: Number,
                default: MLM_DEFAULTS.homeShoppingPrice,
                min: 0,
            },
            homeShoppingProductCreditValue: {
                type: Number,
                default: MLM_DEFAULTS.homeShoppingProductCreditValue,
                min: 0,
            },
            homeShoppingCommissions: {
                salesPercent: { type: Number, default: MLM_DEFAULTS.homeShoppingCommissions.salesPercent, min: 0, max: 100 },
                referralPercent: { type: Number, default: MLM_DEFAULTS.homeShoppingCommissions.referralPercent, min: 0, max: 100 },
                royaltyPercent: { type: Number, default: MLM_DEFAULTS.homeShoppingCommissions.royaltyPercent, min: 0, max: 100 },
            },
            withdrawalMinAmount: {
                type: Number,
                default: MLM_DEFAULTS.withdrawalMinAmount,
                min: 0,
            },
            withdrawalAdminChargePercent: {
                type: Number,
                default: MLM_DEFAULTS.withdrawalAdminChargePercent,
                min: 0,
                max: 100,
            },
            withdrawalGstOnAdminChargePercent: {
                type: Number,
                default: MLM_DEFAULTS.withdrawalGstOnAdminChargePercent,
                min: 0,
                max: 100,
            },
            dailyEarningCap: {
                type: Number,
                default: MLM_DEFAULTS.dailyEarningCap,
                min: 0,
            },
            binaryPlacementStrategy: {
                type: String,
                enum: ALL_MLM_BINARY_PLACEMENT_STRATEGIES,
                default: MLM_DEFAULTS.binaryPlacementStrategy,
            },
            bonusesOnReturn: {
                type: String,
                enum: ALL_MLM_RETURN_CLAWBACK_MODES,
                default: MLM_DEFAULTS.bonusesOnReturn,
            },
            sponsorChainMaxDepth: {
                type: Number,
                default: MLM_DEFAULTS.sponsorChainMaxDepth,
                min: 1,
                max: 50,
            },
            referralCodeLength: {
                type: Number,
                default: MLM_DEFAULTS.referralCodeLength,
                min: 4,
                max: 16,
            },
        },
        // Home Shoppy franchise program (separate from MLM Home Shopping)
        homeShoppy: {
            enabled: { type: Boolean, default: FRANCHISE_DEFAULTS.enabled },
            registrationPrice: {
                type: Number,
                default: FRANCHISE_DEFAULTS.registrationPrice,
                min: 0,
            },
            walletCreditMultiplier: {
                type: Number,
                default: FRANCHISE_DEFAULTS.walletCreditMultiplier,
                min: 1,
            },
            registrationPaymentMode: {
                type: String,
                enum: ALL_FRANCHISE_PAYMENT_MODES,
                default: FRANCHISE_DEFAULTS.registrationPaymentMode,
            },
            hubSellerId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Seller",
                default: null,
            },
            hubShopDisplayName: {
                type: String,
                default: FRANCHISE_DEFAULTS.hubShopDisplayName,
            },
        },
    },
    {
        timestamps: true,
    }
);

settingSchema.pre("save", function syncFinanceAliases(next) {
    if (!this.pricingMode && this.deliveryPricingMode) {
        this.pricingMode = this.deliveryPricingMode;
    }
    if (!this.deliveryPricingMode && this.pricingMode) {
        this.deliveryPricingMode = this.pricingMode;
    }

    if (this.baseDeliveryCharge == null) {
        this.baseDeliveryCharge = this.customerBaseDeliveryFee ?? 30;
    }
    if (this.customerBaseDeliveryFee == null) {
        this.customerBaseDeliveryFee = this.baseDeliveryCharge ?? 30;
    }

    if (this.riderBasePayout == null) {
        this.riderBasePayout = this.baseDeliveryCharge ?? this.customerBaseDeliveryFee ?? 30;
    }

    if (this.fleetCommissionRatePerKm == null && this.deliveryPartnerRatePerKm != null) {
        this.fleetCommissionRatePerKm = this.deliveryPartnerRatePerKm;
    }
    if (this.deliveryPartnerRatePerKm == null && this.fleetCommissionRatePerKm != null) {
        this.deliveryPartnerRatePerKm = this.fleetCommissionRatePerKm;
    }

    if (this.fixedDeliveryFee == null) {
        this.fixedDeliveryFee = this.baseDeliveryCharge ?? this.customerBaseDeliveryFee ?? 30;
    }

    next();
});

export default mongoose.model("Setting", settingSchema);

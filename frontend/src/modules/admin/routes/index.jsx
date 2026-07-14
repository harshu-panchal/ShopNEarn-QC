import React, { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import DashboardLayout from "@shared/layout/DashboardLayout";
import { applyNavBadgeCounts } from "@shared/layout/applyNavBadgeCounts";
import { useSupportUnread } from "@core/context/SupportUnreadContext";
import { useNavBadges } from "@core/context/NavBadgeContext";
import { setActiveRole, ROLES } from "@core/auth/activeRoleStore";
import {
  LayoutDashboard,
  Tag,
  Box,
  Building2,
  Truck,
  Wallet,
  Banknote,
  Receipt,
  CircleDollarSign,
  Users,
  HelpCircle,
  ClipboardList,
  RotateCcw,
  Settings,
  Terminal,
  Sparkles,
  User,
  Network,
  FileText,
  Store,
} from "lucide-react";

const Dashboard = React.lazy(() => import("../pages/Dashboard"));
const CategoryManagement = React.lazy(
  () => import("../pages/CategoryManagement"),
);
const HeaderCategories = React.lazy(
  () => import("../pages/categories/HeaderCategories"),
);
const Level2Categories = React.lazy(
  () => import("../pages/categories/Level2Categories"),
);
const SubCategories = React.lazy(
  () => import("../pages/categories/SubCategories"),
);
const CategoryHierarchy = React.lazy(
  () => import("../pages/categories/CategoryHierarchy"),
);
const ProductManagement = React.lazy(
  () => import("../pages/ProductManagement"),
);
const ActiveSellers = React.lazy(() => import("../pages/ActiveSellers"));
const PendingSellers = React.lazy(() => import("../pages/PendingSellers"));
const SellerLocations = React.lazy(() => import("../pages/SellerLocations"));
const ActiveDeliveryBoys = React.lazy(
  () => import("../pages/ActiveDeliveryBoys"),
);
const PendingDeliveryBoys = React.lazy(
  () => import("../pages/PendingDeliveryBoys"),
);
const DeliveryFunds = React.lazy(() => import("../pages/DeliveryFunds"));
const AdminWallet = React.lazy(() => import("../pages/AdminWallet"));
const WithdrawalRequests = React.lazy(
  () => import("../pages/WithdrawalRequests"),
);
const SellerTransactions = React.lazy(
  () => import("../pages/SellerTransactions"),
);
const CashCollection = React.lazy(() => import("../pages/CashCollection"));
const CustomerManagement = React.lazy(
  () => import("../pages/CustomerManagement"),
);
const CustomerDetail = React.lazy(() => import("../pages/CustomerDetail"));
const UserManagement = React.lazy(() => import("../pages/UserManagement"));
const Profile = React.lazy(() => import("@/pages/Profile"));
const FAQManagement = React.lazy(() => import("../pages/FAQManagement"));
const LegalPagesManagement = React.lazy(() =>
  import("../pages/LegalPagesManagement"),
);
const OrdersList = React.lazy(() => import("../pages/OrdersList"));
const OrderDetail = React.lazy(() => import("../pages/OrderDetail"));
const Returns = React.lazy(() => import("../pages/Returns"));
const SellerDetail = React.lazy(() => import("../pages/SellerDetail"));
const SupportTickets = React.lazy(() => import("../pages/SupportTickets"));
const ReviewModeration = React.lazy(() => import("../pages/ReviewModeration"));
const FleetTracking = React.lazy(() => import("../pages/FleetTracking"));
const CouponManagement = React.lazy(() => import("../pages/CouponManagement"));
const HeroCategoriesPerPage = React.lazy(() => import("../pages/HeroCategoriesPerPage"));
const NotificationComposer = React.lazy(
  () => import("../pages/NotificationComposer"),
);
const OffersManagement = React.lazy(
  () => import("../pages/OffersManagement"),
);
const OfferSectionsManagement = React.lazy(
  () => import("../pages/OfferSectionsManagement"),
);
const ShopByStoreManagement = React.lazy(
  () => import("../pages/ShopByStoreManagement"),
);
const AdminSettings = React.lazy(() => import("../pages/AdminSettings"));
const EnvSettings = React.lazy(() => import("../pages/EnvSettings"));
const AdminProfile = React.lazy(() => import("../pages/AdminProfile"));
// MLM Phase 1 admin pages
const MlmDashboard = React.lazy(() => import("../pages/mlm/MlmDashboard"));
const MlmMembers = React.lazy(() => import("../pages/mlm/MlmMembers"));
const MlmMemberDetail = React.lazy(() => import("../pages/mlm/MlmMemberDetail"));
const MlmWithdrawals = React.lazy(() => import("../pages/mlm/MlmWithdrawals"));
const MlmJoiningReviews = React.lazy(() =>
  import("../pages/mlm/MlmJoiningReviews"),
);
const MlmUpgradeReviews = React.lazy(() =>
  import("../pages/mlm/MlmUpgradeReviews"),
);
const MlmSettings = React.lazy(() => import("../pages/mlm/MlmSettings"));
const MlmMilestoneRules = React.lazy(() => import("../pages/mlm/MlmMilestoneRules"));
const MlmPayoutReports = React.lazy(() => import("../pages/mlm/MlmPayoutReports"));
const MlmPayoutReportDetail = React.lazy(() => import("../pages/mlm/MlmPayoutReportDetail"));
const FranchiseAdminDashboard = React.lazy(() => import("../pages/franchise/FranchiseAdminDashboard"));
const FranchiseRegistrations = React.lazy(() => import("../pages/franchise/FranchiseRegistrations"));
const FranchiseTopUps = React.lazy(() => import("../pages/franchise/FranchiseTopUps"));
const FranchisePartners = React.lazy(() => import("../pages/franchise/FranchisePartners"));
const FranchisePartnerDetail = React.lazy(() => import("../pages/franchise/FranchisePartnerDetail"));
const FranchiseSettings = React.lazy(() => import("../pages/franchise/FranchiseSettings"));
const FranchiseDispatch = React.lazy(() => import("../pages/franchise/FranchiseDispatch"));
const InventoryReportsHub = React.lazy(() => import("../pages/inventory/InventoryReportsHub"));

const navItems = [
  {
    label: "Dashboard",
    path: "/admin",
    icon: LayoutDashboard,
    color: "indigo",
    end: true,
  },
  {
    label: "Categories",
    icon: Tag,
    color: "rose",
    children: [
      { label: "All Categories", path: "/admin/categories/hierarchy" },
      { label: "Header Categories", path: "/admin/categories/header" },
      { label: "Main Categories", path: "/admin/categories/level2" },
      { label: "Sub-Categories", path: "/admin/categories/sub" },
    ],
  },
  { label: "Products", path: "/admin/products", icon: Box, color: "amber" },
  {
    label: "Marketing Tools",
    icon: Sparkles,
    color: "amber",
    children: [
      { label: "Hero & categories per page", path: "/admin/hero-categories" },
      { label: "Send Notifications", path: "/admin/notifications" },
      { label: "Coupons & Promos", path: "/admin/coupons" },
      { label: "Offer Sections", path: "/admin/offer-sections" },
      { label: "Shop by Store", path: "/admin/shop-by-store" },
    ],
  },
  {
    label: "Customer Support",
    icon: Receipt,
    color: "emerald",
    children: [
      { label: "Help Tickets", path: "/admin/support-tickets" },
      { label: "Review Content", path: "/admin/moderation" },
    ],
  },
  {
    label: "Sellers",
    icon: Building2,
    color: "blue",
    children: [
      { label: "Active Sellers", path: "/admin/sellers/active" },
      { label: "Waiting for Review", path: "/admin/sellers/pending" },
      { label: "Seller Locations", path: "/admin/seller-locations" },
    ],
  },
  {
    label: "Delivery Drivers",
    icon: Truck,
    color: "emerald",
    children: [
      { label: "Active Drivers", path: "/admin/delivery-boys/active" },
      { label: "Waiting for Review", path: "/admin/delivery-boys/pending" },
      { label: "Track Drivers", path: "/admin/tracking" },
      { label: "Send Money", path: "/admin/delivery-funds" },
    ],
  },
  { label: "Wallet", path: "/admin/wallet", icon: Wallet, color: "violet" },
  {
    label: "Money Requests",
    path: "/admin/withdrawals",
    icon: Banknote,
    color: "cyan",
  },
  {
    label: "Seller Payments",
    path: "/admin/seller-transactions",
    icon: Receipt,
    color: "orange",
  },
  {
    label: "Collect Cash",
    path: "/admin/cash-collection",
    icon: CircleDollarSign,
    color: "green",
  },
  { label: "Customers", path: "/admin/customers", icon: Users, color: "sky" },
  {
    label: "Inventory Reports",
    path: "/admin/inventory-reports",
    icon: ClipboardList,
    color: "indigo",
  },
  {
    label: "MLM Program",
    icon: Network,
    color: "violet",
    children: [
      { label: "Dashboard", path: "/admin/mlm" },
      { label: "Members", path: "/admin/mlm/members" },
      { label: "Joining Reviews", path: "/admin/mlm/joining-reviews" },
      { label: "Upgrade Reviews", path: "/admin/mlm/upgrade-reviews" },
      { label: "Withdrawals", path: "/admin/mlm/withdrawals" },
      { label: "Payout Reports", path: "/admin/mlm/payout-reports" },
      { label: "Milestones", path: "/admin/mlm/milestones" },
      { label: "Settings", path: "/admin/mlm/settings" },
    ],
  },
  {
    label: "Home Shoppy",
    icon: Store,
    color: "indigo",
    children: [
      { label: "Dashboard", path: "/admin/franchise" },
      { label: "Registrations", path: "/admin/franchise/registrations" },
      { label: "Top-ups", path: "/admin/franchise/topups" },
      { label: "Partners", path: "/admin/franchise/partners" },
      { label: "Dispatch", path: "/admin/franchise/dispatch" },
      { label: "Settings", path: "/admin/franchise/settings" },
    ],
  },
  { label: "FAQs", path: "/admin/faqs", icon: HelpCircle, color: "pink" },
  {
    label: "Legal Pages",
    path: "/admin/legal-pages",
    icon: FileText,
    color: "slate",
  },
  {
    label: "Orders",
    icon: ClipboardList,
    color: "fuchsia",
    children: [
      { label: "All Orders", path: "/admin/orders/all" },
      { label: "New Orders", path: "/admin/orders/pending" },
      { label: "Being Prepared", path: "/admin/orders/processed" },
      { label: "On the Way", path: "/admin/orders/out-for-delivery" },
      { label: "Delivered", path: "/admin/orders/delivered" },
      { label: "Cancelled", path: "/admin/orders/cancelled" },
      { label: "Returned", path: "/admin/orders/returned" },
      { label: "Return Requests", path: "/admin/returns" },
    ],
  },
  {
    label: "Fees & Charges",
    path: "/admin/billing",
    icon: RotateCcw,
    color: "red",
  },
  {
    label: "Settings",
    path: "/admin/settings",
    icon: Settings,
    color: "slate",
  },
  { label: "My Profile", path: "/admin/profile", icon: User, color: "indigo" },
  { label: "System Settings", path: "/admin/env", icon: Terminal, color: "dark" },
];

const BillingCharges = React.lazy(() => import("../pages/BillingCharges"));

const AdminRoutes = () => {
  useEffect(() => {
    setActiveRole(ROLES.ADMIN);
  }, []);

  const { totalUnread } = useSupportUnread();
  const { countsByPath } = useNavBadges();

  const navItemsWithBadges = React.useMemo(() => {
    const withQueueBadges = applyNavBadgeCounts(navItems, countsByPath);
    const supportUnread = Number.isFinite(totalUnread) ? totalUnread : 0;
    if (supportUnread <= 0) return withQueueBadges;

    return withQueueBadges.map((item) => {
      if (item?.label !== "Customer Support") return item;
      const children = (item.children || []).map((child) => {
        if (String(child?.path || "") !== "/admin/support-tickets") return child;
        return {
          ...child,
          badgeCount: Number(child.badgeCount || 0) + supportUnread,
        };
      });
      return {
        ...item,
        children,
        badgeCount: Number(item.badgeCount || 0) + supportUnread,
      };
    });
  }, [totalUnread, countsByPath]);

  return (
    <DashboardLayout navItems={navItemsWithBadges} title="Admin Center">
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/users" element={<UserManagement />} />
        <Route path="/profile" element={<AdminProfile />} />
        {/* Lazy routes for new sections */}
        <Route
          path="/categories"
          element={<Navigate to="/admin/categories/header" replace />}
        />
        <Route path="/categories/header" element={<HeaderCategories />} />
        <Route path="/categories/level2" element={<Level2Categories />} />
        <Route path="/categories/sub" element={<SubCategories />} />
        <Route path="/categories/hierarchy" element={<CategoryHierarchy />} />
        <Route path="/products" element={<ProductManagement />} />
        <Route path="/sellers/active" element={<ActiveSellers />} />
        <Route path="/sellers/active/:id" element={<SellerDetail />} />
        <Route path="/support-tickets" element={<SupportTickets />} />
        <Route path="/moderation" element={<ReviewModeration />} />
        <Route path="/hero-categories" element={<HeroCategoriesPerPage />} />
        <Route path="/notifications" element={<NotificationComposer />} />
        <Route path="/offers" element={<OffersManagement />} />
        <Route path="/offer-sections" element={<OfferSectionsManagement />} />
        <Route path="/shop-by-store" element={<ShopByStoreManagement />} />
        <Route path="/coupons" element={<CouponManagement />} />
        <Route path="/sellers/pending" element={<PendingSellers />} />
        <Route path="/seller-locations" element={<SellerLocations />} />
        <Route path="/delivery-boys/active" element={<ActiveDeliveryBoys />} />
        <Route
          path="/delivery-boys/pending"
          element={<PendingDeliveryBoys />}
        />
        <Route path="/tracking" element={<FleetTracking />} />
        <Route path="/delivery-funds" element={<DeliveryFunds />} />
        <Route path="/wallet" element={<AdminWallet />} />
        <Route path="/withdrawals" element={<WithdrawalRequests />} />
        <Route path="/seller-transactions" element={<SellerTransactions />} />
        <Route path="/cash-collection" element={<CashCollection />} />
        <Route path="/customers" element={<CustomerManagement />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/inventory-reports" element={<InventoryReportsHub />} />
        <Route path="/faqs" element={<FAQManagement />} />
        <Route path="/legal-pages" element={<LegalPagesManagement />} />
        <Route path="/orders/:status" element={<OrdersList />} />
        <Route path="/orders/view/:orderId" element={<OrderDetail />} />
        <Route path="/returns" element={<Returns />} />
        <Route path="/billing" element={<BillingCharges />} />
        <Route path="/settings" element={<AdminSettings />} />
        <Route path="/env" element={<EnvSettings />} />
        {/* MLM Phase 1 admin pages */}
        <Route path="/mlm" element={<MlmDashboard />} />
        <Route path="/mlm/members" element={<MlmMembers />} />
        <Route path="/mlm/members/:id" element={<MlmMemberDetail />} />
        <Route path="/mlm/withdrawals" element={<MlmWithdrawals />} />
        <Route path="/mlm/payout-reports" element={<MlmPayoutReports />} />
        <Route path="/mlm/payout-reports/:date" element={<MlmPayoutReportDetail />} />
        <Route
          path="/mlm/joining-reviews"
          element={<MlmJoiningReviews />}
        />
        <Route
          path="/mlm/upgrade-reviews"
          element={<MlmUpgradeReviews />}
        />
        <Route path="/mlm/milestones" element={<MlmMilestoneRules />} />
        <Route path="/mlm/settings" element={<MlmSettings />} />
        <Route path="/franchise" element={<FranchiseAdminDashboard />} />
        <Route path="/franchise/registrations" element={<FranchiseRegistrations />} />
        <Route path="/franchise/topups" element={<FranchiseTopUps />} />
        <Route path="/franchise/partners" element={<FranchisePartners />} />
        <Route path="/franchise/partners/:id" element={<FranchisePartnerDetail />} />
        <Route path="/franchise/dispatch" element={<FranchiseDispatch />} />
        <Route path="/franchise/settings" element={<FranchiseSettings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </DashboardLayout>
  );
};

export default AdminRoutes;

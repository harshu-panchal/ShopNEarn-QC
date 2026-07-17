import React, { useEffect, useMemo } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import DashboardLayout from "@shared/layout/DashboardLayout";
import { applyNavBadgeCounts } from "@shared/layout/applyNavBadgeCounts";
import { useSupportUnread } from "@core/context/SupportUnreadContext";
import { useNavBadges } from "@core/context/NavBadgeContext";
import { useAuth } from "@core/context/AuthContext";
import { setActiveRole, ROLES } from "@core/auth/activeRoleStore";
import RequireAdminPermission from "../rbac/RequireAdminPermission";
import {
  filterNavItemsByPermissions,
  firstPermittedAdminPath,
  hasPermission,
} from "../rbac/permissions";
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
  Shield,
} from "lucide-react";

const Dashboard = React.lazy(() => import("../pages/Dashboard"));
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
const RoleManagement = React.lazy(() => import("../pages/access/RoleManagement"));
const AdminUserManagement = React.lazy(() => import("../pages/access/AdminUserManagement"));
const BillingCharges = React.lazy(() => import("../pages/BillingCharges"));

const withPermission = (permission, element) => (
  <RequireAdminPermission permission={permission}>{element}</RequireAdminPermission>
);

const navItems = [
  {
    label: "Dashboard",
    path: "/admin",
    icon: LayoutDashboard,
    color: "indigo",
    end: true,
    permission: "dashboard:view",
  },
  {
    label: "Categories",
    icon: Tag,
    color: "rose",
    permission: "categories:view",
    children: [
      { label: "All Categories", path: "/admin/categories/hierarchy", permission: "categories:view" },
      { label: "Header Categories", path: "/admin/categories/header", permission: "categories:view" },
      { label: "Main Categories", path: "/admin/categories/level2", permission: "categories:view" },
      { label: "Sub-Categories", path: "/admin/categories/sub", permission: "categories:view" },
    ],
  },
  { label: "Products", path: "/admin/products", icon: Box, color: "amber", permission: "products:view" },
  {
    label: "Marketing Tools",
    icon: Sparkles,
    color: "amber",
    permission: "marketing:view",
    children: [
      { label: "Hero & categories per page", path: "/admin/hero-categories", permission: "marketing:view" },
      { label: "Send Notifications", path: "/admin/notifications", permission: "marketing:send" },
      { label: "Coupons & Promos", path: "/admin/coupons", permission: "marketing:view" },
      { label: "Offer Sections", path: "/admin/offer-sections", permission: "marketing:view" },
      { label: "Shop by Store", path: "/admin/shop-by-store", permission: "marketing:view" },
    ],
  },
  {
    label: "Customer Support",
    icon: Receipt,
    color: "emerald",
    permission: "support:view",
    children: [
      { label: "Help Tickets", path: "/admin/support-tickets", permission: "support:view" },
      { label: "Review Content", path: "/admin/moderation", permission: "support:moderate" },
    ],
  },
  {
    label: "Sellers",
    icon: Building2,
    color: "blue",
    permission: "sellers:view",
    children: [
      { label: "Active Sellers", path: "/admin/sellers/active", permission: "sellers:view" },
      { label: "Waiting for Review", path: "/admin/sellers/pending", permission: "sellers:view" },
      { label: "Seller Locations", path: "/admin/seller-locations", permission: "sellers:view" },
    ],
  },
  {
    label: "Delivery Drivers",
    icon: Truck,
    color: "emerald",
    permission: "delivery:view",
    children: [
      { label: "Active Drivers", path: "/admin/delivery-boys/active", permission: "delivery:view" },
      { label: "Waiting for Review", path: "/admin/delivery-boys/pending", permission: "delivery:view" },
      { label: "Track Drivers", path: "/admin/tracking", permission: "delivery:track" },
      { label: "Send Money", path: "/admin/delivery-funds", permission: "delivery:settle" },
    ],
  },
  { label: "Wallet", path: "/admin/wallet", icon: Wallet, color: "violet", permission: "finance:view" },
  {
    label: "Money Requests",
    path: "/admin/withdrawals",
    icon: Banknote,
    color: "cyan",
    permission: "finance:view",
  },
  {
    label: "Seller Payments",
    path: "/admin/seller-transactions",
    icon: Receipt,
    color: "orange",
    permission: "finance:view",
  },
  {
    label: "Collect Cash",
    path: "/admin/cash-collection",
    icon: CircleDollarSign,
    color: "green",
    permission: "cash:view",
  },
  { label: "Customers", path: "/admin/customers", icon: Users, color: "sky", permission: "customers:view" },
  {
    label: "Inventory Reports",
    path: "/admin/inventory-reports",
    icon: ClipboardList,
    color: "indigo",
    permission: "inventory:view",
  },
  {
    label: "MLM Program",
    icon: Network,
    color: "violet",
    permission: "mlm:view",
    children: [
      { label: "Dashboard", path: "/admin/mlm", permission: "mlm:view" },
      { label: "Members", path: "/admin/mlm/members", permission: "mlm:view" },
      { label: "Joining Reviews", path: "/admin/mlm/joining-reviews", permission: "mlm:view" },
      { label: "Upgrade Reviews", path: "/admin/mlm/upgrade-reviews", permission: "mlm:view" },
      { label: "Withdrawals", path: "/admin/mlm/withdrawals", permission: "mlm:view" },
      { label: "Payout Reports", path: "/admin/mlm/payout-reports", permission: "mlm:payout" },
      { label: "Milestones", path: "/admin/mlm/milestones", permission: "mlm:settings" },
      { label: "Settings", path: "/admin/mlm/settings", permission: "mlm:settings" },
    ],
  },
  {
    label: "Home Shoppy",
    icon: Store,
    color: "indigo",
    permission: "franchise:view",
    children: [
      { label: "Dashboard", path: "/admin/franchise", permission: "franchise:view" },
      { label: "Registrations", path: "/admin/franchise/registrations", permission: "franchise:view" },
      { label: "Top-ups", path: "/admin/franchise/topups", permission: "franchise:view" },
      { label: "Partners", path: "/admin/franchise/partners", permission: "franchise:view" },
      { label: "Dispatch", path: "/admin/franchise/dispatch", permission: "franchise:dispatch" },
      { label: "Settings", path: "/admin/franchise/settings", permission: "franchise:settings" },
    ],
  },
  { label: "FAQs", path: "/admin/faqs", icon: HelpCircle, color: "pink", permission: "content:view" },
  {
    label: "Legal Pages",
    path: "/admin/legal-pages",
    icon: FileText,
    color: "slate",
    permission: "content:view",
  },
  {
    label: "Orders",
    icon: ClipboardList,
    color: "fuchsia",
    permission: "orders:view",
    children: [
      { label: "All Orders", path: "/admin/orders/all", permission: "orders:view" },
      { label: "New Orders", path: "/admin/orders/pending", permission: "orders:view" },
      { label: "Being Prepared", path: "/admin/orders/processed", permission: "orders:view" },
      { label: "On the Way", path: "/admin/orders/out-for-delivery", permission: "orders:view" },
      { label: "Delivered", path: "/admin/orders/delivered", permission: "orders:view" },
      { label: "Cancelled", path: "/admin/orders/cancelled", permission: "orders:view" },
      { label: "Returned", path: "/admin/orders/returned", permission: "orders:view" },
      { label: "Return Requests", path: "/admin/returns", permission: "orders:returns" },
    ],
  },
  {
    label: "Fees & Charges",
    path: "/admin/billing",
    icon: RotateCcw,
    color: "red",
    permission: "settings:view",
  },
  {
    label: "Settings",
    path: "/admin/settings",
    icon: Settings,
    color: "slate",
    permission: "settings:view",
  },
  {
    label: "Admin Access",
    icon: Shield,
    color: "violet",
    permission: "rbac:view",
    children: [
      { label: "Roles", path: "/admin/access/roles", permission: "rbac:view" },
      { label: "Admin Users", path: "/admin/access/admins", permission: "rbac:view" },
    ],
  },
  { label: "My Profile", path: "/admin/profile", icon: User, color: "indigo" },
  { label: "System Settings", path: "/admin/env", icon: Terminal, color: "dark", permission: "system:manage" },
];

export { navItems as adminNavItems };

const AdminRoutes = () => {
  useEffect(() => {
    setActiveRole(ROLES.ADMIN);
  }, []);

  const { user } = useAuth();
  const { totalUnread } = useSupportUnread();
  const { countsByPath } = useNavBadges();

  const permittedNavItems = useMemo(
    () => filterNavItemsByPermissions(navItems, user),
    [user],
  );

  const fallbackPath = useMemo(
    () => firstPermittedAdminPath(permittedNavItems, user, "/admin/profile"),
    [permittedNavItems, user],
  );

  const navItemsWithBadges = useMemo(() => {
    const withQueueBadges = applyNavBadgeCounts(permittedNavItems, countsByPath);
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
  }, [totalUnread, countsByPath, permittedNavItems]);

  return (
    <DashboardLayout navItems={navItemsWithBadges} title="Admin Center">
      <Routes>
        <Route
          path="/"
          element={
            hasPermission(user, "dashboard:view") ? (
              <Dashboard />
            ) : (
              <Navigate to={fallbackPath} replace />
            )
          }
        />
        <Route path="/profile" element={<AdminProfile />} />
        <Route path="/categories" element={<Navigate to="/admin/categories/header" replace />} />
        <Route path="/categories/header" element={withPermission("categories:view", <HeaderCategories />)} />
        <Route path="/categories/level2" element={withPermission("categories:view", <Level2Categories />)} />
        <Route path="/categories/sub" element={withPermission("categories:view", <SubCategories />)} />
        <Route path="/categories/hierarchy" element={withPermission("categories:view", <CategoryHierarchy />)} />
        <Route path="/products" element={withPermission("products:view", <ProductManagement />)} />
        <Route path="/sellers/active" element={withPermission("sellers:view", <ActiveSellers />)} />
        <Route path="/sellers/active/:id" element={withPermission("sellers:view", <SellerDetail />)} />
        <Route path="/support-tickets" element={withPermission("support:view", <SupportTickets />)} />
        <Route path="/moderation" element={withPermission("support:moderate", <ReviewModeration />)} />
        <Route path="/hero-categories" element={withPermission("marketing:view", <HeroCategoriesPerPage />)} />
        <Route path="/notifications" element={withPermission("marketing:send", <NotificationComposer />)} />
        <Route path="/offers" element={withPermission("marketing:view", <OffersManagement />)} />
        <Route path="/offer-sections" element={withPermission("marketing:view", <OfferSectionsManagement />)} />
        <Route path="/shop-by-store" element={withPermission("marketing:view", <ShopByStoreManagement />)} />
        <Route path="/coupons" element={withPermission("marketing:view", <CouponManagement />)} />
        <Route path="/sellers/pending" element={withPermission("sellers:view", <PendingSellers />)} />
        <Route path="/seller-locations" element={withPermission("sellers:view", <SellerLocations />)} />
        <Route path="/delivery-boys/active" element={withPermission("delivery:view", <ActiveDeliveryBoys />)} />
        <Route path="/delivery-boys/pending" element={withPermission("delivery:view", <PendingDeliveryBoys />)} />
        <Route path="/tracking" element={withPermission("delivery:track", <FleetTracking />)} />
        <Route path="/delivery-funds" element={withPermission("delivery:settle", <DeliveryFunds />)} />
        <Route path="/wallet" element={withPermission("finance:view", <AdminWallet />)} />
        <Route path="/withdrawals" element={withPermission("finance:view", <WithdrawalRequests />)} />
        <Route path="/seller-transactions" element={withPermission("finance:view", <SellerTransactions />)} />
        <Route path="/cash-collection" element={withPermission("cash:view", <CashCollection />)} />
        <Route path="/customers" element={withPermission("customers:view", <CustomerManagement />)} />
        <Route path="/customers/:id" element={withPermission("customers:view", <CustomerDetail />)} />
        <Route path="/inventory-reports" element={withPermission("inventory:view", <InventoryReportsHub />)} />
        <Route path="/faqs" element={withPermission("content:view", <FAQManagement />)} />
        <Route path="/legal-pages" element={withPermission("content:view", <LegalPagesManagement />)} />
        <Route path="/orders/:status" element={withPermission("orders:view", <OrdersList />)} />
        <Route path="/orders/view/:orderId" element={withPermission("orders:view", <OrderDetail />)} />
        <Route path="/returns" element={withPermission("orders:returns", <Returns />)} />
        <Route path="/billing" element={withPermission("settings:view", <BillingCharges />)} />
        <Route path="/settings" element={withPermission("settings:view", <AdminSettings />)} />
        <Route path="/env" element={withPermission("system:manage", <EnvSettings />)} />
        <Route path="/access/roles" element={withPermission("rbac:view", <RoleManagement />)} />
        <Route path="/access/admins" element={withPermission("rbac:view", <AdminUserManagement />)} />
        <Route path="/mlm" element={withPermission("mlm:view", <MlmDashboard />)} />
        <Route path="/mlm/members" element={withPermission("mlm:view", <MlmMembers />)} />
        <Route path="/mlm/members/:id" element={withPermission("mlm:view", <MlmMemberDetail />)} />
        <Route path="/mlm/withdrawals" element={withPermission("mlm:view", <MlmWithdrawals />)} />
        <Route path="/mlm/payout-reports" element={withPermission("mlm:payout", <MlmPayoutReports />)} />
        <Route path="/mlm/payout-reports/:date" element={withPermission("mlm:payout", <MlmPayoutReportDetail />)} />
        <Route path="/mlm/joining-reviews" element={withPermission("mlm:view", <MlmJoiningReviews />)} />
        <Route path="/mlm/upgrade-reviews" element={withPermission("mlm:view", <MlmUpgradeReviews />)} />
        <Route path="/mlm/milestones" element={withPermission("mlm:settings", <MlmMilestoneRules />)} />
        <Route path="/mlm/settings" element={withPermission("mlm:settings", <MlmSettings />)} />
        <Route path="/franchise" element={withPermission("franchise:view", <FranchiseAdminDashboard />)} />
        <Route path="/franchise/registrations" element={withPermission("franchise:view", <FranchiseRegistrations />)} />
        <Route path="/franchise/topups" element={withPermission("franchise:view", <FranchiseTopUps />)} />
        <Route path="/franchise/partners" element={withPermission("franchise:view", <FranchisePartners />)} />
        <Route path="/franchise/partners/:id" element={withPermission("franchise:view", <FranchisePartnerDetail />)} />
        <Route path="/franchise/dispatch" element={withPermission("franchise:dispatch", <FranchiseDispatch />)} />
        <Route path="/franchise/settings" element={withPermission("franchise:settings", <FranchiseSettings />)} />
        <Route path="*" element={<Navigate to={fallbackPath} replace />} />
      </Routes>
    </DashboardLayout>
  );
};

export default AdminRoutes;

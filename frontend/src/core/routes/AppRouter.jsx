import React, { lazy, useMemo, useEffect, Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Outlet, Navigate, useLocation } from 'react-router-dom';
import ProtectedRoute from '../guards/ProtectedRoute';
import RoleGuard from '../guards/RoleGuard';
import { UserRole } from '../constants/roles';
import RootErrorBoundary from '../../shared/components/RootErrorBoundary';
import { setActiveRole, ROLES } from '../auth/activeRoleStore';

// Providers for Customer Module
import { WishlistProvider } from '../../modules/customer/context/WishlistContext';
import { CartProvider } from '../../modules/customer/context/CartContext';
import { CartAnimationProvider } from '../../modules/customer/context/CartAnimationContext';
import { ProductDetailProvider } from '../../modules/customer/context/ProductDetailContext';
import { LocationProvider } from '../../modules/customer/context/LocationContext';
import ScrollToTop from '../../modules/customer/components/shared/ScrollToTop';

// Public Pages
import Auth from '../../modules/seller/pages/Auth';
import ApplicationPending from '../../modules/seller/pages/ApplicationPending';
import AdminAuth from '../../modules/admin/pages/AdminAuth';
import DeliveryAuth from '../../modules/delivery/pages/DeliveryAuth';
import CustomerAuth from '../../modules/customer/pages/CustomerAuth';
// Admin "Log in as Member" support flow lands here in a new tab to
// install the impersonation JWT before forwarding to /mlm. Must be
// public (no ProtectedRoute) because the whole point is to install
// the customer session for an unauthenticated browser context.
const AuthHandoff = lazy(() => import('../../modules/customer/pages/AuthHandoff'));

// Customer Pages (lazy-loaded)
const Home = lazy(() => import('../../modules/customer/pages/Home'));
const CategoriesPage = lazy(() => import('../../modules/customer/pages/CategoriesPage'));
const CategoryProductsPage = lazy(() => import('../../modules/customer/pages/CategoryProductsPage'));
const WishlistPage = lazy(() => import('../../modules/customer/pages/WishlistPage'));
const OffersPage = lazy(() => import('../../modules/customer/pages/OffersPage'));
const ShopByStorePage = lazy(() => import('../../modules/customer/pages/ShopByStorePage'));
const ProfilePage = lazy(() => import('../../modules/customer/pages/ProfilePage'));
const OrdersPage = lazy(() => import('../../modules/customer/pages/OrdersPage'));
const OrderTransactionsPage = lazy(() => import('../../modules/customer/pages/OrderTransactionsPage'));
const AddressesPage = lazy(() => import('../../modules/customer/pages/AddressesPage'));
const SettingsPage = lazy(() => import('../../modules/customer/pages/SettingsPage'));
const SupportPage = lazy(() => import('../../modules/customer/pages/SupportPage'));
const ChatPage = lazy(() => import('../../modules/customer/pages/ChatPage'));
const TermsPage = lazy(() => import('../../modules/customer/pages/TermsPage'));
const PrivacyPage = lazy(() => import('../../modules/customer/pages/PrivacyPage'));
const AboutPage = lazy(() => import('../../modules/customer/pages/AboutPage'));
const EditProfilePage = lazy(() => import('../../modules/customer/pages/EditProfilePage'));
const AccountCredentialsPage = lazy(() => import('../../modules/customer/pages/AccountCredentialsPage'));
const OrderDetailPage = lazy(() => import('../../modules/customer/pages/OrderDetailPage'));
const ProductDetailPage = lazy(() => import('../../modules/customer/pages/ProductDetailPage'));
const CheckoutPage = lazy(() => import('../../modules/customer/pages/CheckoutPage'));
const PaymentStatusPage = lazy(() => import('../../modules/customer/pages/PaymentStatusPage'));
const SearchPage = lazy(() => import('../../modules/customer/pages/SearchPage'));
const WalletPage = lazy(() => import('../../modules/customer/pages/WalletPage'));
const MlmDashboardPage = lazy(() => import('../../modules/customer/pages/mlm/MlmDashboardPage'));
const MlmReferralPage = lazy(() => import('../../modules/customer/pages/mlm/MlmReferralPage'));
const MlmEarningsPage = lazy(() => import('../../modules/customer/pages/mlm/MlmEarningsPage'));
const MlmWithdrawalPage = lazy(() => import('../../modules/customer/pages/mlm/MlmWithdrawalPage'));
const MlmProfilePage = lazy(() => import('../../modules/customer/pages/mlm/MlmProfilePage'));
const ManualPaymentPage = lazy(() => import('../../modules/customer/pages/mlm/ManualPaymentPage'));
const FranchiseDashboardPage = lazy(() => import('../../modules/customer/pages/franchise/FranchiseDashboardPage'));
const FranchiseRegisterPage = lazy(() => import('../../modules/customer/pages/franchise/FranchiseRegisterPage'));
const FranchiseRegistrationPaymentPage = lazy(() => import('../../modules/customer/pages/franchise/FranchiseRegistrationPaymentPage'));
const FranchiseWalletPage = lazy(() => import('../../modules/customer/pages/franchise/FranchiseWalletPage'));
const FranchiseCatalogPage = lazy(() => import('../../modules/customer/pages/franchise/FranchiseCatalogPage'));
const FranchiseStockPage = lazy(() => import('../../modules/customer/pages/franchise/FranchiseStockPage'));
const FranchiseOrdersPage = lazy(() => import('../../modules/customer/pages/franchise/FranchiseOrdersPage'));
// Customer-MLM-rebuild Phase 8 — new dashboard + Genealogy + Payouts sections.
const MainDashboardPage = lazy(() => import('../../modules/customer/pages/mlm/MainDashboardPage'));
// Desktop-only sidebar chrome that wraps every `/mlm/*` URL on
// `md:+`. Renders just `<Outlet/>` below the breakpoint so mobile
// stays visually identical to the pre-sidebar version. See file
// header for the design rationale.
const MlmLayout = lazy(() => import('../../modules/customer/pages/mlm/MlmLayout'));
const GenealogyLayout = lazy(() => import('../../modules/customer/pages/mlm/genealogy/GenealogyLayout'));
const TreeViewPage = lazy(() => import('../../modules/customer/pages/mlm/genealogy/TreeViewPage'));
const BinaryGenealogyPage = lazy(() => import('../../modules/customer/pages/mlm/genealogy/BinaryGenealogyPage'));
const MatchingReportPage = lazy(() => import('../../modules/customer/pages/mlm/genealogy/MatchingReportPage'));
const DirectSponsorPage = lazy(() => import('../../modules/customer/pages/mlm/genealogy/DirectSponsorPage'));
const PayoutsLayout = lazy(() => import('../../modules/customer/pages/mlm/payouts/PayoutsLayout'));
const MyEarningsPage = lazy(() => import('../../modules/customer/pages/mlm/payouts/MyEarningsPage'));
const MyPayoutPage = lazy(() => import('../../modules/customer/pages/mlm/payouts/MyPayoutPage'));
const WalletHistoryPage = lazy(() => import('../../modules/customer/pages/mlm/payouts/WalletHistoryPage'));
const LeftTeamPage = lazy(() => import('../../modules/customer/pages/mlm/network/LeftTeamPage'));
const RightTeamPage = lazy(() => import('../../modules/customer/pages/mlm/network/RightTeamPage'));
const LevelTeamPage = lazy(() => import('../../modules/customer/pages/mlm/network/LevelTeamPage'));
const TotalTeamPage = lazy(() => import('../../modules/customer/pages/mlm/network/TotalTeamPage'));
const NetworkMemberDetailPage = lazy(() => import('../../modules/customer/pages/mlm/network/NetworkMemberDetailPage'));

// Lazy load heavy modules
const SellerModule = lazy(() => import('../../modules/seller/routes/index'));
const AdminModule = lazy(() => import('../../modules/admin/routes/index'));
const DeliveryModule = lazy(() => import('../../modules/delivery/routes/index'));

import CustomerLayout from '../../modules/customer/components/layout/CustomerLayout';

/** Old `/franchise/*` bookmarks → `/mlm/franchise/*` inside MlmLayout. */
const LegacyFranchiseRedirect = () => {
    const { pathname, search, hash } = useLocation();
    const next = pathname.replace(/^\/franchise/, '/mlm/franchise');
    return <Navigate to={`${next}${search}${hash}`} replace />;
};

const CustomerLayoutWrapper = () => {
    useEffect(() => {
        setActiveRole(ROLES.CUSTOMER);
    }, []);

    return (
        <LocationProvider>
            <WishlistProvider>
                <CartProvider>
                    <CartAnimationProvider>
                        <ProductDetailProvider>
                            <ScrollToTop />
                            <CustomerLayout>
                                <Suspense fallback={<div className="flex h-screen items-center justify-center font-outfit">Loading...</div>}>
                                    <Outlet />
                                </Suspense>
                            </CustomerLayout>
                        </ProductDetailProvider>
                    </CartAnimationProvider>
                </CartProvider>
            </WishlistProvider>
        </LocationProvider>
    );
};

const AppRouter = () => {
    const router = useMemo(() => createBrowserRouter([
        {
            path: '/',
            element: <Outlet />,
            errorElement: <RootErrorBoundary />,
            children: [
                {
                    path: 'login',
                    element: <CustomerAuth />,
                },
                {
                    path: 'signup',
                    element: <CustomerAuth />,
                },
                // Legacy alias — `/customer-auth?ref=CODE` is what older
                // MLM referral shares (WhatsApp / SMS / printed material)
                // point at. Mapped to the same component so existing
                // links keep working and the `?ref` query is preserved
                // for the prefill logic in CustomerAuth.jsx.
                {
                    path: 'customer-auth',
                    element: <CustomerAuth />,
                },
                {
                    path: 'seller/auth',
                    element: <Auth />,
                },
                {
                    path: 'seller/pending-approval',
                    element: <ApplicationPending />,
                },
                {
                    path: 'admin/auth',
                    element: <AdminAuth />,
                },
                {
                    path: 'delivery/auth',
                    element: <DeliveryAuth />,
                },
                // Admin impersonation handoff — public on purpose.
                // The page reads the JWT from `location.hash`, scrubs
                // it, then `useAuth().login(...)` + `navigate(...)`
                // off to the customer destination. See AuthHandoff.jsx
                // header for the security model.
                {
                    path: 'auth/handoff',
                    element: (
                        <Suspense fallback={<div className="flex h-screen items-center justify-center font-outfit">Signing you in…</div>}>
                            <AuthHandoff />
                        </Suspense>
                    ),
                },
                {
                    path: 'seller/*',
                    element: (
                        <ProtectedRoute>
                            <RoleGuard allowedRoles={[UserRole.SELLER]}>
                                <SellerModule />
                            </RoleGuard>
                        </ProtectedRoute>
                    ),
                },
                {
                    path: 'admin/*',
                    element: (
                        <ProtectedRoute>
                            <RoleGuard allowedRoles={[UserRole.ADMIN]}>
                                <AdminModule />
                            </RoleGuard>
                        </ProtectedRoute>
                    ),
                },
                {
                    path: 'delivery/*',
                    element: (
                        <ProtectedRoute>
                            <RoleGuard allowedRoles={[UserRole.DELIVERY]}>
                                <DeliveryModule />
                            </RoleGuard>
                        </ProtectedRoute>
                    ),
                },
                {
                    path: 'unauthorized',
                    element: <div className="flex h-screen items-center justify-center font-outfit">Unauthorized Access</div>,
                },
                {
                    element: <CustomerLayoutWrapper />,
                    children: [
                        { index: true, element: <Home /> },
                        { path: 'categories', element: <CategoriesPage /> },
                        { path: 'category/:categoryName', element: <CategoryProductsPage /> },
                        { path: 'product/:id', element: <ProductDetailPage /> },
                        { path: 'terms', element: <TermsPage /> },
                        { path: 'privacy', element: <PrivacyPage /> },
                        { path: 'about', element: <AboutPage /> },
                        { path: 'offers', element: <OffersPage /> },
                        { path: 'shop-by-store', element: <ShopByStorePage /> },
                        { path: 'wishlist', element: <ProtectedRoute><WishlistPage /></ProtectedRoute> },
                        { path: 'orders', element: <ProtectedRoute><OrdersPage /></ProtectedRoute> },
                        { path: 'orders/:orderId', element: <ProtectedRoute><OrderDetailPage /></ProtectedRoute> },
                        { path: 'transactions', element: <ProtectedRoute><OrderTransactionsPage /></ProtectedRoute> },
                        { path: 'addresses', element: <ProtectedRoute><AddressesPage /></ProtectedRoute> },
                        { path: 'settings', element: <ProtectedRoute><SettingsPage /></ProtectedRoute> },
                        { path: 'support', element: <ProtectedRoute><SupportPage /></ProtectedRoute> },
                        { path: 'chat', element: <ProtectedRoute><ChatPage /></ProtectedRoute> },
                        { path: 'checkout', element: <ProtectedRoute><CheckoutPage /></ProtectedRoute> },
                        { path: 'payment-status', element: <PaymentStatusPage /> },
                        { path: 'profile', element: <ProtectedRoute><ProfilePage /></ProtectedRoute> },
                        { path: 'profile/edit', element: <ProtectedRoute><EditProfilePage /></ProtectedRoute> },
                        // Phase 7 (PO-request): in-app credential reveal.
                        { path: 'account/credentials', element: <ProtectedRoute><AccountCredentialsPage /></ProtectedRoute> },
                        { path: 'wallet', element: <ProtectedRoute><WalletPage /></ProtectedRoute> },
                        // Customer-MLM-rebuild Phase 8 — `/mlm` is the new
                        // MainDashboardPage. Legacy MlmDashboardPage is
                        // retained at `/mlm/legacy` for safe rollback.
                        //
                        // Sidebar shell (added Jun 2026): every `/mlm/*`
                        // URL is wrapped in `MlmLayout` so the desktop
                        // view (md:+) gets the panel/sidebar chrome.
                        // `ProtectedRoute` is hoisted to the parent so
                        // the auth gate runs once for the whole branch
                        // instead of on every leaf. Mobile is unchanged
                        // because `MlmLayout` renders only `<Outlet/>`
                        // below the `md:` breakpoint.
                        {
                            path: 'mlm',
                            element: <ProtectedRoute><MlmLayout /></ProtectedRoute>,
                            children: [
                                { index: true, element: <MainDashboardPage /> },
                                { path: 'legacy', element: <MlmDashboardPage /> },
                                { path: 'profile', element: <MlmProfilePage /> },
                                // Network section
                                {
                                    path: 'network',
                                    children: [
                                        { path: 'referrals', element: <MlmReferralPage /> },
                                        { path: 'total-team', element: <TotalTeamPage /> },
                                        { path: 'member/:memberId', element: <NetworkMemberDetailPage /> },
                                        { path: 'left-team', element: <LeftTeamPage /> },
                                        { path: 'right-team', element: <RightTeamPage /> },
                                        { path: 'level-team', element: <LevelTeamPage /> },
                                        {
                                            path: 'genealogy',
                                            element: <GenealogyLayout />,
                                            children: [
                                                { index: true, element: <Navigate to="tree" replace /> },
                                                { path: 'tree', element: <TreeViewPage /> },
                                                { path: 'binary', element: <BinaryGenealogyPage /> },
                                                { path: 'matching-report', element: <MatchingReportPage /> },
                                                { path: 'direct-sponsor', element: <DirectSponsorPage /> },
                                            ],
                                        },
                                    ]
                                },
                                // Payouts section — tabbed layout (Earnings /
                                // Payout / Wallet History). `/mlm/payouts`
                                // redirects to Earnings by default.
                                {
                                    path: 'payouts',
                                    element: <PayoutsLayout />,
                                    children: [
                                        { index: true, element: <Navigate to="earnings" replace /> },
                                        { path: 'earnings', element: <MyEarningsPage /> },
                                        { path: 'withdrawals', element: <MyPayoutPage /> },
                                        { path: 'wallet-history', element: <WalletHistoryPage /> },
                                    ],
                                },
                                // Legacy direct paths — kept so old
                                // notifications / deep links keep working;
                                // they render the new tabbed versions inside
                                // the Payouts layout.
                                { path: 'earnings', element: <Navigate to="/mlm/payouts/earnings" replace /> },
                                { path: 'withdrawals', element: <Navigate to="/mlm/payouts/withdrawals" replace /> },
                                { path: 'home-shopping', element: <Navigate to="/mlm/franchise" replace /> },
                                { path: 'manual-payment/:paymentId', element: <ManualPaymentPage /> },
                                {
                                    path: 'franchise',
                                    children: [
                                        { index: true, element: <FranchiseDashboardPage /> },
                                        { path: 'register', element: <FranchiseRegisterPage /> },
                                        { path: 'register/payment/:paymentId', element: <FranchiseRegistrationPaymentPage /> },
                                        { path: 'wallet', element: <FranchiseWalletPage /> },
                                        { path: 'catalog', element: <FranchiseCatalogPage /> },
                                        { path: 'stock', element: <FranchiseStockPage /> },
                                        { path: 'orders', element: <FranchiseOrdersPage /> },
                                    ],
                                },
                            ],
                        },
                        { path: 'franchise', element: <Navigate to="/mlm/franchise" replace /> },
                        { path: 'franchise/*', element: <LegacyFranchiseRedirect /> },
                        { path: 'search', element: <SearchPage /> },
                    ]
                },
                {
                    path: '*',
                    element: <Navigate to="/" replace />
                }
            ]
        }
    ]), []);

    return <RouterProvider router={router} />;
};

export default AppRouter;

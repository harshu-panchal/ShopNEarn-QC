import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Home from '../pages/Home';
import CategoriesPage from '../pages/CategoriesPage';
import CategoryProductsPage from '../pages/CategoryProductsPage';
import WishlistPage from '../pages/WishlistPage';
import CartPage from '../pages/CartPage';
import OffersPage from '../pages/OffersPage';
import ProfilePage from '../pages/ProfilePage';
import OrdersPage from '../pages/OrdersPage';
import OrderTransactionsPage from '../pages/OrderTransactionsPage';
import AddressesPage from '../pages/AddressesPage';
import SettingsPage from '../pages/SettingsPage';
import SupportPage from '../pages/SupportPage';
import ChatPage from '../pages/ChatPage';
import TermsPage from '../pages/TermsPage';
import PrivacyPage from '../pages/PrivacyPage';
import AboutPage from '../pages/AboutPage';
import EditProfilePage from '../pages/EditProfilePage';
import AccountCredentialsPage from '../pages/AccountCredentialsPage';
import OrderDetailPage from '../pages/OrderDetailPage';
import ProductDetailPage from '../pages/ProductDetailPage';
import CheckoutPage from '../pages/CheckoutPage';
import PaymentStatusPage from '../pages/PaymentStatusPage';
import WalletPage from '../pages/WalletPage';
import MlmDashboardPage from '../pages/mlm/MlmDashboardPage';
import MlmReferralPage from '../pages/mlm/MlmReferralPage';
import MlmEarningsPage from '../pages/mlm/MlmEarningsPage';
import MlmWithdrawalPage from '../pages/mlm/MlmWithdrawalPage';
import MlmHomeShoppingPage from '../pages/mlm/MlmHomeShoppingPage';
// Customer-MLM-rebuild Phase 8 — new dashboard + Genealogy + Payouts sections.
import MainDashboardPage from '../pages/mlm/MainDashboardPage';
import GenealogyLayout from '../pages/mlm/genealogy/GenealogyLayout';
import TreeViewPage from '../pages/mlm/genealogy/TreeViewPage';
import BinaryGenealogyPage from '../pages/mlm/genealogy/BinaryGenealogyPage';
import MatchingReportPage from '../pages/mlm/genealogy/MatchingReportPage';
import DirectSponsorPage from '../pages/mlm/genealogy/DirectSponsorPage';
import PayoutsLayout from '../pages/mlm/payouts/PayoutsLayout';
import MyEarningsPage from '../pages/mlm/payouts/MyEarningsPage';
import MyPayoutPage from '../pages/mlm/payouts/MyPayoutPage';
import WalletHistoryPage from '../pages/mlm/payouts/WalletHistoryPage';
import ScrollToTop from '../components/shared/ScrollToTop';
import { WishlistProvider } from '../context/WishlistContext';
import { CartProvider } from '../context/CartContext';
import { CartAnimationProvider } from '../context/CartAnimationContext';
import { LocationProvider } from '../context/LocationContext';

import ProtectedRoute from '../../../core/guards/ProtectedRoute';

const CustomerRoutes = () => {
    return (
        <LocationProvider>
            <WishlistProvider>
                <CartProvider>
                    <CartAnimationProvider>
                        <ScrollToTop />
                        <Routes>
                            <Route path="/" element={<Home />} />
                            <Route path="categories" element={<CategoriesPage />} />
                            <Route path="category/:categoryName" element={<CategoryProductsPage />} />
                            <Route path="product/:id" element={<ProductDetailPage />} />
                            <Route path="terms" element={<TermsPage />} />
                            <Route path="privacy" element={<PrivacyPage />} />
                            <Route path="about" element={<AboutPage />} />
                            <Route path="offers" element={<OffersPage />} />

                            {/* Protected Customer Routes */}
                            <Route path="wishlist" element={<ProtectedRoute><WishlistPage /></ProtectedRoute>} />
                            <Route path="orders" element={<ProtectedRoute><OrdersPage /></ProtectedRoute>} />
                            <Route path="orders/:orderId" element={<ProtectedRoute><OrderDetailPage /></ProtectedRoute>} />
                            <Route path="transactions" element={<ProtectedRoute><OrderTransactionsPage /></ProtectedRoute>} />
                            <Route path="addresses" element={<ProtectedRoute><AddressesPage /></ProtectedRoute>} />
                            <Route path="settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
                            <Route path="support" element={<ProtectedRoute><SupportPage /></ProtectedRoute>} />
                            <Route path="chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
                            <Route path="checkout" element={<ProtectedRoute><CheckoutPage /></ProtectedRoute>} />
                            <Route path="payment-status" element={<ProtectedRoute><PaymentStatusPage /></ProtectedRoute>} />
                            <Route path="profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
                            <Route path="profile/edit" element={<ProtectedRoute><EditProfilePage /></ProtectedRoute>} />
                            <Route path="account/credentials" element={<ProtectedRoute><AccountCredentialsPage /></ProtectedRoute>} />
                            {/* Wallet page (pre-existing gap fixed in MLM Phase 1) */}
                            <Route path="wallet" element={<ProtectedRoute><WalletPage /></ProtectedRoute>} />
                            {/* Customer-MLM-rebuild Phase 8 — new main dashboard,
                                Genealogy tabbed section, Payouts tabbed section.
                                Legacy paths redirect into the new layouts. */}
                            <Route path="mlm" element={<ProtectedRoute><MainDashboardPage /></ProtectedRoute>} />
                            <Route path="mlm/legacy" element={<ProtectedRoute><MlmDashboardPage /></ProtectedRoute>} />
                            <Route path="mlm/referrals" element={<ProtectedRoute><MlmReferralPage /></ProtectedRoute>} />
                            <Route path="mlm/genealogy" element={<ProtectedRoute><GenealogyLayout /></ProtectedRoute>}>
                                <Route index element={<Navigate to="tree" replace />} />
                                <Route path="tree" element={<TreeViewPage />} />
                                <Route path="binary" element={<BinaryGenealogyPage />} />
                                <Route path="matching-report" element={<MatchingReportPage />} />
                                <Route path="direct-sponsor" element={<DirectSponsorPage />} />
                            </Route>
                            <Route path="mlm/payouts" element={<ProtectedRoute><PayoutsLayout /></ProtectedRoute>}>
                                <Route index element={<Navigate to="earnings" replace />} />
                                <Route path="earnings" element={<MyEarningsPage />} />
                                <Route path="withdrawals" element={<MyPayoutPage />} />
                                <Route path="wallet-history" element={<WalletHistoryPage />} />
                            </Route>
                            <Route path="mlm/earnings" element={<Navigate to="/mlm/payouts/earnings" replace />} />
                            <Route path="mlm/withdrawals" element={<Navigate to="/mlm/payouts/withdrawals" replace />} />
                            <Route path="mlm/home-shopping" element={<ProtectedRoute><MlmHomeShoppingPage /></ProtectedRoute>} />
                        </Routes>
                    </CartAnimationProvider>
                </CartProvider>
            </WishlistProvider>
        </LocationProvider>
    );
};

export default CustomerRoutes;

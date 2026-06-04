import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, ArrowDownLeft, ChevronLeft, Wallet, ShoppingBag, TrendingUp, Banknote } from 'lucide-react';
import { customerApi } from '../services/customerApi';
import { mlmApi } from '../services/mlmApi';

const formatDate = (d) => {
    if (!d) return '';
    const date = new Date(d);
    const now = new Date();
    const today = now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === today) return `Today, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ', ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const WalletPage = () => {
    const navigate = useNavigate();
    const [walletBuckets, setWalletBuckets] = useState({
        availableBalance: 0,
        shoppingBalance: 0,
        earningsBalance: 0,
        pendingBalance: 0,
    });
    const [mlmConfig, setMlmConfig] = useState(null);
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isMlmMember, setIsMlmMember] = useState(false);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                // MLM membership endpoint returns authoritative wallet bucket breakdown
                // and the public config. Falls back to legacy profile.walletBalance.
                const [mlmRes, profileRes, ordersRes] = await Promise.all([
                    mlmApi.getMembership().catch(() => null),
                    customerApi.getProfile().catch(() => null),
                    customerApi.getMyOrders().catch(() => null),
                ]);

                const mlmData = mlmRes?.data?.result ?? mlmRes?.data?.data;
                const profile = profileRes?.data?.result ?? profileRes?.data?.data ?? profileRes?.data;

                if (mlmData?.wallet) {
                    setWalletBuckets({
                        availableBalance: mlmData.wallet.availableBalance || 0,
                        shoppingBalance: mlmData.wallet.shoppingBalance || 0,
                        earningsBalance: mlmData.wallet.earningsBalance || 0,
                        pendingBalance: mlmData.wallet.pendingBalance || 0,
                    });
                    setIsMlmMember(!!mlmData.isMember);
                    setMlmConfig(mlmData.config || null);
                } else if (profile) {
                    setWalletBuckets({
                        availableBalance: profile.walletBalance || 0,
                        shoppingBalance: 0,
                        earningsBalance: 0,
                        pendingBalance: 0,
                    });
                }

                const rawOrders = ordersRes?.data?.results ?? ordersRes?.data?.result ?? [];
                const orders = Array.isArray(rawOrders) ? rawOrders : [];
                const walletOrders = orders.filter(
                    (o) => (o.payment?.method || '').toLowerCase() === 'wallet'
                );
                setTransactions(walletOrders.map((o) => ({
                    _id: o._id,
                    type: 'debit',
                    title: 'Order Payment',
                    amount: o.pricing?.total ?? o.payableAmount ?? 0,
                    date: o.createdAt,
                    orderId: o.orderId,
                })));
            } catch (err) {
                console.error('Wallet fetch error:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    const canWithdraw = isMlmMember
        && walletBuckets.earningsBalance >= (mlmConfig?.withdrawalMinAmount || 500);

    return (
        <div className="min-h-screen bg-slate-50 pb-24 font-sans">
            <div className="sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 pt-4 pb-3 border-b border-slate-200/60 mb-4 flex items-center gap-2">
                <button
                    onClick={() => navigate(-1)}
                    className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors -ml-1"
                >
                    <ChevronLeft size={22} className="text-slate-800" />
                </button>
                <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Wallet</h1>
            </div>

            <div className="max-w-2xl mx-auto px-4 pt-1 relative z-20 space-y-4">
                {/* Shopping Wallet (non-withdrawable, used at checkout) */}
                <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/40 rounded-xl border border-emerald-200 p-4">
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide flex items-center gap-1">
                                <ShoppingBag size={12} /> Shopping Credit
                            </p>
                            <h2 className="text-3xl font-bold text-slate-900 mt-1">
                                {loading ? '...' : formatINR(walletBuckets.shoppingBalance)}
                            </h2>
                            <p className="text-xs text-slate-600 mt-1">Use at checkout. Cannot be withdrawn.</p>
                        </div>
                    </div>
                </div>

                {/* Earnings Wallet (withdrawable) */}
                {isMlmMember && (
                    <div className="bg-gradient-to-br from-violet-50 to-violet-100/40 rounded-xl border border-violet-200 p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                                <p className="text-[11px] font-semibold text-violet-700 uppercase tracking-wide flex items-center gap-1">
                                    <TrendingUp size={12} /> Rewards Earnings
                                </p>
                                <h2 className="text-3xl font-bold text-slate-900 mt-1">
                                    {loading ? '...' : formatINR(walletBuckets.earningsBalance)}
                                </h2>
                                <p className="text-xs text-slate-600 mt-1">
                                    Withdrawable. Pending: {formatINR(walletBuckets.pendingBalance)}
                                </p>
                            </div>
                            <button
                                onClick={() => navigate('/mlm/withdrawals')}
                                disabled={!canWithdraw}
                                className={`px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-1 transition-colors ${
                                    canWithdraw
                                        ? 'bg-violet-600 hover:bg-violet-700 text-white shadow'
                                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                }`}
                            >
                                <Banknote size={14} /> Withdraw
                            </button>
                        </div>
                        {!canWithdraw && walletBuckets.earningsBalance > 0 && (
                            <p className="text-[10px] text-slate-500 mt-2">
                                Minimum withdrawal: {formatINR(mlmConfig?.withdrawalMinAmount || 500)}
                            </p>
                        )}
                    </div>
                )}

                {/* Refund Balance (legacy bucket) */}
                {(walletBuckets.availableBalance > 0 || !isMlmMember) && (
                    <div className="bg-white rounded-xl border border-slate-200 p-4">
                        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Refund Balance</p>
                        <h2 className="text-2xl font-semibold text-slate-900 mt-1">
                            {loading ? '...' : formatINR(walletBuckets.availableBalance)}
                        </h2>
                        <p className="text-xs text-slate-500 mt-1">Return refunds are credited here. Usable at checkout.</p>
                    </div>
                )}

                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-base font-semibold text-slate-800">Transaction History</h3>
                        <Wallet size={18} className="text-slate-400" />
                    </div>

                    {loading ? (
                        <div className="py-12 flex justify-center text-slate-400 text-sm font-semibold">
                            Loading...
                        </div>
                    ) : transactions.length === 0 ? (
                        <div className="py-12 flex flex-col items-center justify-center text-center px-6">
                            <p className="text-sm font-semibold text-slate-500 mb-1">No wallet payments yet</p>
                            <p className="text-xs text-slate-400">
                                Orders paid using wallet will appear here.
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {transactions.map((tx) => (
                                <div key={tx._id} className="px-4 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${tx.type === 'credit' ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-slate-700'}`}>
                                            {tx.type === 'credit' ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}
                                        </div>
                                        <div>
                                            <h4 className="font-semibold text-slate-800 text-sm">{tx.title}</h4>
                                            <p className="text-[11px] text-slate-500">{formatDate(tx.date)}</p>
                                            {tx.orderId && (
                                                <p className="text-[10px] text-slate-500">#{tx.orderId}</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className={`text-sm font-semibold ${tx.type === 'credit' ? 'text-brand-600' : 'text-slate-900'}`}>
                                        {tx.type === 'credit' ? '+' : '-'}{formatINR(tx.amount)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default WalletPage;

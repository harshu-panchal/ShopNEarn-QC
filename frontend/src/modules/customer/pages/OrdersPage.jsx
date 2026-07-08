import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Package, ChevronRight, Clock, CheckCircle, Loader2, ChevronLeft, Truck, XCircle } from 'lucide-react';
import { customerApi } from '../services/customerApi';
import {
    getOrderStatusLabel,
    getLegacyStatusFromOrder,
    getOrderItemImage,
    getOrderDisplayTotal,
    getOrderLineSummary,
    getCustomerOrderStatusStyles,
} from '@/shared/utils/orderStatus';
import { applyCloudinaryTransform } from '@/core/utils/imageUtils';

function OrderThumbnail({ order }) {
    const items = Array.isArray(order?.items) ? order.items : [];
    const previewItems = items.slice(0, 3);
    const extraCount = Math.max(0, items.length - previewItems.length);

    if (!previewItems.length) {
        return (
            <div className="h-14 w-14 rounded-xl overflow-hidden flex items-center justify-center bg-slate-50 ring-1 ring-slate-200/90 shrink-0">
                <Package size={22} className="text-slate-400" />
            </div>
        );
    }

    if (previewItems.length === 1) {
        const image = getOrderItemImage(previewItems[0]);
        return (
            <div className="relative h-14 w-14 rounded-xl overflow-hidden bg-slate-50 ring-1 ring-slate-200/90 shrink-0">
                {image ? (
                    <img
                        src={applyCloudinaryTransform(image, 'f_auto,q_auto,w_200,h_200,c_fill')}
                        alt={previewItems[0]?.name || 'Product'}
                        loading="lazy"
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <Package size={22} className="text-slate-400" />
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="relative h-14 w-[4.5rem] shrink-0">
            {previewItems.map((item, index) => {
                const image = getOrderItemImage(item);
                return (
                    <div
                        key={`${item.product || item.name}-${index}`}
                        className="absolute top-0 h-12 w-12 rounded-xl overflow-hidden bg-slate-50 ring-2 ring-white shadow-sm"
                        style={{ left: `${index * 14}px`, zIndex: previewItems.length - index }}
                    >
                        {image ? (
                            <img
                                src={applyCloudinaryTransform(image, 'f_auto,q_auto,w_120,h_120,c_fill')}
                                alt={item?.name || 'Product'}
                                loading="lazy"
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center">
                                <Package size={16} className="text-slate-400" />
                            </div>
                        )}
                    </div>
                );
            })}
            {extraCount > 0 && (
                <span className="absolute -bottom-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
                    +{extraCount}
                </span>
            )}
        </div>
    );
}

function StatusIcon({ legacy }) {
    if (legacy === 'delivered') return <CheckCircle size={9} className="text-emerald-600" />;
    if (legacy === 'cancelled') return <XCircle size={9} className="text-rose-500" />;
    if (legacy === 'out_for_delivery') return <Truck size={9} className="text-violet-600" />;
    if (legacy === 'pending') return <Clock size={9} className="text-amber-600" />;
    return <CheckCircle size={9} className="text-blue-600" />;
}

const OrdersPage = () => {
    const navigate = useNavigate();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchOrders = async () => {
            try {
                const response = await customerApi.getMyOrders();
                const payload = response?.data;
                const items =
                    payload?.result?.items ||
                    payload?.results ||
                    [];
                setOrders(Array.isArray(items) ? items : []);
            } catch (error) {
                console.error("Failed to fetch orders:", error);
                const apiMessage = error?.response?.data?.message;
                if (apiMessage) {
                    console.warn("[OrdersPage] API error:", apiMessage);
                }
            } finally {
                setLoading(false);
            }
        };

        fetchOrders();
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white shadow-sm border border-slate-100">
                    <Loader2 className="animate-spin text-brand-600" size={22} />
                    <span className="text-sm font-medium text-slate-600">Loading your orders…</span>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 pb-24">
            <div className="sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 pt-4 pb-3 border-b border-slate-200/60 mb-4 flex items-center gap-2">
                <button
                    onClick={() => navigate(-1)}
                    className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors -ml-1"
                >
                    <ChevronLeft size={22} className="text-slate-800" />
                </button>
                <h1 className="text-xl font-semibold text-slate-900 tracking-tight">My Orders</h1>
                <Link
                    to="/reports/purchases"
                    className="ml-auto text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full px-3 py-1.5"
                >
                    Purchase reports
                </Link>
            </div>

            <div className="space-y-4 px-4 pb-2">
                {orders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <Package size={56} className="text-slate-300 mb-4" />
                        <h3 className="text-base font-semibold text-slate-900 mb-1">No orders yet</h3>
                        <p className="text-slate-500 text-sm mb-6 max-w-[260px]">
                            When you place an order, it will appear here so you can track it easily.
                        </p>
                        <Link to="/" className="bg-primary hover:bg-[#0a6d19] text-white px-7 py-2.5 rounded-full font-semibold text-sm shadow-sm transition-colors">
                            Start Shopping
                        </Link>
                    </div>
                ) : (
                    orders.map((order) => {
                        const legacy = getLegacyStatusFromOrder(order);
                        const statusStyles = getCustomerOrderStatusStyles(order);
                        const { primaryName, extraCount, totalQty } = getOrderLineSummary(order);
                        const total = getOrderDisplayTotal(order);

                        return (
                        <Link
                            to={`/orders/${order.orderId}`}
                            key={order._id}
                            className="block bg-white rounded-2xl px-4 py-3.5 shadow-[0_8px_24px_rgba(15,23,42,0.06)] border border-slate-100/80 active:scale-[0.985] transition-transform cursor-pointer hover:shadow-[0_10px_30px_rgba(15,23,42,0.08)]"
                        >
                            <div className="flex justify-between items-start gap-3 mb-3.5">
                                <div className="flex gap-3.5 flex-1 min-w-0">
                                    <OrderThumbnail order={order} />
                                    <div className="min-w-0 flex-1">
                                        <h3 className="font-semibold text-slate-900 text-sm tracking-tight leading-snug">
                                            Order #{order.orderId.slice(-6).toUpperCase()}
                                        </h3>
                                        <p className="mt-0.5 text-[11px] text-slate-500 font-medium leading-tight">
                                            {new Date(order.createdAt).toLocaleDateString('en-IN', {
                                                day: 'numeric',
                                                month: 'short',
                                                year: 'numeric',
                                            })}{' '}
                                            <span className="mx-1 text-slate-400">•</span>
                                            {new Date(order.createdAt).toLocaleTimeString('en-IN', {
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            })}
                                        </p>
                                        <p className="mt-1.5 text-xs font-medium text-slate-700 truncate">
                                            {primaryName}
                                            {extraCount > 0 && (
                                                <span className="text-slate-400 font-normal">
                                                    {' '}
                                                    + {extraCount} more
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-1 shrink-0 text-right">
                                    <span
                                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusStyles.badge}`}
                                    >
                                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/80">
                                            <StatusIcon legacy={legacy} />
                                        </span>
                                        <span>{getOrderStatusLabel(order)}</span>
                                    </span>
                                    <span className="inline-flex items-center text-[10px] font-medium text-slate-400">
                                        <span className="h-1 w-1 rounded-full bg-slate-300 mr-1" />
                                        Tap to view details
                                    </span>
                                </div>
                            </div>

                            <div className="border-t border-slate-100 pt-3 flex justify-between items-center gap-3">
                                <div className="text-[11px] text-slate-500 font-medium">
                                    {totalQty} item{totalQty === 1 ? '' : 's'}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-[11px] font-medium text-slate-400">Total</span>
                                    <span className="text-sm font-semibold text-slate-900">
                                        ₹{total.toLocaleString('en-IN')}
                                    </span>
                                    <ChevronRight size={16} className="text-slate-300" />
                                </div>
                            </div>
                        </Link>
                    );
                    })
                )}
            </div>
        </div>
    );
};

export default OrdersPage;

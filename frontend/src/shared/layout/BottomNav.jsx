import React from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
    LayoutDashboard,
    ClipboardList,
    Box,
    Wallet,
} from 'lucide-react';

import { useAuth } from '@core/context/AuthContext';
import { hasPermission } from '@/modules/admin/rbac/permissions';

const BottomNav = ({ navItems }) => {
    const { role, user } = useAuth();

    const adminPrimaryCandidates = [
        { label: 'Dashboard', path: '/admin', icon: LayoutDashboard, end: true, permission: 'dashboard:view' },
        { label: 'Orders', path: '/admin/orders/all', icon: ClipboardList, permission: 'orders:view' },
        { label: 'Products', path: '/admin/products', icon: Box, permission: 'products:view' },
        { label: 'Wallet', path: '/admin/wallet', icon: Wallet, permission: 'finance:view' },
    ];

    const primaryItems = role === 'admin'
        ? adminPrimaryCandidates.filter((item) => hasPermission(user, item.permission))
        : [
            { label: 'Dashboard', path: '/seller', icon: LayoutDashboard, end: true },
            { label: 'Orders', path: '/seller/orders', icon: ClipboardList },
            { label: 'Products', path: '/seller/products', icon: Box },
            { label: 'Earnings', path: '/seller/earnings', icon: Wallet },
        ];

    // If a limited admin has fewer than 4 primary items, fill from filtered navItems.
    const itemsToRender = (() => {
        if (role !== 'admin' || primaryItems.length >= 4) return primaryItems.slice(0, 4);
        const extras = [];
        const seen = new Set(primaryItems.map((i) => i.path));
        for (const item of navItems || []) {
            if (item.path && !seen.has(item.path)) {
                extras.push(item);
                seen.add(item.path);
            }
            for (const child of item.children || []) {
                if (child.path && !seen.has(child.path)) {
                    extras.push({
                        ...child,
                        icon: item.icon || ClipboardList,
                    });
                    seen.add(child.path);
                }
            }
            if (primaryItems.length + extras.length >= 4) break;
        }
        return [...primaryItems, ...extras].slice(0, 4);
    })();

    if (!itemsToRender.length) return null;

    return (
        <div className="fixed bottom-0 left-0 right-0 h-16 bg-[#0a0c10] border-t border-white/5 z-[60] md:hidden px-2 flex items-center justify-around shadow-[0_-10px_30px_rgba(0,0,0,0.4)]">
            {itemsToRender.map((item) => {
                const Icon = item.icon || LayoutDashboard;
                return (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        end={item.end}
                        className={({ isActive }) => cn(
                            "flex flex-col items-center justify-center space-y-1 w-16 transition-all duration-300",
                            isActive ? "text-primary" : "text-gray-500 hover:text-gray-300"
                        )}
                    >
                        <Icon className="h-5 w-5" />
                        <span className="text-[10px] font-bold uppercase tracking-tight">{item.label}</span>
                    </NavLink>
                );
            })}
        </div>
    );
};

export default BottomNav;

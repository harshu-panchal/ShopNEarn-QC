import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, LayoutGrid, ShoppingBag, User } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
    { label: 'Home', icon: Home, path: '/' },
    { label: 'Category', icon: LayoutGrid, path: '/categories' },
    { label: 'Orders', icon: ShoppingBag, path: '/orders' },
    { label: 'Profile', icon: User, path: '/profile' },
];

const BottomNav = () => {
    const location = useLocation();

    return (
        <nav
            aria-label="Primary navigation"
            className="fixed inset-x-0 bottom-0 z-[500] hidden h-[calc(var(--customer-bottom-nav-height)+env(safe-area-inset-bottom,0px))] grid-cols-4 border-t border-gray-100 bg-white px-[clamp(4px,2vw,16px)] pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-8px_30px_rgba(0,0,0,0.06)] max-md:grid"
        >
            {navItems.map((item) => {
                const isActive = location.pathname === item.path ||
                    (item.path !== '/' && location.pathname.startsWith(item.path));

                return (
                    <Link
                        key={item.path}
                        to={item.path}
                        aria-current={isActive ? 'page' : undefined}
                        className="group relative flex h-full min-w-0 items-center justify-center px-1 transition-all"
                    >
                        {isActive && (
                            <div className="pointer-events-none absolute inset-x-[clamp(2px,1.5vw,10px)] inset-y-[clamp(5px,1.5vw,8px)] -z-10 rounded-[clamp(14px,4vw,20px)] bg-primary/5 transition-opacity duration-300" />
                        )}

                        <div className="relative flex min-w-0 flex-col items-center justify-center">
                            <div
                                className={cn(
                                    "transition-transform duration-300",
                                    isActive ? "-translate-y-0.5 scale-110" : "translate-y-0 scale-100"
                                )}
                            >
                                <item.icon
                                    strokeWidth={isActive ? 2.5 : 2}
                                    className={cn(
                                        "size-[clamp(20px,5.75vw,24px)] shrink-0 transition-colors duration-300",
                                        isActive ? "text-primary" : "text-gray-400"
                                    )}
                                />
                            </div>

                            <span
                                className={cn(
                                    "mt-[clamp(2px,1vw,4px)] max-w-full truncate whitespace-nowrap text-[clamp(9px,2.5vw,10px)] font-bold leading-none tracking-tight transition-all duration-300",
                                    isActive ? "text-primary" : "text-gray-400"
                                )}
                            >
                                {item.label}
                            </span>
                        </div>

                        {/* Top Accent Line for Active State */}
                        {isActive && (
                            <div className="absolute -top-px h-[3px] w-[clamp(24px,8vw,32px)] rounded-full bg-primary transition-opacity duration-300" />
                        )}
                    </Link>
                );
            })}
        </nav>
    );
};

export default BottomNav;


import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { cn } from '@/lib/utils';

const Modal = ({ isOpen, onClose, title, children, footer, size = 'md' }) => {
    const sizes = {
        sm: 'sm:max-w-md',
        md: 'sm:max-w-lg',
        lg: 'sm:max-w-2xl',
        xl: 'sm:max-w-4xl',
        full: 'sm:max-w-[95vw] h-[95vh]',
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className={cn("overflow-hidden p-0", sizes[size])}>
                <DialogHeader className="px-6 pt-3 pb-2 border-b border-gray-100/50 bg-gray-50/10">
                    <DialogTitle className="text-2xl font-semibold text-gray-900">{title}</DialogTitle>
                    <DialogDescription className="sr-only">Modal content</DialogDescription>
                </DialogHeader>

                {/*
                    `data-lenis-prevent` is REQUIRED here: the global
                    `LenisScroll` component (App.jsx) installs a
                    window-level wheel listener that intercepts touchpad
                    + mouse-wheel events BEFORE React's synthetic event
                    pipeline runs, so the `onWheel={stopPropagation}`
                    below isn't sufficient on its own. Without
                    `data-lenis-prevent`, modal content longer than
                    80vh becomes unscrollable on desktop.

                    `touch-pan-y` + `overscroll-contain` round out the
                    touch story (mobile + Apple touchpads).
                */}
                <div
                    data-lenis-prevent
                    className="px-6 pt-3 pb-5 max-h-[80vh] overflow-y-auto overscroll-contain touch-pan-y"
                    tabIndex={0}
                    onWheel={(e) => e.stopPropagation()}
                    onTouchMove={(e) => e.stopPropagation()}
                >
                    {children}
                </div>

                {footer && (
                    <DialogFooter className="px-6 py-4 bg-gray-50/30 border-t border-gray-100/50 sm:justify-end gap-3">
                        {footer}
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default Modal;


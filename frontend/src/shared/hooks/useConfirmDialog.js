import { useCallback, useState } from 'react';

/**
 * useConfirmDialog
 *
 * Replaces the per-page boilerplate of "open a modal, store the row id we're
 * about to act on, close it on cancel, run the handler on confirm". Pair with
 * `ConfirmDialog` UI component.
 *
 *   const confirm = useConfirmDialog();
 *
 *   const handleDelete = (row) => {
 *     confirm.open({
 *       title: 'Delete order?',
 *       message: `Delete order ${row.orderId}?`,
 *       onConfirm: () => api.delete(`/orders/${row.orderId}`),
 *     });
 *   };
 *
 *   <ConfirmDialog
 *     isOpen={confirm.isOpen}
 *     title={confirm.title}
 *     message={confirm.message}
 *     onConfirm={confirm.handleConfirm}
 *     onCancel={confirm.close}
 *     loading={confirm.loading}
 *   />
 */
export function useConfirmDialog() {
    const [state, setState] = useState({
        isOpen: false,
        title: '',
        message: '',
        confirmLabel: 'Confirm',
        cancelLabel: 'Cancel',
        onConfirm: null,
        loading: false,
    });

    const open = useCallback((opts) => {
        setState((prev) => ({
            ...prev,
            isOpen: true,
            title: opts?.title || '',
            message: opts?.message || '',
            confirmLabel: opts?.confirmLabel || 'Confirm',
            cancelLabel: opts?.cancelLabel || 'Cancel',
            onConfirm: typeof opts?.onConfirm === 'function' ? opts.onConfirm : null,
            loading: false,
        }));
    }, []);

    const close = useCallback(() => {
        setState((prev) => ({ ...prev, isOpen: false, loading: false }));
    }, []);

    const handleConfirm = useCallback(async () => {
        const fn = state.onConfirm;
        if (typeof fn !== 'function') {
            close();
            return;
        }
        setState((prev) => ({ ...prev, loading: true }));
        try {
            await fn();
            setState((prev) => ({ ...prev, isOpen: false, loading: false }));
        } catch {
            // Caller is responsible for surfacing errors (toast, inline, etc.).
            // Keep the dialog open with loading=false so the user can retry.
            setState((prev) => ({ ...prev, loading: false }));
        }
    }, [state.onConfirm, close]);

    return {
        isOpen: state.isOpen,
        title: state.title,
        message: state.message,
        confirmLabel: state.confirmLabel,
        cancelLabel: state.cancelLabel,
        loading: state.loading,
        open,
        close,
        handleConfirm,
    };
}

export default useConfirmDialog;

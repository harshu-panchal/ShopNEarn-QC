import React from 'react';
import Modal from './Modal';
import Button from './Button';

/**
 * ConfirmDialog
 *
 * Pair component for the `useConfirmDialog` hook. Built on top of the
 * existing `Modal` primitive so styling is consistent across all admin /
 * seller / delivery panels.
 *
 *   const confirm = useConfirmDialog();
 *
 *   <ConfirmDialog
 *     isOpen={confirm.isOpen}
 *     title={confirm.title}
 *     message={confirm.message}
 *     confirmLabel={confirm.confirmLabel}
 *     cancelLabel={confirm.cancelLabel}
 *     onConfirm={confirm.handleConfirm}
 *     onCancel={confirm.close}
 *     loading={confirm.loading}
 *     variant="danger"
 *   />
 */
const ConfirmDialog = ({
    isOpen,
    onConfirm,
    onCancel,
    title = 'Are you sure?',
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    loading = false,
    variant = 'primary',
}) => {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onCancel}
            title={title}
            size="sm"
            footer={
                <>
                    <Button
                        variant="outline"
                        onClick={onCancel}
                        disabled={loading}
                    >
                        {cancelLabel}
                    </Button>
                    <Button
                        variant={variant}
                        onClick={onConfirm}
                        isLoading={loading}
                    >
                        {confirmLabel}
                    </Button>
                </>
            }
        >
            {typeof message === 'string' ? (
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{message}</p>
            ) : (
                message
            )}
        </Modal>
    );
};

export default ConfirmDialog;

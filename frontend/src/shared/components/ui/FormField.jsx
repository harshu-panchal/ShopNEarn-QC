import React from 'react';
import { cn } from '@/lib/utils';

/**
 * FormField
 *
 * Thin wrapper that gives a label, error text, helper text, and optional
 * required-asterisk to any input child. Keeps form layouts uniform without
 * locking pages into a specific input implementation (use the existing
 * `Input`, a native select, a date picker, anything).
 *
 *   <FormField label="Order ID" required error={errors.orderId}>
 *     <Input value={orderId} onChange={...} />
 *   </FormField>
 */
const FormField = ({
    label,
    htmlFor,
    children,
    error,
    helperText,
    required = false,
    className,
}) => {
    return (
        <div className={cn('flex flex-col gap-1.5', className)}>
            {label && (
                <label
                    htmlFor={htmlFor}
                    className="text-sm font-medium text-gray-700"
                >
                    {label}
                    {required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
            )}
            {children}
            {error ? (
                <p className="text-xs text-red-600">{error}</p>
            ) : helperText ? (
                <p className="text-xs text-gray-500">{helperText}</p>
            ) : null}
        </div>
    );
};

export default FormField;

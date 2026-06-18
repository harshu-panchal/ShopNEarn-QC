import React, { useEffect, useState } from 'react';
import { User, CreditCard, IdCard, Mail, Phone, MapPin, Menu, Info, Edit2, X, Save } from 'lucide-react';
import { useAuth } from '@core/context/AuthContext';
import { mlmApi } from '../../services/mlmApi';
import { customerApi } from '../../services/customerApi';
import { useMlmDrawer } from './MlmLayout';
import { toast } from 'sonner';

const Header = ({ title }) => {
    const { openDrawer } = useMlmDrawer();
    return (
        <div className="md:hidden sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 pt-4 pb-3 border-b border-slate-200/60 mb-4 flex items-center gap-2">
            <button
                onClick={openDrawer}
                className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors -ml-1"
                aria-label="Open navigation menu"
            >
                <Menu size={22} className="text-slate-700" />
            </button>
            <h1 className="text-xl font-bold text-slate-800 ml-1">{title}</h1>
        </div>
    );
};

const MlmProfilePage = () => {
    const { user } = useAuth();
    const [membership, setMembership] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [saving, setSaving] = useState(false);

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        accountHolderName: '',
        accountNumber: '',
        ifsc: '',
        upiId: '',
        panNumber: '',
        aadhaarNumber: '',
        method: ''
    });

    useEffect(() => {
        const fetchDetails = async () => {
            try {
                setLoading(true);
                const res = await mlmApi.getMembership();
                const memData = res.data?.result?.membership || null;
                setMembership(memData);
                
                // Initialize form data
                setFormData({
                    name: user?.name || '',
                    email: user?.email || '',
                    accountHolderName: memData?.payoutBeneficiary?.accountHolderName || '',
                    accountNumber: memData?.payoutBeneficiary?.accountNumber || '',
                    ifsc: memData?.payoutBeneficiary?.ifsc || '',
                    upiId: memData?.payoutBeneficiary?.upiId || '',
                    panNumber: memData?.payoutBeneficiary?.panNumber || '',
                    aadhaarNumber: memData?.payoutBeneficiary?.aadhaarNumber || '',
                    method: memData?.payoutBeneficiary?.method || ''
                });
            } catch (err) {
                console.error("Failed to fetch membership details", err);
            } finally {
                setLoading(false);
            }
        };
        if (user) {
            fetchDetails();
        }
    }, [user]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            
            // 1. Update Customer Core Profile (Name, Email)
            await customerApi.updateProfile({
                name: formData.name,
                email: formData.email
            });

            // 2. Update MLM Membership Details (Payout, KYC)
            const membershipUpdate = {
                payoutBeneficiary: {
                    accountHolderName: formData.accountHolderName,
                    accountNumber: formData.accountNumber,
                    ifsc: formData.ifsc,
                    upiId: formData.upiId,
                    panNumber: formData.panNumber,
                    aadhaarNumber: formData.aadhaarNumber,
                    method: formData.method || null
                }
            };
            await mlmApi.updateMembership(membershipUpdate);

            toast.success("Profile updated successfully!");
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } catch (error) {
            console.error("Update failed", error);
            toast.error(error?.response?.data?.message || "Failed to update profile");
        } finally {
            setSaving(false);
        }
    };

    const beneficiary = membership?.payoutBeneficiary || {};

    const InfoRow = ({ label, value, name, type = "text", editable = false, isSelect = false, options = [] }) => {
        if (isEditing && editable) {
            if (isSelect) {
                return (
                    <div className="flex flex-col py-3 border-b border-slate-100 last:border-0">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
                        <select
                            name={name}
                            value={formData[name] || ''}
                            onChange={handleInputChange}
                            className="mt-1 text-sm font-medium text-slate-900 border border-slate-300 rounded-md p-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                            <option value="">Select Method</option>
                            {options.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                );
            }
            return (
                <div className="flex flex-col py-3 border-b border-slate-100 last:border-0">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
                    <input
                        type={type}
                        name={name}
                        value={formData[name] || ''}
                        onChange={handleInputChange}
                        className="mt-1 text-sm font-medium text-slate-900 border border-slate-300 rounded-md p-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full"
                    />
                </div>
            );
        }

        return (
            <div className="flex flex-col py-3 border-b border-slate-100 last:border-0">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
                <span className="text-sm font-medium text-slate-900 mt-1">
                    {value || <span className="text-slate-400 italic">Not provided</span>}
                </span>
            </div>
        );
    };

    return (
        <div className="flex flex-col min-h-screen bg-slate-50">
            {/* Mobile Header */}
            <Header title="My Profile" />

            {/* Main content - full width */}
            <div className="flex-1 p-4 md:p-6 lg:p-8 w-full space-y-6">
                
                {/* Header Action Row */}
                <div className="flex justify-end items-center mb-4">
                    {!isEditing ? (
                        <button
                            onClick={() => setIsEditing(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors shadow-sm font-medium text-sm"
                        >
                            <Edit2 size={16} /> Edit Profile
                        </button>
                    ) : (
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setIsEditing(false)}
                                disabled={saving}
                                className="flex items-center gap-2 px-4 py-2 bg-white text-slate-600 border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors font-medium text-sm disabled:opacity-50"
                            >
                                <X size={16} /> Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors shadow-sm font-medium text-sm disabled:opacity-50"
                            >
                                {saving ? <span className="animate-spin text-lg leading-none">C</span> : <Save size={16} />}
                                {saving ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    )}
                </div>

                {/* Basic Details Section */}
                <section className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
                        <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
                            <User size={24} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-900">Personal Details</h2>
                            <p className="text-sm text-slate-500">Your basic account information</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-2">
                        <InfoRow label="Full Name" value={user?.name} name="name" editable={true} />
                        <InfoRow label="Email Address" value={user?.email} name="email" type="email" editable={true} />
                        <InfoRow label="Phone Number" value={user?.phone} editable={false} />
                        <InfoRow label="Referral Code" value={membership?.referralCode} editable={false} />
                    </div>
                </section>

                {/* Bank & UPI Section */}
                <section className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
                        <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
                            <CreditCard size={24} />
                        </div>
                        <div className="flex-1">
                            <h2 className="text-lg font-bold text-slate-900">Payout Details</h2>
                            <p className="text-sm text-slate-500">Bank account and UPI information for withdrawals</p>
                        </div>
                    </div>

                    {loading ? (
                        <div className="text-center py-4 text-slate-500 text-sm">Loading payout details...</div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-2">
                            <InfoRow label="Account Holder Name" value={beneficiary.accountHolderName} name="accountHolderName" editable={true} />
                            <InfoRow label="Account Number" value={beneficiary.accountNumber} name="accountNumber" editable={true} />
                            <InfoRow label="IFSC Code" value={beneficiary.ifsc} name="ifsc" editable={true} />
                            <InfoRow label="UPI ID" value={beneficiary.upiId} name="upiId" editable={true} />
                            <InfoRow 
                                label="Preferred Method" 
                                value={beneficiary.method ? beneficiary.method.toUpperCase() : null} 
                                name="method" 
                                editable={true} 
                                isSelect={true}
                                options={[
                                    { value: 'bank', label: 'BANK' },
                                    { value: 'upi', label: 'UPI' }
                                ]}
                            />
                        </div>
                    )}
                </section>

                {/* KYC Section */}
                <section className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
                        <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl">
                            <IdCard size={24} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-900">KYC Documents</h2>
                            <p className="text-sm text-slate-500">Aadhaar and PAN details</p>
                        </div>
                    </div>

                    {loading ? (
                        <div className="text-center py-4 text-slate-500 text-sm">Loading KYC details...</div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-2">
                            <InfoRow label="Aadhaar Number" value={beneficiary.aadhaarNumber} name="aadhaarNumber" editable={true} />
                            <InfoRow label="PAN Number" value={beneficiary.panNumber} name="panNumber" editable={true} />
                        </div>
                    )}
                    
                    {!isEditing && (
                        <div className="mt-4 flex items-start gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100 max-w-2xl">
                            <Info size={16} className="text-slate-500 shrink-0 mt-0.5" />
                            <p className="text-xs text-slate-600">
                                Click the 'Edit Profile' button at the top to update your payout or KYC details. Note that your phone number cannot be changed.
                            </p>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
};

export default MlmProfilePage;

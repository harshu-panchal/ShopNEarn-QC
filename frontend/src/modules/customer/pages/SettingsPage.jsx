import React, { useState } from 'react';
import { Bell, Lock, User, Globe, ChevronRight, ToggleRight, Trash2, X, AlertTriangle } from 'lucide-react';
import { useAuth } from '@core/context/AuthContext';
import { customerApi } from '../services/customerApi';
import { useToast } from '@shared/components/ui/Toast';

const SettingsPage = () => {
    const { logout } = useAuth();
    const { showToast } = useToast();
    const [showConfirm, setShowConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const handleDeleteAccount = async () => {
        try {
            setDeleting(true);
            await customerApi.deleteAccount();
            showToast('Your account has been deleted.', 'success');
            await logout();
        } catch (err) {
            showToast(err.response?.data?.message || 'Failed to delete account.', 'error');
        } finally {
            setDeleting(false);
            setShowConfirm(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 pb-24 font-sans">
            {/* Header */}
            <div className="bg-gradient-to-br from-primary to-[#149d29] px-5 pt-10 pb-20 relative z-10 rounded-b-[2.5rem] shadow-lg overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -mr-16 -mt-32 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-black/5 rounded-full blur-2xl -ml-10 -mb-10 pointer-events-none" />
                <h1 className="text-3xl font-black text-white tracking-tight relative z-10">Settings</h1>
                <p className="text-brand-50 text-sm font-medium mt-1 relative z-10">Configure your app preferences</p>
            </div>

            <div className="max-w-2xl mx-auto px-4 -mt-10 relative z-20 space-y-6">

                {/* General Section */}
                <div className="bg-white rounded-3xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100">
                    <div className="px-6 py-4 bg-slate-50/50 border-b border-slate-100">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">General</h3>
                    </div>
                    <div className="divide-y divide-slate-50">
                        <SettingItem icon={Bell} label="Notifications" hasToggle />
                        <SettingItem icon={Globe} label="Language" value="English" />
                    </div>
                </div>

                {/* Security Section */}
                <div className="bg-white rounded-3xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100">
                    <div className="px-6 py-4 bg-slate-50/50 border-b border-slate-100">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Security</h3>
                    </div>
                    <div className="divide-y divide-slate-50">
                        <SettingItem icon={Lock} label="Change Password" />
                        <SettingItem icon={User} label="Privacy Settings" />
                    </div>
                </div>

                {/* Danger Zone */}
                <div className="bg-white rounded-3xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-red-100">
                    <div className="px-6 py-4 bg-red-50/50 border-b border-red-100">
                        <h3 className="text-xs font-bold text-red-400 uppercase tracking-wider">Danger Zone</h3>
                    </div>
                    <div className="p-4 space-y-3">
                        {!showConfirm ? (
                            <button
                                onClick={() => setShowConfirm(true)}
                                className="w-full py-4 text-red-600 font-bold bg-red-50 rounded-2xl flex items-center justify-center gap-2 hover:bg-red-100 transition-colors"
                            >
                                <Trash2 size={20} /> Delete Account
                            </button>
                        ) : (
                            <div className="bg-red-50 rounded-2xl p-5 space-y-4">
                                <div className="flex items-start gap-3">
                                    <AlertTriangle size={22} className="text-red-500 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-bold text-red-700 text-sm">Delete your account?</p>
                                        <p className="text-xs text-red-500 mt-1 leading-relaxed">
                                            This will permanently remove your account and all associated data. This action cannot be undone.
                                        </p>
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setShowConfirm(false)}
                                        disabled={deleting}
                                        className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                                    >
                                        <X size={16} /> Cancel
                                    </button>
                                    <button
                                        onClick={handleDeleteAccount}
                                        disabled={deleting}
                                        className="flex-1 py-3 rounded-xl bg-red-600 text-white font-bold text-sm hover:bg-red-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                                    >
                                        {deleting ? (
                                            <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                        ) : (
                                            <Trash2 size={16} />
                                        )}
                                        {deleting ? 'Deleting…' : 'Yes, Delete'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
};

const SettingItem = ({ icon: Icon, label, value, hasToggle }) => (
    <div className="px-6 py-5 flex items-center justify-between hover:bg-slate-50 cursor-pointer transition-colors">
        <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                <Icon size={20} />
            </div>
            <span className="font-bold text-slate-800 text-base">{label}</span>
        </div>

        <div className="flex items-center gap-2">
            {value && <span className="text-slate-400 text-sm font-medium">{value}</span>}
            {hasToggle ? (
                <ToggleRight size={32} className="text-primary fill-current" />
            ) : (
                <ChevronRight size={20} className="text-slate-300" />
            )}
        </div>
    </div>
);

export default SettingsPage;

import React from 'react';
import { Link } from 'react-router-dom';
import Card from '@shared/components/ui/Card';
import { ShieldOff } from 'lucide-react';

const AdminAccessDenied = ({ missing = '' }) => {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="max-w-lg w-full border-none shadow-xl ring-1 ring-slate-100 rounded-2xl p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-rose-600">
          <ShieldOff className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-black text-slate-900 mb-2">Access Denied</h1>
        <p className="text-slate-600 mb-2">
          You do not have permission to view this page.
        </p>
        {missing ? (
          <p className="text-xs font-mono text-slate-400 mb-6">Required: {missing}</p>
        ) : (
          <div className="mb-6" />
        )}
        <Link
          to="/admin/profile"
          className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20"
        >
          Go to My Profile
        </Link>
      </Card>
    </div>
  );
};

export default AdminAccessDenied;

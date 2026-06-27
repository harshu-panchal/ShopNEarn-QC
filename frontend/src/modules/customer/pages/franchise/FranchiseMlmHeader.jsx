import React from "react";
import { Menu } from "lucide-react";
import { useMlmDrawer } from "../mlm/MlmLayout";

const FranchiseMlmHeader = ({ title }) => {
  const { openDrawer } = useMlmDrawer();

  return (
    <div className="md:hidden sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 pt-4 pb-3 border-b border-slate-200/60 mb-4 flex items-center gap-2">
      <button
        type="button"
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

export default FranchiseMlmHeader;
